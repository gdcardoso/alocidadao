import {
  listOwnRequests,
  ownRequestTenant,
  schema,
  type Database,
  type Transaction,
} from '@alocidadao/db';
import {
  FINAL_REQUEST_STATUSES,
  apiErrorSchema,
  applyOccurrenceAction,
  applyRequestAction,
  contestBodySchema,
  requestActionBodySchema,
  requestCardSchema,
  requestDetailSchema,
  requestFilterStatuses,
  requestListFilterSchema,
  type ContestBody,
  type OccurrenceAction,
  type OccurrenceStatus,
  type PhotoView,
  type RequestActionBody,
  type RequestCard,
  type RequestDetail,
  type RequestStatus,
} from '@alocidadao/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { asActiveUser, enterTenant, INACTIVE } from '../auth/active-user.js';
import { requireAuth } from '../auth/plugin.js';
import { PHOTO_KEY_CONSTRAINT, isUniqueViolation, violatedConstraint } from '../db-errors.js';
import type { Storage } from '../storage/s3.js';
import { photosExist } from './create-request.js';
import type { CitizenDeps } from './routes.js';

const {
  requests,
  categories,
  occurrences,
  photos,
  statusEvents,
  clientActions,
  workOrders,
  teams,
} = schema;

/** Validade dos links das fotos mostradas ao cidadão. */
const PHOTO_URL_SECONDS = 15 * 60;

/** Comentário gravado nas solicitações reabertas pela contestação de outro morador. */
export const CONTEST_NOTICE =
  'Outro morador informou que o problema continua; a prefeitura vai reavaliar.';

/** Status em que o cidadão vê o texto público e as fotos da conclusão. */
const COMPLETION_VISIBLE: readonly RequestStatus[] = ['awaiting_confirmation', 'completed'];

const idParams = z.object({ id: z.uuid() });
const listQuerySchema = z.object({ filter: requestListFilterSchema.default('all') });

/** A solicitação não existe ou não é do usuário: 404 request_not_found. */
const NOT_FOUND = Symbol('request_not_found');

type CitizenAction = 'cancel' | 'confirm' | 'contest';

/** Tipo gravado em `client_actions` para cada ação. */
const ACTION_KINDS: Record<CitizenAction, string> = {
  cancel: 'cancel_request',
  confirm: 'confirm_request',
  contest: 'contest_request',
};

type ActionOutcome =
  | { kind: 'ok'; card: RequestCard }
  | { kind: 'invalid_status' }
  | { kind: 'client_action_conflict' }
  | { kind: 'photo_missing' }
  | { kind: 'photo_already_used' }
  | { kind: 'storage_not_configured' };

/**
 * Roda `fn` na prefeitura da solicitação, só se ela é do usuário. Não existe leitura de
 * solicitações entre prefeituras: a função do banco diz de qual prefeitura ela é, e a
 * transação entra nela.
 */
function withOwnRequest<T>(
  db: Database,
  userId: string,
  requestId: string,
  fn: (tx: Transaction, tenantId: string) => Promise<T>,
): Promise<T | typeof NOT_FOUND | typeof INACTIVE> {
  return asActiveUser(db, userId, async (tx) => {
    const tenantId = await ownRequestTenant(tx, requestId);
    if (!tenantId) return NOT_FOUND;
    await enterTenant(tx, tenantId);
    return fn(tx, tenantId);
  });
}

const cardColumns = {
  id: requests.id,
  protocol: requests.protocol,
  status: requests.status,
  categoryName: categories.name,
  icon: categories.icon,
  iconGroup: categories.iconGroup,
  address: requests.address,
  createdAt: requests.createdAt,
  statusChangedAt: requests.statusChangedAt,
};

function toCard(row: {
  id: string;
  protocol: string;
  status: RequestStatus;
  categoryName: string;
  icon: string | null;
  iconGroup: RequestCard['iconGroup'];
  address: string | null;
  createdAt: Date;
  statusChangedAt: Date;
}): RequestCard {
  return {
    id: row.id,
    protocol: row.protocol,
    status: row.status,
    categoryName: row.categoryName,
    icon: row.icon,
    iconGroup: row.iconGroup,
    address: row.address,
    createdAt: row.createdAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
  };
}

