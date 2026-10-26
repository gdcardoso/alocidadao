import {
  findMergeSuggestions,
  geoPoint,
  schema,
  withContext,
  type Database,
  type Transaction,
} from '@alocidadao/db';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  CLUSTERABLE_OCCURRENCE_STATUSES,
  MAX_SUGGESTIONS,
  PANEL_SEARCH_LIMIT,
  type MapStatusFilter,
  type OccurrenceDetail,
  type OccurrenceMapQuery,
  type OccurrenceMapResponse,
  type OccurrenceStatus,
  type PanelSearchResponse,
  type TeamOptionsResponse,
} from '@alocidadao/shared';
import { and, asc, count, desc, eq, ilike, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Storage } from '../storage/s3.js';
import { departmentScope, panelDbContext, type PanelIdentity } from './member.js';

const { categories, departments, occurrences, requests, teams, workOrders } = schema;

/** Máximo de pontos devolvidos pelo mapa; `total` traz a contagem real. */
export const MAP_POINTS_LIMIT = 5000;

/** Mesma validade das fotos do cidadão (citizen/requests.ts). */
const PHOTO_URL_SECONDS = 15 * 60;

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

/** Protocolo inteiro ou o começo dele: `2026-000123`, `2026-00`. */
const PROTOCOL_QUERY = /^\d{4}-\d{1,6}$/;
const SEARCH_MIN_LENGTH = 3;

/**
 * Desde quando a ocorrência (a tabela `occurrences`, sem apelido, na consulta) está no status
 * atual: o `created_at` do evento mais recente da própria ocorrência (sem solicitação nem
 * atividade) com `to_status` igual ao status atual. Sem evento, a criação da ocorrência.
 */
export function statusSinceSql(): SQL<Date> {
  return sql<Date>`coalesce(
    (
      select max(se.created_at)
      from status_events se
      where se.tenant_id = occurrences.tenant_id
        and se.occurrence_id = occurrences.id
        and se.request_id is null
        and se.work_order_id is null
        and se.to_status = occurrences.status::text
    ),
    occurrences.created_at
  )`.mapWith(occurrences.createdAt);
}

/** Relatos da ocorrência (`occurrences` sem apelido): as solicitações não canceladas. */
export function requestCountSql(): SQL<number> {
  return sql<number>`(
    select count(*)::int
    from requests rc
    where rc.tenant_id = occurrences.tenant_id
      and rc.occurrence_id = occurrences.id
      and rc.status <> 'cancelled'
  )`.mapWith(Number);
}

/** Lista de status para usar dentro de `in (...)` num SQL próprio. */
export function sqlList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/** Hoje (AAAA-MM-DD) no fuso da prefeitura, `America/Sao_Paulo`. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: SAO_PAULO_TIME_ZONE }).format(now);
}

/** Data AAAA-MM-DD somada de `days` dias. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** geometry em modo xy: x = longitude, y = latitude. */
const toGeoPoint = ({ x, y }: { x: number; y: number }) => ({ lat: y, lng: x });

const MAP_STATUSES: Record<MapStatusFilter, OccurrenceStatus[]> = {
  open_and_in_progress: ['triage', 'in_progress'],
  open: ['triage'],
  in_progress: ['in_progress'],
};

/** Pontos do mapa no alcance, filtrados por status, categoria e período (criação). */
export async function loadOccurrenceMap(
  db: Database,
  identity: PanelIdentity,
  query: OccurrenceMapQuery,
): Promise<OccurrenceMapResponse> {
  const { tenantId } = identity;
  const where = and(
    eq(occurrences.tenantId, tenantId),
    inArray(occurrences.status, MAP_STATUSES[query.status]),
    query.categoryId ? eq(occurrences.categoryId, query.categoryId) : undefined,
    query.days === null
      ? undefined
      : sql`${occurrences.createdAt} >= now() - make_interval(days => ${query.days})`,
    departmentScope(identity),
  );
  return withContext(db, panelDbContext(identity), async (tx) => {
    const [total] = await tx
      .select({ n: count() })
      .from(occurrences)
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .where(where);
    const rows = await tx
      .select({
        id: occurrences.id,
        location: occurrences.location,
        categoryId: categories.id,
        categoryName: categories.name,
        icon: categories.icon,
        iconGroup: categories.iconGroup,
        status: occurrences.status,
        requestCount: requestCountSql(),
        statusSince: statusSinceSql(),
      })
      .from(occurrences)
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .where(where)
      .orderBy(desc(occurrences.createdAt), asc(occurrences.id))
      .limit(MAP_POINTS_LIMIT);
    return {
      total: total!.n,
      items: rows.map((row) => ({
        ...row,
        location: toGeoPoint(row.location),
        statusSince: row.statusSince.toISOString(),
      })),
    };
  });
}

/** Escapa `%`, `_` e `\` para o texto valer literalmente no ILIKE. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Regra de texto da busca: com formato de protocolo, pelo começo do protocolo; senão, com pelo
 * menos 3 caracteres, no endereço da solicitação (`requests`, sem apelido). Undefined quando o
 * texto é curto demais.
 */
