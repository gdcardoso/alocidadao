import { geoPoint, schema, type Database, type Transaction } from '@alocidadao/db';
import type {
  AgentCreateBody,
  AgentRow,
  AgentUpdateBody,
  DepartmentRow,
  DepartmentsResponse,
  GeoPoint,
  TeamCreateBody,
  TeamSummary,
  TeamUpdateBody,
} from '@alocidadao/shared';
import { ACTIVE_WORK_ORDER_STATUSES } from '@alocidadao/shared';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  isPgError,
  isUniqueViolation,
  PHONE_ACTIVE_CONSTRAINT,
  TEAM_MEMBER_CONSTRAINT,
  TEAM_NAME_CONSTRAINT,
  violatedConstraint,
} from '../db-errors.js';
import { Refusal, run, runOrRefuse } from './actions.js';
import type { PanelIdentity } from './member.js';
import { sqlList } from './occurrences.js';

const { memberships, teamMembers, teams, users } = schema;

type TeamsError =
  | { status: 404; code: 'team_not_found' | 'agent_not_found' }
  | {
      status: 409;
      code:
        | 'team_name_taken'
        | 'agent_already_in_team'
        | 'phone_change_not_allowed'
        | 'phone_in_use'
        | 'staff_account_not_allowed';
    }
  | { status: 409; code: 'agent_in_other_team'; teamName?: string }
  | { status: 422; code: 'department_not_eligible' | 'team_not_eligible' };

export type TeamsResult<T> = { ok: T } | { error: TeamsError };

const fail = (error: TeamsError) => ({ error }) as const;

const runTeams = <T>(db: Database, identity: PanelIdentity, fn: (tx: Transaction) => Promise<T>) =>
  runOrRefuse<TeamsError, T>(db, identity, fn);

const inScope = (identity: PanelIdentity, departmentId: string) =>
  identity.departmentIds === null || identity.departmentIds.includes(departmentId);

/** Filtro SQL do alcance sobre uma coluna `department_id` (lista vazia não vê nada). */
const scopeSql = (identity: PanelIdentity, column: SQL): SQL =>
  identity.departmentIds === null
    ? sql`true`
    : identity.departmentIds.length === 0
      ? sql`false`
      : sql`${column} IN (${sqlList(identity.departmentIds)})`;

// ── Equipes ──

type TeamRow = {
  id: string;
  name: string;
  department_id: string;
  department_name: string;
  base_address: string | null;
  base_lat: number | null;
  base_lng: number | null;
  agent_count: number;
  active_agent_count: number;
  open_work_order_count: number;
};

