import { describe, expect, it } from 'vitest';
import {
  inProgressQuerySchema,
  isReviewLate,
  publishBodySchema,
  REWORK_REASON_LABELS,
  requestListQuerySchema,
  reworkBodySchema,
} from './panel-work.js';

const ID_A = '11111111-1111-4111-8111-111111111111';

describe('publishBodySchema', () => {
  it('publish body trims the note and rejects 9 chars and repeated photo ids', () => {
    const ok = publishBodySchema.parse({
      publicNote: '  Buraco tapado.  ',
      publishedPhotoIds: [ID_A],
    });
    expect(ok.publicNote).toBe('Buraco tapado.');
    expect(
      publishBodySchema.safeParse({ publicNote: '123456789', publishedPhotoIds: [] }).success,
    ).toBe(false);
    expect(
      publishBodySchema.safeParse({ publicNote: '  123456789  ', publishedPhotoIds: [] }).success,
    ).toBe(false);
    expect(
      publishBodySchema.safeParse({ publicNote: '1234567890', publishedPhotoIds: [] }).success,
    ).toBe(true);
    expect(
      publishBodySchema.safeParse({ publicNote: '1234567890', publishedPhotoIds: [ID_A, ID_A] })
        .success,
    ).toBe(false);
    expect(
      publishBodySchema.safeParse({ publicNote: 'x'.repeat(1001), publishedPhotoIds: [] }).success,
    ).toBe(false);
  });
});

describe('reworkBodySchema', () => {
  it('rework body needs a reason and a 3-char message', () => {
    const base = { reasons: ['new_photos'], discardedPhotoIds: [], message: 'Foto ruim' };
    expect(reworkBodySchema.safeParse(base).success).toBe(true);
    expect(reworkBodySchema.safeParse({ ...base, reasons: [] }).success).toBe(false);
    expect(
      reworkBodySchema.safeParse({ ...base, reasons: ['new_photos', 'new_photos'] }).success,
    ).toBe(false);
    expect(reworkBodySchema.safeParse({ ...base, message: ' ab ' }).success).toBe(false);
    expect(reworkBodySchema.safeParse({ ...base, message: ' abc ' }).success).toBe(true);
  });

  it('has the labels of the reasons', () => {
    expect(REWORK_REASON_LABELS.return_to_site).toBe('Voltar ao local: serviço incompleto');
  });
});

describe('inProgressQuerySchema', () => {
  it('in progress query only accepts active work order statuses', () => {
    expect(inProgressQuerySchema.safeParse({ workOrderStatus: 'impeded' }).success).toBe(true);
    expect(inProgressQuerySchema.safeParse({ workOrderStatus: 'completed' }).success).toBe(false);
    expect(inProgressQuerySchema.safeParse({ workOrderStatus: 'cancelled' }).success).toBe(false);
    expect(inProgressQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('requestListQuerySchema', () => {
  it('request list query parses page and days from text', () => {
    expect(requestListQuerySchema.parse({})).toEqual({ days: 30, q: '', page: 1 });
    expect(
      requestListQuerySchema.parse({ page: '3', days: '7', q: 'rua', status: 'open' }),
    ).toEqual({
      page: 3,
      days: 7,
      q: 'rua',
      status: 'open',
    });
    expect(requestListQuerySchema.parse({ days: 'all' }).days).toBeNull();
    expect(requestListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(requestListQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
    expect(requestListQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('isReviewLate', () => {
  it('review is late from 24 hours', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(isReviewLate(new Date('2026-10-25T12:00:00Z'), now)).toBe(true);
    expect(isReviewLate(new Date('2026-10-25T12:00:01Z'), now)).toBe(false);
  });
});
