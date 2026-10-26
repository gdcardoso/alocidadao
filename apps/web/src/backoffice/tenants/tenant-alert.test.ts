import { describe, expect, it } from 'vitest';
import { tenantAlert } from './tenant-alert';

const base = { lateReviewCount: 0, staleImpedimentCount: 0, activeCategoryCount: 9 };

describe('tenantAlert', () => {
  it('alert picks review, then impediment, then categories', () => {
    expect(
      tenantAlert({ lateReviewCount: 5, staleImpedimentCount: 2, activeCategoryCount: 0 }),
    ).toEqual({
      tone: 'warning',
      text: '5 aguardando revisão há +1 dia',
    });
    expect(tenantAlert({ ...base, lateReviewCount: 1 })?.text).toBe(
      '1 aguardando revisão há +1 dia',
    );
    expect(tenantAlert({ ...base, staleImpedimentCount: 2, activeCategoryCount: 0 })?.text).toBe(
      '2 impedimentos parados',
    );
    expect(tenantAlert({ ...base, staleImpedimentCount: 1 })?.text).toBe('1 impedimento parado');
    expect(tenantAlert({ ...base, activeCategoryCount: 0 })).toEqual({
      tone: 'info',
      text: 'Sem categorias configuradas',
    });
    expect(tenantAlert(base)).toBeNull();
  });
});
