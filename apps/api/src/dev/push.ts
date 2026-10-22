import { requestStatusSchema } from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { statusPushMessage } from '../push/message.js';
import type { PushSender } from '../push/types.js';

export interface PushSenders {
  android?: PushSender;
  ios?: PushSender;
}

const bodySchema = z.object({
  platform: z.enum(['android', 'ios']),
  token: z.string().min(1),
  protocol: z.string().min(1),
  status: requestStatusSchema,
});

/** Ferramenta de laboratório: sem identidade de dev, o token vem no corpo. */
export function registerDevPush(app: FastifyInstance, push: PushSenders | undefined) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .post('/dev/push', { schema: { body: bodySchema } }, async (request, reply) => {
      const { platform, token, protocol, status } = request.body;
      const sender = push?.[platform];
      if (!sender) return reply.code(503).send({ code: 'push_not_configured' });
      return sender.send(token, statusPushMessage(protocol, status));
    });
}
