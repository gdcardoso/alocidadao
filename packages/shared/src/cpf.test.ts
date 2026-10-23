import { describe, expect, it } from 'vitest';
import { cpfSchema, isValidCpf } from './cpf.js';

describe('isValidCpf', () => {
  it('accepts valid CPFs', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
  });

  it('rejects wrong check digits', () => {
    expect(isValidCpf('52998224724')).toBe(false);
  });

  it('rejects repeated digits', () => {
    expect(isValidCpf('00000000000')).toBe(false);
    expect(isValidCpf('99999999999')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCpf('5299822472')).toBe(false);
  });
});

describe('cpfSchema', () => {
  it('strips punctuation', () => {
    expect(cpfSchema.parse('529.982.247-25')).toBe('52998224725');
  });

  it('rejects invalid CPFs', () => {
    expect(cpfSchema.safeParse('52998224724').success).toBe(false);
  });
});
