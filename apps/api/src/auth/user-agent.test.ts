import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './user-agent.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

describe('parseUserAgent', () => {
  it('parses Chrome on Windows', () => {
    expect(parseUserAgent(CHROME_WINDOWS)).toEqual({
      browser: 'Chrome',
      browserVersion: '142.0.0.0',
      os: 'Windows',
      osVersion: 'NT 10.0',
    });
  });

  it('parses Safari on macOS', () => {
    expect(parseUserAgent(SAFARI_MAC)).toMatchObject({ browser: 'Safari', os: 'macOS' });
  });

  it('returns null without user agent', () => {
    expect(parseUserAgent(undefined)).toBeNull();
    expect(parseUserAgent('')).toBeNull();
  });

  it('cuts long values at 64 characters', () => {
    const client = parseUserAgent(`Mozilla/5.0 (Windows NT 10.0) Chrome/${'1'.repeat(80)}`);
    expect(client?.browserVersion?.length).toBeLessThanOrEqual(64);
  });
});
