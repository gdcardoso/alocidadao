import { createApiClient } from '@alocidadao/api-client';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3333';

export const api = createApiClient({ baseUrl: API_URL });
