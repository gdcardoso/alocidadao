import { workOrderActionResultSchema } from '@alocidadao/shared';
import { NetworkError, type SendActionResult } from './outbox';

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
  if (status >= 300 && status < 400) throw new NetworkError(`redirect_${status}`);
  switch (status) {
    case 409:
      if (body.code === 'work_order_unavailable') {
        return { kind: 'conflict', status: body.status ?? 'unknown' };
      }
      return { kind: 'rejected', code: body.code ?? 'client_action_conflict' };
    case 422:
      return { kind: 'rejected', code: body.code ?? 'photo_invalid' };
    case 404:
      return { kind: 'rejected', code: 'not_found' };
    case 401:
      return { kind: 'rejected', code: 'unauthorized' };
    case 503:
      return { kind: 'rejected', code: body.code ?? 'unavailable' };
    default:
      throw new NetworkError(`http_${status}`);
  }
}

export interface Presign {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export function parsePresignResponse(status: number, bodyText: string): Presign {
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
