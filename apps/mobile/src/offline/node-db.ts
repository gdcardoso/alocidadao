import { DatabaseSync } from 'node:sqlite';
import type { AppDb } from './outbox-schema';

// Só para testes: o SQLite do Node com a parte da API do expo-sqlite que o app usa.

type Bind = string | number | null;

export type NodeDb = AppDb & { raw: DatabaseSync };

/** Banco em memória com a API do `AppDb`. */
export function nodeDb(): NodeDb {
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
