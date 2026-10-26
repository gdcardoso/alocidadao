import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG,
  STAFF_AUDIT_ACTIONS,
  STAFF_AUDIT_ACTION_LABELS,
  formatChange,
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
    expect(STAFF_AUDIT_ACTIONS).toHaveLength(25);
  });
});
