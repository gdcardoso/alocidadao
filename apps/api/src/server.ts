import { createDatabase } from '@alocidadao/db';
import { buildApp } from './app.js';
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { createApnsSender } from './push/apns.js';
import { createFcmSender } from './push/fcm.js';
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

// Os caminhos dos arquivos são relativos a apps/api (o diretório de trabalho do servidor).
const fcm =
  env.FCM_PROJECT_ID && env.FCM_SERVICE_ACCOUNT_FILE
    ? (() => {
        const auth = new GoogleAuth({
          keyFile: env.FCM_SERVICE_ACCOUNT_FILE,
          scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });
        return createFcmSender({
          projectId: env.FCM_PROJECT_ID,
          getAccessToken: async () => {
            const token = await auth.getAccessToken();
            if (!token) throw new Error('FCM: sem token de acesso');
            return token;
          },
        });
      })()
    : undefined;

const apns =
  env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_KEY_FILE
    ? createApnsSender({
        teamId: env.APNS_TEAM_ID,
        keyId: env.APNS_KEY_ID,
        privateKeyPem: readFileSync(env.APNS_KEY_FILE, 'utf8'),
        bundleId: 'br.com.alocidadao.app',
        production: env.APNS_PRODUCTION === 'true',
      })
    : undefined;

const app = await buildApp({
  logger: true,
  corsOrigin: env.CORS_ORIGIN,
  storage,
  database,
  push: { android: fcm, ios: apns },
  devRoutes: env.NODE_ENV !== 'production',
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
