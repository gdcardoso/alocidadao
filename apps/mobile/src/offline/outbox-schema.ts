import type { OutboxItem, OutboxRejection, OutboxStore } from './outbox';

// Tabela da fila no SQLite, as migrações e o store, sem nada nativo (testável no Node).

type Bind = string | number | null;

/** Parte da API do banco do expo-sqlite que a fila usa. */
export interface AppDb {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, params: Bind[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: Bind[]): Promise<T | null>;
  runAsync(sql: string, params: Bind[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * Versão atual do banco do app (`PRAGMA user_version`). 1: fila com `kind`; 2: ação do agente
 * com a prefeitura no item e sem o cache de atividades do Laboratório.
 */
export const OUTBOX_SCHEMA_VERSION = 2;

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

/** Ação do agente como as versões 0 e 1 gravavam (sem prefeitura, local nem motivo). */
interface LegacyWorkOrderActionPayload {
  workOrderId: string;
  action: 'start' | 'complete';
  occurredAt: string;
  note: string | null;
}

/** Converte a linha da versão 0 em item `work_order_action` do dono informado. */
export function itemFromV0(row: OutboxRowV0, owner: string): OutboxItem {
  const payload: LegacyWorkOrderActionPayload = {
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
 * Leva o banco até `OUTBOX_SCHEMA_VERSION`, uma versão de cada vez. `getOwner` só é lido
 * quando há itens da versão 0 para migrar.
 */
export async function migrateOutbox(
  db: AppDb,
  getOwner: () => Promise<string | null>,
): Promise<void> {
  const version =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version ??
    0;
  if (version < 1) await migrateToV1(db, getOwner);
  if (version < 2) await migrateToV2(db);
}

/**
 * Versão 1: na versão 0 (tabela sem `kind`), os itens viram `work_order_action` do dono
 * guardado da fila (`''` sem dono).
 */
async function migrateToV1(db: AppDb, getOwner: () => Promise<string | null>): Promise<void> {
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
    await db.execAsync('PRAGMA user_version = 1');
  });
}

const MISSING_TENANT: OutboxRejection = { code: 'missing_tenant' };

/**
 * Versão 2: a ação do agente leva a prefeitura no item. As que ainda não foram enviadas sem
 * ela (do Laboratório) ficam recusadas com `missing_tenant`; o cache de atividades do
 * Laboratório (`work_orders_cache`) sai.
 */
async function migrateToV2(db: AppDb): Promise<void> {
  await db.withTransactionAsync(async () => {
    const rows = await db.getAllAsync<Pick<OutboxRow, 'id' | 'payload'>>(
      "SELECT id, payload FROM outbox WHERE kind = 'work_order_action' AND status <> 'done'",
      [],
    );
    for (const row of rows) {
      const { tenantId } = JSON.parse(row.payload) as { tenantId?: unknown };
      if (typeof tenantId === 'string' && tenantId !== '') continue;
      await db.runAsync(
        `UPDATE outbox SET status = 'rejected', rejection = ?, last_error = ? WHERE id = ?`,
        [JSON.stringify(MISSING_TENANT), MISSING_TENANT.code, row.id],
      );
    }
    await db.execAsync('DROP TABLE IF EXISTS work_orders_cache');
    await db.execAsync('PRAGMA user_version = 2');
  });
}

/**
 * Abre o banco uma única vez (chamadas ao mesmo tempo compartilham a abertura). Uma abertura
 * que falha não fica guardada: a próxima chamada tenta de novo, sem precisar reiniciar o app.
 */
export function createDatabaseOpener<T>(open: () => Promise<T>): () => Promise<T> {
  let opening: Promise<T> | null = null;
  return () => {
    opening ??= new Promise<T>((resolve) => resolve(open())).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };
}

/** Fila no SQLite. `deletePhotos` apaga a pasta das fotos guardadas do item. */
export class SqliteOutboxStore implements OutboxStore {
  constructor(
    private readonly db: AppDb,
    private readonly deletePhotos: (id: string) => void,
  ) {}

  /** Uma pasta que não sai (arquivo preso, disco cheio) não pode parar a fila: registra e segue. */
  private dropPhotos(id: string): void {
    try {
      this.deletePhotos(id);
    } catch (error) {
      console.warn('Falha ao apagar as fotos do item da fila', id, error);
    }
  }

  async add(item: OutboxItem): Promise<void> {
    await insertItem(this.db, 'outbox', item);
  }

  async listPending(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC`,
      [],
    );
    return rows.map(fromOutboxRow);
  }

  async update(id: string, patch: Partial<OutboxItem>): Promise<void> {
    const keys = (Object.keys(patch) as (keyof OutboxItem)[]).filter(
      (k) => k !== 'id' && patch[k] !== undefined,
    );
    if (keys.length > 0) {
      await this.db.runAsync(
        `UPDATE outbox SET ${keys.map((k) => `${OUTBOX_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map((k) => toColumnValue(k, patch[k] as OutboxItem[typeof k])), id],
      );
    }
    // Enviado: as fotos guardadas já estão no servidor.
    if (patch.status === 'done') this.dropPhotos(id);
  }

  async resetInFlight(): Promise<void> {
    await this.db.runAsync(`UPDATE outbox SET status = 'pending' WHERE status = 'sending'`, []);
  }

  async list(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox ORDER BY created_at ASC, rowid ASC`,
      [],
    );
    return rows.map(fromOutboxRow);
  }

  /** Tira o item (enviado, em conflito, com falha ou recusado) e apaga as fotos dele. */
  async remove(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
    this.dropPhotos(id);
  }
}
