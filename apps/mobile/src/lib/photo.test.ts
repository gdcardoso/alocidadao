import { describe, expect, it } from 'vitest';
import { compressToTarget, fitWithin } from './photo';

describe('fitWithin', () => {
  it('fits landscape', () => expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 }));
  it('fits portrait', () => expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 }));
  it('keeps small photos', () => expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 }));
});

describe('compressToTarget', () => {
  it('stops at the first quality under the target', async () => {
    const sizes: Record<number, number> = { 0.7: 420_000, 0.6: 290_000, 0.5: 200_000 };
    const calls: number[] = [];
    const r = await compressToTarget(
      async (q) => (calls.push(q), { bytes: sizes[q]! }),
      [0.7, 0.6, 0.5],
    );
    expect(r.bytes).toBe(290_000);
    expect(calls).toEqual([0.7, 0.6]);
  });
  it('returns the smallest attempt when none fits', async () => {
    const r = await compressToTarget(async (q) => ({ bytes: q * 1_000_000 }), [0.7, 0.4]);
    expect(r.bytes).toBe(400_000);
  });
});
