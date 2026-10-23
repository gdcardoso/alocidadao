import { createApiClient } from '@alocidadao/api-client';
import { api, API_URL } from '../lib/api';
import { secureStore } from '../lib/secure-store';
import { HttpTransport } from '../offline/http-transport';
import { clearOfflineData } from '../offline/sqlite-outbox-store';
import { createSessionManager } from './session';

/** Prefeitura escolhida no login do Laboratório (`x-tenant-id` das rotas /dev). */
export const LAB_TENANT_KEY = 'lab-tenant-id';

// Renovação e saída usam o cliente sem sessão: o token vai explícito ou nem vai.
export const session = createSessionManager({ store: secureStore, api });

/** Cliente da API com o token da sessão (ex.: `me`). */
export const sessionApi = createApiClient({
  baseUrl: API_URL,
  getToken: () => session.getAccessToken(),
});

/** Sai da conta e apaga o que ficou no aparelho (fila, cache, fotos e a prefeitura do Lab). */
export async function signOutAndClear(): Promise<void> {
  await session.signOut();
  await secureStore.deleteItem(LAB_TENANT_KEY);
  await clearOfflineData();
}

/** Envio da fila e lista de atividades com a sessão e a prefeitura guardada no login. */
export async function createSessionTransport(): Promise<HttpTransport> {
  return new HttpTransport({
    baseUrl: API_URL,
    getAccessToken: () => session.getAccessToken(),
    tenantId: await secureStore.getItem(LAB_TENANT_KEY),
  });
}
