import { describe, expect, it } from 'vitest';
import { mapBounds, workOrderCardLabel } from './agent-screen';
import type { AgentCardView } from './agent-view';

const view = (over: Partial<AgentCardView> = {}): AgentCardView => ({
  id: 'w1',
  tenantId: 't1',
  categoryName: 'Iluminação',
  categoryIcon: 'lightbulb',
  categoryGroup: 'infrastructure',
  address: 'Av. Brasil, 1450',
  distance: '1,2 km',
  badge: { label: 'Atribuída', tone: { bg: 'border', fg: 'textSecondary' } },
  isNew: true,
  reportsLabel: '1 relato',
  timeLabel: 'Chegou há 10 min',
  location: { lat: -23.55, lng: -46.63 },
  status: 'assigned',
  queued: false,
  ...over,
});

describe('mapBounds', () => {
  it('returns null without points', () => {
    expect(mapBounds([])).toBeNull();
  });

  it('covers every point when they are spread out', () => {
    expect(
      mapBounds([
        { lat: -23.5, lng: -46.7 },
        { lat: -23.6, lng: -46.6 },
        { lat: -23.55, lng: -46.65 },
      ]),
    ).toEqual([-46.7, -23.6, -46.6, -23.5]);
  });

  it('widens a single point to the minimum span, centred on it', () => {
    const [west, south, east, north] = mapBounds([{ lat: -23.55, lng: -46.63 }], 0.01)!;
    expect(east - west).toBeCloseTo(0.01);
    expect(north - south).toBeCloseTo(0.01);
    expect((west + east) / 2).toBeCloseTo(-46.63);
    expect((south + north) / 2).toBeCloseTo(-23.55);
  });

  it('widens only the narrow side', () => {
    const [west, south, east, north] = mapBounds(
      [
        { lat: -23.55, lng: -46.7 },
        { lat: -23.55, lng: -46.6 },
      ],
      0.01,
    )!;
    expect([west, east]).toEqual([-46.7, -46.6]);
    expect(north - south).toBeCloseTo(0.01);
  });
});

describe('workOrderCardLabel', () => {
  it('reads the card in order, with the new mark and the distance', () => {
    expect(workOrderCardLabel(view())).toBe(
      'Iluminação, Nova, Av. Brasil, 1450, a 1,2 km, Atribuída, 1 relato, Chegou há 10 min',
    );
  });

  it('skips what the card does not show', () => {
    expect(workOrderCardLabel(view({ isNew: false, address: null, distance: null }))).toBe(
      'Iluminação, Atribuída, 1 relato, Chegou há 10 min',
    );
  });
});
