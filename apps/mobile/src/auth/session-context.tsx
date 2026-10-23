import { ApiError } from '@alocidadao/api-client';
import type { MeResponse, SessionTokens } from '@alocidadao/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { registerDevice } from '../lib/register-device';
import { secureStore } from '../lib/secure-store';
import { clearOfflineData } from '../offline/sqlite-outbox-store';
import { syncOutboxOwner } from './login-flow';
import { session, sessionApi, signOutAndClear } from './native-session';
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
      if (!(await session.isSignedIn().catch(() => false))) {
        if (active) setStatus('signedOut');
        return;
      }
      try {
        const current = await sessionApi.me();
        if (!active) return;
        setMe(current);
        setStatus('signedIn');
        void registerDevice();
      } catch (error) {
        if (!active) return;
        if (isUnauthorized(error)) {
          await dropSession();
          return;
        }
        // Sem rede ou servidor fora: o app abre logado, com o que tiver guardado.
        setStatus('signedIn');
      }
    })();
    return () => {
      active = false;
    };
  }, [dropSession]);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await sessionApi.me());
    } catch (error) {
      if (isUnauthorized(error)) await dropSession();
      else throw error;
    }
  }, [dropSession]);

  const signIn = useCallback(async (tokens: SessionTokens) => {
    await session.signIn(tokens);
    let current: MeResponse;
    try {
      current = await sessionApi.me();
      await syncOutboxOwner({ store: secureStore, userId: current.id, clearOfflineData });
    } catch (error) {
      // Sem saber quem entrou, não dá para conferir a fila: desfaz o login e a tela mostra o erro.
      await session.signOut().catch(() => undefined);
      throw error;
    }
    setMe(current);
    setStatus('signedIn');
    void registerDevice({ askPermission: true });
  }, []);

  const signOut = useCallback(async (opts: SignOutOptions = {}) => {
    if (opts.clearOfflineData ?? true) await signOutAndClear();
    else await session.signOut();
    setMe(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(
    () => ({ status, me, refreshMe, signIn, signOut }),
    [status, me, refreshMe, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
