import type { GeoPoint } from '@alocidadao/shared';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { MAP_STYLE_URL } from '../map/map-style';
import styles from './Teams.module.css';

export interface BasePickerMapProps {
  value: GeoPoint | null;
  /** Limite da prefeitura `[oeste, sul, leste, norte]`, para quando ainda não há ponto. */
  bounds: [number, number, number, number] | null;
  onPick: (point: GeoPoint) => void;
}

const POINT_ZOOM = 15;

/** Mapa de 512x220 da base da equipe (MapLibre, mesmo estilo do mapa principal). Sem teste no jsdom. */
export function BasePickerMap({ value, bounds, onPick }: BasePickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const initial = useRef({ value, bounds });

  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { value: start, bounds: limit } = initial.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      attributionControl: { compact: true },
      ...(start
        ? { center: [start.lng, start.lat] as [number, number], zoom: POINT_ZOOM }
        : limit
          ? { bounds: limit, fitBoundsOptions: { padding: 20 } }
          : {}),
    });
    mapRef.current = map;
    map.on('click', (event) => onPickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (value) {
      markerRef.current = new maplibregl.Marker({ color: '#0057B8' })
        .setLngLat([value.lng, value.lat])
        .addTo(map);
    }
  }, [value]);

  return <div ref={containerRef} className={styles.map} aria-label="Mapa da base" />;
}
