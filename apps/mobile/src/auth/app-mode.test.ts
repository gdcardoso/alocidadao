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
  resolveMode,
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

    // App aberto sem rede (sem `me`): vale o último modo guardado neste aparelho.
    expect(resolveMode(null, parseStoredMode(storedModeValue('agent', USER), null))).toBe('agent');
    expect(resolveMode(null, null)).toBe('citizen');
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

  it('home route follows the mode', () => {
    expect(homeFor('agent')).toBe('/(app)/agente/(tabs)/atividades');
    expect(homeFor('citizen')).toBe('/(app)/(tabs)/solicitacoes');
    expect(AGENT_HOME_ROUTE).toBe(homeFor('agent'));
    expect(CITIZEN_HOME_ROUTE).toBe(homeFor('citizen'));
  });
});
