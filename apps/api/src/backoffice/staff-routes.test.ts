import { randomInt } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { maskEmail, staffListResponseSchema } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { users, staffAuditEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

async function backoffice(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  userId: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({ method, url, headers: await staffAuthHeader(appDb.db, userId), payload });
}

/** CPF válido aleatório (dígitos verificadores calculados). */
function randomCpf() {
  const base = Array.from({ length: 9 }, () => randomInt(0, 10));
  const digit = (nums: number[]) => {
    const sum = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join('');
}

const uniqueEmail = () => `equipe.${randomInt(1e9)}@teste.dev`;

describe('equipe interna do backoffice', () => {
  it('admin adds, edits, changes role and removes staff', async () => {
    const adminId = await fx.newStaff('admin');
    const cpf = randomCpf();
    const email = uniqueEmail();

    const created = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Nova Pessoa',
      cpf,
      email,
      platformRole: 'support',
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();

    const listed = await backoffice('GET', '/backoffice/staff', adminId);
    expect(listed.statusCode).toBe(200);
    const body = staffListResponseSchema.parse(listed.json());
    expect(body.items.find((m) => m.userId === id)).toMatchObject({
      name: 'Nova Pessoa',
      maskedCpf: `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`,
      email,
      platformRole: 'support',
    });

    const newEmail = uniqueEmail();
    const edited = await backoffice('PATCH', `/backoffice/staff/${id}`, adminId, {
      name: 'Nome Novo',
      email: newEmail,
      platformRole: 'admin',
    });
    expect(edited.statusCode).toBe(204);
    const [row] = await owner.db.select().from(users).where(eq(users.id, id));
    expect(row).toMatchObject({ name: 'Nome Novo', email: newEmail, platformRole: 'admin' });

    const removed = await backoffice('DELETE', `/backoffice/staff/${id}`, adminId);
    expect(removed.statusCode).toBe(204);
    const [after] = await owner.db.select().from(users).where(eq(users.id, id));
    expect(after!.platformRole).toBeNull();

    const actions = await owner.db
      .select({ action: staffAuditEvents.action, details: staffAuditEvents.details })
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.staffUserId, adminId));
    expect(actions.map((a) => a.action).toSorted()).toEqual([
      'staff.create',
      'staff.remove',
      'staff.role_change',
      'staff.update',
    ]);
  });

  it('support gets 403 admin_only on staff and audit', async () => {
    const supportId = await fx.newStaff('support');
    const target = await fx.newStaff('support');
    const calls: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, Record<string, unknown>?]> = [
      ['GET', '/backoffice/staff'],
      [
        'POST',
        '/backoffice/staff',
        { name: 'Fulano', cpf: randomCpf(), email: uniqueEmail(), platformRole: 'support' },
      ],
      ['PATCH', `/backoffice/staff/${target}`, { name: 'Outro Nome' }],
      ['DELETE', `/backoffice/staff/${target}`],
      ['GET', '/backoffice/audit'],
    ];
    for (const [method, url, payload] of calls) {
      const response = await backoffice(method, url, supportId, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json()).toEqual({ code: 'admin_only' });
    }
  });

  it('adding a manager to staff is 409 tenant_member_not_allowed', async () => {
    const adminId = await fx.newStaff('admin');
    const tenantId = await fx.createTenant();
    const cpf = randomCpf();
    const email = uniqueEmail();
    const manager = await fx.newManager(tenantId, [], 'Gestora');
    await owner.db.update(users).set({ cpf, email }).where(eq(users.id, manager));

    const response = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Gestora',
      cpf,
      email,
      platformRole: 'support',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'tenant_member_not_allowed' });
  });

  it('adding with another email of an existing account is 409 email_mismatch with masked email', async () => {
    const adminId = await fx.newStaff('admin');
    const cpf = randomCpf();
    const existingEmail = `existente.${randomInt(1e9)}@teste.dev`;
    const [existing] = await owner.db
      .insert(users)
      .values({ name: 'Existente', cpf, email: existingEmail })
      .returning();
    expect(existing).toBeDefined();

    const response = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Existente',
      cpf,
      email: uniqueEmail(),
      platformRole: 'support',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'email_mismatch',
      maskedEmail: maskEmail(existingEmail),
    });
  });

  it('adding someone already on staff or with an email in use is refused', async () => {
    const adminId = await fx.newStaff('admin');
    const cpf = randomCpf();
    const email = uniqueEmail();
    const first = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Primeira',
      cpf,
      email,
      platformRole: 'support',
    });
    expect(first.statusCode).toBe(201);

    const again = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Primeira',
      cpf,
      email,
      platformRole: 'support',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'already_staff' });

    const sameEmail = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Segunda',
      cpf: randomCpf(),
      email,
      platformRole: 'support',
    });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json()).toEqual({ code: 'email_in_use' });
  });

  it('adding a cpf held by a frozen account is 409 cpf_unavailable', async () => {
    const adminId = await fx.newStaff('admin');
    const cpf = randomCpf();
    await owner.db
      .insert(users)
      .values({ name: 'Congelada', cpf, accountStatus: 'frozen', email: uniqueEmail() });
    const response = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Alguém',
      cpf,
      email: uniqueEmail(),
      platformRole: 'support',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'cpf_unavailable' });
  });

  it('removing yourself is 409 self_change_not_allowed', async () => {
    const adminId = await fx.newStaff('admin');
    await fx.newStaff('admin');
    const response = await backoffice('DELETE', `/backoffice/staff/${adminId}`, adminId);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'self_change_not_allowed' });

    const role = await backoffice('PATCH', `/backoffice/staff/${adminId}`, adminId, {
      platformRole: 'support',
    });
    expect(role.statusCode).toBe(409);
    expect(role.json()).toEqual({ code: 'self_change_not_allowed' });
  });

  it('unknown staff member is 404 staff_not_found', async () => {
    const adminId = await fx.newStaff('admin');
    const citizen = await fx.createUser('Cidadão');
    const patch = await backoffice('PATCH', `/backoffice/staff/${citizen}`, adminId, {
      name: 'Nome Novo',
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual({ code: 'staff_not_found' });
    const del = await backoffice('DELETE', `/backoffice/staff/${citizen}`, adminId);
    expect(del.statusCode).toBe(404);
  });
});
