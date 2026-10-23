import { useCallback, useEffect, useState } from 'react';

/**
 * Segundos que faltam até poder reenviar o código. Conta pelo relógio (não por ticks), então
 * não atrasa se o app ficar em segundo plano.
 */
export function useCountdown(initialSeconds: number): {
  remaining: number;
  restart(seconds: number): void;
} {
  const [deadline, setDeadline] = useState(() => Date.now() + initialSeconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const done = remaining === 0;

  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [done]);

  const restart = useCallback((seconds: number) => {
    const start = Date.now();
    setNow(start);
    setDeadline(start + seconds * 1000);
  }, []);

  return { remaining, restart };
}
