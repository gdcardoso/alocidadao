import { ApiError } from '@alocidadao/api-client';
import type { MeResponse, SessionTokens } from '@alocidadao/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { registerDevice } from '../lib/register-device';
import { secureStore } from '../lib/secure-store';
import { removeOutboxItemsWhere } from '../offline/outbox-service';
import { clearOfflineData } from '../offline/sqlite-outbox-store';
import {
  APP_MODE_KEY,
  CITIZEN_HOME_ROUTE,
  endedAgentItemIds,
  hasAgentRole,
  homeFor,
  modeAfterMeUpdate,
  startMode,
  storedModeValue,
  type AppMode,
} from './app-mode';
import { OUTBOX_OWNER_KEY } from './login-flow';
import { session, sessionApi, setTermsRequiredHandler } from './native-session';
import { restoreSession, signInWithOwnerCheck, signOutSafely } from './session-flow';
import { SessionContext, type SessionStatus, type SignOutOptions } from './use-session';

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/** Grava o modo com o dono (sem `me`, o dono da fila, que é a pessoa logada). */
async function saveMode(mode: AppMode, userId: string | null): Promise<void> {
  try {
    const owner = userId ?? (await secureStore.getItem(OUTBOX_OWNER_KEY));
    if (owner) await secureStore.setItem(APP_MODE_KEY, storedModeValue(mode, owner));
  } catch (error) {
    // Sem gravar, a próxima abertura volta ao modo padrão; nada a mostrar.
    console.warn('Falha ao gravar o modo do app', error);
  }
}

/** Modo ao abrir ou entrar (ver `startMode`); grava o resultado para a próxima abertura. */
async function initialMode(me: MeResponse | null) {
  const [raw, outboxOwner] = await Promise.all([
    secureStore.getItem(APP_MODE_KEY).catch(() => null),
    secureStore.getItem(OUTBOX_OWNER_KEY).catch(() => null),
  ]);
  const start = startMode({ raw, me, outboxOwner });
  // Com `me`, o modo resolvido passa a ser desta pessoa (um modo de outra pessoa não fica).
  if (me) void saveMode(start.mode, me.id);
  return start;
}

/** Sessão do app para as telas: lê o token guardado na abertura e acompanha login e saída. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mode, setModeState] = useState<AppMode>('citizen');
  const [agentAccessEnded, setAgentAccessEnded] = useState(false);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
      // O modo vem antes de `signedIn`: o `index` redireciona para a tela inicial dele.
      const start = await initialMode(restored.me);
      if (!active) return;
      setModeState(start.mode);
      setAgentAccessEnded(start.agentAccessEnded);
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

  // 403 `terms_required` em qualquer chamada: `me` volta com `termsAccepted: false` e o
  // layout leva à tela de aceite.
  useEffect(() => {
    setTermsRequiredHandler(() => void refreshMe().catch(() => undefined));
    return () => setTermsRequiredHandler(null);
  }, [refreshMe]);

  const signIn = useCallback(async (tokens: SessionTokens) => {
    const current = await signInWithOwnerCheck({
      store: secureStore,
      saveTokens: () => session.signIn(tokens),
      fetchMe: () => sessionApi.me(),
      clearOfflineData,
      undoTokens: () => session.signOut(),
    });
    const start = await initialMode(current);
    setModeState(start.mode);
    setAgentAccessEnded(start.agentAccessEnded);
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

  // `me` atualizado sem vínculo de agente, no modo agente: volta ao modo cidadão com o aviso.
  useEffect(() => {
    if (status !== 'signedIn') return;
    // Sem vínculo, as ações recusadas por isso não aparecem em lugar nenhum: saem da fila.
    if (me && !hasAgentRole(me)) {
      void removeOutboxItemsWhere((items) => endedAgentItemIds(me, items)).catch((error: unknown) =>
        console.warn('Falha ao tirar da fila as ações do agente encerrado', error),
      );
    }
    const after = modeAfterMeUpdate(modeRef.current, me);
    if (!after.agentAccessEnded) return;
    modeRef.current = after.mode;
    setModeState(after.mode);
    setAgentAccessEnded(true);
    void saveMode(after.mode, me?.id ?? null);
    router.replace(CITIZEN_HOME_ROUTE);
  }, [status, me]);

  const setMode = useCallback(
    async (next: AppMode) => {
      // Sem vínculo de agente não há modo agente.
      if (next === 'agent' && me && !hasAgentRole(me)) return;
      modeRef.current = next;
      setModeState(next);
      await saveMode(next, me?.id ?? null);
      router.replace(homeFor(next));
    },
    [me],
  );

  const dismissAgentAccessEnded = useCallback(() => setAgentAccessEnded(false), []);

  const isAgent = me ? hasAgentRole(me) : mode === 'agent';

  const value = useMemo(
    () => ({
      status,
      me,
      refreshMe,
      signIn,
      signOut,
      mode,
      setMode,
      isAgent,
      agentAccessEnded,
      dismissAgentAccessEnded,
    }),
    [
      status,
      me,
      refreshMe,
      signIn,
      signOut,
      mode,
      setMode,
      isAgent,
      agentAccessEnded,
      dismissAgentAccessEnded,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
