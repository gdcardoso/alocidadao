import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export interface DevIdentity {
  userId: string;
  tenantId: string;
}

const identitySchema = z.object({
  'x-dev-user-id': z.uuid(),
  'x-dev-tenant-id': z.uuid(),
});

/**
 * Identidade provisória (ainda não há login): lê x-dev-user-id e x-dev-tenant-id.
 * Se faltar ou não for UUID, responde 401 { code: 'dev_identity_required' } e devolve undefined;
 * quem chamou deve apenas retornar `reply`.
 */
export function requireDevIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
): DevIdentity | undefined {
  const parsed = identitySchema.safeParse(request.headers);
  if (!parsed.success) {
    void reply.code(401).send({ code: 'dev_identity_required' });
    return undefined;
  }
  return { userId: parsed.data['x-dev-user-id'], tenantId: parsed.data['x-dev-tenant-id'] };
}
