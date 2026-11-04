import { createDatabase, schema } from '@alocidadao/db';
import {
  agentRowSchema,
  agentsResponseSchema,
  departmentsResponseSchema,
  teamSummarySchema,
  teamsResponseSchema,
  type GeoPoint,
} from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { memberships, teamMembers, users } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

const CENTER: GeoPoint = { lat: -23.0, lng: -47.0 };

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

let phoneCounter = 0;
let emailCounter = 0;
const newEmail = () => `agente.${Date.now()}.${emailCounter++}@teste.dev`;
const newPhone = () =>
  `+5541977${String(Date.now() % 100_000).padStart(5, '0')}${phoneCounter++ % 10}`;

/** Prefeitura com Obras (equipe Norte) e Iluminação (equipe Luz), um admin e um gestor de Obras. */
async function seedBase() {
  const seed = await fx.seedPanelTenant();
  const teamId = await fx.addTeam(seed.tenantId, {
    departmentId: seed.worksId,
    name: 'Equipe Norte',
  });
  const lightTeamId = await fx.addTeam(seed.tenantId, {
    departmentId: seed.lightsId,
    name: 'Equipe Luz',
  });
  const adminId = await fx.newAdmin(seed.tenantId);
  const managerId = await fx.newManager(seed.tenantId, [seed.worksId]);
  return { ...seed, teamId, lightTeamId, adminId, managerId };
}

const membershipOf = async (tenantId: string, userId: string) => {
  const [row] = await owner.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, userId),
        eq(memberships.role, 'field_agent'),
      ),
    );
  return row;
};

const teamOf = async (userId: string) => {
  const rows = await owner.db.select().from(teamMembers).where(eq(teamMembers.userId, userId));
  return rows.map((row) => row.teamId);
};

