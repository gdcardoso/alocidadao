import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { createIdleTracker, type IdleTrackerOptions } from './idle';
import { useSession } from './SessionProvider';

/** O que conta como ação da pessoa. Movimento do mouse sozinho não conta. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
const CHECK_INTERVAL_MS = 1_000;

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Com a sessão aberta, sai sozinho depois de 1 h sem ação da pessoa, com aviso 2 min antes.
 * As consultas automáticas (sino, contadores) não contam como uso.
 */
export function IdleGuard(options: Omit<IdleTrackerOptions, 'storage'> = {}) {
  const { session } = useSession();
  const [tracker] = useState(() => createIdleTracker(options));
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const onActivity = () => tracker.touch();
    const check = () => {
      const { phase, remainingMs: left } = tracker.check();
      if (phase === 'idle') {
        void session.signOut({ expired: true });
        return;
      }
      setRemainingMs(phase === 'warning' ? left : null);
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { capture: true, passive: true });
    }
    // Ao voltar à aba ou acordar o computador, confere na hora (os timers param ou atrasam).
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    check();
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [tracker, session]);

  if (remainingMs === null) return null;

  function keepConnected() {
    tracker.touch(true);
    setRemainingMs(null);
  }

  return (
    <Dialog
      title="Sua sessão vai encerrar"
      onClose={keepConnected}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => void session.signOut()}>
            Sair agora
          </Button>
          <Button variant="primary" size="sm" onClick={keepConnected}>
            Continuar conectado
          </Button>
        </>
      }
    >
      <p>
        Por falta de uso, você vai sair do painel em <strong>{formatRemaining(remainingMs)}</strong>
        .
      </p>
    </Dialog>
  );
}
