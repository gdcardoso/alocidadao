import type { MeResponse } from '@alocidadao/shared';

// Modo do app (agente ou cidadão), sem nada nativo (testável em Node).

export type AppMode = 'agent' | 'citizen';

/** Chave do SecureStore com o último modo usado. Não é apagada ao sair. */
export const APP_MODE_KEY = 'app-mode';

/**
 * Telas iniciais de cada modo. Ficam fora de "/": o `index` da raiz redireciona pela sessão, e
 * a tela inicial lá criaria um laço de redirecionamento.
 */
export const AGENT_HOME_ROUTE = '/(app)/agente/(tabs)/atividades';
export const CITIZEN_HOME_ROUTE = '/(app)/(tabs)/solicitacoes';

/** Aviso mostrado uma vez na lista do cidadão depois da troca automática. */
export const AGENT_ACCESS_ENDED_NOTICE = 'Seu acesso como agente foi encerrado pela prefeitura.';

export function hasAgentRole(me: Pick<MeResponse, 'agentTenants'>): boolean {
  return me.agentTenants.length > 0;
}

/**
 * Modo ao abrir ou entrar. Sem vínculo de agente, sempre cidadão; com vínculo, o último modo
 * usado (na primeira vez, agente). Sem `me` (app aberto sem rede), o último modo guardado.
 */
export function resolveMode(me: MeResponse | null, stored: AppMode | null): AppMode {
  if (!me) return stored ?? 'citizen';
  if (!hasAgentRole(me)) return 'citizen';
  return stored ?? 'agent';
}

export function homeFor(mode: AppMode): typeof AGENT_HOME_ROUTE | typeof CITIZEN_HOME_ROUTE {
  return mode === 'agent' ? AGENT_HOME_ROUTE : CITIZEN_HOME_ROUTE;
}

/** Valor gravado: o modo e de quem ele é (`agent:{userId}`). */
export function storedModeValue(mode: AppMode, userId: string): string {
  return `${mode}:${userId}`;
}

/** Perfil de cada modo (volta das telas de edição do perfil). */
export function profileRouteFor(
  mode: AppMode,
): '/(app)/agente/(tabs)/perfil' | '/(app)/(tabs)/perfil' {
  return mode === 'agent' ? '/(app)/agente/(tabs)/perfil' : '/(app)/(tabs)/perfil';
}

/**
 * Modo gravado, se é da pessoa logada (`userId`). Outra pessoa no mesmo aparelho começa do
 * zero; sem dono conhecido, nada vale.
 */
export function parseStoredMode(raw: string | null, userId: string | null): AppMode | null {
  if (!raw || userId === null) return null;
  const sep = raw.indexOf(':');
  const mode = sep < 0 ? raw : raw.slice(0, sep);
  const owner = sep < 0 ? null : raw.slice(sep + 1);
  if (mode !== 'agent' && mode !== 'citizen') return null;
  if (owner !== userId) return null;
  return mode;
}

/**
 * `me` atualizado: no modo agente sem vínculo (encerrado pela prefeitura), volta ao modo
 * cidadão com o aviso. Sem `me` não se sabe do vínculo e nada muda.
 */
export function modeAfterMeUpdate(
  mode: AppMode,
  me: MeResponse | null,
): { mode: AppMode; agentAccessEnded: boolean } {
  if (mode === 'agent' && me && !hasAgentRole(me)) {
    return { mode: 'citizen', agentAccessEnded: true };
  }
  return { mode, agentAccessEnded: false };
}

/**
 * Modo ao abrir ou entrar. A pessoa é a de `me` ou, sem `me` (app aberto sem rede), a dona da
 * fila offline (`OUTBOX_OWNER_KEY`, que a abertura sem rede mantém). O aviso de vínculo
 * encerrado aparece quando o último modo dela era o de agente e o vínculo acabou com o app
 * fechado.
 */
export function startMode({
  raw,
  me,
  outboxOwner,
}: {
  raw: string | null;
  me: MeResponse | null;
  outboxOwner: string | null;
}): { mode: AppMode; agentAccessEnded: boolean } {
  const stored = parseStoredMode(raw, me?.id ?? outboxOwner);
  const after = modeAfterMeUpdate(stored ?? 'citizen', me);
  if (after.agentAccessEnded) return after;
  return { mode: resolveMode(me, stored), agentAccessEnded: false };
}
