import {
  findActiveTenantAt,
  findMunicipalityAt,
  geoPoint,
  schema,
  type Database,
  type Transaction,
} from '@alocidadao/db';
import {
  CLUSTERABLE_OCCURRENCE_STATUSES,
  apiErrorSchema,
  createRequestInputSchema,
  createRequestResponseSchema,
  type CreateRequestInput,
  type CreateRequestResponse,
  type RequestStatus,
} from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { asActiveUser, enterTenant, INACTIVE } from '../auth/active-user.js';
import { requireAuth } from '../auth/plugin.js';
import { isUniqueViolation, violatedConstraint } from '../db-errors.js';
import { isOwnRequestPhotoKey, type Storage } from '../storage/s3.js';
import type { CitizenDeps } from './routes.js';

const { categories, occurrences, requests, photos, statusEvents, clientActions } = schema;

/** Tipo gravado em `client_actions` para a criação de solicitação. */
const CREATE_REQUEST_KIND = 'create_request';
/** Restrição única de `photos.storage_key` (nome gerado pelo Drizzle). */
export const PHOTO_KEY_CONSTRAINT = 'photos_storage_key_unique';

const municipalitySchema = z.object({ ibgeCode: z.string(), name: z.string(), state: z.string() });
/** 422 com o município do ponto, quando há; os outros 422 trazem só o código. */
const unprocessableSchema = z.object({
  code: z.string(),
  municipality: municipalitySchema.nullable().optional(),
});

type Municipality = z.infer<typeof municipalitySchema>;

type Outcome =
  | { kind: 'created'; result: CreateRequestResponse }
  | { kind: 'duplicate'; result: CreateRequestResponse }
  | { kind: 'not_served'; municipality: Municipality | null }
  | { kind: 'client_action_conflict' }
  | { kind: 'photo_already_used' }
  | { kind: 'category_unavailable' }
  | { kind: 'storage_not_configured' }
  | { kind: 'photo_missing' }
  | { kind: 'occurrence_unavailable' };

/**
 * Procura o envio já gravado. Só é repetição se for da mesma pessoa e do mesmo tipo; o mesmo
 * id usado para outra coisa é conflito. Envio gravado em outra prefeitura não aparece (RLS).
 */
async function findStoredRequest(
  tx: Transaction,
  clientActionId: string,
  userId: string,
): Promise<Outcome | undefined> {
  const [stored] = await tx
    .select({
      response: clientActions.response,
      kind: clientActions.kind,
      userId: clientActions.userId,
    })
    .from(clientActions)
    .where(eq(clientActions.id, clientActionId));
  if (!stored) return undefined;
  if (stored.kind !== CREATE_REQUEST_KIND || stored.userId !== userId) {
    return { kind: 'client_action_conflict' };
  }
  const parsed = createRequestResponseSchema.parse(stored.response);
  return { kind: 'duplicate', result: { ...parsed, duplicate: true } };
}

/** As fotos precisam ter o selo do próprio cidadão e já estar no armazenamento. */
export async function photosExist(
  storage: Storage,
  secret: string,
  userId: string,
  keys: string[],
) {
  for (const key of keys) {
    if (!isOwnRequestPhotoKey(secret, userId, key)) return false;
    if (!(await storage.head(key))) return false;
  }
  return true;
}

/** Entra na prefeitura que atende o ponto ajustado; sem ela, devolve o município (ou null). */
async function enterTenantAt(
  tx: Transaction,
  point: CreateRequestInput['location'],
): Promise<{ tenantId: string } | { municipality: Municipality | null }> {
  const tenant = await findActiveTenantAt(tx, point);
  if (!tenant) return { municipality: (await findMunicipalityAt(tx, point)) ?? null };
  await enterTenant(tx, tenant.id);
  return { tenantId: tenant.id };
}

