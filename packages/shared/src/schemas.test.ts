import { describe, expect, it } from 'vitest';
import { createRequestInputSchema, workOrderActionInputSchema } from './schemas.js';

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

  it('accepts the device of the submission, and its absence (old app)', () => {
    const device = {
      platform: 'ios',
      appVersion: '1.0.0',
      osVersion: '18.1',
      manufacturer: 'Apple',
      model: 'iPhone 15',
    };
    const withDevice = createRequestInputSchema.parse({ ...base, location: gps, device });
    expect(withDevice.device).toEqual(device);
    expect(createRequestInputSchema.parse({ ...base, location: gps }).device).toBeUndefined();
  });
});

describe('workOrderActionInputSchema', () => {
  const action = {
    clientActionId: base.clientActionId,
    occurredAt: base.occurredAt,
    photoKeys: [] as string[],
    connection: base.connection,
  };

  it('report_impediment requires a reason, a note and at most one photo', () => {
    const ok = {
      ...action,
      action: 'report_impediment',
      impedimentReason: 'inaccessible',
      note: 'Rua bloqueada por obra',
    };
    expect(workOrderActionInputSchema.safeParse(ok).success).toBe(true);
    expect(workOrderActionInputSchema.safeParse({ ...ok, photoKeys: ['a.jpg'] }).success).toBe(
      true,
    );
    expect(
      workOrderActionInputSchema.safeParse({ ...ok, impedimentReason: undefined }).success,
    ).toBe(false);
    expect(workOrderActionInputSchema.safeParse({ ...ok, note: undefined }).success).toBe(false);
    expect(workOrderActionInputSchema.safeParse({ ...ok, note: 'ab' }).success).toBe(false);
    expect(
      workOrderActionInputSchema.safeParse({ ...ok, photoKeys: ['a.jpg', 'b.jpg'] }).success,
    ).toBe(false);
  });

  it('start rejects photos, note and reason', () => {
    const start = { ...action, action: 'start' };
    expect(workOrderActionInputSchema.safeParse(start).success).toBe(true);
    expect(workOrderActionInputSchema.safeParse({ ...start, photoKeys: ['a.jpg'] }).success).toBe(
      false,
    );
    expect(workOrderActionInputSchema.safeParse({ ...start, note: 'algo aqui' }).success).toBe(
      false,
    );
    expect(
      workOrderActionInputSchema.safeParse({ ...start, impedimentReason: 'other' }).success,
    ).toBe(false);
  });

  it('complete keeps requiring a note and one to three photos', () => {
    const complete = { ...action, action: 'complete', note: 'Buraco tapado', photoKeys: ['a.jpg'] };
    expect(workOrderActionInputSchema.safeParse(complete).success).toBe(true);
    expect(workOrderActionInputSchema.safeParse({ ...complete, note: undefined }).success).toBe(
      false,
    );
    expect(workOrderActionInputSchema.safeParse({ ...complete, photoKeys: [] }).success).toBe(
      false,
    );
    expect(
      workOrderActionInputSchema.safeParse({ ...complete, photoKeys: ['a', 'b', 'c', 'd'] })
        .success,
    ).toBe(false);
  });

  it('location defaults to null and accepts accuracy', () => {
    const start = { ...action, action: 'start' };
    const parsed = workOrderActionInputSchema.parse(start);
    expect(parsed.location).toBeNull();
    const withLocation = workOrderActionInputSchema.parse({
      ...start,
      location: { ...gps, accuracyM: 12 },
    });
    expect(withLocation.location?.accuracyM).toBe(12);
  });
});