export function searchCondition(rawQuery: string): SQL | undefined {
  const q = rawQuery.trim();
  if (PROTOCOL_QUERY.test(q)) return sql`${requests.protocol} like ${`${q}%`}`;
  if (q.length >= SEARCH_MIN_LENGTH) return ilike(requests.address, `%${escapeLike(q)}%`);
  return undefined;
}

/**
 * Busca do mapa: com formato de protocolo, pelo começo do protocolo; senão, com pelo menos 3
 * caracteres, no endereço das solicitações. Uma linha por ocorrência (a solicitação mais antiga
 * que casou), só ocorrências não juntadas e no alcance.
 */
export async function searchOccurrences(
  db: Database,
  identity: PanelIdentity,
  rawQuery: string,
): Promise<PanelSearchResponse> {
  const match = searchCondition(rawQuery);
  if (!match) return { items: [] };

  const { tenantId } = identity;
  return withContext(db, panelDbContext(identity), async (tx) => {
    const matches = tx
      .selectDistinctOn([occurrences.id], {
        occurrenceId: sql<string>`${occurrences.id}`.as('occurrence_id'),
        protocol: sql<string>`${requests.protocol}`.as('protocol'),
        categoryName: sql<string>`${categories.name}`.as('category_name'),
        address: sql<string | null>`${requests.address}`.as('address'),
        status: sql<OccurrenceStatus>`${occurrences.status}`.as('status'),
        lat: sql<number>`ST_Y(${occurrences.location})`.mapWith(Number).as('lat'),
        lng: sql<number>`ST_X(${occurrences.location})`.mapWith(Number).as('lng'),
      })
      .from(requests)
      .innerJoin(occurrences, eq(occurrences.id, requests.occurrenceId))
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .where(
        and(
          eq(requests.tenantId, tenantId),
          ne(requests.status, 'cancelled'),
          ne(occurrences.status, 'merged'),
          match,
          departmentScope(identity),
        ),
      )
      .orderBy(occurrences.id, asc(requests.createdAt), asc(requests.id))
      .as('matches');
    const rows = await tx
      .select()
      .from(matches)
      .orderBy(
        // Em triagem e em atendimento primeiro; dentro de cada grupo, pelo protocolo.
        sql`(${matches.status} in ('triage', 'in_progress')) desc`,
        asc(matches.protocol),
      )
      .limit(PANEL_SEARCH_LIMIT);
    return {
      items: rows.map(({ lat, lng, ...row }) => ({
        ...row,
        location: { lat: Number(lat), lng: Number(lng) },
      })),
    };
  });
}

/**
 * Ocorrência no alcance de quem usa o painel, com a categoria e o setor; undefined quando não
 * existe, é de outra prefeitura (RLS), está fora do alcance ou, sem `includeMerged`, foi
 * juntada (o painel responde 404 `occurrence_not_found` nos três casos). Com `lock`, trava a
 * linha da ocorrência (`FOR UPDATE`). Deve rodar no contexto da prefeitura.
 */
export async function findScopedOccurrence(
  tx: Transaction,
  identity: PanelIdentity,
  occurrenceId: string,
  options: { lock?: boolean; includeMerged?: boolean } = {},
) {
  const query = tx
    .select({
      id: occurrences.id,
      status: occurrences.status,
      location: occurrences.location,
      categoryId: occurrences.categoryId,
      statusSince: statusSinceSql(),
      category: {
        id: categories.id,
        name: categories.name,
        icon: categories.icon,
        iconGroup: categories.iconGroup,
        clusterRadiusM: categories.clusterRadiusM,
        defaultDeadlineDays: categories.defaultDeadlineDays,
        departmentId: categories.departmentId,
        departmentName: departments.name,
      },
    })
    .from(occurrences)
    .innerJoin(categories, eq(categories.id, occurrences.categoryId))
    .innerJoin(departments, eq(departments.id, categories.departmentId))
    .where(
      and(
        eq(occurrences.tenantId, identity.tenantId),
        eq(occurrences.id, occurrenceId),
        options.includeMerged ? undefined : ne(occurrences.status, 'merged'),
        departmentScope(identity),
      ),
    );
  const [row] = options.lock ? await query.for('update', { of: occurrences }) : await query;
  if (!row) return undefined;
  return { ...row, location: toGeoPoint(row.location) };
}

export type ScopedOccurrence = NonNullable<Awaited<ReturnType<typeof findScopedOccurrence>>>;

/**
 * Painel do ponto: a ocorrência, os relatos não cancelados (mais antigos primeiro, com a
 * distância ao centro e a miniatura da primeira foto do relato), as sugestões de junção e a
 * atividade ativa. Nada que identifique cidadão. undefined fora do alcance.
 */