/** Cartão da solicitação, lido na prefeitura do contexto. */
async function loadCard(tx: Transaction, requestId: string): Promise<RequestCard> {
  const [row] = await tx
    .select(cardColumns)
    .from(requests)
    .innerJoin(categories, eq(categories.id, requests.categoryId))
    .where(eq(requests.id, requestId));
  return toCard(row!);
}

async function photoViews<Row extends { storageKey: string; createdAt: Date }>(
  storage: Storage,
  rows: Row[],
  purposeOf: (row: Row) => PhotoView['purpose'],
): Promise<PhotoView[]> {
  return Promise.all(
    rows.map(async (row) => ({
      url: await storage.presignGet(row.storageKey, PHOTO_URL_SECONDS),
      takenAt: row.createdAt.toISOString(),
      purpose: purposeOf(row),
    })),
  );
}

/**
 * Detalhe da solicitação. Só sai daqui o que o cidadão pode ver: nada do relato do agente,
 * dos comentários da gestão, das fotos não publicadas ou das solicitações dos vizinhos.
 */
async function loadDetail(
  tx: Transaction,
  storage: Storage,
  requestId: string,
): Promise<RequestDetail> {
  const [request] = await tx
    .select({
      ...cardColumns,
      description: requests.description,
      location: requests.location,
      occurrenceId: requests.occurrenceId,
      rejectionReason: occurrences.rejectionReason,
    })
    .from(requests)
    .innerJoin(categories, eq(categories.id, requests.categoryId))
    .innerJoin(occurrences, eq(occurrences.id, requests.occurrenceId))
    .where(eq(requests.id, requestId));
  const row = request!;

  const ownPhotos = await tx
    .select({
      storageKey: photos.storageKey,
      createdAt: photos.createdAt,
      purpose: photos.purpose,
    })
    .from(photos)
    .where(eq(photos.requestId, requestId))
    .orderBy(asc(photos.createdAt), asc(photos.id));

  // Equipe da atividade ativa; sem ela, da última concluída.
  const [team] = await tx
    .select({ name: teams.name })
    .from(workOrders)
    .innerJoin(teams, eq(teams.id, workOrders.teamId))
    .where(and(eq(workOrders.occurrenceId, row.occurrenceId), ne(workOrders.status, 'cancelled')))
    .orderBy(
      asc(sql`${workOrders.status} = 'completed'`),
      sql`${workOrders.completedAt} desc nulls last`,
      desc(workOrders.createdAt),
    )
    .limit(1);

  let completion: RequestDetail['completion'] = null;
  if (COMPLETION_VISIBLE.includes(row.status)) {
    const [order] = await tx
      .select({
        id: workOrders.id,
        publicNote: workOrders.publicNote,
        publishedAt: workOrders.publishedAt,
      })
      .from(workOrders)
      .where(and(eq(workOrders.occurrenceId, row.occurrenceId), eq(workOrders.status, 'completed')))
      .orderBy(sql`${workOrders.completedAt} desc nulls last`, desc(workOrders.createdAt))
      .limit(1);
    if (order?.publishedAt) {
      const published = await tx
        .select({ storageKey: photos.storageKey, createdAt: photos.createdAt })
        .from(photos)
        .where(
          and(
            eq(photos.workOrderId, order.id),
            eq(photos.purpose, 'completion'),
            eq(photos.review, 'published'),
          ),
        )
        .orderBy(asc(photos.createdAt), asc(photos.id));
      completion = {
        publicNote: order.publicNote,
        publishedAt: order.publishedAt.toISOString(),
        photos: await photoViews(storage, published, () => 'completion'),
      };
    }
  }

  // Só os eventos desta solicitação, sem comentário nem autor.
  const events = await tx
    .select({ status: statusEvents.toStatus, at: statusEvents.createdAt })
    .from(statusEvents)
    .where(eq(statusEvents.requestId, requestId))
    .orderBy(asc(statusEvents.createdAt), asc(statusEvents.id));

  let rejection: RequestDetail['rejection'] = null;
  if (row.status === 'rejected') {
    const rejectedAt = events.findLast((event) => event.status === 'rejected')?.at;
    rejection = {
      reason: row.rejectionReason,
      at: (rejectedAt ?? row.statusChangedAt).toISOString(),
    };
  }

  return {
    ...toCard(row),
    description: row.description,
    // geometry em modo xy: x = longitude, y = latitude.
    location: { lat: row.location.y, lng: row.location.x },
    photos: await photoViews(storage, ownPhotos, (photo) =>
      photo.purpose === 'contest' ? 'contest' : 'report',
    ),
    team: team ? { name: team.name } : null,
    completion,
    rejection,
    timeline: events.map((event) => ({
      status: event.status as RequestStatus,
      at: event.at.toISOString(),
    })),
  };
}

