import type { SQLiteDatabase } from 'expo-sqlite';

export interface CachedWorkOrder {
  id: string;
  status: string;
  protocol: string;
  description: string;
  categoryName: string;
  address: string | null;
  dueAt: string | null;
}

interface Row {
  id: string;
  status: string;
  protocol: string;
  description: string;
  category_name: string;
  address: string | null;
  due_at: string | null;
}

/** Cache local das atividades do agente, no mesmo banco SQLite da fila. */
export class WorkOrderCache {
  constructor(private readonly db: SQLiteDatabase) {}

  async init(): Promise<void> {
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS work_orders_cache (
        id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        protocol TEXT NOT NULL,
        description TEXT NOT NULL,
        category_name TEXT NOT NULL,
        address TEXT,
        due_at TEXT,
        position INTEGER NOT NULL
      );
    `);
  }

  /** Troca o conteúdo pela lista do servidor (quem saiu da lista sai do cache). */
  async replaceAll(list: CachedWorkOrder[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM work_orders_cache');
      for (let i = 0; i < list.length; i++) {
        const o = list[i]!;
        await this.db.runAsync(
          `INSERT INTO work_orders_cache
             (id, status, protocol, description, category_name, address, due_at, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [o.id, o.status, o.protocol, o.description, o.categoryName, o.address, o.dueAt, i],
        );
      }
    });
  }

  async list(): Promise<CachedWorkOrder[]> {
    const rows = await this.db.getAllAsync<Row>(
      'SELECT * FROM work_orders_cache ORDER BY position ASC',
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      protocol: r.protocol,
      description: r.description,
      categoryName: r.category_name,
      address: r.address,
      dueAt: r.due_at,
    }));
  }

  async setLocalStatus(id: string, status: string): Promise<void> {
    await this.db.runAsync('UPDATE work_orders_cache SET status = ? WHERE id = ?', [status, id]);
  }
}
