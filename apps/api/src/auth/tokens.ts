import { createHash, randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_TTL_SECONDS, deviceInfoSchema, phoneSchema } from '@alocidadao/shared';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

const ISSUER = 'alocidadao-api';
const SIGNUP_AUDIENCE = 'signup';
const SIGNUP_TOKEN_TTL_SECONDS = 30 * 60;

export type SessionAudience = 'app' | 'panel';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  audience: SessionAudience;
}

const signupClaimsSchema = z.object({
  phone: phoneSchema,
  device: deviceInfoSchema,
  /** Conta parada com o mesmo telefone, congelada quando a conta nova for criada. */
  freezeUserId: z.uuid().nullable(),
});
export type SignupClaims = z.infer<typeof signupClaimsSchema>;

const accessPayloadSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  aud: z.enum(['app', 'panel']),
});

const key = (secret: string) => new TextEncoder().encode(secret);

/** JWT HS256 de 15 min com sub (usuário), sid (sessão), aud e iss. */
export async function signAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setAudience(claims.audience)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** Claims do token de acesso, ou null se inválido, vencido ou de outra audiência. */
export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: ['app', 'panel'],
    });
    const parsed = accessPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return { userId: parsed.data.sub, sessionId: parsed.data.sid, audience: parsed.data.aud };
  } catch {
    return null;
  }
}

/** Token do cadastro em dois passos: telefone, aparelho e conta a congelar (30 min). */
export async function signSignupToken(secret: string, claims: SignupClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(SIGNUP_AUDIENCE)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SIGNUP_TOKEN_TTL_SECONDS}s`)
    .sign(key(secret));
}

export async function verifySignupToken(
  secret: string,
  token: string,
): Promise<SignupClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: SIGNUP_AUDIENCE,
    });
    const parsed = signupClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Token de renovação: 32 bytes aleatórios; o banco guarda só o sha256. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