/**
 * Procura a ação já gravada. Só é repetição se for da mesma pessoa, da mesma solicitação e do
 * mesmo tipo; o mesmo id usado para outra coisa é conflito.
 */
async function findStoredAction(
  tx: Transaction,
  clientActionId: string,
  userId: string,
  requestId: string,
  action: CitizenAction,
): Promise<ActionOutcome | undefined> {
  const [stored] = await tx
    .select({
      response: clientActions.response,
      kind: clientActions.kind,
      userId: clientActions.userId,
      targetId: clientActions.targetId,
    })
    .from(clientActions)
    .where(eq(clientActions.id, clientActionId));
  if (!stored) return undefined;
  if (
    stored.kind !== ACTION_KINDS[action] ||
    stored.userId !== userId ||
    stored.targetId !== requestId
  ) {
    return { kind: 'client_action_conflict' };
  }
  return { kind: 'ok', card: requestCardSchema.parse(stored.response) };
}

interface LockedRequest {
  id: string;
  status: RequestStatus;
}

/**
 * Trava a ocorrência e depois todas as solicitações dela, sempre nessa ordem (a mesma do
 * apoio a uma ocorrência), para não haver impasse entre ações concorrentes.
 */
async function lockOccurrence(
  tx: Transaction,
  requestId: string,
): Promise<{ occurrence: { id: string; status: OccurrenceStatus }; linked: LockedRequest[] }> {
  // A solicitação pode mudar de ocorrência (junção) entre a leitura e a trava: tenta de novo.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [request] = await tx
      .select({ occurrenceId: requests.occurrenceId })
      .from(requests)
      .where(eq(requests.id, requestId));
    const [occurrence] = await tx
      .select({ id: occurrences.id, status: occurrences.status })
      .from(occurrences)
      .where(eq(occurrences.id, request!.occurrenceId))
      .for('update');
    const linked = await tx
      .select({ id: requests.id, status: requests.status })
      .from(requests)
      .where(eq(requests.occurrenceId, occurrence!.id))
      .orderBy(asc(requests.id))
      .for('update');
    if (linked.some((row) => row.id === requestId)) return { occurrence: occurrence!, linked };
  }
  throw new Error('A solicitação mudou de ocorrência durante a ação');
}

/** Muda a ocorrência pela máquina de status; fora da origem permitida, ela fica como está. */
async function moveOccurrence(
  tx: Transaction,
  tenantId: string,
  occurrence: { id: string; status: OccurrenceStatus },
  action: OccurrenceAction,
  actorUserId: string,
) {
  const transition = applyOccurrenceAction(occurrence.status, action, 'system');
  if (!transition.ok) return;
  await tx
    .update(occurrences)
    .set({ status: transition.to, updatedAt: new Date() })
    .where(eq(occurrences.id, occurrence.id));
  await tx.insert(statusEvents).values({
    tenantId,
    occurrenceId: occurrence.id,
    fromStatus: occurrence.status,
    toStatus: transition.to,
    actorUserId,
  });
}

