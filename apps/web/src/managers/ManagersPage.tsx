import type { ManagerRow } from '@alocidadao/shared';
import { maskCpf } from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { initialsOf } from '../shell/menu';
import { generalErrorMessage } from '../teams/team-errors';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { RowMenu } from '../ui/RowMenu';
import { Tabs } from '../ui/Tabs';
import { useToast } from '../ui/Toast';
import { TopBar } from '../ui/TopBar';
import { ManagerDialog } from './ManagerDialog';
import { departmentsKey, managersKey } from './managers-keys';
import styles from './Managers.module.css';

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

/** Admins, gestores ativos e desativados; cada grupo por nome. */
function groupOf(row: ManagerRow): number {
  if (row.status === 'inactive') return 2;
  return row.role === 'tenant_admin' ? 0 : 1;
}

function sortRows(rows: ManagerRow[]): ManagerRow[] {
  return rows.toSorted((a, b) => groupOf(a) - groupOf(b) || a.name.localeCompare(b.name, 'pt-BR'));
}

function subtitle(rows: ManagerRow[]): string {
  const active = rows.filter((row) => row.status === 'active');
  const admins = active.filter((row) => row.role === 'tenant_admin').length;
  const managers = active.length - admins;
  return `${plural(managers, 'gestor', 'gestores')} · ${plural(admins, 'admin da prefeitura', 'admins da prefeitura')}`;
}

type Dialogs =
  | { kind: 'create' }
  | { kind: 'edit'; manager: ManagerRow }
  | { kind: 'deactivate'; manager: ManagerRow };

const TABS = [
  { to: '/equipes', label: 'Equipes e agentes' },
  { to: '/equipes/gestores', label: 'Gestores' },
];

/** W6b · Gestores (aba da W6, só para o admin). */
export function ManagersPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: managersKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelManagers(tenantId)),
  });
  const rows = sortRows(query.data?.items ?? []);

  const toggle = useMutation({
    mutationFn: (input: { manager: ManagerRow; action: 'deactivate' | 'reactivate' }) =>
      session.withAuth(() =>
        api.panelUpdateManager(tenantId, input.manager.userId, { action: input.action }),
      ),
    onSuccess: async (_row, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: managersKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: departmentsKey(tenantId) }),
      ]);
      toast.show(
        input.action === 'deactivate'
          ? `${input.manager.name} desativado.`
          : `${input.manager.name} reativado.`,
      );
      setDialog(null);
    },
    onError: (error) => {
      // Reativar gestor que entrou na equipe Alô Cidadão: o banco recusa.
      setActionError(
        errorCode(error) === 'staff_account_not_allowed'
          ? 'Esta pessoa é da equipe Alô Cidadão. Use outro CPF.'
          : generalErrorMessage(error),
      );
      setDialog(null);
    },
  });

  const columns: DataTableColumn<ManagerRow>[] = [
    {
      key: 'name',
      header: 'Nome',
      width: 230,
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(row.name)}
          </span>
          <span className={`${styles.name} ${row.status === 'inactive' ? styles.inactive : ''}`}>
            {row.name}
          </span>
        </span>
      ),
    },
    {
      key: 'cpf',
      header: 'CPF',
      width: 150,
      render: (row) => <span className={styles.muted}>{row.cpf ? maskCpf(row.cpf) : '—'}</span>,
    },
    {
      key: 'email',
      header: 'E-mail (recebe o código)',
      width: 270,
      render: (row) => row.email ?? '—',
    },
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
        row.status === 'inactive' ? (
          <span className={styles.badge}>Desativado</span>
        ) : row.role === 'tenant_admin' ? (
          <span className={`${styles.badge} ${styles.admin}`}>Admin</span>
        ) : (
          <span className={styles.badge}>Gestor</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      render: (row) =>
        row.role === 'tenant_admin' ? null : (
          <RowMenu
            label={row.name}
            items={[
              { label: 'Editar', onSelect: () => setDialog({ kind: 'edit', manager: row }) },
              row.status === 'inactive'
                ? {
                    label: 'Reativar',
                    onSelect: () => {
                      setActionError(null);
                      toggle.mutate({ manager: row, action: 'reactivate' });
                    },
                  }
                : {
                    label: 'Desativar',
                    tone: 'danger',
                    onSelect: () => {
                      setActionError(null);
                      setDialog({ kind: 'deactivate', manager: row });
                    },
                  },
            ]}
          />
        ),
    },
  ];

  const close = () => setDialog(null);

  return (
    <div className={styles.page}>
      <TopBar
        title="Equipes e agentes"
        {...(query.data ? { subtitle: subtitle(rows) } : {})}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setDialog({ kind: 'create' })}
          >
            Novo gestor
          </Button>
        }
      />
      <Tabs items={TABS} />
      <div className={styles.area}>
        {query.isError ? (
          <p className={styles.state} role="alert">
            {generalErrorMessage(query.error)}
          </p>
        ) : query.data ? (
          <>
            {actionError ? (
              <p className={styles.state} role="alert">
                {actionError}
              </p>
            ) : null}
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.userId}
              rowLabel={(row) => row.name}
            />
            <p className={styles.note}>
              <Info size={16} aria-hidden="true" />O gestor entra no painel com o CPF e recebe o
              código neste e-mail. Ele vê só as ocorrências dos setores marcados.
            </p>
          </>
        ) : null}
      </div>

      {dialog?.kind === 'create' ? <ManagerDialog onClose={close} /> : null}
      {dialog?.kind === 'edit' ? <ManagerDialog manager={dialog.manager} onClose={close} /> : null}
      {dialog?.kind === 'deactivate' ? (
        <ConfirmDialog
          title={`Desativar ${dialog.manager.name}?`}
          text="Ele deixa de entrar no painel. Dá para reativar depois."
          confirmLabel="Desativar"
          tone="danger"
          pending={toggle.isPending}
          onConfirm={() => toggle.mutate({ manager: dialog.manager, action: 'deactivate' })}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
