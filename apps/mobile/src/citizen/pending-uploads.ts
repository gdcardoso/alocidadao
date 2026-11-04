import { openOutboxStore } from '../offline/sqlite-outbox-store';
import { pendingCount } from './profile-view';

/** Envios na fila (de qualquer tipo) que a saída apagaria. Sem conseguir ler, conta zero. */
export async function countPendingUploads(): Promise<number> {
  try {
    const store = await openOutboxStore();
    return pendingCount(await store.list());
  } catch {
    return 0;
  }
}