async function createRequest(
  tx: Transaction,
  { storage, secret }: Pick<CitizenDeps, 'storage' | 'secret'>,
  userId: string,
  input: CreateRequestInput,
): Promise<Outcome> {
  // A prefeitura sai do ponto ajustado, nunca de um id mandado pelo aparelho.
  const place = await enterTenantAt(tx, input.location);
  if (!('tenantId' in place)) return { kind: 'not_served', municipality: place.municipality };
  const { tenantId } = place;

  // A repetição vem antes de qualquer conferência: o envio já valeu, mesmo que a categoria
  // tenha sido desativada ou a foto tenha sumido depois.
  const stored = await findStoredRequest(tx, input.clientActionId, userId);
  if (stored) return stored;

  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, input.categoryId),
        eq(categories.tenantId, tenantId),
        eq(categories.active, true),
      ),
    );
  if (!category) return { kind: 'category_unavailable' };

  if (!storage) return { kind: 'storage_not_configured' };
  if (!(await photosExist(storage, secret, userId, input.photoKeys)))
    return { kind: 'photo_missing' };

  let occurrenceId: string;
  let status: RequestStatus;
  if (input.occurrenceId) {
    // Trava a ocorrência apoiada: o status não muda até o fim da transação.
    const [occurrence] = await tx
      .select({ status: occurrences.status, categoryId: occurrences.categoryId })
      .from(occurrences)
      .where(eq(occurrences.id, input.occurrenceId))
      .for('update');
    if (
      !occurrence ||
      occurrence.categoryId !== input.categoryId ||
      !CLUSTERABLE_OCCURRENCE_STATUSES.includes(occurrence.status)
    ) {
      return { kind: 'occurrence_unavailable' };
    }
    occurrenceId = input.occurrenceId;
    status = occurrence.status === 'in_progress' ? 'in_progress' : 'open';
  } else {
    // Sempre uma ocorrência nova, mesmo com outra parecida perto: agrupar é com o gestor.
    const [occurrence] = await tx
      .insert(occurrences)
      .values({
        tenantId,
        categoryId: input.categoryId,
        location: geoPoint(input.location),
        status: 'triage',
      })
      .returning({ id: occurrences.id });
    occurrenceId = occurrence!.id;
    status = 'open';
  }

  const occurredAt = new Date(input.occurredAt);
  const [request] = await tx
    .insert(requests)
    .values({
      tenantId,
      citizenId: userId,
      categoryId: input.categoryId,
      occurrenceId,
      status,
      description: input.description ?? '',
      location: geoPoint(input.location),
      gpsLocation: geoPoint(input.gpsLocation),
      address: input.address ?? null,
      statusChangedAt: occurredAt,
      createdAt: occurredAt,
    })
    .returning({ id: requests.id, protocol: requests.protocol });
  const requestId = request!.id;

  // Fotos do cidadão não passam por revisão (review fica nulo).
  await tx.insert(photos).values(
    input.photoKeys.map((storageKey) => ({
      tenantId,
      requestId,
      storageKey,
      uploadedBy: userId,
      purpose: 'report' as const,
    })),
  );
  await tx.insert(statusEvents).values({
    tenantId,
    occurrenceId,
    requestId,
    toStatus: status,
    actorUserId: userId,
    connection: input.connection,
  });
  const result: CreateRequestResponse = {
    requestId,
    protocol: request!.protocol,
    status,
    duplicate: false,
  };
  await tx.insert(clientActions).values({
    id: input.clientActionId,
    tenantId,
    userId,
    kind: CREATE_REQUEST_KIND,
    targetId: requestId,
    response: result,
  });
  return { kind: 'created', result };
}

/** Releitura depois de uma violação de unicidade: outro envio gravou primeiro? */
async function afterUniqueViolation(
  db: Database,
  userId: string,
  input: CreateRequestInput,
  error: unknown,
): Promise<Outcome | typeof INACTIVE> {
  const stored = await asActiveUser(db, userId, async (tx) => {
    const place = await enterTenantAt(tx, input.location);
    if (!('tenantId' in place)) return undefined;
    return findStoredRequest(tx, input.clientActionId, userId);
  });
  if (stored) return stored;
  if (violatedConstraint(error) === PHOTO_KEY_CONSTRAINT) {
    return { kind: 'photo_already_used' };
  }
  // O id já foi usado por outra pessoa ou em outra prefeitura (invisível aqui).
  return { kind: 'client_action_conflict' };
}

/** Criação de solicitação pelo cidadão, online ou vinda da fila offline. */
export function registerCreateRequestRoutes(
  instance: FastifyInstance,
  { db, storage, secret }: CitizenDeps,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/citizen/requests',
    {
      preHandler: requireAuth(['app']),
      schema: {
        body: createRequestInputSchema,
        response: {
          200: createRequestResponseSchema,
          201: createRequestResponseSchema,
          401: apiErrorSchema,
          409: apiErrorSchema,
          422: unprocessableSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const input = request.body;

      let outcome: Outcome | typeof INACTIVE;
      try {
        outcome = await asActiveUser(db, userId, (tx) =>
          createRequest(tx, { storage, secret }, userId, input),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        outcome = await afterUniqueViolation(db, userId, input, error);
      }

      if (outcome === INACTIVE) return reply.code(401).send({ code: 'unauthorized' });
      switch (outcome.kind) {
        case 'created':
          return reply.code(201).send(outcome.result);
        case 'duplicate':
          return reply.code(200).send(outcome.result);
        case 'not_served':
          return reply
            .code(422)
            .send({ code: 'municipality_not_served', municipality: outcome.municipality });
        case 'category_unavailable':
        case 'photo_missing':
          return reply.code(422).send({ code: outcome.kind });
        case 'client_action_conflict':
        case 'photo_already_used':
        case 'occurrence_unavailable':
          return reply.code(409).send({ code: outcome.kind });
        case 'storage_not_configured':
          return reply.code(503).send({ code: outcome.kind });
      }
    },
  );
}
