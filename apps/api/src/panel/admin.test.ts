import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import {
  categoriesResponseSchema,
  categoryRowSchema,
  departmentRowSchema,
  managerRowSchema,
  managersResponseSchema,
  type LocateResponse,
} from '@alocidadao/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { categories, departmentManagers, memberships, teams, users } = schema;

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

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  userId: string,
  tenantId: string,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    headers: await panelAuthHeader(appDb.db, userId, tenantId),
    ...(payload ? { payload } : {}),
  });
}

/** CPF válido e aleatório (dígitos verificadores calculados). */
function newCpf(): string {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  const check = (length: number) => {
    const sum = digits.slice(0, length).reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(check(9));
  digits.push(check(10));
  const cpf = digits.join('');
  return /^(.)\1{10}$/.test(cpf) ? newCpf() : cpf;
}

const newEmail = () => `pessoa.${randomUUID()}@teste.dev`;

/** Prefeitura com Obras e Iluminação, um admin e um gestor de Obras. */
async function seedBase() {
  const seed = await fx.seedPanelTenant();
  const adminId = await fx.newAdmin(seed.tenantId);
  const managerId = await fx.newManager(seed.tenantId, [seed.worksId]);
  return { ...seed, adminId, managerId };
}

const userOf = async (id: string) => {
  const [row] = await owner.db.select().from(users).where(eq(users.id, id));
  return row!;
};

const userByCpf = async (cpf: string) => {
  const rows = await owner.db.select().from(users).where(eq(users.cpf, cpf));
  return rows[0];
};

const managerStatus = async (tenantId: string, userId: string) => {
  const [row] = await owner.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, userId),
        eq(memberships.role, 'manager'),
      ),
    );
  return row?.status;
};

const departmentsOf = async (tenantId: string, userId: string) => {
  const rows = await withContext(owner.db, { tenantId }, (tx) =>
    tx.select().from(departmentManagers).where(eq(departmentManagers.userId, userId)),
  );
  return rows.map((row) => row.departmentId).toSorted();
};

