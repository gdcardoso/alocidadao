import { notificationKindSchema } from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notificationPushMessage } from '../push/message.js';
import type { PushSender } from '../push/types.js';

export interface PushSenders {
  android?: PushSender;
  ios?: PushSender;
  /** Quando informado, `false` diz que a plataforma só tem o sender de log. */
  configured?: { android: boolean; ios: boolean };
}

const bodySchema = z.object({
  platform: z.enum(['android', 'ios']),
  token: z.string().min(1),
  kind: notificationKindSchema,
  protocol: z.string().min(1),
});

/** Ferramenta de laboratório: sem identidade de dev, o token vem no corpo. */
export function registerDevPush(app: FastifyInstance, push: PushSenders | undefined) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .post('/dev/push', { schema: { body: bodySchema } }, async (request, reply) => {
      const { platform, token, kind, protocol } = request.body;
      const sender = push?.[platform];
      // O sender de log não entrega nada: a rota só serve com o provedor real.
      if (!sender || push?.configured?.[platform] === false) {
        return reply.code(503).send({ code: 'push_not_configured' });
      }
      return sender.send(
        token,
        notificationPushMessage(kind, protocol, {
          tenantId: 'dev',
          requestId: 'dev',
          workOrderId: 'dev',
        }),
      );
    });
}
