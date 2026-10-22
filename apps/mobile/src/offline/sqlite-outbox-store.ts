import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import {
  enqueueWorkOrderAction,
  type EnqueueDeps,
  type OutboxItem,
  type OutboxStore,
} from './outbox';

const DB_NAME = 'alocidadao.db';

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** Abre o banco do app uma única vez (compartilhado com o cache de listas). */
export function openAppDatabase(): Promise<SQLiteDatabase> {
  dbPromise ??= openDatabaseAsync(DB_NAME).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS outbox (
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
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox (status, next_attempt_at, created_at);
    `);
    return db;
  });
  return dbPromise;
}

interface Row {
  id: string;
  work_order_id: string;
  action: 'start' | 'complete';
  occurred_at: string;
  note: string | null;
  photo_paths: string;
  photo_keys: string;
  created_offline: number;
  status: OutboxItem['status'];
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
}

const COLUMNS: Record<keyof OutboxItem, string> = {
  id: 'id',
  workOrderId: 'work_order_id',
  action: 'action',
  occurredAt: 'occurred_at',
  note: 'note',
  photoPaths: 'photo_paths',
  photoKeys: 'photo_keys',
  createdOffline: 'created_offline',
  status: 'status',
  attempts: 'attempts',
  nextAttemptAt: 'next_attempt_at',
  lastError: 'last_error',
  createdAt: 'created_at',
};

function toColumnValue(key: keyof OutboxItem, value: OutboxItem[keyof OutboxItem]) {
  if (key === 'photoPaths' || key === 'photoKeys') return JSON.stringify(value);
  if (key === 'createdOffline') return value ? 1 : 0;
  return value as string | number | null;
}

function fromRow(row: Row): OutboxItem {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    action: row.action,
    occurredAt: row.occurred_at,
    note: row.note,
    photoPaths: JSON.parse(row.photo_paths) as string[],
    photoKeys: JSON.parse(row.photo_keys) as (string | null)[],
    createdOffline: row.created_offline === 1,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

const outboxDir = (id: string) => new Directory(Paths.document, 'outbox', id);

/** Copia a foto para `Paths.document/outbox/<id>/` e devolve o novo caminho. */
export async function stashPhoto(id: string, uri: string): Promise<string> {
  const dir = outboxDir(id);
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(uri);
  const target = new File(dir, source.name);
  await source.copy(target, { overwrite: true });
  return target.uri;
}

export class SqliteOutboxStore implements OutboxStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async add(item: OutboxItem): Promise<void> {
    const keys = Object.keys(COLUMNS) as (keyof OutboxItem)[];
    await this.db.runAsync(
      `INSERT INTO outbox (${keys.map((k) => COLUMNS[k]).join(', ')})
       VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => toColumnValue(k, item[k])),
    );
  }

  async listDue(now: number): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY created_at ASC`,
      [now],
    );
    return rows.map(fromRow);
  }

  async update(id: string, patch: Partial<OutboxItem>): Promise<void> {
    const keys = (Object.keys(patch) as (keyof OutboxItem)[]).filter(
      (k) => k !== 'id' && patch[k] !== undefined,
    );
    if (keys.length > 0) {
      await this.db.runAsync(
        `UPDATE outbox SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map((k) => toColumnValue(k, patch[k] as OutboxItem[keyof OutboxItem])), id],
      );
    }
    if (patch.status === 'done') {
      const dir = outboxDir(id);
      if (dir.exists) dir.delete();
    }
  }

  async resetInFlight(): Promise<void> {
    await this.db.runAsync(`UPDATE outbox SET status = 'pending' WHERE status = 'sending'`);
  }

  async list(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<Row>(`SELECT * FROM outbox ORDER BY created_at ASC`);
    return rows.map(fromRow);
  }
}

export async function openOutboxStore(): Promise<SqliteOutboxStore> {
  return new SqliteOutboxStore(await openAppDatabase());
}

/** Dependências nativas de `enqueueWorkOrderAction`. */
export const nativeEnqueueDeps: EnqueueDeps = { randomUuid: randomUUID, stashPhoto };

export const enqueueNative = (
  store: OutboxStore,
  input: Parameters<typeof enqueueWorkOrderAction>[1],
) => enqueueWorkOrderAction(store, input, nativeEnqueueDeps);
