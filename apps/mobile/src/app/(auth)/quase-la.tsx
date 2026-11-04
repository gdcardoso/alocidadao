import { signupBodySchema, TERMS_VERSION } from '@alocidadao/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { apiErrorCode, apiErrorMessage, SIGNUP_EXPIRED_MESSAGE } from '../../auth/login-flow';
import { useSession } from '../../auth/use-session';
import { api } from '../../lib/api';
import { TermsCheckbox } from '../../legal/TermsCheckbox';
import { PrimaryButton } from '../../ui/Button';
import { FormError, FormLayout, FormText, FormTitle } from '../../ui/FormLayout';
import { Header } from '../../ui/Header';
import { TextField } from '../../ui/TextField';

const MIN_NAME_LENGTH = 2;
// Mesma regra de e-mail que a API aplica no cadastro.
const emailSchema = signupBodySchema.shape.email;

/** Tela 3 · Quase lá: nome, e-mail opcional e aceite dos Termos para criar a conta. */
export default function QuaseLa() {
  const { signupToken } = useLocalSearchParams<{ signupToken: string }>();
  const { signIn } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // O prazo do cadastro venceu: só resta recomeçar pelo celular.
  const [expired, setExpired] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const canSubmit = trimmedName.length >= MIN_NAME_LENGTH && accepted;

  const submit = async () => {
    if (!canSubmit) return;
    if (trimmedEmail && !emailSchema.safeParse(trimmedEmail).success) {
      setEmailError('Confira o e-mail digitado.');
      return;
    }
    setSaving(true);
    setError(null);
    setEmailError(null);
    try {
      const { session } = await api.signup({
        signupToken,
        name: trimmedName,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        acceptedTermsVersion: TERMS_VERSION,
      });
      await signIn(session);
    } catch (e) {
      const code = apiErrorCode(e);
      if (code === 'signup_token_invalid') {
        setExpired(true);
        setError(SIGNUP_EXPIRED_MESSAGE);
      } else if (code === 'email_in_use') setEmailError(apiErrorMessage(e));
      else setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormLayout
      header={<Header nav="back" onNavPress={() => router.back()} />}
      footer={
        <>
          <FormError message={error} />
          {expired ? (
            <PrimaryButton
              label="Começar de novo"
              onPress={() => router.dismissTo('/(auth)/entrar')}
            />
          ) : (
            <PrimaryButton
              label="Criar conta"
              onPress={() => void submit()}
              disabled={!canSubmit}
              loading={saving}
            />
          )}
        </>
      }
    >
      <FormTitle title="Quase lá!">
        <FormText>Número confirmado. Só faltam alguns dados.</FormText>
      </FormTitle>
      <TextField
        label="Nome"
        requirement="required"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={120}
        returnKeyType="next"
      />
      <TextField
        label="E-mail"
        requirement="optional"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setEmailError(null);
        }}
        placeholder="seuemail@exemplo.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        help="Ajuda a recuperar sua conta se você trocar de número."
        error={emailError}
      />
      <TermsCheckbox checked={accepted} onChange={setAccepted} />
    </FormLayout>
  );
}
