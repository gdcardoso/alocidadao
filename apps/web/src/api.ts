import { createApiClient } from '@alocidadao/api-client';
import { createPanelSession } from './session/panel-session';

/** Sessão do painel do navegador. A renovação chama o `api` abaixo só quando roda. */
export const panelSession = createPanelSession({
  client: {
    panelRefresh: () => api.panelRefresh(),
    panelLogout: () => api.panelLogout(),
  },
});

/**
 * Cliente da API do painel. Em desenvolvimento, `/api` passa pelo proxy do Vite, para o
 * cookie de renovação valer na mesma origem.
 */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '/api',
  getToken: () => panelSession.getAccessToken(),
  credentials: 'same-origin',
});
