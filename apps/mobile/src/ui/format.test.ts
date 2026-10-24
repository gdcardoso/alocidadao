import { describe, expect, it } from 'vitest';
import {
  firstName,
  formatDateTime,
  formatAgoPrecise,
  formatDayTime,
  formatDistance,
  formatElapsed,
  formatPhoneBR,
  formatShortDate,
  initials,
  maskPhoneInput,
  parsePhoneInput,
  phoneHintDigits,
} from './format';

describe('phone', () => {
  it('takes the national digits of a Brazilian SIM number', () => {
    expect(phoneHintDigits({ number: '+55 11 98765-4321', e164: '+5511987654321' })).toBe(
      '11987654321',
    );
    expect(phoneHintDigits({ number: '(11) 98765-4321', e164: null })).toBe('11987654321');
  });

  it('ignores a SIM number from another country', () => {
    // O que o emulador devolve: 11 dígitos sem o "+", mas não é do Brasil.
    expect(phoneHintDigits({ number: '+15551234567', e164: null })).toBeNull();
    expect(phoneHintDigits({ number: '(555) 123-4567', e164: '+15551234567' })).toBeNull();
    expect(phoneHintDigits({ number: '(555) 123-4567', e164: null })).toBeNull();
  });
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

describe('agent times and distances', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const MIN = 60_000;

  it('formatAgoPrecise covers minutes, hours and days', () => {
    expect(formatAgoPrecise(ago(0), NOW)).toBe('agora');
    expect(formatAgoPrecise(ago(59_000), NOW)).toBe('agora');
    // Relógio do servidor um pouco à frente: não vira tempo negativo.
    expect(formatAgoPrecise(ago(-30_000), NOW)).toBe('agora');
    expect(formatAgoPrecise(ago(MIN), NOW)).toBe('há 1 min');
    expect(formatAgoPrecise(ago(20 * MIN), NOW)).toBe('há 20 min');
    expect(formatAgoPrecise(ago(59 * MIN + 59_000), NOW)).toBe('há 59 min');
    expect(formatAgoPrecise(ago(60 * MIN), NOW)).toBe('há 1 h');
    expect(formatAgoPrecise(ago(23 * 60 * MIN + 59 * MIN), NOW)).toBe('há 23 h');
    expect(formatAgoPrecise(ago(24 * 60 * MIN), NOW)).toBe('há 1 dia');
    expect(formatAgoPrecise(ago(3 * 24 * 60 * MIN + 5 * MIN), NOW)).toBe('há 3 dias');
  });

  it('formatDistance uses meters below 1 km and a comma above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(8.4)).toBe('8 m');
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(999.4)).toBe('999 m');
    // Arredondar para 1000 m já é quilômetro.
    expect(formatDistance(999.6)).toBe('1,0 km');
    expect(formatDistance(1000)).toBe('1,0 km');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDistance(2_780)).toBe('2,8 km');
    expect(formatDistance(41_060)).toBe('41,1 km');
  });
});