async function runAction(
  tx: Transaction,
  { storage, secret }: Pick<CitizenDeps, 'storage' | 'secret'>,
  tenantId: string,
  userId: string,
  requestId: string,
  action: CitizenAction,
  body: RequestActionBody | ContestBody,
): Promise<ActionOutcome> {
  // A repetição vem antes de qualquer conferência: a ação já valeu.
  const replay = await findStoredAction(tx, body.clientActionId, userId, requestId, action);
  if (replay) return replay;

  const photoKeys = 'photoKeys' in body ? body.photoKeys : [];
  const comment = 'comment' in body ? body.comment : null;
  if (photoKeys.length > 0) {
    if (!storage) return { kind: 'storage_not_configured' };
    if (!(await photosExist(storage, secret, userId, photoKeys))) return { kind: 'photo_missing' };
  }

  const { occurrence, linked } = await lockOccurrence(tx, requestId);
  // Depois da trava, a leitura enxerga o que uma repetição concorrente já gravou.
  const stored = await findStoredAction(tx, body.clientActionId, userId, requestId, action);
  if (stored) return stored;

  const mine = linked.find((row) => row.id === requestId)!;
  const others = linked.filter((row) => row.id !== requestId);
  const transition = applyRequestAction(mine.status, action, 'citizen');
  if (!transition.ok) return { kind: 'invalid_status' };

  const now = new Date();
  await tx
    .update(requests)
    .set({ status: transition.to, statusChangedAt: now, updatedAt: now })
    .where(eq(requests.id, requestId));
  await tx.insert(statusEvents).values({
    tenantId,
    occurrenceId: occurrence.id,
    requestId,
    fromStatus: mine.status,
    toStatus: transition.to,
    actorUserId: userId,
    comment,
  });
  if (photoKeys.length > 0) {
    await tx.insert(photos).values(
      photoKeys.map((storageKey) => ({
        tenantId,
        requestId,
        storageKey,
        uploadedBy: userId,
        purpose: 'contest' as const,
      })),
    );
  }

  if (action === 'cancel') {
    // Sem outra solicitação ativa, a ocorrência deixa de ter motivo para existir.
    if (others.every((row) => FINAL_REQUEST_STATUSES.includes(row.status))) {
      await moveOccurrence(tx, tenantId, occurrence, 'cancel', userId);
    }
  } else if (action === 'confirm') {
    if (!others.some((row) => row.status === 'awaiting_confirmation')) {
      await moveOccurrence(tx, tenantId, occurrence, 'close', userId);
    }
  } else {
    // Quem ainda aguardava volta a acompanhar o problema, com um aviso que não traz o
    // comentário nem o nome de quem contestou (o autor do evento fica vazio: é o sistema).
    const reopened = others.filter((row) => applyRequestAction(row.status, 'reopen', 'system').ok);
    if (reopened.length > 0) {
      await tx
        .update(requests)
        .set({ status: 'open', statusChangedAt: now, updatedAt: now })
        .where(
          inArray(
            requests.id,
            reopened.map((row) => row.id),
          ),
        );
      await tx.insert(statusEvents).values(
        reopened.map((row) => ({
          tenantId,
          occurrenceId: occurrence.id,
          requestId: row.id,
          fromStatus: row.status,
          toStatus: 'open',
          comment: CONTEST_NOTICE,
        })),
      );
    }
    await moveOccurrence(tx, tenantId, occurrence, 'reopen', userId);
  }

  const card = await loadCard(tx, requestId);
  await tx.insert(clientActions).values({
    id: body.clientActionId,
    tenantId,
    userId,
    kind: ACTION_KINDS[action],
    targetId: requestId,
    response: card,
  });
  return { kind: 'ok', card };
}

type PerformOutcome = ActionOutcome | typeof NOT_FOUND | typeof INACTIVE;