describe('equipes e agentes na API', () => {
  it('teams list counts agents and open work orders', async () => {
    const base = await seedBase();
    await fx.addAgent(base.tenantId, base.teamId, 'active');
    await fx.addAgent(base.tenantId, base.teamId, 'inactive');
    const occurrenceId = await fx.addOccurrence(base.tenantId, {
      categoryId: base.potholeId,
      at: CENTER,
      status: 'in_progress',
    });
    await fx.addWorkOrder(base.tenantId, { occurrenceId, teamId: base.teamId, status: 'assigned' });
    await fx.addWorkOrder(base.tenantId, {
      occurrenceId,
      teamId: base.teamId,
      status: 'completed',
    });

    const response = await call('GET', '/panel/teams', base.adminId, base.tenantId);
    expect(response.statusCode).toBe(200);
    const { items } = teamsResponseSchema.parse(response.json());
    // Por setor e depois por nome: Iluminação antes de Obras.
    expect(items.map((team) => team.name)).toEqual(['Equipe Luz', 'Equipe Norte']);
    expect(items[1]).toMatchObject({
      departmentName: 'Obras',
      agentCount: 1,
      activeAgentCount: 1,
      openWorkOrderCount: 1,
      baseAddress: null,
      baseLocation: null,
    });
  });

  it('manager cannot see or edit a team of another department', async () => {
    const base = await seedBase();
    const list = await call('GET', '/panel/teams', base.managerId, base.tenantId);
    expect(teamsResponseSchema.parse(list.json()).items.map((team) => team.id)).toEqual([
      base.teamId,
    ]);

    const edit = await call(
      'PATCH',
      `/panel/teams/${base.lightTeamId}`,
      base.managerId,
      base.tenantId,
      {
        name: 'Outro nome',
        baseAddress: null,
        baseLocation: null,
      },
    );
    expect(edit.statusCode).toBe(404);
    const agents = await call(
      'GET',
      `/panel/teams/${base.lightTeamId}/agents`,
      base.managerId,
      base.tenantId,
    );
    expect(agents.statusCode).toBe(404);

    const create = await call('POST', '/panel/teams', base.managerId, base.tenantId, {
      name: 'Nova de Luz',
      departmentId: base.lightsId,
      baseAddress: null,
      baseLocation: null,
    });
    expect(create.statusCode).toBe(422);
    expect(create.json()).toEqual({ code: 'department_not_eligible' });
  });

  it('creating a team with a repeated name is 409 team_name_taken', async () => {
    const base = await seedBase();
    const body = { departmentId: base.worksId, baseAddress: null, baseLocation: null };
    const created = await call('POST', '/panel/teams', base.adminId, base.tenantId, {
      ...body,
      name: 'Equipe Leste',
    });
    expect(created.statusCode).toBe(201);
    expect(teamSummarySchema.parse(created.json()).name).toBe('Equipe Leste');

    const repeated = await call('POST', '/panel/teams', base.adminId, base.tenantId, {
      ...body,
      name: 'equipe LESTE',
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toEqual({ code: 'team_name_taken' });
  });

  it('team base is saved and cleared', async () => {
    const base = await seedBase();
    const saved = await call(
      'PATCH',
      `/panel/teams/${base.teamId}`,
      base.managerId,
      base.tenantId,
      {
        name: 'Equipe Norte',
        baseAddress: 'Rua da Base, 1',
        baseLocation: CENTER,
      },
    );
    expect(saved.statusCode).toBe(200);
    const team = teamSummarySchema.parse(saved.json());
    expect(team.baseAddress).toBe('Rua da Base, 1');
    expect(team.baseLocation?.lat).toBeCloseTo(CENTER.lat, 6);
    expect(team.baseLocation?.lng).toBeCloseTo(CENTER.lng, 6);

    const cleared = await call(
      'PATCH',
      `/panel/teams/${base.teamId}`,
      base.managerId,
      base.tenantId,
      {
        name: 'Equipe Norte',
        baseAddress: '',
        baseLocation: null,
      },
    );
    expect(teamSummarySchema.parse(cleared.json())).toMatchObject({
      baseAddress: null,
      baseLocation: null,
    });
  });

  it('adding an agent with a new phone creates an invited agent', async () => {
    const base = await seedBase();
    const phone = newPhone();
    const response = await call(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.managerId,
      base.tenantId,
      {
        name: 'Novo Agente',
        phone,
        email: newEmail(),
      },
    );
    expect(response.statusCode).toBe(201);
    const row = agentRowSchema.parse(response.json());
    expect(row).toMatchObject({
      name: 'Novo Agente',
      phone,
      status: 'invited',
      lastActiveAt: null,
    });
    expect((await membershipOf(base.tenantId, row.userId))?.status).toBe('invited');
    expect(await teamOf(row.userId)).toEqual([base.teamId]);

    const list = await call(
      'GET',
      `/panel/teams/${base.teamId}/agents`,
      base.managerId,
      base.tenantId,
    );
    expect(agentsResponseSchema.parse(list.json()).items.map((agent) => agent.userId)).toEqual([
      row.userId,
    ]);
  });

  it('adding an agent with a citizen phone keeps the citizen name', async () => {
    const base = await seedBase();
    const response = await call(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.managerId,
      base.tenantId,
      {
        name: 'Nome Digitado',
        phone: base.citizen.phone,
        email: base.citizen.email,
      },
    );
    expect(response.statusCode).toBe(201);
    const row = agentRowSchema.parse(response.json());
    expect(row.userId).toBe(base.citizenId);
    expect(row.name).toBe(base.citizen.name);
  });

  it('adding an agent already in another team is 409', async () => {
    const base = await seedBase();
    const agentId = await fx.addAgent(base.tenantId, base.teamId, 'active');
    const [agent] = await owner.db.select().from(users).where(eq(users.id, agentId));
    const otherTeamId = await fx.addTeam(base.tenantId, {
      departmentId: base.worksId,
      name: 'Equipe Sul',
    });

    const other = await call(
      'POST',
      `/panel/teams/${otherTeamId}/agents`,
      base.adminId,
      base.tenantId,
      {
        name: 'Qualquer',
        phone: agent!.phone,
        email: newEmail(),
      },
    );
    expect(other.statusCode).toBe(409);
    expect(other.json()).toEqual({ code: 'agent_in_other_team', teamName: 'Equipe Norte' });

    const same = await call(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.adminId,
      base.tenantId,
      {
        name: 'Qualquer',
        phone: agent!.phone,
        email: newEmail(),
      },
    );
    expect(same.statusCode).toBe(409);
    expect(same.json()).toEqual({ code: 'agent_already_in_team' });
  });

  it('manager cannot add an agent to a team of another department', async () => {
    const base = await seedBase();
    const response = await call(
      'POST',
      `/panel/teams/${base.lightTeamId}/agents`,
      base.managerId,
      base.tenantId,
      {
        name: 'Novo Agente',
        phone: newPhone(),
        email: newEmail(),
      },
    );
    expect(response.statusCode).toBe(404);
  });

  it('changing the phone of an agent who already signed in is 409', async () => {
    const base = await seedBase();
    const fresh = await call(
      'POST',
      `/panel/teams/${base.teamId}/agents`,
      base.managerId,
      base.tenantId,
      {
        name: 'Agente Novo',
        phone: newPhone(),
        email: newEmail(),
      },
    );
    const freshId = agentRowSchema.parse(fresh.json()).userId;
    const phone = newPhone();
    const changed = await call('PATCH', `/panel/agents/${freshId}`, base.managerId, base.tenantId, {
      action: 'change_phone',
      phone,
    });
    expect(changed.statusCode).toBe(200);
    expect(agentRowSchema.parse(changed.json()).phone).toBe(phone);

    const taken = await call('PATCH', `/panel/agents/${freshId}`, base.managerId, base.tenantId, {
      action: 'change_phone',
      phone: base.citizen.phone,
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ code: 'phone_in_use' });

    const agentId = await fx.addAgent(base.tenantId, base.teamId, 'active');
    await owner.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, agentId));
    const blocked = await call('PATCH', `/panel/agents/${agentId}`, base.managerId, base.tenantId, {
      action: 'change_phone',
      phone: newPhone(),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ code: 'phone_change_not_allowed' });
  });

  it('moving an agent changes the team row', async () => {
    const base = await seedBase();
    const otherTeamId = await fx.addTeam(base.tenantId, {
      departmentId: base.worksId,
      name: 'Equipe Sul',
    });
    const agentId = await fx.addAgent(base.tenantId, base.teamId, 'active');

    const moved = await call('PATCH', `/panel/agents/${agentId}`, base.managerId, base.tenantId, {
      action: 'move',
      teamId: otherTeamId,
    });
    expect(moved.statusCode).toBe(200);
    expect(await teamOf(agentId)).toEqual([otherTeamId]);

    const outside = await call('PATCH', `/panel/agents/${agentId}`, base.managerId, base.tenantId, {
      action: 'move',
      teamId: base.lightTeamId,
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toEqual({ code: 'team_not_eligible' });
    expect(await teamOf(agentId)).toEqual([otherTeamId]);

    const lightAgent = await fx.addAgent(base.tenantId, base.lightTeamId, 'active');
    const hidden = await call(
      'PATCH',
      `/panel/agents/${lightAgent}`,
      base.managerId,
      base.tenantId,
      {
        action: 'deactivate',
      },
    );
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ code: 'agent_not_found' });
  });

  it('deactivate and reactivate follow last_active_at', async () => {
    const base = await seedBase();
    const agentId = await fx.addAgent(base.tenantId, base.teamId, 'active');
    const patch = (action: 'deactivate' | 'reactivate') =>
      call('PATCH', `/panel/agents/${agentId}`, base.managerId, base.tenantId, { action });

    const off = await patch('deactivate');
    expect(agentRowSchema.parse(off.json()).status).toBe('inactive');
    expect(await teamOf(agentId)).toEqual([base.teamId]);

    // Nunca entrou: volta como convidado.
    expect(agentRowSchema.parse((await patch('reactivate')).json()).status).toBe('invited');

    await patch('deactivate');
    await owner.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, agentId));
    const on = agentRowSchema.parse((await patch('reactivate')).json());
    expect(on.status).toBe('active');
    expect(on.lastActiveAt).not.toBeNull();
  });

  it('departments list is scoped for the manager', async () => {
    const base = await seedBase();
    const admin = await call('GET', '/panel/departments', base.adminId, base.tenantId);
    const adminItems = departmentsResponseSchema.parse(admin.json()).items;
    expect(adminItems.map((d) => d.name)).toEqual(['Iluminação', 'Obras']);

    const manager = await call('GET', '/panel/departments', base.managerId, base.tenantId);
    const items = departmentsResponseSchema.parse(manager.json()).items;
    expect(items).toEqual([
      { id: base.worksId, name: 'Obras', categoryCount: 1, teamCount: 1, managerCount: 1 },
    ]);
  });
});
