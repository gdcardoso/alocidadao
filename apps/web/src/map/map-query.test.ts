import { NO_NEIGHBORHOOD } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import {
  categoriesOf,
  DEFAULT_MAP_QUERY,
  activeSummaryKey,
  applySummaryClick,
  isSearchable,
  mergeMapPatch,
  mapOccurrencesKey,
  mapSubtitle,
  parseMapQuery,
  toSearchParams,
} from './map-query';

const categoryId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const occurrenceId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';

describe('map query', () => {
  it('map query round-trips through the url with defaults', () => {
    expect(parseMapQuery(new URLSearchParams())).toEqual(DEFAULT_MAP_QUERY);
    expect(DEFAULT_MAP_QUERY).toEqual({
      status: 'open_and_in_progress',
      categoryId: null,
      neighborhood: null,
      days: 30,
      deadline: null,
      occurrenceId: null,
    });
    // Os valores padrão não aparecem na URL.
    expect(toSearchParams(DEFAULT_MAP_QUERY).toString()).toBe('');

    const state = {
      status: 'open',
      categoryId,
      neighborhood: null,
      days: null,
      deadline: null,
      occurrenceId,
    } as const;
    const params = toSearchParams(state);
    expect(params.get('status')).toBe('abertas');
    expect(params.get('categoria')).toBe(categoryId);
    expect(params.get('periodo')).toBe('todo');
    expect(params.get('ocorrencia')).toBe(occurrenceId);
    expect(parseMapQuery(params)).toEqual(state);

    const inProgress = { ...DEFAULT_MAP_QUERY, status: 'in_progress', days: 7 } as const;
    expect(parseMapQuery(toSearchParams(inProgress))).toEqual(inProgress);
    expect(toSearchParams({ ...DEFAULT_MAP_QUERY, days: 90 }).toString()).toBe('periodo=90');
  });

  it('parses and writes ?bairro', () => {
    const state = { ...DEFAULT_MAP_QUERY, neighborhood: 'Vila Nova' };
    expect(toSearchParams(state).get('bairro')).toBe('Vila Nova');
    expect(parseMapQuery(toSearchParams(state))).toEqual(state);
    const none = { ...DEFAULT_MAP_QUERY, neighborhood: NO_NEIGHBORHOOD };
    expect(toSearchParams(none).toString()).toBe('bairro=__none__');
    expect(parseMapQuery(new URLSearchParams('bairro=__none__'))).toEqual(none);
    expect(parseMapQuery(new URLSearchParams('bairro='))).toEqual(DEFAULT_MAP_QUERY);
    expect(parseMapQuery(new URLSearchParams(`bairro=${'a'.repeat(121)}`))).toEqual(
      DEFAULT_MAP_QUERY,
    );
  });

  it('map key includes the neighborhood', () => {
    expect(mapOccurrencesKey('t', DEFAULT_MAP_QUERY)).not.toEqual(
      mapOccurrencesKey('t', { ...DEFAULT_MAP_QUERY, neighborhood: 'Centro' }),
    );
  });

  it('ignores invalid values', () => {
    const params = new URLSearchParams('status=x&categoria=nope&periodo=15&ocorrencia=1');
    expect(parseMapQuery(params)).toEqual(DEFAULT_MAP_QUERY);
  });

  it('map subtitle pluralizes and handles all periods', () => {
    expect(mapSubtitle(148, DEFAULT_MAP_QUERY)).toBe(
      '148 ocorrências abertas e em atendimento · últimos 30 dias',
    );
    expect(mapSubtitle(1, { ...DEFAULT_MAP_QUERY, status: 'open', days: 7 })).toBe(
      '1 ocorrência aberta · últimos 7 dias',
    );
    expect(mapSubtitle(0, { ...DEFAULT_MAP_QUERY, status: 'in_progress', days: 90 })).toBe(
      '0 ocorrências em atendimento · últimos 90 dias',
    );
    expect(mapSubtitle(1, { ...DEFAULT_MAP_QUERY, days: null })).toBe(
      '1 ocorrência aberta e em atendimento · todo o período',
    );
    expect(mapSubtitle(1234, { ...DEFAULT_MAP_QUERY, days: null })).toBe(
      '1.234 ocorrências abertas e em atendimento · todo o período',
    );
  });
});

