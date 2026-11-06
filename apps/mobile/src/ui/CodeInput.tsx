import { CODE_LENGTH } from '@alocidadao/shared';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius } from './theme';

export interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  autoFocus?: boolean;
  /** Código errado: bordas `danger`. */
  invalid?: boolean;
}

/**
 * Seis caixas de dígito (60 de altura, raio 14). Um único campo invisível recebe o texto,
 * para o teclado numérico e o preenchimento automático do código funcionarem.
 */
export function CodeInput({ value, onChange, autoFocus = false, invalid = false }: CodeInputProps) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(autoFocus);
  const digits = value.slice(0, CODE_LENGTH).split('');
  const activeIndex = Math.min(digits.length, CODE_LENGTH - 1);

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessible={false}
      style={styles.row}
      importantForAccessibility="no"
    >
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const active = focused && index === activeIndex;
        const showCursor = active && digits.length < CODE_LENGTH;
        return (
          <View
            key={index}
            style={[styles.box, active && styles.boxActive, invalid && styles.boxInvalid]}
            importantForAccessibility="no-hide-descendants"
          >
            {digits[index] ? (
              <Text style={styles.digit}>{digits[index]}</Text>
            ) : showCursor ? (
              <View style={styles.cursor} />
            ) : null}
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        accessibilityLabel="Código de 6 dígitos"
        caretHidden
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  box: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.digit,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: colors.primary, borderWidth: 2 },
  boxInvalid: { borderColor: colors.danger },
  digit: { fontFamily: fonts.heading, fontSize: 26, color: colors.textPrimary },
  cursor: { width: 2, height: 28, backgroundColor: colors.primary },
  // Fica sobre as caixas, transparente: o toque cai no campo e o leitor de tela o encontra.
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0, color: 'transparent' },
});
