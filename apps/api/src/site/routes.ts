import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import { apiErrorSchema, siteContactSchema, type SiteContact } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePlatformStaff } from '../backoffice/staff.js';
import { insertStaffAudit } from '../panel/audit.js';

const { siteContact } = schema;

// Opção por rota do @fastify/cors (`config.cors`), que o pacote não declara nos tipos.
declare module 'fastify' {
  interface FastifyContextConfig {
    cors?: false | { origin?: string };
  }
}

/**
 * Resposta: o que está gravado, sem a transformação do e-mail do `siteContactSchema` (o
 * serializador do Zod 4 recusa transformação de mão única).
 */
const siteContactResponseSchema = z.object({
  whatsapp: z.string(),
  email: z.string(),
  responseNote: z.string(),
});

/** Id da linha única (a tabela só aceita 1). */
const ROW_ID = 1;

const contactColumns = {
  whatsapp: siteContact.whatsapp,
  email: siteContact.email,
  responseNote: siteContact.responseNote,
};

/** Lê a linha única do contato. A migração a cria e app_user não apaga: sempre existe. */
async function readContact(tx: Transaction): Promise<SiteContact> {
  const [row] = await tx.select(contactColumns).from(siteContact).where(eq(siteContact.id, ROW_ID));
  if (!row) throw new Error('site_contact sem a linha inicial');
  return row;
}

/**
 * `GET /public/site-contact`: contato da página de apresentação, sem login. Só esta rota responde
 * `Access-Control-Allow-Origin: *` (a página fica em outro domínio); as outras seguem `corsOrigin`.
 */
export function registerPublicSiteRoutes(instance: FastifyInstance, { db }: { db: Database }) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/public/site-contact',
    {
      // Lida pelo @fastify/cors por rota: troca a origem global só aqui.
      config: { cors: { origin: '*' } },
      schema: { response: { 200: siteContactResponseSchema } },
    },
    // Sem contexto: a política de leitura de site_contact é USING (true).
    async () => withContext(db, {}, readContact),
  );
}

const adminErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

/** `GET` e `PUT /backoffice/site-contact`: só o Admin da equipe interna, como a P6. */
export function registerBackofficeSiteRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/backoffice/site-contact',
    { preHandler, schema: { response: { 200: siteContactResponseSchema, ...adminErrors } } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      return withContext(db, staff, readContact);
    },
  );

  app.put(
    '/backoffice/site-contact',
    {
      preHandler,
      schema: {
        body: siteContactSchema,
        response: { 200: siteContactResponseSchema, ...adminErrors },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const { whatsapp, email, responseNote } = request.body;
      // Alteração e auditoria na mesma transação: uma não entra sem a outra.
      return withContext(db, staff, async (tx) => {
        const [row] = await tx
          .update(siteContact)
          .set({ whatsapp, email, responseNote, updatedAt: sql`now()`, updatedBy: staff.userId })
          .where(eq(siteContact.id, ROW_ID))
          .returning(contactColumns);
        if (!row) throw new Error('site_contact sem a linha inicial');
        await insertStaffAudit(
          tx,
          { tenantId: null, ...staff },
          { action: 'site.contact_update', targetType: 'site_contact', targetId: null },
        );
        return row;
      });
    },
  );
}