describe('map helpers', () => {
  it('search accepts protocols and addresses with 3 letters', () => {
    expect(isSearchable('2026-1')).toBe(true);
    expect(isSearchable(' 2026-000123 ')).toBe(true);
    expect(isSearchable('ru')).toBe(false);
    expect(isSearchable('rua')).toBe(true);
  });

  it('category options are unique and sorted by name', () => {
    expect(
      categoriesOf([
        { categoryId: 'b', categoryName: 'Iluminação' },
        { categoryId: 'a', categoryName: 'Buraco na via' },
        { categoryId: 'b', categoryName: 'Iluminação' },
      ]),
    ).toEqual([
      { id: 'a', name: 'Buraco na via' },
      { id: 'b', name: 'Iluminação' },
    ]);
  });

  it('parses and writes ?prazo', () => {
    for (const [param, deadline] of [
      ['no-prazo', 'on_time'],
      ['vencendo', 'due_soon'],
      ['atrasadas', 'overdue'],
    ] as const) {
      const state = { ...DEFAULT_MAP_QUERY, status: 'in_progress', deadline } as const;
      expect(toSearchParams(state).get('prazo')).toBe(param);
      expect(parseMapQuery(toSearchParams(state))).toEqual(state);
    }
    expect(parseMapQuery(new URLSearchParams('prazo=xyz')).deadline).toBeNull();
  });

  it('map key includes the deadline', () => {
    expect(mapOccurrencesKey('t', { ...DEFAULT_MAP_QUERY, deadline: 'overdue' })).not.toEqual(
      mapOccurrencesKey('t', DEFAULT_MAP_QUERY),
    );
  });

  it('choosing a deadline with status open switches to in_progress', () => {
    const open = { ...DEFAULT_MAP_QUERY, status: 'open' } as const;
    expect(mergeMapPatch(open, { deadline: 'due_soon' })).toMatchObject({
      status: 'in_progress',
      deadline: 'due_soon',
    });
    // Escolher "abertas" com prazo ativo tira o prazo.
    const late = { ...DEFAULT_MAP_QUERY, status: 'in_progress', deadline: 'overdue' } as const;
    expect(mergeMapPatch(late, { status: 'open' })).toMatchObject({
      status: 'open',
      deadline: null,
    });
  });

  it('applySummaryClick follows the click rules and the second click resets', () => {
    const base = { ...DEFAULT_MAP_QUERY, categoryId };
    const triage = applySummaryClick(base, 'triage');
    expect(triage).toMatchObject({ status: 'open', deadline: null, categoryId });
    expect(activeSummaryKey(triage)).toBe('triage');
    expect(applySummaryClick(triage, 'triage')).toEqual(base);

    const progress = applySummaryClick(triage, 'inProgress');
    expect(progress).toMatchObject({ status: 'in_progress', deadline: null });
    expect(applySummaryClick(progress, 'inProgress')).toEqual(base);

    const soon = applySummaryClick(progress, 'dueSoon');
    expect(soon).toMatchObject({ status: 'in_progress', deadline: 'due_soon' });
    expect(activeSummaryKey(soon)).toBe('dueSoon');
    expect(applySummaryClick(soon, 'dueSoon')).toEqual(base);

    const overdue = applySummaryClick(soon, 'overdue');
    expect(overdue).toMatchObject({ status: 'in_progress', deadline: 'overdue' });
    expect(applySummaryClick(overdue, 'overdue')).toEqual(base);
    expect(activeSummaryKey(base)).toBeNull();
  });
});
