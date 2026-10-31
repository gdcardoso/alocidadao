import { pinStyleFor, type OccurrencePoint } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import {
  clusterLayers,
  CLUSTER_PROPERTIES,
  DEADLINE_PIN_COLORS,
  DEADLINE_WEIGHT,
  PIN_COLORS,
  PIN_LAYER_ID,
  pointsToGeoJson,
  selectionFilter,
} from './map-style';

/** Avalia `['step', input, base, s1, v1, …]` para um número. */
function evaluateStep(expression: unknown, value: number): unknown {
  const [op, , base, ...stops] = expression as unknown[];
  expect(op).toBe('step');
  let result = base;
  for (let i = 0; i < stops.length; i += 2) {
    if (value >= (stops[i] as number)) result = stops[i + 1];
  }
  return result;
}

function layer(id: string) {
  const found = clusterLayers().find((item) => item.id === id);
  if (!found) throw new Error(`camada ${id} não existe`);
  return found as { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
}

describe('map style', () => {
  it('cluster layers size the pins by the report bands', () => {
    const pins = layer('occurrence-pins');
    for (let count = 1; count <= 40; count += 1) {
      const { size } = pinStyleFor(count);
      expect(evaluateStep(pins.paint?.['circle-radius'], count)).toBe(size / 2);
    }
    expect(pins.paint?.['circle-stroke-color']).toBe('#FFFFFF');
    const labels = layer('occurrence-pin-labels');
    expect(evaluateStep(labels.layout?.['text-size'], 8)).toBe(15);
    expect(evaluateStep(labels.layout?.['text-size'], 11)).toBe(18);
    // A soma dos relatos dos grupos vem de `clusterProperties`.
    expect(CLUSTER_PROPERTIES.reportCount).toEqual(['+', ['get', 'requestCount']]);
  });

  it('selection filter matches only the chosen point', () => {
    expect(selectionFilter('abc')).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'id'], 'abc'],
    ]);
    expect(selectionFilter(null)).toEqual(['==', ['get', 'id'], '']);
  });

  it('points become geojson features with lng, lat', () => {
    const point = {
      id: 'p1',
      location: { lat: -23.5, lng: -46.6 },
      categoryId: 'c1',
      categoryName: 'Buraco na via',
      icon: 'construction',
      iconGroup: 'infrastructure',
      status: 'triage',
      requestCount: 6,
      statusSince: '2026-10-20T12:00:00.000Z',
      deadlineStatus: 'none',
      dueAt: null,
    } satisfies OccurrencePoint;
    expect(pointsToGeoJson([point])).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-46.6, -23.5] },
          properties: { id: 'p1', requestCount: 6, deadlineWeight: 0 },
        },
      ],
    });
  });

  it('pin color follows deadlineStatus and clusters use the worst', () => {
    expect(DEADLINE_PIN_COLORS).toEqual({
      none: '#64748B',
      on_time: '#007a4a',
      due_soon: PIN_COLORS.warning,
      overdue: PIN_COLORS.danger,
    });
    // Cluster: máximo do peso 0..3 (none < on_time < due_soon < overdue).
    expect(CLUSTER_PROPERTIES.worstDeadline).toEqual(['max', ['get', 'deadlineWeight']]);
    expect(DEADLINE_WEIGHT).toEqual({ none: 0, on_time: 1, due_soon: 2, overdue: 3 });

    const pins = layer(PIN_LAYER_ID);
    expect(pins.paint).toMatchObject({
      'circle-color': [
        'match',
        ['coalesce', ['get', 'worstDeadline'], ['get', 'deadlineWeight']],
        0,
        '#64748B',
        1,
        '#007a4a',
        2,
        PIN_COLORS.warning,
        3,
        PIN_COLORS.danger,
        '#64748B',
      ],
    });
    // O tamanho continua vindo dos relatos.
    expect(JSON.stringify(pins.paint?.['circle-radius'])).toContain('reportCount');
  });

  it('point weight follows deadlineStatus', () => {
    const point = { deadlineStatus: 'overdue', location: { lat: 0, lng: 0 } } as OccurrencePoint;
    expect(pointsToGeoJson([point]).features[0]?.properties.deadlineWeight).toBe(3);
  });
});
