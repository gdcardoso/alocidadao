import { signupBodySchema } from '@alocidadao/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '../../../auth/login-flow';
import { sessionApi } from '../../../auth/native-session';
import { useSession } from '../../../auth/use-session';
import { PrimaryButton } from '../../../ui/Button';
import { FormError, FormLayout, FormText, FormTitle } from '../../../ui/FormLayout';
import { Header } from '../../../ui/Header';
import { TextField } from '../../../ui/TextField';

// Mesma regra de e-mail do cadastro.
const emailSchema = signupBodySchema.shape.email;

/** Perfil · E-mail de recuperação (não desenhada: segue o "Quase lá"). Vazio remove o e-mail. */
export default function EditarEmail() {
  const { me, refreshMe } = useSession();
  const [email, setEmail] = useState(me?.email ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = email.trim();
  const canSave = trimmed !== (me?.email ?? '');

  const save = async () => {
    if (!canSave) return;
    if (trimmed && !emailSchema.safeParse(trimmed).success) {
      setFieldError('Confira o e-mail digitado.');
      return;
    }
    setSaving(true);
    setError(null);
    setFieldError(null);
    try {
      await sessionApi.updateMe({ email: trimmed || null });
      await refreshMe().catch(() => undefined);
      router.back();
    } catch (e) {
      // e-mail em uso fica no campo; conta do painel (403) e o resto, embaixo.
      if (apiErrorCode(e) === 'email_in_use') setFieldError(apiErrorMessage(e));
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
          <PrimaryButton
            label="Salvar"
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
        </>
      }
    >
      <FormTitle title="E-mail de recuperação">
        <FormText>Ajuda a recuperar sua conta se você trocar de número.</FormText>
      </FormTitle>
      <TextField
        label="E-mail"
        requirement="optional"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setFieldError(null);
          setError(null);
        }}
        autoFocus
        placeholder="seuemail@exemplo.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        error={fieldError}
      />
    </FormLayout>
  );
}
