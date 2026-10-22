export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY = 'installation-id';

/**
 * Devolve o id desta instalação do app, criando-o na primeira chamada.
 * Este módulo não importa nada nativo (testável em Node): no app, o gerador
 * (expo-crypto) e o armazenamento vêm de `device-installation-id.ts`. Sem `newId`,
 * usa o `crypto.randomUUID()` global.
 */
export async function getInstallationId(
  store: KeyValueStore,
  newId?: () => string,
): Promise<string> {
  const existing = await store.getItem(KEY);
  if (existing) return existing;
  const id = (newId ?? (() => globalThis.crypto.randomUUID()))();
  await store.setItem(KEY, id);
  return id;
}
