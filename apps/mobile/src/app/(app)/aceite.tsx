import { ApiError } from '@alocidadao/api-client';
import { router } from 'expo-router';
import { useState } from 'react';
import { homeFor } from '../../auth/app-mode';
import { sessionApi } from '../../auth/native-session';
import { useSession } from '../../auth/use-session';
import { TermsCheckbox } from '../../legal/TermsCheckbox';
import { PrimaryButton, TextButton } from '../../ui/Button';
import { FormError, FormLayout, FormText, FormTitle } from '../../ui/FormLayout';

const NETWORK_ERROR = 'Sem conexão. Confira a internet e tente de novo.';
const UNEXPECTED_ERROR = 'Não foi possível continuar agora. Tente de novo em instantes.';

/** Primeiro acesso de quem ainda não aceitou os Termos (agente cadastrado pela prefeitura). */
export default function Aceite() {
  const { mode, refreshMe, signOut } = useSession();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await sessionApi.acceptTerms();
      await refreshMe();
      router.replace(homeFor(mode));
    } catch (e) {
      setError(e instanceof ApiError ? UNEXPECTED_ERROR : NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
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
          <TextButton label="Sair" onPress={() => void signOut()} />
        </>
      }
    >
      <FormTitle title="Antes de continuar">
        <FormText>Para usar o Alô Cidadão, leia e aceite os Termos de Uso.</FormText>
      </FormTitle>
      <TermsCheckbox checked={checked} onChange={setChecked} />
    </FormLayout>
  );
}
