import type { AgentWorkOrderCard, AgentWorkOrderDetail } from '@alocidadao/shared';
import type { AppDb } from '../offline/outbox-schema';
import { seenKey } from './agent-view';

// Cache das atividades do agente no SQLite (tabelas da versão 3 do banco), sem nada nativo.

interface CardRow {
  card_json: string;
}

interface DetailRow {
  detail_json: string | null;
}

/** JSON gravado pelo app; linha estragada vira `null` (some do cache em vez de travar a lista). */
function parse<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Atividades do agente (de todas as prefeituras) e as que ele já abriu neste aparelho. */
export class AgentWorkOrderStore {
  constructor(
    private readonly db: AppDb,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Troca os cartões da prefeitura pelos da lista do servidor. O detalhe já baixado de uma
   * atividade que continua fica; o das que saíram vai junto.
   */
  async replaceTenant(tenantId: string, cards: readonly AgentWorkOrderCard[]): Promise<void> {
    const at = this.now();
    await this.db.withTransactionAsync(async () => {
      const keep = cards.map((card) => card.id);
      await this.db.runAsync(
        `DELETE FROM agent_work_orders WHERE tenant_id = ? AND id NOT IN (${keep.map(() => '?').join(', ')})`,
        [tenantId, ...keep],
      );
      for (const card of cards) {
        await this.db.runAsync(
          `INSERT INTO agent_work_orders (id, tenant_id, card_json, detail_json, updated_at)
           VALUES (?, ?, ?, NULL, ?)
           ON CONFLICT (id) DO UPDATE SET
             tenant_id = excluded.tenant_id,
             card_json = excluded.card_json,
             updated_at = excluded.updated_at`,
          [card.id, tenantId, JSON.stringify(card), at],
        );
      }
    });
  }

  /** Apaga as prefeituras em que o agente não está mais. */
  async keepTenants(tenantIds: readonly string[]): Promise<void> {
    await this.db.runAsync(
      `DELETE FROM agent_work_orders WHERE tenant_id NOT IN (${tenantIds.map(() => '?').join(', ')})`,
      [...tenantIds],
    );
  }

  async list(): Promise<AgentWorkOrderCard[]> {
    const rows = await this.db.getAllAsync<CardRow>(
      'SELECT card_json FROM agent_work_orders ORDER BY id',
      [],
    );
    return rows
      .map((row) => parse<AgentWorkOrderCard>(row.card_json))
      .filter((card): card is AgentWorkOrderCard => card !== null);
  }

  /** Guarda o detalhe; o cartão também fica com os dados dele, que são os mais novos. */
  async saveDetail(detail: AgentWorkOrderDetail): Promise<void> {
    const card: AgentWorkOrderCard = {
      id: detail.id,
      tenantId: detail.tenantId,
      status: detail.status,
      protocol: detail.protocol,
      categoryName: detail.categoryName,
      categoryIcon: detail.categoryIcon,
      categoryGroup: detail.categoryGroup,
      address: detail.address,
      location: detail.location,
      teamName: detail.teamName,
      reportCount: detail.reportCount,
      dueAt: detail.dueAt,
      assignedAt: detail.assignedAt,
      statusChangedAt: detail.statusChangedAt,
    };
    await this.db.runAsync(
      `INSERT INTO agent_work_orders (id, tenant_id, card_json, detail_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         card_json = excluded.card_json,
         detail_json = excluded.detail_json,
         updated_at = excluded.updated_at`,
      [detail.id, detail.tenantId, JSON.stringify(card), JSON.stringify(detail), this.now()],
    );
  }

  async detail(id: string): Promise<AgentWorkOrderDetail | null> {
    const row = await this.db.getFirstAsync<DetailRow>(
      'SELECT detail_json FROM agent_work_orders WHERE id = ?',
      [id],
    );
    return row ? parse<AgentWorkOrderDetail>(row.detail_json) : null;
  }

  /** Tira a atividade do cache (ex.: o detalhe deu 404: concluída, cancelada ou de outra equipe). */
  async remove(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM agent_work_orders WHERE id = ?', [id]);
  }

  /** O agente abriu a atividade com esta atribuição: ela deixa de ser "Nova". */
  async markSeen(id: string, assignedAt: string): Promise<void> {
    await this.db.runAsync('INSERT OR IGNORE INTO agent_seen (key) VALUES (?)', [
      seenKey({ id, assignedAt }),
    ]);
  }

  async seenKeys(): Promise<Set<string>> {
    const rows = await this.db.getAllAsync<{ key: string }>('SELECT key FROM agent_seen', []);
    return new Set(rows.map((row) => row.key));
  }

  /** Apaga o cache e as atividades vistas (saída da conta). */
  async clear(): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM agent_work_orders', []);
      await this.db.runAsync('DELETE FROM agent_seen', []);
    });
  }
}
