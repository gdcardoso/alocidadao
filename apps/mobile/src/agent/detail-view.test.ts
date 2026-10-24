import type { GeoPoint } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../offline/test-helpers';
import { routeUrl, toAgentDetail, type AgentDetailContext } from './detail-view';
import { makeDetail, wo } from './test-helpers';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const HERE: GeoPoint = { lat: -23.55, lng: -46.63 };
/** Ponto a `m` metros ao norte de `HERE`. */
const north = (m: number): GeoPoint => ({ lat: HERE.lat + m / 111_195.08, lng: HERE.lng });

const context = (over: Partial<AgentDetailContext> = {}): AgentDetailContext => ({
  here: HERE,
  queue: [],
  now: NOW,
  ...over,
});

const report = (description: string, createdAt: string) => ({ description, createdAt });

describe('agent detail', () => {
  it('assigned shows instructions and the start footer', () => {
    const view = toAgentDetail(
      makeDetail({
        status: 'assigned',
        location: north(350),
        managerInstructions: 'Levar asfalto a frio e cones.',
        assignedBy: { name: 'Carlos', departmentName: 'Obras' },
        dueAt: '2026-10-23T15:00:00.000Z',
        reportCount: 6,
      }),
      context(),
    );
    expect(view.title).toBe('Buraco na via');
    expect(view.subtitle).toBe('Ocorrência 2026-000123 · 6 relatos');
    expect(view.manager).toEqual({
      tone: 'instructions',
      title: 'Instruções do gestor',
      text: 'Levar asfalto a frio e cones.',
      muted: false,
      author: 'Carlos (Gestor de Obras) · prazo: 23 out',
    });
    expect(view.location).toEqual({ address: 'Rua das Flores, 120', distance: 'A 350 m de você' });
    expect(view.footer).toBe('start');
    expect(view.primaryLabel).toBe('Iniciar atendimento');
    expect(view.readOnlyNote).toBeNull();
    // Um relato: singular.
    expect(toAgentDetail(makeDetail({ reportCount: 1 }), context()).subtitle).toBe(
      'Ocorrência 2026-000123 · 1 relato',
    );
    // Sem posição do aparelho, a distância some.
    expect(toAgentDetail(makeDetail(), context({ here: null })).location.distance).toBeNull();
  });

  it('in execution shows the complete footer', () => {
    const view = toAgentDetail(makeDetail({ status: 'in_execution' }), context());
    expect(view.footer).toBe('complete');
    expect(view.primaryLabel).toBe('Concluir atendimento');
    expect(view.manager.tone).toBe('instructions');
  });

  it('rework shows the reason title, message, author and resend footer', () => {
    const view = toAgentDetail(
      makeDetail({
        status: 'rework_requested',
        managerInstructions: 'Instruções originais.',
        rework: {
          reasons: ['new_photos'],
          message: 'As fotos 2 e 3 ficaram escuras.',
          byName: 'Carlos',
          departmentName: 'Obras',
          at: ago(20 * MIN),
        },
      }),
      context(),
    );
    expect(view.manager).toEqual({
      tone: 'rework',
      title: 'Gestor pediu novas fotos',
      text: 'As fotos 2 e 3 ficaram escuras.',
      muted: false,
      author: 'Carlos (Gestor de Obras) · devolvido há 20 min',
    });
    expect(view.footer).toBe('rework');
    expect(view.primaryLabel).toBe('Enviar novas fotos');

    const rework = (reasons: ('new_photos' | 'new_note' | 'return_to_site')[]) =>
      toAgentDetail(
        makeDetail({
          status: 'rework_requested',
          rework: { reasons, message: 'm', byName: null, departmentName: null, at: ago(MIN) },
        }),
        context(),
      );
    expect(rework(['new_note']).manager.title).toBe('Gestor pediu um novo relato');
    expect(rework(['return_to_site']).manager.title).toBe('Gestor pediu para voltar ao local');
    // Sem pedir fotos, o primário é concluir; sem autor, só o tempo.
    expect(rework(['new_note']).primaryLabel).toBe('Concluir atendimento');
    expect(rework(['new_note']).manager.author).toBe('devolvido há 1 min');
  });

  it('several rework reasons use the generic title', () => {
    const view = toAgentDetail(
      makeDetail({
        status: 'rework_requested',
        rework: {
          reasons: ['new_note', 'new_photos'],
          message: 'Refazer.',
          byName: 'Carlos',
          departmentName: 'Obras',
          at: ago(2 * 60 * MIN),
        },
      }),
      context(),
    );
    expect(view.manager.title).toBe('Gestor pediu ajustes');
    expect(view.primaryLabel).toBe('Enviar novas fotos');
    expect(view.manager.author).toBe('Carlos (Gestor de Obras) · devolvido há 2 h');
  });

  it('missing instructions say so and keep the due date', () => {
    const view = toAgentDetail(
      makeDetail({
        managerInstructions: null,
        assignedBy: null,
        dueAt: '2026-10-23T15:00:00.000Z',
      }),
      context(),
    );
    expect(view.manager).toEqual({
      tone: 'instructions',
      title: 'Instruções do gestor',
      text: 'Sem instruções do gestor.',
      muted: true,
      author: 'prazo: 23 out',
    });
    // Instrução só com espaços conta como sem instruções.
    expect(toAgentDetail(makeDetail({ managerInstructions: '  ' }), context()).manager.muted).toBe(
      true,
    );
    // Sem prazo: só o autor; sem os dois, nada.
    expect(toAgentDetail(makeDetail({ dueAt: null }), context()).manager.author).toBe(
      'Carlos (Gestor de Obras)',
    );
    expect(
      toAgentDetail(makeDetail({ dueAt: null, assignedBy: null }), context()).manager.author,
    ).toBeNull();
  });

  it('awaiting review and impeded are read-only with their note', () => {
    const review = toAgentDetail(makeDetail({ status: 'awaiting_review' }), context());
    expect(review.footer).toBeNull();
    expect(review.primaryLabel).toBeNull();
    expect(review.readOnlyNote).toBe('Enviado ao gestor. Aguardando a revisão.');
    const impeded = toAgentDetail(makeDetail({ status: 'impeded' }), context());
    expect(impeded.footer).toBeNull();
    expect(impeded.readOnlyNote).toBe('Impedimento enviado. Aguardando a decisão do gestor.');
    // Conclusão na fila: já é só de leitura.
    const queued = toAgentDetail(
      makeDetail({ id: wo(1), status: 'in_execution' }),
      context({ queue: [makeItem({ workOrderId: wo(1), action: 'complete' })] }),
    );
    expect(queued.footer).toBeNull();
    expect(queued.readOnlyNote).toBe('Enviado ao gestor. Aguardando a revisão.');
  });

  it('reports show three, an empty one as Sem observação, and the more link', () => {
    const reports = [
      report('Buraco grande perto da faixa de pedestres', '2026-10-20T11:12:00.000Z'),
      report('Já tem carro batendo a roda aqui', '2026-10-20T20:40:00.000Z'),
      report('', '2026-10-21T10:05:00.000Z'),
      report('Quarto', '2026-10-22T10:05:00.000Z'),
    ];
    const view = toAgentDetail(makeDetail({ reports }), context());
    expect(view.reports.shown).toEqual([
      { text: 'Buraco grande perto da faixa de pedestres', empty: false, date: '20 out, 08:12' },
      { text: 'Já tem carro batendo a roda aqui', empty: false, date: '20 out, 17:40' },
      { text: 'Sem observação', empty: true, date: '21 out, 07:05' },
    ]);
    expect(view.reports.all).toHaveLength(4);
    expect(view.reports.moreLabel).toBe('Ver os 4 relatos');
    // Até 3, sem link.
    expect(
      toAgentDetail(makeDetail({ reports: reports.slice(0, 3) }), context()).reports.moreLabel,
    ).toBeNull();
  });

  it('queued start makes the footer complete', () => {
    const start = makeItem({
      workOrderId: wo(1),
      action: 'start',
      note: null,
      photoPaths: [],
      photoKeys: [],
    });
    const view = toAgentDetail(
      makeDetail({ id: wo(1), status: 'assigned' }),
      context({ queue: [start] }),
    );
    expect(view.status).toBe('in_execution');
    expect(view.footer).toBe('complete');
    expect(view.primaryLabel).toBe('Concluir atendimento');
    // Envio de outra atividade não muda esta.
    const other = toAgentDetail(
      makeDetail({ id: wo(2), status: 'assigned' }),
      context({ queue: [start] }),
    );
    expect(other.footer).toBe('start');
    // Envio recusado pelo servidor não muda o status.
    const conflict = toAgentDetail(
      makeDetail({ id: wo(1), status: 'assigned' }),
      context({ queue: [{ ...start, status: 'conflict' }] }),
    );
    expect(conflict.footer).toBe('start');
  });

  it('photos go to the gallery with the date and place', () => {
    const view = toAgentDetail(
      makeDetail({
        photos: [
          { url: 'https://s/1.jpg', takenAt: '2026-10-20T11:12:00.000Z' },
          { url: 'https://s/2.jpg', takenAt: '2026-10-21T10:05:00.000Z' },
        ],
      }),
      context(),
    );
    expect(view.photos.cover).toBe('https://s/1.jpg');
    expect(view.photos.count).toBe(2);
    expect(view.photos.gallery).toEqual([
      {
        url: 'https://s/1.jpg',
        caption: 'Foto do cidadão',
        meta: '20 out 2026, 08:12 · Rua das Flores, 120',
      },
      {
        url: 'https://s/2.jpg',
        caption: 'Foto do cidadão',
        meta: '21 out 2026, 07:05 · Rua das Flores, 120',
      },
    ]);
    expect(toAgentDetail(makeDetail({ photos: [] }), context()).photos.cover).toBeNull();
  });

  it('route url opens the map apps on Android and Apple Maps on iOS', () => {
    const at = { lat: -23.5505, lng: -46.6333 };
    expect(routeUrl('android', at, 'Rua das Flores, 120')).toBe(
      'geo:0,0?q=-23.5505,-46.6333(Rua%20das%20Flores%2C%20120)',
    );
    expect(routeUrl('android', at, null)).toBe('geo:0,0?q=-23.5505,-46.6333');
    expect(routeUrl('ios', at, 'Rua das Flores, 120')).toBe(
      'http://maps.apple.com/?daddr=-23.5505,-46.6333',
    );
  });
});
