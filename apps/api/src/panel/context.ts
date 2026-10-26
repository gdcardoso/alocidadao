import { schema, withContext, type Database } from '@alocidadao/db';
import type { PanelContext, PanelCounts } from '@alocidadao/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { departmentScope, panelDbContext, type PanelIdentity } from './member.js';

const { tenants, users, departments, categories, occurrences, workOrders } = schema;

/** Prefeitura (com o limite), a pessoa, o papel e os setores do alcance. */
export async function loadPanelContext(
  db: Database,
  identity: PanelIdentity,
): Promise<PanelContext> {
  const { userId, tenantId, role, departmentIds } = identity;
  return withContext(db, panelDbContext(identity), async (tx) => {
    const [tenant] = await tx
      .select({
        id: tenants.id,
        displayName: tenants.displayName,
        status: tenants.status,
        west: sql<number | null>`ST_XMin(ST_Extent(${tenants.boundary}))`,
        south: sql<number | null>`ST_YMin(ST_Extent(${tenants.boundary}))`,
        east: sql<number | null>`ST_XMax(ST_Extent(${tenants.boundary}))`,
        north: sql<number | null>`ST_YMax(ST_Extent(${tenants.boundary}))`,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .groupBy(tenants.id);
    const [user] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    const rows =
      departmentIds?.length === 0
        ? []
        : await tx
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(
              and(
                eq(departments.tenantId, tenantId),
                departmentIds === null ? undefined : inArray(departments.id, departmentIds),
              ),
            )
            .orderBy(asc(departments.name), asc(departments.id));

    const { west, south, east, north } = tenant!;
    // requirePanelMember só deixa passar prefeitura em implantação ou ativa.
    const status = tenant!.status as PanelContext['tenant']['status'];
    return {
      tenant: {
        id: tenant!.id,
        displayName: tenant!.displayName,
        status,
        bounds:
          west === null || south === null || east === null || north === null
            ? null
            : [Number(west), Number(south), Number(east), Number(north)],
      },
      user: user!,
      role,
      departments: rows,
    };
  });
}

/**
 * Contadores do menu, no alcance: ocorrências em triagem e atividades aguardando revisão ou
 * impedidas (pela categoria da ocorrência).
 */
export async function loadPanelCounts(db: Database, identity: PanelIdentity): Promise<PanelCounts> {
  const { tenantId } = identity;
  const scope = departmentScope(identity);
  return withContext(db, panelDbContext(identity), async (tx) => {
    const [triage] = await tx
      .select({ n: count() })
      .from(occurrences)
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .where(and(eq(occurrences.tenantId, tenantId), eq(occurrences.status, 'triage'), scope));
    const [orders] = await tx
      .select({
        awaitingReview: sql<number>`count(*) filter (where ${workOrders.status} = 'awaiting_review')`,
        impeded: sql<number>`count(*) filter (where ${workOrders.status} = 'impeded')`,
      })
      .from(workOrders)
      .innerJoin(occurrences, eq(occurrences.id, workOrders.occurrenceId))
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          inArray(workOrders.status, ['awaiting_review', 'impeded']),
          scope,
        ),
      );
    return {
      triage: triage!.n,
      awaitingReview: Number(orders!.awaitingReview),
      impeded: Number(orders!.impeded),
    };
  });
}
