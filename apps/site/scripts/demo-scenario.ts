/**
 * Cenário da demo para as capturas do site: um cidadão do seed de Goiânia relata um buraco no
 * Setor Bueno com foto, o gestor encaminha para a equipe, o agente conclui com a foto do serviço
 * feito, o gestor publica e o cidadão confirma. Tudo pelas rotas normais da API local (login com o
 * código fixo de desenvolvimento), sem mexer no seed.
 *
 * Uso: `pnpm --filter @alocidadao/site demo:scenario` com a API local no ar e o seed de Goiânia
 * carregado (`pnpm db:seed:dev`). Variáveis opcionais:
 * - `API_URL` (padrão `http://localhost:3333`);
 * - `DEV_CODE` (padrão `123456`, o `AUTH_DEV_FIXED_CODE` do `.env` da API);
 * - `S3_UPLOAD_ENDPOINT` (padrão `http://localhost:9000`): para onde vão as fotos quando a API
 *   assina as URLs com o endereço do emulador (`S3_PUBLIC_ENDPOINT=http://10.0.2.2:9000`).
 *
 * Cada execução cria uma solicitação nova. O login por código tem intervalo de reenvio: rodar de
 * novo logo em seguida pode responder 429; espere um minuto.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import {
  TERMS_VERSION,
  assignResponseSchema,
  challengeResponseSchema,
  createRequestResponseSchema,
  locateResponseSchema,
  meResponseSchema,
  panelChallengeResponseSchema,
  panelSessionResponseSchema,
  phoneVerifyResponseSchema,
  requestCardSchema,
  requestDetailSchema,
  reviewDetailSchema,
  teamOptionsResponseSchema,
  triageResponseSchema,
  uploadResponseSchema,
  workOrderActionResultSchema,
  workOrderResultSchema,
  type ConnectionContext,
  type GeoPoint,
} from '@alocidadao/shared';
import { uploadTarget } from './upload-target.js';

const API_URL = process.env.API_URL ?? 'http://localhost:3333';
const DEV_CODE = process.env.DEV_CODE ?? '123456';
const S3_UPLOAD_ENDPOINT = process.env.S3_UPLOAD_ENDPOINT ?? 'http://localhost:9000';

// Contas do seed (packages/db/src/seed-dev-data.ts): nomes fictícios, nenhum dado real.
const CITIZEN_PHONE = '+5511900000002';
const AGENT_PHONE = '+5511900000001';
const MANAGER_CPF = '52998224725';
const CATEGORY_NAME = 'Buraco na via';
const TEAM_NAME = 'Equipe Obras – Centro';

/** Ponto no Setor Bueno, Goiânia (o mesmo bairro do cartão "Novo relato" da página). */
const POINT: GeoPoint = { lat: -16.7062, lng: -49.2671 };
const ADDRESS = 'Avenida T-4, Setor Bueno, Goiânia';

const PHOTOS_DIR = fileURLToPath(new URL('../public/img/fotos/', import.meta.url));
const BEFORE_PHOTO = `${PHOTOS_DIR}buraco-antes.jpg`;
const AFTER_PHOTO = `${PHOTOS_DIR}asfalto-depois.jpg`;

const CONNECTION: ConnectionContext = {
  networkType: 'wifi',
  cellularGeneration: null,
  apiLatencyMs: null,
  uploadDurationMs: null,
  sentOffline: false,
};

interface Call {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  tenantId?: string;
}

