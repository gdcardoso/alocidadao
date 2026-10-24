import type { MeResponse } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import {
  AGENT_ACCESS_ENDED_NOTICE,
  AGENT_HOME_ROUTE,
  CITIZEN_HOME_ROUTE,
  hasAgentRole,
  homeFor,
  modeAfterMeUpdate,
  parseStoredMode,
  profileRouteFor,
  resolveMode,
  startMode,
  storedModeValue,
} from './app-mode';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TENANT = '66666666-6666-4666-8666-666666666666';

function makeMe(over: Partial<MeResponse> = {}): MeResponse {
  return {
    id: USER,
    name: 'Ana Souza',
    phone: '+5511900000001',
    email: null,
    platformRole: null,
    agentTenants: [],
    panelTenants: [],
    ...over,
  };
}

const citizen = makeMe();
const agent = makeMe({ agentTenants: [{ tenantId: TENANT, tenantName: 'Prefeitura Teste' }] });

describe('app mode', () => {
  it('citizen without agent role is always citizen', () => {
    expect(hasAgentRole(citizen)).toBe(false);
    expect(resolveMode(citizen, null)).toBe('citizen');
    expect(resolveMode(citizen, 'citizen')).toBe('citizen');
    // Um modo agente guardado (ex.: vínculo encerrado com o app fechado) é ignorado.
    expect(resolveMode(citizen, 'agent')).toBe('citizen');
  });

  it('agent starts in agent mode and keeps the last mode', () => {
    expect(hasAgentRole(agent)).toBe(true);
    expect(resolveMode(agent, null)).toBe('agent');
    expect(resolveMode(agent, 'agent')).toBe('agent');
    expect(resolveMode(agent, 'citizen')).toBe('citizen');

    // O modo guardado é da pessoa que o escolheu.
    const stored = storedModeValue('citizen', USER);
    expect(parseStoredMode(stored, USER)).toBe('citizen');
    expect(parseStoredMode(stored, OTHER)).toBeNull();
    expect(resolveMode(makeMe({ ...agent, id: OTHER }), parseStoredMode(stored, OTHER))).toBe(
      'agent',
    );
    expect(parseStoredMode(null, USER)).toBeNull();
    expect(parseStoredMode('lixo', USER)).toBeNull();

    // Sem dono conhecido, o valor gravado não vale.
    expect(parseStoredMode(stored, null)).toBeNull();

    // App aberto sem rede (sem `me`): vale o último modo da pessoa dona da fila.
    expect(startMode({ raw: storedModeValue('agent', USER), me: null, outboxOwner: USER })).toEqual(
      { mode: 'agent', agentAccessEnded: false },
    );
    expect(startMode({ raw: null, me: null, outboxOwner: USER })).toEqual({
      mode: 'citizen',
      agentAccessEnded: false,
    });
    expect(startMode({ raw: null, me: agent, outboxOwner: USER })).toEqual({
      mode: 'agent',
      agentAccessEnded: false,
    });
  });

  it('losing the agent role switches to citizen mode with the notice', () => {
    expect(modeAfterMeUpdate('agent', citizen)).toEqual({
      mode: 'citizen',
      agentAccessEnded: true,
    });
    expect(AGENT_ACCESS_ENDED_NOTICE).toBe('Seu acesso como agente foi encerrado pela prefeitura.');
    // Sem mudança: segue no modo atual, sem aviso.
    expect(modeAfterMeUpdate('agent', agent)).toEqual({ mode: 'agent', agentAccessEnded: false });
    expect(modeAfterMeUpdate('citizen', agent)).toEqual({
      mode: 'citizen',
      agentAccessEnded: false,
    });
    expect(modeAfterMeUpdate('citizen', citizen)).toEqual({
      mode: 'citizen',
      agentAccessEnded: false,
    });
    // Sem `me` (sem rede) não se sabe do vínculo: o modo fica.
    expect(modeAfterMeUpdate('agent', null)).toEqual({ mode: 'agent', agentAccessEnded: false });
  });

  it('offline start ignores the mode saved by another person', () => {
    // A (agente) saiu e deixou "agent:A"; B (cidadão) entrou e abre o app sem rede.
    expect(
      startMode({ raw: storedModeValue('agent', OTHER), me: null, outboxOwner: USER }),
    ).toEqual({ mode: 'citizen', agentAccessEnded: false });
    // Sem dono da fila também não vale.
    expect(
      startMode({ raw: storedModeValue('agent', OTHER), me: null, outboxOwner: null }),
    ).toEqual({ mode: 'citizen', agentAccessEnded: false });
  });

  it('agent mode saved by the same person ends with the notice when the role is gone', () => {
    expect(
      startMode({ raw: storedModeValue('agent', USER), me: citizen, outboxOwner: USER }),
    ).toEqual({ mode: 'citizen', agentAccessEnded: true });
    // O modo agente de outra pessoa não gera aviso.
    expect(
      startMode({ raw: storedModeValue('agent', OTHER), me: citizen, outboxOwner: USER }),
    ).toEqual({ mode: 'citizen', agentAccessEnded: false });
  });

  it('home route follows the mode', () => {
    expect(homeFor('agent')).toBe('/(app)/agente/(tabs)/atividades');
    expect(homeFor('citizen')).toBe('/(app)/(tabs)/solicitacoes');
    expect(AGENT_HOME_ROUTE).toBe(homeFor('agent'));
    expect(CITIZEN_HOME_ROUTE).toBe(homeFor('citizen'));
    expect(profileRouteFor('agent')).toBe('/(app)/agente/(tabs)/perfil');
    expect(profileRouteFor('citizen')).toBe('/(app)/(tabs)/perfil');
  });
});
