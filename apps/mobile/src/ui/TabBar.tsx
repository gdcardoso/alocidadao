import { Camera, ClipboardList, List, User, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from './theme';

export type TabKey = 'requests' | 'new' | 'activities' | 'profile';

export interface TabBarProps {
  /** `citizen`: Solicitações, Nova e Perfil. `agent`: Atividades e Perfil, sem o botão Nova. */
  variant?: 'citizen' | 'agent';
  active: 'requests' | 'activities' | 'profile';
  onNavigate: (tab: TabKey) => void;
}

function Tab({
  label,
  icon: Icon,
  active,
  grow = false,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Divide a barra por igual com a outra aba (barra do agente). */
  grow?: boolean;
  onPress: () => void;
}) {
  const color = active ? colors.primary : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[styles.tab, grow && styles.tabGrow, active && styles.tabActive]}
    >
      <Icon size={22} color={color} />
      <Text style={[styles.tabLabel, { color }, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Barra de abas flutuante (telas 4 e 8): pílula de 68, raio 34, fundo `#FFFFFFF2`. "Nova" fica
 * sempre destacada em `primary`. No agente (A1), as duas abas dividem a barra por igual.
 */
export function TabBar({ variant = 'citizen', active, onNavigate }: TabBarProps) {
  const insets = useSafeAreaInsets();
  if (variant === 'agent') {
    return (
      <View
        style={[styles.outer, { paddingBottom: 16 + insets.bottom }]}
        accessibilityRole="tablist"
      >
        <View style={styles.bar}>
          <Tab
            label="Atividades"
            icon={ClipboardList}
            active={active === 'activities'}
            grow
            onPress={() => onNavigate('activities')}
          />
          <Tab
            label="Perfil"
            icon={User}
            active={active === 'profile'}
            grow
            onPress={() => onNavigate('profile')}
          />
        </View>
      </View>
    );
  }
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
          <Text style={styles.newLabel}>Nova</Text>
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
  // Largura mínima do Pencil; com fonte grande o item cresce em vez de cortar o texto.
  tab: {
    minWidth: 96,
    paddingHorizontal: 6,
    minHeight: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabGrow: { flex: 1 },
  tabActive: { backgroundColor: colors.primarySoft },
  tabLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, textAlign: 'center' },
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
