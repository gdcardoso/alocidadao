import { createDatabase } from '@alocidadao/db';
import { buildApp } from './app.js';
import { createStorage } from './storage/s3.js';

const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? '0.0.0.0';

const env = process.env;
const storage = env.S3_ENDPOINT
  ? createStorage({
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? 'alocidadao-dev',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    })
  : undefined;

const database = env.DATABASE_URL ? createDatabase(env.DATABASE_URL).db : undefined;

const app = await buildApp({
  logger: true,
  corsOrigin: env.CORS_ORIGIN,
  storage,
  database,
  devRoutes: env.NODE_ENV !== 'production',
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
