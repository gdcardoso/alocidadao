import { describe, expect, it } from 'vitest';
import { getInstallationId, type KeyValueStore } from './installation-id';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
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
});
