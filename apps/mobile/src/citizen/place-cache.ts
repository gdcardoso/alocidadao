import type { CategoryOption, LocateResponse } from '@alocidadao/shared';
import type { AppDb } from '../offline/outbox-schema';

/** Última prefeitura que atendeu o cidadão, com os tipos dela (a tela 5 sem rede usa estes). */
export interface CachedPlace {
  tenantId: string;
  city: string;
  state: string;
  categories: CategoryOption[];
  savedAt: number;
}

type ServedLocate = Extract<LocateResponse, { status: 'served' }>;

export function placeFromLocate(locate: ServedLocate, now: number): CachedPlace {
  return {
    tenantId: locate.tenant.id,
    city: locate.tenant.city,
    state: locate.tenant.state,
    categories: locate.categories,
    savedAt: now,
  };
}

const KEY = 'last_place';

/** Guarda a última prefeitura no banco do app (tabela de chave e valor). */
export class PlaceCache {
  constructor(private readonly db: AppDb) {}

  async init(): Promise<void> {
    await this.db.execAsync(
      'CREATE TABLE IF NOT EXISTS place_cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
    );
  }

  async save(place: CachedPlace): Promise<void> {
    await this.init();
    await this.db.runAsync('INSERT OR REPLACE INTO place_cache (key, value) VALUES (?, ?)', [
      KEY,
      JSON.stringify(place),
    ]);
  }

  async load(): Promise<CachedPlace | null> {
    await this.init();
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM place_cache WHERE key = ?',
      [KEY],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.value) as CachedPlace;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await this.init();
    await this.db.runAsync('DELETE FROM place_cache', []);
  }
}
