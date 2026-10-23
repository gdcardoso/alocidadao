import { useState, type ComponentRef, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { FieldLabel } from './FieldLabel';
import { colors, fonts, radius } from './theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  requirement?: 'required' | 'optional';
  /** Texto de ajuda abaixo do campo. */
  help?: string;
  /** Mensagem de erro; troca a ajuda e pinta a borda de `danger`. */
  error?: string | null;
  /** Prefixo fixo antes do valor, com divisor (ex.: "+55"). */
  prefix?: string;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

/** Campo de texto do Pencil: 56 de altura, raio 16, foco com borda `primary` 2. */
export function TextField({
  label,
  requirement,
  help,
  error,
  prefix,
  onFocus,
  onBlur,
  multiline,
  ref,
  ...input
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.borderInput;
  const borderWidth = focused || error ? 2 : 1;
  return (
    <View style={styles.container}>
      <FieldLabel label={label} requirement={requirement} />
      <View
        style={[
          styles.box,
          multiline && styles.multiline,
          { borderColor, borderWidth, paddingHorizontal: 16 - (borderWidth - 1) },
        ]}
      >
        {prefix ? (
          <>
            <Text style={styles.prefix}>{prefix}</Text>
            <View style={styles.divider} />
          </>
        ) : null}
        <TextInput
          ref={ref}
          {...input}
          multiline={multiline}
          accessibilityLabel={input.accessibilityLabel ?? label}
          accessibilityHint={input.accessibilityHint ?? error ?? help}
          placeholderTextColor={colors.textPlaceholder}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, multiline && styles.inputMultiline]}
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : help ? (
        <Text style={styles.help}>{help}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  box: {
    minHeight: 56,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  multiline: { minHeight: 120, alignItems: 'flex-start', paddingVertical: 12 },
  prefix: { fontFamily: fonts.bodySemibold, fontSize: 17, color: colors.textPrimary },
  divider: { width: 1, height: 24, backgroundColor: colors.borderInput },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  inputMultiline: { textAlignVertical: 'top', paddingVertical: 0 },
  help: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.danger },
});
