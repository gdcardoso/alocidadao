import { CODE_LENGTH } from '@alocidadao/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { apiErrorCode, apiErrorMessage } from '../../auth/login-flow';
import { useSession } from '../../auth/use-session';
import { api } from '../../lib/api';
import { PrimaryButton } from '../../ui/Button';
import { CodeInput } from '../../ui/CodeInput';
import { FormError, FormLayout, FormLink, FormText, FormTitle } from '../../ui/FormLayout';
import { Header } from '../../ui/Header';

type Params = { recoveryChallengeId: string; maskedEmail: string; signupToken: string };

/**
 * Número que estava numa conta parada: só entra nela quem confirma o código enviado ao e-mail
 * da conta. Sem acesso ao e-mail, segue para "Quase lá" e cria conta nova.
 */
export default function ConfirmarEmail() {
  const { recoveryChallengeId, maskedEmail, signupToken } = useLocalSearchParams<Params>();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const confirm = async () => {
    if (code.length !== CODE_LENGTH) return;
    setVerifying(true);
    setError(null);
    try {
      const { session } = await api.recoveryVerify({
        challengeId: recoveryChallengeId,
        code,
        signupToken,
      });
      await signIn(session);
    } catch (e) {
      setError({ code: apiErrorCode(e), message: apiErrorMessage(e) });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <FormLayout
      header={<Header nav="back" onNavPress={() => router.back()} />}
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
      <FormTitle title="Confirme que a conta é sua">
        <FormText>
          Este número estava em uma conta sem uso. Enviamos um código para {maskedEmail}.
        </FormText>
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
      <FormLink
        label="Não tenho acesso a esse e-mail"
        onPress={() => router.replace({ pathname: '/(auth)/quase-la', params: { signupToken } })}
      />
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  content: { gap: 28 },
  codeBlock: { gap: 12 },
});
