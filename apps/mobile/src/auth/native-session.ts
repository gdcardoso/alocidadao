import { createApiClient } from '@alocidadao/api-client';
import { api, API_URL } from '../lib/api';
import { secureStore } from '../lib/secure-store';
import { HttpTransport } from '../offline/http-transport';
import { clearOfflineData } from '../offline/sqlite-outbox-store';
import { createSessionManager } from './session';

// Renovação e saída usam o cliente sem sessão: o token vai explícito ou nem vai.
export const session = createSessionManager({ store: secureStore, api });

/** Cliente da API com o token da sessão (ex.: `me`). */
export const sessionApi = createApiClient({
  baseUrl: API_URL,
  getToken: () => session.getAccessToken(),
});

/** Sai da conta e apaga o que ficou no aparelho (fila, cache e fotos). */
export async function signOutAndClear(): Promise<void> {
  await session.signOut();
  await clearOfflineData();
}

/** Envio da fila com a sessão; a prefeitura das ações do agente vem de cada item. */
export async function createSessionTransport(): Promise<HttpTransport> {
  return new HttpTransport({
    baseUrl: API_URL,
    getAccessToken: () => session.getAccessToken(),
  });
}
