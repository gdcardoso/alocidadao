import { describe, expect, it } from 'vitest';
import {
  TERMS_VERSION,
  maskEmail,
  panelStartBodySchema,
  phoneSchema,
  phoneVerifyResponseSchema,
  signupBodySchema,
  updateMeBodySchema,
} from './auth.js';

const uuid = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';

describe('maskEmail', () => {
  it('keeps first letter and domain', () => {
    expect(maskEmail('gabriel@exemplo.com')).toBe('g•••@exemplo.com');
    expect(maskEmail('a@x.co')).toBe('a•••@x.co');
  });
});

describe('phoneSchema', () => {
  it('accepts E.164 and rejects other formats', () => {
    expect(phoneSchema.safeParse('+5511999998888').success).toBe(true);
    expect(phoneSchema.safeParse('11999998888').success).toBe(false);
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
