import type { RequestDetail } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';

// O lucide-react-native puxa o react-native, que não roda no Node: cada ícone vira o próprio nome.
vi.mock('lucide-react-native', () => {
  const names = [
    'Ban',
    'Calendar',
    'CircleAlert',
    'CircleCheck',
    'CircleX',
    'HardHat',
    'Hourglass',
    'MapPin',
    'MessageSquare',
  ];
  return Object.fromEntries(names.map((name) => [name, name]));
});

const { ApiError, ApiTimeoutError } = await import('@alocidadao/api-client');
const { actionFailure, parseGalleryPhotos, toDetailModel, toGalleryPhotos } =
  await import('./detail-view');
const { NetworkError, UploadRejectedError } = await import('../offline/outbox');

// 2026-10-23 11:00 em São Paulo (UTC−3).
const NOW = new Date('2026-10-23T14:00:00.000Z');
const OPENED = '2026-10-20T11:12:00.000Z'; // 20 out, 08:12
const ASSIGNED = '2026-10-21T17:30:00.000Z'; // 21 out, 14:30
const PUBLISHED = '2026-10-22T18:40:00.000Z'; // 22 out, 15:40

const photo = (n: number, takenAt = OPENED) => ({ url: `https://fotos/${n}.jpg`, takenAt });

const detail = (over: Partial<RequestDetail> = {}): RequestDetail => ({
  id: '7d0c6a3e-8f43-4c1e-9a55-2b4f0f6d1a10',
  protocol: '2026-000123',
  status: 'open',
  statusChangedAt: OPENED,
  createdAt: OPENED,
  categoryName: 'Buraco na via',
  icon: 'construction',
  iconGroup: 'infrastructure',
  address: 'Rua das Flores, 120 — Centro',
  description: 'Buraco grande perto da faixa de pedestres',
  location: { lat: -23.5505, lng: -46.6333 },
  photos: [photo(1), photo(2)],
  team: null,
  completion: null,
  rejection: null,
  timeline: [{ status: 'open', at: OPENED }],
  ...over,
});

