import { CODE_LENGTH, CODE_RESEND_SECONDS } from '@alocidadao/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Timer } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { profileRouteFor } from '../../../auth/app-mode';
import { apiErrorCode, apiRetryAfterSeconds, formatCountdown } from '../../../auth/login-flow';
import { sessionApi } from '../../../auth/native-session';
import { useCountdown } from '../../../auth/use-countdown';
import { useSession } from '../../../auth/use-session';
import { phoneChangeErrorMessage } from '../../../citizen/profile-view';
import { PrimaryButton } from '../../../ui/Button';
import { CodeInput } from '../../../ui/CodeInput';
import { FormError, FormLayout, FormLink, FormText, FormTitle } from '../../../ui/FormLayout';
import { formatPhoneBR } from '../../../ui/format';
import { Header } from '../../../ui/Header';
import { colors, fonts } from '../../../ui/theme';

type Params = { phone: string; challengeId: string; resendInSeconds?: string };

/** Perfil · código do novo número: igual à tela 2, com a troca no lugar do login. */
export default function CodigoNovoCelular() {
  const params = useLocalSearchParams<Params>();
  const { refreshMe, mode } = useSession();
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const countdown = useCountdown(Number(params.resendInSeconds) || CODE_RESEND_SECONDS);

  const backToPhone = () => router.back();

  const fail = (e: unknown) => {
    setError({ code: apiErrorCode(e), message: phoneChangeErrorMessage(e) });
    // Limite de envio: o contador volta a correr pelo tempo que a API pediu.
    const wait = apiRetryAfterSeconds(e);
    if (wait !== null) countdown.restart(wait);
  };

  const confirm = async () => {
    if (code.length !== CODE_LENGTH) return;
    setVerifying(true);
    setError(null);
    try {
      await sessionApi.phoneChangeVerify({ challengeId, code });
      await refreshMe().catch(() => undefined);
      // Volta ao Perfil do modo atual (as abas do outro modo não existem).
      router.dismissTo(profileRouteFor(mode));
    } catch (e) {
      fail(e);
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError(null);
    try {
      const challenge = await sessionApi.phoneChangeStart({ phone: params.phone });
      setChallengeId(challenge.challengeId);
      setCode('');
      countdown.restart(challenge.resendInSeconds);
    } catch (e) {
      fail(e);
    } finally {
      setResending(false);
    }
  };

  return (
    <FormLayout
      header={<Header nav="back" onNavPress={backToPhone} />}
      contentStyle={styles.content}
      footer={
        <PrimaryButton
          label="Confirmar"
          onPress={() => void confirm()}
          disabled={code.length !== CODE_LENGTH}
          loading={verifying}
        />
      }
    >
      <FormTitle title="Digite o código">
        <FormText>Enviado por SMS para {formatPhoneBR(params.phone)}.</FormText>
        <FormLink label="Alterar número" onPress={backToPhone} />
      </FormTitle>
      <View style={styles.codeBlock}>
        <CodeInput
          value={code}
          onChange={(value) => {
            setCode(value);
            setError(null);
          }}
          autoFocus
          invalid={error?.code === 'code_invalid'}
        />
        <FormError message={error?.message ?? null} />
      </View>
      {countdown.remaining > 0 ? (
        <View style={styles.resend} accessible accessibilityLiveRegion="none">
          <Timer size={18} color={colors.textSecondary} />
          <Text style={styles.resendText}>
            Reenviar código em {formatCountdown(countdown.remaining)}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={() => void resend()}
          disabled={resending}
          accessibilityRole="button"
          accessibilityLabel="Reenviar código"
          accessibilityState={{ disabled: resending, busy: resending }}
          style={({ pressed }) => [styles.resend, (pressed || resending) && styles.pressed]}
        >
          <Timer size={18} color={colors.primary} />
          <Text style={[styles.resendText, styles.resendLink]}>Reenviar código</Text>
        </Pressable>
      )}
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  content: { gap: 28 },
  codeBlock: { gap: 12 },
  resend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  resendText: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  resendLink: { fontFamily: fonts.bodySemibold, color: colors.primary },
  pressed: { opacity: 0.6 },
});
