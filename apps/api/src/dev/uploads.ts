import type { Database } from '@alocidadao/db';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';
import { newPhotoKey, type Storage } from '../storage/s3.js';

export function registerDevUploads(
  app: FastifyInstance,
  database: Database | undefined,
  storage: Storage | undefined,
) {
  app.post('/dev/uploads', { preHandler: requireAuth(['app']) }, async (request, reply) => {
    if (!database) return reply.code(503).send({ code: 'database_not_configured' });
    const member = await requireTenantMember(database, request, reply, ['field_agent']);
    if (!member) return reply;
    if (!storage) return reply.code(503).send({ code: 'storage_not_configured' });

    const key = newPhotoKey(member.tenantId);
    const { url, headers } = await storage.presignUpload(key);
    return { key, url, headers };
  });
}
