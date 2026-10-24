import { deviceLocationSchema } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import { toAccuracyM } from './location-accuracy';

describe('toAccuracyM', () => {
  it('keeps a valid accuracy', () => {
    expect(toAccuracyM(8.5)).toBe(8.5);
    expect(toAccuracyM(0)).toBe(0);
  });

  it('turns negative, non-finite or missing accuracy into null', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(toAccuracyM(value)).toBeNull();
    }
  });

  it('always passes the device location schema', () => {
    for (const value of [-3, Number.NaN, Number.NEGATIVE_INFINITY, 12]) {
      const location = { lat: -25.4, lng: -49.3, accuracyM: toAccuracyM(value) };
      expect(deviceLocationSchema.safeParse(location).success).toBe(true);
    }
  });
});