describe('gestores, categorias e setores na API', () => {
  it('manager gets 403 admin_only on managers, categories and department writes', async () => {
    const base = await seedBase();
    const someId = randomUUID();
    const calls: ['GET' | 'POST' | 'PATCH', string, object?][] = [
      ['GET', '/panel/managers'],
      [
        'POST',
        '/panel/managers',
        { name: 'Fulano', cpf: newCpf(), email: newEmail(), departmentIds: [base.worksId] },
      ],
      ['PATCH', `/panel/managers/${someId}`, { action: 'deactivate' }],
      ['GET', '/panel/categories'],
      [
        'POST',
        '/panel/categories',
        {
          name: 'Nova',
          icon: 'trees',
          iconGroup: 'environment',
          departmentId: base.worksId,
          defaultDeadlineDays: 7,
          clusterRadiusM: 20,
          active: true,
        },
      ],
      ['PATCH', `/panel/categories/${base.potholeId}`, { active: false }],
      ['POST', '/panel/departments', { name: 'Parques' }],
      ['PATCH', `/panel/departments/${base.worksId}`, { name: 'Parques' }],
    ];
    for (const [method, url, payload] of calls) {
      const response = await call(method, url, base.managerId, base.tenantId, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json()).toEqual({ code: 'admin_only' });
    }
  });

  it('admin creates a manager with departments', async () => {
    const base = await seedBase();
    const cpf = newCpf();
    const email = newEmail();
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Maria Gestora',
      cpf,
      email: email.toUpperCase(),
      departmentIds: [base.worksId, base.lightsId],
    });
    expect(response.statusCode).toBe(201);
    const row = managerRowSchema.parse(response.json());
    expect(row).toMatchObject({
      name: 'Maria Gestora',
      cpf,
      email,
      role: 'manager',
      status: 'active',
    });
    expect(row.departments.map((d) => d.name)).toEqual(['Iluminação', 'Obras']);
    expect(await managerStatus(base.tenantId, row.userId)).toBe('active');
    expect(await departmentsOf(base.tenantId, row.userId)).toEqual(
      [base.worksId, base.lightsId].toSorted(),
    );

    // Lista: admin primeiro, depois os gestores por nome.
    const list = await call('GET', '/panel/managers', base.adminId, base.tenantId);
    expect(list.statusCode).toBe(200);
    const { items } = managersResponseSchema.parse(list.json());
    expect(items.map((item) => item.role)).toEqual(['tenant_admin', 'manager', 'manager']);
    expect(items[0]!.departments).toEqual([]);
  });

  it('existing account without email keeps its name and gets the typed email; inactive link comes back', async () => {
    const base = await seedBase();
    const cpf = newCpf();
    const [existing] = await owner.db
      .insert(users)
      .values({ name: 'Nome Antigo', phone: '+5541966665555', cpf })
      .returning();
    await fx.link(base.tenantId, existing!.id, 'manager', 'inactive');
    const email = newEmail();
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Outro Nome',
      cpf,
      email,
      departmentIds: [base.lightsId],
    });
    expect(response.statusCode).toBe(201);
    expect(managerRowSchema.parse(response.json())).toMatchObject({
      userId: existing!.id,
      name: 'Nome Antigo',
      email,
      status: 'active',
    });
    expect((await userOf(existing!.id)).email).toBe(email);
  });

  it('new manager with a CPF that has another email is 409 email_mismatch', async () => {
    const base = await seedBase();
    const cpf = newCpf();
    const other = 'gabriela@exemplo.com';
    await owner.db
      .insert(users)
      .values({ name: 'Com Email', phone: '+5541955554444', cpf, email: other });
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Fulano',
      cpf,
      email: newEmail(),
      departmentIds: [base.worksId],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'email_mismatch', maskedEmail: 'g•••@exemplo.com' });
    expect((await userByCpf(cpf))!.email).toBe(other);
  });

  it('new manager with an email of another account is 409 email_in_use', async () => {
    const base = await seedBase();
    const taken = newEmail();
    await owner.db
      .insert(users)
      .values({ name: 'Dono do Email', phone: '+5541944443333', email: taken });
    const cpf = newCpf();
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Fulano',
      cpf,
      email: taken,
      departmentIds: [base.worksId],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'email_in_use' });
    expect(await userByCpf(cpf)).toBeUndefined();
  });

  it('new manager with a CPF held by a frozen account is 409 cpf_unavailable', async () => {
    const base = await seedBase();
    const cpf = newCpf();
    await owner.db
      .insert(users)
      .values({ name: 'Conta Congelada', phone: '+5541933332222', cpf, accountStatus: 'frozen' });
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Fulano',
      cpf,
      email: newEmail(),
      departmentIds: [base.worksId],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'cpf_unavailable' });
  });

  it('active manager is 409 already_manager and the refusal rolls the email back', async () => {
    const base = await seedBase();
    const cpf = newCpf();
    const [existing] = await owner.db
      .insert(users)
      .values({ name: 'Já Gestor', phone: '+5541922221111', cpf })
      .returning();
    await fx.link(base.tenantId, existing!.id, 'manager');
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Já Gestor',
      cpf,
      email: newEmail(),
      departmentIds: [base.worksId],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'already_manager' });
    expect((await userOf(existing!.id)).email).toBeNull();
  });

  it('unknown department is 422 department_not_found', async () => {
    const base = await seedBase();
    const cpf = newCpf();
    const response = await call('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Fulano',
      cpf,
      email: newEmail(),
      departmentIds: [randomUUID()],
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: 'department_not_found' });
    expect(await userByCpf(cpf)).toBeUndefined();
  });

  it('admin changes the manager email and departments', async () => {
    const base = await seedBase();
    const email = newEmail();
    const response = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'update', email: email.toUpperCase(), departmentIds: [base.lightsId] },
    );
    expect(response.statusCode).toBe(200);
    const row = managerRowSchema.parse(response.json());
    expect(row.email).toBe(email);
    expect(row.departments.map((d) => d.id)).toEqual([base.lightsId]);
    expect((await userOf(base.managerId)).email).toBe(email);
    expect(await departmentsOf(base.tenantId, base.managerId)).toEqual([base.lightsId]);
  });

  it('changing to an email of another account is 409 email_in_use', async () => {
    const base = await seedBase();
    const taken = newEmail();
    await owner.db.insert(users).values({ name: 'Dono', phone: '+5541911110000', email: taken });
    const response = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'update', email: taken, departmentIds: [base.worksId] },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'email_in_use' });
  });

  it('email change is 409 email_change_not_allowed for a manager of another city', async () => {
    const base = await seedBase();
    const otherTenant = await fx.seedPanelTenant();
    await fx.link(otherTenant.tenantId, base.managerId, 'manager');
    const response = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'update', email: newEmail(), departmentIds: [base.lightsId] },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'email_change_not_allowed' });
    // A recusa desfaz também os setores.
    expect(await departmentsOf(base.tenantId, base.managerId)).toEqual([base.worksId]);
  });

  it('deactivated manager loses panel access on the next call', async () => {
    const base = await seedBase();
    const before = await call('GET', '/panel/teams', base.managerId, base.tenantId);
    expect(before.statusCode).toBe(200);

    const off = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'deactivate' },
    );
    expect(off.statusCode).toBe(200);
    expect(managerRowSchema.parse(off.json()).status).toBe('inactive');
    // Os setores ficam guardados.
    expect(await departmentsOf(base.tenantId, base.managerId)).toEqual([base.worksId]);
    const after = await call('GET', '/panel/teams', base.managerId, base.tenantId);
    expect(after.statusCode).toBe(403);

    const on = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'reactivate' },
    );
    expect(managerRowSchema.parse(on.json()).status).toBe('active');
    const again = await call('GET', '/panel/teams', base.managerId, base.tenantId);
    expect(again.statusCode).toBe(200);
  });

  it('reactivating a manager who joined the staff is 409 staff_account_not_allowed', async () => {
    const base = await seedBase();
    const off = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'deactivate' },
    );
    expect(off.statusCode).toBe(200);
    // Com o vínculo inativo, a pessoa entra na equipe interna.
    await owner.db
      .update(users)
      .set({ platformRole: 'support' })
      .where(eq(users.id, base.managerId));

    const on = await call(
      'PATCH',
      `/panel/managers/${base.managerId}`,
      base.adminId,
      base.tenantId,
      { action: 'reactivate' },
    );
    expect(on.statusCode).toBe(409);
    expect(on.json()).toEqual({ code: 'staff_account_not_allowed' });
    expect(await managerStatus(base.tenantId, base.managerId)).toBe('inactive');
  });

  it('admin cannot deactivate themselves', async () => {
    const base = await seedBase();
    for (const payload of [
      { action: 'deactivate' },
      { action: 'update', email: newEmail(), departmentIds: [base.worksId] },
    ]) {
      const response = await call(
        'PATCH',
        `/panel/managers/${base.adminId}`,
        base.adminId,
        base.tenantId,
        payload,
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code: 'cannot_change_self' });
    }
  });

  it('patching a user that is not a manager of this city is 404 manager_not_found', async () => {
    const base = await seedBase();
    const otherTenant = await fx.seedPanelTenant();
    const strangerId = await fx.newManager(otherTenant.tenantId, [otherTenant.worksId]);
    const secondAdmin = await fx.newAdmin(base.tenantId);
    for (const userId of [strangerId, secondAdmin, randomUUID()]) {
      const response = await call(
        'PATCH',
        `/panel/managers/${userId}`,
        base.adminId,
        base.tenantId,
        { action: 'deactivate' },
      );
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'manager_not_found' });
    }
  });

  it('categories are listed alphabetically, inactive included', async () => {
    const base = await seedBase();
    await withContext(owner.db, { tenantId: base.tenantId }, (tx) =>
      tx.insert(categories).values([
        { tenantId: base.tenantId, departmentId: base.worksId, name: 'Calçada', active: false },
        { tenantId: base.tenantId, departmentId: base.lightsId, name: 'Árvore caída' },
      ]),
    );
    const response = await call('GET', '/panel/categories', base.adminId, base.tenantId);
    expect(response.statusCode).toBe(200);
    const { items } = categoriesResponseSchema.parse(response.json());
    expect(items.map((item) => item.name)).toEqual([
      'Árvore caída',
      'Buraco',
      'Calçada',
      'Poste apagado',
    ]);
    expect(items.find((item) => item.name === 'Calçada')).toMatchObject({
      active: false,
      departmentName: 'Obras',
    });
  });

  it('admin creates and edits a category', async () => {
    const base = await seedBase();
    const created = await call('POST', '/panel/categories', base.adminId, base.tenantId, {
      name: 'Mato alto',
      icon: 'trees',
      iconGroup: 'environment',
      departmentId: base.worksId,
      defaultDeadlineDays: 10,
      clusterRadiusM: 30,
      active: true,
    });
    expect(created.statusCode).toBe(201);
    const row = categoryRowSchema.parse(created.json());
    expect(row).toMatchObject({
      name: 'Mato alto',
      icon: 'trees',
      iconGroup: 'environment',
      departmentName: 'Obras',
      defaultDeadlineDays: 10,
      clusterRadiusM: 30,
    });

    const edited = await call('PATCH', `/panel/categories/${row.id}`, base.adminId, base.tenantId, {
      departmentId: base.lightsId,
      defaultDeadlineDays: 3,
    });
    expect(edited.statusCode).toBe(200);
    expect(categoryRowSchema.parse(edited.json())).toMatchObject({
      departmentName: 'Iluminação',
      defaultDeadlineDays: 3,
      name: 'Mato alto',
    });

    const missing = await call(
      'PATCH',
      `/panel/categories/${randomUUID()}`,
      base.adminId,
      base.tenantId,
      {
        active: false,
      },
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'category_not_found' });

    const badDepartment = await call(
      'PATCH',
      `/panel/categories/${row.id}`,
      base.adminId,
      base.tenantId,
      {
        departmentId: randomUUID(),
      },
    );
    expect(badDepartment.statusCode).toBe(422);
    expect(badDepartment.json()).toEqual({ code: 'department_not_found' });
  });

  it('toggling a category hides it from the citizen catalog', async () => {
    const base = await seedBase();
    // Prefeitura com fronteira própria num ponto sorteado, para o /citizen/locate achá-la.
    const lat = -(randomInt(1, 60) + Math.random());
    const lng = -(randomInt(40, 70) + Math.random());
    await owner.db.execute(sql`
      UPDATE tenants SET boundary = ST_Multi(ST_MakeEnvelope(${lng - 0.001}, ${lat - 0.001}, ${lng + 0.001}, ${lat + 0.001}, 4326))
      WHERE id = ${base.tenantId}
    `);
    const citizenHeaders = await appAuthHeader(appDb.db, base.citizenId);
    const catalog = async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/citizen/locate?lat=${lat}&lng=${lng}`,
        headers: citizenHeaders,
      });
      const body = response.json() as LocateResponse;
      if (body.status !== 'served') throw new Error('prefeitura não encontrada pelo ponto');
      return body.categories.map((category) => category.name);
    };

    expect(await catalog()).toEqual(['Buraco', 'Poste apagado']);
    const off = await call(
      'PATCH',
      `/panel/categories/${base.potholeId}`,
      base.adminId,
      base.tenantId,
      {
        active: false,
      },
    );
    expect(off.statusCode).toBe(200);
    expect(await catalog()).toEqual(['Poste apagado']);
    const on = await call(
      'PATCH',
      `/panel/categories/${base.potholeId}`,
      base.adminId,
      base.tenantId,
      {
        active: true,
      },
    );
    expect(on.statusCode).toBe(200);
    expect(await catalog()).toEqual(['Buraco', 'Poste apagado']);
  });

  it('category with a repeated name is 409', async () => {
    const base = await seedBase();
    const body = {
      name: 'Buraco',
      icon: 'construction',
      iconGroup: 'infrastructure',
      departmentId: base.worksId,
      defaultDeadlineDays: 7,
      clusterRadiusM: 20,
      active: true,
    };
    const created = await call('POST', '/panel/categories', base.adminId, base.tenantId, body);
    expect(created.statusCode).toBe(409);
    expect(created.json()).toEqual({ code: 'category_name_taken' });

    const renamed = await call(
      'PATCH',
      `/panel/categories/${base.lampId}`,
      base.adminId,
      base.tenantId,
      {
        name: 'Buraco',
      },
    );
    expect(renamed.statusCode).toBe(409);
    expect(renamed.json()).toEqual({ code: 'category_name_taken' });

    const unknown = await call('POST', '/panel/categories', base.adminId, base.tenantId, {
      ...body,
      name: 'Outra',
      departmentId: randomUUID(),
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toEqual({ code: 'department_not_found' });
  });

  it('admin creates a department and a repeated name is 409', async () => {
    const base = await seedBase();
    const created = await call('POST', '/panel/departments', base.adminId, base.tenantId, {
      name: 'Parques',
    });
    expect(created.statusCode).toBe(201);
    expect(departmentRowSchema.parse(created.json())).toMatchObject({
      name: 'Parques',
      categoryCount: 0,
      teamCount: 0,
      managerCount: 0,
    });
    const repeated = await call('POST', '/panel/departments', base.adminId, base.tenantId, {
      name: 'Parques',
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toEqual({ code: 'department_name_taken' });
    const renamed = await call(
      'PATCH',
      `/panel/departments/${base.lightsId}`,
      base.adminId,
      base.tenantId,
      {
        name: 'Obras',
      },
    );
    expect(renamed.statusCode).toBe(409);
    expect(renamed.json()).toEqual({ code: 'department_name_taken' });
    const missing = await call(
      'PATCH',
      `/panel/departments/${randomUUID()}`,
      base.adminId,
      base.tenantId,
      {
        name: 'Qualquer',
      },
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'department_not_found' });
  });

  it('department rename keeps categories and teams', async () => {
    const base = await seedBase();
    const teamId = await fx.addTeam(base.tenantId, {
      departmentId: base.worksId,
      name: 'Equipe Norte',
    });
    const response = await call(
      'PATCH',
      `/panel/departments/${base.worksId}`,
      base.adminId,
      base.tenantId,
      {
        name: 'Obras e Vias',
      },
    );
    expect(response.statusCode).toBe(200);
    expect(departmentRowSchema.parse(response.json())).toMatchObject({
      id: base.worksId,
      name: 'Obras e Vias',
      categoryCount: 1,
      teamCount: 1,
      managerCount: 1,
    });
    const [team] = await withContext(owner.db, { tenantId: base.tenantId }, (tx) =>
      tx.select().from(teams).where(eq(teams.id, teamId)),
    );
    expect(team!.departmentId).toBe(base.worksId);
    const [category] = await withContext(owner.db, { tenantId: base.tenantId }, (tx) =>
      tx.select().from(categories).where(eq(categories.id, base.potholeId)),
    );
    expect(category!.departmentId).toBe(base.worksId);
  });
});
