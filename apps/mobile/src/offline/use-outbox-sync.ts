import NetInfo from '@react-native-community/netinfo';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  getOutboxSnapshot,
  refreshOutbox,
  removeOutboxItem,
  subscribeOutbox,
  syncOutbox,
} from './outbox-service';

/**
 * Dispara a fila ao abrir, ao ganhar rede e ao voltar ao primeiro plano. Montado uma vez, no
 * layout das telas de quem está logado.
 */
export function useOutboxSync(): void {
  useEffect(() => {
    void refreshOutbox().catch((error: unknown) => console.warn('Falha ao ler a fila', error));
    void syncOutbox();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      if (state.isConnected === true && state.isInternetReachable !== false) void syncOutbox();
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncOutbox();
    });
    return () => {
      unsubscribeNet();
      sub.remove();
    };
  }, []);
}

/** A fila para as telas: itens, estado da passada e as ações. */
export function useOutbox() {
  const snapshot = useSyncExternalStore(subscribeOutbox, getOutboxSnapshot);
  return {
    ...snapshot,
    syncNow: syncOutbox,
    refresh: refreshOutbox,
    remove: removeOutboxItem,
  };
}
