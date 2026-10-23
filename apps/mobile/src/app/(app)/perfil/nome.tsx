import { router } from 'expo-router';
import { useState } from 'react';
import { apiErrorMessage } from '../../../auth/login-flow';
import { sessionApi } from '../../../auth/native-session';
import { useSession } from '../../../auth/use-session';
import { PrimaryButton } from '../../../ui/Button';
import { FormError, FormLayout, FormTitle } from '../../../ui/FormLayout';
import { Header } from '../../../ui/Header';
import { TextField } from '../../../ui/TextField';

const MIN_NAME_LENGTH = 2;

/** Perfil · Nome (não desenhada no Pencil: segue o "Quase lá"). */
export default function EditarNome() {
  const { me, refreshMe } = useSession();
  const [name, setName] = useState(me?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const canSave = trimmed.length >= MIN_NAME_LENGTH && trimmed !== me?.name;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await sessionApi.updateMe({ name: trimmed });
      await refreshMe().catch(() => undefined);
      router.back();
    } catch (e) {
      setError(apiErrorMessage(e));
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
      <FormTitle title="Seu nome" />
      <TextField
        label="Nome"
        requirement="required"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        autoFocus
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={120}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
    </FormLayout>
  );
}
