import { ApiError } from '@alocidadao/api-client';
import { router } from 'expo-router';
import { useState } from 'react';
import { homeFor } from '../../auth/app-mode';
import { apiErrorMessage } from '../../auth/login-flow';
import { sessionApi } from '../../auth/native-session';
import { useSession } from '../../auth/use-session';
import { countPendingUploads } from '../../citizen/pending-uploads';
import { NO_NETWORK_MESSAGE } from '../../citizen/detail-view';
import { signOutWarning } from '../../citizen/profile-view';
import { TermsCheckbox } from '../../legal/TermsCheckbox';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { PrimaryButton, TextButton } from '../../ui/Button';
import { FormError, FormLayout, FormText, FormTitle } from '../../ui/FormLayout';

/** Primeiro acesso de quem ainda não aceitou os Termos (agente cadastrado pela prefeitura). */
export default function Aceite() {
  const { mode, refreshMe, signOut } = useSession();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      setLeaving(false);
    }
  };

  // Mesmo aviso do Perfil: sair apaga a fila do aparelho.
  const askToLeave = async () => {
    const count = await countPendingUploads();
    if (count > 0) setPendingWarning(count);
    else await leave();
  };

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await sessionApi.acceptTerms();
      await refreshMe();
      router.replace(homeFor(mode));
    } catch (e) {
      setError(e instanceof ApiError ? apiErrorMessage(e) : NO_NETWORK_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <FormLayout
        footer={
          <>
            <FormError message={error} />
            <PrimaryButton
              label="Continuar"
              onPress={() => void accept()}
              disabled={!checked}
              loading={saving}
            />
            <TextButton label="Sair" onPress={() => void askToLeave()} />
          </>
        }
      >
        <FormTitle title="Antes de continuar">
          <FormText>Para usar o Alô Cidadão, leia e aceite os Termos de Uso.</FormText>
        </FormTitle>
        <TermsCheckbox checked={checked} onChange={setChecked} />
      </FormLayout>
      <ConfirmDialog
        visible={pendingWarning !== null}
        title="Sair da conta?"
        message={pendingWarning !== null ? signOutWarning(pendingWarning) : undefined}
        confirmLabel="Sair mesmo assim"
        cancelLabel="Ficar"
        destructive
        loading={leaving}
        onConfirm={() => void leave()}
        onCancel={() => setPendingWarning(null)}
      />
    </>
  );
}
