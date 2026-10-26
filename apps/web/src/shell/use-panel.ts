import type { PanelContext, PanelCounts } from '@alocidadao/shared';
import { createContext, useContext } from 'react';

export interface PanelValue {
  /** Prefeitura do painel: a do modo suporte ou a primeira de `me.panelTenants`. */
  tenantId: string;
  context: PanelContext;
  /** `undefined` até a primeira resposta dos contadores. */
  counts: PanelCounts | undefined;
  /** Prefeitura do modo suporte (equipe interna); `null` para quem tem vínculo. */
  support: { tenantId: string; displayName: string } | null;
}

/** Chave dos contadores; as ações do painel a invalidam para atualizar o menu. */
export const panelCountsKey = (tenantId: string) => ['panel', 'counts', tenantId] as const;

export const PanelValueContext = createContext<PanelValue | null>(null);

export function usePanel(): PanelValue {
  const value = useContext(PanelValueContext);
  if (!value) throw new Error('usePanel precisa do PanelLayout');
  return value;
}
