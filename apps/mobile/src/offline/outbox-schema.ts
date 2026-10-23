import type { OutboxItem, OutboxRejection, WorkOrderActionPayload } from './outbox';

// Tabela da fila no SQLite e as migrações, sem nada nativo (testável no Node).

type Bind = string | number | null;

/** Parte da API do banco do expo-sqlite que a fila usa. */
export interface AppDb {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, params: Bind[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: Bind[]): Promise<T | null>;
  runAsync(sql: string, params: Bind[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** Versão atual da tabela da fila (`PRAGMA user_version`). */
export const OUTBOX_SCHEMA_VERSION = 1;

const CREATE_OUTBOX_V1 = (table: string) => `
  CREATE TABLE ${table} (
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
  )
`;

const CREATE_OUTBOX_INDEX =
  'CREATE INDEX IF NOT EXISTS outbox_due ON outbox (status, next_attempt_at, created_at)';

export interface OutboxRow {
  id: string;
  kind: OutboxItem['kind'];
  user_id: string;
  payload: string;
  photo_paths: string;
  photo_keys: string;
  created_offline: number;
  status: OutboxItem['status'];
  rejection: string | null;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
}

/** Coluna de cada campo do item. */
export const OUTBOX_COLUMNS: Record<keyof OutboxItem, keyof OutboxRow> = {
  id: 'id',
  kind: 'kind',
  userId: 'user_id',
  payload: 'payload',
  photoPaths: 'photo_paths',
  photoKeys: 'photo_keys',
  createdOffline: 'created_offline',
  status: 'status',
  rejection: 'rejection',
  attempts: 'attempts',
  nextAttemptAt: 'next_attempt_at',
  lastError: 'last_error',
  createdAt: 'created_at',
};

/** Valor gravado na coluna para um campo do item. */
export function toColumnValue<K extends keyof OutboxItem>(key: K, value: OutboxItem[K]): Bind {
  if (key === 'payload' || key === 'photoPaths' || key === 'photoKeys') {
    return JSON.stringify(value);
  }
  if (key === 'rejection') return value === null ? null : JSON.stringify(value);
  if (key === 'createdOffline') return value ? 1 : 0;
  return value as Bind;
}

export function toOutboxRow(item: OutboxItem): Record<keyof OutboxRow, Bind> {
  const row = {} as Record<keyof OutboxRow, Bind>;
  for (const key of Object.keys(OUTBOX_COLUMNS) as (keyof OutboxItem)[]) {
    row[OUTBOX_COLUMNS[key]] = toColumnValue(key, item[key]);
  }
  return row;
}

export function fromOutboxRow(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    kind: row.kind,
    userId: row.user_id,
    payload: JSON.parse(row.payload) as unknown,
    photoPaths: JSON.parse(row.photo_paths) as string[],
    photoKeys: JSON.parse(row.photo_keys) as (string | null)[],
    createdOffline: row.created_offline === 1,
    status: row.status,
    rejection: row.rejection === null ? null : (JSON.parse(row.rejection) as OutboxRejection),
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/** Linha da tabela da versão 0, que só guardava ações do agente. */
interface OutboxRowV0 {
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

/** Converte a linha da versão 0 em item `work_order_action` do dono informado. */
export function itemFromV0(row: OutboxRowV0, owner: string): OutboxItem {
  const payload: WorkOrderActionPayload = {
    workOrderId: row.work_order_id,
    action: row.action,
    occurredAt: row.occurred_at,
    note: row.note,
  };
  return {
    id: row.id,
    kind: 'work_order_action',
    userId: owner,
    payload,
    photoPaths: JSON.parse(row.photo_paths) as string[],
    photoKeys: JSON.parse(row.photo_keys) as (string | null)[],
    createdOffline: row.created_offline === 1,
    status: row.status,
    rejection: null,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

async function insertItem(db: AppDb, table: string, item: OutboxItem): Promise<void> {
  const row = toOutboxRow(item);
  const columns = Object.keys(row);
  await db.runAsync(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row),
  );
}

/**
 * Leva a tabela da fila até `OUTBOX_SCHEMA_VERSION`. Na versão 0 (tabela sem `kind`), os itens
 * viram `work_order_action` do dono guardado da fila (`''` sem dono). `getOwner` só é lido
 * quando há o que migrar.
 */
export async function migrateOutbox(
  db: AppDb,
  getOwner: () => Promise<string | null>,
): Promise<void> {
  const version =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version ??
    0;
  if (version >= OUTBOX_SCHEMA_VERSION) return;

  const existing = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbox'",
    [],
  );
  const legacyRows = existing
    ? await db.getAllAsync<OutboxRowV0>('SELECT * FROM outbox ORDER BY created_at, rowid', [])
    : [];
  const owner = legacyRows.length > 0 ? ((await getOwner()) ?? '') : '';

  await db.withTransactionAsync(async () => {
    await db.execAsync(CREATE_OUTBOX_V1('outbox_v1'));
    for (const row of legacyRows) await insertItem(db, 'outbox_v1', itemFromV0(row, owner));
    if (existing) await db.execAsync('DROP TABLE outbox');
    await db.execAsync('ALTER TABLE outbox_v1 RENAME TO outbox');
    await db.execAsync(CREATE_OUTBOX_INDEX);
    await db.execAsync(`PRAGMA user_version = ${OUTBOX_SCHEMA_VERSION}`);
  });
}
