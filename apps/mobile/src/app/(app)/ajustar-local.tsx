import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapView,
  Marker,
  type CameraRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { MAX_LOCATION_ADJUST_M, distanceMeters, type GeoPoint } from '@alocidadao/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, MapPin } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type NativeSyntheticEvent } from 'react-native';
import { setAdjustedLocation } from '../../citizen/adjust-channel';
import { circleRing, limitAdjust } from '../../citizen/new-request';
import { PrimaryButton } from '../../ui/Button';
import { Footer } from '../../ui/Footer';
import { Header } from '../../ui/Header';
import { Screen } from '../../ui/Screen';
import { colors, fonts } from '../../ui/theme';

/** Estilo do mapa: OpenFreeMap, sem custo e sem chave. */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PIN_SIZE = 44;

/** Mapa do "Ajustar": o pino fica no centro e não passa de 200 m do GPS. */
export default function AjustarLocal() {
  const params = useLocalSearchParams<{
    gpsLat: string;
    gpsLng: string;
    lat: string;
    lng: string;
  }>();
  const gps = useMemo<GeoPoint>(
    () => ({ lat: Number(params.gpsLat), lng: Number(params.gpsLng) }),
    [params.gpsLat, params.gpsLng],
  );
  const start = useMemo<GeoPoint>(
    () => ({ lat: Number(params.lat), lng: Number(params.lng) }),
    [params.lat, params.lng],
  );
  const camera = useRef<CameraRef>(null);
  const [point, setPoint] = useState<GeoPoint>(start);
  const [clamped, setClamped] = useState(false);

  const area = useMemo<GeoJSON.Feature>(
    () => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [circleRing(gps, MAX_LOCATION_ADJUST_M)] },
    }),
    [gps],
  );

  const onRegionDidChange = (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const [lng, lat] = event.nativeEvent.center;
    const candidate = { lat, lng };
    const limited = limitAdjust(gps, candidate);
    const outside = distanceMeters(limited, candidate) > 0.5;
    // Movimento do próprio mapa (abertura, volta ao limite): só acompanha o ponto válido.
    if (!event.nativeEvent.userInteraction) {
      if (!outside) setPoint(limited);
      return;
    }
    setPoint(limited);
    setClamped(outside);
    // Arrastou para fora do círculo: o mapa volta para o limite e a tela avisa.
    if (outside) camera.current?.easeTo({ center: [limited.lng, limited.lat], duration: 300 });
  };

  const confirm = () => {
    setAdjustedLocation(point);
    router.back();
  };

  return (
    <Screen>
      <Header nav="back" onNavPress={() => router.back()} title="Ajustar local" />
      <View style={styles.mapBox}>
        <MapView
          style={StyleSheet.absoluteFill}
          mapStyle={MAP_STYLE}
          onRegionDidChange={onRegionDidChange}
          compass={false}
          touchPitch={false}
          touchRotate={false}
        >
          <Camera
            ref={camera}
            initialViewState={{ center: [start.lng, start.lat], zoom: 17 }}
            minZoom={14}
          />
          <GeoJSONSource id="limit" data={area}>
            <Layer
              type="fill"
              id="limit-fill"
              style={{ fillColor: colors.primary, fillOpacity: 0.08 }}
            />
            <Layer
              type="line"
              id="limit-line"
              style={{ lineColor: colors.primary, lineWidth: 2, lineOpacity: 0.6 }}
            />
          </GeoJSONSource>
          <Marker id="gps" lngLat={[gps.lng, gps.lat]}>
            <View style={styles.gpsDot} accessibilityLabel="Onde a foto foi tirada" />
          </Marker>
        </MapView>
        {/* O pino fica parado no centro; quem se move é o mapa. A ponta marca o local. */}
        <View style={styles.pinWrap} pointerEvents="none">
          <MapPin size={PIN_SIZE} color={colors.primary} fill={colors.surface} strokeWidth={2.5} />
        </View>
      </View>
      <Footer>
        <Text
          style={[styles.notice, clamped && styles.noticeWarning]}
          accessibilityLiveRegion="polite"
        >
          O ponto pode ficar a até 200 m de onde a foto foi tirada.
        </Text>
        <PrimaryButton label="Confirmar local" icon={Check} onPress={confirm} />
      </Footer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapBox: { flex: 1, backgroundColor: colors.border },
  pinWrap: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -PIN_SIZE / 2,
    // A ponta do ícone fica perto da base da caixa.
    marginTop: -PIN_SIZE * 0.92,
  },
  gpsDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  notice: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  noticeWarning: { fontFamily: fonts.bodySemibold, color: colors.warning },
});
