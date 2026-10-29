// oxlint-disable react/only-export-components -- apoio de teste: a rota exibida e o helper de montagem
import type { PanelContext } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext, type PanelValue } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';

export const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

/** Monta uma página do painel (como admin por padrão) com sessão, consultas e rota simuladas. */
export function renderAdminPage(
  page: ReactElement,
  path: string,
  role: PanelContext['role'] = 'tenant_admin',
  support: PanelValue['support'] = null,
) {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const context: PanelContext = {
    tenant: { id: tenantId, displayName: 'Prefeitura', status: 'active', bounds: null },
    user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Rita Campos' },
    role,
    departments: [],
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined, support }}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              {page}
              <Location />
            </MemoryRouter>
          </ToastProvider>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
