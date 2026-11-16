import { describe, expect, it, vi } from 'vitest';
import { nodeDb, type NodeDb } from './node-db';
import { processOutbox, type OutboxItem } from './outbox';
import {
  OUTBOX_SCHEMA_VERSION,
  SqliteOutboxStore,
  createDatabaseOpener,
  fromOutboxRow,
  migrateOutbox,
  toOutboxRow,
  type AppDb,
  type OutboxRow,
} from './outbox-schema';
import { FakeTransport, actionOf, fakeConnection, makeItem, makeRequestItem } from './test-helpers';

/** Tabela da fila antes do `user_version` (só ações do agente). */
const V0_TABLE = `
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY NOT NULL,
    work_order_id TEXT NOT NULL,
    action TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    note TEXT,
    photo_paths TEXT NOT NULL,
    photo_keys TEXT NOT NULL,
    created_offline INTEGER NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX outbox_due ON outbox (status, next_attempt_at, created_at);
`;

const userVersion = (db: NodeDb) =>
  (db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const listItems = async (db: AppDb) =>
  (await db.getAllAsync<OutboxRow>('SELECT * FROM outbox ORDER BY created_at', [])).map(
    fromOutboxRow,
  );

describe('outbox migrations', () => {
  it('migrates version 0 items to work_order_action', async () => {
    const db = nodeDb();
    db.raw.exec(V0_TABLE);
    db.raw
      .prepare(`INSERT INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'item-1',
        'wo-1',
        'complete',
        '2026-10-22T10:00:00.000Z',
        'Serviço feito',
        '["/outbox/item-1/0.jpg"]',
        '["k1"]',
        1,
        'pending',
        2,
        500,
        'timeout',
        10,
      );
    db.raw
      .prepare(`INSERT INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'item-2',
        'wo-2',
        'start',
        '2026-10-22T11:00:00.000Z',
        null,
        '[]',
        '[]',
        0,
        'done',
        0,
        0,
        null,
        20,
      );

    await migrateOutbox(db, async () => 'owner-1');

    expect(userVersion(db)).toBe(OUTBOX_SCHEMA_VERSION);
    expect(await listItems(db)).toEqual([
      {
        id: 'item-1',
        kind: 'work_order_action',
        userId: 'owner-1',
        payload: {
          workOrderId: 'wo-1',
          action: 'complete',
          occurredAt: '2026-10-22T10:00:00.000Z',
          note: 'Serviço feito',
        },
        photoPaths: ['/outbox/item-1/0.jpg'],
        photoKeys: ['k1'],
        createdOffline: true,
        // Sem prefeitura no item: a versão 2 recusa (a ação do Laboratório não tem para onde ir).
        status: 'rejected',
        rejection: { code: 'missing_tenant' },
        attempts: 2,
        nextAttemptAt: 500,
        lastError: 'missing_tenant',
        createdAt: 10,
      },
      expect.objectContaining({
        id: 'item-2',
        userId: 'owner-1',
        payload: expect.objectContaining({ workOrderId: 'wo-2', action: 'start', note: null }),
        status: 'done',
      }),
    ]);
  });

  it('uses an empty owner when none is stored', async () => {
    const db = nodeDb();
    db.raw.exec(V0_TABLE);
    db.raw
      .prepare(`INSERT INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'item-1',
        'wo-1',
        'start',
        '2026-10-22T10:00:00.000Z',
        null,
        '[]',
        '[]',
        0,
        'pending',
        0,
        0,
        null,
        1,
      );
    await migrateOutbox(db, async () => null);
    expect((await listItems(db))[0]?.userId).toBe('');
  });

  it('creates the current table on a new database and runs only once', async () => {
    const db = nodeDb();
    let ownerReads = 0;
    const owner = async () => {
      ownerReads++;
      return 'owner-1';
    };
    await migrateOutbox(db, owner);
    expect(userVersion(db)).toBe(OUTBOX_SCHEMA_VERSION);
    expect(ownerReads).toBe(0);

    const item = makeRequestItem({
      status: 'rejected',
      rejection: { code: 'municipality_not_served', municipality: null },
    });
    const row = toOutboxRow(item);
    const columns = Object.keys(row);
    await db.runAsync(
      `INSERT INTO outbox (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(row),
    );
    await migrateOutbox(db, owner);
    expect(await listItems(db)).toEqual([item]);
  });
});

/** Tabela da fila na versão 1 (igual à atual), antes da prefeitura por item. */
const V1_TABLE = `
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    photo_paths TEXT NOT NULL,
    photo_keys TEXT NOT NULL,
    created_offline INTEGER NOT NULL,
    status TEXT NOT NULL,
    rejection TEXT,
    attempts INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX outbox_due ON outbox (status, next_attempt_at, created_at);
  CREATE TABLE work_orders_cache (id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL);
  PRAGMA user_version = 1;
`;

async function insertRow(db: AppDb, item: OutboxItem): Promise<void> {
  const row = toOutboxRow(item);
  const columns = Object.keys(row);
  await db.runAsync(
    `INSERT INTO outbox (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row),
  );
}

/** Item de ação como a versão 1 gravava: sem prefeitura, local nem motivo. */
function v1Action(overrides: Partial<OutboxItem>): OutboxItem {
  const item = makeItem(overrides);
  const { workOrderId, action, occurredAt, note } = actionOf(item);
  return { ...item, payload: { workOrderId, action, occurredAt, note } };
}

describe('outbox schema version 2', () => {
  it('v1 work order items without tenant become rejected on migration', async () => {
    const db = nodeDb();
    db.raw.exec(V1_TABLE);
    const pending = v1Action({ id: 'a', createdAt: 1, status: 'pending' });
    const conflict = v1Action({
      id: 'b',
      createdAt: 2,
      status: 'conflict',
      lastError: 'cancelled',
    });
    const done = v1Action({ id: 'c', createdAt: 3, status: 'done' });
    const request = makeRequestItem({ createdAt: 4 });
    for (const item of [pending, conflict, done, request]) await insertRow(db, item);

    await migrateOutbox(db, async () => 'owner-1');

    expect(userVersion(db)).toBe(OUTBOX_SCHEMA_VERSION);
    expect(await listItems(db)).toEqual([
      {
        ...pending,
        status: 'rejected',
        rejection: { code: 'missing_tenant' },
        lastError: 'missing_tenant',
      },
      {
        ...conflict,
        status: 'rejected',
        rejection: { code: 'missing_tenant' },
        lastError: 'missing_tenant',
      },
      done,
      request,
    ]);
    // O cache de atividades do Laboratório sai junto.
    expect(
      db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'work_orders_cache'").get(),
    ).toBeUndefined();
  });

  it('keeps work order items that already have a tenant', async () => {
    const db = nodeDb();
    db.raw.exec(V1_TABLE);
    const item = makeItem();
    await insertRow(db, item);
    await migrateOutbox(db, async () => null);
    expect(await listItems(db)).toEqual([item]);
  });
  it('a work order item with an unreadable payload becomes rejected instead of blocking the open', async () => {
    const db = nodeDb();
    db.raw.exec(V1_TABLE);
    const broken = v1Action({ id: 'a', createdAt: 1 });
    const nullPayload = v1Action({ id: 'b', createdAt: 2 });
    const notObject = v1Action({ id: 'c', createdAt: 3 });
    for (const item of [broken, nullPayload, notObject]) await insertRow(db, item);
    db.raw.prepare("UPDATE outbox SET payload = '{oops' WHERE id = 'a'").run();
    db.raw.prepare("UPDATE outbox SET payload = 'null' WHERE id = 'b'").run();
    db.raw.prepare("UPDATE outbox SET payload = '42' WHERE id = 'c'").run();

    await migrateOutbox(db, async () => null);

    expect(userVersion(db)).toBe(OUTBOX_SCHEMA_VERSION);
    const rows = db.raw
      .prepare('SELECT id, status, rejection, last_error FROM outbox ORDER BY created_at')
      .all();
    expect(rows).toEqual(
      ['a', 'b', 'c'].map((id) => ({
        id,
        status: 'rejected',
        rejection: JSON.stringify({ code: 'missing_tenant' }),
        last_error: 'missing_tenant',
      })),
    );
  });
});

describe('outbox schema version 3', () => {
  it('creates the agent work order cache and seen tables', async () => {
    const db = nodeDb();
    db.raw.exec(V1_TABLE);
    await migrateOutbox(db, async () => null);
    expect(userVersion(db)).toBe(3);
    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agent_%' ORDER BY name",
      )
      .all();
    expect(tables).toEqual([{ name: 'agent_seen' }, { name: 'agent_work_orders' }]);
    // Rodar de novo não faz nada.
    await migrateOutbox(db, async () => null);
    expect(userVersion(db)).toBe(3);
  });
});

describe('SqliteOutboxStore', () => {
  async function newStore(deletePhotos: (id: string) => void) {
    const db = nodeDb();
    await migrateOutbox(db, async () => null);
    return { db, store: new SqliteOutboxStore(db, deletePhotos) };
  }

  it('failing photo folder delete does not stop the pass', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store } = await newStore(() => {
      throw new Error('EBUSY');
    });
    await store.add(makeItem({ id: 'a', createdAt: 1 }));
    await store.add(makeItem({ id: 'b', createdAt: 2 }));
    const transport = new FakeTransport();
    const result = await processOutbox({
      store,
      transport,
      connection: fakeConnection(),
      device: () => ({ platform: 'android', appVersion: '1.0.0' }),
    });
    expect(result).toMatchObject({ sent: 2, failed: 0, stoppedByNetwork: false });
    expect((await store.list()).map((i) => [i.id, i.status])).toEqual([
      ['a', 'done'],
      ['b', 'done'],
    ]);
    expect(transport.sent).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('removing a rejected item deletes its stashed photos', async () => {
    const deleted: string[] = [];
    const { store } = await newStore((id) => deleted.push(id));
    await store.add(
      makeItem({ id: 'a', status: 'rejected', rejection: { code: 'work_order_not_found' } }),
    );
    await store.add(makeItem({ id: 'b', createdAt: 2, status: 'conflict' }));
    await store.add(makeItem({ id: 'c', createdAt: 3, status: 'failed' }));
    await store.remove('a');
    await store.remove('b');
    await store.remove('c');
    expect(deleted).toEqual(['a', 'b', 'c']);
    expect(await store.list()).toEqual([]);
  });

  it('deletes the photos of a sent item', async () => {
    const deleted: string[] = [];
    const { store } = await newStore((id) => deleted.push(id));
    await store.add(makeItem({ id: 'a' }));
    await store.update('a', { status: 'failed' });
    expect(deleted).toEqual([]);
    await store.update('a', { status: 'done' });
    expect(deleted).toEqual(['a']);
  });
});

describe('createDatabaseOpener', () => {
  it('openAppDatabase retries after a failed open', async () => {
    let calls = 0;
    const open = createDatabaseOpener(async () => {
      calls++;
      if (calls === 1) throw new Error('disk I/O error');
      return { n: calls };
    });
    await expect(open()).rejects.toThrow('disk I/O error');
    const db = await open();
    expect(db).toEqual({ n: 2 });
    // Aberto com sucesso: as próximas chamadas usam o mesmo banco.
    expect(await open()).toBe(db);
    expect(calls).toBe(2);
  });

  it('concurrent callers share the same open', async () => {
    let calls = 0;
    const open = createDatabaseOpener(async () => ({ n: ++calls }));
    const [a, b] = await Promise.all([open(), open()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});
