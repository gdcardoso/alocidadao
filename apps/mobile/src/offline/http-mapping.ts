import { workOrderActionResultSchema } from '@alocidadao/shared';
import { NetworkError, UploadRejectedError, type SendActionResult } from './outbox';

function parseJson(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

/** Traduz a resposta de POST /dev/work-orders/:id/actions. Puro e testável. */
export function mapActionResponse(status: number, bodyText: string): SendActionResult {
  const json = parseJson(bodyText);
  const body = (typeof json === 'object' && json !== null ? json : {}) as {
    code?: string;
    status?: string;
  };
  if (status === 200) {
    // Portal cativo ou proxy devolvem 200 com HTML: não é confirmação do servidor.
    if (!workOrderActionResultSchema.safeParse(json).success) {
      throw new NetworkError('invalid_action_response');
    }
    return { kind: 'ok' };
  }
  if (status === 409 && body.code === 'work_order_unavailable') {
    return { kind: 'conflict', status: body.status ?? 'unknown' };
  }
  // Qualquer outro 4xx não melhora com nova tentativa: recusa e segue a fila.
  if (status >= 400 && status < 500) {
    const fallback =
      status === 404 ? 'not_found' : status === 409 ? 'client_action_conflict' : `http_${status}`;
    return { kind: 'rejected', code: body.code ?? fallback };
  }
  // 3xx, 5xx (inclusive 503) e o que não for JSON: tenta de novo com espera.
  throw new NetworkError(`http_${status}`);
}

export interface Presign {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export function parsePresignResponse(status: number, bodyText: string): Presign {
  if (status >= 400 && status < 500) {
    const json = parseJson(bodyText);
    const code =
      typeof json === 'object' &&
      json !== null &&
      typeof (json as { code?: unknown }).code === 'string'
        ? (json as { code: string }).code
        : `uploads_${status}`;
    throw new UploadRejectedError(code);
  }
  if (status !== 200) throw new NetworkError(`uploads_${status}`);
  const json = parseJson(bodyText) as Partial<Presign> | undefined;
  const headers = json?.headers;
  if (
    !json ||
    typeof json.key !== 'string' ||
    typeof json.url !== 'string' ||
    typeof headers !== 'object' ||
    headers === null ||
    Object.values(headers).some((v) => typeof v !== 'string')
  ) {
    throw new NetworkError('invalid_presign_response');
  }
  return { key: json.key, url: json.url, headers };
}
