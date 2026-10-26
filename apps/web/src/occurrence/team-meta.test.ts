import { describe, expect, it } from 'vitest';
import { teamMeta } from './team-meta';

const base = { id: '1', name: 'Obras', activeAgentCount: 3, openWorkOrderCount: 4 };

describe('team meta', () => {
  it('team meta pluralizes and omits the base when missing', () => {
    expect(teamMeta({ ...base, baseDistanceM: 1100 })).toBe(
      '3 agentes · 4 atividades abertas · base a 1,1 km',
    );
    expect(
      teamMeta({ ...base, activeAgentCount: 1, openWorkOrderCount: 1, baseDistanceM: 350 }),
    ).toBe('1 agente · 1 atividade aberta · base a 350 m');
    expect(teamMeta({ ...base, baseDistanceM: null })).toBe('3 agentes · 4 atividades abertas');
  });
});
