import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import type { ApiEnv } from '../env.js';
import { createApnsSender } from './apns.js';
import { createFcmSender } from './fcm.js';
import { createLogPushSender } from './log.js';
import type { PushSender } from './types.js';

export interface PushLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

export interface PushSenders {
  android: PushSender;
  ios: PushSender;
  /** `true` quando o provedor real está ligado; `false` quando cai no sender de log. */
  configured: { android: boolean; ios: boolean };
}

/**
 * Monta os senders de FCM e APNs. Sem configuração (ou sem o .p8), a plataforma usa o
 * sender de log. Os caminhos dos arquivos são relativos a apps/api.
 */
export function buildPushSenders(env: Pick<ApiEnv, 'fcm' | 'apns'>, log: PushLog): PushSenders {
  let android: PushSender | undefined;
  if (env.fcm) {
    const { projectId, serviceAccountFile } = env.fcm;
    const auth = new GoogleAuth({
      keyFile: serviceAccountFile,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    android = createFcmSender({
      projectId,
      getAccessToken: async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new Error('FCM: sem token de acesso');
        return token;
      },
    });
  }

  let ios: PushSender | undefined;
  if (env.apns) {
    try {
      ios = createApnsSender({
        teamId: env.apns.teamId,
        keyId: env.apns.keyId,
        privateKeyPem: readFileSync(env.apns.keyFile, 'utf8'),
        bundleId: env.apns.bundleId,
        production: env.apns.production,
      });
    } catch (error) {
      log.warn(
        {
          keyFile: env.apns.keyFile,
          error: error instanceof Error ? error.message : String(error),
        },
        'APNs desligado: não foi possível ler a chave .p8; usando o log',
      );
    }
  }

  return {
    android: android ?? createLogPushSender(log, 'android'),
    ios: ios ?? createLogPushSender(log, 'ios'),
    configured: { android: android !== undefined, ios: ios !== undefined },
  };
}
