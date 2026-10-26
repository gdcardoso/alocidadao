import type { TenantSummary } from '@alocidadao/shared';

export interface TenantAlert {
  tone: 'warning' | 'info';
  text: string;
}

type AlertInput = Pick<
  TenantSummary,
  'lateReviewCount' | 'staleImpedimentCount' | 'activeCategoryCount'
>;

/** Primeiro alerta que valer: revisão parada, impedimento parado, sem categorias. */
export function tenantAlert(summary: AlertInput): TenantAlert | null {
  if (summary.lateReviewCount > 0) {
    return { tone: 'warning', text: `${summary.lateReviewCount} aguardando revisão há +1 dia` };
  }
  if (summary.staleImpedimentCount > 0) {
    const n = summary.staleImpedimentCount;
    return {
      tone: 'warning',
      text: `${n} ${n === 1 ? 'impedimento parado' : 'impedimentos parados'}`,
    };
  }
  if (summary.activeCategoryCount === 0) {
    return { tone: 'info', text: 'Sem categorias configuradas' };
  }
  return null;
}
