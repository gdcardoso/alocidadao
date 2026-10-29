import { describe, expect, it } from 'vitest';
import { maskCpfInput } from './cpf';

describe('maskCpfInput', () => {
  it('masks the cpf while typing', () => {
    expect(maskCpfInput('')).toBe('');
    expect(maskCpfInput('123')).toBe('123');
    expect(maskCpfInput('1234')).toBe('123.4');
    expect(maskCpfInput('1234567')).toBe('123.456.7');
    expect(maskCpfInput('1234567890')).toBe('123.456.789-0');
    expect(maskCpfInput('12345678909')).toBe('123.456.789-09');
  });
});
