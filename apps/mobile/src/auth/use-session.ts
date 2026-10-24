import type { MeResponse, SessionTokens } from '@alocidadao/shared';
import { createContext, useContext } from 'react';
import type { AppMode } from './app-mode';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SignOutOptions {
  /** Padrão `true`: apaga fila, cache e fotos do aparelho junto com a sessão. */
  clearOfflineData?: boolean;
}

export interface SessionContextValue {
  status: SessionStatus;
  /** Dados da conta; `null` enquanto carrega ou quando o app abriu sem rede. */
  me: MeResponse | null;
  /** Busca `me` de novo. Sessão recusada (401) leva a `signedOut`. */
  refreshMe(): Promise<void>;
  /** Grava a sessão nova, confere o dono da fila e passa a `signedIn`. */
  signIn(tokens: SessionTokens): Promise<void>;
  signOut(opts?: SignOutOptions): Promise<void>;
  /** Modo do app (agente ou cidadão); ver app-mode.ts. */
  mode: AppMode;
  /** Grava o modo (lembrado na próxima abertura) e leva à tela inicial dele. */
  setMode(mode: AppMode): Promise<void>;
  /** Tem vínculo de agente (vê a pílula e a troca no Perfil). Sem `me`, vale o modo atual. */
  isAgent: boolean;
  /** O vínculo de agente acabou e o app voltou ao modo cidadão: aviso a mostrar uma vez. */
  agentAccessEnded: boolean;
  /** A lista do cidadão já mostrou o aviso de vínculo encerrado. */
  dismissAgentAccessEnded(): void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

/** Sessão do app (ver `SessionProvider` em session-context.tsx). */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession precisa estar dentro de <SessionProvider>');
  return value;
}
