import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';
import type { verificationCodes } from './schema.js';

// Funções do acesso sem senha. As de login rodam antes de existir contexto de usuário:
// chamam as funções SECURITY DEFINER da migração auth_functions, que devolvem só o
// necessário. As de conta (no fim do arquivo) rodam com o usuário no contexto.

type Executor = Database | Transaction;

/** Valores do CHECK de verification_codes.purpose. */
export type CodePurpose = (typeof verificationCodes.$inferSelect)['purpose'];

export type ConsumeCodeResult =
  | { result: 'ok'; purpose: CodePurpose; target: string; userId: string | null }
  | { result: 'invalid' | 'expired' | 'locked' };

export interface PhoneLoginUser {
  id: string;
  email: string | null;
  /** Sem uso há 90 dias ou mais: o número pode ter mudado de dono. */
  stale: boolean;
  /** A conta já entrou por este aparelho. */
  knownDevice: boolean;
}

export interface PanelLoginUser {
  id: string;
  email: string | null;
  /** Papel interno ou vínculo ativo de gestor ou administrador da prefeitura. */
  hasPanelAccess: boolean;
}

export interface RefreshSession {
  sessionId: string;
  userId: string;
  audience: 'app' | 'panel';
}

/**
 * Grava o hash de um código novo, respeitando o limite de reenvio (60 s) e o de
 * 5 códigos por hora para a mesma finalidade e destino.
 */
export async function issueCode(
  db: Executor,
  input: {
    id: string;
    purpose: CodePurpose;
    target: string;
    userId: string | null;
    codeHash: string;
  },
): Promise<{ issued: boolean; retryAfterSeconds: number }> {
  const { rows } = await db.execute<{ issued: boolean; retry_after_seconds: number }>(sql`
    select * from auth_issue_code(
      ${input.id}::uuid, ${input.purpose}, ${input.target}, ${input.userId}::uuid, ${input.codeHash}
    )
  `);
  const row = rows[0]!;
  return { issued: row.issued, retryAfterSeconds: row.retry_after_seconds };
}

/**
 * Apaga um código que não chegou a ser enviado, para não contar no reenvio nem no limite
 * da hora. Id desconhecido ou código já consumido não faz nada.
 */
export async function discardCode(db: Executor, id: string): Promise<void> {
  await db.execute(sql`select auth_discard_code(${id}::uuid)`);
}

/** Confere o código. Só `ok` traz finalidade, destino e conta. */
export async function consumeCode(
  db: Executor,
  id: string,
  codeHash: string,
): Promise<ConsumeCodeResult> {
  const { rows } = await db.execute<{
    result: ConsumeCodeResult['result'];
    purpose: CodePurpose | null;
    target: string | null;
    user_id: string | null;
  }>(sql`select * from auth_consume_code(${id}::uuid, ${codeHash})`);
  const row = rows[0]!;
  if (row.result === 'ok') {
    return { result: 'ok', purpose: row.purpose!, target: row.target!, userId: row.user_id };
  }
  return { result: row.result };
}

/** Conta ativa com este telefone, ou null. */
export async function findUserByPhone(
  db: Executor,
  phone: string,
  installationId: string,
): Promise<PhoneLoginUser | null> {
  const { rows } = await db.execute<{
    id: string;
    email: string | null;
    stale: boolean;
    known_device: boolean;
  }>(sql`select * from auth_find_user_by_phone(${phone}, ${installationId}::uuid)`);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, stale: row.stale, knownDevice: row.known_device };
}

/** Conta ativa com este CPF, ou null. */
export async function findUserByCpf(db: Executor, cpf: string): Promise<PanelLoginUser | null> {
  const { rows } = await db.execute<{
    id: string;
    email: string | null;
    has_panel_access: boolean;
  }>(sql`select * from auth_find_user_by_cpf(${cpf})`);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, hasPanelAccess: row.has_panel_access };
}

/**
 * Sessão válida para o hash do token de renovação, ou null. Marca o uso da sessão,
 * renova o prazo do painel e a última atividade da conta.
 */
export async function sessionForRefresh(
  db: Executor,
  tokenHash: string,
): Promise<RefreshSession | null> {
  const { rows } = await db.execute<{
    session_id: string;
    user_id: string;
    audience: RefreshSession['audience'];
  }>(sql`select * from auth_session_for_refresh(${tokenHash})`);
  const row = rows[0];
  if (!row) return null;
  return { sessionId: row.session_id, userId: row.user_id, audience: row.audience };
}

/**
 * Renovação recusada: se o token é de uma sessão já revogada ou expirada, o aparelho dela deixa de
 * receber push. Sessão válida ou token desconhecido não mexem em nada.
 */
export async function clearPushForDeadSession(db: Executor, tokenHash: string): Promise<void> {
  await db.execute(sql`select auth_clear_push_for_dead_session(${tokenHash})`);
}

// ── Conta ──────────────────────────────────────────────────────────────────
// Rodam dentro de withContext com o usuário: as funções da migração account_functions
// agem sobre app_current_user() e recusam a chamada sem usuário no contexto.

/**
 * Troca o telefone da própria conta, depois de a API conferir o código enviado ao número
 * novo. Número de outra conta ativa falha com 23505.
 */
export async function changePhone(tx: Transaction, phone: string): Promise<void> {
  await tx.execute(sql`select account_change_phone(${phone})`);
}

/**
 * Exclui a própria conta: apaga nome, telefone, e-mail e CPF, congela, revoga as sessões,
 * apaga os aparelhos e desativa os vínculos. As solicitações continuam com a prefeitura.
 */
export async function deleteAccount(tx: Transaction): Promise<void> {
  await tx.execute(sql`select account_delete()`);
}

/**
 * Número reaproveitado: congela a conta antiga, se ainda ativa com esse telefone e parada
 * há 90 dias, e revoga as sessões dela. O contexto precisa ser de outra conta: a nova, no
 * cadastro, ou a que está trocando de número. Devolve se congelou.
 */
export async function freezeStaleAccount(
  tx: Transaction,
  userId: string,
  phone: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ frozen: boolean }>(
    sql`select auth_freeze_stale_account(${userId}::uuid, ${phone}) as frozen`,
  );
  return rows[0]!.frozen;
}

/** Os vínculos `invited` da própria conta passam a `active`. */
export async function activateInvitations(tx: Transaction): Promise<void> {
  await tx.execute(sql`select account_activate_invitations()`);
}
