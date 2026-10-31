import { schema, withContext, type Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  citizenListQuerySchema,
  citizenListResponseSchema,
  FINAL_REQUEST_STATUSES,
  maskEmail,
  maskPhone,
  type CitizenRow,
  type CitizenSituation,
} from '@alocidadao/shared';
import { and, count, desc, eq, gte, ilike, isNull, max, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { insertStaffAudit } from '../panel/audit.js';
import { requirePlatformStaff } from './staff.js';

const { requests, tenants, users } = schema;

export const CITIZEN_PAGE_SIZE = 50;
/** Sem acesso há mais que isto, a pessoa aparece como inativa. */
const ACTIVE_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Solicitação aberta é a que ainda não chegou a um status final (concluída, cancelada, recusada). */
const finalStatuses = sql.join(
  FINAL_REQUEST_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

/** `%`, `_` e `\` da busca valem como texto no LIKE. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

function situationFilter(situation: CitizenSituation, cutoff: Date): SQL {
  const frozen = eq(users.accountStatus, 'frozen');
  if (situation === 'frozen') return frozen;
  const recent = gte(users.lastActiveAt, cutoff);
  return situation === 'active'
    ? and(ne(users.accountStatus, 'frozen'), recent)!
    : and(ne(users.accountStatus, 'frozen'), or(isNull(users.lastActiveAt), sql`not (${recent})`))!;
}

function situationOf(
  user: { accountStatus: string; lastActiveAt: Date | null },
  cutoff: Date,
): CitizenSituation {
  if (user.accountStatus === 'frozen') return 'frozen';
  return user.lastActiveAt && user.lastActiveAt >= cutoff ? 'active' : 'inactive';
}

/**
 * Aba Cidadãos da P3: quem fez ao menos uma solicitação na prefeitura (o mesmo critério da
 * contagem da P1/P3), para Admin e Suporte. Celular e e-mail saem mascarados e o CPF nunca sai.
 * A abertura da aba (página 1, sem busca nem filtro) grava `tenant.citizens_view`.
 */
export function registerCitizenRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/backoffice/tenants/:id/citizens',
    {
      preHandler,
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: citizenListQuerySchema,
        response: {
          200: citizenListResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const { q, situation, page } = request.query;
      const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * DAY_MS);

      const result = await withContext(db, { ...staff, tenantId }, async (tx) => {
        const [tenant] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        if (!tenant) return null;

        // Contas excluídas ficam de fora; a busca é só pelo nome.
        const where = and(
          eq(requests.tenantId, tenantId),
          isNull(users.deletedAt),
          q ? ilike(users.name, `%${escapeLike(q)}%`) : undefined,
          situation ? situationFilter(situation, cutoff) : undefined,
        );

        const lastRequestAt = max(requests.createdAt);
        const rows = await tx
          .select({
            id: users.id,
            name: users.name,
            phone: users.phone,
            email: users.email,
            accountStatus: users.accountStatus,
            lastActiveAt: users.lastActiveAt,
            requestCount: count(),
            openCount:
              sql<number>`count(*) filter (where ${requests.status} not in (${finalStatuses}))`.mapWith(
                Number,
              ),
            lastRequestAt: lastRequestAt.mapWith(requests.createdAt),
          })
          .from(requests)
          .innerJoin(users, eq(users.id, requests.citizenId))
          .where(where)
          .groupBy(users.id)
          .orderBy(desc(lastRequestAt), users.name, users.id)
          .limit(CITIZEN_PAGE_SIZE)
          .offset((page - 1) * CITIZEN_PAGE_SIZE);

        const [totals] = await tx
          .select({ total: sql<number>`count(distinct ${requests.citizenId})`.mapWith(Number) })
          .from(requests)
          .innerJoin(users, eq(users.id, requests.citizenId))
          .where(where);

        if (page === 1 && !q && !situation) {
          // Na mesma transação: a consulta e o registro valem juntos.
          await insertStaffAudit(
            tx,
            { ...staff, tenantId },
            { action: 'tenant.citizens_view', targetType: 'tenant', targetId: tenantId },
          );
        }
        return { rows, total: totals?.total ?? 0 };
      });
      if (!result) return reply.code(404).send({ code: 'tenant_not_found' });

      // O mascaramento acontece aqui, antes de montar a linha: CPF, celular e e-mail inteiros
      // não chegam ao schema de resposta.
      const items: CitizenRow[] = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        phoneMasked: row.phone ? maskPhone(row.phone) : null,
        emailMasked: row.email ? maskEmail(row.email) : null,
        requestCount: row.requestCount,
        openCount: row.openCount,
        lastRequestAt: new Date(row.lastRequestAt).toISOString(),
        lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
        situation: situationOf(row, cutoff),
      }));
      return { items, total: result.total, page, pageSize: CITIZEN_PAGE_SIZE };
    },
  );
}
