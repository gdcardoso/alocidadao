import { describe, expect, it } from 'vitest';
import {
  agentUpdateBodySchema,
  categoryCreateBodySchema,
  categoryUpdateBodySchema,
  managerCreateBodySchema,
  managerUpdateBodySchema,
  teamCreateBodySchema,
} from './panel-admin.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('teamCreateBodySchema', () => {
  it('team body turns a blank address into null', () => {
    const body = teamCreateBodySchema.parse({
      name: '  Equipe Sul ',
      departmentId: ID,
      baseAddress: '   ',
      baseLocation: null,
    });
    expect(body.name).toBe('Equipe Sul');
    expect(body.baseAddress).toBeNull();
    const withAddress = teamCreateBodySchema.parse({
      name: 'Equipe Sul',
      departmentId: ID,
      baseAddress: ' Rua A, 1 ',
      baseLocation: { lat: -23.5, lng: -46.6 },
    });
    expect(withAddress.baseAddress).toBe('Rua A, 1');
    expect(
      teamCreateBodySchema.safeParse({
        name: 'A',
        departmentId: ID,
        baseAddress: null,
        baseLocation: null,
      }).success,
    ).toBe(false);
  });
});

describe('agentUpdateBodySchema', () => {
  it('agent update is discriminated by action', () => {
    expect(
      agentUpdateBodySchema.safeParse({ action: 'change_phone', phone: '+5511988771020' }).success,
    ).toBe(true);
    expect(
      agentUpdateBodySchema.safeParse({ action: 'change_phone', phone: '+551134567890' }).success,
    ).toBe(false);
    expect(agentUpdateBodySchema.safeParse({ action: 'move', teamId: ID }).success).toBe(true);
    expect(agentUpdateBodySchema.safeParse({ action: 'move' }).success).toBe(false);
    expect(agentUpdateBodySchema.safeParse({ action: 'deactivate' }).success).toBe(true);
    expect(agentUpdateBodySchema.safeParse({ action: 'reactivate' }).success).toBe(true);
    expect(agentUpdateBodySchema.safeParse({ action: 'delete' }).success).toBe(false);
  });
});

describe('manager bodies', () => {
  it('manager body lowercases the email and needs a department', () => {
    const body = managerCreateBodySchema.parse({
      name: 'Ana Souza',
      cpf: '529.982.247-25',
      email: 'Ana@Prefeitura.GOV.br',
      departmentIds: [ID],
    });
    expect(body.email).toBe('ana@prefeitura.gov.br');
    expect(body.cpf).toBe('52998224725');
    expect(
      managerCreateBodySchema.safeParse({
        name: 'Ana Souza',
        cpf: '52998224725',
        email: 'ana@x.gov.br',
        departmentIds: [],
      }).success,
    ).toBe(false);
    expect(
      managerUpdateBodySchema.safeParse({
        action: 'update',
        email: 'a@x.gov.br',
        departmentIds: [],
      }).success,
    ).toBe(false);
    expect(
      managerUpdateBodySchema.safeParse({
        action: 'update',
        email: 'A@x.gov.br',
        departmentIds: [ID],
      }).success,
    ).toBe(true);
    expect(managerUpdateBodySchema.safeParse({ action: 'deactivate' }).success).toBe(true);
  });
});

describe('category bodies', () => {
  const base = {
    name: 'Buraco',
    icon: 'construction',
    iconGroup: 'infrastructure',
    departmentId: ID,
    defaultDeadlineDays: 7,
    clusterRadiusM: 20,
    active: true,
  };

  it('category body rejects an icon outside the options and a radius of 501', () => {
    expect(categoryCreateBodySchema.safeParse(base).success).toBe(true);
    expect(categoryCreateBodySchema.safeParse({ ...base, icon: 'rocket' }).success).toBe(false);
    expect(categoryCreateBodySchema.safeParse({ ...base, clusterRadiusM: 501 }).success).toBe(
      false,
    );
    expect(categoryCreateBodySchema.safeParse({ ...base, clusterRadiusM: 500 }).success).toBe(true);
    expect(categoryCreateBodySchema.safeParse({ ...base, defaultDeadlineDays: 366 }).success).toBe(
      false,
    );
  });

  it('category update needs at least one field', () => {
    expect(categoryUpdateBodySchema.safeParse({}).success).toBe(false);
    expect(categoryUpdateBodySchema.safeParse({ active: false }).success).toBe(true);
  });
});
