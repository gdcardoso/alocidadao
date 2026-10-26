import type { CategoryRow } from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { departmentsKey } from '../managers/managers-keys';
import { generalErrorMessage } from '../teams/team-errors';
import { Button } from '../ui/Button';
import { CategorySquare } from '../ui/CategorySquare';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Switch } from '../ui/Switch';
import { Tabs } from '../ui/Tabs';
import { useToast } from '../ui/Toast';
import { TopBar } from '../ui/TopBar';
import { CategoryEditor } from './CategoryEditor';
import { categoriesKey } from './category-keys';
import { CATEGORY_TABS } from './category-tabs';
import styles from './Categories.module.css';

const days = (count: number) => (count === 1 ? '1 dia' : `${count} dias`);

type Editing = { kind: 'create' } | { kind: 'edit'; id: string };

/** W7 · Categorias: tabela com a chave "No app" e o painel de edição à direita. */
export function CategoriesPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: categoriesKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelCategories(tenantId)),
  });
  const rows = (query.data?.items ?? []).toSorted((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const editedRow =
    editing?.kind === 'edit' ? rows.find((row) => row.id === editing.id) : undefined;

  const toggle = useMutation({
    mutationFn: (input: { category: CategoryRow; active: boolean }) =>
      session.withAuth(() =>
        api.panelUpdateCategory(tenantId, input.category.id, { active: input.active }),
      ),
    onSuccess: async (_row, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: categoriesKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: departmentsKey(tenantId) }),
      ]);
      toast.show(
        input.active
          ? `${input.category.name} aparece no app.`
          : `${input.category.name} não aparece mais no app.`,
      );
    },
    onError: (error) => setActionError(generalErrorMessage(error)),
  });

  const columns: DataTableColumn<CategoryRow>[] = [
    {
      key: 'name',
      header: 'Categoria',
      width: 210,
      render: (row) => (
        <span className={styles.cell}>
          <CategorySquare icon={row.icon ?? ''} iconGroup={row.iconGroup} size={32} />
          <span className={`${styles.name} ${row.active ? '' : styles.off}`}>{row.name}</span>
        </span>
      ),
    },
    { key: 'department', header: 'Setor responsável', width: 140, render: (r) => r.departmentName },
    {
      key: 'deadline',
      header: 'Prazo padrão',
      width: 110,
      render: (r) => days(r.defaultDeadlineDays),
    },
    {
      key: 'radius',
      header: 'Raio de agrupamento',
      width: 150,
      render: (r) => `${r.clusterRadiusM} m`,
    },
    {
      key: 'active',
      header: 'No app',
      width: 80,
      render: (row) => (
        <Switch
          checked={row.active}
          label={`Mostrar ${row.name} no app`}
          disabled={toggle.isPending}
          onChange={(active) => {
            setActionError(null);
            toggle.mutate({ category: row, active });
          }}
        />
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <TopBar
        title="Categorias"
        subtitle="O que o cidadão pode escolher ao registrar uma solicitação"
        actions={
          <Button
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setEditing({ kind: 'create' })}
          >
            Nova categoria
          </Button>
        }
      />
      <Tabs items={CATEGORY_TABS} />
      <div className={styles.area}>
        <div className={styles.list}>
          {query.isError ? (
            <p className={styles.state} role="alert">
              {generalErrorMessage(query.error)}
            </p>
          ) : null}
          {actionError ? (
            <p className={styles.state} role="alert">
              {actionError}
            </p>
          ) : null}
          {query.data ? (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              rowLabel={(row) => `Editar ${row.name}`}
              onRowClick={(row) => setEditing({ kind: 'edit', id: row.id })}
              isSelected={(row) => editing?.kind === 'edit' && editing.id === row.id}
            />
          ) : null}
        </div>
        {editing?.kind === 'create' ? (
          <CategoryEditor key="new" onClose={() => setEditing(null)} />
        ) : editedRow ? (
          <CategoryEditor
            key={editedRow.id}
            category={editedRow}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
