import type { PanelContext, PanelCounts } from '@alocidadao/shared';
import { createContext, useContext } from 'react';

export interface PanelValue {
  /** Prefeitura do painel: a primeira de `me.panelTenants`. */
  tenantId: string;
  context: PanelContext;
  /** `undefined` até a primeira resposta dos contadores. */
  counts: PanelCounts | undefined;
}

/** Chave dos contadores; as ações do painel a invalidam para atualizar o menu. */
export const panelCountsKey = (tenantId: string) => ['panel', 'counts', tenantId] as const;

export const PanelValueContext = createContext<PanelValue | null>(null);

export function usePanel(): PanelValue {
  const value = useContext(PanelValueContext);
  if (!value) throw new Error('usePanel precisa do PanelLayout');
  return value;
}
