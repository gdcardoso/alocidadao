import type { OccurrenceDetail, PanelSearchResult } from '@alocidadao/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { AssignDialog } from '../occurrence/AssignDialog';
import { PointPanel } from '../occurrence/PointPanel';
import type { OccurrenceActionResult } from '../occurrence/use-occurrence-actions';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { TopBar } from '../ui/TopBar';
import { MapFilters } from './MapFilters';
import {
  activeSummaryKey,
  applySummaryClick,
  categoriesOf,
  DEFAULT_MAP_QUERY,
  mapOccurrencesKey,
  mapSubtitle,
  mapSummaryKey,
  mergeMapPatch,
  parseMapQuery,
  toSearchParams,
  type MapQueryState,
} from './map-query';
import type { MapFocus } from './OccurrenceMap';
import { useNeighborhoods } from './use-neighborhoods';
import styles from './MapPage.module.css';
import { SearchBox } from './SearchBox';
import { SummaryStrip } from './SummaryStrip';

// O MapLibre é grande: carrega à parte, só quando o mapa abre.
const OccurrenceMap = lazy(() =>
  import('./OccurrenceMap').then((module) => ({ default: module.OccurrenceMap })),
);

/** W1 · Mapa de ocorrências: filtros e ponto aberto na URL, mapa e painel do ponto. */
export function MapPage() {
  const { tenantId, context } = usePanel();
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const parsed = useMemo(() => parseMapQuery(params), [params]);
  const neighborhoods = useNeighborhoods();
  // Sem bairros na prefeitura, um `?bairro=` antigo na URL é ignorado.
  const state = useMemo(
    () => (neighborhoods.enabled ? parsed : { ...parsed, neighborhood: null }),
    [parsed, neighborhoods.enabled],
  );
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // Ocorrência da W2 (Atribuir a uma equipe), aberta a partir do painel do ponto.
  const [assignTarget, setAssignTarget] = useState<OccurrenceDetail | null>(null);

  function update(patch: Partial<MapQueryState>) {
    setParams(toSearchParams(mergeMapPatch(state, patch)), { replace: true });
  }

  function fetchMap(categoryId: string | null) {
    return session.withAuth(() =>
      api.panelOccurrences(tenantId, {
        status: state.status,
        days: state.days,
        ...(categoryId ? { categoryId } : {}),
        ...(state.neighborhood ? { neighborhood: state.neighborhood } : {}),
        ...(state.deadline ? { deadline: state.deadline } : {}),
      }),
    );
  }

  const mapQuery = useQuery({
    queryKey: mapOccurrencesKey(tenantId, state),
    queryFn: () => fetchMap(state.categoryId),
    enabled: !neighborhoods.isPending,
    placeholderData: keepPreviousData,
  });
  // Opções de categoria: o mesmo mapa sem o filtro de categoria (sem filtro, é a mesma consulta).
  const categoryQuery = useQuery({
    queryKey: mapOccurrencesKey(tenantId, { ...state, categoryId: null }),
    queryFn: () => fetchMap(null),
    enabled: !neighborhoods.isPending,
    placeholderData: keepPreviousData,
  });
  // Números da faixa: respeitam categoria, período e bairro; ignoram status e prazo.
  const summaryQuery = useQuery({
    queryKey: mapSummaryKey(tenantId, state),
    queryFn: () =>
      session.withAuth(() =>
        api.panelOccurrenceSummary(tenantId, {
          days: state.days,
          ...(state.categoryId ? { categoryId: state.categoryId } : {}),
          ...(state.neighborhood ? { neighborhood: state.neighborhood } : {}),
        }),
      ),
    enabled: !neighborhoods.isPending,
    placeholderData: keepPreviousData,
  });
  const categories = useMemo(
    () => categoriesOf(categoryQuery.data?.items ?? []),
    [categoryQuery.data],
  );

  const items = mapQuery.data?.items;
  const points = useMemo(() => items ?? [], [items]);
  const empty = mapQuery.isSuccess && !mapQuery.isPlaceholderData && points.length === 0;

  function onSearchSelect(item: PanelSearchResult) {
    update({ occurrenceId: item.occurrenceId });
    setFocus({ ...item.location, seq: Date.now() });
  }

  function onChanged(result: OccurrenceActionResult) {
    if (result.kind === 'merge' && result.survivorId !== state.occurrenceId) {
      update({ occurrenceId: result.survivorId });
    }
  }

  return (
    <div className={styles.page}>
      <TopBar
        title="Mapa de ocorrências"
        subtitle={mapQuery.data ? mapSubtitle(mapQuery.data.total, state) : undefined}
        actions={<SearchBox onSelect={onSearchSelect} />}
        filters={
          <MapFilters
            state={state}
            categories={categories}
            neighborhoods={neighborhoods.items}
            onChange={update}
            onClear={() => update({ ...DEFAULT_MAP_QUERY, occurrenceId: state.occurrenceId })}
          />
        }
      />
      <SummaryStrip
        summary={summaryQuery.data}
        active={activeSummaryKey(state)}
        onClick={(key) =>
          setParams(toSearchParams(applySummaryClick(state, key)), { replace: true })
        }
      />
      <div className={styles.area}>
        <div className={styles.mapWrap}>
          <Suspense fallback={null}>
            <OccurrenceMap
              items={points}
              bounds={context.tenant.bounds}
              selectedId={state.occurrenceId}
              focus={focus}
              onSelect={(occurrenceId) => update({ occurrenceId })}
            />
          </Suspense>
          {empty ? (
            <p className={styles.emptyCard} role="status">
              Nenhuma ocorrência com estes filtros.
            </p>
          ) : null}
        </div>
        {state.occurrenceId ? (
          <PointPanel
            key={state.occurrenceId}
            occurrenceId={state.occurrenceId}
            dueAt={points.find((point) => point.id === state.occurrenceId)?.dueAt ?? null}
            onClose={() => update({ occurrenceId: null })}
            onAssign={setAssignTarget}
            onChanged={onChanged}
          />
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
