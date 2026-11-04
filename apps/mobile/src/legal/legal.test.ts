import type { MeResponse } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';
import { markLegalRead, subscribeLegalRead } from './acceptance-store';
import { isTermsRequiredBody, needsTermsAcceptance } from './terms-route';

const me: MeResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Souza',
  phone: '+5511900000001',
  email: null,
  platformRole: null,
  termsAccepted: true,
  agentTenants: [],
  panelTenants: [],
};

describe('needsTermsAcceptance', () => {
  it('does not block without me (offline)', () => {
    expect(needsTermsAcceptance(null)).toBe(false);
  });

  it('blocks only when the terms are not accepted', () => {
    expect(needsTermsAcceptance({ ...me, termsAccepted: false })).toBe(true);
    expect(needsTermsAcceptance(me)).toBe(false);
  });
});

describe('isTermsRequiredBody', () => {
  it('recognises the terms_required body only', () => {
    expect(isTermsRequiredBody({ code: 'terms_required' })).toBe(true);
    expect(isTermsRequiredBody({ code: 'forbidden' })).toBe(false);
    expect(isTermsRequiredBody(null)).toBe(false);
  });
});

describe('markLegalRead', () => {
  it('calls the registered listener once per mark and none after unsubscribing', () => {
    const listener = vi.fn();
    const off = subscribeLegalRead(listener);
    markLegalRead();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    markLegalRead();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
