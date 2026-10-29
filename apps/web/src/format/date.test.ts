import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDayMonth, formatNumericDate } from './date';

describe('formatDayMonth', () => {
  it('formats day and short month in Brasília time', () => {
    expect(formatDayMonth(new Date('2026-10-20T15:00:00Z'))).toBe('20 out');
    expect(formatDayMonth(new Date('2026-01-05T12:00:00Z'))).toBe('5 jan');
    // 02:00 UTC ainda é o dia anterior em Brasília (UTC-3).
    expect(formatDayMonth(new Date('2026-03-01T02:00:00Z'))).toBe('28 fev');
  });
});

describe('formatDateTime', () => {
  it('formats day, month and time in Brasília time', () => {
    expect(formatDateTime(new Date('2026-10-21T18:40:00Z'))).toBe('21 out, 15:40');
    expect(formatDateTime(new Date('2026-10-22T12:10:00Z'))).toBe('22 out, 09:10');
    // Meia-noite em Brasília aparece como 00:00, não 24:00.
    expect(formatDateTime(new Date('2026-10-22T03:05:00Z'))).toBe('22 out, 00:05');
  });
});

describe('formatDate', () => {
  it('formats day, month and year in Brasília time', () => {
    expect(formatDate(new Date('2026-10-20T15:00:00Z'))).toBe('20 out 2026');
    expect(formatDate(new Date('2027-01-01T01:00:00Z'))).toBe('31 dez 2026');
  });
});

describe('formatNumericDate', () => {
  it('formats dd/mm/yyyy in Brasília time', () => {
    expect(formatNumericDate(new Date('2026-08-12T15:00:00Z'))).toBe('12/08/2026');
    expect(formatNumericDate(new Date('2027-01-01T01:00:00Z'))).toBe('31/12/2026');
  });
});
