import type { OccurrencePoint } from '@alocidadao/shared';
import { Minus, Plus } from 'lucide-react';
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import {
  CLUSTER_PROPERTIES,
  clusterLayers,
  MAP_STYLE_URL,
  PIN_COLORS,
  PIN_LAYER_ID,
  pointsToGeoJson,
  SELECTION_LAYER_IDS,
  selectionFilter,
  SOURCE_ID,
} from './map-style';
import styles from './MapPage.module.css';

/** Ponto para onde o mapa voa (busca); `seq` muda a cada pedido, mesmo para o mesmo lugar. */
export interface MapFocus {
  lat: number;
  lng: number;
  seq: number;
}

export interface OccurrenceMapProps {
  items: readonly OccurrencePoint[];
  /** Limite da prefeitura `[oeste, sul, leste, norte]`, para o enquadramento inicial. */
  bounds: [number, number, number, number] | null;
  selectedId: string | null;
  focus: MapFocus | null;
  onSelect: (occurrenceId: string) => void;
}

/** Zoom de quem vem da busca: acima do `clusterMaxZoom`, o ponto aparece sozinho. */
const FOCUS_ZOOM = 17;
const FIRST_POINT_ZOOM = 14;

/**
 * Mapa real (MapLibre) com os pinos agrupados. Clicar num grupo aproxima; clicar num ponto
 * chama `onSelect`. Zoom e legenda do Pencil por cima. Não roda no jsdom: sem teste unitário.
 */
export function OccurrenceMap({ items, bounds, selectedId, focus, onSelect }: OccurrenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initialBoundsRef = useRef(bounds);
  const framedRef = useRef(bounds !== null);
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  const openedFramedRef = useRef(false);
  /** Destino do voo da busca em andamento; some quando o mapa para. */
  const flightRef = useRef<maplibregl.FlyToOptions | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
    selectedIdRef.current = selectedId;
  });

  // Cria o mapa uma vez; o limite da prefeitura só vale para o enquadramento inicial.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initialBounds = initialBoundsRef.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      ...(initialBounds ? { bounds: initialBounds, fitBoundsOptions: { padding: 40 } } : {}),
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: pointsToGeoJson([]),
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 16,
        clusterProperties: CLUSTER_PROPERTIES,
      });
      for (const layer of clusterLayers()) map.addLayer(layer);

      map.on('click', PIN_LAYER_ID, (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const center = feature.geometry.coordinates as [number, number];
        const clusterId = feature.properties?.cluster_id as number | undefined;
        if (clusterId !== undefined) {
          const source = map.getSource<GeoJSONSource>(SOURCE_ID);
          void source
            ?.getClusterExpansionZoom(clusterId)
            .then((zoom) => map.easeTo({ center, zoom }));
          return;
        }
        const id = feature.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      map.on('mouseenter', PIN_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', PIN_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });
      setReady(true);
    });

    map.on('moveend', () => {
      flightRef.current = null;
    });

    // O painel do ponto abre e fecha: o mapa acompanha a largura. O voo do MapLibre fixa o
    // ponto da tela no início; se o painel abre no meio do voo, voa de novo para o ponto
    // terminar no centro do mapa já estreito.
    const observer = new ResizeObserver(() => {
      // O resize também dispara `moveend`: guarda o destino antes.
      const flight = flightRef.current;
      map.resize();
      if (flight) {
        // O flyTo para o voo anterior (outro `moveend`): o destino volta depois dele.
        map.flyTo(flight);
        flightRef.current = flight;
      }
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(pointsToGeoJson(items));
    // Link com `?ocorrencia=`: na primeira carga, o mapa abre no ponto escolhido.
    const opened = items.find((item) => item.id === selectedIdRef.current);
    if (!openedFramedRef.current && opened) {
      openedFramedRef.current = true;
      framedRef.current = true;
      map.resize();
      map.jumpTo({ center: [opened.location.lng, opened.location.lat], zoom: FOCUS_ZOOM });
      return;
    }
    // Sem limite da prefeitura: centro do primeiro ponto, uma vez.
    const first = items[0];
    if (!framedRef.current && first) {
      framedRef.current = true;
      map.jumpTo({ center: [first.location.lng, first.location.lat], zoom: FIRST_POINT_ZOOM });
    }
    if (items.length > 0) openedFramedRef.current = true;
  }, [ready, items]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const id of SELECTION_LAYER_IDS) map.setFilter(id, selectionFilter(selectedId));
  }, [ready, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    framedRef.current = true;
    // O painel do ponto abre junto com a busca: mede o mapa antes de voar.
    map.resize();
    const flight = {
      center: [focus.lng, focus.lat] as [number, number],
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
    };
    map.flyTo(flight);
    flightRef.current = flight;
  }, [ready, focus]);

  return (
    <>
      {/* O CSS do MapLibre põe `position: relative` no contêiner: a moldura absoluta fica por fora. */}
      <div className={styles.map}>
        <div ref={containerRef} className={styles.mapCanvas} />
      </div>
      <div className={styles.zoom}>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Aproximar"
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Afastar"
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus size={18} />
        </button>
      </div>
      <div className={styles.legend}>
        <p className={styles.legendTitle}>Ocorrências por ponto</p>
        <ul className={styles.legendList}>
          <li>
            <span className={styles.legendDot} style={{ background: PIN_COLORS.danger }} />
            Mais de 15 relatos
          </li>
          <li>
            <span className={styles.legendDot} style={{ background: PIN_COLORS.warning }} />5 a 15
            relatos
          </li>
          <li>
            <span className={styles.legendDot} style={{ background: PIN_COLORS.primary }} />
            Até 4 relatos
          </li>
        </ul>
        <p className={styles.legendNote}>O número indica quantos relatos há no ponto</p>
      </div>
    </>
  );
}
