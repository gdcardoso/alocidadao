export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const KEY = 'installation-id';

// Uma leitura/criação por `store`: chamadas simultâneas na primeira abertura recebem o mesmo id.
const pending = new WeakMap<KeyValueStore, Promise<string>>();

async function readOrCreate(store: KeyValueStore, newId?: () => string): Promise<string> {
  const existing = await store.getItem(KEY);
  if (existing) return existing;
  const id = (newId ?? (() => globalThis.crypto.randomUUID()))();
  await store.setItem(KEY, id);
  return id;
}

/**
 * Devolve o id desta instalação do app, criando-o na primeira chamada.
 * Este módulo não importa nada nativo (testável em Node): no app, o gerador
 * (expo-crypto) e o armazenamento vêm de `device-installation-id.ts`. Sem `newId`,
 * usa o `crypto.randomUUID()` global.
 */
export function getInstallationId(store: KeyValueStore, newId?: () => string): Promise<string> {
  let promise = pending.get(store);
  if (!promise) {
    promise = readOrCreate(store, newId);
    pending.set(store, promise);
    // Falhou (ex.: armazenamento indisponível): a próxima chamada tenta de novo.
    promise.catch(() => pending.delete(store));
  }
  return promise;
}
