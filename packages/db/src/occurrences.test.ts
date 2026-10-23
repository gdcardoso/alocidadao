import { randomUUID } from 'node:crypto';
import { distanceMeters, type GeoPoint } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext, type Database } from './client.js';
import {
  categories,
  departments,
  memberships,
  occurrences,
  photos,
  requests,
  statusEvents,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono do banco prepara os dados; os testes rodam como app_user (mesma conexão da API).

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const GPS: GeoPoint = { lat: -23.55, lng: -46.63 };
const EARTH_RADIUS_M = 6_371_008.8;

interface TenantSeed {
  tenantId: string;
  citizenId: string;
  categoryId: string;
  otherCategoryId: string;
  teamId: string;
  occurrenceId: string;
  requestId: string;
  photoId: string;
}

let a: TenantSeed;
let b: TenantSeed;

/** Ponto `meters` metros ao norte de `point`, na mesma esfera da `distanceMeters`. */
function north(point: GeoPoint, meters: number): GeoPoint {
  return { lat: point.lat + ((meters / EARTH_RADIUS_M) * 180) / Math.PI, lng: point.lng };
}

async function seedTenant(db: Database, label: string, ibgeCode: string): Promise<TenantSeed> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: `Prefeitura ${label}`, city: label, state: 'SP', ibgeCode, active: true })
    .returning();
  const tenantId = tenant!.id;
  const [citizen] = await db
    .insert(users)
    .values({
      name: `Cidadão ${label}`,
      email: `cidadao.${label}@ocorrencias.dev`,
      passwordHash: 'x',
    })
    .returning();
  const citizenId = citizen!.id;

  return withContext(db, { tenantId }, async (tx) => {
    await tx.insert(memberships).values({ tenantId, userId: citizenId, role: 'citizen' });
    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning();
    const [team] = await tx
      .insert(teams)
      .values({ tenantId, departmentId: department!.id, name: 'Equipe 1' })
      .returning();
    const [category, otherCategory] = await tx
      .insert(categories)
      .values([
        { tenantId, departmentId: department!.id, name: 'Buraco na via' },
        { tenantId, departmentId: department!.id, name: 'Calçada quebrada' },
      ])
      .returning();
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId, categoryId: category!.id, location: geoPoint(GPS) })
      .returning();
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId,
        citizenId,
        categoryId: category!.id,
        occurrenceId: occurrence!.id,
        description: `Buraco na rua principal de ${label}`,
        location: geoPoint(GPS),
        gpsLocation: geoPoint(GPS),
      })
      .returning();
    const [photo] = await tx
      .insert(photos)
      .values({
        tenantId,
        requestId: request!.id,
        storageKey: `${tenantId}/${randomUUID()}.jpg`,
        uploadedBy: citizenId,
      })
      .returning();
    return {
      tenantId,
      citizenId,
      categoryId: category!.id,
      otherCategoryId: otherCategory!.id,
      teamId: team!.id,
      occurrenceId: occurrence!.id,
      requestId: request!.id,
      photoId: photo!.id,
    };
  });
}

/** Cria uma ocorrência nova na prefeitura A (como app_user), para o teste não depender de outro. */
function newOccurrence(categoryId = a.categoryId) {
  return withContext(app.db, { tenantId: a.tenantId }, async (tx) => {
    const [row] = await tx
      .insert(occurrences)
      .values({ tenantId: a.tenantId, categoryId, location: geoPoint(GPS) })
      .returning();
    return row!.id;
  });
}

function insertRequest(values: {
  occurrenceId: string;
  categoryId?: string;
  location?: GeoPoint;
  gpsLocation?: GeoPoint;
}) {
  return withContext(app.db, { tenantId: a.tenantId }, async (tx) => {
    const [row] = await tx
      .insert(requests)
      .values({
        tenantId: a.tenantId,
        citizenId: a.citizenId,
        categoryId: values.categoryId ?? a.categoryId,
        occurrenceId: values.occurrenceId,
        description: 'Buraco perto do ponto de ônibus',
        location: geoPoint(values.location ?? GPS),
        gpsLocation: geoPoint(values.gpsLocation ?? GPS),
      })
      .returning();
    return row!;
  });
}

function insertWorkOrder(occurrenceId: string, status: 'assigned' | 'impeded' = 'assigned') {
  return withContext(app.db, { tenantId: a.tenantId }, async (tx) => {
    const [row] = await tx
      .insert(workOrders)
      .values({ tenantId: a.tenantId, occurrenceId, teamId: a.teamId, status })
      .returning();
    return row!.id;
  });
}

function insertPhoto(values: {
  requestId?: string;
  workOrderId?: string;
  review?: 'pending' | 'published' | 'discarded';
}) {
  return withContext(app.db, { tenantId: a.tenantId }, (tx) =>
    tx.insert(photos).values({
      tenantId: a.tenantId,
      storageKey: `${a.tenantId}/${randomUUID()}.jpg`,
      uploadedBy: a.citizenId,
      ...values,
    }),
  );
}

