import type { TeamOption } from '@alocidadao/shared';
import { formatDistance } from '../format/distance';

/** `3 agentes · 4 atividades abertas · base a 1,1 km` (sem base, sem o último trecho). */
export function teamMeta(team: TeamOption): string {
  const agents = team.activeAgentCount === 1 ? '1 agente' : `${team.activeAgentCount} agentes`;
  const open =
    team.openWorkOrderCount === 1
      ? '1 atividade aberta'
      : `${team.openWorkOrderCount} atividades abertas`;
  const parts = [agents, open];
  if (team.baseDistanceM !== null) parts.push(`base a ${formatDistance(team.baseDistanceM)}`);
  return parts.join(' · ');
}
