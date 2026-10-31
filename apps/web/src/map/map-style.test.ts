import { pinStyleFor, type OccurrencePoint } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import {
  clusterLayers,
  CLUSTER_PROPERTIES,
  PIN_COLORS,
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
  it('cluster layers use the pin bands', () => {
    const pins = layer('occurrence-pins');
    for (let count = 1; count <= 40; count += 1) {
      const { size, tone } = pinStyleFor(count);
      expect(evaluateStep(pins.paint?.['circle-radius'], count)).toBe(size / 2);
      expect(evaluateStep(pins.paint?.['circle-color'], count)).toBe(PIN_COLORS[tone]);
    }
    expect(pins.paint?.['circle-stroke-color']).toBe('#FFFFFF');
    const labels = layer('occurrence-pin-labels');
    expect(evaluateStep(labels.layout?.['text-size'], 8)).toBe(15);
    expect(evaluateStep(labels.layout?.['text-size'], 11)).toBe(18);
    // A soma dos relatos dos grupos vem de `clusterProperties`.
    expect(CLUSTER_PROPERTIES).toEqual({ reportCount: ['+', ['get', 'requestCount']] });
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
          properties: { id: 'p1', requestCount: 6 },
        },
      ],
    });
  });
});
