import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { geoPoint, type Database } from './client.js';
import {
  categories,
  departments,
  memberships,
  occurrences,
  requests,
  teamMembers,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';

export const DEMO_IBGE_CODE = '9999901';
const AGENT_EMAIL = 'agente.demo@alocidadao.dev';
const AGENT_PHONE = '+5511900000001';
const CITIZEN_EMAIL = 'cidadao.demo@alocidadao.dev';
const CITIZEN_PHONE = '+5511900000002';
const TEAM_NAME = 'Equipe Obras – Centro';

/** Ponto de referência (centro de São Paulo) em torno do qual ficam as solicitações. */
const CENTER = { lat: -23.5505, lng: -46.6333 };

// Deslocamentos fixos (1e-3 grau de latitude ≈ 111 m; de longitude ≈ 102 m nesta latitude),
// todos a menos de 300 m do centro.
const REQUESTS = [
  { description: 'Buraco na via em frente ao número 100', dLat: 0, dLng: 0.0005 },
  { description: 'Buraco profundo na esquina', dLat: 0.001, dLng: -0.0005 },
  { description: 'Buraco no cruzamento, risco para motos', dLat: -0.0015, dLng: 0.001 },
];

export interface SeedDevResult {
  tenantId: string;
  teamId: string;
  agentId: string;
  workOrderIds: string[];
}

/**
 * Cria a prefeitura de demonstração (IBGE 9999901) com equipe, agente, cidadão e 3 solicitações,
 * cada uma na sua ocorrência, com a atividade da ocorrência atribuída à equipe.
 * Idempotente: se a prefeitura já existe, devolve os ids existentes.
 * Exige a conexão do dono do banco (superusuário): ele cria a prefeitura e os usuários, que são
 * globais, e não passa pelo RLS.
 */
export async function seedDev(db: Database): Promise<SeedDevResult> {
  return db.transaction(async (tx) => {
    // Duas execuções ao mesmo tempo esperam uma pela outra: a segunda já encontra a prefeitura.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('seed-dev'))`);
    const [existing] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ibgeCode, DEMO_IBGE_CODE));
    const tenantId = existing?.id ?? randomUUID();
    // next_request_protocol() lê a prefeitura de app_current_tenant().
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    if (existing) {
      const [team] = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.tenantId, tenantId), eq(teams.name, TEAM_NAME)));
      const [agent] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, AGENT_EMAIL));
      if (!team || !agent) throw new Error('A prefeitura demo existe mas está incompleta');
      const orders = await tx
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.teamId, team.id)))
        .orderBy(asc(workOrders.createdAt));
      return {
        tenantId,
        teamId: team.id,
        agentId: agent.id,
        workOrderIds: orders.map((o) => o.id),
      };
    }

    await tx.insert(tenants).values({
      id: tenantId,
      name: 'Município Demo A',
      displayName: 'Prefeitura Demo A',
      city: 'Demo A',
      state: 'SP',
      ibgeCode: DEMO_IBGE_CODE,
      status: 'active',
    });

    // Usuários são globais e entram sem senha (login por telefone); os dados são só de desenvolvimento.
    const [agent] = await tx
      .insert(users)
      .values({
        name: 'Agente Demo',
        email: AGENT_EMAIL,
        phone: AGENT_PHONE,
      })
      .returning({ id: users.id });
    const [citizen] = await tx
      .insert(users)
      .values({ name: 'Cidadão Demo', email: CITIZEN_EMAIL, phone: CITIZEN_PHONE })
      .returning({ id: users.id });

    await tx.insert(memberships).values([
      { tenantId, userId: agent!.id, role: 'field_agent' },
      { tenantId, userId: citizen!.id, role: 'citizen' },
    ]);

    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning({ id: departments.id });
    const [team] = await tx
      .insert(teams)
      .values({ tenantId, departmentId: department!.id, name: TEAM_NAME })
      .returning({ id: teams.id });
    await tx.insert(teamMembers).values({ tenantId, teamId: team!.id, userId: agent!.id });
    const [category] = await tx
      .insert(categories)
      .values({ tenantId, departmentId: department!.id, name: 'Buraco na via' })
      .returning({ id: categories.id });

    // created_at explícito e crescente: dentro de uma transação now() é igual para todas as
    // linhas, e a ordem por created_at é o que reencontra as atividades na segunda execução.
    const base = Date.now();
    const workOrderIds: string[] = [];
    for (const [index, item] of REQUESTS.entries()) {
      const createdAt = new Date(base + index * 1000);
      const location = geoPoint({ lat: CENTER.lat + item.dLat, lng: CENTER.lng + item.dLng });
      const [occurrence] = await tx
        .insert(occurrences)
        .values({ tenantId, categoryId: category!.id, location, status: 'in_progress', createdAt })
        .returning({ id: occurrences.id });
      await tx.insert(requests).values({
        tenantId,
        citizenId: citizen!.id,
        categoryId: category!.id,
        occurrenceId: occurrence!.id,
        status: 'in_progress',
        description: item.description,
        location,
        gpsLocation: location,
        createdAt,
      });
      const [order] = await tx
        .insert(workOrders)
        .values({
          tenantId,
          occurrenceId: occurrence!.id,
          teamId: team!.id,
          status: 'assigned',
          createdAt,
        })
        .returning({ id: workOrders.id });
      workOrderIds.push(order!.id);
    }

    return { tenantId, teamId: team!.id, agentId: agent!.id, workOrderIds };
  });
}
