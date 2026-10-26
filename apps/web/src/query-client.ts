import { ApiError } from '@alocidadao/api-client';
import { QueryClient } from '@tanstack/react-query';

/** Tenta de novo uma vez, salvo erro 4xx (o pedido está errado, repetir não muda nada). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
