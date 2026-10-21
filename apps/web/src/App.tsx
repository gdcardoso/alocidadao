import { REQUEST_STATUS_LABELS, REQUEST_STATUSES, type HealthResponse } from '@alocidadao/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

type ApiState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

export default function App() {
  const [apiState, setApiState] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    api
      .health()
      .then((health) => setApiState({ kind: 'ok', health }))
      .catch(() => setApiState({ kind: 'error' }));
  }, []);

  return (
    <main className="page">
      <h1>Alô Cidadão — Painel</h1>
      <p>
        API:{' '}
        {apiState.kind === 'loading' && 'verificando…'}
        {apiState.kind === 'ok' && `online (${apiState.health.service})`}
        {apiState.kind === 'error' && 'indisponível'}
      </p>
      <h2>Status de solicitação</h2>
      <ul>
        {REQUEST_STATUSES.map((status) => (
          <li key={status}>{REQUEST_STATUS_LABELS[status]}</li>
        ))}
      </ul>
    </main>
  );
}
