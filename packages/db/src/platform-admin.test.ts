import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { ensurePlatformAdmin } from './platform-admin.js';
import { users } from './schema.js';
import { TEST_OWNER_URL } from './test/urls.js';

// CPFs válidos usados só aqui (não use os do seed: no CI o banco de teste tem as contas demo,
// e apagar um gestor do seed esbarra em department_managers). O dono do banco cria e limpa.
const CPF = '73194826573';
const OTHER_CPF = '84620517380';

const { db: owner, pool } = createDatabase(TEST_OWNER_URL);

async function clean() {
  await owner.delete(users).where(eq(users.cpf, CPF));
  await owner.delete(users).where(eq(users.cpf, OTHER_CPF));
}

afterAll(async () => {
  await clean();
  await pool.end();
});

describe('ensurePlatformAdmin', () => {
  it('cria a conta com platform_role admin', async () => {
    await clean();
    const result = await ensurePlatformAdmin(owner, {
      cpf: CPF,
      email: 'Admin.Real@Example.COM',
      name: 'Admin Real',
    });
    expect(result.created).toBe(true);
    const [row] = await owner.select().from(users).where(eq(users.id, result.id));
    expect(row?.platformRole).toBe('admin');
    expect(row?.email).toBe('admin.real@example.com');
    expect(row?.cpf).toBe(CPF);
  });

  it('repetir com o mesmo CPF não duplica e promove a admin', async () => {
    await clean();
    const [citizen] = await owner
      .insert(users)
      .values({ cpf: CPF, email: 'antigo@example.com', name: 'Antigo' })
      .returning();
    const result = await ensurePlatformAdmin(owner, {
      cpf: CPF,
      email: 'novo@example.com',
      name: 'Novo Nome',
    });
    expect(result).toEqual({ id: citizen!.id, created: false });
    const again = await ensurePlatformAdmin(owner, {
      cpf: CPF,
      email: 'novo@example.com',
      name: 'Novo Nome',
    });
    expect(again).toEqual({ id: citizen!.id, created: false });
    const rows = await owner.select().from(users).where(eq(users.cpf, CPF));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platformRole).toBe('admin');
    expect(rows[0]?.email).toBe('novo@example.com');
  });

  it('recusa e-mail que já é de outra conta, sem alterar nada', async () => {
    await clean();
    await owner
      .insert(users)
      .values({ cpf: OTHER_CPF, email: 'ocupado@example.com', name: 'Outra' });
    const [mine] = await owner
      .insert(users)
      .values({ cpf: CPF, email: 'meu@example.com', name: 'Minha' })
      .returning();
    await expect(
      ensurePlatformAdmin(owner, { cpf: CPF, email: 'Ocupado@example.com', name: 'X' }),
    ).rejects.toThrow(/já pertence a outra conta/);
    const [after] = await owner.select().from(users).where(eq(users.id, mine!.id));
    expect(after?.email).toBe('meu@example.com');
    expect(after?.platformRole).not.toBe('admin');
    // CPF novo com e-mail de outra conta também é recusado, sem criar a conta.
    await owner.delete(users).where(eq(users.cpf, CPF));
    await expect(
      ensurePlatformAdmin(owner, { cpf: CPF, email: 'ocupado@example.com', name: 'X' }),
    ).rejects.toThrow(/já pertence a outra conta/);
    expect(await owner.select().from(users).where(eq(users.cpf, CPF))).toHaveLength(0);
  });

  it('recusa CPF com pontuação ou inválido antes de gravar', async () => {
    await clean();
    for (const cpf of ['111.444.777-35', '11144477736', '123']) {
      await expect(
        ensurePlatformAdmin(owner, { cpf, email: 'x@example.com', name: 'X' }),
      ).rejects.toThrow(/CPF/);
    }
    expect(await owner.select().from(users).where(eq(users.cpf, CPF))).toHaveLength(0);
  });
});
