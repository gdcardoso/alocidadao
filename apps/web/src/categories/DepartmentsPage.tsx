import type { DepartmentRow } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { departmentsKey } from '../managers/managers-keys';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { generalErrorMessage } from '../teams/team-errors';
import { Button } from '../ui/Button';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { RowMenu } from '../ui/RowMenu';
import { Tabs } from '../ui/Tabs';
import { TopBar } from '../ui/TopBar';
import { CATEGORY_TABS } from './category-tabs';
import { DepartmentDialog } from './DepartmentDialog';
import styles from './Categories.module.css';

type Dialogs = { kind: 'create' } | { kind: 'rename'; department: DepartmentRow };

/** W7 · aba Setores: contagens por setor, novo setor e renomear. */
export function DepartmentsPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const [dialog, setDialog] = useState<Dialogs | null>(null);

  const query = useQuery({
    queryKey: departmentsKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelDepartments(tenantId)),
  });
  const rows = (query.data?.items ?? []).toSorted((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const columns: DataTableColumn<DepartmentRow>[] = [
    { key: 'name', header: 'Setor', width: 320, render: (row) => <strong>{row.name}</strong> },
    { key: 'categories', header: 'Categorias', width: 140, render: (r) => r.categoryCount },
    { key: 'teams', header: 'Equipes', width: 140, render: (r) => r.teamCount },
    { key: 'managers', header: 'Gestores', width: 140, render: (r) => r.managerCount },
    {
      key: 'actions',
      header: '⋯',
      width: 60,
      render: (row) => (
        <RowMenu
          label={row.name}
          items={[
            { label: 'Renomear', onSelect: () => setDialog({ kind: 'rename', department: row }) },
          ]}
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
            variant="secondary"
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setDialog({ kind: 'create' })}
          >
            Novo setor
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
          ) : query.data ? (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              rowLabel={(row) => row.name}
            />
          ) : null}
        </div>
      </div>
      {dialog?.kind === 'create' ? <DepartmentDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'rename' ? (
        <DepartmentDialog department={dialog.department} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
