import { schema, withContext, type Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  maskCpf,
  maskEmail,
  staffCreateBodySchema,
  staffCreateResponseSchema,
  staffListResponseSchema,
  staffUpdateBodySchema,
  type StaffCreateBody,
} from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  isPgError,
  isUniqueViolation,
  USER_CPF_CONSTRAINT,
  USER_EMAIL_CONSTRAINT,
  violatedConstraint,
} from '../db-errors.js';
import { requirePlatformStaff } from './staff.js';

const { users } = schema;

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

const refusalSchema = z.object({ code: z.string(), maskedEmail: z.string().optional() });

const userParamsSchema = z.object({ userId: z.uuid() });

/** Recusas do banco (check_violation com a mensagem como código) que a API repassa como 409. */
const CHECK_REFUSALS = [
  'already_staff',
  'tenant_member_not_allowed',
  'email_mismatch',
  'self_change_not_allowed',
  'last_platform_admin',
] as const;

/** Traduz o erro do banco em recusa 409/404; undefined se não for um dos conhecidos. */
function translateStaffError(error: unknown): { status: 404 | 409; code: string } | undefined {
  for (const code of CHECK_REFUSALS) {
    if (isPgError(error, '23514', code)) return { status: 409, code };
  }
  if (isPgError(error, 'P0002')) return { status: 404, code: 'staff_not_found' };
  if (isUniqueViolation(error)) {
    switch (violatedConstraint(error)) {
      case USER_EMAIL_CONSTRAINT:
        return { status: 409, code: 'email_in_use' };
      case USER_CPF_CONSTRAINT:
        return { status: 409, code: 'cpf_unavailable' };
    }
  }
  return undefined;
}

type StaffDbRow = {
  user_id: string;
  name: string;
  cpf: string | null;
  email: string | null;
  platform_role: 'admin' | 'support';
  last_active_at: Date | string | null;
};

/** Rotas da P6 (Equipe Alô Cidadão): só o Admin. Cada função do banco grava a própria auditoria. */
export function registerStaffRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/backoffice/staff',
    { preHandler, schema: { response: { 200: staffListResponseSchema, ...staffErrors } } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const { rows } = await withContext(db, staff, (tx) =>
        tx.execute<StaffDbRow>(sql`select * from platform_staff_list()`),
      );
      return {
        items: rows.map((row) => ({
          userId: row.user_id,
          name: row.name,
          maskedCpf: row.cpf ? maskCpf(row.cpf) : '',
          email: row.email ?? '',
          platformRole: row.platform_role,
          lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : null,
        })),
      };
    },
  );

  /** E-mail já gravado na conta do CPF (a função do banco não o devolve), mascarado. */
  const maskedEmailOf = async (staff: { userId: string }, body: StaffCreateBody) => {
    const [account] = await withContext(db, staff, (tx) =>
      tx.select({ email: users.email }).from(users).where(eq(users.cpf, body.cpf)),
    );
    return account?.email ? maskEmail(account.email) : undefined;
  };

  app.post(
    '/backoffice/staff',
    {
      preHandler,
      schema: {
        body: staffCreateBodySchema,
        response: { 201: staffCreateResponseSchema, ...staffErrors, 409: refusalSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const body = request.body;
      try {
        const { rows } = await withContext(db, staff, (tx) =>
          tx.execute<{ id: string }>(
            sql`select platform_staff_add(${body.name}, ${body.cpf}, ${body.email}, ${body.platformRole}::platform_role) as id`,
          ),
        );
        return reply.code(201).send({ id: rows[0]!.id });
      } catch (error) {
        const refusal = translateStaffError(error);
        if (!refusal || refusal.status !== 409) throw error;
        if (refusal.code === 'email_mismatch') {
          return reply
            .code(409)
            .send({ code: refusal.code, maskedEmail: await maskedEmailOf(staff, body) });
        }
        return reply.code(409).send({ code: refusal.code });
      }
    },
  );

  app.patch(
    '/backoffice/staff/:userId',
    {
      preHandler,
      schema: {
        params: userParamsSchema,
        body: staffUpdateBodySchema,
        response: { 204: z.null(), ...staffErrors, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const { userId } = request.params;
      const { name, email, platformRole } = request.body;
      try {
        // Uma transação só: nome/e-mail e papel entram juntos ou nenhum entra.
        await withContext(db, staff, async (tx) => {
          if (name !== undefined || email !== undefined) {
            // A função troca os dois campos; o que não veio mantém o valor atual.
            await tx.execute(sql`
              select platform_staff_update(
                ${userId}::uuid,
                coalesce(${name ?? null}, (select u.name from users u where u.id = ${userId}::uuid)),
                coalesce(${email ?? null}, (select u.email from users u where u.id = ${userId}::uuid))
              )
            `);
          }
          if (platformRole !== undefined) {
            await tx.execute(
              sql`select platform_staff_set_role(${userId}::uuid, ${platformRole}::platform_role)`,
            );
          }
        });
      } catch (error) {
        const refusal = translateStaffError(error);
        if (!refusal) throw error;
        return reply.code(refusal.status).send({ code: refusal.code });
      }
      return reply.code(204).send(null);
    },
  );

  app.delete(
    '/backoffice/staff/:userId',
    {
      preHandler,
      schema: {
        params: userParamsSchema,
        response: { 204: z.null(), ...staffErrors, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const { userId } = request.params;
      try {
        await withContext(db, staff, (tx) =>
          tx.execute(sql`select platform_staff_remove(${userId}::uuid)`),
        );
      } catch (error) {
        const refusal = translateStaffError(error);
        if (!refusal) throw error;
        return reply.code(refusal.status).send({ code: refusal.code });
      }
      return reply.code(204).send(null);
    },
  );
}
