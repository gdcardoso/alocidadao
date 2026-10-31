import type { TenantDetail } from '@alocidadao/shared';

export type TenantTab =
  'overview' | 'contract' | 'teams' | 'managers' | 'categories' | 'citizens' | 'audit';

export interface TenantTabDef {
  key: TenantTab;
  /** Valor de `?aba=`; `null` na Visão geral, que não leva parâmetro. */
  param: string | null;
  label: string;
  /** Só o admin da equipe interna vê a aba. */
  adminOnly: boolean;
}

export const TENANT_TABS: readonly TenantTabDef[] = [
  { key: 'overview', param: null, label: 'Visão geral', adminOnly: false },
  { key: 'contract', param: 'contrato', label: 'Contrato', adminOnly: false },
  { key: 'teams', param: 'equipes', label: 'Equipes e agentes', adminOnly: false },
  { key: 'managers', param: 'gestores', label: 'Gestores', adminOnly: false },
  { key: 'categories', param: 'categorias', label: 'Categorias', adminOnly: false },
  { key: 'citizens', param: 'cidadaos', label: 'Cidadãos', adminOnly: false },
  { key: 'audit', param: 'auditoria', label: 'Auditoria', adminOnly: true },
];

/** Aba escolhida por `?aba=`; sem parâmetro (ou com valor desconhecido) é a Visão geral. */
export function tabFromSearch(params: URLSearchParams): TenantTab {
  const param = params.get('aba');
  return TENANT_TABS.find((tab) => tab.param !== null && tab.param === param)?.key ?? 'overview';
}

/** Link da aba dentro da P3 (a Visão geral fica sem parâmetro). */
export function tabSearch(tab: TenantTab): string {
  const param = TENANT_TABS.find((def) => def.key === tab)?.param;
  return param ? `?aba=${param}` : '';
}

/** Propriedades de toda aba da P3 além da Visão geral. */
export interface TenantTabProps {
  tenant: TenantDetail;
  /** Admin da equipe interna: edita; o suporte só consulta. */
  isAdmin: boolean;
}
