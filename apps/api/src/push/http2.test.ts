import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttp2Request } from './http2.js';

let server: http2.Http2Server | undefined;
afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

describe('createHttp2Request', () => {
  it('http2 reuses the session for two requests and reconnects after goaway', async () => {
    const sessions = new Set<http2.ServerHttp2Session>();
    let goawayNext = false;
    server = http2.createServer();
    server.on('session', (s) => sessions.add(s));
    server.on('stream', (stream, _headers) => {
      stream.respond({ ':status': 200 });
      stream.end('{}');
      if (goawayNext) stream.session?.goaway();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/3/device/x`;
    const request = createHttp2Request();

    expect((await request(url, {}, '{}')).status).toBe(200);
    expect((await request(url, {}, '{}')).status).toBe(200);
    expect(sessions.size).toBe(1);

    goawayNext = true;
    expect((await request(url, {}, '{}')).status).toBe(200);
    goawayNext = false;
    // Deixa o goaway chegar ao cliente antes da próxima chamada.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await request(url, {}, '{}')).status).toBe(200);
    expect(sessions.size).toBe(2);
    for (const s of sessions) s.destroy();
  });
});
