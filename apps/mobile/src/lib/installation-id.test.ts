import { describe, expect, it } from 'vitest';
import { getInstallationId, type KeyValueStore } from './installation-id';

function memoryStore(delayMs = 0): KeyValueStore {
  const data = new Map<string, string>();
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  return {
    getItem: async (key) => {
      await wait();
      return data.get(key) ?? null;
    },
    setItem: async (key, value) => {
      await wait();
      data.set(key, value);
    },
    deleteItem: async (key) => {
      data.delete(key);
    },
  };
}

describe('getInstallationId', () => {
  it('creates the id once and reuses it', async () => {
    const store = memoryStore();
    const first = await getInstallationId(store, () => 'id-1');
    const second = await getInstallationId(store, () => 'id-2');
    expect([first, second]).toEqual(['id-1', 'id-1']);
  });

  it('concurrent first calls return the same id', async () => {
    const store = memoryStore(10);
    let calls = 0;
    const newId = () => `id-${++calls}`;
    const ids = await Promise.all([
      getInstallationId(store, newId),
      getInstallationId(store, newId),
    ]);
    expect(ids).toEqual(['id-1', 'id-1']);
    expect(calls).toBe(1);
  });
});
