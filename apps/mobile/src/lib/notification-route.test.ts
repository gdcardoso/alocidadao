import type { MeResponse } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import { planNotificationTap, routeForNotification } from './notification-route';

const TENANT = '66666666-6666-4666-8666-666666666666';
const OTHER_TENANT = '77777777-7777-4777-8777-777777777777';
const REQUEST = '88888888-8888-4888-8888-888888888888';
const WORK_ORDER = '99999999-9999-4999-8999-999999999999';

function makeMe(agentTenants: MeResponse['agentTenants'] = []): MeResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ana Souza',
    phone: '+5511900000001',
    email: null,
    platformRole: null,
    termsAccepted: true,
    agentTenants,
    panelTenants: [],
  } as MeResponse;
}

describe('routeForNotification', () => {
  it('citizen kinds open the request', () => {
    for (const kind of [
      'request_in_progress',
      'request_rejected',
      'request_awaiting_confirmation',
      'request_reopened',
    ]) {
      expect(routeForNotification({ kind, tenantId: TENANT, requestId: REQUEST })).toEqual({
        href: `/solicitacao/${REQUEST}`,
        agent: false,
      });
    }
  });

  it('agent kinds open the work order with the tenant', () => {
    for (const kind of ['work_order_assigned', 'work_order_rework']) {
      expect(routeForNotification({ kind, tenantId: TENANT, workOrderId: WORK_ORDER })).toEqual({
        href: `/agente/atividade/${WORK_ORDER}`,
        tenantId: TENANT,
        agent: true,
      });
    }
  });

  it('unknown or missing ids return null', () => {
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification({ kind: 'occurrence_new', tenantId: TENANT })).toBeNull();
    expect(routeForNotification({ kind: 'something_else', requestId: REQUEST })).toBeNull();
    expect(routeForNotification({ kind: 'request_rejected', tenantId: TENANT })).toBeNull();
    expect(routeForNotification({ kind: 'request_rejected', requestId: 42 })).toBeNull();
    expect(routeForNotification({ kind: 'request_rejected', requestId: '' })).toBeNull();
    // Agente sem prefeitura não sabe onde abrir.
    expect(
      routeForNotification({ kind: 'work_order_assigned', workOrderId: WORK_ORDER }),
    ).toBeNull();
    // Id com barra não vira outro caminho.
    expect(routeForNotification({ kind: 'request_rejected', requestId: '../perfil' })).toBeNull();
  });
});

describe('planNotificationTap', () => {
  const citizen = { href: `/solicitacao/${REQUEST}`, agent: false };
  const agent = { href: `/agente/atividade/${WORK_ORDER}`, tenantId: TENANT, agent: true };

  it('opens a citizen request in citizen mode', () => {
    expect(planNotificationTap(citizen, { me: makeMe(), mode: 'citizen' })).toEqual({
      step: 'open',
      href: citizen.href,
    });
  });

  it('switches an agent to citizen mode before opening a request', () => {
    expect(planNotificationTap(citizen, { me: makeMe(), mode: 'agent' })).toEqual({
      step: 'switch',
      mode: 'citizen',
    });
  });

  it('switches to agent mode for a work order of one of the agent tenants', () => {
    const me = makeMe([{ tenantId: TENANT, tenantName: 'Prefeitura' }]);
    expect(planNotificationTap(agent, { me, mode: 'citizen' })).toEqual({
      step: 'switch',
      mode: 'agent',
    });
    expect(planNotificationTap(agent, { me, mode: 'agent' })).toEqual({
      step: 'open',
      href: agent.href,
    });
  });

  it('ignores a work order of a tenant the person is no longer an agent of', () => {
    const me = makeMe([{ tenantId: OTHER_TENANT, tenantName: 'Outra' }]);
    expect(planNotificationTap(agent, { me, mode: 'agent' })).toEqual({ step: 'drop' });
    expect(planNotificationTap(agent, { me: makeMe(), mode: 'citizen' })).toEqual({
      step: 'drop',
    });
  });

  it('without me (offline start) opens a work order only in agent mode', () => {
    expect(planNotificationTap(agent, { me: null, mode: 'agent' })).toEqual({
      step: 'open',
      href: agent.href,
    });
    expect(planNotificationTap(agent, { me: null, mode: 'citizen' })).toEqual({ step: 'drop' });
  });
});
