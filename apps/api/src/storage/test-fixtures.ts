import type { StorageConfig } from './s3.js';

export const TENANT_ID = '11111111-1111-4111-8111-111111111111';

// Exige o MinIO local (`pnpm infra:up`).
export const testStorageConfig: StorageConfig = {
  endpoint: 'http://localhost:9000',
  publicEndpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'alocidadao-dev',
  accessKeyId: 'alocidadao',
  secretAccessKey: 'alocidadao-dev',
};
