import { existsSync } from 'node:fs';
import { createDatabase } from '@alocidadao/db';
import { buildApp } from './app.js';
import { parseEnv, type ApiEnv } from './env.js';
import {
  createLogEmailSender,
  createResendEmailSender,
  type EmailSender,
} from './messaging/email.js';
import { buildPushSenders } from './push/senders.js';
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
// Sem Resend (só fora de produção), o e-mail sai no log da aplicação, criada logo abaixo.
const email: EmailSender = env.email.resendApiKey
  ? createResendEmailSender({ apiKey: env.email.resendApiKey, from: env.email.from })
  : { send: (msg) => createLogEmailSender(app.log).send(msg) };

// O logger da aplicação nasce em buildApp: os avisos de antes dele ficam numa fila.
const queuedLogs: { level: 'info' | 'warn'; obj: object; msg: string }[] = [];
let appLog:
  { info: (o: object, m: string) => void; warn: (o: object, m: string) => void } | undefined;
const pushLog = {
  info: (obj: object, msg: string) =>
    appLog ? appLog.info(obj, msg) : queuedLogs.push({ level: 'info', obj, msg }),
  warn: (obj: object, msg: string) =>
    appLog ? appLog.warn(obj, msg) : queuedLogs.push({ level: 'warn', obj, msg }),
};
const push = buildPushSenders(env, pushLog);

const app = await buildApp({
  logger: true,
  corsOrigin: env.corsOrigin,
  storage,
  database: databaseHandle?.db,
  push,
  devRoutes: env.devRoutes,
  // Envio dos avisos, confirmação automática e limpeza; para no preClose, antes do pool fechar.
  notifications: { scheduler: true },
  // Não há provedor de SMS: fora de produção o código sai no log; em produção, 503.
  auth: env.auth && databaseHandle ? { ...env.auth, email } : undefined,
  invites: env.invites,
});

appLog = app.log;
for (const { level, obj, msg } of queuedLogs) app.log[level](obj, msg);

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
