import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';
import type { devices, notificationOutbox } from './schema.js';

// Fila de avisos (push e e-mail), tokens dos aparelhos e tarefas do agendador. A API conecta como
// app_user, que não lê a fila nem os aparelhos de outras pessoas: tudo passa pelas funções
// SECURITY DEFINER da migração notification_functions.

type Executor = Database | Transaction;

export type NotificationChannel = (typeof notificationOutbox.$inferSelect)['channel'];
export type DevicePlatform = (typeof devices.$inferSelect)['platform'];

export interface PushTarget {
  platform: DevicePlatform;
  token: string;
}

/** Linha pega da fila, já travada por 10 minutos para quem a pegou. */
export interface ClaimedNotification {
  id: string;
  channel: NotificationChannel;
  kind: string;
  protocol: string;
  tenantId: string;
  requestId: string | null;
  workOrderId: string | null;
  details: Record<string, unknown> | null;
  /** Tentativas contando esta. */
  attempts: number;
  /** Tokens distintos dos aparelhos da pessoa (vazio se nenhum aparelho tem token). */
  pushTokens: PushTarget[];
  email: string | null;
}

/** Resultado do envio: final (`sent`, `skipped`, `failed`) ou nova tentativa mais tarde. */
export type NotificationResult =
  | { status: 'sent' | 'skipped' | 'failed'; error?: string | null }
  | { status: 'retry'; retryInSeconds: number; error?: string | null };

/**
 * Pega até `limit` linhas pendentes vencidas (`FOR UPDATE SKIP LOCKED`: duas instâncias nunca pegam
 * a mesma). Avisos de conta congelada ou excluída vão a `skipped` e não voltam.
 */
export async function claimNotifications(
  db: Executor,
  limit: number,
): Promise<ClaimedNotification[]> {
  const { rows } = await db.execute<{
    id: string;
    channel: NotificationChannel;
    kind: string;
    protocol: string;
    tenant_id: string;
    request_id: string | null;
    work_order_id: string | null;
    details: Record<string, unknown> | null;
    attempts: number;
    push_tokens: PushTarget[];
    email: string | null;
  }>(sql`select * from notification_claim_batch(${limit}::int)`);
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    kind: row.kind,
    protocol: row.protocol,
    tenantId: row.tenant_id,
    requestId: row.request_id,
    workOrderId: row.work_order_id,
    details: row.details,
    attempts: row.attempts,
    pushTokens: row.push_tokens,
    email: row.email,
  }));
}

/** Grava o resultado do envio de uma linha pega; linha já finalizada fica como está. */
export async function finishNotification(
  db: Executor,
  id: string,
  result: NotificationResult,
): Promise<void> {
  const status = result.status === 'retry' ? 'pending' : result.status;
  const retryInSeconds = result.status === 'retry' ? result.retryInSeconds : null;
  await db.execute(sql`
    select notification_finish(
      ${id}::uuid, ${status}, ${retryInSeconds}::int, ${result.error ?? null}
    )
  `);
}

/** Token recusado pelo provedor (inválido ou desinstalado): sai de todos os aparelhos. */
export async function clearPushToken(db: Executor, token: string): Promise<void> {
  await db.execute(sql`select device_clear_push_token(${token})`);
}

/**
 * Tira o token de qualquer aparelho (de outra conta ou de outro aparelho da mesma conta), antes de
 * gravá-lo no aparelho atual na mesma transação. Exige a pessoa no contexto.
 */
export async function claimPushToken(tx: Transaction, token: string): Promise<void> {
  await tx.execute(sql`select device_claim_push_token(${token})`);
}

/** Confirma as solicitações sem resposta do cidadão no prazo; devolve quantas confirmou. */
export async function autoConfirmRequests(db: Executor): Promise<number> {
  const { rows } = await db.execute<{ confirmed: number }>(
    sql`select auto_confirm_requests() as confirmed`,
  );
  return rows[0]!.confirmed;
}

/** Apaga avisos do sino com mais de 90 dias e linhas finalizadas da fila com mais de 30 dias. */
export async function cleanupNotifications(db: Executor): Promise<void> {
  await db.execute(sql`select notification_cleanup()`);
}
