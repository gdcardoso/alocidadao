import { describe, expect, it } from 'vitest';
import { createLogPushSender } from './log.js';
import { notificationPushMessage } from './message.js';

describe('log push sender', () => {
  it('log sender logs kind and protocol, never the whole token', async () => {
    const lines: { obj: Record<string, unknown>; msg: string }[] = [];
    const sender = createLogPushSender(
      { info: (obj, msg) => lines.push({ obj: obj as Record<string, unknown>, msg }) },
      'android',
    );
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const message = notificationPushMessage('request_rejected', '2026-000123', {
      tenantId: 't-1',
      requestId: 'r-1',
    });
    expect(await sender.send(token, message)).toEqual({ kind: 'sent' });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.msg).toBe('Push (log, sem provedor)');
    const text = JSON.stringify(lines[0]!.obj);
    expect(text).toContain('android');
    expect(text).toContain('request_rejected');
    expect(text).toContain('2026-000123');
    expect(text).toContain(token.slice(-8));
    expect(text).not.toContain(token);
    expect(text).not.toContain(token.slice(-9));
  });
});
