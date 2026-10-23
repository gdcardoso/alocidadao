import { describe, expect, it } from 'vitest';
import { createRequestInputSchema } from './schemas.js';

const gps = { lat: -23.5505, lng: -46.6333 };
// 1 grau de latitude ~ 111 195 m
const offset = (meters: number) => ({ lat: gps.lat + meters / 111_195, lng: gps.lng });

const base = {
  clientActionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  categoryId: '3f2b8a52-5b0e-4c1e-9d3a-1a2b3c4d5e6f',
  occurredAt: '2026-10-23T12:00:00.000Z',
  description: 'Buraco grande na rua',
  gpsLocation: gps,
  photoKeys: ['a.jpg'],
  connection: {
    networkType: 'wifi',
    cellularGeneration: null,
    apiLatencyMs: null,
    uploadDurationMs: null,
    sentOffline: false,
  },
};

describe('createRequestInputSchema', () => {
  it('accepts a location adjusted about 150 m from the GPS', () => {
    const result = createRequestInputSchema.safeParse({ ...base, location: offset(150) });
    expect(result.success).toBe(true);
  });

  it('refuses a location about 250 m from the GPS, with an issue on location', () => {
    const result = createRequestInputSchema.safeParse({ ...base, location: offset(250) });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'location')).toBe(true);
  });

  it('accepts a missing occurrenceId', () => {
    const result = createRequestInputSchema.safeParse({ ...base, location: gps });
    expect(result.success).toBe(true);
  });

  it('accepts a missing description', () => {
    const { description: _omit, ...rest } = base;
    const result = createRequestInputSchema.safeParse({ ...rest, location: gps });
    expect(result.success).toBe(true);
  });

  it('rejects description over 2000', () => {
    const result = createRequestInputSchema.safeParse({
      ...base,
      description: 'a'.repeat(2001),
      location: gps,
    });
    expect(result.success).toBe(false);
  });
});
