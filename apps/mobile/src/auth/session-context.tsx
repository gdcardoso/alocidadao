import { ApiError } from '@alocidadao/api-client';
import type { MeResponse, SessionTokens } from '@alocidadao/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { registerDevice } from '../lib/register-device';
import { secureStore } from '../lib/secure-store';
import { clearOfflineData } from '../offline/sqlite-outbox-store';
import { session, sessionApi } from './native-session';
import { restoreSession, signInWithOwnerCheck, signOutSafely } from './session-flow';
import { SessionContext, type SessionStatus, type SignOutOptions } from './use-session';

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/** Sessão do app para as telas: lê o token guardado na abertura e acompanha login e saída. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const dropSession = useCallback(async () => {
    // A API recusou a sessão: limpa só o token (a fila fica para o mesmo dono, se voltar).
    await session.signOut().catch(() => undefined);
    setMe(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const restored = await restoreSession({
        store: secureStore,
        hasTokens: () => session.isSignedIn(),
        fetchMe: () => sessionApi.me(),
        clearOfflineData,
        dropTokens: () => session.signOut(),
        isUnauthorized,
      });
      if (!active) return;
      if (restored.status === 'signedOut') {
        setStatus('signedOut');
        return;
      }
      setMe(restored.me);
      setStatus('signedIn');
      if (restored.me) void registerDevice();
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await sessionApi.me());
    } catch (error) {
      if (isUnauthorized(error)) await dropSession();
      else throw error;
    }
  }, [dropSession]);

  const signIn = useCallback(async (tokens: SessionTokens) => {
    const current = await signInWithOwnerCheck({
      store: secureStore,
      saveTokens: () => session.signIn(tokens),
      fetchMe: () => sessionApi.me(),
      clearOfflineData,
      undoTokens: () => session.signOut(),
    });
    setMe(current);
    setStatus('signedIn');
    void registerDevice({ askPermission: true });
  }, []);

  const signOut = useCallback(async (opts: SignOutOptions = {}) => {
    try {
      await signOutSafely({
        store: secureStore,
        dropTokens: () => session.signOut(),
        clearOfflineData: (opts.clearOfflineData ?? true) ? clearOfflineData : null,
        // Sem tela para mostrar: fica no log; o próximo login apaga o que sobrou.
        onError: (error) => console.warn('Falha ao limpar os dados do aparelho na saída', error),
      });
    } finally {
      setMe(null);
      setStatus('signedOut');
    }
  }, []);

  const value = useMemo(
    () => ({ status, me, refreshMe, signIn, signOut }),
    [status, me, refreshMe, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
