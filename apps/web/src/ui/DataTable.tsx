import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Largura fixa da coluna, em px. */
  width: number;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Nome acessível da linha clicável. */
  rowLabel: (row: T) => string;
  /** Linha destacada (a da gaveta aberta). */
  isSelected?: (row: T) => boolean;
}

/**
 * Tabela do Pencil (W5): superfície com borda e raio 12, cabeçalho de 44, linhas de 64.
 * A linha clicável também é acessível pelo teclado (Enter e espaço).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  isSelected,
}: DataTableProps<T>) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? styles.clickable : undefined}
              data-selected={isSelected?.(row) ?? false}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? rowLabel(row) : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
