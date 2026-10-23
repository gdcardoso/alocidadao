import { Camera, List, User, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from './theme';

export type TabKey = 'requests' | 'new' | 'profile';

export interface TabBarProps {
  active: 'requests' | 'profile';
  onNavigate: (tab: TabKey) => void;
}

function Tab({
  label,
  icon: Icon,
  active,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? colors.primary : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Icon size={22} color={color} />
      <Text style={[styles.tabLabel, { color }, active && styles.tabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Barra de abas flutuante (telas 4 e 8): pílula de 68, raio 34, fundo `#FFFFFFF2`. "Nova" fica
 * sempre destacada em `primary`.
 */
export function TabBar({ active, onNavigate }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.outer, { paddingBottom: 16 + insets.bottom }]} accessibilityRole="tablist">
      <View style={styles.bar}>
        <Tab
          label="Solicitações"
          icon={List}
          active={active === 'requests'}
          onPress={() => onNavigate('requests')}
        />
        <Pressable
          onPress={() => onNavigate('new')}
          accessibilityRole="button"
          accessibilityLabel="Nova solicitação"
          style={({ pressed }) => [styles.newButton, pressed && styles.newPressed]}
        >
          <Camera size={22} color={colors.onPrimary} />
          <Text style={styles.newLabel} numberOfLines={1}>
            Nova
          </Text>
        </Pressable>
        <Tab
          label="Perfil"
          icon={User}
          active={active === 'profile'}
          onPress={() => onNavigate('profile')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 16, paddingTop: 0 },
  bar: {
    minHeight: 68,
    borderRadius: 34,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tab: {
    width: 96,
    minHeight: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabActive: { backgroundColor: colors.primarySoft },
  tabLabel: { fontFamily: fonts.bodyMedium, fontSize: 12 },
  tabLabelActive: { fontFamily: fonts.bodySemibold },
  newButton: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newPressed: { backgroundColor: colors.primaryStrong },
  newLabel: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.onPrimary },
});
