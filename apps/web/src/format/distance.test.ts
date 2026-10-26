import { describe, expect, it } from 'vitest';
import { formatDistance } from './distance';

describe('formatDistance', () => {
  it('distance formats meters and kilometers', () => {
    expect(formatDistance(0.4)).toBe('0 m');
    expect(formatDistance(6.4)).toBe('6 m');
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(999.6)).toBe('1 km');
    expect(formatDistance(1_100)).toBe('1,1 km');
    expect(formatDistance(1_149)).toBe('1,1 km');
    expect(formatDistance(12_000)).toBe('12 km');
  });
});
