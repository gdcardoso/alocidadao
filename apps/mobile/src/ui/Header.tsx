import { StyleSheet, Text, View } from 'react-native';
import { NavButton } from './IconButton';
import { colors, fonts } from './theme';

export interface HeaderProps {
  /** Voltar (`arrow-left`) ou Fechar (`x`). Sem ele, só o título. */
  nav?: 'back' | 'close';
  onNavPress?: () => void;
  title?: string;
  subtitle?: string;
  /**
   * `left`: título ao lado do botão (detalhe, Lexend 20). `center`: título no meio com
   * espaçador de 44 (Nova solicitação, Lexend 18).
   */
  align?: 'left' | 'center';
}

/** Cabeçalho das telas internas: padding 0/16/8/16, gap 12. */
export function Header({ nav, onNavPress, title, subtitle, align = 'left' }: HeaderProps) {
  const button = nav && onNavPress ? <NavButton kind={nav} onPress={onNavPress} /> : null;
  if (align === 'center') {
    return (
      <View style={styles.row}>
        {button ?? <View style={styles.spacer} />}
        <Text style={styles.centerTitle} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.spacer} />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {button}
      {title || subtitle ? (
        <View style={styles.texts}>
          {title ? (
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
    minHeight: 52,
  },
  spacer: { width: 44, height: 44 },
  texts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.textPrimary },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  centerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
});
