import type { TenantStatus } from '@alocidadao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CirclePause, CirclePlay, LogIn } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { errorCode } from '../../occurrence/use-occurrence-actions';
import { useSession } from '../../session/SessionProvider';
import { generalErrorMessage } from '../../teams/team-errors';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useToast } from '../../ui/Toast';
import styles from './TenantDetailPage.module.css';

type StatusAction = 'activate' | 'suspend' | 'reactivate';

const NOT_READY_MESSAGE = 'Antes de ativar, cadastre ao menos uma categoria ativa e uma equipe.';
const CONFLICT_MESSAGE = 'A situação da prefeitura mudou. Atualizamos a tela.';
const SUCCESS: Record<StatusAction, string> = {
  activate: 'Prefeitura ativada.',
  suspend: 'Prefeitura suspensa.',
  reactivate: 'Prefeitura reativada.',
};

export interface TenantStatusActionsProps {
  tenantId: string;
  displayName: string;
  status: TenantStatus;
  /** Só o admin da plataforma muda o status. */
  isAdmin: boolean;
  entering: boolean;
  onEnter: () => void;
}

/** Ações do cabeçalho da P3: entrar no painel e, para o admin, ativar, suspender e reativar. */
export function TenantStatusActions({
  tenantId,
  displayName,
  status,
  isAdmin,
  entering,
  onEnter,
}: TenantStatusActionsProps) {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<'activate' | 'suspend' | null>(null);

  const change = useMutation({
    mutationFn: (action: StatusAction) =>
      session.withAuth(() => api.backofficeSetTenantStatus(tenantId, { action })),
    onSuccess: async (_result, action) => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['backoffice'] });
      toast.show(SUCCESS[action]);
    },
    onError: async (error) => {
      setConfirming(null);
      const code = errorCode(error);
      if (code === 'tenant_not_ready') {
        toast.show(NOT_READY_MESSAGE);
      } else if (code === 'tenant_status_conflict') {
        toast.show(CONFLICT_MESSAGE);
        await queryClient.invalidateQueries({ queryKey: ['backoffice'] });
      } else {
        toast.show(generalErrorMessage(error));
      }
    },
  });

  const suspended = status === 'suspended';
  return (
    <div className={styles.actions}>
      <div className={styles.actionButtons}>
        {isAdmin && status === 'active' ? (
          <Button
            variant="danger-outline"
            size="md"
            icon={<CirclePause size={16} aria-hidden />}
            onClick={() => setConfirming('suspend')}
          >
            Suspender
          </Button>
        ) : null}
        {isAdmin && status === 'suspended' ? (
          <Button
            size="md"
            icon={<CirclePlay size={16} aria-hidden />}
            disabled={change.isPending}
            onClick={() => change.mutate('reactivate')}
          >
            Reativar
          </Button>
        ) : null}
        {isAdmin && status === 'onboarding' ? (
          <Button size="md" onClick={() => setConfirming('activate')}>
            Ativar prefeitura
          </Button>
        ) : null}
        <Button
          size="md"
          icon={<LogIn size={16} aria-hidden />}
          disabled={suspended || entering}
          aria-describedby={suspended ? 'enter-help' : undefined}
          onClick={onEnter}
        >
          Entrar no painel da prefeitura
        </Button>
      </div>
      {suspended ? (
        <p id="enter-help" className={styles.actionHelp}>
          Reative a prefeitura para entrar no painel.
        </p>
      ) : null}

      {confirming === 'activate' ? (
        <ConfirmDialog
          title={`Ativar ${displayName}?`}
          text="Ela passa a aparecer para os cidadãos do município, que poderão registrar solicitações."
          confirmLabel="Ativar"
          tone="primary"
          pending={change.isPending}
          onConfirm={() => change.mutate('activate')}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {confirming === 'suspend' ? (
        <ConfirmDialog
          title={`Suspender ${displayName}?`}
          text="Os cidadãos deixam de conseguir registrar solicitações no município, e gestores e agentes perdem o acesso. As solicitações abertas ficam como estão."
          confirmLabel="Suspender"
          tone="danger"
          pending={change.isPending}
          onConfirm={() => change.mutate('suspend')}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
