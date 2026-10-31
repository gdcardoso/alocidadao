import { describe, expect, it } from 'vitest';
import {
  TERMS_VERSION,
  maskEmail,
  maskPhone,
  panelRefreshResponseSchema,
  panelSessionResponseSchema,
  panelStartBodySchema,
  meResponseSchema,
  phoneChangeStartBodySchema,
  phoneSchema,
  phoneStartBodySchema,
  phoneVerifyResponseSchema,
  storedPhoneSchema,
  signupBodySchema,
  updateMeBodySchema,
} from './auth.js';

const uuid = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';

describe('maskEmail', () => {
  it('keeps first letter and domain', () => {
    expect(maskEmail('gabriel@exemplo.com')).toBe('g•••@exemplo.com');
    expect(maskEmail('a@x.co')).toBe('a•••@x.co');
  });

  it('maskEmail lowercases before masking', () => {
    expect(maskEmail('Gabriel@Exemplo.COM')).toBe('g•••@exemplo.com');
  });
});

describe('phoneSchema', () => {
  it('accepts E.164 and rejects other formats', () => {
    expect(phoneSchema.safeParse('+5511999998888').success).toBe(true);
    expect(phoneSchema.safeParse('+5511900000001').success).toBe(true);
    expect(phoneSchema.safeParse('11999998888').success).toBe(false);
  });

  it('rejects non-Brazilian numbers', () => {
    expect(phoneSchema.safeParse('+14155550123').success).toBe(false);
    expect(phoneSchema.safeParse('+351912345678').success).toBe(false);
    expect(phoneStartBodySchema.safeParse({ phone: '+14155550123' }).success).toBe(false);
    expect(phoneChangeStartBodySchema.safeParse({ phone: '+14155550123' }).success).toBe(false);
  });

  it('rejects landlines', () => {
    expect(phoneSchema.safeParse('+551133334444').success).toBe(false);
    expect(phoneSchema.safeParse('+5511833334444').success).toBe(false);
    expect(phoneSchema.safeParse('+5501999998888').success).toBe(false);
    expect(phoneStartBodySchema.safeParse({ phone: '+551133334444' }).success).toBe(false);
  });
});

describe('storedPhoneSchema', () => {
  it('accepts any E.164 number', () => {
    expect(storedPhoneSchema.safeParse('+14155550123').success).toBe(true);
    expect(storedPhoneSchema.safeParse('+551133334444').success).toBe(true);
    expect(storedPhoneSchema.safeParse('11999998888').success).toBe(false);
  });

  it('describes the phone in the me response', () => {
    const me = {
      id: uuid,
      name: 'Ana',
      phone: '+14155550123',
      email: null,
      platformRole: null,
      agentTenants: [],
      panelTenants: [],
    };
    expect(meResponseSchema.safeParse(me).success).toBe(true);
    expect(meResponseSchema.safeParse({ ...me, phone: 'abc' }).success).toBe(false);
  });

  it('requires the tenant status on panel tenants', () => {
    const tenant = { tenantId: uuid, tenantName: 'Prefeitura', role: 'manager' };
    const me = {
      id: uuid,
      name: 'Ana',
      phone: null,
      email: null,
      platformRole: null,
      agentTenants: [],
    };
    expect(
      meResponseSchema.safeParse({ ...me, panelTenants: [{ ...tenant, status: 'onboarding' }] })
        .success,
    ).toBe(true);
    expect(meResponseSchema.safeParse({ ...me, panelTenants: [tenant] }).success).toBe(false);
    expect(
      meResponseSchema.safeParse({ ...me, panelTenants: [{ ...tenant, status: 'suspended' }] })
        .success,
    ).toBe(false);
  });
});

describe('phoneVerifyResponseSchema', () => {
  it('discriminates by status', () => {
    const session = { accessToken: 'a', refreshToken: 'r', accessExpiresInSeconds: 900 };
    expect(phoneVerifyResponseSchema.safeParse({ status: 'signed_in', session }).success).toBe(
      true,
    );
    expect(
      phoneVerifyResponseSchema.safeParse({ status: 'needs_profile', signupToken: 't' }).success,
    ).toBe(true);
    expect(
      phoneVerifyResponseSchema.safeParse({
        status: 'email_check',
        recoveryChallengeId: uuid,
        maskedEmail: 'g•••@exemplo.com',
        signupToken: 't',
      }).success,
    ).toBe(true);
    expect(phoneVerifyResponseSchema.safeParse({ status: 'needs_profile' }).success).toBe(false);
  });
});

describe('signupBodySchema', () => {
  it('requires the current terms version', () => {
    const base = { signupToken: 't', name: 'Ana Souza' };
    expect(
      signupBodySchema.safeParse({ ...base, acceptedTermsVersion: TERMS_VERSION }).success,
    ).toBe(true);
    expect(
      signupBodySchema.safeParse({ ...base, acceptedTermsVersion: '2026-01-01' }).success,
    ).toBe(false);
  });

  it('trims the name', () => {
    const parsed = signupBodySchema.parse({
      signupToken: 't',
      name: '  Ana  ',
      acceptedTermsVersion: TERMS_VERSION,
    });
    expect(parsed.name).toBe('Ana');
  });
});

describe('updateMeBodySchema', () => {
  it('requires at least one field', () => {
    expect(updateMeBodySchema.safeParse({}).success).toBe(false);
    expect(updateMeBodySchema.safeParse({ email: null }).success).toBe(true);
  });
});

describe('panelStartBodySchema', () => {
  it('normalizes the CPF', () => {
    expect(panelStartBodySchema.parse({ cpf: '529.982.247-25' }).cpf).toBe('52998224725');
  });
});

describe('panel session responses', () => {
  it('panel session response has no refresh token', () => {
    const session = { accessToken: 'a', accessExpiresInSeconds: 900 };
    expect(panelSessionResponseSchema.parse({ session })).toEqual({ session });
    expect(panelRefreshResponseSchema.parse(session)).toEqual(session);
    expect(
      panelSessionResponseSchema.parse({ session: { ...session, refreshToken: 'r' } }).session,
    ).not.toHaveProperty('refreshToken');
  });
});

describe('maskPhone', () => {
  it('masks a Brazilian mobile, landline and foreign number', () => {
    expect(maskPhone('+5515991231234')).toBe('(15) •••••-1234');
    expect(maskPhone('+551532121234')).toBe('(15) •••••-1234');
    expect(maskPhone('+351912345678')).toBe('•••• 5678');
  });
});
