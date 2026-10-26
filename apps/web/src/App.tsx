import { Navigate, Route, Routes } from 'react-router';
import { LoginPage } from './auth/LoginPage';
import { RequireSession } from './session/RequireSession';
import { useSession } from './session/SessionProvider';

/** Página provisória do mapa: as Tasks 8 e 9 trocam pelo shell e pela W1. */
function MapPlaceholder() {
  const { session } = useSession();
  return (
    <main style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>Mapa de ocorrências</h1>
      <p>Esta tela chega na próxima etapa do painel.</p>
      <button type="button" onClick={() => void session.signOut()} style={{ alignSelf: 'start' }}>
        Sair
      </button>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route element={<RequireSession />}>
        <Route path="/mapa" element={<MapPlaceholder />} />
      </Route>
      <Route path="*" element={<Navigate to="/mapa" replace />} />
    </Routes>
  );
}
