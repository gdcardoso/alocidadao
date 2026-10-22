import { describe, expect, it } from 'vitest';
import { measureApiLatency, toConnectionContext } from './connection';

const m = { apiLatencyMs: 120, uploadDurationMs: null, sentOffline: false };

describe('toConnectionContext', () => {
  it('maps wifi', () =>
    expect(
      toConnectionContext({ type: 'wifi', isConnected: true, cellularGeneration: null }, m),
    ).toMatchObject({ networkType: 'wifi', cellularGeneration: null, apiLatencyMs: 120 }));
  it('keeps the cellular generation', () =>
    expect(
      toConnectionContext({ type: 'cellular', isConnected: true, cellularGeneration: '4g' }, m)
        .cellularGeneration,
    ).toBe('4g'));
  it('drops unknown generations', () =>
    expect(
      toConnectionContext({ type: 'cellular', isConnected: true, cellularGeneration: null }, m)
        .cellularGeneration,
    ).toBeNull());
  it('maps other types to unknown', () =>
    expect(
      toConnectionContext({ type: 'bluetooth', isConnected: true, cellularGeneration: null }, m)
        .networkType,
    ).toBe('unknown'));
  it('reports none when disconnected', () =>
    expect(
      toConnectionContext({ type: 'wifi', isConnected: false, cellularGeneration: null }, m)
        .networkType,
    ).toBe('none'));
});

describe('measureApiLatency', () => {
  it('measures latency and returns null on failure', async () => {
    const clock = [1000, 1180];
    expect(
      await measureApiLatency(
        async () => {},
        () => clock.shift()!,
      ),
    ).toBe(180);
    expect(
      await measureApiLatency(async () => {
        throw new Error('offline');
      }),
    ).toBeNull();
  });
});
