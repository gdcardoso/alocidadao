import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { apiErrorMessage, phoneFromInput } from '../../auth/login-flow';
import { api } from '../../lib/api';
import { isPhoneHintAvailable, pickPhoneHint } from '../../lib/phone-hint';
import { PrimaryButton } from '../../ui/Button';
import { FormLayout } from '../../ui/FormLayout';
import { maskPhoneInput } from '../../ui/format';
import { TextField } from '../../ui/TextField';
import { colors, fonts } from '../../ui/theme';

/** Tela 1 · Entrar: celular com +55 fixo; o código vai pelo WhatsApp. */
export default function Entrar() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A lista de números do chip (Android) aparece só no primeiro toque no campo vazio.
  const hintOffered = useRef(false);

  const e164 = phoneFromInput(phone);

  const offerPhoneHint = async () => {
    if (hintOffered.current || phone !== '') return;
    hintOffered.current = true;
    if (!(await isPhoneHintAvailable())) return;
    const digits = await pickPhoneHint();
    if (digits) setPhone(maskPhoneInput(digits));
  };

  const submit = async () => {
    if (!e164) return;
    setSending(true);
    setError(null);
    try {
      const challenge = await api.phoneStart({ phone: e164 });
      router.push({
        pathname: '/(auth)/codigo',
        params: {
          phone: e164,
          challengeId: challenge.challengeId,
          resendInSeconds: String(challenge.resendInSeconds),
        },
      });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <FormLayout
      contentStyle={styles.content}
      footer={
        <PrimaryButton
          label="Continuar"
          onPress={() => void submit()}
          disabled={!e164}
          loading={sending}
        />
      }
    >
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/logo.png')}
          resizeMode="contain"
          style={styles.logo}
          accessibilityLabel="Alô Cidadão"
        />
        <Text style={styles.tagline}>
          Avise a prefeitura sobre problemas na sua cidade e acompanhe cada etapa do atendimento.
        </Text>
      </View>
      <TextField
        label="Seu celular"
        prefix="+55"
        value={phone}
        onChangeText={(text) => {
          setPhone(maskPhoneInput(text));
          setError(null);
        }}
        onFocus={() => void offerPhoneHint()}
        placeholder="(11) 98765-4321"
        keyboardType="phone-pad"
        autoComplete="tel-national"
        textContentType="telephoneNumber"
        maxLength={15}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        help="Enviaremos um código pelo WhatsApp para confirmar que o número é seu."
        error={error}
      />
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 40, gap: 32 },
  brand: { gap: 16 },
  logo: { width: 240, height: 104 },
  tagline: { fontFamily: fonts.body, fontSize: 17, color: colors.textSecondary },
});
