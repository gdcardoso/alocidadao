import { beforeEach, describe, expect, it } from 'vitest';
import { clearSupportTenant, getSupportTenant, setSupportTenant } from './support-tenant';

const value = {
  tenantId: '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b',
  displayName: 'Prefeitura de Santos',
};

beforeEach(() => sessionStorage.clear());

describe('support tenant', () => {
  it('stores, reads and clears the tenant under ac_support_tenant', () => {
    expect(getSupportTenant()).toBeNull();
    setSupportTenant(value);
    expect(sessionStorage.getItem('ac_support_tenant')).toBe(JSON.stringify(value));
    expect(getSupportTenant()).toEqual(value);
    clearSupportTenant();
    expect(getSupportTenant()).toBeNull();
  });

  it('ignores a corrupted value', () => {
    sessionStorage.setItem('ac_support_tenant', '{oops');
    expect(getSupportTenant()).toBeNull();
    sessionStorage.setItem('ac_support_tenant', JSON.stringify({ tenantId: 1 }));
    expect(getSupportTenant()).toBeNull();
  });
});
