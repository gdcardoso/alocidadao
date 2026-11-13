import { isValidCpf } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { users } from './schema.js';

/**
 * Cria o admin da plataforma (platform_role 'admin') pelo CPF, ou promove a conta que já existe
 * com esse CPF (atualiza o nome). O CPF vem só com os 11 dígitos e precisa ser válido; o e-mail
 * é gravado em minúsculas. Roda com o dono do banco (ignora RLS), numa transação.
 */
export async function ensurePlatformAdmin(
  db: Database,
  values: { cpf: string; email: string; name: string },
): Promise<{ id: string; created: boolean }> {
  if (!isValidCpf(values.cpf)) {
    throw new Error('CPF inválido: informe os 11 dígitos, sem pontuação.');
  }
  const email = values.email.trim().toLowerCase();
  const name = values.name.trim();

  return db.transaction(async (tx) => {
    const [found] = await tx.select({ id: users.id }).from(users).where(eq(users.cpf, values.cpf));
    if (found) {
      await tx.update(users).set({ name, platformRole: 'admin' }).where(eq(users.id, found.id));
      return { id: found.id, created: false };
    }
    const [created] = await tx
      .insert(users)
      .values({ cpf: values.cpf, email, name, platformRole: 'admin' })
      .returning({ id: users.id });
    return { id: created!.id, created: true };
  });
}
