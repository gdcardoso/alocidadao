import { Navigate, Route, Routes } from 'react-router';
import { LoginPage } from './auth/LoginPage';
import { ComingSoonPage } from './shell/ComingSoonPage';
import { PanelLayout } from './shell/PanelLayout';
import { RequireSession } from './session/RequireSession';
import { TopBar } from './ui/TopBar';

/** Rotas do painel. `/mapa` e `/triagem` ganham as telas reais nas Tasks 9 e 10. */
export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route element={<RequireSession />}>
        <Route element={<PanelLayout />}>
          <Route path="/mapa" element={<TopBar title="Mapa de ocorrências" />} />
          <Route path="/triagem" element={<ComingSoonPage title="Triagem" />} />
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
