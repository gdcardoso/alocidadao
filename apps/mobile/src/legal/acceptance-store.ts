import { useEffect, useRef } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();

/** Registra um ouvinte do "Li e concordo"; devolve a função que o tira. */
export function subscribeLegalRead(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Chamada pelo "Li e concordo" no fim do texto: avisa a tela que tem a caixa de aceite. */
export function markLegalRead(): void {
  for (const listener of listeners) listener();
}

/** A tela da caixa marca o aceite quando o texto avisa que foi lido (some ao desmontar). */
export function useLegalReadSignal(onRead: () => void): void {
  const latest = useRef(onRead);
  useEffect(() => {
    latest.current = onRead;
  }, [onRead]);
  useEffect(() => subscribeLegalRead(() => latest.current()), []);
}
