import { describe, expect, it } from 'vitest';
import { formatDays } from './format';

describe('formatDays', () => {
  it.each([
    [4.2, '4,2 dias'],
    [4, '4,0 dias'],
    [1, '1,0 dias'],
    [0, '0,0 dias'],
    [3.96, '4,0 dias'],
    [12.34, '12,3 dias'],
  ])('%s days reads %s', (value, text) => {
    expect(formatDays(value)).toBe(text);
  });

  it('without data reads a dash', () => {
    expect(formatDays(null)).toBe('—');
  });
});
