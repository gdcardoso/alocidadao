import '@fontsource/lexend/600.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/500.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import './styles/global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { panelSession } from './api';
import App from './App.tsx';
import { createQueryClient } from './query-client';
import { SessionProvider } from './session/SessionProvider';

const queryClient = createQueryClient();

// Ao sair ou perder a sessão, nada do painel anterior fica em cache.
panelSession.subscribe(() => {
  if (panelSession.getState().status === 'signed_out') queryClient.clear();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={panelSession}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