describe('toDetailModel', () => {
  it('open request shows elapsed notice, cancel footer and the open step current', () => {
    const model = toDetailModel(detail(), NOW);
    expect(model.title).toBe('Buraco na via');
    expect(model.subtitle).toBe('Protocolo 2026-000123');
    expect(model.notice).toEqual({
      tone: 'open',
      icon: 'Hourglass',
      title: 'Aberta há 3 dias',
      text: 'Aguardando a prefeitura analisar e encaminhar para uma equipe. Você recebe um aviso a cada mudança.',
    });
    expect(model.before).toHaveLength(2);
    expect(model.after).toBeNull();
    expect(model.report).toBeNull();
    expect(model.footer).toBe('cancel');
    expect(model.facts).toEqual([
      { icon: 'MapPin', label: 'Local', value: 'Rua das Flores, 120 — Centro' },
      {
        icon: 'MessageSquare',
        label: 'Sua observação',
        value: 'Buraco grande perto da faixa de pedestres',
      },
      { icon: 'Calendar', label: 'Aberta em', value: '20 out 2026, 08:12' },
    ]);
    expect(model.steps).toEqual([
      { title: 'Aberta', detail: '20 out, 08:12 · há 3 dias', state: 'current' },
      { title: 'Em atendimento', detail: 'Encaminhamento para uma equipe', state: 'future' },
      { title: 'Conclusão pela equipe', detail: 'Execução do serviço', state: 'future' },
      { title: 'Sua confirmação', detail: 'Depois da conclusão', state: 'future' },
    ]);
  });

  it('reopened request dates the open step from the reopening', () => {
    const reopenedAt = '2026-10-22T13:00:00.000Z'; // 22 out, 10:00
    const model = toDetailModel(
      detail({
        statusChangedAt: reopenedAt,
        // Sem o evento da abertura (solicitação antiga): conta a volta a `open`.
        timeline: [
          { status: 'awaiting_confirmation', at: ASSIGNED },
          { status: 'open', at: reopenedAt },
        ],
      }),
      NOW,
    );
    expect(model.notice.title).toBe('Aberta há 1 dia');
    expect(model.steps[0]).toEqual({
      title: 'Aberta',
      detail: '22 out, 10:00 · há 1 dia',
      state: 'current',
    });
  });

  it('open request without address or note shows the coordinates and skips the note', () => {
    const model = toDetailModel(detail({ address: null, description: '' }), NOW);
    expect(model.facts.map((f) => f.label)).toEqual(['Local', 'Aberta em']);
    expect(model.facts[0]!.value).toBe('-23.55050, -46.63330');
  });

  it('in progress names the team or falls back', () => {
    const inProgress = {
      status: 'in_progress' as const,
      statusChangedAt: ASSIGNED,
      timeline: [
        { status: 'open' as const, at: OPENED },
        { status: 'in_progress' as const, at: ASSIGNED },
      ],
    };
    const withTeam = toDetailModel(
      detail({ ...inProgress, team: { name: 'Equipe Obras · Centro' } }),
      NOW,
    );
    expect(withTeam.notice).toMatchObject({
      tone: 'progress',
      icon: 'HardHat',
      title: 'Em atendimento há 2 dias',
      text: 'A Equipe Obras · Centro está cuidando da sua solicitação. Você recebe um aviso quando o serviço for concluído.',
    });
    expect(withTeam.footer).toBeNull();
    expect(withTeam.steps.slice(0, 2)).toEqual([
      { title: 'Aberta', detail: '20 out, 08:12', state: 'done' },
      {
        title: 'Em atendimento',
        detail: 'Equipe Obras · Centro · desde 21 out, 14:30',
        state: 'current',
      },
    ]);

    const withoutTeam = toDetailModel(detail(inProgress), NOW);
    expect(withoutTeam.notice.text).toBe(
      'A prefeitura está cuidando da sua solicitação. Você recebe um aviso quando o serviço for concluído.',
    );
    expect(withoutTeam.steps[1]!.detail).toBe('desde 21 out, 14:30');
  });

  it('awaiting confirmation shows before and after, report and confirm footer', () => {
    const model = toDetailModel(
      detail({
        status: 'awaiting_confirmation',
        statusChangedAt: PUBLISHED,
        team: { name: 'Equipe Obras · Centro' },
        completion: {
          publicNote: 'Buraco tapado com asfalto a quente.',
          publishedAt: PUBLISHED,
          photos: [photo(3, PUBLISHED)],
        },
        timeline: [
          { status: 'open', at: OPENED },
          { status: 'in_progress', at: ASSIGNED },
          { status: 'awaiting_confirmation', at: PUBLISHED },
        ],
      }),
      NOW,
    );
    expect(model.notice).toEqual({
      tone: 'awaiting',
      icon: 'CircleAlert',
      title: 'A prefeitura concluiu o atendimento',
      text: 'Confira as fotos e diga se o problema foi resolvido. Sem resposta, confirmamos automaticamente em 7 dias.',
    });
    expect(model.before).toHaveLength(2);
    expect(model.after).toEqual([photo(3, PUBLISHED)]);
    expect(model.report).toEqual({
      kind: 'team',
      title: 'Equipe Obras · Centro',
      date: 'Concluído em 22 out, 15:40',
      text: 'Buraco tapado com asfalto a quente.',
    });
    expect(model.footer).toBe('confirm_contest');
    expect(model.steps).toEqual([
      { title: 'Aberta', detail: '20 out, 08:12', state: 'done' },
      { title: 'Em atendimento', detail: 'Equipe Obras · Centro · 21 out, 14:30', state: 'done' },
      { title: 'Concluída pela equipe', detail: '22 out, 15:40', state: 'done' },
      { title: 'Sua confirmação', detail: 'Aguardando você', state: 'waiting' },
    ]);
    expect(toGalleryPhotos(model).map((p) => p.caption)).toEqual([
      'Sua foto · abertura',
      'Sua foto · abertura',
      'Depois do atendimento',
    ]);
    expect(toGalleryPhotos(model)[2]!.meta).toBe(
      '22 out 2026, 15:40 · Rua das Flores, 120 — Centro',
    );
  });

  it('rejected shows reason and two steps', () => {
    const at = '2026-10-20T19:05:00.000Z'; // 20 out, 16:05
    const model = toDetailModel(
      detail({
        status: 'rejected',
        statusChangedAt: at,
        rejection: { reason: 'O local fica numa rodovia estadual.', at },
        timeline: [
          { status: 'open', at: OPENED },
          { status: 'rejected', at },
        ],
      }),
      NOW,
    );
    expect(model.notice).toEqual({
      tone: 'rejected',
      icon: 'CircleX',
      title: 'Solicitação recusada',
      text: 'Veja abaixo o motivo informado pela prefeitura.',
    });
    expect(model.report).toEqual({
      kind: 'rejection',
      title: 'Motivo da recusa',
      date: '20 out, 16:05',
      text: 'O local fica numa rodovia estadual.',
    });
    expect(model.after).toBeNull();
    expect(model.footer).toBeNull();
    expect(model.steps).toEqual([
      { title: 'Aberta', detail: '20 out, 08:12', state: 'done' },
      { title: 'Recusada', detail: '20 out, 16:05', state: 'rejected' },
    ]);
  });

  it('completed and cancelled have no footer', () => {
    const confirmed = '2026-10-23T12:00:00.000Z'; // 23 out, 09:00
    const completed = toDetailModel(
      detail({
        status: 'completed',
        statusChangedAt: confirmed,
        team: { name: 'Equipe Obras · Centro' },
        completion: { publicNote: null, publishedAt: PUBLISHED, photos: [photo(3, PUBLISHED)] },
        timeline: [
          { status: 'open', at: OPENED },
          { status: 'in_progress', at: ASSIGNED },
          { status: 'awaiting_confirmation', at: PUBLISHED },
          { status: 'completed', at: confirmed },
        ],
      }),
      NOW,
    );
    expect(completed.footer).toBeNull();
    expect(completed.notice).toEqual({
      tone: 'done',
      icon: 'CircleCheck',
      title: 'Concluída',
      text: 'Obrigado por confirmar. Esta solicitação foi encerrada.',
    });
    expect(completed.after).toHaveLength(1);
    expect(completed.report).toMatchObject({ kind: 'team', text: null });
    expect(completed.steps.map((s) => [s.title, s.state])).toEqual([
      ['Aberta', 'done'],
      ['Em atendimento', 'done'],
      ['Concluída pela equipe', 'done'],
      ['Sua confirmação', 'done'],
    ]);
    expect(completed.steps[3]!.detail).toBe('23 out, 09:00');

    const cancelledAt = '2026-10-21T12:00:00.000Z'; // 21 out, 09:00
    const cancelled = toDetailModel(
      detail({
        status: 'cancelled',
        statusChangedAt: cancelledAt,
        timeline: [
          { status: 'open', at: OPENED },
          { status: 'cancelled', at: cancelledAt },
        ],
      }),
      NOW,
    );
    expect(cancelled.footer).toBeNull();
    expect(cancelled.notice).toEqual({
      tone: 'open',
      icon: 'Ban',
      title: 'Cancelada',
      text: 'Você cancelou esta solicitação.',
    });
    expect(cancelled.steps).toEqual([
      { title: 'Aberta', detail: '20 out, 08:12', state: 'done' },
      { title: 'Cancelada', detail: '21 out, 09:00', state: 'rejected' },
    ]);
  });
});

