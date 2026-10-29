import { Navigate, Outlet, Route, Routes } from 'react-router';
import { BackofficeLayout } from './backoffice/BackofficeLayout';
import { AuditPage } from './backoffice/audit/AuditPage';
import { TenantDetailPage } from './backoffice/tenants/TenantDetailPage';
import { CityInterestPage } from './backoffice/interest/CityInterestPage';
import { StaffPage } from './backoffice/staff/StaffPage';
import { NewTenantPage } from './backoffice/tenants/NewTenantPage';
import { TenantsPage } from './backoffice/tenants/TenantsPage';
import { LoginPage } from './auth/LoginPage';
import { CategoriesPage } from './categories/CategoriesPage';
import { DepartmentsPage } from './categories/DepartmentsPage';
import { PanelLayout } from './shell/PanelLayout';
import { usePanel } from './shell/use-panel';
import { MapPage } from './map/MapPage';
import { ImpedimentsPage } from './impediments/ImpedimentsPage';
import { InProgressPage } from './lists/InProgressPage';
import { ManagersPage } from './managers/ManagersPage';
import { RequestsPage } from './lists/RequestsPage';
import { ReviewPage } from './review/ReviewPage';
import { TeamsPage } from './teams/TeamsPage';
import { TriagePage } from './triage/TriagePage';
import { RequireSession } from './session/RequireSession';

/** Rotas só do admin: o gestor volta para o mapa (`/categorias`) ou para as equipes. */
function AdminOnly({ fallback }: { fallback: string }) {
  const { context } = usePanel();
  return context.role === 'tenant_admin' ? <Outlet /> : <Navigate to={fallback} replace />;
}

/** Rotas do painel. */
export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route element={<RequireSession />}>
        <Route element={<PanelLayout />}>
          <Route path="/mapa" element={<MapPage />} />
          <Route path="/triagem" element={<TriagePage />} />
          <Route path="/revisao" element={<ReviewPage />} />
          <Route path="/impedimentos" element={<ImpedimentsPage />} />
          <Route path="/em-atendimento" element={<InProgressPage />} />
          <Route path="/solicitacoes" element={<RequestsPage />} />
          <Route path="/equipes" element={<TeamsPage />} />
          <Route element={<AdminOnly fallback="/equipes" />}>
            <Route path="/equipes/gestores" element={<ManagersPage />} />
          </Route>
          <Route element={<AdminOnly fallback="/mapa" />}>
            <Route path="/categorias" element={<CategoriesPage />} />
            <Route path="/categorias/setores" element={<DepartmentsPage />} />
          </Route>
        </Route>
      </Route>
      <Route element={<RequireSession />}>
        <Route path="/backoffice" element={<BackofficeLayout />}>
          <Route index element={<Navigate to="/backoffice/prefeituras" replace />} />
          <Route path="prefeituras" element={<TenantsPage />} />
          <Route path="prefeituras/nova" element={<NewTenantPage />} />
          <Route path="prefeituras/:id" element={<TenantDetailPage />} />
          <Route path="interesse" element={<CityInterestPage />} />
          <Route path="equipe" element={<StaffPage />} />
          <Route path="auditoria" element={<AuditPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/mapa" replace />} />
    </Routes>
  );
}
