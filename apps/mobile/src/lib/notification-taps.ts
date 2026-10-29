import * as Notifications from 'expo-notifications';
import { routeForNotification, type NotificationRoute } from './notification-route';

/**
 * Toques já tratados (id da notificação), no processo inteiro: o toque que abriu o app chega
 * por `getLastNotificationResponseAsync` e, às vezes, também pelo ouvinte; e remontar o
 * layout (sair e entrar) não pode abrir de novo o mesmo aviso.
 */
const handled = new Set<string>();

/** Só para os testes. */
export function resetHandledNotifications(): void {
  handled.clear();
}

/** `loading`: espera; `ready`: logado e com o roteador montado; `signedOut`: descarta. */
export type TapSessionState = 'loading' | 'ready' | 'signedOut';

export interface NotificationTaps {
  setSession(state: TapSessionState): void;
  stop(): void;
}

/**
 * Acompanha os toques nos pushes (o de agora e o que abriu o app) e chama `open` com a rota
 * quando a sessão está pronta. Sem sessão (saiu), o toque pendente é descartado: o app fica
 * na tela inicial.
 */
export function createNotificationTaps(open: (route: NotificationRoute) => void): NotificationTaps {
  let state: TapSessionState = 'loading';
  let pending: NotificationRoute | null = null;
  let stopped = false;

  const flush = () => {
    if (state === 'signedOut') pending = null;
    if (state !== 'ready' || !pending) return;
    const route = pending;
    pending = null;
    open(route);
  };

  const receive = (response: Notifications.NotificationResponse | null) => {
    if (stopped || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { identifier, content } = response.notification.request;
    if (handled.has(identifier)) return;
    handled.add(identifier);
    const route = routeForNotification((content.data ?? {}) as Record<string, unknown>);
    if (!route) return;
    pending = route;
    flush();
  };

  const subscription = Notifications.addNotificationResponseReceivedListener(receive);
  // Abertura pelo toque (app fechado): a resposta fica guardada; limpa depois de ler.
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      receive(response);
      if (response) return Notifications.clearLastNotificationResponseAsync();
    })
    .catch((error: unknown) => console.warn('Falha ao ler o toque que abriu o app', error));

  return {
    setSession(next) {
      state = next;
      flush();
    },
    stop() {
      stopped = true;
      subscription.remove();
    },
  };
}
