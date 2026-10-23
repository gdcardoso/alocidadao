import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';
import type { verificationCodes } from './schema.js';

// Funções do acesso sem senha. Rodam antes de existir contexto de usuário: chamam as
// funções SECURITY DEFINER da migração auth_functions, que devolvem só o necessário.

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
