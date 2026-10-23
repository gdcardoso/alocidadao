import type { LucideIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, DISABLED_OPACITY, fonts } from './theme';

interface BaseButtonProps {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  /** Enviando: mostra o indicador e não aceita toque. */
  loading?: boolean;
  disabled?: boolean;
  /** `large`: 56 (raio 28, texto 17). `medium`: 48 (raio 24, texto 16), como no cartão da lista. */
  size?: 'large' | 'medium';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

interface Palette {
  bg: string;
  pressedBg: string;
  border: string;
  borderWidth: number;
  fg: string;
}

function BaseButton({
  label,
  onPress,
  icon: Icon,
  loading = false,
  disabled = false,
  size = 'large',
  style,
  accessibilityHint,
  palette,
}: BaseButtonProps & { palette: Palette }) {
  const inactive = disabled || loading;
  const large = size === 'large';
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        large ? styles.large : styles.medium,
        {
          backgroundColor: pressed ? palette.pressedBg : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.borderWidth,
        },
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={large ? 20 : 18} color={palette.fg} /> : null}
          <Text style={[styles.label, { color: palette.fg, fontSize: large ? 17 : 16 }]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export interface PrimaryButtonProps extends BaseButtonProps {
  /** `danger`: confirmação destrutiva (ex.: "Excluir conta"). */
  variant?: 'default' | 'danger';
}

/** Botão principal: pílula `primary`, texto `on-primary`. */
export function PrimaryButton({ variant = 'default', ...props }: PrimaryButtonProps) {
  const palette: Palette =
    variant === 'danger'
      ? {
          bg: colors.danger,
          pressedBg: colors.danger,
          border: colors.danger,
          borderWidth: 0,
          fg: colors.onPrimary,
        }
      : {
          bg: colors.primary,
          pressedBg: colors.primaryStrong,
          border: colors.primary,
          borderWidth: 0,
          fg: colors.onPrimary,
        };
  return <BaseButton {...props} palette={palette} />;
}

export interface SecondaryButtonProps extends BaseButtonProps {
  /**
   * `default`: contorno `border-input`. `danger`: contorno e texto `danger` (Cancelar
   * solicitação, Excluir minha conta). `outlinePrimary`: contorno azul (Ligar para 156).
   */
  variant?: 'default' | 'danger' | 'outlinePrimary';
}

/** Botão secundário: fundo `surface` e contorno de 1,5. */
export function SecondaryButton({ variant = 'default', ...props }: SecondaryButtonProps) {
  const fg =
    variant === 'danger'
      ? colors.danger
      : variant === 'outlinePrimary'
        ? colors.primary
        : colors.textPrimary;
  const border =
    variant === 'danger'
      ? colors.danger
      : variant === 'outlinePrimary'
        ? colors.primary
        : colors.borderInput;
  const palette: Palette = {
    bg: colors.surface,
    pressedBg: variant === 'outlinePrimary' ? colors.primarySoft : colors.bg,
    border,
    borderWidth: 1.5,
    fg,
  };
  return <BaseButton {...props} palette={palette} />;
}

export interface TextButtonProps extends Omit<BaseButtonProps, 'size'> {
  variant?: 'default' | 'danger';
}

/** Botão só de texto: 48 de altura, texto `primary` 16/600. */
export function TextButton({ variant = 'default', ...props }: TextButtonProps) {
  const palette: Palette = {
    bg: 'transparent',
    pressedBg: colors.primarySoft,
    border: 'transparent',
    borderWidth: 0,
    fg: variant === 'danger' ? colors.danger : colors.primary,
  };
  return <BaseButton {...props} size="medium" palette={palette} />;
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  large: { minHeight: 56, borderRadius: 28 },
  medium: { minHeight: 48, borderRadius: 24 },
  disabled: { opacity: DISABLED_OPACITY },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  label: { fontFamily: fonts.bodySemibold, textAlign: 'center', flexShrink: 1 },
});
