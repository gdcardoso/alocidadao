import http2 from 'node:http2';

export type Http2Request = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; body: string }>;

const TIMEOUT_MS = 10_000;

/** Uma sessão HTTP/2 por origem, reaproveitada e recriada se fechar ou der erro. */
export function createHttp2Request(): Http2Request {
  const sessions = new Map<string, http2.ClientHttp2Session>();

  function sessionFor(origin: string): http2.ClientHttp2Session {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = http2.connect(origin);
    const drop = () => {
      if (sessions.get(origin) === session) sessions.delete(origin);
    };
    session.on('error', drop);
    session.on('close', drop);
    session.on('goaway', drop);
    session.unref();
    sessions.set(origin, session);
    return session;
  }

  return (url, headers, body) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const session = sessionFor(target.origin);
      const stream = session.request({
        ':method': 'POST',
        ':path': target.pathname + target.search,
        ...headers,
      });
      let status = 0;
      const chunks: Buffer[] = [];
      stream.setTimeout(TIMEOUT_MS, () => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error('timeout'));
      });
      stream.on('response', (h) => {
        status = Number(h[':status']);
      });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
      stream.end(body);
    });
}
