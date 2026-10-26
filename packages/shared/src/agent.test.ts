import { describe, expect, it } from 'vitest';
import {
  agentWorkOrderDetailSchema,
  devManagerActionBodySchema,
  reworkDetailsSchema,
} from './agent.js';

const card = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  tenantId: '3f2b8a52-5b0e-4c1e-9d3a-1a2b3c4d5e6f',
  status: 'rework_requested',
  protocol: 'OC-2026-0001',
  categoryName: 'Buraco na via',
  categoryIcon: 'construction',
  categoryGroup: 'infrastructure',
  address: null,
  location: { lat: -23.55, lng: -46.63 },
  teamName: 'Equipe Norte',
  reportCount: 2,
  dueAt: null,
  assignedAt: '2026-10-23T12:00:00.000Z',
  statusChangedAt: '2026-10-24T12:00:00.000Z',
};

describe('reworkDetailsSchema', () => {
  it('rework details require at least one reason', () => {
    expect(reworkDetailsSchema.safeParse({ reasons: [], discardedPhotoIds: [] }).success).toBe(
      false,
    );
    expect(
      reworkDetailsSchema.safeParse({ reasons: ['new_photos'], discardedPhotoIds: [] }).success,
    ).toBe(true);
  });
});

describe('agentWorkOrderDetailSchema', () => {
  it('agent detail parses a card with rework and no assigner', () => {
    const parsed = agentWorkOrderDetailSchema.safeParse({
      ...card,
      managerInstructions: null,
      assignedBy: null,
      reports: [{ description: '', createdAt: '2026-10-22T12:00:00.000Z' }],
      photos: [{ url: 'https://x/a.jpg', takenAt: '2026-10-22T12:00:00.000Z', purpose: 'report' }],
      citizenCount: 1,
      rework: {
        reasons: ['new_photos', 'return_to_site'],
        message: 'Fotos escuras',
        byName: null,
        departmentName: null,
        at: '2026-10-24T12:00:00.000Z',
      },
      previousNote: 'Tapei o buraco',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('devManagerActionBodySchema', () => {
  it('dev manager action rejects a short rework message', () => {
    expect(
      devManagerActionBodySchema.safeParse({
        action: 'request_rework',
        reasons: ['new_note'],
        message: 'ab',
        discardedPhotoIds: [],
      }).success,
    ).toBe(false);
    expect(
      devManagerActionBodySchema.safeParse({ action: 'reschedule', dueAt: null }).success,
    ).toBe(true);
  });
});
