import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Footer } from './Footer';
import { Screen } from './Screen';
import { colors, fonts, space } from './theme';

export interface FormLayoutProps {
  /** Topo fixo (ex.: Voltar). */
  header?: ReactNode;
  children: ReactNode;
  /** Botões do rodapé sem fundo (padding 0/24/36/24), que sobem com o teclado. */
  footer: ReactNode;
  /** Padding e gap do conteúdo; padrão 24 em volta e 24 entre blocos. */
  contentStyle?: StyleProp<ViewStyle>;
}

/** Base das telas de cadastro (1, 2, 3): conteúdo com rolagem e rodapé acima do teclado. */
export function FormLayout({ header, children, footer, contentStyle }: FormLayoutProps) {
  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {header}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        <Footer variant="plain">{footer}</Footer>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Título (Lexend 26/600) e apoio (16, `text-secondary`) das telas de cadastro. */
export function FormTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Texto de apoio abaixo do título. */
export function FormText({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

/** Mensagem de erro da tela (14/600, `danger`), lida pelo leitor de tela quando aparece. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      {message}
    </Text>
  );
}

/** Link de texto (16/600, `primary`) alinhado ao texto, com área de toque de 44. */
export function FormLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.gutterAuth, gap: 24, flexGrow: 1 },
  titleBlock: { gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 26, color: colors.textPrimary },
  text: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkPressed: { opacity: 0.6 },
  linkText: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.primary },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.danger },
});
