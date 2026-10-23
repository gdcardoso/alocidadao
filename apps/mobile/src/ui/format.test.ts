import { describe, expect, it } from 'vitest';
import {
  firstName,
  formatDateTime,
  formatDayTime,
  formatElapsed,
  formatPhoneBR,
  formatShortDate,
  initials,
  maskPhoneInput,
  parsePhoneInput,
} from './format';

describe('phone', () => {
  it('formats an E.164 mobile number', () => {
    expect(formatPhoneBR('+5511987654321')).toBe('(11) 98765-4321');
  });

  it('formats a landline and keeps unknown numbers as they are', () => {
    expect(formatPhoneBR('+551134567890')).toBe('(11) 3456-7890');
    expect(formatPhoneBR('+14155550100')).toBe('+14155550100');
  });

  it('parses the masked input into E.164', () => {
    expect(parsePhoneInput('(11) 98765-4321')).toBe('+5511987654321');
    expect(parsePhoneInput('11987654321')).toBe('+5511987654321');
  });

  it('parse returns null for an incomplete number', () => {
    expect(parsePhoneInput('(11) 98765-432')).toBeNull();
    expect(parsePhoneInput('')).toBeNull();
  });

  it('masks while typing', () => {
    expect(maskPhoneInput('')).toBe('');
    expect(maskPhoneInput('1')).toBe('(1');
    expect(maskPhoneInput('11')).toBe('(11');
    expect(maskPhoneInput('119')).toBe('(11) 9');
    expect(maskPhoneInput('1198765')).toBe('(11) 98765');
    expect(maskPhoneInput('11987654')).toBe('(11) 98765-4');
    expect(maskPhoneInput('11987654321')).toBe('(11) 98765-4321');
  });

  it('mask ignores non digits and extra digits', () => {
    expect(maskPhoneInput('(11) 98765-43219999')).toBe('(11) 98765-4321');
  });
});

describe('dates', () => {
  const now = new Date('2026-10-23T15:00:00.000Z'); // 12:00 em São Paulo

  it('formats elapsed days by status', () => {
    expect(formatElapsed('open', '2026-10-20T11:12:00.000Z', now)).toBe('Aberta há 3 dias');
    expect(formatElapsed('in_progress', '2026-10-21T17:30:00.000Z', now)).toBe(
      'Em atendimento há 2 dias',
    );
    expect(formatElapsed('open', '2026-10-22T13:00:00.000Z', now)).toBe('Aberta há 1 dia');
  });

  it('says today on the same day', () => {
    expect(formatElapsed('open', '2026-10-23T11:12:00.000Z', now)).toBe('Aberta hoje');
  });

  it('counts days in the São Paulo time zone near UTC midnight', () => {
    // 01:30 UTC do dia 23 ainda é 22:30 do dia 22 em São Paulo.
    const lateNight = new Date('2026-10-23T02:30:00.000Z'); // 23:30 do dia 22 em SP
    expect(formatElapsed('open', '2026-10-23T01:30:00.000Z', lateNight)).toBe('Aberta hoje');
    // Aberta às 23:59 do dia 22 em São Paulo, vista às 02:59 do dia 23: um dia de calendário.
    expect(
      formatElapsed('open', '2026-10-23T02:59:00.000Z', new Date('2026-10-23T05:59:00Z')),
    ).toBe('Aberta há 1 dia');
  });

  it('formats date and time', () => {
    expect(formatDateTime('2026-10-20T11:12:00.000Z')).toBe('20 out 2026, 08:12');
    expect(formatDateTime('2026-01-02T02:05:00.000Z')).toBe('01 jan 2026, 23:05');
  });

  it('formats day and time without the year', () => {
    expect(formatDayTime('2026-10-21T18:40:00.000Z')).toBe('21 out, 15:40');
  });

  it('formats short dates', () => {
    expect(formatShortDate('2026-10-23T11:12:00.000Z', now)).toBe('Hoje, 08:12');
    expect(formatShortDate('2026-10-18T13:00:00.000Z', now)).toBe('18 out');
    expect(formatShortDate('2026-10-02T13:00:00.000Z', now)).toBe('02 out');
    expect(formatShortDate('2025-12-30T13:00:00.000Z', now)).toBe('30 dez 2025');
  });

  it('short date uses the São Paulo day near UTC midnight', () => {
    // 01:00 UTC do dia 24 é 22:00 do dia 23 em São Paulo: ainda "Hoje".
    expect(formatShortDate('2026-10-24T01:00:00.000Z', now)).toBe('Hoje, 22:00');
  });
});

describe('names', () => {
  it('takes the initials of the first and last names', () => {
    expect(initials('Maria da Silva')).toBe('MS');
    expect(initials('  joão  ')).toBe('J');
    expect(initials('')).toBe('');
  });

  it('takes the first name', () => {
    expect(firstName('Maria da Silva')).toBe('Maria');
    expect(firstName('  Ana ')).toBe('Ana');
  });
});
