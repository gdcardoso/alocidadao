import { isTriageLate, type OccurrenceDetail } from '@alocidadao/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Map as MapIcon, Merge, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatElapsedShort } from '../format/elapsed';
import { useNow } from '../format/use-now';
import { FilterSelect } from '../map/MapFilters';
import { AssignDialog } from '../occurrence/AssignDialog';
import { PointPanel } from '../occurrence/PointPanel';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { CategorySquare } from '../ui/CategorySquare';
import { TopBar } from '../ui/TopBar';
import { ApiError } from '@alocidadao/api-client';
import styles from './TriagePage.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL = 'todas';

function uuidOrNull(value: string | null): string | null {
  return value && UUID.test(value) ? value : null;
}

function subtitle(total: number): string {
  const text =
    total === 1
      ? '1 solicitação nova aguardando análise'
      : `${total} solicitações novas aguardando análise`;
  return `${text} · mais antigas primeiro`;
}

/** W5 · Triagem: fila de ocorrências abertas, com o painel do ponto como gaveta. */
export function TriagePage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const categoryId = uuidOrNull(params.get('categoria'));
  const onlySuggestions = params.get('sugestao') === '1';
  const occurrenceId = uuidOrNull(params.get('ocorrencia'));
  const now = useNow();
  // Ocorrência da W2 (Atribuir a uma equipe), aberta a partir do painel do ponto.
  const [assignTarget, setAssignTarget] = useState<OccurrenceDetail | null>(null);

  function update(next: {
    categoryId?: string | null;
    onlySuggestions?: boolean;
    occurrenceId?: string | null;
  }) {
    const state = {
      categoryId: 'categoryId' in next ? next.categoryId : categoryId,
      onlySuggestions: next.onlySuggestions ?? onlySuggestions,
      occurrenceId: 'occurrenceId' in next ? next.occurrenceId : occurrenceId,
    };
    const search = new URLSearchParams();
    if (state.categoryId) search.set('categoria', state.categoryId);
    if (state.onlySuggestions) search.set('sugestao', '1');
    if (state.occurrenceId) search.set('ocorrencia', state.occurrenceId);
    setParams(search, { replace: true });
  }

  // A chave começa com 'triage': as ações do painel invalidam esse prefixo.
  const queue = useQuery({
    queryKey: ['triage', tenantId, categoryId, onlySuggestions],
    queryFn: () =>
      session.withAuth(() =>
        api.panelTriage(tenantId, { ...(categoryId ? { categoryId } : {}), onlySuggestions }),
      ),
    placeholderData: keepPreviousData,
  });
  // Opções de categoria: a fila sem os filtros (sem filtro, é a mesma consulta).
  const optionsQuery = useQuery({
    queryKey: ['triage', tenantId, null, false],
    queryFn: () => session.withAuth(() => api.panelTriage(tenantId, { onlySuggestions: false })),
    placeholderData: keepPreviousData,
  });
  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of optionsQuery.data?.items ?? []) byId.set(row.categoryId, row.categoryName);
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .toSorted((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [optionsQuery.data]);
  const categoryName = categories.find((item) => item.id === categoryId)?.name;

  // Esc fecha a gaveta, a menos que haja um diálogo aberto (ele fecha primeiro).
  useEffect(() => {
    if (!occurrenceId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      update({ occurrenceId: null });
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const data = queue.data;
  const rows = data?.items ?? [];
  const error = queue.error
    ? queue.error instanceof ApiError
      ? UNEXPECTED_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE
    : null;

  return (
    <div className={styles.page}>
      <TopBar
        title="Triagem"
        subtitle={data ? subtitle(data.total) : undefined}
        actions={
          <Link to="/mapa" className={styles.mapLink}>
            <MapIcon size={16} aria-hidden="true" />
            Ver no mapa
          </Link>
        }
        filters={
          <>
            <FilterSelect
              name="Categoria"
              valueLabel={categoryId ? (categoryName ?? '…') : ALL}
              value={categoryId ?? ALL}
              options={[
                { value: ALL, label: ALL },
                ...categories.map((item) => ({ value: item.id, label: item.name })),
                ...(categoryId && !categoryName ? [{ value: categoryId, label: '…' }] : []),
              ]}
              onChange={(value) => update({ categoryId: value === ALL ? null : value })}
            />
            <button
              type="button"
              className={styles.toggle}
              aria-pressed={onlySuggestions}
              onClick={() => update({ onlySuggestions: !onlySuggestions })}
            >
              Só com sugestão de agrupamento
            </button>
          </>
        }
      />
      <div className={styles.area}>
        <div className={styles.content}>
          {error ? <p className={styles.state}>{error}</p> : null}
          {data && rows.length === 0 ? (
            <p className={styles.state}>Nenhuma solicitação nova. Tudo em dia.</p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <colgroup>
                    <col style={{ width: 300 }} />
                    <col style={{ width: 230 }} />
                    <col style={{ width: 190 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Solicitação</th>
                      <th scope="col">Local</th>
                      <th scope="col">Relatos</th>
                      <th scope="col">Aberta há</th>
                      <th scope="col">Setor</th>
                      <th scope="col">
                        <span className={styles.srOnly}>Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const since = new Date(row.statusSince);
                      return (
                        <tr
                          key={row.occurrenceId}
                          className={styles.row}
                          data-selected={row.occurrenceId === occurrenceId}
                          onClick={() => update({ occurrenceId: row.occurrenceId })}
                        >
                          <td>
                            <div className={styles.request}>
                              <CategorySquare
                                icon={row.icon ?? 'circle-ellipsis'}
                                iconGroup={row.iconGroup}
                                size={36}
                              />
                              <div className={styles.requestText}>
                                <strong>{row.categoryName}</strong>
                                <span className={styles.protocol}>{row.protocol}</span>
                              </div>
                            </div>
                          </td>
                          <td>{row.address}</td>
                          <td>
                            <div className={styles.reports}>
                              <Users size={14} aria-hidden="true" className={styles.muted} />
                              <strong>{row.requestCount}</strong>
                              {row.suggestionCount > 0 ? (
                                <span className={styles.suggestion}>
                                  <Merge size={12} aria-hidden="true" />
                                  {row.suggestionCount === 1
                                    ? '+1 parecida'
                                    : `+${row.suggestionCount} parecidas`}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <span className={styles.elapsed} data-late={isTriageLate(since, now)}>
                              {formatElapsedShort(since, now)}
                            </span>
                          </td>
                          <td className={styles.department}>{row.departmentName}</td>
                          <td className={styles.actions}>
                            <button
                              type="button"
                              className={styles.analyze}
                              onClick={(event) => {
                                event.stopPropagation();
                                update({ occurrenceId: row.occurrenceId });
                              }}
                            >
                              Analisar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className={styles.footer}>
                Mostrando {rows.length} de {data?.total ?? rows.length}
                {' · '}Ao analisar, abre o mesmo painel do mapa (agrupar, atribuir ou recusar).
              </p>
            </>
          ) : null}
        </div>
        {occurrenceId ? (
          <div className={styles.drawer}>
            <PointPanel
              key={occurrenceId}
              occurrenceId={occurrenceId}
              onClose={() => update({ occurrenceId: null })}
              onAssign={setAssignTarget}
            />
          </div>
        ) : null}
      </div>
      {assignTarget ? (
        <AssignDialog
          occurrence={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => setAssignTarget(null)}
        />
      ) : null}
    </div>
  );
}
