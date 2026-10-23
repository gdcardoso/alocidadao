import { existsSync, readFileSync } from 'node:fs';
import { createDatabase } from '@alocidadao/db';
import { GoogleAuth } from 'google-auth-library';
import { buildApp } from './app.js';
import { parseEnv, type ApiEnv } from './env.js';
import { createApnsSender } from './push/apns.js';
import { createFcmSender } from './push/fcm.js';
import { createStorage } from './storage/s3.js';

// O servidor roda com o diretório de trabalho em apps/api. Variáveis já definidas no
// ambiente vencem as do .env (loadEnvFile não sobrescreve).
if (existsSync('.env')) process.loadEnvFile('.env');

let env: ApiEnv;
try {
  env = parseEnv(process.env);
} catch (error) {
  console.error(`Ambiente inválido:\n${(error as Error).message}`);
  process.exit(1);
}

const storage = env.s3 ? createStorage(env.s3) : undefined;

const databaseHandle = env.databaseUrl ? createDatabase(env.databaseUrl) : undefined;

// Os caminhos dos arquivos são relativos a apps/api (o diretório de trabalho do servidor).
const fcm = env.fcm
  ? (() => {
      const { projectId, serviceAccountFile } = env.fcm;
      const auth = new GoogleAuth({
        keyFile: serviceAccountFile,
        scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
      });
      return createFcmSender({
        projectId,
        getAccessToken: async () => {
          const token = await auth.getAccessToken();
          if (!token) throw new Error('FCM: sem token de acesso');
          return token;
        },
      });
    })()
  : undefined;

const apns = env.apns
  ? createApnsSender({
      teamId: env.apns.teamId,
      keyId: env.apns.keyId,
      privateKeyPem: readFileSync(env.apns.keyFile, 'utf8'),
      bundleId: 'br.com.alocidadao.app',
      production: env.apns.production,
    })
  : undefined;

const app = await buildApp({
  logger: true,
  corsOrigin: env.corsOrigin,
  storage,
  database: databaseHandle?.db,
  push: { android: fcm, ios: apns },
  devRoutes: env.devRoutes,
});

// Fecha o pool do banco junto com o servidor.
if (databaseHandle) app.addHook('onClose', async () => databaseHandle.pool.end());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error);
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ port: env.port, host: env.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
