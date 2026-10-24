import type { GeoPoint } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';
import { nodeDb } from '../offline/node-db';
import type { OutboxItem } from '../offline/outbox';
import { SqliteOutboxStore, migrateOutbox } from '../offline/outbox-schema';
import { makeItem, makeRequestItem } from '../offline/test-helpers';
import { offlineBanner, seenKey, teamHeader, toAgentList, type AgentListInput } from './agent-view';
import { TENANT_A, TENANT_B, makeCard, wo } from './test-helpers';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const HERE: GeoPoint = { lat: -23.55, lng: -46.63 };
/** Ponto a `m` metros ao norte de `HERE`. */
const north = (m: number): GeoPoint => ({ lat: HERE.lat + m / 111_195.08, lng: HERE.lng });

const list = (over: Partial<AgentListInput>) =>
  toAgentList({ cards: [], queue: [], seen: new Set(), here: HERE, now: NOW, ...over });

describe('agent list', () => {
  it('actionable work orders come first, by distance', () => {
    const cards = [
      makeCard({ id: wo(1), status: 'assigned', location: north(2_800) }),
      makeCard({ id: wo(2), status: 'awaiting_review', location: north(10) }),
      makeCard({ id: wo(3), status: 'in_execution', location: north(350) }),
      makeCard({ id: wo(4), status: 'rework_requested', location: north(1_200) }),
    ];
    const result = list({ cards });
    expect(result.items.map((i) => [i.id, i.distance])).toEqual([
      [wo(3), '350 m'],
      [wo(4), '1,2 km'],
      [wo(1), '2,8 km'],
      [wo(2), '10 m'],
    ]);
    expect(result.summary).toBe('4 atividades · ordenadas pela distância');
  });

  it('without location the list is ordered by due date and says so', () => {
    const cards = [
      makeCard({ id: wo(1), dueAt: null, assignedAt: ago(9 * MIN) }),
      makeCard({ id: wo(2), dueAt: '2026-10-26T12:00:00.000Z', assignedAt: ago(5 * MIN) }),
      // Mesmo prazo: a atribuída há mais tempo vem antes.
      makeCard({ id: wo(3), dueAt: '2026-10-25T12:00:00.000Z', assignedAt: ago(1 * MIN) }),
      makeCard({ id: wo(4), dueAt: '2026-10-25T12:00:00.000Z', assignedAt: ago(2 * MIN) }),
      makeCard({ id: wo(5), dueAt: null, assignedAt: ago(30 * MIN) }),
    ];
    const result = list({ cards, here: null });
    expect(result.items.map((i) => i.id)).toEqual([wo(4), wo(3), wo(2), wo(5), wo(1)]);
    expect(result.items.every((i) => i.distance === null)).toBe(true);
    expect(result.summary).toBe('5 atividades · ordenadas pelo prazo');
    expect(list({ cards: [makeCard()], here: null }).summary).toBe(
      '1 atividade · ordenadas pelo prazo',
    );
  });

  it('read-only work orders go last, newest change first', () => {
    const cards = [
      makeCard({ id: wo(1), status: 'impeded', statusChangedAt: ago(60 * MIN) }),
      makeCard({ id: wo(2), status: 'awaiting_review', statusChangedAt: ago(5 * MIN) }),
      makeCard({ id: wo(3), status: 'assigned', location: north(9_000) }),
    ];
    const result = list({ cards });
    expect(result.items.map((i) => i.id)).toEqual([wo(3), wo(2), wo(1)]);
    expect(result.items.map((i) => [i.badge, i.timeLabel])).toEqual([
      [{ label: 'Atribuída', tone: { bg: 'border', fg: 'textSecondary' } }, 'Chegou há 2 h'],
      [
        { label: 'Aguardando revisão', tone: { bg: 'successSoft', fg: 'success' } },
        'Enviada há 5 min',
      ],
      [{ label: 'Impedida', tone: { bg: 'dangerSoft', fg: 'danger' } }, 'Enviada há 1 h'],
    ]);
  });

  it('shows the card texts of each status', () => {
    const cards = [
      makeCard({ id: wo(1), status: 'in_execution', statusChangedAt: ago(20 * MIN) }),
      makeCard({ id: wo(2), status: 'rework_requested', statusChangedAt: ago(20 * MIN) }),
      makeCard({ id: wo(3), reportCount: 1 }),
    ];
    const items = list({ cards, here: null }).items;
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(wo(1))).toMatchObject({
      badge: { label: 'Em execução', tone: { bg: 'primarySoft', fg: 'primary' } },
      timeLabel: 'Iniciada há 20 min',
      reportsLabel: '6 relatos',
    });
    expect(byId.get(wo(2))).toMatchObject({
      badge: { label: 'Ajuste pedido', tone: { bg: 'warningSoft', fg: 'warning' } },
      timeLabel: 'Devolvido há 20 min',
    });
    expect(byId.get(wo(3))).toMatchObject({
      tenantId: TENANT_A,
      categoryName: 'Buraco na via',
      categoryIcon: 'construction',
      categoryGroup: 'infrastructure',
      address: 'Rua das Flores, 120',
      reportsLabel: '1 relato',
      location: { lat: -23.55, lng: -46.63 },
    });
  });

  it('assigned work order not seen is new, rescheduled one is new again', () => {
    const fresh = makeCard({ id: wo(1), assignedAt: ago(10 * MIN) });
    const opened = makeCard({ id: wo(2), assignedAt: ago(3 * 24 * 60 * MIN) });
    const rescheduled = makeCard({ id: wo(3), assignedAt: ago(1 * MIN) });
    const started = makeCard({ id: wo(4), status: 'in_execution' });
    const seen = new Set([
      seenKey(opened),
      // Aberta antes de o gestor reagendar: a atribuição mudou.
      `${wo(3)}:${ago(2 * 24 * 60 * MIN)}`,
    ]);
    const byId = new Map(
      list({ cards: [fresh, opened, rescheduled, started], seen }).items.map((i) => [i.id, i]),
    );
    expect(byId.get(wo(1))).toMatchObject({ isNew: true, timeLabel: 'Chegou há 10 min' });
    expect(byId.get(wo(2))).toMatchObject({ isNew: false, timeLabel: 'Atribuída há 3 dias' });
    expect(byId.get(wo(3))).toMatchObject({ isNew: true, timeLabel: 'Chegou há 1 min' });
    expect(byId.get(wo(4))?.isNew).toBe(false);
  });

  it('queued start shows in execution and waiting to send', () => {
    const assigned = makeCard({ id: wo(1), location: north(5_000) });
    const toComplete = makeCard({ id: wo(2), status: 'in_execution', location: north(100) });
    const queue = [
      makeItem({ id: 'q1', workOrderId: wo(1), action: 'start', status: 'pending' }),
      makeItem({ id: 'q2', workOrderId: wo(2), action: 'complete', status: 'sending' }),
      // Solicitação do cidadão na fila não mexe na lista do agente.
      makeRequestItem({ status: 'pending' }),
    ];
    const items = list({ cards: [assigned, toComplete], queue }).items;
    expect(items.map((i) => [i.id, i.badge.label, i.timeLabel, i.isNew])).toEqual([
      [wo(1), 'Em execução', 'Aguardando envio', false],
      // Concluída na fila: passa para o fim, só de leitura.
      [wo(2), 'Aguardando revisão', 'Aguardando envio', false],
    ]);
  });

  it('a sent action shows until the list catches up', () => {
    const card = makeCard({ id: wo(1), statusChangedAt: ago(60 * MIN) });
    const sent = makeItem({
      workOrderId: wo(1),
      action: 'start',
      status: 'done',
      occurredAt: ago(2 * MIN),
    });
    expect(list({ cards: [card], queue: [sent] }).items[0]).toMatchObject({
      badge: { label: 'Em execução' },
      timeLabel: 'Iniciada há 2 min',
    });
    // O servidor já mostra a ação: vale o servidor.
    const caughtUp = makeCard({ id: wo(1), status: 'in_execution', statusChangedAt: ago(MIN) });
    expect(list({ cards: [caughtUp], queue: [sent] }).items[0]?.timeLabel).toBe(
      'Iniciada há 1 min',
    );
  });

  it('conflicting agent action shows the notice and removal deletes its photos', async () => {
    const deletePhotos = vi.fn();
    const db = nodeDb();
    await migrateOutbox(db, async () => null);
    const store = new SqliteOutboxStore(db, deletePhotos);
    const conflict = makeItem({
      id: 'q1',
      workOrderId: wo(1),
      status: 'conflict',
      createdAt: 1,
    });
    // Fora do cache (a atividade saiu da equipe): o texto vem do que o item guardou.
    const failed: OutboxItem = makeItem({
      id: 'q2',
      workOrderId: wo(9),
      status: 'failed',
      createdAt: 2,
    });
    (failed.payload as { display?: unknown }).display = {
      categoryName: 'Iluminação',
      address: null,
    };
    const rejected = makeItem({ id: 'q3', workOrderId: wo(8), status: 'rejected', createdAt: 3 });
    for (const item of [conflict, failed, rejected]) await store.add(item);
    const cards = [makeCard({ id: wo(1) })];

    const before = list({ cards, queue: await store.list() });
    expect(before.notices).toEqual([
      {
        itemId: 'q1',
        workOrderId: wo(1),
        text: 'Buraco na via · Rua das Flores, 120: o gestor mudou esta atividade e seu envio não foi aplicado.',
        actionLabel: 'Remover envio',
      },
      {
        itemId: 'q2',
        workOrderId: wo(9),
        text: 'Iluminação: o gestor mudou esta atividade e seu envio não foi aplicado.',
        actionLabel: 'Remover envio',
      },
      {
        itemId: 'q3',
        workOrderId: wo(8),
        text: 'Atividade: o gestor mudou esta atividade e seu envio não foi aplicado.',
        actionLabel: 'Remover envio',
      },
    ]);
    // O envio que não foi aplicado não muda o status do cartão.
    expect(before.items[0]?.timeLabel).not.toBe('Aguardando envio');

    await store.remove(before.notices[0]!.itemId);
    expect(deletePhotos).toHaveBeenCalledWith('q1');
    expect(list({ cards, queue: await store.list() }).notices.map((n) => n.itemId)).toEqual([
      'q2',
      'q3',
    ]);
  });

  it('offline banner counts pending sends with singular and plural', () => {
    expect(offlineBanner(true, 3)).toBeNull();
    expect(offlineBanner(false, 0)).toBe('Sem conexão');
    expect(offlineBanner(false, 1)).toBe('Sem conexão · 1 envio aguardando sinal');
    expect(offlineBanner(false, 2)).toBe('Sem conexão · 2 envios aguardando sinal');
  });

  it('team header names one team or counts several', () => {
    expect(teamHeader([])).toBeNull();
    expect(teamHeader([makeCard({ id: wo(1) }), makeCard({ id: wo(2) })])).toBe(
      'Equipe Obras · Centro',
    );
    expect(
      teamHeader([makeCard({ id: wo(1) }), makeCard({ id: wo(2), teamName: 'Equipe Luz' })]),
    ).toBe('2 equipes');
    // Mesmo nome em outra prefeitura é outra equipe.
    expect(teamHeader([makeCard({ id: wo(1) }), makeCard({ id: wo(2), tenantId: TENANT_B })])).toBe(
      '2 equipes',
    );
  });
});
