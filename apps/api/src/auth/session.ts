import { randomUUID } from 'node:crypto';
import { activateInvitations, schema, type Transaction } from '@alocidadao/db';
import { ACCESS_TOKEN_TTL_SECONDS, type DeviceInfo, type SessionTokens } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { newRefreshToken, signAccessToken, type SessionAudience } from './tokens.js';

const { sessions, devices, users } = schema;

/**
 * Sessão do painel: vence após 1 h sem renovação (navegador fechado ou computador desligado).
 * Com a aba aberta, quem encerra por falta de uso é o painel, que conta só a ação da pessoa.
 */
export const PANEL_IDLE_TIMEOUT_SECONDS = 60 * 60;

/**
 * Cria a sessão da conta e devolve os tokens. Roda dentro de withContext com `userId`
 * (as políticas só deixam gravar a própria sessão e os próprios aparelhos).
 * Registra o aparelho, marca a última atividade e ativa os convites pendentes.
 */
export async function startSession(
  tx: Transaction,
  {
    secret,
    userId,
    audience,
    device,
  }: { secret: string; userId: string; audience: SessionAudience; device?: DeviceInfo },
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
      })
      .onConflictDoUpdate({
        target: [devices.userId, devices.installationId],
        set: {
          platform: device.platform,
          appVersion: device.appVersion,
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
