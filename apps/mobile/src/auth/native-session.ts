import { createApiClient } from '@alocidadao/api-client';
import { api, API_URL } from '../lib/api';
import { secureStore } from '../lib/secure-store';
import { isTermsRequiredBody } from '../legal/terms-route';
import { HttpTransport } from '../offline/http-transport';
import { clearOfflineData } from '../offline/sqlite-outbox-store';
import { createSessionManager } from './session';

// Renovação e saída usam o cliente sem sessão: o token vai explícito ou nem vai.
export const session = createSessionManager({ store: secureStore, api });

let termsRequiredHandler: (() => void) | null = null;

/** O SessionProvider registra aqui o que fazer quando a API pede o aceite dos Termos. */
export function setTermsRequiredHandler(handler: (() => void) | null): void {
  termsRequiredHandler = handler;
}

/** `fetch` que avisa o app quando uma chamada volta 403 `terms_required`. */
const fetchWatchingTerms: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 403) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (isTermsRequiredBody(body)) termsRequiredHandler?.();
  }
  return response;
};

/** Cliente da API com o token da sessão (ex.: `me`). */
export const sessionApi = createApiClient({
  baseUrl: API_URL,
  fetch: fetchWatchingTerms,
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
