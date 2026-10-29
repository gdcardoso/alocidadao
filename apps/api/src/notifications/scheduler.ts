import { autoConfirmRequests, cleanupNotifications } from '@alocidadao/db';
import { dispatchNotifications, type DispatchDeps } from './dispatcher.js';

export interface SchedulerOptions {
  /** Intervalo do envio da fila. Padrão: 5 s. */
  dispatchEveryMs?: number;
  /** Intervalo da confirmação automática e da limpeza. Padrão: 10 min. */
  maintenanceEveryMs?: number;
}

export interface Scheduler {
  /** Para as batidas e espera a rodada em andamento terminar. */
  stop(): Promise<void>;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Tarefa periódica sem sobreposição: se a rodada anterior ainda roda, a batida é pulada. Erro vai
 * ao log e não para a tarefa.
 */
function every(ms: number, task: () => Promise<void>) {
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    running = task().finally(() => {
      running = undefined;
    });
  }, ms);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}

/** Agendador dos avisos na API: envia a fila e roda a confirmação automática e a limpeza. */
export function startScheduler(
  deps: DispatchDeps,
  { dispatchEveryMs = 5_000, maintenanceEveryMs = 600_000 }: SchedulerOptions = {},
): Scheduler {
  const { db, log } = deps;

  const dispatch = every(dispatchEveryMs, async () => {
    try {
      await dispatchNotifications(deps);
    } catch (error) {
      log.error({ error: errorText(error) }, 'Falha no envio da fila de avisos');
    }
  });

  const maintenance = every(maintenanceEveryMs, async () => {
    try {
      const confirmed = await autoConfirmRequests(db);
      if (confirmed > 0) log.info({ confirmed }, 'Solicitações confirmadas automaticamente');
    } catch (error) {
      log.error({ error: errorText(error) }, 'Falha na confirmação automática');
    }
    try {
      await cleanupNotifications(db);
    } catch (error) {
      log.error({ error: errorText(error) }, 'Falha na limpeza dos avisos');
    }
  });

  return {
    async stop() {
      await Promise.all([dispatch.stop(), maintenance.stop()]);
    },
  };
}
