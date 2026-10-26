import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import { DEFAULT_CATALOG } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { tenants, tenantContracts, categories, departments, memberships, users, staffAuditEvents } =
  schema;

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

const newCode = () => String(randomInt(8_000_000, 8_999_999));

async function addMunicipality(name: string, code = newCode(), state = 'PR') {
  await owner.db.execute(sql`
    insert into municipalities (ibge_code, name, state, boundary)
    values (${code}, ${name}, ${state},
      ST_Multi(ST_GeomFromText('POLYGON((-50 -25, -50 -24, -49 -24, -49 -25, -50 -25))', 4326)))
  `);
  return code;
}

/** CPF válido e único (dígitos verificadores calculados). */
function nextCpf() {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  for (const length of [9, 10]) {
    const sum = digits.reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.join('');
}

function body(ibgeCode: string, overrides: Record<string, unknown> = {}) {
  return {
    ibgeCode,
    displayName: 'Prefeitura de Teste',
    centralPhone: '156',
    admin: {
      name: 'Maria Admin',
      cpf: nextCpf(),
      email: `admin.${randomUUID()}@prefeitura.gov.br`,
    },
    contract: { plan: 'essential', includedPanelUsers: 5, startsOn: '2026-11-01', endsOn: null },
    copyDefaultCatalog: true,
    ...overrides,
  };
}

async function call(
  method: 'GET' | 'POST',
  url: string,
  userId: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({ method, url, headers: await staffAuthHeader(appDb.db, userId), payload });
}

const create = (userId: string, payload: Record<string, unknown>) =>
  call('POST', '/backoffice/tenants', userId, payload);

describe('municipality search', () => {
  it('municipality search by name ignores accents and marks taken ones', async () => {
    const staffId = await fx.newStaff('support');
    const free = await addMunicipality('São Zéfiro do Teste');
    const taken = await addMunicipality('Sao Zefiro Velho');
    await owner.db.insert(tenants).values({
      name: 'Sao Zefiro Velho',
      displayName: 'Prefeitura',
      city: 'Sao Zefiro Velho',
      state: 'PR',
      ibgeCode: taken,
    });
    const response = await call(
      'GET',
      `/backoffice/municipalities?q=${encodeURIComponent('SAO ZEFIRO')}`,
      staffId,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      { ibgeCode: free, name: 'São Zéfiro do Teste', state: 'PR', taken: false },
      { ibgeCode: taken, name: 'Sao Zefiro Velho', state: 'PR', taken: true },
    ]);
  });

  it('municipality search finds capital accented names from plain text', async () => {
    const staffId = await fx.newStaff('support');
    const code = await addMunicipality('Águas Testadas');
    const response = await call('GET', '/backoffice/municipalities?q=aguas%20testadas', staffId);
    expect(response.json().items).toEqual([
      { ibgeCode: code, name: 'Águas Testadas', state: 'PR', taken: false },
    ]);
  });

  it('municipality search by code prefix', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Prefixo Unico', '7654321');
    const response = await call('GET', '/backoffice/municipalities?q=76543', staffId);
    expect(response.json().items).toContainEqual({
      ibgeCode: code,
      name: 'Prefixo Unico',
      state: 'PR',
      taken: false,
    });
    const short = await call('GET', '/backoffice/municipalities?q=a', staffId);
    expect(short.json().items).toEqual([]);
  });
});

