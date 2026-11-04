import { createRequestResponseSchema, workOrderActionResultSchema } from '@alocidadao/shared';
import {
  NetworkError,
  UploadRejectedError,
  type OutboxMunicipality,
  type SendActionResult,
  type SendCreateRequestResult,
} from './outbox';

/** Tempo esgotado no servidor (408) e limite de pedidos (429): tenta de novo com espera. */
const RETRY_STATUSES = [408, 429];

/**
 * 403 `terms_required`: a conta ainda não aceitou os Termos. Passa quando a pessoa aceitar,
 * então o item espera na fila como no 401 (nunca vira recusado).
 */
function throwIfTermsRequired(status: number, bodyText: string): void {
  if (status !== 403) return;
  const json = parseJson(bodyText);
  if ((json as { code?: unknown } | undefined)?.code === 'terms_required') {
    throw new NetworkError('terms_required');
  }
}

function parseJson(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

/** Traduz a resposta de POST /agent/work-orders/:id/actions. Puro e testável. */
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
  // Token recusado (vencido ou sessão encerrada): o item espera um novo login na fila.
  if (status === 401) throw new NetworkError('unauthorized');
  throwIfTermsRequired(status, bodyText);
  if (RETRY_STATUSES.includes(status)) throw new NetworkError(`http_${status}`);
  // Qualquer outro 4xx não melhora com nova tentativa: recusa e segue a fila. Inclui 404
  // `work_order_not_found` (a atividade pode ter sido concluída ou cancelada no meio do caminho),
  // 403 `not_a_member` (vínculo encerrado) e 409 `photo_already_used`, que a fila marca como
  // recusados (`ACTION_REJECTION_CODES`).
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
  if (status === 401) throw new NetworkError('unauthorized');
  throwIfTermsRequired(status, bodyText);
  if (RETRY_STATUSES.includes(status)) throw new NetworkError(`uploads_${status}`);
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

function readMunicipality(value: unknown): OutboxMunicipality | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Partial<OutboxMunicipality>;
  if (typeof m.ibgeCode !== 'string' || typeof m.name !== 'string' || typeof m.state !== 'string') {
    return null;
  }
  return { ibgeCode: m.ibgeCode, name: m.name, state: m.state };
}

/** Traduz a resposta de POST /citizen/requests. Puro e testável. */
export function mapCreateRequestResponse(
  status: number,
  bodyText: string,
): SendCreateRequestResult {
  const json = parseJson(bodyText);
  const body = (typeof json === 'object' && json !== null ? json : {}) as {
    code?: string;
    municipality?: unknown;
  };
  if (status === 200 || status === 201) {
    // 201 criada, 200 repetição do mesmo envio. HTML de portal cativo não confirma nada.
    const parsed = createRequestResponseSchema.safeParse(json);
    if (!parsed.success) throw new NetworkError('invalid_create_response');
    return { kind: 'ok', result: parsed.data };
  }
  if (status === 401) throw new NetworkError('unauthorized');
  throwIfTermsRequired(status, bodyText);
  if (RETRY_STATUSES.includes(status)) throw new NetworkError(`http_${status}`);
  if (status === 409 && body.code === 'occurrence_unavailable') {
    return { kind: 'occurrence_unavailable' };
  }
  if (status === 422 && body.code === 'municipality_not_served') {
    return { kind: 'rejected', code: body.code, municipality: readMunicipality(body.municipality) };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'rejected', code: body.code ?? `http_${status}` };
  }
  throw new NetworkError(`http_${status}`);
}