/** Roda a ação; numa violação de unicidade, relê o que o envio concorrente gravou. */
async function performAction(
  { db, storage, secret }: CitizenDeps,
  userId: string,
  requestId: string,
  action: CitizenAction,
  body: RequestActionBody | ContestBody,
): Promise<PerformOutcome> {
  try {
    return await withOwnRequest(db, userId, requestId, (tx, tenantId) =>
      runAction(tx, { storage, secret }, tenantId, userId, requestId, action, body),
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Outro envio com o mesmo id gravou primeiro: devolve a resposta dele, se for a mesma ação.
    const stored = await withOwnRequest(db, userId, requestId, (tx) =>
      findStoredAction(tx, body.clientActionId, userId, requestId, action),
    );
    if (stored) return stored;
    if (violatedConstraint(error) === PHOTO_KEY_CONSTRAINT) return { kind: 'photo_already_used' };
    // O id já foi usado por outra pessoa ou em outra prefeitura (invisível aqui).
    return { kind: 'client_action_conflict' };
  }
}

async function respond(reply: FastifyReply, pending: Promise<PerformOutcome>) {
  const outcome = await pending;
  if (outcome === INACTIVE) return reply.code(401).send({ code: 'unauthorized' });
  if (outcome === NOT_FOUND) return reply.code(404).send({ code: 'request_not_found' });
  switch (outcome.kind) {
    case 'ok':
      return reply.code(200).send(outcome.card);
    case 'invalid_status':
    case 'client_action_conflict':
    case 'photo_already_used':
      return reply.code(409).send({ code: outcome.kind });
    case 'photo_missing':
      return reply.code(422).send({ code: outcome.kind });
    case 'storage_not_configured':
      return reply.code(503).send({ code: outcome.kind });
  }
}

/** Lista, detalhe e ações do cidadão sobre as próprias solicitações. */
export function registerRequestRoutes(instance: FastifyInstance, deps: CitizenDeps) {
  const { db, storage } = deps;
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/citizen/requests',
    {
      preHandler: requireAuth(['app']),
      schema: {
        querystring: listQuerySchema,
        response: { 200: z.array(requestCardSchema), 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const statuses = requestFilterStatuses(request.query.filter);
      const rows = await asActiveUser(db, userId, (tx) => listOwnRequests(tx, statuses));
      if (rows === INACTIVE) return reply.code(401).send({ code: 'unauthorized' });
      return rows.map(toCard);
    },
  );

  app.get(
    '/citizen/requests/:id',
    {
      preHandler: requireAuth(['app']),
      schema: {
        params: idParams,
        response: {
          200: requestDetailSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      if (!storage) return reply.code(503).send({ code: 'storage_not_configured' });
      const detail = await withOwnRequest(db, userId, request.params.id, (tx) =>
        loadDetail(tx, storage, request.params.id),
      );
      if (detail === INACTIVE) return reply.code(401).send({ code: 'unauthorized' });
      if (detail === NOT_FOUND) return reply.code(404).send({ code: 'request_not_found' });
      return detail;
    },
  );

  const actionSchema = {
    params: idParams,
    response: {
      200: requestCardSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
      422: apiErrorSchema,
      503: apiErrorSchema,
    },
  };

  app.post(
    '/citizen/requests/:id/cancel',
    {
      preHandler: requireAuth(['app']),
      schema: { ...actionSchema, body: requestActionBodySchema },
    },
    (request, reply) =>
      respond(
        reply,
        performAction(deps, request.auth!.userId, request.params.id, 'cancel', request.body),
      ),
  );
  app.post(
    '/citizen/requests/:id/confirm',
    {
      preHandler: requireAuth(['app']),
      schema: { ...actionSchema, body: requestActionBodySchema },
    },
    (request, reply) =>
      respond(
        reply,
        performAction(deps, request.auth!.userId, request.params.id, 'confirm', request.body),
      ),
  );
  app.post(
    '/citizen/requests/:id/contest',
    { preHandler: requireAuth(['app']), schema: { ...actionSchema, body: contestBodySchema } },
    (request, reply) =>
      respond(
        reply,
        performAction(deps, request.auth!.userId, request.params.id, 'contest', request.body),
      ),
  );
}
