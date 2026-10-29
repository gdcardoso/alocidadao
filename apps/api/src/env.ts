import { z } from 'zod';

export interface ApiEnv {
  port: number;
  host: string;
  databaseUrl?: string;
  corsOrigin?: string;
  s3?: {
    endpoint: string;
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  // Os caminhos dos arquivos ficam como texto; quem lê o arquivo é o server.ts.
  fcm?: { projectId: string; serviceAccountFile: string };
  apns?: {
    teamId: string;
    keyId: string;
    keyFile: string;
    production: boolean;
    bundleId: string;
  };
  /** Login sem senha. Presente quando AUTH_SECRET está definida. */
  auth?: { secret: string; devFixedCode?: string };
  /** Sem chave do Resend, o e-mail sai no log (só fora de produção). */
  email: { resendApiKey?: string; from: string };
  devRoutes: boolean;
}

// Variável vazia (como no .env.example) vale como ausente.
const optionalText = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const schema = z.object({
  PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[0-9]+$/, 'deve ser um número inteiro')
      .transform(Number)
      .refine((n) => n >= 1 && n <= 65535, 'deve estar entre 1 e 65535')
      .default(3333),
  ),
  HOST: optionalText,
  DATABASE_URL: optionalText,
  CORS_ORIGIN: optionalText,
  S3_ENDPOINT: optionalText,
  S3_PUBLIC_ENDPOINT: optionalText,
  S3_REGION: optionalText,
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY_ID: optionalText,
  S3_SECRET_ACCESS_KEY: optionalText,
  FCM_PROJECT_ID: optionalText,
  FCM_SERVICE_ACCOUNT_FILE: optionalText,
  APNS_TEAM_ID: optionalText,
  APNS_KEY_ID: optionalText,
  APNS_KEY_FILE: optionalText,
  APNS_PRODUCTION: optionalText,
  APNS_BUNDLE_ID: optionalText,
  AUTH_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32, 'deve ter no mínimo 32 caracteres').optional(),
  ),
  AUTH_DEV_FIXED_CODE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[0-9]{6}$/, 'deve ter 6 dígitos')
      .optional(),
  ),
  RESEND_API_KEY: optionalText,
  EMAIL_FROM: optionalText,
  ENABLE_DEV_ROUTES: optionalText,
  NODE_ENV: optionalText,
});

/** Valida o ambiente de uma vez; função pura, sem acesso a arquivo nem a process. */
export function parseEnv(source: Record<string, string | undefined>): ApiEnv {
  const parsed = schema.safeParse(source);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${String(issue.path[0])}: ${issue.message}`);
    }
    throw new Error(problems.join('\n'));
  }
  const e = parsed.data;

  const missing = (name: string, value: string | undefined, reason: string) => {
    if (!value) problems.push(`${name}: ${reason}`);
  };

  if (e.S3_ENDPOINT) {
    missing('S3_ACCESS_KEY_ID', e.S3_ACCESS_KEY_ID, 'obrigatória quando S3_ENDPOINT está definida');
    missing(
      'S3_SECRET_ACCESS_KEY',
      e.S3_SECRET_ACCESS_KEY,
      'obrigatória quando S3_ENDPOINT está definida',
    );
  }

  const production = e.NODE_ENV === 'production';
  if (e.DATABASE_URL) {
    missing('AUTH_SECRET', e.AUTH_SECRET, 'obrigatória quando DATABASE_URL está definida');
  }
  if (production && e.AUTH_DEV_FIXED_CODE) {
    problems.push('AUTH_DEV_FIXED_CODE: proibida em produção');
  }
  if (production) missing('RESEND_API_KEY', e.RESEND_API_KEY, 'obrigatória em produção');

  const together = (group: Record<string, string | undefined>) => {
    const names = Object.keys(group);
    const set = names.filter((n) => group[n]);
    if (set.length > 0 && set.length < names.length) {
      for (const n of names) {
        if (!group[n]) problems.push(`${n}: obrigatória junto de ${set.join(', ')}`);
      }
    }
  };
  together({
    FCM_PROJECT_ID: e.FCM_PROJECT_ID,
    FCM_SERVICE_ACCOUNT_FILE: e.FCM_SERVICE_ACCOUNT_FILE,
  });
  together({
    APNS_TEAM_ID: e.APNS_TEAM_ID,
    APNS_KEY_ID: e.APNS_KEY_ID,
    APNS_KEY_FILE: e.APNS_KEY_FILE,
  });

  if (problems.length > 0) throw new Error(problems.join('\n'));

  return {
    port: e.PORT,
    host: e.HOST ?? '0.0.0.0',
    databaseUrl: e.DATABASE_URL,
    corsOrigin: e.CORS_ORIGIN,
    s3: e.S3_ENDPOINT
      ? {
          endpoint: e.S3_ENDPOINT,
          publicEndpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT,
          region: e.S3_REGION ?? 'us-east-1',
          bucket: e.S3_BUCKET ?? 'alocidadao-dev',
          accessKeyId: e.S3_ACCESS_KEY_ID!,
          secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        }
      : undefined,
    fcm:
      e.FCM_PROJECT_ID && e.FCM_SERVICE_ACCOUNT_FILE
        ? { projectId: e.FCM_PROJECT_ID, serviceAccountFile: e.FCM_SERVICE_ACCOUNT_FILE }
        : undefined,
    apns:
      e.APNS_TEAM_ID && e.APNS_KEY_ID && e.APNS_KEY_FILE
        ? {
            teamId: e.APNS_TEAM_ID,
            keyId: e.APNS_KEY_ID,
            keyFile: e.APNS_KEY_FILE,
            production: e.APNS_PRODUCTION === 'true',
            bundleId: e.APNS_BUNDLE_ID ?? 'br.com.alocidadao.app',
          }
        : undefined,
    auth: e.AUTH_SECRET
      ? { secret: e.AUTH_SECRET, devFixedCode: e.AUTH_DEV_FIXED_CODE }
      : undefined,
    email: {
      resendApiKey: e.RESEND_API_KEY,
      from: e.EMAIL_FROM ?? 'Alô Cidadão <nao-responda@alocidadao.com.br>',
    },
    devRoutes: e.ENABLE_DEV_ROUTES === 'true' && !production,
  };
}
