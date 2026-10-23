import { describe, expect, it } from 'vitest';
import { distanceMeters } from './geo.js';

describe('distanceMeters', () => {
  it('measures about 200 m for 0.0018 degrees of latitude', () => {
    const d = distanceMeters(
      { lat: -23.5505, lng: -46.6333 },
      { lat: -23.5505 + 0.0018, lng: -46.6333 },
    );
    expect(d).toBeGreaterThan(199);
    expect(d).toBeLessThan(201);
  });

  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(0);
  });
});
