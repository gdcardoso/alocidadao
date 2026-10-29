import { notificationKindSchema } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import { labPushBody } from './lab-push';

describe('labPushBody', () => {
  it('sends the fields the dev push route expects', () => {
    const body = labPushBody('android', 'token-1');
    expect(body).toEqual({
      platform: 'android',
      token: 'token-1',
      kind: 'request_in_progress',
      protocol: '2026-000123',
    });
    expect(notificationKindSchema.safeParse(body.kind).success).toBe(true);
    expect(body).not.toHaveProperty('status');
  });
});
