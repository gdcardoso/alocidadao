import { describe, expect, it } from 'vitest';
import { createIdleTracker, LAST_ACTIVITY_KEY } from './idle';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const MIN = 60_000;

describe('createIdleTracker', () => {
  it('opening counts as activity; warns 2 min before and ends after 1 h', () => {
    let clock = 0;
    const tracker = createIdleTracker({ now: () => clock, storage: memoryStorage() });

    expect(tracker.check()).toEqual({ phase: 'active', remainingMs: 60 * MIN });
    clock = 58 * MIN - 1;
    expect(tracker.check().phase).toBe('active');
    clock = 58 * MIN;
    expect(tracker.check()).toEqual({ phase: 'warning', remainingMs: 2 * MIN });
    clock = 60 * MIN;
    expect(tracker.check()).toEqual({ phase: 'idle', remainingMs: 0 });
  });

  it('an action restarts the hour', () => {
    let clock = 0;
    const tracker = createIdleTracker({ now: () => clock, storage: memoryStorage() });
    clock = 59 * MIN;
    tracker.touch();
    clock = 60 * MIN;
    expect(tracker.check().phase).toBe('active');
    clock = 119 * MIN;
    expect(tracker.check().phase).toBe('idle');
  });

  it('action in another tab keeps this one open', () => {
    let clock = 0;
    const storage = memoryStorage();
    const thisTab = createIdleTracker({ now: () => clock, storage });
    clock = 50 * MIN;
    const otherTab = createIdleTracker({ now: () => clock, storage });
    clock = 55 * MIN;
    otherTab.touch();
    clock = 70 * MIN;
    expect(thisTab.check()).toEqual({ phase: 'active', remainingMs: 45 * MIN });
  });

  it('throttles writes unless forced', () => {
    let clock = 0;
    const storage = memoryStorage();
    const tracker = createIdleTracker({ now: () => clock, storage });
    clock = 1_000;
    tracker.touch();
    expect(storage.data.get(LAST_ACTIVITY_KEY)).toBe('0');
    tracker.touch(true);
    expect(storage.data.get(LAST_ACTIVITY_KEY)).toBe('1000');
    clock = 6_000;
    tracker.touch();
    expect(storage.data.get(LAST_ACTIVITY_KEY)).toBe('6000');
  });

  it('works without storage and ignores garbage', () => {
    let clock = 0;
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(createIdleTracker({ now: () => clock, storage: broken }).check().phase).toBe('active');

    const storage = memoryStorage();
    storage.data.set(LAST_ACTIVITY_KEY, 'lixo');
    const tracker = createIdleTracker({ now: () => clock, storage });
    storage.data.set(LAST_ACTIVITY_KEY, 'lixo');
    clock = 60 * MIN;
    expect(tracker.check().phase).toBe('idle');
  });
});
