/** Situação do prazo da atividade ativa de uma ocorrência em atendimento. */
export const DEADLINE_STATUSES = ['none', 'on_time', 'due_soon', 'overdue'] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

/** Até quantos dias (de calendário, em Brasília) antes do vencimento o prazo está "a vencer". */
export const DUE_SOON_DAYS = 2;

/** Situações que o mapa aceita como filtro (`none` não é filtro). */
export const DEADLINE_FILTERS = ['on_time', 'due_soon', 'overdue'] as const;
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];

const DAY_MS = 86_400_000;

const saoPauloDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Número de dias do calendário de Brasília (AAAA-MM-DD tratado como UTC à meia-noite). */
function calendarDay(date: Date): number {
  return Date.parse(`${saoPauloDay.format(date)}T00:00:00Z`) / DAY_MS;
}

const plural = (n: number) => (n === 1 ? 'dia' : 'dias');

/** Texto da etiqueta do ponto: dias contados no calendário de Brasília. */
export function deadlineTag(dueAt: string, now: Date): string {
  const due = new Date(dueAt);
  const days = calendarDay(due) - calendarDay(now);
  if (due.getTime() < now.getTime()) {
    if (days === 0) return 'Atrasada hoje';
    const late = -days;
    return `Atrasada há ${late} ${plural(late)}`;
  }
  if (days === 0) return 'Vence hoje';
  if (days === 1) return 'Vence amanhã';
  return `Vence em ${days} dias`;
}
