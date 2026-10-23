import type { RequestStatus } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { listOwnRequests, ownRequestTenant } from './citizen.js';
import { createDatabase, geoPoint, withContext } from './client.js';
import {
  categories,
  departments,
  municipalities,
  occurrences,
  requests,
  tenants,
  users,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono prepara os dados; as leituras rodam como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const POINT = { lat: -10.5, lng: -60.5 };

interface TenantSeed {
  tenantId: string;
  categoryId: string;
}

let x: TenantSeed;
let y: TenantSeed;
let citizenA: string;
let citizenB: string;
/** Ids das solicitações por apelido. */
const ids: Record<string, string> = {};

async function seedTenant(label: string, ibgeCode: string): Promise<TenantSeed> {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'SP',
      ibgeCode,
      status: 'active',
    })
    .returning();
  const tenantId = tenant!.id;
  return withContext(owner.db, { tenantId }, async (tx) => {
    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning();
    const [category] = await tx
      .insert(categories)
      .values({
        tenantId,
        departmentId: department!.id,
        name: `Iluminação ${label}`,
        icon: 'lightbulb',
        iconGroup: 'infrastructure',
      })
      .returning();
    return { tenantId, categoryId: category!.id };
  });
}

async function newCitizen(label: string, phone: string): Promise<string> {
  const [user] = await owner.db
    .insert(users)
    .values({ name: `Cidadão ${label}`, phone })
    .returning({ id: users.id });
  return user!.id;
}

async function newRequest(
  seed: TenantSeed,
  citizenId: string,
  status: RequestStatus,
  statusChangedAt: Date,
): Promise<string> {
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [occurrence] = await tx
      .insert(occurrences)
      .values({
        tenantId: seed.tenantId,
        categoryId: seed.categoryId,
        location: geoPoint(POINT),
        status: 'triage',
      })
      .returning();
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId: seed.tenantId,
        citizenId,
        categoryId: seed.categoryId,
        occurrenceId: occurrence!.id,
        status,
        description: 'Poste apagado',
        location: geoPoint(POINT),
        gpsLocation: geoPoint(POINT),
        address: 'Rua das Flores, 10',
        statusChangedAt,
      })
      .returning({ id: requests.id });
    return request!.id;
  });
}

const ALL: RequestStatus[] = [
  'open',
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'cancelled',
  'rejected',
];

function listAs(userId: string | undefined, statuses: RequestStatus[]) {
  return withContext(app.db, userId ? { userId } : {}, (tx) => listOwnRequests(tx, statuses));
}

beforeAll(async () => {
  x = await seedTenant('cidadao-x', '0000041');
  y = await seedTenant('cidadao-y', '0000042');
  citizenA = await newCitizen('A', '+5511940000041');
  citizenB = await newCitizen('B', '+5511940000042');
  ids.aOpenX = await newRequest(x, citizenA, 'open', new Date('2026-10-20T10:00:00Z'));
  ids.aDoneX = await newRequest(x, citizenA, 'completed', new Date('2026-10-22T10:00:00Z'));
  ids.aAwaitingY = await newRequest(
    y,
    citizenA,
    'awaiting_confirmation',
    new Date('2026-10-01T10:00:00Z'),
  );
  ids.aProgressY = await newRequest(y, citizenA, 'in_progress', new Date('2026-10-21T10:00:00Z'));
  ids.bOpenX = await newRequest(x, citizenB, 'open', new Date('2026-10-23T10:00:00Z'));
});

describe('listOwnRequests', () => {
  it('cidadão lista só as próprias solicitações, de todas as prefeituras', async () => {
    const rows = await listAs(citizenA, ALL);
    expect(rows.map((r) => r.id).toSorted()).toEqual(
      [ids.aOpenX, ids.aDoneX, ids.aAwaitingY, ids.aProgressY].toSorted(),
    );
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([x.tenantId, y.tenantId]));
    const card = rows.find((r) => r.id === ids.aOpenX)!;
    expect(card).toMatchObject({
      tenantId: x.tenantId,
      status: 'open',
      categoryName: 'Iluminação cidadao-x',
      icon: 'lightbulb',
      iconGroup: 'infrastructure',
      address: 'Rua das Flores, 10',
    });
    expect(card.protocol).toMatch(/^\d{4}-\d{6}$/);
    expect(card.createdAt).toBeInstanceOf(Date);
    expect(card.statusChangedAt.toISOString()).toBe('2026-10-20T10:00:00.000Z');

    const ofB = await listAs(citizenB, ALL);
    expect(ofB.map((r) => r.id)).toEqual([ids.bOpenX]);
  });

  it('filtro por status', async () => {
    const rows = await listAs(citizenA, ['completed', 'cancelled', 'rejected']);
    expect(rows.map((r) => r.id)).toEqual([ids.aDoneX]);
    expect(await listAs(citizenA, [])).toEqual([]);
  });

  it('aguardando confirmação vem primeiro', async () => {
    const rows = await listAs(citizenA, ALL);
    // Depois da que aguarda confirmação, da mudança de status mais recente para a mais antiga.
    expect(rows.map((r) => r.id)).toEqual([ids.aAwaitingY, ids.aDoneX, ids.aProgressY, ids.aOpenX]);
  });

  it('sem usuário no contexto não devolve nada', async () => {
    expect(await listAs(undefined, ALL)).toEqual([]);
  });
});

describe('ownRequestTenant', () => {
  it('devolve a prefeitura da própria solicitação', async () => {
    const tenantId = await withContext(app.db, { userId: citizenA }, (tx) =>
      ownRequestTenant(tx, ids.aAwaitingY!),
    );
    expect(tenantId).toBe(y.tenantId);
  });

  it('ownRequestTenant devolve nulo para solicitação alheia', async () => {
    const tenantId = await withContext(app.db, { userId: citizenB }, (tx) =>
      ownRequestTenant(tx, ids.aOpenX!),
    );
    expect(tenantId).toBeNull();
    const noUser = await withContext(app.db, {}, (tx) => ownRequestTenant(tx, ids.aOpenX!));
    expect(noUser).toBeNull();
  });
});

describe('isolamento de requests', () => {
  it('contexto da prefeitura não mostra solicitações do próprio usuário em outra prefeitura', async () => {
    const rows = await withContext(app.db, { tenantId: x.tenantId, userId: citizenA }, (tx) =>
      tx.select({ id: requests.id, tenantId: requests.tenantId }).from(requests),
    );
    const found = rows.map((r) => r.id);
    expect(found).not.toContain(ids.aAwaitingY);
    expect(found).not.toContain(ids.aProgressY);
    expect(rows.every((r) => r.tenantId === x.tenantId)).toBe(true);
  });

  it('sem contexto de prefeitura, a leitura direta não devolve nada', async () => {
    const rows = await withContext(app.db, { userId: citizenA }, (tx) =>
      tx.select({ id: requests.id }).from(requests),
    );
    expect(rows).toEqual([]);
  });
});

describe('municipalities', () => {
  it('app_user não grava em municipalities', async () => {
    let message = '';
    try {
      await app.db.insert(municipalities).values({
        ibgeCode: '9999899',
        name: 'Proibido',
        state: 'SP',
        boundary: sql`ST_Multi(ST_MakeEnvelope(0, 0, 1, 1, 4326))`,
      });
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause;
      message = cause?.message ?? (error as Error).message;
    }
    expect(message).toMatch(/permission denied/);
  });
});