describe('nova prefeitura', () => {
  it('admin creates an onboarding tenant with boundary, contract and tenant admin', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Nova');
    const payload = body(code);
    const response = await create(staffId, payload);
    expect(response.statusCode).toBe(201);
    const { id } = response.json();

    const [tenant] = await owner.db.select().from(tenants).where(eq(tenants.id, id));
    expect(tenant).toMatchObject({
      name: 'Cidade Nova',
      city: 'Cidade Nova',
      state: 'PR',
      ibgeCode: code,
      displayName: 'Prefeitura de Teste',
      centralPhone: '156',
      status: 'onboarding',
    });
    expect(tenant!.boundary).not.toBeNull();
    const rows = await withContext(owner.db, { tenantId: id }, async (tx) => ({
      contracts: await tx.select().from(tenantContracts).where(eq(tenantContracts.tenantId, id)),
      members: await tx
        .select({ role: memberships.role, status: memberships.status, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, id)),
    }));
    expect(rows.contracts).toHaveLength(1);
    expect(rows.contracts[0]).toMatchObject({
      plan: 'essential',
      includedPanelUsers: 5,
      startsOn: '2026-11-01',
      endsOn: null,
    });
    expect(rows.members).toEqual([
      {
        role: 'tenant_admin',
        status: 'active',
        email: (payload.admin as { email: string }).email,
      },
    ]);
  });

  it('default catalog creates 3 departments and 9 categories', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Catalogo');
    const { id } = (await create(staffId, body(code))).json();
    const rows = await withContext(owner.db, { tenantId: id }, async (tx) => ({
      depts: await tx.select().from(departments).where(eq(departments.tenantId, id)),
      cats: await tx.select().from(categories).where(eq(categories.tenantId, id)),
    }));
    expect(rows.depts.map((d) => d.name).toSorted()).toEqual([
      'Meio ambiente',
      'Obras',
      'Serviços',
    ]);
    expect(rows.cats).toHaveLength(9);
    const hole = rows.cats.find((c) => c.name === 'Buraco na via')!;
    const spec = DEFAULT_CATALOG.find((c) => c.name === 'Buraco na via')!;
    expect(hole).toMatchObject({
      icon: spec.icon,
      iconGroup: spec.iconGroup,
      clusterRadiusM: spec.clusterRadiusM,
      defaultDeadlineDays: 7,
    });
    expect(rows.depts.find((d) => d.id === hole.departmentId)!.name).toBe('Obras');
  });

  it('tenant without catalog has no categories', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Vazia');
    const { id } = (await create(staffId, body(code, { copyDefaultCatalog: false }))).json();
    const rows = await withContext(owner.db, { tenantId: id }, async (tx) => ({
      depts: await tx.select().from(departments).where(eq(departments.tenantId, id)),
      cats: await tx.select().from(categories).where(eq(categories.tenantId, id)),
    }));
    expect(rows.depts).toEqual([]);
    expect(rows.cats).toEqual([]);
  });

  it('tenant creation rolls back on email mismatch', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Desfeita');
    const cpf = nextCpf();
    await owner.db
      .insert(users)
      .values({ name: 'Conta Antiga', cpf, email: 'guardado@exemplo.com' });
    const payload = body(code);
    (payload.admin as Record<string, string>).cpf = cpf;
    const response = await create(staffId, payload);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'email_mismatch', maskedEmail: 'g•••@exemplo.com' });
    const found = await owner.db.select().from(tenants).where(eq(tenants.ibgeCode, code));
    expect(found).toEqual([]);
  });

  it('creating an existing municipality is 409 tenant_exists', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Repetida');
    expect((await create(staffId, body(code))).statusCode).toBe(201);
    const again = await create(staffId, body(code));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'tenant_exists' });
  });

  it('admin email of another account is 409 email_in_use', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Email');
    const email = `outra.${randomUUID()}@exemplo.com`;
    await owner.db.insert(users).values({ name: 'Outra Pessoa', cpf: nextCpf(), email });
    const payload = body(code);
    (payload.admin as Record<string, string>).email = email;
    const response = await create(staffId, payload);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'email_in_use' });
  });

  it.each([
    ['frozen', { accountStatus: 'frozen' as const }],
    ['deleted', { deletedAt: new Date() }],
  ])(
    'admin CPF held by a %s account is 409 cpf_unavailable and nothing is created',
    async (_, extra) => {
      const staffId = await fx.newStaff('admin');
      const code = await addMunicipality('Cidade Bloqueada');
      const cpf = nextCpf();
      await owner.db.insert(users).values({ name: 'Conta Bloqueada', cpf, ...extra });
      const payload = body(code);
      (payload.admin as Record<string, string>).cpf = cpf;
      const response = await create(staffId, payload);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ code: 'cpf_unavailable' });
      expect(await owner.db.select().from(tenants).where(eq(tenants.ibgeCode, code))).toEqual([]);
      const email = (payload.admin as Record<string, string>).email;
      expect(
        await owner.db
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`),
      ).toEqual([]);
    },
  );

  it('admin CPF of a staff account is 409 staff_account_not_allowed and nothing is created', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade da Equipe');
    const cpf = nextCpf();
    const email = `equipe.${randomUUID()}@aloc.dev`;
    const [member] = await owner.db
      .insert(users)
      .values({ name: 'Pessoa da Equipe', cpf, email, platformRole: 'support' })
      .returning();
    const payload = body(code);
    Object.assign(payload.admin as Record<string, string>, { cpf, email });
    const response = await create(staffId, payload);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'staff_account_not_allowed' });
    expect(await owner.db.select().from(tenants).where(eq(tenants.ibgeCode, code))).toEqual([]);
    expect(
      await owner.db.select().from(memberships).where(eq(memberships.userId, member!.id)),
    ).toEqual([]);
  });

  it('unknown municipality is 422 municipality_not_found', async () => {
    const staffId = await fx.newStaff('admin');
    const response = await create(staffId, body('1000001'));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: 'municipality_not_found' });
  });

  it('support gets 403 admin_only on tenant creation', async () => {
    const staffId = await fx.newStaff('support');
    const code = await addMunicipality('Cidade Negada');
    const response = await create(staffId, body(code));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'admin_only' });
  });

  it('tenant creation writes tenant.create in the new tenant audit', async () => {
    const staffId = await fx.newStaff('admin');
    const code = await addMunicipality('Cidade Auditada');
    const { id } = (await create(staffId, body(code))).json();
    const events = await withContext(owner.db, { tenantId: id }, (tx) =>
      tx.select().from(staffAuditEvents).where(eq(staffAuditEvents.tenantId, id)),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'tenant.create',
      staffUserId: staffId,
      targetType: 'tenant',
      targetId: id,
    });
  });
});
