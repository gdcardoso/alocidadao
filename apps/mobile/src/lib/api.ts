import { createApiClient } from '@alocidadao/api-client';

/**
 * Endereço da API, fixado no bundle pelo Metro. Sem padrão: um build sem a variável falharia
 * em silêncio tentando o emulador; melhor parar já na abertura com a instrução.
 */
function readApiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      'EXPO_PUBLIC_API_URL não definida. Copie apps/mobile/.env.example para .env e reinicie o Metro.',
    );
  }
  return url.replace(/\/+$/, '');
}

export const API_URL = readApiUrl();

export const api = createApiClient({ baseUrl: API_URL });
