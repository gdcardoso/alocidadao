import type { AuditRow, TenantDetail } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { createPanelSession } from '../../../session/panel-session';
import { SessionProvider } from '../../../session/SessionProvider';
import { AuditTab } from './AuditTab';

vi.mock('../../../api', () => ({
  api: { backofficeAudit: vi.fn(), backofficeTenants: vi.fn(), backofficeStaff: vi.fn() },
}));

const audit = vi.mocked(api.backofficeAudit);
const tenants = vi.mocked(api.backofficeTenants);
const staff = vi.mocked(api.backofficeStaff);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const tenant = { id: tenantId } as unknown as TenantDetail;

const row: AuditRow = {
  id: '11111111-1111-4111-8111-111111111111',
  at: '2026-10-21T18:40:00.000Z',
  staffName: 'Lucas Prado',
  tenantId,
  tenantName: 'Prefeitura de Atibaia',
  action: 'support.enter',
  targetType: null,
  targetLabel: '—',
};

describe('AuditTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audit.mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 50 });
    staff.mockResolvedValue({ items: [] });
  });

  it('AuditTab filters by the tenant and hides the tenant filter', async () => {
    const session = createPanelSession({
      client: {
        panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
        panelLogout: vi.fn(async () => undefined),
      },
    });
    session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider session={session}>
          <MemoryRouter initialEntries={[`/x?aba=auditoria&prefeitura=${crypto.randomUUID()}`]}>
            <AuditTab tenant={tenant} isAdmin />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Lucas Prado')).toBeInTheDocument();
    expect(audit).toHaveBeenCalledWith({ page: 1, tenantId });
    expect(tenants).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Prefeitura/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Prefeitura' })).toBeNull();
    expect(screen.getByText('Pessoa')).toBeInTheDocument();
  });
});
