import { describe, expect, it } from 'vitest';
import { mapActionResponse, parsePresignResponse } from './http-mapping';
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
