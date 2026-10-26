import { describe, expect, it } from 'vitest';
import { formatPhoneBR, maskPhoneInput, phoneFromMasked } from './phone.js';

describe('phoneFromMasked', () => {
  it('converts the mask to E.164 and rejects a landline', () => {
    expect(phoneFromMasked('(11) 98877-1020')).toBe('+5511988771020');
    expect(phoneFromMasked('11988771020')).toBe('+5511988771020');
    expect(phoneFromMasked('(11) 3456-7890')).toBeNull();
    expect(phoneFromMasked('(11) 98877-102')).toBeNull();
    expect(phoneFromMasked('')).toBeNull();
  });
});

describe('formatPhoneBR and maskPhoneInput', () => {
  it('keep the app behavior', () => {
    expect(formatPhoneBR('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatPhoneBR('+551134567890')).toBe('(11) 3456-7890');
    expect(formatPhoneBR('+14155550100')).toBe('+14155550100');
    expect(maskPhoneInput('')).toBe('');
    expect(maskPhoneInput('11')).toBe('(11');
    expect(maskPhoneInput('119')).toBe('(11) 9');
    expect(maskPhoneInput('11987654')).toBe('(11) 98765-4');
    expect(maskPhoneInput('(11) 98765-43219999')).toBe('(11) 98765-4321');
  });
});