async function queryTeams(
  tx: Transaction,
  identity: PanelIdentity,
  teamId?: string,
): Promise<TeamSummary[]> {
  const result = await tx.execute<TeamRow>(sql`
    SELECT
      t.id, t.name, t.department_id, d.name AS department_name, t.base_address,
      ST_Y(t.base_location)::float8 AS base_lat,
      ST_X(t.base_location)::float8 AS base_lng,
      (SELECT count(*) FROM team_members tm
        JOIN memberships m ON m.tenant_id = tm.tenant_id AND m.user_id = tm.user_id
          AND m.role = 'field_agent'
        WHERE tm.team_id = t.id AND m.status IN ('active', 'invited'))::int AS agent_count,
      (SELECT count(*) FROM team_members tm
        JOIN memberships m ON m.tenant_id = tm.tenant_id AND m.user_id = tm.user_id
          AND m.role = 'field_agent'
        WHERE tm.team_id = t.id AND m.status = 'active')::int AS active_agent_count,
      (SELECT count(*) FROM work_orders w
        WHERE w.tenant_id = t.tenant_id AND w.team_id = t.id
          AND w.status IN (${sqlList(ACTIVE_WORK_ORDER_STATUSES)}))::int AS open_work_order_count
    FROM teams t
    JOIN departments d ON d.tenant_id = t.tenant_id AND d.id = t.department_id
    WHERE t.tenant_id = ${identity.tenantId}
      AND ${teamId ? sql`t.id = ${teamId}` : sql`true`}
      AND ${scopeSql(identity, sql`t.department_id`)}
    ORDER BY d.name, t.name, t.id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    baseAddress: row.base_address,
    baseLocation:
      row.base_lat === null || row.base_lng === null
        ? null
        : { lat: Number(row.base_lat), lng: Number(row.base_lng) },
    agentCount: Number(row.agent_count),
    activeAgentCount: Number(row.active_agent_count),
    openWorkOrderCount: Number(row.open_work_order_count),
  }));
}

export function loadTeams(db: Database, identity: PanelIdentity) {
  return run(db, identity, (tx) => queryTeams(tx, identity));
}

const pointValue = (point: GeoPoint | null) => (point === null ? null : geoPoint(point));

export async function createTeam(
  db: Database,
  identity: PanelIdentity,
  body: TeamCreateBody,
): Promise<TeamsResult<TeamSummary>> {
  if (!inScope(identity, body.departmentId)) return fail(DEPARTMENT_NOT_ELIGIBLE);
  try {
    return await runTeams(db, identity, async (tx) => {
      const departments = await tx.execute<{ id: string }>(
        sql`SELECT id FROM departments WHERE tenant_id = ${identity.tenantId} AND id = ${body.departmentId}`,
      );
      if (departments.rows.length === 0) throw new Refusal(DEPARTMENT_NOT_ELIGIBLE);
      const [team] = await tx
        .insert(teams)
        .values({
          tenantId: identity.tenantId,
          departmentId: body.departmentId,
          name: body.name,
          baseAddress: body.baseAddress,
          baseLocation: pointValue(body.baseLocation),
        })
        .returning({ id: teams.id });
      return (await queryTeams(tx, identity, team!.id))[0]!;
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedConstraint(error) === TEAM_NAME_CONSTRAINT) {
      return fail({ status: 409, code: 'team_name_taken' });
    }
    throw error;
  }
}

const DEPARTMENT_NOT_ELIGIBLE = { status: 422, code: 'department_not_eligible' } as const;
const TEAM_NOT_FOUND = { status: 404, code: 'team_not_found' } as const;
const AGENT_NOT_FOUND = { status: 404, code: 'agent_not_found' } as const;
const STAFF_ACCOUNT_NOT_ALLOWED = { status: 409, code: 'staff_account_not_allowed' } as const;

/** Conta da equipe interna não vira agente: cadastro (0026) ou reativação (trigger de memberships). */
const isStaffAccount = (error: unknown) => isPgError(error, '23514', 'staff_account_not_allowed');
const TEAM_NOT_ELIGIBLE = { status: 422, code: 'team_not_eligible' } as const;

export async function updateTeam(
  db: Database,
  identity: PanelIdentity,
  teamId: string,
  body: TeamUpdateBody,
): Promise<TeamsResult<TeamSummary>> {
  try {
    return await runTeams(db, identity, async (tx) => {
      if ((await queryTeams(tx, identity, teamId)).length === 0) throw new Refusal(TEAM_NOT_FOUND);
      await tx
        .update(teams)
        .set({
          name: body.name,
          baseAddress: body.baseAddress,
          baseLocation: pointValue(body.baseLocation),
        })
        .where(and(eq(teams.tenantId, identity.tenantId), eq(teams.id, teamId)));
      return (await queryTeams(tx, identity, teamId))[0]!;
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedConstraint(error) === TEAM_NAME_CONSTRAINT) {
      return fail({ status: 409, code: 'team_name_taken' });
    }
    throw error;
  }
}

// ── Agentes ──

type AgentQueryRow = {
  user_id: string;
  name: string;
  phone: string | null;
  status: AgentRow['status'];
  last_active_ms: number | null;
};

async function queryAgents(
  tx: Transaction,
  identity: PanelIdentity,
  filter: { teamId?: string; userId?: string },
): Promise<AgentRow[]> {
  const result = await tx.execute<AgentQueryRow>(sql`
    SELECT u.id AS user_id, u.name, u.phone, m.status,
      (extract(epoch FROM u.last_active_at) * 1000)::float8 AS last_active_ms
    FROM team_members tm
    JOIN teams t ON t.tenant_id = tm.tenant_id AND t.id = tm.team_id
    JOIN memberships m ON m.tenant_id = tm.tenant_id AND m.user_id = tm.user_id
      AND m.role = 'field_agent'
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ${identity.tenantId}
      AND ${filter.teamId ? sql`tm.team_id = ${filter.teamId}` : sql`true`}
      AND ${filter.userId ? sql`tm.user_id = ${filter.userId}` : sql`true`}
      AND ${scopeSql(identity, sql`t.department_id`)}
    ORDER BY (m.status = 'inactive'), lower(u.name), u.id
  `);
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    phone: row.phone,
    status: row.status,
    lastActiveAt: row.last_active_ms === null ? null : new Date(row.last_active_ms).toISOString(),
  }));
}

export async function loadTeamAgents(
  db: Database,
  identity: PanelIdentity,
  teamId: string,
): Promise<{ items: AgentRow[] } | undefined> {
  return run(db, identity, async (tx) => {
    if ((await queryTeams(tx, identity, teamId)).length === 0) return undefined;
    return { items: await queryAgents(tx, identity, { teamId }) };
  });
}

export async function addAgent(
  db: Database,
  identity: PanelIdentity,
  teamId: string,
  body: AgentCreateBody,
): Promise<TeamsResult<AgentRow>> {
  try {
    return await runTeams(db, identity, async (tx) => {
      if ((await queryTeams(tx, identity, teamId)).length === 0) throw new Refusal(TEAM_NOT_FOUND);

      const found = await tx.execute<{ id: string }>(
        sql`SELECT id FROM panel_find_or_create_agent_user(${body.name}, ${body.phone}, NULL)`,
      );
      const userId = found.rows[0]!.id;

      const current = await tx
        .select({ teamId: teamMembers.teamId, teamName: teams.name })
        .from(teamMembers)
        .innerJoin(
          teams,
          and(eq(teams.tenantId, teamMembers.tenantId), eq(teams.id, teamMembers.teamId)),
        )
        .where(and(eq(teamMembers.tenantId, identity.tenantId), eq(teamMembers.userId, userId)))
        .limit(1);
      if (current[0]) {
        throw new Refusal(
          current[0].teamId === teamId
            ? { status: 409, code: 'agent_already_in_team' }
            : { status: 409, code: 'agent_in_other_team', teamName: current[0].teamName },
        );
      }

      const existing = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, identity.tenantId),
            eq(memberships.userId, userId),
            eq(memberships.role, 'field_agent'),
          ),
        );
      if (existing.length === 0) {
        await tx
          .insert(memberships)
          .values({ tenantId: identity.tenantId, userId, role: 'field_agent', status: 'invited' });
      } else if (existing[0]!.status === 'inactive') {
        await setAgentStatus(tx, identity, userId, 'invited');
      }
      await tx.insert(teamMembers).values({ tenantId: identity.tenantId, teamId, userId });

      return (await queryAgents(tx, identity, { userId }))[0]!;
    });
  } catch (error) {
    if (isStaffAccount(error)) return fail(STAFF_ACCOUNT_NOT_ALLOWED);
    if (isUniqueViolation(error) && violatedConstraint(error) === PHONE_ACTIVE_CONSTRAINT) {
      return fail({ status: 409, code: 'phone_in_use' });
    }
    // Outro pedido pôs o agente em outra equipe entre a conferência e a inclusão.
    if (isUniqueViolation(error) && violatedConstraint(error) === TEAM_MEMBER_CONSTRAINT) {
      return fail({ status: 409, code: 'agent_in_other_team' });
    }
    throw error;
  }
}

const setAgentStatus = (
  tx: Transaction,
  identity: PanelIdentity,
  userId: string,
  status: AgentRow['status'],
) =>
  tx
    .update(memberships)
    .set({ status })
    .where(
      and(
        eq(memberships.tenantId, identity.tenantId),
        eq(memberships.userId, userId),
        eq(memberships.role, 'field_agent'),
      ),
    );

export async function updateAgent(
  db: Database,
  identity: PanelIdentity,
  userId: string,
  body: AgentUpdateBody,
): Promise<TeamsResult<AgentRow>> {
  try {
    return await runTeams(db, identity, async (tx) => {
      const [agent] = await queryAgents(tx, identity, { userId });
      if (!agent) throw new Refusal(AGENT_NOT_FOUND);

      switch (body.action) {
        case 'change_phone':
          await tx.execute(sql`SELECT panel_change_agent_phone(${userId}, ${body.phone})`);
          break;
        case 'move': {
          if ((await queryTeams(tx, identity, body.teamId)).length === 0) {
            throw new Refusal(TEAM_NOT_ELIGIBLE);
          }
          await tx
            .update(teamMembers)
            .set({ teamId: body.teamId })
            .where(
              and(eq(teamMembers.tenantId, identity.tenantId), eq(teamMembers.userId, userId)),
            );
          break;
        }
        case 'deactivate':
          await setAgentStatus(tx, identity, userId, 'inactive');
          break;
        case 'reactivate': {
          const [row] = await tx
            .select({ lastActiveAt: users.lastActiveAt })
            .from(users)
            .where(eq(users.id, userId));
          await setAgentStatus(tx, identity, userId, row?.lastActiveAt ? 'active' : 'invited');
          break;
        }
      }
      return (await queryAgents(tx, identity, { userId }))[0]!;
    });
  } catch (error) {
    if (isStaffAccount(error)) return fail(STAFF_ACCOUNT_NOT_ALLOWED);
    if (isPgError(error, '23514', 'phone_change_not_allowed')) {
      return fail({ status: 409, code: 'phone_change_not_allowed' });
    }
    if (isPgError(error, 'P0002')) return fail(AGENT_NOT_FOUND);
    if (isUniqueViolation(error) && violatedConstraint(error) === PHONE_ACTIVE_CONSTRAINT) {
      return fail({ status: 409, code: 'phone_in_use' });
    }
    throw error;
  }
}

// ── Setores ──

type DepartmentQueryRow = {
  id: string;
  name: string;
  category_count: number;
  team_count: number;
  manager_count: number;
};

/** Setores no alcance, com as contagens; `departmentId` limita a um só. */
export async function queryDepartments(
  tx: Transaction,
  identity: PanelIdentity,
  departmentId?: string,
): Promise<DepartmentRow[]> {
  const result = await tx.execute<DepartmentQueryRow>(sql`
    SELECT d.id, d.name,
      (SELECT count(*) FROM categories c
        WHERE c.tenant_id = d.tenant_id AND c.department_id = d.id)::int AS category_count,
      (SELECT count(*) FROM teams t
        WHERE t.tenant_id = d.tenant_id AND t.department_id = d.id)::int AS team_count,
      (SELECT count(*) FROM department_managers dm
        JOIN memberships m ON m.tenant_id = dm.tenant_id AND m.user_id = dm.user_id
          AND m.role = 'manager' AND m.status = 'active'
        WHERE dm.department_id = d.id)::int AS manager_count
    FROM departments d
    WHERE d.tenant_id = ${identity.tenantId}
      AND ${departmentId ? sql`d.id = ${departmentId}` : sql`true`}
      AND ${scopeSql(identity, sql`d.id`)}
    ORDER BY d.name, d.id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryCount: Number(row.category_count),
    teamCount: Number(row.team_count),
    managerCount: Number(row.manager_count),
  }));
}

export async function loadDepartments(
  db: Database,
  identity: PanelIdentity,
): Promise<DepartmentsResponse> {
  return { items: await run(db, identity, (tx) => queryDepartments(tx, identity)) };
}
