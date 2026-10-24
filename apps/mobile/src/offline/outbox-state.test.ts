import { describe, expect, it } from 'vitest';
import {
  clearOutbox,
  exclusive,
  forgetSentRequests,
  getOutboxSnapshot,
  rememberSentRequests,
  setOutboxItems,
  subscribeOutbox,
} from './outbox-state';
import { makeRequestItem } from './test-helpers';

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
});
