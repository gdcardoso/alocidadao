import { Camera, Map as MapView, Marker } from '@maplibre/maplibre-react-native';
import type { GeoPoint } from '@alocidadao/shared';
import { WifiOff } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { mapBounds } from '../../agent/agent-screen';
import type { AgentCardView } from '../../agent/agent-view';
import { CategoryIcon } from '../CategoryIcon';
import { colors, fonts, space } from '../theme';
import { WorkOrderCard } from './WorkOrderCard';

/** Estilo do mapa: OpenFreeMap, como no "Ajustar local". */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EDGE = 48;
/** Intervalo em que o toque no mapa ainda é o mesmo toque do pino. */
const MARKER_PRESS_WINDOW_MS = 400;

export interface WorkOrderMapProps {
  items: readonly AgentCardView[];
  /** Posição do aparelho: o agente no mapa. */
  here: GeoPoint | null;
  online: boolean;
  /** Altura da barra de abas flutuante, que fica por cima do mapa. */
  bottomInset: number;
  onOpen: (id: string) => void;
}

/**
 * Modo Mapa da A1: um pino por atividade, na cor do grupo da categoria, e o agente. Tocar no
 * pino mostra o cartão da atividade; tocar no cartão abre o detalhe. Sem rede, só o aviso.
 */
export function WorkOrderMap({ items, here, online, bottomInset, onOpen }: WorkOrderMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  // No Android o toque no pino também chega ao mapa logo depois: esse não limpa a escolha.
  const markerPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(markerPress.current ?? undefined), []);
  const select = (id: string) => {
    clearTimeout(markerPress.current ?? undefined);
    markerPress.current = setTimeout(() => {
      markerPress.current = null;
    }, MARKER_PRESS_WINDOW_MS);
    setSelectedId(id);
  };
  const clearSelection = () => {
    if (markerPress.current === null) setSelectedId(null);
  };

  // Área inicial: todos os pinos e o agente. Depois disso, o mapa fica onde o agente deixar.
  const [initialBounds] = useState(() =>
    mapBounds([...items.map((item) => item.location), ...(here ? [here] : [])]),
  );
  const padding = useMemo(
    () => ({ top: EDGE, right: EDGE, bottom: bottomInset + EDGE, left: EDGE }),
    [bottomInset],
  );

  if (!online) {
    return (
      <View style={styles.offline}>
        <WifiOff size={28} color={colors.textSecondary} />
        <Text style={styles.offlineText}>O mapa precisa de internet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        compass={false}
        touchPitch={false}
        touchRotate={false}
        attributionPosition={{ bottom: bottomInset + 8, right: 8 }}
        logoPosition={{ bottom: bottomInset + 8, left: 8 }}
        onPress={clearSelection}
      >
        <Camera
          initialViewState={
            initialBounds
              ? { bounds: initialBounds, padding }
              : { center: [-46.6333, -23.5505], zoom: 12 }
          }
        />
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <Marker
              key={item.id}
              id={`wo-${item.id}`}
              lngLat={[item.location.lng, item.location.lat]}
              onPress={() => select(item.id)}
            >
              <View
                style={[styles.pin, active && styles.pinActive]}
                accessible
                accessibilityRole="button"
                accessibilityLabel={[item.categoryName, item.address, item.badge.label]
                  .filter(Boolean)
                  .join(', ')}
                accessibilityState={{ selected: active }}
              >
                <CategoryIcon icon={item.categoryIcon} group={item.categoryGroup} shape="circle" />
              </View>
            </Marker>
          );
        })}
        {here ? (
          <Marker id="agent-here" lngLat={[here.lng, here.lat]}>
            <View style={styles.hereDot} accessible accessibilityLabel="Você está aqui" />
          </Marker>
        ) : null}
      </MapView>
      {selected ? (
        <View style={[styles.cardWrap, { bottom: bottomInset + 12 }]} pointerEvents="box-none">
          <WorkOrderCard view={selected} onPress={() => onOpen(selected.id)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: colors.border },
  // Pino: o círculo da categoria (44) com aro `surface`; o selecionado ganha aro `text-primary`.
  pin: { padding: 3, borderRadius: 25, backgroundColor: colors.surface },
  pinActive: { backgroundColor: colors.textPrimary },
  hereDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  cardWrap: { position: 'absolute', left: space.gutter, right: space.gutter },
  offline: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: space.gutter,
    gap: 12,
  },
  offlineText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
