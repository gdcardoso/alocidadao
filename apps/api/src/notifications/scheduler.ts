import { AUTO_CONFIRM_BATCH, autoConfirmRequests, cleanupNotifications } from '@alocidadao/db';
import { dispatchNotifications, type DispatchDeps } from './dispatcher.js';

export interface SchedulerOptions {
  /** Intervalo do envio da fila. Padrão: 5 s. */
  dispatchEveryMs?: number;
  /** Intervalo da confirmação automática e da limpeza. Padrão: 10 min. */
  maintenanceEveryMs?: number;
  /** Espera até a primeira manutenção, para rodar mesmo se a API reinicia a todo momento. Padrão: 30 s. */
  maintenanceFirstRunMs?: number;
}

export interface Scheduler {
  /** Para as batidas e espera a rodada em andamento terminar. */
  stop(): Promise<void>;
}

/** Máximo de chamadas da confirmação automática por rodada de manutenção. */
const MAX_AUTO_CONFIRM_CALLS = 20;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Registra uma falha só na mudança de estado: a primeira falha vai ao log e as seguintes ficam
 * quietas até a tarefa voltar a funcionar (um aviso de recuperação). Sem isso, banco fora gera uma
 * linha de erro a cada batida, por instância.
 */
function failureLog(log: DispatchDeps['log']) {
  const failing = new Set<string>();
  return {
    failed(name: string, message: string, error: unknown) {
      if (failing.has(name)) return;
      failing.add(name);
      log.error({ error: errorText(error) }, message);
    },
    ok(name: string, message: string) {
      if (!failing.delete(name)) return;
      log.info({}, `${message}: normalizado`);
    },
  };
}

/**
 * Tarefa periódica sem sobreposição: se a rodada anterior ainda roda, a batida é pulada. Erro vai
 * ao log e não para a tarefa.
 */
function every(ms: number, task: () => Promise<void>, firstRunMs?: number) {
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = task().finally(() => {
      running = undefined;
    });
  };
  const timer = setInterval(tick, ms);
  const first = firstRunMs === undefined ? undefined : setTimeout(tick, firstRunMs);
  return {
    async stop() {
      clearInterval(timer);
      if (first) clearTimeout(first);
      await running;
    },
  };
}

/** Agendador dos avisos na API: envia a fila e roda a confirmação automática e a limpeza. */
export function startScheduler(
  deps: DispatchDeps,
  {
    dispatchEveryMs = 5_000,
    maintenanceEveryMs = 600_000,
    maintenanceFirstRunMs = 30_000,
  }: SchedulerOptions = {},
): Scheduler {
  const { db, log } = deps;
  const failures = failureLog(log);

  const dispatch = every(dispatchEveryMs, async () => {
    try {
      await dispatchNotifications(deps);
      failures.ok('dispatch', 'Envio da fila de avisos');
    } catch (error) {
      failures.failed('dispatch', 'Falha no envio da fila de avisos', error);
    }
  });

  const maintenance = every(
    maintenanceEveryMs,
    async () => {
      try {
        // Em lotes: repete enquanto a chamada devolver o lote cheio, com limite por rodada.
        let confirmed = 0;
        for (let i = 0; i < MAX_AUTO_CONFIRM_CALLS; i++) {
          const count = await autoConfirmRequests(db);
          confirmed += count;
          if (count < AUTO_CONFIRM_BATCH) break;
        }
        if (confirmed > 0) log.info({ confirmed }, 'Solicitações confirmadas automaticamente');
        failures.ok('auto-confirm', 'Confirmação automática');
      } catch (error) {
        failures.failed('auto-confirm', 'Falha na confirmação automática', error);
      }
      try {
        await cleanupNotifications(db);
        failures.ok('cleanup', 'Limpeza dos avisos');
      } catch (error) {
        failures.failed('cleanup', 'Falha na limpeza dos avisos', error);
      }
    },
    maintenanceFirstRunMs,
  );

  return {
    async stop() {
      await Promise.all([dispatch.stop(), maintenance.stop()]);
    },
  };
}
