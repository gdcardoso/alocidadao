import { Navigate, Route, Routes } from 'react-router';
import { LoginPage } from './auth/LoginPage';
import { ComingSoonPage } from './shell/ComingSoonPage';
import { PanelLayout } from './shell/PanelLayout';
import { MapPage } from './map/MapPage';
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
          <Route path="/revisao" element={<ComingSoonPage title="Aguardando revisão" />} />
          <Route path="/impedimentos" element={<ComingSoonPage title="Impedimentos" />} />
          <Route path="/em-atendimento" element={<ComingSoonPage title="Em atendimento" />} />
          <Route path="/solicitacoes" element={<ComingSoonPage title="Todas as solicitações" />} />
          <Route path="/equipes" element={<ComingSoonPage title="Equipes e agentes" />} />
          <Route path="/categorias" element={<ComingSoonPage title="Categorias" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/mapa" replace />} />
    </Routes>
  );
}
