import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSession } from '../../../session/SessionProvider';
import { Button } from '../../../ui/Button';
import { DataTable, type DataTableColumn } from '../../../ui/DataTable';
import styles from './ReadOnlyTab.module.css';

export interface ReadOnlyTabProps<T> {
  /** Parte da chave da consulta (`['backoffice', 'tenant', id, name]`). */
  name: string;
  tenantId: string;
  load: () => Promise<{ items: T[] }>;
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  rowLabel: (row: T) => string;
  hint: string;
  emptyText: string;
  errorText: string;
  panelPath: string;
  onOpenPanel: (path: string) => void;
  /** Texto extra acima da tabela (contagem, por exemplo). */
  children?: ReactNode;
}

/** Lista só leitura de uma aba da P3: carrega, mostra a tabela e leva ao painel. */
export function ReadOnlyTab<T>({
  name,
  tenantId,
  load,
  columns,
  rowKey,
  rowLabel,
  hint,
  emptyText,
  errorText,
  panelPath,
  onOpenPanel,
  children,
}: ReadOnlyTabProps<T>) {
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['backoffice', 'tenant', tenantId, name],
    queryFn: () => session.withAuth(load),
  });
  const rows = query.data?.items ?? [];

  return (
    <div className={styles.column}>
      <div className={styles.header}>
        <p className={styles.hint}>{hint}</p>
        <Button variant="secondary" size="sm" onClick={() => onOpenPanel(panelPath)}>
          Abrir no painel
        </Button>
      </div>
      {query.isError ? (
        <div role="alert" className={styles.error}>
          <p>{errorText}</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
      {children}
      {query.isPending ? <p className={styles.state}>Carregando…</p> : null}
      {query.data && rows.length === 0 ? <p className={styles.state}>{emptyText}</p> : null}
      {rows.length > 0 ? (
        <DataTable columns={columns} rows={rows} rowKey={rowKey} rowLabel={rowLabel} />
      ) : null}
    </div>
  );
}