/** Drizzle embrulha o erro do Postgres; devolve a mensagem original. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error('Era esperado que o banco recusasse a operação');
}

beforeAll(async () => {
  a = await seedTenant(owner.db, 'ocorrencias-a', '0000021');
  b = await seedTenant(owner.db, 'ocorrencias-b', '0000022');
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('ocorrências e fotos', () => {
  it('não lê ocorrência nem foto de outra prefeitura', async () => {
    const rows = await withContext(app.db, { tenantId: a.tenantId }, async (tx) => ({
      occurrence: await tx.select().from(occurrences).where(eq(occurrences.id, b.occurrenceId)),
      photo: await tx.select().from(photos).where(eq(photos.id, b.photoId)),
      allPhotos: await tx.select({ id: photos.id }).from(photos),
    }));
    expect(rows.occurrence).toHaveLength(0);
    expect(rows.photo).toHaveLength(0);
    expect(rows.allPhotos.map((p) => p.id)).not.toContain(b.photoId);
  });

  it('recusa solicitação com categoria diferente da ocorrência', async () => {
    const occurrenceId = await newOccurrence();
    const message = await dbError(insertRequest({ occurrenceId, categoryId: a.otherCategoryId }));
    expect(message).toMatch(/foreign key/);
  });

  it('reclassificar a ocorrência leva as solicitações junto', async () => {
    const occurrenceId = await newOccurrence();
    const request = await insertRequest({ occurrenceId });

    const reclassified = await withContext(app.db, { tenantId: a.tenantId }, async (tx) => {
      await tx
        .update(occurrences)
        .set({ categoryId: a.otherCategoryId })
        .where(eq(occurrences.id, occurrenceId));
      const [row] = await tx
        .select({ categoryId: requests.categoryId })
        .from(requests)
        .where(eq(requests.id, request.id));
      return row!;
    });
    expect(reclassified.categoryId).toBe(a.otherCategoryId);
  });

  it('recusa local ajustado a mais de 205 m do GPS', async () => {
    const occurrenceId = await newOccurrence();
    const message = await dbError(
      insertRequest({ occurrenceId, gpsLocation: GPS, location: north(GPS, 210) }),
    );
    expect(message).toMatch(/requests_location_adjust_check/);

    // 200 m é o limite do shared (haversine); o banco aceita.
    const adjusted = north(GPS, 200);
    expect(distanceMeters(GPS, adjusted)).toBeCloseTo(200, 6);
    const request = await insertRequest({ occurrenceId, gpsLocation: GPS, location: adjusted });
    expect(request.id).toBeDefined();
  });

  it('permite só uma atividade ativa por ocorrência', async () => {
    const occurrenceId = await newOccurrence();
    await insertWorkOrder(occurrenceId);
    expect(await dbError(insertWorkOrder(occurrenceId))).toMatch(
      /work_orders_one_active_per_occurrence_idx/,
    );
  });

  it('atividade impedida ainda conta como ativa', async () => {
    const occurrenceId = await newOccurrence();
    const impededId = await insertWorkOrder(occurrenceId, 'impeded');
    expect(await dbError(insertWorkOrder(occurrenceId))).toMatch(
      /work_orders_one_active_per_occurrence_idx/,
    );

    await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.update(workOrders).set({ status: 'cancelled' }).where(eq(workOrders.id, impededId)),
    );
    expect(await insertWorkOrder(occurrenceId)).toBeDefined();
  });

  it('foto pertence a uma solicitação ou a uma atividade', async () => {
    const occurrenceId = await newOccurrence();
    const request = await insertRequest({ occurrenceId });
    const workOrderId = await insertWorkOrder(occurrenceId);

    expect(
      await dbError(insertPhoto({ requestId: request.id, workOrderId, review: 'pending' })),
    ).toMatch(/photos_owner_check/);
    expect(await dbError(insertPhoto({}))).toMatch(/photos_owner_check/);
    expect(await dbError(insertPhoto({ requestId: request.id, review: 'pending' }))).toMatch(
      /photos_review_check/,
    );
    expect(await dbError(insertPhoto({ workOrderId }))).toMatch(/photos_review_check/);

    await insertPhoto({ requestId: request.id });
    await insertPhoto({ workOrderId, review: 'pending' });
  });

  it('a revisão é a única alteração permitida na foto', async () => {
    const occurrenceId = await newOccurrence();
    const workOrderId = await insertWorkOrder(occurrenceId);
    await insertPhoto({ workOrderId, review: 'pending' });

    const reviewed = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx
        .update(photos)
        .set({ review: 'published' })
        .where(eq(photos.workOrderId, workOrderId))
        .returning(),
    );
    expect(reviewed.map((p) => p.review)).toEqual(['published']);

    const message = await dbError(
      withContext(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.update(photos).set({ storageKey: 'outra' }).where(eq(photos.workOrderId, workOrderId)),
      ),
    );
    expect(message).toMatch(/permission denied/);
  });

  it('histórico aceita evento de ocorrência sem solicitação', async () => {
    const occurrenceId = await newOccurrence();
    const [event] = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx
        .insert(statusEvents)
        .values({
          tenantId: a.tenantId,
          occurrenceId,
          toStatus: 'rejected',
          details: { reason: 'Fora da área do município' },
        })
        .returning(),
    );
    expect(event!.requestId).toBeNull();
  });
});
