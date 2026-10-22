import { beforeEach, describe, expect, it } from 'vitest';
import {
  NetworkError,
  PhotoMissingError,
  backoffMs,
  MAX_UNEXPECTED_ATTEMPTS,
  enqueueWorkOrderAction,
  processOutbox,
} from './outbox';
import { FakeTransport, MemoryOutboxStore, fakeConnection, makeItem } from './test-helpers';

let store: MemoryOutboxStore;
let transport: FakeTransport;
let clock: { now: number; advance(ms: number): void };
let calls: { uploadDurationMs: number | null; sentOffline: boolean }[];

const deps = () => ({
  store,
  transport,
  connection: fakeConnection(calls),
  now: () => clock.now,
});

beforeEach(() => {
  store = new MemoryOutboxStore();
  transport = new FakeTransport();
  calls = [];
  clock = {
    now: 1_000_000,
    advance(ms) {
      this.now += ms;
    },
  };
});

describe('backoffMs', () => {
  it('doubles up to the cap', () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(10)).toBe(300_000);
  });
});

describe('processOutbox', () => {
  it('sends due items in creation order', async () => {
    await store.add(
      makeItem({
        id: 'c',
        createdAt: 3,
        action: 'start',
        photoPaths: [],
        photoKeys: [],
        note: null,
      }),
    );
    await store.add(makeItem({ id: 'a', createdAt: 1, photoPaths: [], photoKeys: [] }));
    await store.add(makeItem({ id: 'b', createdAt: 2, photoPaths: [], photoKeys: [] }));
    const result = await processOutbox(deps());
    expect(result).toEqual({ sent: 3, conflicts: 0, failed: 0, stoppedByNetwork: false });
    expect(transport.sent.map((s) => s.input.clientActionId)).toEqual(['a', 'b', 'c']);
    expect((await store.get('a')).status).toBe('done');
  });

  it('builds the action input with keys, note and connection', async () => {
    const item = makeItem({ createdOffline: true });
    await store.add(item);
    await processOutbox(deps());
    expect(transport.sent[0]).toMatchObject({
      workOrderId: item.workOrderId,
      input: {
        clientActionId: item.id,
        action: 'complete',
        occurredAt: item.occurredAt,
        note: 'Serviço feito',
        photoKeys: ['k1'],
      },
    });
  });

  it('resumes without re-uploading photos', async () => {
    const item = makeItem();
    await store.add(item);
    transport.failNextSendWith(new NetworkError('timeout'));
    await processOutbox(deps());
    expect(await store.get(item.id)).toMatchObject({
      status: 'pending',
      photoKeys: ['k1'],
      attempts: 1,
    });
    clock.advance(backoffMs(1));
    await processOutbox(deps());
    expect(transport.uploads).toEqual([item.photoPaths[0]]);
    expect((await store.get(item.id)).status).toBe('done');
  });

  it('marks conflicts and keeps going', async () => {
    await store.add(makeItem({ id: 'a', createdAt: 1, photoPaths: [], photoKeys: [] }));
    await store.add(makeItem({ id: 'b', createdAt: 2, photoPaths: [], photoKeys: [] }));
    transport.resultNext({ kind: 'conflict', status: 'cancelled' });
    const result = await processOutbox(deps());
    expect(result).toMatchObject({ conflicts: 1, sent: 1 });
    expect((await store.get('a')).status).toBe('conflict');
    expect((await store.get('b')).status).toBe('done');
  });

  it('marks rejected items as failed with the code and keeps going', async () => {
    await store.add(makeItem({ id: 'a', createdAt: 1, photoPaths: [], photoKeys: [] }));
    await store.add(makeItem({ id: 'b', createdAt: 2, photoPaths: [], photoKeys: [] }));
    transport.resultNext({ kind: 'rejected', code: 'photo_invalid' });
    const result = await processOutbox(deps());
    expect(result).toMatchObject({ failed: 1, sent: 1 });
    expect(await store.get('a')).toMatchObject({ status: 'failed', lastError: 'photo_invalid' });
  });

  it('stops at the first network error', async () => {
    await store.add(makeItem({ id: 'a', createdAt: 1, photoPaths: [], photoKeys: [] }));
    await store.add(makeItem({ id: 'b', createdAt: 2, photoPaths: [], photoKeys: [] }));
    transport.failNextSendWith(new NetworkError('offline'));
    const result = await processOutbox(deps());
    expect(result).toEqual({ sent: 0, conflicts: 0, failed: 0, stoppedByNetwork: true });
    expect(transport.sent).toEqual([]);
    expect((await store.get('b')).attempts).toBe(0);
  });

  it('stops on a network error during upload', async () => {
    const item = makeItem();
    await store.add(item);
    transport.failUploadWith(item.photoPaths[0]!, new NetworkError('timeout'));
    const result = await processOutbox(deps());
    expect(result.stoppedByNetwork).toBe(true);
    expect(await store.get(item.id)).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('backs off after a network error', async () => {
    const item = makeItem({ photoPaths: [], photoKeys: [] });
    await store.add(item);
    transport.failNextSendWith(new NetworkError('offline'));
    await processOutbox(deps());
    expect((await processOutbox(deps())).sent).toBe(0);
    expect((await store.get(item.id)).nextAttemptAt).toBe(clock.now + backoffMs(1));
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(10)).toBe(300_000);
  });

  it('resets items left in flight', async () => {
    const item = makeItem({ photoPaths: [], photoKeys: [] });
    await store.add(item);
    await store.update(item.id, { status: 'sending' });
    expect((await processOutbox(deps())).sent).toBe(1);
  });

  it('fails an item whose photo file is gone', async () => {
    const item = makeItem();
    await store.add(item);
    transport.failUploadWith(item.photoPaths[0]!, new PhotoMissingError('sumiu'));
    const result = await processOutbox(deps());
    expect(result.failed).toBe(1);
    expect(await store.get(item.id)).toMatchObject({
      status: 'failed',
      lastError: 'photo_missing',
    });
  });

  it('flags actions created offline', async () => {
    await store.add(makeItem({ createdOffline: true, photoPaths: [], photoKeys: [] }));
    await processOutbox(deps());
    expect(calls).toEqual([{ uploadDurationMs: null, sentOffline: true }]);
  });

  it('sums the upload durations of this run', async () => {
    await store.add(makeItem({ photoPaths: ['/a.jpg', '/b.jpg'], photoKeys: [null, null] }));
    await processOutbox(deps());
    expect(calls).toEqual([{ uploadDurationMs: 200, sentOffline: false }]);
  });
});

describe('enqueueWorkOrderAction', () => {
  const enqueueDeps = {
    randomUuid: () => 'uuid-1',
    stashPhoto: async (id: string, _uri: string, i: number) => `/outbox/${id}/${i}.jpg`,
    now: () => 42,
  };

  it('stores a pending item with stashed photos', async () => {
    const item = await enqueueWorkOrderAction(
      store,
      {
        workOrderId: 'wo',
        action: 'complete',
        note: 'ok ok',
        photoUris: ['file:///tmp/x.jpg'],
        online: false,
      },
      enqueueDeps,
    );
    expect(item).toMatchObject({
      id: 'uuid-1',
      status: 'pending',
      createdOffline: true,
      note: 'ok ok',
      photoPaths: ['/outbox/uuid-1/0.jpg'],
      photoKeys: [null],
      attempts: 0,
      createdAt: 42,
    });
    expect(await store.get('uuid-1')).toEqual(item);
  });
});

describe('strict FIFO and unexpected errors', () => {
  it('does not let a newer item overtake one that is backing off', async () => {
    const mk = (id: string, createdAt: number) =>
      makeItem({ id, createdAt, photoPaths: [], photoKeys: [] });
    await store.add(mk('a', 1));
    await store.add(mk('b', 2));
    transport.failNextSendWith(new NetworkError('offline'));
    await processOutbox(deps());
    const second = await processOutbox(deps());
    expect(second.sent).toBe(0);
    expect(transport.sent).toEqual([]);
    clock.advance(backoffMs(1));
    await processOutbox(deps());
    expect(transport.sent.map((s) => s.input.clientActionId)).toEqual(['a', 'b']);
  });

  it('retries unexpected errors with backoff and then fails the item', async () => {
    await store.add(makeItem({ id: 'a', createdAt: 1, photoPaths: [], photoKeys: [] }));
    await store.add(makeItem({ id: 'b', createdAt: 2, photoPaths: [], photoKeys: [] }));
    for (let i = 1; i < MAX_UNEXPECTED_ATTEMPTS; i++) {
      transport.failNextSendWith(new SyntaxError('html'));
      await processOutbox(deps());
      expect(await store.get('a')).toMatchObject({ status: 'pending', attempts: i });
      expect((await store.get('a')).nextAttemptAt).toBe(clock.now + backoffMs(i));
      expect(transport.sent).toEqual([]);
      clock.advance(backoffMs(i));
    }
    transport.failNextSendWith(new SyntaxError('html'));
    const result = await processOutbox(deps());
    expect(await store.get('a')).toMatchObject({ status: 'failed' });
    expect((await store.get('a')).lastError).toMatch(/^unexpected_error/);
    expect(result).toMatchObject({ failed: 1, sent: 1 });
    expect((await store.get('b')).status).toBe('done');
  });
});
