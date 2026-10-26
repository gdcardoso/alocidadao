import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { PanelSession, SessionStatus } from './panel-session';

export interface SessionContextValue {
  status: SessionStatus;
  expiredNotice: boolean;
  session: PanelSession;
}

const SessionContext = createContext<PanelSession | null>(null);

/** Publica a sessão do painel e faz a renovação inicial ao abrir. */
export function SessionProvider({
  session,
  children,
}: {
  session: PanelSession;
  children: ReactNode;
}) {
  useEffect(() => {
    if (session.getState().status === 'loading') void session.restore();
  }, [session]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

// O hook mora junto do provedor, que é o único a publicar o contexto.
// oxlint-disable-next-line react/only-export-components
export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession precisa de um SessionProvider');
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return { status: state.status, expiredNotice: state.expiredNotice, session };
}
