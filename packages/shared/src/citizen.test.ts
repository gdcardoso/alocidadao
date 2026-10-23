import { describe, expect, it } from 'vitest';
import {
  cityInterestBodySchema,
  contestBodySchema,
  locateQuerySchema,
  locateResponseSchema,
  requestFilterStatuses,
} from './citizen.js';

const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('locateResponseSchema', () => {
  it('discriminates served and not_served', () => {
    const served = locateResponseSchema.safeParse({
      status: 'served',
      tenant: { id: uuid, displayName: 'Prefeitura', city: 'X', state: 'SP', centralPhone: null },
      categories: [{ id: uuid, name: 'Buraco', icon: null, iconGroup: 'infrastructure' }],
    });
    const notServed = locateResponseSchema.safeParse({ status: 'not_served', municipality: null });
    const invalid = locateResponseSchema.safeParse({ status: 'not_served', tenant: {} });
    expect(served.success).toBe(true);
    expect(notServed.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});

describe('locateQuerySchema', () => {
  it('coerces strings to numbers', () => {
    expect(locateQuerySchema.parse({ lat: '-23.5', lng: '-46.6' })).toEqual({
      lat: -23.5,
      lng: -46.6,
    });
  });
});

describe('requestFilterStatuses', () => {
  it('maps filters to statuses', () => {
    expect(requestFilterStatuses('active')).toEqual([
      'open',
      'in_progress',
      'awaiting_confirmation',
    ]);
    expect(requestFilterStatuses('done')).toEqual(['completed', 'cancelled', 'rejected']);
    expect(requestFilterStatuses('all')).toHaveLength(6);
  });
});

describe('contestBodySchema', () => {
  it('requires a comment of at least 3 characters', () => {
    expect(
      contestBodySchema.safeParse({ clientActionId: uuid, comment: 'ab', photoKeys: [] }).success,
    ).toBe(false);
    expect(
      contestBodySchema.safeParse({ clientActionId: uuid, comment: ' abc ', photoKeys: [] })
        .success,
    ).toBe(true);
  });
});

describe('cityInterestBodySchema', () => {
  it('rejects codes that are not 7 digits', () => {
    expect(cityInterestBodySchema.safeParse({ ibgeCode: '123456' }).success).toBe(false);
    expect(cityInterestBodySchema.safeParse({ ibgeCode: '12345678' }).success).toBe(false);
    expect(cityInterestBodySchema.safeParse({ ibgeCode: '3550308' }).success).toBe(true);
  });
});