async function api(path: string, { method = 'GET', body, token, tenantId }: Call = {}) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} respondeu ${response.status}: ${text.slice(0, 300)}`);
  }
  return text === '' ? null : (JSON.parse(text) as unknown);
}

/** Envia o JPEG para a URL assinada (PUT), mantendo o `Host` com que ela foi assinada. */
async function putPhoto(signedUrl: string, headers: Record<string, string>, file: string) {
  const data = await readFile(file);
  const target = uploadTarget(signedUrl, S3_UPLOAD_ENDPOINT);
  const send = target.url.startsWith('https:') ? httpsRequest : httpRequest;
  await new Promise<void>((resolve, reject) => {
    const req = send(
      target.url,
      {
        method: 'PUT',
        headers: { ...headers, Host: target.host, 'Content-Length': String(data.length) },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          res.statusCode && res.statusCode < 300
            ? resolve()
            : reject(new Error(`Envio da foto respondeu ${res.statusCode}`)),
        );
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

/** Login do app pelo celular com o código fixo; aceita os termos se a conta ainda não aceitou. */
async function appLogin(phone: string): Promise<string> {
  const challenge = challengeResponseSchema.parse(
    await api('/auth/phone/start', { method: 'POST', body: { phone } }),
  );
  const verified = phoneVerifyResponseSchema.parse(
    await api('/auth/phone/verify', {
      method: 'POST',
      body: {
        challengeId: challenge.challengeId,
        code: DEV_CODE,
        device: { installationId: randomUUID(), platform: 'ios', appVersion: 'demo' },
      },
    }),
  );
  if (verified.status !== 'signed_in') {
    throw new Error(`Login de ${phone} não entrou direto (${verified.status}); rode o seed.`);
  }
  const token = verified.session.accessToken;
  await acceptTermsIfNeeded(token);
  return token;
}

async function acceptTermsIfNeeded(token: string) {
  const me = meResponseSchema.parse(await api('/me', { token }));
  if (me.termsAccepted) return me;
  await api('/me/terms', {
    method: 'POST',
    token,
    body: { acceptedTermsVersion: TERMS_VERSION },
  });
  return me;
}

/** Login do painel pelo CPF do gestor do seed, com o código fixo. */
async function panelLogin(): Promise<{ token: string; tenantId: string }> {
  const challenge = panelChallengeResponseSchema.parse(
    await api('/auth/panel/start', { method: 'POST', body: { cpf: MANAGER_CPF } }),
  );
  const { session } = panelSessionResponseSchema.parse(
    await api('/auth/panel/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: DEV_CODE },
    }),
  );
  const me = await acceptTermsIfNeeded(session.accessToken);
  const tenant = me.panelTenants.find((item) => item.tenantName === 'Prefeitura de Goiânia');
  if (!tenant) throw new Error('O gestor do seed não está na Prefeitura de Goiânia.');
  return { token: session.accessToken, tenantId: tenant.tenantId };
}

async function main() {
  console.log(`API: ${API_URL}`);

  // Os três logins vêm antes de tudo: se um falhar (ex.: 429 do reenvio de código), nenhuma
  // solicitação fica pela metade.
  const panel = await panelLogin();
  const citizen = await appLogin(CITIZEN_PHONE);
  const agent = await appLogin(AGENT_PHONE);

  // 1. Cidadão relata o buraco com a foto "antes".
  const located = locateResponseSchema.parse(
    await api(`/citizen/locate?lat=${POINT.lat}&lng=${POINT.lng}`, { token: citizen }),
  );
  if (located.status !== 'served') throw new Error('O ponto da demo não é atendido em Goiânia.');
  const category = located.categories.find((item) => item.name === CATEGORY_NAME);
  if (!category) throw new Error(`Categoria "${CATEGORY_NAME}" não encontrada.`);

  const citizenUpload = uploadResponseSchema.parse(
    await api('/citizen/uploads', { method: 'POST', token: citizen }),
  );
  await putPhoto(citizenUpload.url, citizenUpload.headers, BEFORE_PHOTO);
  const created = createRequestResponseSchema.parse(
    await api('/citizen/requests', {
      method: 'POST',
      token: citizen,
      body: {
        clientActionId: randomUUID(),
        categoryId: category.id,
        description: 'Buraco grande na pista, perto da faixa de pedestres.',
        occurredAt: new Date().toISOString(),
        gpsLocation: POINT,
        location: POINT,
        address: ADDRESS,
        photoKeys: [citizenUpload.key],
        connection: CONNECTION,
      },
    }),
  );
  console.log(`Solicitação criada: ${created.protocol}`);

  // 2. Gestor encaminha a ocorrência para a equipe de obras.
  const triage = triageResponseSchema.parse(
    await api('/panel/triage', { token: panel.token, tenantId: panel.tenantId }),
  );
  const row = triage.items.find((item) => item.protocol === created.protocol);
  if (!row) throw new Error(`Ocorrência ${created.protocol} não apareceu na triagem.`);
  const teams = teamOptionsResponseSchema.parse(
    await api(`/panel/occurrences/${row.occurrenceId}/teams`, {
      token: panel.token,
      tenantId: panel.tenantId,
    }),
  );
  const teamId = teams.items.find((team) => team.name === TEAM_NAME)?.id ?? teams.suggestedTeamId;
  if (!teamId) throw new Error('Nenhuma equipe para a ocorrência.');
  const assigned = assignResponseSchema.parse(
    await api(`/panel/occurrences/${row.occurrenceId}/assign`, {
      method: 'POST',
      token: panel.token,
      tenantId: panel.tenantId,
      body: {
        teamId,
        dueDate: teams.defaultDueDate,
        instructions: 'Tapar o buraco e sinalizar a pista.',
      },
    }),
  );
  const workOrderId = assigned.workOrderId;
  console.log(`Encaminhada para a equipe (atividade ${workOrderId}).`);

  // 3. Agente inicia e conclui com a foto "depois".
  const agentCall = { method: 'POST' as const, token: agent, tenantId: panel.tenantId };
  const action = async (body: Record<string, unknown>) =>
    workOrderActionResultSchema.parse(
      await api(`/agent/work-orders/${workOrderId}/actions`, {
        ...agentCall,
        body: {
          clientActionId: randomUUID(),
          occurredAt: new Date().toISOString(),
          location: { ...POINT, accuracyM: 8 },
          connection: CONNECTION,
          ...body,
        },
      }),
    );
  await action({ action: 'start', photoKeys: [] });
  const agentUpload = uploadResponseSchema.parse(await api('/agent/uploads', agentCall));
  await putPhoto(agentUpload.url, agentUpload.headers, AFTER_PHOTO);
  const done = await action({
    action: 'complete',
    note: 'Buraco tapado com asfalto novo e pista liberada.',
    photoKeys: [agentUpload.key],
  });
  console.log(`Agente concluiu (situação: ${done.status}).`);

  // 4. Gestor publica a conclusão com a foto do agente.
  if (done.status === 'awaiting_review') {
    const review = reviewDetailSchema.parse(
      await api(`/panel/reviews/${workOrderId}`, { token: panel.token, tenantId: panel.tenantId }),
    );
    const published = workOrderResultSchema.parse(
      await api(`/panel/work-orders/${workOrderId}/publish`, {
        method: 'POST',
        token: panel.token,
        tenantId: panel.tenantId,
        body: {
          publicNote: 'Buraco tapado com asfalto novo. Obrigado pelo aviso!',
          publishedPhotoIds: review.pendingPhotos.map((photo) => photo.id),
        },
      }),
    );
    console.log(`Gestor publicou (situação: ${published.status}).`);
  }

  // 5. Cidadão confirma que o serviço foi feito.
  let detail = requestDetailSchema.parse(
    await api(`/citizen/requests/${created.requestId}`, { token: citizen }),
  );
  if (detail.status === 'awaiting_confirmation') {
    requestCardSchema.parse(
      await api(`/citizen/requests/${created.requestId}/confirm`, {
        method: 'POST',
        token: citizen,
        body: { clientActionId: randomUUID() },
      }),
    );
    detail = requestDetailSchema.parse(
      await api(`/citizen/requests/${created.requestId}`, { token: citizen }),
    );
  }
  console.log(`Pronto: solicitação ${created.protocol} na situação "${detail.status}".`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
