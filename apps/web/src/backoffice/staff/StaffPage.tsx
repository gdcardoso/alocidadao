import { PLATFORM_ROLE_LABELS, type PlatformRole, type StaffMember } from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { api } from '../../api';
import { formatLastAccess } from '../../format/last-active';
import { useNow } from '../../format/use-now';
import { useSession } from '../../session/SessionProvider';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { RowMenu, type RowMenuItem } from '../../ui/RowMenu';
import { useToast } from '../../ui/Toast';
import { TopBar } from '../../ui/TopBar';
import { useBackofficeContext } from '../use-backoffice-context';
import { StaffDialog } from './StaffDialog';
import { staffErrorMessage } from './staff-errors';
import { STAFF_KEY } from './staff-keys';
import styles from './StaffPage.module.css';

const LIST_PATH = '/backoffice/prefeituras';

type Dialogs =
  | { kind: 'create' }
  | { kind: 'edit'; member: StaffMember }
  | { kind: 'role'; member: StaffMember }
  | { kind: 'remove'; member: StaffMember };

const otherRole = (role: PlatformRole): PlatformRole => (role === 'admin' ? 'support' : 'admin');

/** P6 · Equipe Alô Cidadão: só o Admin; o Suporte volta para as prefeituras. */
export function StaffPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const context = useBackofficeContext();
  const isAdmin = context.data?.platformRole === 'admin';
  const selfId = context.data?.user.id;
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: STAFF_KEY,
    queryFn: () => session.withAuth(() => api.backofficeStaff()),
    enabled: isAdmin,
  });

  const changeRole = useMutation({
    mutationFn: (member: StaffMember) =>
      session.withAuth(() =>
        api.backofficeUpdateStaff(member.userId, { platformRole: otherRole(member.platformRole) }),
      ),
    onSuccess: async (_result, member) => {
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      toast.show(`${member.name} agora é ${PLATFORM_ROLE_LABELS[otherRole(member.platformRole)]}.`);
      setDialog(null);
    },
    onError: (error) => {
      setActionError(staffErrorMessage(error));
      setDialog(null);
    },
  });

  const remove = useMutation({
    mutationFn: (member: StaffMember) =>
      session.withAuth(() => api.backofficeRemoveStaff(member.userId)),
    onSuccess: async (_result, member) => {
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      toast.show(`${member.name} saiu da equipe.`);
      setDialog(null);
    },
    onError: (error) => {
      setActionError(staffErrorMessage(error));
      setDialog(null);
    },
  });

  if (context.data && !isAdmin) return <Navigate to={LIST_PATH} replace />;

  function menuItems(row: StaffMember): RowMenuItem[] {
    const edit: RowMenuItem = {
      label: 'Editar',
      onSelect: () => {
        setActionError(null);
        setDialog({ kind: 'edit', member: row });
      },
    };
    // Ninguém troca o próprio papel nem se remove (a API também recusa).
    if (row.userId === selfId) return [edit];
    return [
      edit,
      {
        label: 'Trocar papel',
        onSelect: () => {
          setActionError(null);
          setDialog({ kind: 'role', member: row });
        },
      },
      {
        label: 'Remover da equipe',
        tone: 'danger',
        onSelect: () => {
          setActionError(null);
          setDialog({ kind: 'remove', member: row });
        },
      },
    ];
  }

  const columns: DataTableColumn<StaffMember>[] = [
    {
      key: 'name',
      header: 'Nome',
      width: 240,
      render: (row) => <span className={styles.name}>{row.name}</span>,
    },
    {
      key: 'cpf',
      header: 'CPF',
      width: 150,
      render: (row) => <span className={styles.muted}>{row.maskedCpf || '—'}</span>,
    },
    {
      key: 'email',
      header: 'E-mail (recebe o código)',
      width: 260,
      render: (row) => row.email || '—',
    },
    {
      key: 'role',
      header: 'Papel',
      width: 140,
      render: (row) => (
        <Badge tone={row.platformRole === 'admin' ? 'dark' : 'subtle'}>
          {PLATFORM_ROLE_LABELS[row.platformRole]}
        </Badge>
      ),
    },
    {
      key: 'lastActive',
      header: 'Último acesso',
      width: 160,
      render: (row) => (
        <span className={styles.muted}>
          {formatLastAccess(row.lastActiveAt ? new Date(row.lastActiveAt) : null, now)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 80,
      render: (row) => <RowMenu label={row.name} items={menuItems(row)} />,
    },
  ];

  const close = () => setDialog(null);

  return (
    <>
      <TopBar
        title="Equipe Alô Cidadão"
        subtitle="Quem da empresa acessa o backoffice"
        actions={
          isAdmin ? (
            <Button
              size="md"
              icon={<UserPlus size={16} aria-hidden />}
              onClick={() => {
                setActionError(null);
                setDialog({ kind: 'create' });
              }}
            >
              Adicionar pessoa
            </Button>
          ) : undefined
        }
      />
      <main className={styles.content}>
        {query.isError ? (
          <div role="alert" className={styles.error}>
            <p>Não foi possível carregar a equipe.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {actionError ? (
          <p role="alert" className={styles.alert}>
            {actionError}
          </p>
        ) : null}
        {query.data ? (
          <>
            <DataTable
              columns={columns}
              rows={query.data.items}
              rowKey={(row) => row.userId}
              rowLabel={(row) => row.name}
            />
            <div className={styles.roles}>
              <section className={styles.role}>
                <h2 className={styles.roleTitle}>Admin</h2>
                <p className={styles.roleText}>
                  Tudo: criar e suspender prefeituras, contratos, equipe interna, e entrar em
                  qualquer prefeitura.
                </p>
              </section>
              <section className={styles.role}>
                <h2 className={styles.roleTitle}>Suporte</h2>
                <p className={styles.roleText}>
                  Entra em qualquer prefeitura e faz a gestão dela (equipes, gestores, agentes,
                  solicitações). Não mexe em contratos nem na equipe interna.
                </p>
              </section>
            </div>
          </>
        ) : null}
      </main>

      {dialog?.kind === 'create' ? <StaffDialog onClose={close} /> : null}
      {dialog?.kind === 'edit' ? <StaffDialog member={dialog.member} onClose={close} /> : null}
      {dialog?.kind === 'role' ? (
        <ConfirmDialog
          title={`Trocar o papel de ${dialog.member.name}?`}
          text={`${dialog.member.name} passa de ${PLATFORM_ROLE_LABELS[dialog.member.platformRole]} para ${PLATFORM_ROLE_LABELS[otherRole(dialog.member.platformRole)]}.`}
          confirmLabel="Trocar papel"
          tone="primary"
          pending={changeRole.isPending}
          onConfirm={() => changeRole.mutate(dialog.member)}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <ConfirmDialog
          title={`Remover ${dialog.member.name} da equipe?`}
          text="A pessoa deixa de entrar no backoffice. A conta dela continua existindo."
          confirmLabel="Remover"
          tone="danger"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(dialog.member)}
          onClose={close}
        />
      ) : null}
    </>
  );
}