describe('gallery and actions', () => {
  it('parses the gallery photos and ignores a broken parameter', () => {
    const photos = [{ url: 'https://fotos/1.jpg', caption: 'Sua foto · abertura', meta: 'x' }];
    expect(parseGalleryPhotos(JSON.stringify(photos))).toEqual(photos);
    expect(parseGalleryPhotos('{nope')).toEqual([]);
    expect(parseGalleryPhotos(undefined)).toEqual([]);
    expect(parseGalleryPhotos(JSON.stringify([{ url: 1 }]))).toEqual([]);
  });

  it('action errors explain the missing network and a status that changed', () => {
    const offline = { kind: 'message', message: 'Sem internet. Tente de novo quando conectar.' };
    const fallback = { kind: 'message', message: 'Algo deu errado. Tente de novo.' };
    expect(actionFailure(new TypeError('Network request failed'))).toEqual(offline);
    expect(actionFailure(new ApiTimeoutError())).toEqual(offline);
    // Falha de transporte no upload (fetch sem resposta).
    expect(actionFailure(new NetworkError('Network request failed'))).toEqual(offline);
    expect(actionFailure(new ApiError(409, { code: 'invalid_status' }))).toEqual({
      kind: 'message',
      message: 'A situação desta solicitação mudou. Confira de novo.',
    });
    expect(actionFailure(new ApiError(500, null))).toEqual(fallback);
    // O servidor respondeu: não é falta de internet.
    expect(actionFailure(new NetworkError('put_403'))).toEqual(fallback);
    expect(actionFailure(new NetworkError('uploads_503'))).toEqual(fallback);
    expect(actionFailure(new NetworkError('invalid_presign_response'))).toEqual(fallback);
    expect(actionFailure(new UploadRejectedError('storage_not_configured'))).toEqual(fallback);
  });

  it('a refused session goes back to the login', () => {
    expect(actionFailure(new ApiError(401, { code: 'unauthorized' }))).toEqual({ kind: 'session' });
    expect(actionFailure(new NetworkError('unauthorized'))).toEqual({ kind: 'session' });
    expect(actionFailure(new NetworkError('signed_out'))).toEqual({ kind: 'session' });
  });
});
