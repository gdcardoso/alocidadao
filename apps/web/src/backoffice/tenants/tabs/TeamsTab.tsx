import type { TeamSummary } from '@alocidadao/shared';
import { api } from '../../../api';
import type { DataTableColumn } from '../../../ui/DataTable';
import type { ReadOnlyTabProps } from '../tenant-tabs';
import { ReadOnlyTab } from './ReadOnlyTab';
import styles from './ReadOnlyTab.module.css';

const columns: DataTableColumn<TeamSummary>[] = [
  { key: 'name', header: 'Equipe', width: 260, render: (row) => row.name },
  { key: 'department', header: 'Setor', width: 200, render: (row) => row.departmentName },
  {
    key: 'agents',
    header: 'Agentes',
    width: 200,
    render: (row) => (
      <span className={styles.muted}>
        {row.activeAgentCount} {row.activeAgentCount === 1 ? 'ativo' : 'ativos'} de {row.agentCount}
      </span>
    ),
  },
  {
    key: 'orders',
    header: 'Ordens abertas',
    width: 140,
    render: (row) => row.openWorkOrderCount,
  },
];

/** Aba Equipes e agentes da P3: só leitura (equipes e contagens); a edição é no painel. */
export function TeamsTab({ tenant, onOpenPanel }: ReadOnlyTabProps) {
  return (
    <ReadOnlyTab
      name="teams"
      tenantId={tenant.id}
      load={() => api.backofficeTenantTeams(tenant.id)}
      columns={columns}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.name}
      hint="Equipes da prefeitura e quantos agentes cada uma tem."
      emptyText="Nenhuma equipe cadastrada."
      errorText="Não foi possível carregar as equipes."
      panelPath="/equipes"
      onOpenPanel={onOpenPanel}
    />
  );
}
