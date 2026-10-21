import { createApiClient } from '@alocidadao/api-client';

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3333',
});
