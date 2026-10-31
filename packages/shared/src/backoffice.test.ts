import { describe, expect, it } from 'vitest';
import { COMMERCIAL_STATUSES } from './enums.js';
import {
  COMMERCIAL_STATUS_LABELS,
  DEFAULT_CATALOG,
  STAFF_AUDIT_ACTIONS,
  STAFF_AUDIT_ACTION_LABELS,
  cityInterestCsv,
  formatChange,
  frozenAccountRecoverBodySchema,
  neighborhoodsUploadSchema,
  staffCreateBodySchema,
  staffUpdateBodySchema,
  tenantCreateBodySchema,
} from './backoffice.js';

const validBody = {
  ibgeCode: '3550308',
  displayName: 'Prefeitura de Cidade',
  centralPhone: '156',
  admin: { name: 'Maria Silva', cpf: '529.982.247-25', email: 'Maria@Cidade.gov.br' },
  contract: {
    plan: 'essential',
    includedPanelUsers: 50,
    startsOn: '2026-11-01',
    endsOn: '2027-10-31',
  },
  copyDefaultCatalog: true,
};

describe('backoffice contracts', () => {
  it('default catalog has 9 categories in 3 departments with the seed radii', () => {
    expect(DEFAULT_CATALOG).toHaveLength(9);
    expect(new Set(DEFAULT_CATALOG.map((c) => c.department))).toEqual(
      new Set(['Obras', 'Meio ambiente', 'Serviços']),
    );
    expect(Object.fromEntries(DEFAULT_CATALOG.map((c) => [c.name, c.clusterRadiusM]))).toEqual({
      'Buraco na via': 15,
      Iluminação: 25,
      'Lixo e entulho': 30,
      'Poda de árvore': 20,
      Esgoto: 20,
      Calçada: 20,
      Sinalização: 50,
      Animal: 50,
      Outro: 20,
    });
    expect(DEFAULT_CATALOG.every((c) => c.defaultDeadlineDays === 7)).toBe(true);
  });

  it('tenant create body lowercases the admin email, turns a blank central into null and rejects endsOn before startsOn', () => {
    const parsed = tenantCreateBodySchema.parse({ ...validBody, centralPhone: '   ' });
    expect(parsed.admin.email).toBe('maria@cidade.gov.br');
    expect(parsed.admin.cpf).toBe('52998224725');
    expect(parsed.centralPhone).toBeNull();

    const bad = tenantCreateBodySchema.safeParse({
      ...validBody,
      contract: { ...validBody.contract, endsOn: '2026-10-31' },
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['contract', 'endsOn']);

    expect(
      tenantCreateBodySchema.safeParse({
        ...validBody,
        contract: { ...validBody.contract, endsOn: null },
      }).success,
    ).toBe(true);
  });

  it('formatChange rounds and returns null without a base', () => {
    expect(formatChange(112, 100)).toBe(12);
    expect(formatChange(95, 100)).toBe(-5);
    expect(formatChange(1, 3)).toBe(-67);
    expect(formatChange(5, 0)).toBeNull();
  });

  it('every staff audit action has a label', () => {
    for (const action of STAFF_AUDIT_ACTIONS) {
      expect(STAFF_AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
    expect(STAFF_AUDIT_ACTIONS).toHaveLength(36);
  });

  it('every commercial status and staff audit action has a label', () => {
    for (const status of COMMERCIAL_STATUSES) {
      expect(COMMERCIAL_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(COMMERCIAL_STATUS_LABELS.proposal_sent).toBe('Proposta enviada');
    expect(STAFF_AUDIT_ACTION_LABELS['staff.role_change']).toBe(
      'Trocou o papel de uma pessoa da equipe',
    );
    expect(STAFF_AUDIT_ACTION_LABELS['account.release_cpf']).toBe(
      'Liberou o CPF de uma conta congelada',
    );
    expect(STAFF_AUDIT_ACTION_LABELS['manager.email_change']).toBe('Trocou o e-mail de um gestor');
    expect(STAFF_AUDIT_ACTION_LABELS['agent.phone_change']).toBe('Trocou o celular de um agente');
  });

  it('city interest csv uses semicolons, BOM, pt-BR dates and Sim/Não', () => {
    const csv = cityInterestCsv([
      {
        ibgeCode: '3550308',
        name: 'São Paulo',
        state: 'SP',
        requestCount: 12,
        last30Days: 5,
        firstAt: '2026-03-07T15:00:00.000Z',
        commercialStatus: 'proposal_sent',
        isCustomer: true,
      },
      {
        ibgeCode: '3304557',
        name: 'Rio; "Janeiro"',
        state: 'RJ',
        requestCount: 3,
        last30Days: 0,
        firstAt: '2026-10-01T12:00:00.000Z',
        commercialStatus: 'new',
        isCustomer: false,
      },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'Posição;Município;UF;Pedidos;Últimos 30 dias;Primeiro pedido;Situação comercial;Já é cliente',
    );
    expect(lines[1]).toBe('1;São Paulo;SP;12;5;07/03/2026;Proposta enviada;Sim');
    expect(lines[2]).toBe('2;"Rio; ""Janeiro""";RJ;3;0;01/10/2026;Sem contato;Não');
  });

  it('staff update body requires at least one field', () => {
    expect(staffUpdateBodySchema.safeParse({}).success).toBe(false);
    expect(staffUpdateBodySchema.safeParse({ platformRole: 'support' }).success).toBe(true);
    expect(staffUpdateBodySchema.parse({ email: 'A@B.com' }).email).toBe('a@b.com');
  });

  it('staff create body validates cpf and lowercases the email', () => {
    const ok = staffCreateBodySchema.parse({
      name: '  Ana Souza ',
      cpf: '529.982.247-25',
      email: 'Ana@Alo.com',
      platformRole: 'admin',
    });
    expect(ok.name).toBe('Ana Souza');
    expect(ok.email).toBe('ana@alo.com');
    expect(staffCreateBodySchema.safeParse({ ...ok, cpf: '111.111.111-11' }).success).toBe(false);
  });

  it('frozen account recover body needs a 6-digit code and a lowercase email', () => {
    const base = {
      challengeId: '3f1c2b4e-8a7d-4c6b-9e2f-1a2b3c4d5e6f',
      code: '123456',
      email: 'Novo@Mail.com',
      tenantId: null,
    };
    expect(frozenAccountRecoverBodySchema.parse(base).email).toBe('novo@mail.com');
    expect(frozenAccountRecoverBodySchema.safeParse({ ...base, code: '12345' }).success).toBe(
      false,
    );
  });
});

describe('neighborhoodsUploadSchema', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  const feature = (
    properties: Record<string, unknown>,
    geometry: unknown = { type: 'Polygon', coordinates: [ring] },
  ) => ({
    type: 'Feature',
    properties,
    geometry,
  });
  const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

  it('accepts polygons with nome, name or NM_BAIRRO', () => {
    const body = collection(
      feature({ nome: 'A' }),
      feature({ name: 'B' }),
      feature({ NM_BAIRRO: 'C' }),
    );
    expect(neighborhoodsUploadSchema.safeParse(body).success).toBe(true);
  });

  it('rejects points, empty and duplicate names (ignoring case) and empty collections', () => {
    const point = { type: 'Point', coordinates: [0, 0] };
    for (const body of [
      collection(feature({ nome: 'A' }, point)),
      collection(feature({ nome: ' ' })),
      collection(feature({ nome: 'Centro' }), feature({ name: ' CENTRO ' })),
      collection(),
    ]) {
      expect(neighborhoodsUploadSchema.safeParse(body).success).toBe(false);
    }
  });
});
