/**
 * Trava de ação da tela: enquanto uma ação roda, outro toque é ignorado. A trava fecha no
 * mesmo instante do toque, antes de qualquer `await`, então o toque duplo não passa.
 */
export function createActionLock() {
  let running = false;
  return {
    /** Roda a tarefa se nada estiver rodando; senão, devolve `undefined` sem rodar. */
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (running) return undefined;
      running = true;
      try {
        return await task();
      } finally {
        running = false;
      }
    },
  };
}
