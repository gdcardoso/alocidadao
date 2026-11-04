import { ApiError } from '@alocidadao/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { TermsCheckbox } from './TermsCheckbox';
import styles from './TermsGate.module.css';

function isTermsRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.body as { code?: string } | null)?.code === 'terms_required'
  );
}

/**
 * Barra o painel e o backoffice até a pessoa aceitar os Termos. Um 403 `terms_required` em
 * qualquer chamada invalida `me`, que traz a tela de aceite de volta.
 */
export function TermsGate() {
  const { session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(false);

  // Mesma chave do PanelLayout: uma só consulta de `me` para os dois.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => session.withAuth(() => api.me()),
  });

  useEffect(() => {
    const watch = (error: unknown) => {
      if (isTermsRequired(error)) void queryClient.invalidateQueries({ queryKey: ['me'] });
    };
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') watch(event.action.error);
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') watch(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient]);

  const accept = useMutation({
    mutationFn: () => session.withAuth(() => api.acceptTerms()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  async function signOut() {
    await session.signOut();
    void navigate('/entrar', { replace: true });
  }

  if (meQuery.isPending) return null;
  // Falha ao ler `me`: o layout de dentro mostra o erro com "Tentar de novo".
  if (meQuery.isError || meQuery.data.termsAccepted) return <Outlet />;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Antes de continuar</h1>
        <p className={styles.text}>Para usar o Alô Cidadão, leia e aceite os Termos de Uso.</p>
        <TermsCheckbox checked={checked} onChange={setChecked} />
        {accept.isError ? (
          <p role="alert" className={styles.error}>
            {accept.error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button disabled={!checked || accept.isPending} onClick={() => accept.mutate()}>
            Continuar
          </Button>
          <button type="button" className={styles.signOut} onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </div>
    </main>
  );
}
