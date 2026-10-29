import {
  claimNotifications,
  clearPushToken,
  finishNotification,
  type ClaimedNotification,
  type Database,
  type NotificationResult,
} from '@alocidadao/db';
import {
  AGENT_PUSH_KINDS,
  CITIZEN_PUSH_KINDS,
  notificationKindSchema,
  type NotificationKind,
} from '@alocidadao/shared';
import { completionEmailMessage, type EmailSender } from '../messaging/email.js';
import { notificationPushMessage } from '../push/message.js';
import type { PushSender } from '../push/types.js';

export interface NotificationLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface DispatchDeps {
  /** Banco como app_user: a fila e os tokens só pelas funções SECURITY DEFINER. */
  db: Database;
  push: { android: PushSender; ios: PushSender };
  email: EmailSender;
  log: NotificationLog;
}

/** Lote padrão por rodada do agendador. */
export const DISPATCH_BATCH = 50;
/** Linhas processadas ao mesmo tempo, para não ocupar o pool das requisições. */
export const DISPATCH_CONCURRENCY = 5;

/** Espera antes da tentativa seguinte, pela tentativa que falhou (1ª, 2ª, 3ª e 4ª). */
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200];

/** Na 5ª tentativa sem sucesso a linha vai a `failed`. */
const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

const citizenKinds: readonly NotificationKind[] = CITIZEN_PUSH_KINDS;
const agentKinds: readonly NotificationKind[] = AGENT_PUSH_KINDS;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Falha temporária: reagenda pela espera da tentativa ou desiste depois da última. */
function retryOrFail(attempts: number, error: string): NotificationResult {
  if (attempts >= MAX_ATTEMPTS) return { status: 'failed', error };
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_SECONDS.length) - 1;
  return { status: 'retry', retryInSeconds: RETRY_DELAYS_SECONDS[index]!, error };
}

async function sendPush(
  deps: DispatchDeps,
  row: ClaimedNotification,
  kind: NotificationKind,
): Promise<NotificationResult> {
  // Dados escondidos: a solicitação para o cidadão, a atividade para o agente.
  let target: { requestId: string } | { workOrderId: string };
  if (citizenKinds.includes(kind) && row.requestId) target = { requestId: row.requestId };
  else if (agentKinds.includes(kind) && row.workOrderId) target = { workOrderId: row.workOrderId };
  else return { status: 'failed', error: 'not_a_push_kind' };

  // Um envio por token, mesmo que o token apareça em mais de um registro.
  const targets = [...new Map(row.pushTokens.map((t) => [t.token, t])).values()];
  if (targets.length === 0) return { status: 'skipped', error: 'no_device' };

  const withPhotos = row.details?.withPhotos;
  const message = notificationPushMessage(
    kind,
    row.protocol,
    { tenantId: row.tenantId, ...target },
    typeof withPhotos === 'boolean' ? { withPhotos } : undefined,
  );

  let delivered = 0;
  const retries: string[] = [];
  for (const { platform, token } of targets) {
    try {
      const result = await deps.push[platform].send(token, message);
      if (result.kind === 'sent') delivered++;
      else if (result.kind === 'invalid_token') await clearPushToken(deps.db, token);
      else retries.push(`${platform}: ${result.reason}`);
    } catch (error) {
      deps.log.error(
        { notificationId: row.id, platform, kind, error: errorText(error) },
        'Falha no envio do push',
      );
      retries.push(`${platform}: ${errorText(error)}`);
    }
  }

  // Algum aparelho recebeu: a linha está enviada (nova tentativa reenviaria a quem já recebeu);
  // as falhas dos outros ficam só no registro.
  if (delivered > 0)
    return { status: 'sent', error: retries.length > 0 ? retries.join('; ') : null };
  if (retries.length > 0) return retryOrFail(row.attempts, retries.join('; '));
  return { status: 'skipped', error: 'invalid_token' };
}

async function sendEmail(
  deps: DispatchDeps,
  row: ClaimedNotification,
  kind: NotificationKind,
): Promise<NotificationResult> {
  // Só a conclusão vai por e-mail.
  if (kind !== 'request_awaiting_confirmation') {
    return { status: 'failed', error: 'not_an_email_kind' };
  }
  if (!row.email) return { status: 'skipped', error: 'no_email' };
  try {
    await deps.email.send(completionEmailMessage(row.email, row.protocol));
    return { status: 'sent' };
  } catch (error) {
    deps.log.error(
      { notificationId: row.id, kind, error: errorText(error) },
      'Falha no envio do e-mail',
    );
    return retryOrFail(row.attempts, errorText(error));
  }
}

async function deliver(deps: DispatchDeps, row: ClaimedNotification): Promise<NotificationResult> {
  const parsed = notificationKindSchema.safeParse(row.kind);
  if (!parsed.success) return { status: 'failed', error: 'unknown_kind' };
  return row.channel === 'email'
    ? sendEmail(deps, row, parsed.data)
    : sendPush(deps, row, parsed.data);
}

async function processRow(deps: DispatchDeps, row: ClaimedNotification): Promise<void> {
  let result: NotificationResult;
  try {
    result = await deliver(deps, row);
  } catch (error) {
    deps.log.error(
      { notificationId: row.id, kind: row.kind, error: errorText(error) },
      'Falha no envio do aviso',
    );
    result = retryOrFail(row.attempts, errorText(error));
  }
  try {
    await finishNotification(deps.db, row.id, result);
  } catch (error) {
    deps.log.error(
      { notificationId: row.id, error: errorText(error) },
      'Falha ao gravar o resultado do aviso',
    );
  }
}

/**
 * Pega um lote da fila, envia cada linha e grava o resultado. Uma linha com erro não para as
 * outras; se nem o resultado for gravado, a linha volta sozinha quando a trava da pegada vence.
 * Devolve quantas linhas pegou.
 */
export async function dispatchNotifications(
  deps: DispatchDeps,
  limit = DISPATCH_BATCH,
): Promise<number> {
  const rows = await claimNotifications(deps.db, limit);
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) await processRow(deps, row);
  };
  await Promise.all(Array.from({ length: Math.min(DISPATCH_CONCURRENCY, rows.length) }, worker));
  return rows.length;
}
