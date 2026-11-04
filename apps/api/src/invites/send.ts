import { withContext, type Database, type DbContext } from '@alocidadao/db';
import { INVITE_RESEND_SECONDS, maskEmail, type PlatformRole } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailMessage, EmailSender } from '../messaging/email.js';
import {
  agentInviteEmail,
  panelInviteEmail,
  staffInviteEmail,
  type InviteLinks,
} from '../messaging/invites.js';

export type InviteDeps = {
  db: Database;
  email: EmailSender;
  links: InviteLinks;
  log: FastifyBaseLogger;
};

/** Quem recebe o convite e o que vai no e-mail. */
export type InviteTarget =
  | {
      kind: 'panel';
      userId: string;
      tenantId: string;
      to: string;
      name: string;
      tenantName: string;
      role: 'tenant_admin' | 'manager';
    }
  | {
      kind: 'agent';
      userId: string;
      tenantId: string;
      to: string;
      name: string;
      tenantName: string;
      teamName: string;
      phone: string;
    }
  | { kind: 'staff'; userId: string; to: string; name: string; platformRole: PlatformRole };

function inviteMessage(target: InviteTarget, links: InviteLinks): EmailMessage {
  switch (target.kind) {
    case 'panel':
      return panelInviteEmail({ ...target, links });
    case 'agent':
      return agentInviteEmail({ ...target, links });
    case 'staff':
      return staffInviteEmail({ ...target, links });
  }
}

/**
 * Grava a entrega (invite_record, no contexto de quem pediu) e envia, na mesma transação: se o
 * envio falha, a entrega não fica registrada. Devolve os segundos que faltam quando o intervalo
 * mínimo ainda não passou (nada é enviado).
 */
async function recordAndSend(
  deps: InviteDeps,
  ctx: DbContext,
  target: InviteTarget,
  minIntervalSeconds: number,
): Promise<number> {
  const tenantId = target.kind === 'staff' ? null : target.tenantId;
  return withContext(deps.db, ctx, async (tx) => {
    const { rows } = await tx.execute<{ wait: number }>(
      sql`select invite_record(${target.userId}::uuid, ${tenantId}::uuid, ${target.kind}::invite_kind, ${minIntervalSeconds}::int) as wait`,
    );
    const wait = Number(rows[0]!.wait);
    if (wait > 0) return wait;
    await deps.email.send(inviteMessage(target, deps.links));
    return 0;
  });
}

/**
 * Envio automático (cadastro e ativação): grava a entrega sem intervalo mínimo e envia. Nunca
 * lança: a falha vai para o log (`warn`) e o cadastro segue; o caminho é "Reenviar convite".
 * Chamar depois do commit do cadastro.
 */
export async function sendInvite(
  deps: InviteDeps,
  ctx: DbContext,
  target: InviteTarget,
): Promise<void> {
  try {
    await recordAndSend(deps, ctx, target, 0);
  } catch (error) {
    deps.log.warn(
      { err: error, kind: target.kind, userId: target.userId },
      'Falha ao enviar o convite',
    );
  }
}

/**
 * Reenvio pedido na tela: respeita INVITE_RESEND_SECONDS e devolve o e-mail mascarado, ou os
 * segundos que faltam. A conta e o vínculo já foram conferidos por quem montou o `target`. Falha
 * no envio lança (a entrega não fica registrada e o reenvio pode ser tentado de novo).
 */
export async function resendInvite(
  deps: InviteDeps,
  ctx: DbContext,
  target: InviteTarget,
): Promise<{ maskedEmail: string } | { retryAfterSeconds: number }> {
  const wait = await recordAndSend(deps, ctx, target, INVITE_RESEND_SECONDS);
  if (wait > 0) return { retryAfterSeconds: wait };
  return { maskedEmail: maskEmail(target.to) };
}
