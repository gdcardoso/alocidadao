import { router, usePathname, useRootNavigationState, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useSession, type SessionContextValue } from '../auth/use-session';
import { planNotificationTap, type NotificationRoute } from './notification-route';
import { createNotificationTaps, type NotificationTaps } from './notification-taps';

type TapSession = Pick<SessionContextValue, 'me' | 'mode' | 'setMode'>;

/** Abre a tela do aviso, trocando de modo antes se precisar. */
async function openNotificationRoute(route: NotificationRoute, session: TapSession) {
  const plan = planNotificationTap(route, session);
  if (plan.step === 'drop') return;
  // Mesmo `setMode` do Perfil: grava o modo e termina levando à tela inicial dele; a tela do
  // aviso abre por cima (o Voltar leva à lista).
  if (plan.step === 'switch') await session.setMode(plan.mode);
  router.push(route.href as Href);
}

/**
 * Toque no push: abre a solicitação (cidadão) ou a atividade (agente) depois que a sessão está
 * pronta e o roteador montado (ver `createNotificationTaps`).
 */
export function useNotificationTaps(): void {
  const { status, me, mode, setMode } = useSession();
  const pathname = usePathname();
  // Pronto: roteador montado e já fora da porta de entrada (o `index` e a abertura redirecionam
  // para a tela inicial e trocariam a tela do aviso).
  const navReady =
    Boolean(useRootNavigationState()?.key) && pathname !== '/' && pathname !== '/abertura';
  const sessionRef = useRef<TapSession>({ me, mode, setMode });
  const tapsRef = useRef<NotificationTaps | null>(null);

  useEffect(() => {
    sessionRef.current = { me, mode, setMode };
  }, [me, mode, setMode]);

  useEffect(() => {
    const taps = createNotificationTaps((route) => {
      openNotificationRoute(route, sessionRef.current).catch((error: unknown) =>
        console.warn('Falha ao abrir a tela do aviso', error),
      );
    });
    tapsRef.current = taps;
    return () => {
      taps.stop();
      tapsRef.current = null;
    };
  }, []);

  useEffect(() => {
    tapsRef.current?.setSession(
      status === 'signedOut'
        ? 'signedOut'
        : status === 'signedIn' && navReady
          ? 'ready'
          : 'loading',
    );
  }, [status, navReady]);
}
