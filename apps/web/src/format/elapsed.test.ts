import { describe, expect, it } from 'vitest';
import { formatElapsed, formatElapsedShort } from './elapsed';

const now = new Date('2026-10-26T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatElapsed', () => {
  it('elapsed formats minutes, hours and days', () => {
    expect(formatElapsed(ago(0), now)).toBe('há 1 min');
    expect(formatElapsed(ago(59_000), now)).toBe('há 1 min');
    expect(formatElapsed(ago(2 * MIN), now)).toBe('há 2 min');
    expect(formatElapsed(ago(59 * MIN), now)).toBe('há 59 min');
    expect(formatElapsed(ago(60 * MIN), now)).toBe('há 1 h');
    expect(formatElapsed(ago(23 * HOUR + 59 * MIN), now)).toBe('há 23 h');
    expect(formatElapsed(ago(DAY), now)).toBe('há 1 dia');
    expect(formatElapsed(ago(2 * DAY + 5 * HOUR), now)).toBe('há 2 dias');

    expect(formatElapsedShort(ago(5 * MIN), now)).toBe('5 min');
    expect(formatElapsedShort(ago(3 * HOUR), now)).toBe('3 h');
    expect(formatElapsedShort(ago(DAY), now)).toBe('1 dia');
    expect(formatElapsedShort(ago(10 * DAY), now)).toBe('10 dias');
  });

  it('treats less than a minute and a future date as one minute', () => {
    expect(formatElapsed(new Date(now.getTime() + HOUR), now)).toBe('há 1 min');
  });
});
