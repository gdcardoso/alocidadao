import { z } from 'zod';
import { cpfSchema } from './cpf.js';
import { PLATFORM_ROLES } from './roles.js';

/**
 * Celular brasileiro em E.164, como `+5511999998888`: DDD sem zero e nove dígitos começando
 * por 9. É o que a API aceita de quem digita um número.
 */
export const phoneSchema = z.string().regex(/^\+55[1-9]{2}9[0-9]{8}$/, 'Celular inválido');
/** Qualquer telefone em E.164: descreve o que já está gravado (e o que a API devolve). */
export const storedPhoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Telefone inválido');
/** Código de verificação de 6 dígitos. */
export const codeSchema = z.string().regex(/^[0-9]{6}$/, 'Código inválido');

/** Versão vigente dos Termos de Uso. */
export const TERMS_VERSION = '2026-11-04';
export const CODE_LENGTH = 6;
export const CODE_TTL_SECONDS = 600;
export const CODE_RESEND_SECONDS = 60;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;
export const ACCESS_TOKEN_TTL_SECONDS = 900;
/** Dias sem atividade a partir dos quais a conta é considerada parada. */
export const STALE_ACCOUNT_DAYS = 90;

/** Primeira letra + `•••` + domínio, tudo em minúsculas: `g•••@exemplo.com`. */
export function maskEmail(email: string): string {
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf('@');
  return `${lower.slice(0, 1)}•••${lower.slice(at)}`;
}

/**
 * Celular mascarado: `(15) •••••-1234` para o padrão brasileiro (`+55` e 10 ou 11 dígitos),
 * senão `•••• ` e os 4 últimos dígitos.
 */
export function maskPhone(e164: string): string {
  const br = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (br) return `(${br[1]}) •••••-${br[2]!.slice(-4)}`;
  return `•••• ${e164.slice(-4)}`;
}

/** CPF para a equipe interna: só o miolo aparece, `12345678909` → `•••.456.789-••`. */
export function maskCpfForStaff(digits: string): string {
  return `•••.${digits.slice(3, 6)}.${digits.slice(6, 9)}-••`;
}

export const deviceInfoSchema = z.object({
  installationId: z.uuid(),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(32),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const challengeResponseSchema = z.object({
  challengeId: z.uuid(),
  expiresInSeconds: z.number().int(),
  resendInSeconds: z.number().int(),
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

export const sessionTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresInSeconds: z.number().int(),
});
export type SessionTokens = z.infer<typeof sessionTokensSchema>;

export const phoneStartBodySchema = z.object({ phone: phoneSchema });
export type PhoneStartBody = z.infer<typeof phoneStartBodySchema>;

export const phoneVerifyBodySchema = z.object({
  challengeId: z.uuid(),
  code: codeSchema,
  device: deviceInfoSchema,
});
export type PhoneVerifyBody = z.infer<typeof phoneVerifyBodySchema>;

export const phoneVerifyResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signed_in'), session: sessionTokensSchema }),
  z.object({ status: z.literal('needs_profile'), signupToken: z.string() }),
  z.object({
    status: z.literal('email_check'),
    recoveryChallengeId: z.uuid(),
    maskedEmail: z.string(),
    signupToken: z.string(),
  }),
]);
export type PhoneVerifyResponse = z.infer<typeof phoneVerifyResponseSchema>;

export const signupBodySchema = z.object({
  signupToken: z.string(),
  name: z.string().trim().min(2).max(120),
  email: z.email().optional(),
  acceptedTermsVersion: z.literal(TERMS_VERSION),
});
export type SignupBody = z.infer<typeof signupBodySchema>;

export const recoveryVerifyBodySchema = z.object({
  challengeId: z.uuid(),
  code: codeSchema,
  signupToken: z.string(),
});
export type RecoveryVerifyBody = z.infer<typeof recoveryVerifyBodySchema>;

export const refreshBodySchema = z.object({ refreshToken: z.string() });
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  accessExpiresInSeconds: z.number().int(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const panelStartBodySchema = z.object({ cpf: cpfSchema });
export type PanelStartBody = z.infer<typeof panelStartBodySchema>;
/** O que o cliente envia (CPF ainda com máscara): a API normaliza. */
export type PanelStartInput = z.input<typeof panelStartBodySchema>;

export const panelChallengeResponseSchema = challengeResponseSchema.extend({
  maskedEmail: z.string(),
});
export type PanelChallengeResponse = z.infer<typeof panelChallengeResponseSchema>;

export const panelVerifyBodySchema = z.object({ challengeId: z.uuid(), code: codeSchema });
export type PanelVerifyBody = z.infer<typeof panelVerifyBodySchema>;

export const sessionResponseSchema = z.object({ session: sessionTokensSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Sessão do painel: o token de renovação vai só no cookie HttpOnly, nunca no corpo. */
export const panelSessionResponseSchema = z.object({
  session: z.object({ accessToken: z.string(), accessExpiresInSeconds: z.number().int() }),
});
export type PanelSessionResponse = z.infer<typeof panelSessionResponseSchema>;

export const panelRefreshResponseSchema = z.object({
  accessToken: z.string(),
  accessExpiresInSeconds: z.number().int(),
});
export type PanelRefreshResponse = z.infer<typeof panelRefreshResponseSchema>;

export const meResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: storedPhoneSchema.nullable(),
  email: z.string().nullable(),
  platformRole: z.enum(PLATFORM_ROLES).nullable(),
  agentTenants: z.array(z.object({ tenantId: z.uuid(), tenantName: z.string() })),
  panelTenants: z.array(
    z.object({
      tenantId: z.uuid(),
      tenantName: z.string(),
      role: z.enum(['manager', 'tenant_admin']),
      status: z.enum(['onboarding', 'active']),
    }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.email().nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'Informe ao menos um campo',
  });
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;

export const deviceUpdateBodySchema = z.object({
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(32),
  pushToken: z.string().nullable().optional(),
});
export type DeviceUpdateBody = z.infer<typeof deviceUpdateBodySchema>;

export const phoneChangeStartBodySchema = z.object({ phone: phoneSchema });
export type PhoneChangeStartBody = z.infer<typeof phoneChangeStartBodySchema>;

export const phoneChangeVerifyBodySchema = z.object({ challengeId: z.uuid(), code: codeSchema });
export type PhoneChangeVerifyBody = z.infer<typeof phoneChangeVerifyBodySchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  retryAfterSeconds: z.number().int().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
