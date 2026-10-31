import type { CategoryRow } from '@alocidadao/shared';
import { api } from '../../../api';
import { CategorySquare } from '../../../ui/CategorySquare';
import type { DataTableColumn } from '../../../ui/DataTable';
import type { ReadOnlyTabProps } from '../tenant-tabs';
import { ReadOnlyTab } from './ReadOnlyTab';
import styles from './ReadOnlyTab.module.css';

const columns: DataTableColumn<CategoryRow>[] = [
  {
    key: 'name',
    header: 'Categoria',
    width: 240,
    render: (row) => (
      <span className={styles.cell}>
        <CategorySquare icon={row.icon ?? ''} iconGroup={row.iconGroup} size={32} />
        <span className={row.active ? '' : styles.off}>{row.name}</span>
      </span>
    ),
  },
  { key: 'department', header: 'Setor responsável', width: 200, render: (r) => r.departmentName },
  {
    key: 'deadline',
    header: 'Prazo padrão',
    width: 130,
    render: (r) => `${r.defaultDeadlineDays} ${r.defaultDeadlineDays === 1 ? 'dia' : 'dias'}`,
  },
  {
    key: 'radius',
    header: 'Raio de agrupamento',
    width: 160,
    render: (r) => `${r.clusterRadiusM} m`,
  },
  { key: 'active', header: 'No app', width: 100, render: (r) => (r.active ? 'Sim' : 'Não') },
];

/** Aba Categorias da P3: só leitura; a edição é no painel. */
export function CategoriesTab({ tenant, onOpenPanel }: ReadOnlyTabProps) {
  return (
    <ReadOnlyTab
      name="categories"
      tenantId={tenant.id}
      load={() => api.backofficeTenantCategories(tenant.id)}
      columns={columns}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.name}
      hint="Categorias que o cidadão vê no app, com setor e prazo."
      emptyText="Nenhuma categoria cadastrada."
      errorText="Não foi possível carregar as categorias."
      panelPath="/categorias"
      onOpenPanel={onOpenPanel}
    />
  );
}
