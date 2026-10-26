import { describe, expect, it } from 'vitest';
import {
  assignBodySchema,
  isTriageLate,
  occurrenceMapQuerySchema,
  panelContextSchema,
  pinStyleFor,
  rejectBodySchema,
  splitBodySchema,
  triageQuerySchema,
} from './panel.js';

const uuid = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';

describe('pinStyleFor', () => {
  it('follows the report bands', () => {
    expect(pinStyleFor(1)).toEqual({ size: 32, tone: 'primary' });
    expect(pinStyleFor(2)).toEqual({ size: 36, tone: 'primary' });
    expect(pinStyleFor(3)).toEqual({ size: 40, tone: 'primary' });
    expect(pinStyleFor(4)).toEqual({ size: 42, tone: 'primary' });
    expect(pinStyleFor(5)).toEqual({ size: 48, tone: 'warning' });
    expect(pinStyleFor(7)).toEqual({ size: 48, tone: 'warning' });
    expect(pinStyleFor(8)).toEqual({ size: 50, tone: 'warning' });
    expect(pinStyleFor(10)).toEqual({ size: 50, tone: 'warning' });
    expect(pinStyleFor(11)).toEqual({ size: 54, tone: 'warning' });
    expect(pinStyleFor(15)).toEqual({ size: 54, tone: 'warning' });
    expect(pinStyleFor(16)).toEqual({ size: 64, tone: 'danger' });
    expect(pinStyleFor(200)).toEqual({ size: 64, tone: 'danger' });
  });
});

describe('isTriageLate', () => {
  it('is late from 72 hours', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(isTriageLate(new Date('2026-10-23T12:00:01Z'), now)).toBe(false);
    expect(isTriageLate(new Date('2026-10-23T12:00:00Z'), now)).toBe(true);
    expect(isTriageLate(new Date('2026-10-20T12:00:00Z'), now)).toBe(true);
  });
});

describe('assignBodySchema', () => {
  const base = { teamId: uuid, dueDate: '2026-11-01' };

  it('trims blank instructions to null and rejects 1001 chars', () => {
    expect(assignBodySchema.parse({ ...base, instructions: '   ' }).instructions).toBeNull();
    expect(assignBodySchema.parse({ ...base, instructions: ' leve cones ' }).instructions).toBe(
      'leve cones',
    );
    expect(assignBodySchema.safeParse({ ...base, instructions: 'a'.repeat(1000) }).success).toBe(
      true,
    );
    expect(assignBodySchema.safeParse({ ...base, instructions: 'a'.repeat(1001) }).success).toBe(
      false,
    );
  });

  it('requires a calendar date', () => {
    expect(
      assignBodySchema.safeParse({ ...base, dueDate: '2026-11-01T00:00:00Z', instructions: null })
        .success,
    ).toBe(false);
  });
});

describe('rejectBodySchema', () => {
  it('must have 10 to 500 chars after trim', () => {
    expect(rejectBodySchema.safeParse({ reason: '   curto   ' }).success).toBe(false);
    expect(rejectBodySchema.parse({ reason: '  dez chars!  ' }).reason).toBe('dez chars!');
    expect(rejectBodySchema.safeParse({ reason: 'a'.repeat(500) }).success).toBe(true);
    expect(rejectBodySchema.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('splitBodySchema', () => {
  it('requires at least one request', () => {
    expect(splitBodySchema.safeParse({ requestIds: [] }).success).toBe(false);
    expect(splitBodySchema.safeParse({ requestIds: [uuid] }).success).toBe(true);
  });
});

describe('occurrenceMapQuerySchema', () => {
  it("parses days 'all' as null and defaults to 30 and open_and_in_progress", () => {
    expect(occurrenceMapQuerySchema.parse({})).toEqual({
      status: 'open_and_in_progress',
      days: 30,
    });
    expect(occurrenceMapQuerySchema.parse({ days: 'all' }).days).toBeNull();
    expect(occurrenceMapQuerySchema.parse({ days: '7' }).days).toBe(7);
    expect(occurrenceMapQuerySchema.parse({ days: '90', status: 'open' })).toEqual({
      status: 'open',
      days: 90,
    });
    expect(occurrenceMapQuerySchema.safeParse({ days: '15' }).success).toBe(false);
    expect(occurrenceMapQuerySchema.parse({ categoryId: uuid }).categoryId).toBe(uuid);
  });
});

describe('triageQuerySchema', () => {
  it('parses onlySuggestions from text', () => {
    expect(triageQuerySchema.parse({}).onlySuggestions).toBe(false);
    expect(triageQuerySchema.parse({ onlySuggestions: 'true' }).onlySuggestions).toBe(true);
    expect(triageQuerySchema.parse({ onlySuggestions: 'false' }).onlySuggestions).toBe(false);
    expect(triageQuerySchema.safeParse({ onlySuggestions: 'x' }).success).toBe(false);
  });
});

describe('panelContextSchema', () => {
  it('accepts bounds as a tuple or null', () => {
    const base = {
      tenant: { id: uuid, displayName: 'Prefeitura', status: 'active', bounds: null },
      user: { id: uuid, name: 'Ana' },
      role: 'manager',
      departments: [{ id: uuid, name: 'Obras' }],
    };
    expect(panelContextSchema.safeParse(base).success).toBe(true);
    expect(
      panelContextSchema.safeParse({
        ...base,
        tenant: { ...base.tenant, bounds: [-47.1, -23.1, -46.9, -22.9] },
      }).success,
    ).toBe(true);
    expect(
      panelContextSchema.safeParse({ ...base, tenant: { ...base.tenant, bounds: [1, 2, 3] } })
        .success,
    ).toBe(false);
  });
});
