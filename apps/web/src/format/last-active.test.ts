import { describe, expect, it } from 'vitest';
import { formatLastAccess, formatLastActive } from './last-active';

// 2026-10-26 15:00 em Brasília.
const now = new Date('2026-10-26T18:00:00Z');

describe('formatLastActive', () => {
  it('last active shows today, yesterday, a date or never', () => {
    expect(formatLastActive(new Date('2026-10-26T12:12:00Z'), now)).toBe('hoje, 09:12');
    expect(formatLastActive(new Date('2026-10-25T21:03:00Z'), now)).toBe('ontem, 18:03');
    expect(formatLastActive(new Date('2026-10-12T15:00:00Z'), now)).toBe('12 out');
    expect(formatLastActive(null, now)).toBe('nunca entrou');
  });

  it('uses the Brasília day around midnight', () => {
    // 02:30 UTC de 27/10 ainda é 26/10 em Brasília: ontem, em relação a 00:30 de 27/10.
    expect(
      formatLastActive(new Date('2026-10-27T02:30:00Z'), new Date('2026-10-27T03:30:00Z')),
    ).toBe('ontem, 23:30');
  });
});

describe('formatLastAccess', () => {
  it('last access shows today, yesterday, days ago, a date or never', () => {
    expect(formatLastAccess(new Date('2026-10-26T12:40:00Z'), now)).toBe('hoje, 09:40');
    expect(formatLastAccess(new Date('2026-10-25T19:30:00Z'), now)).toBe('ontem, 16:30');
    expect(formatLastAccess(new Date('2026-10-23T15:00:00Z'), now)).toBe('há 3 dias');
    expect(formatLastAccess(new Date('2026-09-26T15:00:00Z'), now)).toBe('há 30 dias');
    expect(formatLastAccess(new Date('2026-09-25T15:00:00Z'), now)).toBe('25 set 2026');
    expect(formatLastAccess(null, now)).toBe('nunca entrou');
  });
});
