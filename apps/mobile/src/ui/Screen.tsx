import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from './theme';

export interface ScreenProps {
  children: ReactNode;
  /** Bordas com área segura. Padrão: só o topo (o rodapé cuida da parte de baixo). */
  edges?: Edge[];
  /** Fundo da tela; a galeria usa preto. */
  background?: string;
  style?: StyleProp<ViewStyle>;
}

/** Base de toda tela: fundo `bg` e área segura. */
export function Screen({ children, edges = ['top'], background = colors.bg, style }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: background }, style]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
