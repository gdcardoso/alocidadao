import { Info, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fonts } from '../theme';

// Peças comuns da A3 e da A4.

export interface SectionLabelProps {
  label: string;
  requirement?: 'required' | 'optional';
}

/** Rótulo de seção da A3/A4: Lexend 17/600 + "obrigatório"/"opcional" (14) à direita. */
export function SectionLabel({ label, requirement }: SectionLabelProps) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label} accessibilityRole="header">
        {label}
      </Text>
      {requirement ? (
        <Text style={styles.requirement}>
          {requirement === 'required' ? 'obrigatório' : 'opcional'}
        </Text>
      ) : null}
    </View>
  );
}

/** Rótulo com um texto livre à direita (`obrigatório · 1 de 3`). */
export function SectionLabelWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label} accessibilityRole="header">
        {label}
      </Text>
      <Text style={styles.requirement}>{hint}</Text>
    </View>
  );
}

export interface NoteFieldProps extends Omit<TextInputProps, 'style' | 'multiline'> {
  accessibilityLabel: string;
}

/** Campo multilinha do Pencil: altura 110, raio 20, padding 16, foco com borda `primary` 2. */
export function NoteField({ onFocus, onBlur, ...input }: NoteFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderWidth = focused ? 2 : 1;
  return (
    <View
      style={[
        styles.box,
        {
          borderWidth,
          borderColor: focused ? colors.primary : colors.borderInput,
          padding: 16 - (borderWidth - 1),
        },
      ]}
    >
      <TextInput
        {...input}
        multiline
        placeholderTextColor={colors.textPlaceholder}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={styles.input}
      />
    </View>
  );
}

/** Informação (ícone `info` 18 + texto 15 `text-secondary`). */
export function InfoNote({ text }: { text: string }) {
  return (
    <View style={styles.info} accessible accessibilityRole="text">
      <Info size={18} color={colors.textSecondary} style={styles.infoIcon} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

/** Aviso do rodapé das telas de envio do agente. */
export function OfflineHint() {
  return (
    <View style={styles.offline} accessible accessibilityRole="text">
      <WifiOff size={16} color={colors.textSecondary} />
      <Text style={styles.offlineText}>Funciona sem internet: enviamos quando conectar.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  label: { fontFamily: fonts.heading, fontSize: 17, color: colors.textPrimary, flexShrink: 1 },
  requirement: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  box: { minHeight: 110, borderRadius: 20, backgroundColor: colors.surface },
  input: {
    flex: 1,
    minHeight: 76,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    padding: 0,
  },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIcon: { marginTop: 2 },
  infoText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  offlineText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
