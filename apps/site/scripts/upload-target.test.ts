import { describe, expect, it } from 'vitest';
import { uploadTarget } from './upload-target.js';

describe('uploadTarget', () => {
  const signed =
    'http://10.0.2.2:9000/alocidadao-dev/requests/2026/abc.jpg?X-Amz-Signature=xyz&X-Amz-Date=1';

  it('sends to the local endpoint keeping the signed host', () => {
    expect(uploadTarget(signed, 'http://localhost:9000')).toEqual({
      url: 'http://localhost:9000/alocidadao-dev/requests/2026/abc.jpg?X-Amz-Signature=xyz&X-Amz-Date=1',
      host: '10.0.2.2:9000',
    });
  });

  it('keeps the url when the endpoint is the same origin', () => {
    expect(uploadTarget(signed, 'http://10.0.2.2:9000')).toEqual({
      url: signed,
      host: '10.0.2.2:9000',
    });
  });

  it('keeps the url when no endpoint is given', () => {
    expect(uploadTarget(signed, undefined)).toEqual({ url: signed, host: '10.0.2.2:9000' });
  });
});
