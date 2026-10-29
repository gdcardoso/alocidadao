import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext } from './client.js';
import {
  categories,
  departments,
  notificationOutbox,
  occurrences,
  panelNotifications,
  tenants,
  users,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono do banco prepara os dados; os testes rodam como app_user, a mesma conexão da API.

const { db: owner, pool: ownerPool } = createDatabase(TEST_OWNER_URL);
const { db: app, pool: appPool } = createDatabase(TEST_APP_URL);

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
const occurrenceIds: Record<string, string> = {};

/** Mensagem original do Postgres (o Drizzle embrulha o erro). */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error && current.cause) current = current.cause;
    return (current as Error).message;
  }
  return '';
}

async function seedTenant(label: string, ibgeCode: string) {
  const [tenant] = await owner
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
  const [department] = await owner
    .insert(departments)
    .values({ tenantId, name: 'Obras' })
    .returning();
  const [category] = await owner
    .insert(categories)
    .values({ tenantId, departmentId: department!.id, name: 'Buraco' })
    .returning();
  const [occurrence] = await owner
    .insert(occurrences)
    .values({
      tenantId,
      categoryId: category!.id,
      location: geoPoint({ lat: -23.55, lng: -46.63 }),
    })
    .returning();
  occurrenceIds[tenantId] = occurrence!.id;
  return tenantId;
}

async function seedUser(label: string) {
  const [user] = await owner
    .insert(users)
    .values({
      name: label,
      email: `${label}.${randomUUID()}@teste.dev`,
      phone: `+5511${Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, '9')}`,
    })
    .returning();
  return user!.id;
}

function notice(tenantId: string, userId: string, protocol: string) {
  return {
    tenantId,
    userId,
    kind: 'occurrence_new',
    protocol,
    occurrenceId: occurrenceIds[tenantId]!,
  };
}

beforeAll(async () => {
  tenantA = await seedTenant('Notif A', '9100001');
  tenantB = await seedTenant('Notif B', '9100002');
  userA = await seedUser('gestora-a');
  userB = await seedUser('gestor-b');
  await owner
    .insert(panelNotifications)
    .values([
      notice(tenantA, userA, 'A-1'),
      notice(tenantA, userB, 'A-2'),
      notice(tenantB, userA, 'B-1'),
    ]);
  await owner.insert(notificationOutbox).values({
    tenantId: tenantA,
    userId: userA,
    channel: 'push',
    kind: 'occurrence_new',
    protocol: 'A-1',
  });
});

afterAll(async () => {
  await ownerPool.end();
  await appPool.end();
});

describe('avisos do sino e fila de envio', () => {
  it('cada pessoa só vê os próprios avisos do sino da prefeitura atual', async () => {
    const rows = await withContext(app, { tenantId: tenantA, userId: userA }, (tx) =>
      tx.select().from(panelNotifications),
    );
    expect(rows.map((row) => row.protocol)).toEqual(['A-1']);

    const other = await withContext(app, { tenantId: tenantA, userId: userB }, (tx) =>
      tx.select().from(panelNotifications),
    );
    expect(other.map((row) => row.protocol)).toEqual(['A-2']);

    const otherTenant = await withContext(app, { tenantId: tenantB, userId: userA }, (tx) =>
      tx.select().from(panelNotifications),
    );
    expect(otherTenant.map((row) => row.protocol)).toEqual(['B-1']);

    const noContext = await withContext(app, {}, (tx) => tx.select().from(panelNotifications));
    expect(noContext).toEqual([]);
  });

  it('a pessoa só marca como lido: não altera outras colunas nem cria ou apaga avisos', async () => {
    const context = { tenantId: tenantA, userId: userA };
    const updated = await withContext(app, context, (tx) =>
      tx
        .update(panelNotifications)
        .set({ readAt: new Date() })
        .where(eq(panelNotifications.protocol, 'A-1'))
        .returning({ id: panelNotifications.id }),
    );
    expect(updated).toHaveLength(1);

    const hidden = await withContext(app, context, (tx) =>
      tx
        .update(panelNotifications)
        .set({ readAt: new Date() })
        .where(eq(panelNotifications.protocol, 'A-2'))
        .returning({ id: panelNotifications.id }),
    );
    expect(hidden).toEqual([]);

    expect(
      await dbError(
        withContext(app, context, (tx) =>
          tx
            .update(panelNotifications)
            .set({ protocol: 'X' })
            .where(sql`true`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withContext(app, context, (tx) =>
          tx.insert(panelNotifications).values(notice(tenantA, userA, 'A-3')),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await dbError(withContext(app, context, (tx) => tx.delete(panelNotifications)))).toMatch(
      /permission denied/,
    );
  });

  it('app_user não lê a fila', async () => {
    const context = { tenantId: tenantA, userId: userA };
    expect(
      await dbError(withContext(app, context, (tx) => tx.select().from(notificationOutbox))),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withContext(app, context, (tx) =>
          tx.insert(notificationOutbox).values({
            tenantId: tenantA,
            userId: userA,
            channel: 'push',
            kind: 'occurrence_new',
            protocol: 'A-9',
          }),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('a fila só aceita canal e status conhecidos', async () => {
    const base = { tenantId: tenantA, userId: userA, kind: 'occurrence_new', protocol: 'A-1' };
    expect(
      await dbError(owner.insert(notificationOutbox).values({ ...base, channel: 'sms' as never })),
    ).toMatch(/notification_outbox_channel_check|violates check/);
    expect(
      await dbError(
        owner
          .insert(notificationOutbox)
          .values({ ...base, channel: 'push', status: 'lost' as never }),
      ),
    ).toMatch(/notification_outbox_status_check|violates check/);
  });
});
