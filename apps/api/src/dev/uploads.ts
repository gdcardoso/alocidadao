import type { FastifyInstance } from 'fastify';
import { newPhotoKey, type Storage } from '../storage/s3.js';
import { requireDevIdentity } from './identity.js';

export function registerDevUploads(app: FastifyInstance, storage: Storage | undefined) {
  app.post('/dev/uploads', async (request, reply) => {
    const identity = requireDevIdentity(request, reply);
    if (!identity) return reply;
    if (!storage) return reply.code(503).send({ code: 'storage_not_configured' });

    const key = newPhotoKey(identity.tenantId);
    const { url, headers } = await storage.presignUpload(key);
    return { key, url, headers };
  });
}
