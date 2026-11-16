import { randomUUID } from 'node:crypto';
import { activateInvitations, schema, type Transaction } from '@alocidadao/db';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  type AppDevice,
  type BrowserClient,
  type DeviceInfo,
  type SessionDevice,
  type SessionTokens,
} from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { newRefreshToken, signAccessToken, type SessionAudience } from './tokens.js';

const { sessions, devices, users } = schema;

/**
 * Colunas de detalhe do aparelho para o upsert em `devices`: só as que vieram, para que um
 * corpo sem elas (app antigo) não apague o que já estava gravado.
 */
export function deviceDetails({ osVersion, manufacturer, model }: AppDevice) {
  return {
    ...(osVersion !== undefined && { osVersion }),
    ...(manufacturer !== undefined && { manufacturer }),
    ...(model !== undefined && { model }),
  };
}

/** Retrato guardado na sessão: o aparelho do app (sem a instalação) ou o navegador do painel. */
function sessionDevice(device?: DeviceInfo, client?: BrowserClient | null): SessionDevice | null {
  if (device) {
    const { installationId: _installationId, ...app } = device;
    return { kind: 'app', ...app };
  }
  return client ? { kind: 'browser', ...client } : null;
}

/**
 * Sessão do painel: vence após 1 h sem renovação (navegador fechado ou computador desligado).
 * Com a aba aberta, quem encerra por falta de uso é o painel, que conta só a ação da pessoa.
 */
export const PANEL_IDLE_TIMEOUT_SECONDS = 60 * 60;

/**
 * Cria a sessão da conta e devolve os tokens. Roda dentro de withContext com `userId`
 * (as políticas só deixam gravar a própria sessão e os próprios aparelhos).
 * Registra o aparelho, marca a última atividade e ativa os convites pendentes. No painel,
 * `client` é o navegador lido do User-Agent.
 */
export async function startSession(
  tx: Transaction,
  {
    secret,
    userId,
    audience,
    device,
    client,
  }: {
    secret: string;
    userId: string;
    audience: SessionAudience;
    device?: DeviceInfo;
    client?: BrowserClient | null;
  },
): Promise<SessionTokens> {
  const sessionId = randomUUID();
  const refresh = newRefreshToken();
  const panel = audience === 'panel';

  await tx.insert(sessions).values({
    id: sessionId,
    userId,
    audience,
    refreshTokenHash: refresh.hash,
    installationId: device?.installationId,
    device: sessionDevice(device, client),
    idleTimeoutSeconds: panel ? PANEL_IDLE_TIMEOUT_SECONDS : null,
    expiresAt: panel ? sql`now() + make_interval(secs => ${PANEL_IDLE_TIMEOUT_SECONDS})` : null,
  });

  if (device) {
    await tx
      .insert(devices)
      .values({
        userId,
        installationId: device.installationId,
        platform: device.platform,
        appVersion: device.appVersion,
        ...deviceDetails(device),
      })
      .onConflictDoUpdate({
        target: [devices.userId, devices.installationId],
        set: {
          platform: device.platform,
          appVersion: device.appVersion,
          ...deviceDetails(device),
          lastSeenAt: sql`now()`,
        },
      });
  }

  await tx
    .update(users)
    .set({ lastActiveAt: sql`now()` })
    .where(eq(users.id, userId));
  await activateInvitations(tx);

  return {
    accessToken: await signAccessToken(secret, { userId, sessionId, audience }),
    refreshToken: refresh.token,
    accessExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  };
}
