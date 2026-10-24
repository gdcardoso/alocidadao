import { MapPin, Navigation } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { SecondaryButton } from '../Button';
import { colors, fonts, radius } from '../theme';

export interface LocationCardProps {
  address: string;
  /** `'A 350 m de você'`; `null` sem a posição do aparelho. */
  distance: string | null;
  onOpenRoute: () => void;
}

/** Cartão "Local" da A2/A5: endereço, distância e o botão contorno "Abrir rota no mapa". */
export function LocationCard({ address, distance, onOpenRoute }: LocationCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row} accessible>
        <MapPin size={22} color={colors.primary} />
        <View style={styles.texts}>
          <Text style={styles.address}>{address}</Text>
          {distance ? <Text style={styles.distance}>{distance}</Text> : null}
        </View>
      </View>
      <SecondaryButton
        label="Abrir rota no mapa"
        icon={Navigation}
        variant="outlinePrimary"
        size="medium"
        onPress={onOpenRoute}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: 16,
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  texts: { flex: 1, gap: 2 },
  address: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  distance: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
});
