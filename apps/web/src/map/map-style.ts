import { pinStyleFor, type OccurrencePoint } from '@alocidadao/shared';
import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from 'maplibre-gl';

/** Mesmo estilo do app. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const SOURCE_ID = 'occurrences';
export const PIN_LAYER_ID = 'occurrence-pins';

/** O MapLibre não lê variáveis CSS: estas cores repetem `--primary`, `--warning` e `--danger`. */
export const PIN_COLORS = { primary: '#0057B8', warning: '#B45309', danger: '#B91C1C' } as const;
const PIN_STROKE = '#FFFFFF';
const SELECTED_GLOW = '#1557B0';

/** Soma os relatos dos pontos de cada grupo em `reportCount`. */
export const CLUSTER_PROPERTIES = { reportCount: ['+', ['get', 'requestCount']] } as const;

/** Relatos do grupo (`reportCount`) ou do ponto sozinho (`requestCount`). */
const REPORTS: ExpressionSpecification = [
  'coalesce',
  ['get', 'reportCount'],
  ['get', 'requestCount'],
];

/**
 * Monta `['step', relatos, …]` a partir de `pinStyleFor`, criando um degrau a cada mudança
 * de valor entre 1 e 16 relatos (acima disso a faixa não muda).
 */
function pinStep<T extends string | number>(
  pick: (style: ReturnType<typeof pinStyleFor>) => T,
): ExpressionSpecification {
  const base = pick(pinStyleFor(1));
  const stops: (string | number)[] = [];
  let current = base;
  for (let count = 2; count <= 16; count += 1) {
    const value = pick(pinStyleFor(count));
    if (value !== current) {
      stops.push(count, value);
      current = value;
    }
  }
  return ['step', REPORTS, base, ...stops] as ExpressionSpecification;
}

/** Pontos sozinhos com este id: o pino selecionado. Sem seleção, nada casa. */
export function selectionFilter(selectedId: string | null): FilterSpecification {
  if (!selectedId) return ['==', ['get', 'id'], ''];
  return ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], selectedId]];
}

/** Camadas dos pinos: brilho do selecionado, círculo por faixa de relatos e o número. */
export function clusterLayers(selectedId: string | null = null): LayerSpecification[] {
  const radius = pinStep((style) => style.size / 2);
  return [
    {
      id: 'occurrence-selected-glow',
      type: 'circle',
      source: SOURCE_ID,
      filter: selectionFilter(selectedId),
      paint: {
        'circle-radius': ['+', radius, 10],
        'circle-color': SELECTED_GLOW,
        'circle-opacity': 0.67,
        'circle-blur': 0.6,
      },
    },
    {
      id: PIN_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': radius,
        'circle-color': pinStep((style) => PIN_COLORS[style.tone]),
        'circle-stroke-color': PIN_STROKE,
        'circle-stroke-width': 3,
      },
    },
    {
      id: 'occurrence-selected-ring',
      type: 'circle',
      source: SOURCE_ID,
      filter: selectionFilter(selectedId),
      paint: {
        'circle-radius': radius,
        'circle-color': 'rgba(0, 0, 0, 0)',
        'circle-stroke-color': PIN_STROKE,
        'circle-stroke-width': 4,
      },
    },
    {
      id: 'occurrence-pin-labels',
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['to-string', REPORTS],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['step', REPORTS, 15, 11, 18],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': PIN_STROKE },
    },
  ];
}

/** Camadas que mudam com a seleção. */
export const SELECTION_LAYER_IDS = ['occurrence-selected-glow', 'occurrence-selected-ring'];

export interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; requestCount: number };
  }[];
}

export function pointsToGeoJson(items: readonly OccurrencePoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((item) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.location.lng, item.location.lat] },
      properties: { id: item.id, requestCount: item.requestCount },
    })),
  };
}
