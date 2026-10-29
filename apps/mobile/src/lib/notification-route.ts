import {
  AGENT_PUSH_KINDS,
  CITIZEN_PUSH_KINDS,
  type MeResponse,
  type NotificationKind,
} from '@alocidadao/shared';
import type { AppMode } from '../auth/app-mode';

// Para onde leva o toque no push, sem nada nativo (testável em Node).

export interface NotificationRoute {
  href: string;
  /** Prefeitura da atividade (só nos avisos do agente). */
  tenantId?: string;
  /** Abre no modo agente. */
  agent: boolean;
}

/** Id que vira parte do caminho: só letras, números e hífen (uuid), nunca outro caminho. */
const SAFE_ID = /^[A-Za-z0-9-]+$/;

function idFrom(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

const isIn = (kinds: readonly NotificationKind[], kind: unknown) =>
  typeof kind === 'string' && (kinds as readonly string[]).includes(kind);

/**
 * Dados escondidos do push (`kind`, `tenantId` e `requestId` ou `workOrderId`) → tela. Cidadão:
 * detalhe da solicitação; agente: detalhe da atividade, com a prefeitura. Outro tipo ou id
 * faltando: `null` (o toque só abre o app).
 */
export function routeForNotification(data: Record<string, unknown>): NotificationRoute | null {
  if (isIn(CITIZEN_PUSH_KINDS, data.kind)) {
    const requestId = idFrom(data.requestId);
    return requestId ? { href: `/solicitacao/${requestId}`, agent: false } : null;
  }
  if (isIn(AGENT_PUSH_KINDS, data.kind)) {
    const workOrderId = idFrom(data.workOrderId);
    const tenantId = idFrom(data.tenantId);
    if (!workOrderId || !tenantId) return null;
    return { href: `/agente/atividade/${workOrderId}`, tenantId, agent: true };
  }
  return null;
}

export type NotificationTapStep =
  { step: 'open'; href: string } | { step: 'switch'; mode: AppMode } | { step: 'drop' };

/**
 * Próximo passo do toque com a sessão pronta. O modo agente vale para todas as prefeituras de
 * `me.agentTenants` (a atividade é buscada na prefeitura dela): a "troca de prefeitura" é
 * conferir que a pessoa ainda é agente da prefeitura do aviso e passar ao modo agente. Sem o
 * vínculo, o toque é ignorado (fica a tela inicial). Sem `me` (aberto sem rede) não se sabe do
 * vínculo: a atividade só abre se o app já está no modo agente.
 */
export function planNotificationTap(
  route: NotificationRoute,
  { me, mode }: { me: MeResponse | null; mode: AppMode },
): NotificationTapStep {
  const target: AppMode = route.agent ? 'agent' : 'citizen';
  if (route.agent) {
    const member = me
      ? me.agentTenants.some((t) => t.tenantId === route.tenantId)
      : mode === 'agent';
    if (!member) return { step: 'drop' };
  }
  if (mode !== target) return { step: 'switch', mode: target };
  return { step: 'open', href: route.href };
}
