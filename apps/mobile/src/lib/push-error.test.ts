import { describe, expect, it } from 'vitest';
import { classifyTokenError } from './push-error';

describe('classifyTokenError', () => {
  it('reconhece Firebase não inicializado', () => {
    expect(
      classifyTokenError(new Error('Default FirebaseApp is not initialized in this process.')),
    ).toBe('push_not_configured');
  });

  it('trata outras falhas como token_failed', () => {
    expect(classifyTokenError(new Error('SERVICE_NOT_AVAILABLE'))).toBe('token_failed');
    expect(classifyTokenError('sem rede')).toBe('token_failed');
  });
});
