import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Checkbox } from '../ui/Checkbox';
import { colors, fonts } from '../ui/theme';
import { useLegalReadSignal } from './acceptance-store';

const LABEL = 'Li e aceito os Termos de Uso e estou ciente da Política de Privacidade.';

export interface TermsCheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

/**
 * Caixa de aceite: os dois nomes são links que abrem o texto com "Li e concordo", que
 * marca a caixa ao voltar.
 */
export function TermsCheckbox({ checked, onChange }: TermsCheckboxProps) {
  useLegalReadSignal(() => onChange(true));
  return (
    <Checkbox
      checked={checked}
      onChange={onChange}
      accessibilityLabel={LABEL}
      label={
        <Text style={styles.label}>
          Li e aceito os{' '}
          <Text
            style={styles.link}
            accessibilityRole="link"
            onPress={() => router.push('/termos?aceite=1')}
          >
            Termos de Uso
          </Text>{' '}
          e estou ciente da{' '}
          <Text
            style={styles.link}
            accessibilityRole="link"
            onPress={() => router.push('/privacidade?aceite=1')}
          >
            Política de Privacidade
          </Text>
          .
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  label: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary },
  link: { fontFamily: fonts.bodySemibold, color: colors.primary, textDecorationLine: 'underline' },
});
