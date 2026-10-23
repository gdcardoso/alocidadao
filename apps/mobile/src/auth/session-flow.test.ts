import type { MeResponse } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../lib/installation-id';
import { OUTBOX_OWNER_KEY } from './login-flow';
import { restoreSession, signInWithOwnerCheck, signOutSafely } from './session-flow';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    deleteItem: async (key) => {
      data.delete(key);
    },
  };
}

const me = (id: string): MeResponse => ({
  id,
  name: 'Maria da Silva',
  phone: '+5511900000002',
  email: null,
  platformRole: null,
  agentTenants: [],
  panelTenants: [],
});

const unauthorized = new Error('401');
const isUnauthorized = (error: unknown) => error === unauthorized;

describe('session flow', () => {
  it('sign in forgets the owner until the new one is known', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const seen: (string | null)[] = [];
    const clearOfflineData = vi.fn(async () => undefined);

    const current = await signInWithOwnerCheck({
      store,
      saveTokens: async () => {
        seen.push(store.data.get(OUTBOX_OWNER_KEY) ?? null);
      },
      fetchMe: async () => me('user-b'),
      clearOfflineData,
      undoTokens: async () => undefined,
    });

    // Enquanto o login não termina, nenhum dono fica gravado: um app fechado no meio limpa depois.
    expect(seen).toEqual([null]);
    expect(current.id).toBe('user-b');
    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-b');
  });

  it('sign in of the same user keeps offline data', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const clearOfflineData = vi.fn(async () => undefined);

    await signInWithOwnerCheck({
      store,
      saveTokens: async () => undefined,
      fetchMe: async () => me('user-a'),
      clearOfflineData,
      undoTokens: async () => undefined,
    });

    expect(clearOfflineData).not.toHaveBeenCalled();
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });

  it('failed me undoes the login and restores the untouched owner', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const undoTokens = vi.fn(async () => undefined);

    await expect(
      signInWithOwnerCheck({
        store,
        saveTokens: async () => undefined,
        fetchMe: async () => {
          throw new Error('offline');
        },
        clearOfflineData: async () => undefined,
        undoTokens,
      }),
    ).rejects.toThrow('offline');

    expect(undoTokens).toHaveBeenCalledOnce();
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });

  it('failed clear on sign in leaves no owner, so the next login clears again', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });

    await expect(
      signInWithOwnerCheck({
        store,
        saveTokens: async () => undefined,
        fetchMe: async () => me('user-b'),
        clearOfflineData: async () => {
          throw new Error('disk');
        },
        undoTokens: async () => undefined,
      }),
    ).rejects.toThrow('disk');

    expect(store.data.has(OUTBOX_OWNER_KEY)).toBe(false);
  });

  it('launch checks the owner before signing in', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const order: string[] = [];

    const result = await restoreSession({
      store,
      hasTokens: async () => true,
      fetchMe: async () => me('user-b'),
      clearOfflineData: async () => {
        order.push('clear');
      },
      dropTokens: async () => undefined,
      isUnauthorized,
    });

    expect(order).toEqual(['clear']);
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-b');
    expect(result).toEqual({ status: 'signedIn', me: me('user-b') });
  });

  it('launch without tokens is signed out', async () => {
    const result = await restoreSession({
      store: memoryStore(),
      hasTokens: async () => false,
      fetchMe: async () => me('user-a'),
      clearOfflineData: async () => undefined,
      dropTokens: async () => undefined,
      isUnauthorized,
    });
    expect(result).toEqual({ status: 'signedOut' });
  });

  it('launch with a refused session drops the tokens only', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const dropTokens = vi.fn(async () => undefined);
    const clearOfflineData = vi.fn(async () => undefined);

    const result = await restoreSession({
      store,
      hasTokens: async () => true,
      fetchMe: async () => {
        throw unauthorized;
      },
      clearOfflineData,
      dropTokens,
      isUnauthorized,
    });

    expect(result).toEqual({ status: 'signedOut' });
    expect(dropTokens).toHaveBeenCalledOnce();
    expect(clearOfflineData).not.toHaveBeenCalled();
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });

  it('offline launch keeps data of a known owner and clears an unknown one', async () => {
    const offline = async () => {
      throw new Error('offline');
    };
    const known = vi.fn(async () => undefined);
    expect(
      await restoreSession({
        store: memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' }),
        hasTokens: async () => true,
        fetchMe: offline,
        clearOfflineData: known,
        dropTokens: async () => undefined,
        isUnauthorized,
      }),
    ).toEqual({ status: 'signedIn', me: null });
    expect(known).not.toHaveBeenCalled();

    // Login que não terminou (sem dono gravado): a fila pode ser de outra pessoa.
    const unknown = vi.fn(async () => undefined);
    expect(
      await restoreSession({
        store: memoryStore(),
        hasTokens: async () => true,
        fetchMe: offline,
        clearOfflineData: unknown,
        dropTokens: async () => undefined,
        isUnauthorized,
      }),
    ).toEqual({ status: 'signedIn', me: null });
    expect(unknown).toHaveBeenCalledOnce();
  });

  it('launch signs out when the owner check fails', async () => {
    const dropTokens = vi.fn(async () => undefined);
    const result = await restoreSession({
      store: memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' }),
      hasTokens: async () => true,
      fetchMe: async () => me('user-b'),
      clearOfflineData: async () => {
        throw new Error('disk');
      },
      dropTokens,
      isUnauthorized,
    });
    expect(result).toEqual({ status: 'signedOut' });
    expect(dropTokens).toHaveBeenCalledOnce();
  });

  it('sign out survives a failed clear and forgets the owner', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const onError = vi.fn();

    await signOutSafely({
      store,
      dropTokens: async () => undefined,
      clearOfflineData: async () => {
        throw new Error('disk');
      },
      onError,
    });

    expect(store.data.has(OUTBOX_OWNER_KEY)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('sign out clears data even when dropping the tokens fails', async () => {
    const clearOfflineData = vi.fn(async () => undefined);
    const onError = vi.fn();

    await signOutSafely({
      store: memoryStore(),
      dropTokens: async () => {
        throw new Error('keystore');
      },
      clearOfflineData,
      onError,
    });

    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('sign out without clearing keeps offline data', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    await signOutSafely({
      store,
      dropTokens: async () => undefined,
      clearOfflineData: null,
      onError: () => undefined,
    });
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });
});
