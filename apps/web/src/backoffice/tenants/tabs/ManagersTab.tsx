import type { StaffManagerRow } from '@alocidadao/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../api';
import { useSession } from '../../../session/SessionProvider';
import type { DataTableColumn } from '../../../ui/DataTable';
import { inviteErrorMessage, inviteSentMessage } from '../../../ui/invite-errors';
import { RowMenu } from '../../../ui/RowMenu';
import { useToast } from '../../../ui/Toast';
import type { ReadOnlyTabProps } from '../tenant-tabs';
import { ReadOnlyTab } from './ReadOnlyTab';
import styles from './ReadOnlyTab.module.css';

const baseColumns: DataTableColumn<StaffManagerRow>[] = [
  {
    key: 'name',
    header: 'Nome',
    width: 230,
    render: (row) => (
      <span className={row.status === 'inactive' ? styles.off : ''}>{row.name}</span>
    ),
  },
  {
    key: 'cpf',
    header: 'CPF',
    width: 150,
    render: (row) => <span className={styles.muted}>{row.cpfMasked ?? '—'}</span>,
  },
  { key: 'email', header: 'E-mail', width: 270, render: (row) => row.emailMasked ?? '—' },
  {
    key: 'departments',
    header: 'Setores',
    width: 200,
    render: (row) =>
      row.role === 'tenant_admin'
        ? 'Todos'
        : row.departments.length === 0
          ? '—'
          : row.departments.map((department) => department.name).join(', '),
  },
  {
    key: 'role',
    header: 'Papel',
    width: 130,
    render: (row) =>
      row.status === 'inactive' ? 'Desativado' : row.role === 'tenant_admin' ? 'Admin' : 'Gestor',
  },
];

/** Aba Gestores da P3: lista com CPF e e-mail mascarados; o menu só reenvia o convite. */
export function ManagersTab({ tenant, onOpenPanel }: ReadOnlyTabProps) {
  const { session } = useSession();
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);

  const resend = useMutation({
    mutationFn: (row: StaffManagerRow) =>
      session.withAuth(() => api.backofficeResendTenantManagerInvite(tenant.id, row.userId)),
    onSuccess: (result) => toast.show(inviteSentMessage(result.maskedEmail)),
    onError: (error) => setActionError(inviteErrorMessage(error)),
  });

  const columns: DataTableColumn<StaffManagerRow>[] = [
    ...baseColumns,
    {
      key: 'actions',
      header: '',
      width: 60,
      render: (row) => (
        <RowMenu
          label={row.name}
          items={[
            {
              label: 'Reenviar convite',
              onSelect: () => {
                setActionError(null);
                resend.mutate(row);
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <ReadOnlyTab
      name="managers"
      tenantId={tenant.id}
      load={() => api.backofficeTenantManagers(tenant.id)}
      columns={columns}
      rowKey={(row) => row.userId}
      rowLabel={(row) => row.name}
      hint="Gestores e admins da prefeitura, com os setores de cada um."
      emptyText="Nenhum gestor cadastrado."
      errorText="Não foi possível carregar os gestores."
      panelPath="/equipes/gestores"
      onOpenPanel={onOpenPanel}
    >
      {actionError ? <p role="alert">{actionError}</p> : null}
    </ReadOnlyTab>
  );
}
