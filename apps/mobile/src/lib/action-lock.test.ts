import { describe, expect, it } from 'vitest';
import { createActionLock } from './action-lock';

describe('createActionLock', () => {
  it('ignores a second tap while the first action runs', async () => {
    const lock = createActionLock();
    let calls = 0;
    let release!: () => void;
    const task = () => {
      calls++;
      return new Promise<string>((resolve) => {
        release = () => resolve('ok');
      });
    };
    const first = lock.run(task);
    const second = lock.run(task);
    expect(calls).toBe(1);
    await expect(second).resolves.toBeUndefined();
    release();
    await expect(first).resolves.toBe('ok');
  });

  it('opens again after the action ends, even when it fails', async () => {
    const lock = createActionLock();
    await expect(lock.run(() => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    await expect(lock.run(async () => 'de novo')).resolves.toBe('de novo');
  });
});
