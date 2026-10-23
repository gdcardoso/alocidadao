import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './theme';

export interface FooterProps {
  children: ReactNode;
  /**
   * `bar`: fundo `surface` com borda superior (Nova solicitação, detalhe), padding 14/20/28/20.
   * `plain`: sem fundo (cadastro, 5c), padding 0/24/36/24.
   */
  variant?: 'bar' | 'plain';
}

/** Rodapé fixo com os botões da tela. Respeita a área segura de baixo. */
export function Footer({ children, variant = 'bar' }: FooterProps) {
  const insets = useSafeAreaInsets();
  const bar = variant === 'bar';
  const base = bar ? 28 : 36;
  return (
    <View
      style={[
        bar ? styles.bar : styles.plain,
        { paddingBottom: Math.max(base, insets.bottom + 12) },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  plain: { paddingTop: 0, paddingHorizontal: 24, gap: 12 },
});
