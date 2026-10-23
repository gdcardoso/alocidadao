import type { RequestCard } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';
import { colors } from '../ui/theme';

// O lucide-react-native puxa o react-native, que não roda no Node: cada ícone vira o próprio nome.
vi.mock('lucide-react-native', () => {
  const names = [
    'Construction',
    'Lightbulb',
    'Trash2',
    'Trees',
    'Droplets',
    'Footprints',
    'Signpost',
    'PawPrint',
    'CircleEllipsis',
    'Inbox',
    'HardHat',
    'CircleAlert',
    'CircleCheck',
    'CircleX',
    'Ban',
    'WifiOff',
  ];
  return Object.fromEntries(names.map((name) => [name, name]));
});

const { toCardModel, toQueuedCardModel, rejectionReason, toQueuedRequests } =
  await import('./requests-view');
const { makeItem, makeRequestItem } = await import('../offline/test-helpers');

// 2026-10-23 08:12 em São Paulo (UTC−3).
const NOW = new Date('2026-10-23T14:00:00.000Z');

const card = (over: Partial<RequestCard> = {}): RequestCard => ({
  id: '7d0c6a3e-8f43-4c1e-9a55-2b4f0f6d1a10',
  protocol: '2026-000123',
  status: 'open',
  categoryName: 'Buraco na via',
  icon: 'construction',
  iconGroup: 'infrastructure',
  address: 'Rua das Flores, 120',
  createdAt: '2026-10-23T11:12:00.000Z',
  statusChangedAt: '2026-10-23T11:12:00.000Z',
  ...over,
});

describe('requests view', () => {
  it('awaiting confirmation needs action and links to detail', () => {
    const model = toCardModel(card({ status: 'awaiting_confirmation' }), NOW);
    expect(model.needsAction).toBe(true);
    expect(model.href).toBe('/(app)/solicitacao/7d0c6a3e-8f43-4c1e-9a55-2b4f0f6d1a10');
    expect(model.badge.label).toBe('Aguardando sua confirmação');
    expect(model.title).toBe('Buraco na via');
    expect(model.address).toBe('Rua das Flores, 120');

    for (const status of ['open', 'in_progress', 'completed', 'cancelled', 'rejected'] as const) {
      expect(toCardModel(card({ status }), NOW).needsAction).toBe(false);
    }
  });

  it('meta joins protocol and short date', () => {
    expect(toCardModel(card(), NOW).meta).toBe('2026-000123 · Hoje, 08:12');
    expect(
      toCardModel(card({ protocol: '2026-000118', createdAt: '2026-10-18T13:00:00.000Z' }), NOW)
        .meta,
    ).toBe('2026-000118 · 18 out');
  });

  it('queued request shows waiting badge; rejected shows reason', () => {
    const queued = toQueuedCardModel(
      {
        id: 'q-1',
        categoryName: 'Iluminação',
        icon: 'lightbulb',
        iconGroup: 'infrastructure',
        address: null,
        createdAt: '2026-10-23T11:12:00.000Z',
        rejection: null,
      },
      NOW,
    );
    expect(queued.badge).toEqual({
      label: 'Aguardando internet',
      icon: 'WifiOff',
      bg: colors.warningSoft,
      fg: colors.warning,
    });
    expect(queued.meta).toBe('Hoje, 08:12');
    expect(queued.rejectionReason).toBeNull();
    expect(queued.canRemove).toBe(false);

    const rejected = toQueuedCardModel(
      {
        id: 'q-2',
        categoryName: 'Iluminação',
        icon: 'lightbulb',
        iconGroup: 'infrastructure',
        address: 'Av. Brasil, 1450',
        createdAt: '2026-10-23T11:12:00.000Z',
        rejection: {
          code: 'municipality_not_served',
          municipality: { name: 'Campinas', state: 'SP' },
        },
      },
      NOW,
    );
    expect(rejected.badge.label).toBe('Não enviada');
    expect(rejected.rejectionReason).toBe('Campinas ainda não usa o Alô Cidadão');
    expect(rejected.canRemove).toBe(true);

    expect(rejectionReason({ code: 'municipality_not_served', municipality: null })).toBe(
      'Sua cidade ainda não usa o Alô Cidadão',
    );
    expect(rejectionReason({ code: 'category_unavailable' })).toBe(
      'Este tipo de solicitação não está disponível nesta cidade.',
    );
  });

  it('a request that failed for another reason can be removed', () => {
    expect(rejectionReason({ code: 'send_failed' })).toBe(
      'Não foi possível enviar esta solicitação.',
    );
  });

  it('maps the queue to queued requests, newest first', () => {
    const items = [
      makeItem({ id: 'action', createdAt: 5 }),
      makeRequestItem({ id: 'old', createdAt: 1_000 }),
      makeRequestItem({
        id: 'refused',
        createdAt: 2_000,
        status: 'rejected',
        rejection: {
          code: 'municipality_not_served',
          municipality: { ibgeCode: '3509502', name: 'Campinas', state: 'SP' },
        },
      }),
      makeRequestItem({ id: 'failed', createdAt: 3_000, status: 'failed', lastError: 'x' }),
      makeRequestItem({ id: 'sent', createdAt: 4_000, status: 'done' }),
      makeRequestItem({ id: 'new', createdAt: 5_000, status: 'sending' }),
    ];
    const queued = toQueuedRequests(items);
    expect(queued.map((q) => q.id)).toEqual(['new', 'failed', 'refused', 'old']);
    expect(queued[3]).toEqual({
      id: 'old',
      categoryName: 'Buraco na via',
      icon: 'construction',
      iconGroup: 'infrastructure',
      address: 'Rua das Flores, 120',
      createdAt: new Date(1_000).toISOString(),
      rejection: null,
    });
    expect(queued[1]?.rejection).toEqual({ code: 'send_failed' });
    expect(queued[2]?.rejection).toEqual({
      code: 'municipality_not_served',
      municipality: { name: 'Campinas', state: 'SP' },
    });
  });
});
