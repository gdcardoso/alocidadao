import { describe, expect, it } from 'vitest';
import { enqueueWorkOrderAction } from './outbox';
import {
  besideSyncPass,
  clearOutbox,
  exclusive,
  forgetSentRequests,
  getOutboxSnapshot,
  rememberSentRequests,
  setOutboxItems,
  subscribeOutbox,
} from './outbox-state';
import { MemoryOutboxStore, makeRequestItem } from './test-helpers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('outbox state', () => {
  it('forgets the sent requests the server list already brings', () => {
    rememberSentRequests([
      { item: makeRequestItem({ id: 'a', status: 'done' }), requestId: 'server-a' },
      { item: makeRequestItem({ id: 'b', status: 'done' }), requestId: 'server-b' },
    ]);
    forgetSentRequests(['server-a']);
    expect(getOutboxSnapshot().sent.map((s) => s.requestId)).toEqual(['server-b']);
    forgetSentRequests(['server-b']);
    expect(getOutboxSnapshot().sent).toEqual([]);
  });

  it('clearing waits for the running task and empties the snapshot', async () => {
    setOutboxItems([makeRequestItem({ id: 'previous-user' })]);
    rememberSentRequests([
      { item: makeRequestItem({ id: 'sent', status: 'done' }), requestId: 'server-sent' },
    ]);
    const order: string[] = [];
    const pass = deferred();
    const running = exclusive(async () => {
      await pass.promise;
      order.push('pass');
    });
    let emitted = 0;
    const unsubscribe = subscribeOutbox(() => emitted++);
    const cleared = clearOutbox(async () => {
      order.push('wipe');
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    pass.resolve();
    await Promise.all([running, cleared]);
    unsubscribe();
    expect(order).toEqual(['pass', 'wipe']);
    expect(getOutboxSnapshot().items).toEqual([]);
    expect(getOutboxSnapshot().sent).toEqual([]);
    expect(emitted).toBeGreaterThan(0);
  });

  it('empties the snapshot even when wiping fails', async () => {
    setOutboxItems([makeRequestItem({ id: 'previous-user' })]);
    await expect(
      clearOutbox(async () => {
        throw new Error('disk');
      }),
    ).rejects.toThrow('disk');
    expect(getOutboxSnapshot().items).toEqual([]);
  });

  it('agent action enqueues while a sync pass is running', async () => {
    const store = new MemoryOutboxStore();
    const pass = deferred();
    let snapshotSize = -1;
    // A passada trabalha com a lista que leu e fica presa (ex.: upload com sinal fraco).
    const running = exclusive(async () => {
      snapshotSize = (await store.listPending()).length;
      await pass.promise;
    });
    const enqueued = besideSyncPass(() =>
      enqueueWorkOrderAction(
        store,
        {
          tenantId: 't1',
          workOrderId: 'wo1',
          action: 'start',
          online: true,
          userId: 'u1',
        },
        { randomUuid: () => 'item-1', stashPhoto: async () => 'unused' },
      ),
    );
    // A ação entra na fila sem esperar a passada terminar.
    await expect(enqueued).resolves.toMatchObject({ id: 'item-1', status: 'pending' });
    expect(snapshotSize).toBe(0);
    expect((await store.listPending()).map((i) => i.id)).toEqual(['item-1']);
    pass.resolve();
    await running;
  });

  it('wiping waits for the agent action being enqueued, and later ones wait for the wipe', async () => {
    const order: string[] = [];
    const copying = deferred();
    const first = besideSyncPass(async () => {
      await copying.promise;
      order.push('first');
    });
    const cleared = clearOutbox(async () => {
      order.push('wipe');
    });
    const second = besideSyncPass(async () => {
      order.push('second');
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    copying.resolve();
    await Promise.all([first, cleared, second]);
    expect(order).toEqual(['first', 'wipe', 'second']);
  });

  it('a failed agent action does not block the wipe', async () => {
    await expect(
      besideSyncPass(async () => {
        throw new Error('photo_missing');
      }),
    ).rejects.toThrow('photo_missing');
    let wiped = false;
    await clearOutbox(async () => {
      wiped = true;
    });
    expect(wiped).toBe(true);
  });
});
