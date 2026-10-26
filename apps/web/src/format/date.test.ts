import { describe, expect, it } from 'vitest';
import { formatDayMonth } from './date';

describe('formatDayMonth', () => {
  it('formats day and short month in Brasília time', () => {
    expect(formatDayMonth(new Date('2026-10-20T15:00:00Z'))).toBe('20 out');
    expect(formatDayMonth(new Date('2026-01-05T12:00:00Z'))).toBe('5 jan');
    // 02:00 UTC ainda é o dia anterior em Brasília (UTC-3).
    expect(formatDayMonth(new Date('2026-03-01T02:00:00Z'))).toBe('28 fev');
  });
});
