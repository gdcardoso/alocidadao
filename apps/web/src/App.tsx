import { Navigate, Route, Routes } from 'react-router';
import { LoginPage } from './auth/LoginPage';
import { ComingSoonPage } from './shell/ComingSoonPage';
import { PanelLayout } from './shell/PanelLayout';
import { MapPage } from './map/MapPage';
import { ImpedimentsPage } from './impediments/ImpedimentsPage';
import { InProgressPage } from './lists/InProgressPage';
import { RequestsPage } from './lists/RequestsPage';
import { ReviewPage } from './review/ReviewPage';
import { TeamsPage } from './teams/TeamsPage';
import { TriagePage } from './triage/TriagePage';
import { RequireSession } from './session/RequireSession';

/** Rotas do painel. As telas do 5b ainda são páginas provisórias. */
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
          {/* A página de gestores chega na Task 13; até lá a rota volta para /equipes. */}
          <Route path="/equipes/gestores" element={<Navigate to="/equipes" replace />} />
          <Route path="/categorias" element={<ComingSoonPage title="Categorias" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/mapa" replace />} />
    </Routes>
  );
}
