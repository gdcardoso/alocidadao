import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessClaims, type SessionAudience } from './tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Segredo dos tokens; definido por registerAuth quando o login está configurado. */
    authSecret: string | null;
  }
  interface FastifyRequest {
    /** Quem fez a chamada; preenchido por requireAuth. */
    auth: AccessClaims | null;
  }
}

/** Decora a aplicação para requireAuth. Chamar uma vez, na raiz. */
export function registerAuth(app: FastifyInstance, secret: string | undefined): void {
  app.decorate('authSecret', secret ?? null);
  app.decorateRequest('auth', null);
}

/**
 * preHandler que exige token de acesso válido de uma das audiências. Grava request.auth;
 * sem token, ou com token inválido ou de outra audiência, responde 401 { code: 'unauthorized' }.
 * O token não consulta o banco: conta congelada e vínculo desativado são conferidos por
 * quem monta o contexto.
 */
export function requireAuth(audiences: readonly SessionAudience[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.server.authSecret;
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const claims = secret && token ? await verifyAccessToken(secret, token) : null;
    if (!claims || !audiences.includes(claims.audience)) {
      return reply.code(401).send({ code: 'unauthorized' });
    }
    request.auth = claims;
  };
}
