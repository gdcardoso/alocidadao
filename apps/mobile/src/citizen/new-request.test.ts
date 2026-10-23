import {
  MAX_LOCATION_ADJUST_M,
  distanceMeters,
  type CategoryOption,
  type LocateResponse,
  type SimilarOccurrence,
} from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import {
  buildCreateInput,
  canSubmit,
  closestSimilar,
  decideFlow,
  formatAddress,
  formatCoordinates,
  limitAdjust,
  notServedTexts,
  reportCountLabel,
  type NewRequestDraft,
} from './new-request';

const GPS = { lat: -23.5505, lng: -46.6333 };

const category: CategoryOption = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Buraco na via',
  icon: 'construction',
  iconGroup: 'infrastructure',
};

const draft = (overrides: Partial<NewRequestDraft> = {}): NewRequestDraft => ({
  photos: ['file:///a.jpg'],
  category,
  gps: GPS,
  location: GPS,
  address: 'Rua das Flores, 120 — Centro',
  description: '',
  ...overrides,
});

const served: LocateResponse = {
  status: 'served',
  tenant: {
    id: '77777777-7777-4777-8777-777777777777',
    displayName: 'Prefeitura Demo',
    city: 'São Paulo',
    state: 'SP',
    centralPhone: null,
  },
  categories: [category],
};

const similar = (distanceM: number): SimilarOccurrence => ({
  occurrenceId: '66666666-6666-4666-8666-666666666666',
  categoryName: 'Buraco na via',
  icon: 'construction',
  iconGroup: 'infrastructure',
  distanceM,
  reportCount: 6,
  status: 'in_progress',
});

describe('limitAdjust', () => {
  it('limitAdjust keeps points within 200 m and clamps farther ones', () => {
    const near = { lat: GPS.lat + 0.001, lng: GPS.lng };
    expect(distanceMeters(GPS, near)).toBeLessThan(MAX_LOCATION_ADJUST_M);
    expect(limitAdjust(GPS, near)).toEqual(near);

    for (const far of [
      { lat: GPS.lat + 0.01, lng: GPS.lng + 0.01 },
      { lat: GPS.lat - 0.004, lng: GPS.lng },
      { lat: GPS.lat, lng: GPS.lng + 0.5 },
    ]) {
      const clamped = limitAdjust(GPS, far);
      const d = distanceMeters(GPS, clamped);
      expect(d).toBeGreaterThanOrEqual(MAX_LOCATION_ADJUST_M - 1);
      expect(d).toBeLessThanOrEqual(MAX_LOCATION_ADJUST_M);
      // Mesma direção: o ponto limitado fica na reta entre o GPS e o candidato.
      const viaClamped = distanceMeters(GPS, clamped) + distanceMeters(clamped, far);
      expect(viaClamped - distanceMeters(GPS, far)).toBeLessThan(1);
    }
  });
});

describe('decideFlow', () => {
  it('decideFlow chooses not_served, pick_similar, submit and queue', () => {
    expect(decideFlow(false, null, [])).toBe('queue');
    expect(decideFlow(false, served, [similar(10)])).toBe('queue');
    expect(decideFlow(true, null, [])).toBe('queue');
    expect(decideFlow(true, { status: 'not_served', municipality: null }, [])).toBe('not_served');
    expect(decideFlow(true, served, [similar(12)])).toBe('pick_similar');
    expect(decideFlow(true, served, [])).toBe('submit');
  });

  it('closestSimilar picks the nearest occurrence', () => {
    expect(closestSimilar([])).toBeNull();
    expect(closestSimilar([similar(30), similar(8), similar(14)])?.distanceM).toBe(8);
  });
});

describe('canSubmit', () => {
  it('canSubmit needs a photo and a category', () => {
    expect(canSubmit(draft())).toBe(true);
    expect(canSubmit(draft({ photos: [] }))).toBe(false);
    expect(canSubmit(draft({ category: null }))).toBe(false);
    expect(canSubmit(draft({ gps: null, location: null }))).toBe(false);
  });
});

describe('buildCreateInput', () => {
  it('builds the queue payload without photos and connection', () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const input = buildCreateInput(draft({ description: '  Muito fundo  ' }), now, {
      clientActionId: 'uuid-1',
    });
    expect(input).toEqual({
      clientActionId: 'uuid-1',
      categoryId: category.id,
      occurredAt: '2026-10-23T10:00:00.000Z',
      gpsLocation: GPS,
      location: GPS,
      address: 'Rua das Flores, 120 — Centro',
      description: 'Muito fundo',
      display: { categoryName: 'Buraco na via', icon: 'construction', iconGroup: 'infrastructure' },
    });
  });

  it('leaves out the empty note, the missing address and adds the occurrence', () => {
    const input = buildCreateInput(
      draft({ address: null, description: '   ' }),
      new Date('2026-10-23T10:00:00.000Z'),
      { clientActionId: 'uuid-1', occurrenceId: 'occ-1' },
    );
    expect(input).not.toHaveProperty('address');
    expect(input).not.toHaveProperty('description');
    expect(input.occurrenceId).toBe('occ-1');
  });
});

describe('texts', () => {
  it('formats the address and falls back to coordinates', () => {
    expect(
      formatAddress({ street: 'Rua das Flores', streetNumber: '120', district: 'Centro' }),
    ).toBe('Rua das Flores, 120 — Centro');
    expect(formatAddress({ street: 'Rua das Flores', streetNumber: null, district: null })).toBe(
      'Rua das Flores',
    );
    expect(formatAddress({ street: null, streetNumber: null, district: 'Centro' })).toBe('Centro');
    expect(formatAddress({ street: null, streetNumber: null, district: null })).toBeNull();
    expect(formatCoordinates({ lat: -23.5505, lng: -46.6333 })).toBe('-23.55050, -46.63330');
  });

  it('builds the 5c texts with and without the city', () => {
    expect(notServedTexts({ name: 'Campinas', state: 'SP' })).toEqual({
      title: 'Campinas ainda não usa o Alô Cidadão',
      body: 'Pela sua localização, você está em Campinas — SP. A prefeitura daqui ainda não aderiu ao sistema, então não é possível registrar solicitações por aqui.',
      contact:
        'Procure a central de atendimento da Prefeitura de Campinas. Em muitas cidades, o número é 156.',
    });
    expect(notServedTexts(null).title).toBe('Sua cidade ainda não usa o Alô Cidadão');
    expect(notServedTexts(null).body).not.toContain('você está em');
  });

  it('counts the reports', () => {
    expect(reportCountLabel(6)).toBe('6 pessoas relataram');
    expect(reportCountLabel(1)).toBe('1 pessoa relatou');
  });
});
