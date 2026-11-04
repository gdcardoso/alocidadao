import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import { agentRowSchema, maskEmail } from '@alocidadao/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { EmailMessage } from '../messaging/email.js';
import { panelAuthHeader, staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const {
  categories,
  departments,
  inviteDeliveries,
  memberships,
  staffAuditEvents,
  teamMembers,
  users,
} = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

const LINKS = { panelUrl: 'http://painel.teste', playStoreUrl: null, appStoreUrl: null };
const PANEL_SUBJECT = 'Você foi convidado para o painel do Alô Cidadão';
const AGENT_SUBJECT = 'Você foi convidado para o app do agente do Alô Cidadão';
const STAFF_SUBJECT = 'Você foi adicionado à equipe do Alô Cidadão';

const sent: EmailMessage[] = [];
const mailsTo = (to: string) => sent.filter((msg) => msg.to === to);

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({
    database: appDb.db,
    auth: { ...testAuthOptions, email: { send: async (msg) => void sent.push(msg) } },
    invites: LINKS,
  });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

type Method = 'GET' | 'POST' | 'PATCH';

async function panel(
  method: Method,
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

async function backoffice(method: Method, url: string, userId: string, payload?: object) {
  return app.inject({
    method,
    url,
    headers: await staffAuthHeader(appDb.db, userId),
    ...(payload ? { payload } : {}),
  });
}

const newEmail = (prefix = 'pessoa') => `${prefix}.${randomUUID()}@teste.dev`;
const newPhone = () => `+55419${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

/** CPF válido e único (dígitos verificadores calculados). */
function newCpf() {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  for (const length of [9, 10]) {
    const sum = digits.reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.join('');
}

const setEmail = (userId: string, email: string | null) =>
  owner.db.update(users).set({ email }).where(eq(users.id, userId));

/** Prefeitura (ativa ou em implantação) com Obras, categoria Buraco, equipe Norte, admin e gestor. */
async function seedTenant(status: 'active' | 'onboarding' | 'suspended' = 'active') {
  const tenantId = await fx.createTenant(status);
  const worksId = await withContext(owner.db, { tenantId }, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId, name: 'Obras' }).returning();
    await tx.insert(categories).values({
      tenantId,
      departmentId: dept!.id,
      name: 'Buraco',
      icon: 'construction',
      iconGroup: 'infrastructure',
      clusterRadiusM: 50,
    });
    return dept!.id;
  });
  const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe Norte' });
  const adminId = await fx.newAdmin(tenantId);
  const managerId = await fx.newManager(tenantId, [worksId]);
  return { tenantId, worksId, teamId, adminId, managerId };
}

/** Agente na equipe, com o vínculo e o e-mail dados. */
async function seedAgent(
  tenantId: string,
  teamId: string,
  status: 'invited' | 'active' | 'inactive',
  email: string | null = newEmail('agente'),
) {
  const userId = await fx.createUser('Agente de Campo');
  await setEmail(userId, email);
  await owner.db.insert(memberships).values({ tenantId, userId, role: 'field_agent', status });
  await withContext(owner.db, { tenantId }, (tx) =>
    tx.insert(teamMembers).values({ tenantId, teamId, userId }),
  );
  return { userId, email };
}

const deliveriesOf = (userId: string) =>
  owner.db.select().from(inviteDeliveries).where(eq(inviteDeliveries.userId, userId));

const tenantAudit = (tenantId: string) =>
  withContext(owner.db, { tenantId }, (tx) =>
    tx.select().from(staffAuditEvents).where(eq(staffAuditEvents.tenantId, tenantId)),
  );

describe('invites on creation', () => {
  it('creating a tenant (P2) sends the panel invite to the admin', async () => {
    const staffId = await fx.newStaff('admin');
    const ibgeCode = String(randomInt(7_000_000, 7_999_999));
    await owner.db.execute(sql`
      insert into municipalities (ibge_code, name, state, boundary)
      values (${ibgeCode}, 'Convite do Sul', 'PR',
        ST_Multi(ST_GeomFromText('POLYGON((-50 -25, -50 -24, -49 -24, -49 -25, -50 -25))', 4326)))
    `);
    const email = newEmail('admin');

    const response = await backoffice('POST', '/backoffice/tenants', staffId, {
      ibgeCode,
      displayName: 'Prefeitura de Convite',
      centralPhone: '156',
      admin: { name: 'Maria Admin', cpf: newCpf(), email },
      contract: { plan: 'essential', includedPanelUsers: 5, startsOn: '2026-11-01', endsOn: null },
      copyDefaultCatalog: false,
    });
    expect(response.statusCode).toBe(201);

    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      subject: PANEL_SUBJECT,
      fromName: 'Alô Cidadão · Prefeitura de Convite',
    });
    expect(mails[0]!.text).toContain('Administrador da prefeitura');
    expect(mails[0]!.text).toContain('http://painel.teste');
  });

  it('creating a manager sends the panel invite with the Gestor profile', async () => {
    const base = await seedTenant();
    const email = newEmail('gestor');
    const response = await panel('POST', '/panel/managers', base.adminId, base.tenantId, {
      name: 'Ana Gestora',
      cpf: newCpf(),
      email,
      departmentIds: [base.worksId],
    });
    expect(response.statusCode).toBe(201);

    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(PANEL_SUBJECT);
    expect(mails[0]!.text).toContain('com o perfil Gestor');
  });

  it('adding an agent requires the email', async () => {
    const base = await seedTenant();
    const response = await panel(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.adminId,
      base.tenantId,
      { name: 'Sem Email', phone: newPhone() },
    );
    expect(response.statusCode).toBe(400);
  });

  it('adding an agent while onboarding sends nothing and records no delivery', async () => {
    const base = await seedTenant('onboarding');
    const email = newEmail('agente');
    const response = await panel(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.adminId,
      base.tenantId,
      { name: 'Agente Implantação', phone: newPhone(), email },
    );
    expect(response.statusCode).toBe(201);
    const row = agentRowSchema.parse(response.json());
    expect(row.email).toBe(email);
    expect(mailsTo(email)).toHaveLength(0);
    expect(await deliveriesOf(row.userId)).toHaveLength(0);
  });

  it('adding an agent to an active tenant sends the agent invite with the team name', async () => {
    const base = await seedTenant();
    const email = newEmail('agente');
    const response = await panel(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.managerId,
      base.tenantId,
      { name: 'Agente Ativo', phone: newPhone(), email: email.toUpperCase() },
    );
    expect(response.statusCode).toBe(201);
    const row = agentRowSchema.parse(response.json());
    expect(row.email).toBe(email);

    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(AGENT_SUBJECT);
    expect(mails[0]!.text).toContain('Equipe Norte');
    expect(await deliveriesOf(row.userId)).toMatchObject([{ kind: 'agent' }]);
  });

  it('a person found by phone with another email is 409 email_mismatch', async () => {
    const base = await seedTenant();
    const citizen = await fx.createCitizen();

    const other = await panel(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.adminId,
      base.tenantId,
      { name: 'Outro Nome', phone: citizen.phone, email: newEmail('outro') },
    );
    expect(other.statusCode).toBe(409);
    expect(other.json()).toEqual({
      code: 'email_mismatch',
      maskedEmail: maskEmail(citizen.email),
    });

    const same = await panel(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.adminId,
      base.tenantId,
      { name: 'Outro Nome', phone: citizen.phone, email: citizen.email.toUpperCase() },
    );
    expect(same.statusCode).toBe(201);
    expect(agentRowSchema.parse(same.json()).userId).toBe(citizen.id);
    const mails = mailsTo(citizen.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(AGENT_SUBJECT);
  });

  it('adding a staff member (P6) sends the staff invite', async () => {
    const adminId = await fx.newStaff('admin');
    const email = newEmail('equipe');
    const response = await backoffice('POST', '/backoffice/staff', adminId, {
      name: 'Bia Equipe',
      cpf: newCpf(),
      email,
      platformRole: 'support',
    });
    expect(response.statusCode).toBe(201);
    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(STAFF_SUBJECT);
    expect(mails[0]!.text).toContain('Suporte');
  });

  it('a failing email sender does not undo the creation', async () => {
    const failing = await buildApp({
      database: appDb.db,
      auth: {
        ...testAuthOptions,
        email: {
          send: async () => {
            throw new Error('provedor fora do ar');
          },
        },
      },
      invites: LINKS,
    });
    try {
      const base = await seedTenant();
      const response = await failing.inject({
        method: 'POST',
        url: '/panel/managers',
        headers: await panelAuthHeader(appDb.db, base.adminId, base.tenantId),
        payload: {
          name: 'Gestor Sem Email',
          cpf: newCpf(),
          email: newEmail('gestor'),
          departmentIds: [base.worksId],
        },
      });
      expect(response.statusCode).toBe(201);
    } finally {
      await failing.close();
    }
  });
});

describe('invites on activation', () => {
  it('activation sends only to pending agents with email; reactivation sends nothing', async () => {
    const staffId = await fx.newStaff('admin');
    const base = await seedTenant('onboarding');
    const invited = await seedAgent(base.tenantId, base.teamId, 'invited');
    const active = await seedAgent(base.tenantId, base.teamId, 'active');
    const inactive = await seedAgent(base.tenantId, base.teamId, 'inactive');
    const noEmail = await seedAgent(base.tenantId, base.teamId, 'invited', null);
    const delivered = await seedAgent(base.tenantId, base.teamId, 'invited');
    await owner.db
      .insert(inviteDeliveries)
      .values({ userId: delivered.userId, tenantId: base.tenantId, kind: 'agent' });

    const activate = () =>
      backoffice('POST', `/backoffice/tenants/${base.tenantId}/status`, staffId, {
        action: 'activate',
      });
    const first = await activate();
    expect(first.statusCode).toBe(200);

    expect(mailsTo(invited.email!)).toHaveLength(1);
    expect(mailsTo(invited.email!)[0]!.subject).toBe(AGENT_SUBJECT);
    expect(mailsTo(active.email!)).toHaveLength(1);
    expect(mailsTo(inactive.email!)).toHaveLength(0);
    expect(mailsTo(delivered.email!)).toHaveLength(0);
    expect(await deliveriesOf(noEmail.userId)).toHaveLength(0);

    const again = await activate();
    expect(again.statusCode).toBe(409);
    expect(mailsTo(invited.email!)).toHaveLength(1);

    const late = await seedAgent(base.tenantId, base.teamId, 'invited');
    const suspend = await backoffice(
      'POST',
      `/backoffice/tenants/${base.tenantId}/status`,
      staffId,
      {
        action: 'suspend',
      },
    );
    expect(suspend.statusCode).toBe(200);
    const reactivate = await backoffice(
      'POST',
      `/backoffice/tenants/${base.tenantId}/status`,
      staffId,
      { action: 'reactivate' },
    );
    expect(reactivate.statusCode).toBe(200);
    expect(mailsTo(late.email!)).toHaveLength(0);
  });
});

describe('resend invite', () => {
  it('manager resend answers the masked email and is rate limited', async () => {
    const base = await seedTenant();
    const email = newEmail('gestor');
    await setEmail(base.managerId, email);
    const url = `/panel/managers/${base.managerId}/invite`;

    const first = await panel('POST', url, base.adminId, base.tenantId);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ maskedEmail: maskEmail(email) });
    expect(mailsTo(email)).toHaveLength(1);

    const second = await panel('POST', url, base.adminId, base.tenantId);
    expect(second.statusCode).toBe(429);
    const body = second.json<{ code: string; retryAfterSeconds: number }>();
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(mailsTo(email)).toHaveLength(1);
  });

  it('manager resend refuses missing email, inactive link, the admin and the manager role', async () => {
    const base = await seedTenant();
    const noEmail = await panel(
      'POST',
      `/panel/managers/${base.managerId}/invite`,
      base.adminId,
      base.tenantId,
    );
    expect(noEmail.statusCode).toBe(409);
    expect(noEmail.json()).toEqual({ code: 'email_missing' });

    const inactiveId = await fx.newManager(base.tenantId, [base.worksId], 'Gestor Inativo');
    await setEmail(inactiveId, newEmail('inativo'));
    await owner.db
      .update(memberships)
      .set({ status: 'inactive' })
      .where(and(eq(memberships.tenantId, base.tenantId), eq(memberships.userId, inactiveId)));
    const inactive = await panel(
      'POST',
      `/panel/managers/${inactiveId}/invite`,
      base.adminId,
      base.tenantId,
    );
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json()).toEqual({ code: 'invite_not_allowed' });

    const admin = await panel(
      'POST',
      `/panel/managers/${base.adminId}/invite`,
      base.adminId,
      base.tenantId,
    );
    expect(admin.statusCode).toBe(404);

    const byManager = await panel(
      'POST',
      `/panel/managers/${base.managerId}/invite`,
      base.managerId,
      base.tenantId,
    );
    expect(byManager.statusCode).toBe(403);
  });

  it('agent resend works in an active tenant and refuses onboarding and inactive agents', async () => {
    const base = await seedTenant();
    const agent = await seedAgent(base.tenantId, base.teamId, 'invited');
    const ok = await panel(
      'POST',
      `/panel/agents/${agent.userId}/invite`,
      base.managerId,
      base.tenantId,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ maskedEmail: maskEmail(agent.email!) });
    expect(mailsTo(agent.email!)).toHaveLength(1);
    expect(mailsTo(agent.email!)[0]!.text).toContain('Equipe Norte');

    const inactive = await seedAgent(base.tenantId, base.teamId, 'inactive');
    const refused = await panel(
      'POST',
      `/panel/agents/${inactive.userId}/invite`,
      base.adminId,
      base.tenantId,
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ code: 'invite_not_allowed' });

    const noEmail = await seedAgent(base.tenantId, base.teamId, 'active', null);
    const missing = await panel(
      'POST',
      `/panel/agents/${noEmail.userId}/invite`,
      base.adminId,
      base.tenantId,
    );
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ code: 'email_missing' });

    const onboarding = await seedTenant('onboarding');
    const pending = await seedAgent(onboarding.tenantId, onboarding.teamId, 'invited');
    const notActive = await panel(
      'POST',
      `/panel/agents/${pending.userId}/invite`,
      onboarding.adminId,
      onboarding.tenantId,
    );
    expect(notActive.statusCode).toBe(409);
    expect(notActive.json()).toEqual({ code: 'tenant_not_active' });
    expect(mailsTo(pending.email!)).toHaveLength(0);

    const outside = await panel(
      'POST',
      `/panel/agents/${pending.userId}/invite`,
      base.adminId,
      base.tenantId,
    );
    expect(outside.statusCode).toBe(404);
  });

  it('support resend in the panel is audited as invite.resend', async () => {
    const supportId = await fx.newStaff('support');
    const base = await seedTenant();
    const agent = await seedAgent(base.tenantId, base.teamId, 'active');

    const response = await panel(
      'POST',
      `/panel/agents/${agent.userId}/invite`,
      supportId,
      base.tenantId,
    );
    expect(response.statusCode).toBe(200);
    await vi.waitFor(async () => {
      expect(await tenantAudit(base.tenantId)).toHaveLength(1);
    });
    expect((await tenantAudit(base.tenantId))[0]).toMatchObject({
      action: 'invite.resend',
      staffUserId: supportId,
      targetType: 'agent',
      targetId: agent.userId,
    });
  });

  it('P3 resend reaches the tenant admin and is audited', async () => {
    const supportId = await fx.newStaff('support');
    const base = await seedTenant();
    const email = newEmail('admin');
    await setEmail(base.adminId, email);

    const response = await backoffice(
      'POST',
      `/backoffice/tenants/${base.tenantId}/managers/${base.adminId}/invite`,
      supportId,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ maskedEmail: maskEmail(email) });
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo(email)[0]!.text).toContain('Administrador da prefeitura');
    expect(await tenantAudit(base.tenantId)).toMatchObject([
      {
        action: 'invite.resend',
        staffUserId: supportId,
        targetType: 'manager',
        targetId: base.adminId,
      },
    ]);

    const unknown = await backoffice(
      'POST',
      `/backoffice/tenants/${base.tenantId}/managers/${randomUUID()}/invite`,
      supportId,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('P3 resend is refused for a suspended tenant', async () => {
    const supportId = await fx.newStaff('support');
    const base = await seedTenant('suspended');
    await setEmail(base.adminId, newEmail('admin'));
    const response = await backoffice(
      'POST',
      `/backoffice/tenants/${base.tenantId}/managers/${base.adminId}/invite`,
      supportId,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'invite_not_allowed' });
  });

  it('P6 resend sends the staff invite, is audited and admin only', async () => {
    const adminId = await fx.newStaff('admin');
    const supportId = await fx.newStaff('support');
    const memberId = await fx.newStaff('support', 'Pessoa da Equipe');
    const email = newEmail('equipe');
    await setEmail(memberId, email);

    const bySupport = await backoffice('POST', `/backoffice/staff/${memberId}/invite`, supportId);
    expect(bySupport.statusCode).toBe(403);

    const response = await backoffice('POST', `/backoffice/staff/${memberId}/invite`, adminId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ maskedEmail: maskEmail(email) });
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo(email)[0]!.subject).toBe(STAFF_SUBJECT);

    const events = await owner.db
      .select()
      .from(staffAuditEvents)
      .where(and(eq(staffAuditEvents.targetId, memberId), isNull(staffAuditEvents.tenantId)));
    expect(events).toMatchObject([
      { action: 'invite.resend', staffUserId: adminId, targetType: 'staff' },
    ]);

    const noEmailId = await fx.newStaff('support', 'Sem Email');
    const missing = await backoffice('POST', `/backoffice/staff/${noEmailId}/invite`, adminId);
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ code: 'email_missing' });

    const citizen = await fx.createCitizen();
    const notStaff = await backoffice('POST', `/backoffice/staff/${citizen.id}/invite`, adminId);
    expect(notStaff.statusCode).toBe(404);
  });
});

describe('agent email change', () => {
  it('change_email saves the email and sends no invite', async () => {
    const base = await seedTenant();
    const agent = await seedAgent(base.tenantId, base.teamId, 'active', null);
    const email = newEmail('novo');
    const response = await panel(
      'PATCH',
      `/panel/agents/${agent.userId}`,
      base.adminId,
      base.tenantId,
      {
        action: 'change_email',
        email,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(agentRowSchema.parse(response.json()).email).toBe(email);
    const [row] = await owner.db.select().from(users).where(eq(users.id, agent.userId));
    expect(row!.email).toBe(email);
    expect(mailsTo(email)).toHaveLength(0);
  });

  it('change_email refuses people with panel access and emails in use', async () => {
    const base = await seedTenant();
    const agent = await seedAgent(base.tenantId, base.teamId, 'active');
    await fx.link(base.tenantId, agent.userId, 'manager');
    const refused = await panel(
      'PATCH',
      `/panel/agents/${agent.userId}`,
      base.adminId,
      base.tenantId,
      {
        action: 'change_email',
        email: newEmail('novo'),
      },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ code: 'email_change_not_allowed' });

    const other = await seedAgent(base.tenantId, base.teamId, 'active');
    const plain = await seedAgent(base.tenantId, base.teamId, 'active');
    const inUse = await panel(
      'PATCH',
      `/panel/agents/${plain.userId}`,
      base.adminId,
      base.tenantId,
      {
        action: 'change_email',
        email: other.email,
      },
    );
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toEqual({ code: 'email_in_use' });
  });

  it('support change_email is audited as agent.email_change', async () => {
    const supportId = await fx.newStaff('support');
    const base = await seedTenant();
    const agent = await seedAgent(base.tenantId, base.teamId, 'active');
    const response = await panel(
      'PATCH',
      `/panel/agents/${agent.userId}`,
      supportId,
      base.tenantId,
      {
        action: 'change_email',
        email: newEmail('novo'),
      },
    );
    expect(response.statusCode).toBe(200);
    await vi.waitFor(async () => {
      expect(await tenantAudit(base.tenantId)).toMatchObject([
        { action: 'agent.email_change', targetType: 'agent', targetId: agent.userId },
      ]);
    });
  });
});
