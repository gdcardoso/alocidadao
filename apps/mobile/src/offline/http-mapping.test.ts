import { describe, expect, it } from 'vitest';
import { mapActionResponse, mapCreateRequestResponse, parsePresignResponse } from './http-mapping';
import { NetworkError, UploadRejectedError } from './outbox';

const ok = JSON.stringify({
  workOrderId: '22222222-2222-4222-8222-222222222222',
  status: 'in_execution',
  duplicate: false,
});

describe('mapActionResponse', () => {
  it('accepts a valid 200', () => {
    expect(mapActionResponse(200, ok)).toEqual({ kind: 'ok' });
  });
  it('treats an HTML 200 as a network error', () => {
    expect(() => mapActionResponse(200, '<html>login</html>')).toThrow(NetworkError);
    expect(() => mapActionResponse(200, '{"a":1}')).toThrow(NetworkError);
  });
  it('treats redirects and other 5xx as network errors', () => {
    expect(() => mapActionResponse(302, '')).toThrow(NetworkError);
    expect(() => mapActionResponse(500, '')).toThrow(NetworkError);
  });
  it('maps business statuses', () => {
    expect(
      mapActionResponse(
        409,
        JSON.stringify({ code: 'work_order_unavailable', status: 'cancelled' }),
      ),
    ).toEqual({ kind: 'conflict', status: 'cancelled' });
    expect(mapActionResponse(409, JSON.stringify({ code: 'client_action_conflict' }))).toEqual({
      kind: 'rejected',
      code: 'client_action_conflict',
    });
    expect(mapActionResponse(422, JSON.stringify({ code: 'photo_invalid', key: 'k' }))).toEqual({
      kind: 'rejected',
      code: 'photo_invalid',
    });
    expect(mapActionResponse(404, '')).toEqual({ kind: 'rejected', code: 'not_found' });
    expect(mapActionResponse(400, JSON.stringify({ code: 'FST_ERR_VALIDATION' }))).toEqual({
      kind: 'rejected',
      code: 'FST_ERR_VALIDATION',
    });
    expect(mapActionResponse(400, '')).toEqual({ kind: 'rejected', code: 'http_400' });
  });
  it('retries 503 instead of rejecting', () => {
    expect(() => mapActionResponse(503, '{}')).toThrow(NetworkError);
  });
  it('keeps the item queued on 401', () => {
    expect(() => mapActionResponse(401, '{"code":"unauthorized"}')).toThrow(NetworkError);
  });
});

describe('parsePresignResponse', () => {
  it('parses a valid presign', () => {
    const body = { key: 'k', url: 'http://x', headers: { a: 'b' } };
    expect(parsePresignResponse(200, JSON.stringify(body))).toEqual(body);
  });
  it('rejects HTML, bad shapes and non-200', () => {
    expect(() => parsePresignResponse(200, '<html/>')).toThrow(NetworkError);
    expect(() => parsePresignResponse(200, '{"key":"k"}')).toThrow(NetworkError);
    expect(() => parsePresignResponse(302, '')).toThrow(NetworkError);
  });
  it('retries 503 and 5xx', () => {
    expect(() => parsePresignResponse(503, '{}')).toThrow(NetworkError);
    expect(() => parsePresignResponse(500, '')).toThrow(NetworkError);
  });
  it('keeps the item queued on 401', () => {
    expect(() => parsePresignResponse(401, '')).toThrow(NetworkError);
  });
  it('retries 408 and 429', () => {
    expect(() => parsePresignResponse(408, '')).toThrow(NetworkError);
    expect(() => parsePresignResponse(429, '{"code":"rate_limited"}')).toThrow(NetworkError);
  });
  it('rejects 4xx for good', () => {
    expect(() => parsePresignResponse(400, '{}')).toThrow(UploadRejectedError);
    expect(() => parsePresignResponse(403, '')).toThrow(UploadRejectedError);
    try {
      parsePresignResponse(400, JSON.stringify({ code: 'bad_content_type' }));
    } catch (e) {
      expect((e as UploadRejectedError).code).toBe('bad_content_type');
    }
  });
});

describe('mapCreateRequestResponse', () => {
  const created = {
    requestId: '33333333-3333-4333-8333-333333333333',
    protocol: '2026-000200',
    status: 'open',
    duplicate: false,
  };

  it('accepts 201 and the 200 duplicate', () => {
    expect(mapCreateRequestResponse(201, JSON.stringify(created))).toEqual({
      kind: 'ok',
      result: created,
    });
    expect(
      mapCreateRequestResponse(200, JSON.stringify({ ...created, duplicate: true })),
    ).toMatchObject({ kind: 'ok', result: { duplicate: true } });
  });
  it('treats an HTML or malformed success as a network error', () => {
    expect(() => mapCreateRequestResponse(200, '<html/>')).toThrow(NetworkError);
    expect(() => mapCreateRequestResponse(201, '{"requestId":"x"}')).toThrow(NetworkError);
  });
  it('maps the refusals with the municipality', () => {
    const municipality = { ibgeCode: '3509502', name: 'Campinas', state: 'SP' };
    expect(
      mapCreateRequestResponse(
        422,
        JSON.stringify({ code: 'municipality_not_served', municipality }),
      ),
    ).toEqual({ kind: 'rejected', code: 'municipality_not_served', municipality });
    expect(
      mapCreateRequestResponse(
        422,
        JSON.stringify({ code: 'municipality_not_served', municipality: null }),
      ),
    ).toEqual({ kind: 'rejected', code: 'municipality_not_served', municipality: null });
    expect(mapCreateRequestResponse(422, JSON.stringify({ code: 'category_unavailable' }))).toEqual(
      { kind: 'rejected', code: 'category_unavailable' },
    );
    expect(mapCreateRequestResponse(409, JSON.stringify({ code: 'photo_already_used' }))).toEqual({
      kind: 'rejected',
      code: 'photo_already_used',
    });
    expect(mapCreateRequestResponse(400, '')).toEqual({ kind: 'rejected', code: 'http_400' });
  });
  it('maps occurrence_unavailable', () => {
    expect(
      mapCreateRequestResponse(409, JSON.stringify({ code: 'occurrence_unavailable' })),
    ).toEqual({ kind: 'occurrence_unavailable' });
  });
  it('retries 401, 408, 429, 5xx and redirects', () => {
    for (const status of [302, 401, 408, 429, 500, 503]) {
      expect(() => mapCreateRequestResponse(status, '{}')).toThrow(NetworkError);
    }
  });
});
