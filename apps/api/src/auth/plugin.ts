import { withContext, type Database } from '@alocidadao/db';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessClaims, type SessionAudience } from './tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Segredo dos tokens; definido por registerAuth quando o login está configurado. */
    authSecret: string | null;
    /** Banco do portão dos termos; nulo com o portão desligado. */
    termsGateDb: Database | null;
  }
  interface FastifyRequest {
    /** Quem fez a chamada; preenchido por requireAuth. */
    auth: AccessClaims | null;
  }
}

/**
 * Decora a aplicação para requireAuth. Chamar uma vez, na raiz. Com `termsGateDb`, o portão dos
 * termos fica ligado: conta ativa sem aceite recebe 403 { code: 'terms_required' }.
 */
export function registerAuth(
  app: FastifyInstance,
  secret: string | undefined,
  options: { termsGateDb?: Database } = {},
): void {
  app.decorate('authSecret', secret ?? null);
  app.decorate('termsGateDb', options.termsGateDb ?? null);
  app.decorateRequest('auth', null);
}

/**
 * A conta está ativa e nunca aceitou os termos. Conta congelada ou excluída não conta como
 * "sem aceite": quem monta o contexto continua respondendo por ela, como antes do portão.
 */
async function missingTerms(db: Database, userId: string): Promise<boolean> {
  const { rows } = await withContext(db, { userId }, (tx) =>
    tx.execute<{ missing: boolean }>(sql`
      select terms_version is null as missing
      from users
      where id = ${userId} and account_status = 'active' and deleted_at is null
    `),
  );
  return rows[0]?.missing === true;
}

/**
 * preHandler que exige token de acesso válido de uma das audiências. Grava request.auth;
 * sem token, ou com token inválido ou de outra audiência, responde 401 { code: 'unauthorized' }.
 * O token não consulta o banco: conta congelada e vínculo desativado são conferidos por
 * quem monta o contexto. Com o portão dos termos ligado, conta sem aceite recebe
 * 403 { code: 'terms_required' }, menos nas rotas com `allowWithoutTerms`.
 */
export function requireAuth(
  audiences: readonly SessionAudience[],
  options: { allowWithoutTerms?: boolean } = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.server.authSecret;
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const claims = secret && token ? await verifyAccessToken(secret, token) : null;
    if (!claims || !audiences.includes(claims.audience)) {
      return reply.code(401).send({ code: 'unauthorized' });
    }
    request.auth = claims;
    const gateDb = request.server.termsGateDb;
    if (gateDb && !options.allowWithoutTerms && (await missingTerms(gateDb, claims.userId))) {
      return reply.code(403).send({ code: 'terms_required' });
    }
  };
}
