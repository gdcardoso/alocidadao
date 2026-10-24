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

/**
 * Modo gravado, se é da pessoa logada. Outra pessoa no mesmo aparelho começa do zero. Sem o id
 * (app aberto sem rede, mesma sessão de antes), vale o que estiver gravado.
 */
export function parseStoredMode(raw: string | null, userId: string | null): AppMode | null {
  if (!raw) return null;
  const sep = raw.indexOf(':');
  const mode = sep < 0 ? raw : raw.slice(0, sep);
  const owner = sep < 0 ? null : raw.slice(sep + 1);
  if (mode !== 'agent' && mode !== 'citizen') return null;
  if (userId !== null && owner !== userId) return null;
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
