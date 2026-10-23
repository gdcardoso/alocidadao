import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  OUTBOX_SCHEMA_VERSION,
  fromOutboxRow,
  migrateOutbox,
  toOutboxRow,
  type AppDb,
  type OutboxRow,
} from './outbox-schema';
import { makeRequestItem } from './test-helpers';

type Bind = string | number | null;

/** Adaptador do SQLite do Node com a parte da API do expo-sqlite que a migração usa. */
function nodeDb(): AppDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async getAllAsync<T>(sql: string, params: Bind[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: Bind[] = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async runAsync(sql, params = []) {
      raw.prepare(sql).run(...params);
    },
    async withTransactionAsync(fn) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

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

const userVersion = (db: AppDb & { raw: DatabaseSync }) =>
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
        status: 'pending',
        rejection: null,
        attempts: 2,
        nextAttemptAt: 500,
        lastError: 'timeout',
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
