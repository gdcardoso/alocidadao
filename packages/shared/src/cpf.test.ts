import { describe, expect, it } from 'vitest';
import { cpfSchema, formatCpf, isValidCpf, maskCpf } from './cpf.js';

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

describe('cpfSchema input forms', () => {
  it('cpf accepts spaces and slash', () => {
    expect(cpfSchema.parse(' 529 982 247/25 ')).toBe('52998224725');
    expect(cpfSchema.parse('529.982.247-25')).toBe('52998224725');
  });
});

describe('formatCpf', () => {
  it('formatCpf adds the mask', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
});

describe('maskCpf', () => {
  it('keeps the first 3 and last 2 digits', () => {
    expect(maskCpf('12345678909')).toBe('123.***.***-09');
  });
});
