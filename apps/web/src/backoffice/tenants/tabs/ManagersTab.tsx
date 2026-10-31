import { maskCpf, type ManagerRow } from '@alocidadao/shared';
import { api } from '../../../api';
import type { DataTableColumn } from '../../../ui/DataTable';
import type { ReadOnlyTabProps } from '../tenant-tabs';
import { ReadOnlyTab } from './ReadOnlyTab';
import styles from './ReadOnlyTab.module.css';

const columns: DataTableColumn<ManagerRow>[] = [
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
    render: (row) => <span className={styles.muted}>{row.cpf ? maskCpf(row.cpf) : '—'}</span>,
  },
  { key: 'email', header: 'E-mail', width: 270, render: (row) => row.email ?? '—' },
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

/** Aba Gestores da P3: só leitura; o CPF sai mascarado, como no painel. */
export function ManagersTab({ tenant, onOpenPanel }: ReadOnlyTabProps) {
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
    />
  );
}
