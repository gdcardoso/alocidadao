import type { AgentWorkOrderCard, AgentWorkOrderDetail } from '@alocidadao/shared';

// Só para testes: cartões e detalhes de atividade do agente.

export const TENANT_A = '66666666-6666-4666-8666-666666666666';
export const TENANT_B = '77777777-7777-4777-8777-777777777777';

/** Id de atividade a partir de um número (`wo(1)`). */
export const wo = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function makeCard(over: Partial<AgentWorkOrderCard> = {}): AgentWorkOrderCard {
  return {
    id: wo(1),
    tenantId: TENANT_A,
    status: 'assigned',
    protocol: '2026-000123',
    categoryName: 'Buraco na via',
    categoryIcon: 'construction',
    categoryGroup: 'infrastructure',
    address: 'Rua das Flores, 120',
    location: { lat: -23.55, lng: -46.63 },
    teamName: 'Equipe Obras · Centro',
    reportCount: 6,
    dueAt: null,
    assignedAt: '2026-10-24T10:00:00.000Z',
    statusChangedAt: '2026-10-24T10:00:00.000Z',
    ...over,
  };
}

export function makeDetail(over: Partial<AgentWorkOrderDetail> = {}): AgentWorkOrderDetail {
  return {
    ...makeCard(over),
    managerInstructions: 'Sinalizar a área.',
    assignedBy: { name: 'Carlos', departmentName: 'Obras' },
    reports: [{ description: 'Buraco grande', createdAt: '2026-10-23T10:00:00.000Z' }],
    photos: [],
    citizenCount: 6,
    rework: null,
    previousNote: null,
    ...over,
  };
}