export async function loadOccurrenceDetail(
  db: Database,
  storage: Storage | undefined,
  identity: PanelIdentity,
  occurrenceId: string,
): Promise<OccurrenceDetail | undefined> {
  const loaded = await withContext(db, panelDbContext(identity), async (tx) => {
    const occurrence = await findScopedOccurrence(tx, identity, occurrenceId);
    if (!occurrence) return undefined;

    const reports = await tx
      .select({
        id: requests.id,
        protocol: requests.protocol,
        description: requests.description,
        address: requests.address,
        createdAt: requests.createdAt,
        distanceM: sql<number>`round(ST_Distance(
          ${requests.location}::geography,
          ${occurrences.location}::geography
        ))::int`.mapWith(Number),
        photoKey: sql<string | null>`(
          select p.storage_key
          from photos p
          where p.tenant_id = requests.tenant_id
            and p.request_id = requests.id
            and p.purpose = 'report'
          order by p.created_at, p.id
          limit 1
        )`,
      })
      .from(requests)
      .innerJoin(occurrences, eq(occurrences.id, requests.occurrenceId))
      .where(and(eq(requests.occurrenceId, occurrenceId), ne(requests.status, 'cancelled')))
      .orderBy(asc(requests.createdAt), asc(requests.id));

    // A sugestão é sempre da mesma categoria, e portanto do mesmo setor: já está no alcance.
    const suggestions = CLUSTERABLE_OCCURRENCE_STATUSES.includes(occurrence.status)
      ? await findMergeSuggestions(tx, { occurrenceId, limit: MAX_SUGGESTIONS })
      : [];

    const [activeWorkOrder] = await tx
      .select({ id: workOrders.id, status: workOrders.status, teamName: teams.name })
      .from(workOrders)
      .innerJoin(teams, eq(teams.id, workOrders.teamId))
      .where(
        and(
          eq(workOrders.occurrenceId, occurrenceId),
          inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]),
        ),
      )
      .limit(1);

    return { occurrence, reports, suggestions, activeWorkOrder: activeWorkOrder ?? null };
  });
  if (!loaded) return undefined;
  const { occurrence, reports, suggestions, activeWorkOrder } = loaded;

  return {
    id: occurrence.id,
    status: occurrence.status,
    statusSince: occurrence.statusSince.toISOString(),
    category: occurrence.category,
    address: reports[0]?.address ?? null,
    location: occurrence.location,
    requestCount: reports.length,
    requests: await Promise.all(
      reports.map(async (report) => ({
        id: report.id,
        protocol: report.protocol,
        // Sem observação: o cidadão deixou o texto em branco.
        description: report.description.trim() === '' ? null : report.description,
        createdAt: report.createdAt.toISOString(),
        distanceM: report.distanceM,
        photoUrl:
          storage && report.photoKey
            ? await storage.presignGet(report.photoKey, PHOTO_URL_SECONDS)
            : null,
      })),
    ),
    suggestions: suggestions.map((suggestion) => ({
      ...suggestion,
      description: suggestion.description?.trim() ? suggestion.description : null,
    })),
    activeWorkOrder,
  };
}

/**
 * Equipes do setor da categoria para atribuir a ocorrência: as com base primeiro, da mais
 * perto para a mais longe, depois as sem base; em cada grupo, por nome. A sugerida é a
 * primeira com base. O prazo padrão é hoje (São Paulo) mais o prazo da categoria.
 */
export async function loadTeamOptions(
  db: Database,
  identity: PanelIdentity,
  occurrenceId: string,
): Promise<TeamOptionsResponse | undefined> {
  const { tenantId } = identity;
  return withContext(db, panelDbContext(identity), async (tx) => {
    const occurrence = await findScopedOccurrence(tx, identity, occurrenceId);
    if (!occurrence) return undefined;

    const distance = sql<number | null>`round(ST_Distance(
      ${teams.baseLocation}::geography,
      ${geoPoint(occurrence.location)}::geography
    ))::int`;
    const rows = await tx
      .select({
        id: teams.id,
        name: teams.name,
        // Agente ativo: vínculo field_agent ativo na prefeitura.
        activeAgentCount: sql<number>`(
          select count(*)::int
          from team_members tm
          join memberships m
            on m.tenant_id = tm.tenant_id
            and m.user_id = tm.user_id
            and m.role = 'field_agent'
            and m.status = 'active'
          where tm.tenant_id = teams.tenant_id and tm.team_id = teams.id
        )`.mapWith(Number),
        openWorkOrderCount: sql<number>`(
          select count(*)::int
          from work_orders w
          where w.tenant_id = teams.tenant_id
            and w.team_id = teams.id
            and w.status in (${sqlList(ACTIVE_WORK_ORDER_STATUSES)})
        )`.mapWith(Number),
        baseDistanceM: distance,
      })
      .from(teams)
      .where(
        and(eq(teams.tenantId, tenantId), eq(teams.departmentId, occurrence.category.departmentId)),
      )
      .orderBy(sql`${distance} asc nulls last`, asc(teams.name), asc(teams.id));

    const items = rows.map((row) => ({
      ...row,
      baseDistanceM: row.baseDistanceM === null ? null : Number(row.baseDistanceM),
    }));
    return {
      suggestedTeamId: items.find((team) => team.baseDistanceM !== null)?.id ?? null,
      defaultDueDate: addDays(todayInSaoPaulo(), occurrence.category.defaultDeadlineDays),
      departmentName: occurrence.category.departmentName,
      items,
    };
  });
}
