import { router } from 'expo-router';
import { useState } from 'react';
import { phoneFromInput } from '../../../auth/login-flow';
import { sessionApi } from '../../../auth/native-session';
import { phoneChangeErrorMessage } from '../../../citizen/profile-view';
import { PrimaryButton } from '../../../ui/Button';
import { FormLayout, FormText, FormTitle } from '../../../ui/FormLayout';
import { maskPhoneInput } from '../../../ui/format';
import { Header } from '../../../ui/Header';
import { TextField } from '../../../ui/TextField';

/** Perfil · Trocar número: o novo celular recebe um código, como no login (telas 1 e 2). */
export default function TrocarCelular() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const e164 = phoneFromInput(phone);

  const submit = async () => {
    if (!e164) return;
    setSending(true);
    setError(null);
    try {
      const challenge = await sessionApi.phoneChangeStart({ phone: e164 });
      router.push({
        pathname: '/(app)/perfil/celular-codigo',
        params: {
          phone: e164,
          challengeId: challenge.challengeId,
          resendInSeconds: String(challenge.resendInSeconds),
        },
      });
    } catch (e) {
      setError(phoneChangeErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <FormLayout
      header={<Header nav="back" onNavPress={() => router.back()} />}
      footer={
        <PrimaryButton
          label="Continuar"
          onPress={() => void submit()}
          disabled={!e164}
          loading={sending}
        />
      }
    >
      <FormTitle title="Trocar número">
        <FormText>Enviaremos um código por SMS para confirmar que o número é seu.</FormText>
      </FormTitle>
      <TextField
        label="Novo celular"
        prefix="+55"
        value={phone}
        onChangeText={(text) => {
          setPhone(maskPhoneInput(text));
          setError(null);
        }}
        autoFocus
        placeholder="(11) 98765-4321"
        keyboardType="phone-pad"
        autoComplete="tel-national"
        textContentType="telephoneNumber"
        maxLength={15}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        error={error}
      />
    </FormLayout>
  );
}
