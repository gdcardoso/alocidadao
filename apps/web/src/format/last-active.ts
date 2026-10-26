import { formatDateTime, formatDayMonth } from './date';
import { todayInSaoPaulo } from './due-date';

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Último acesso do agente: `hoje, 09:12`, `ontem, 18:03`, `12 out` ou `nunca entrou`. */
export function formatLastActive(at: Date | null, now: Date): string {
  if (!at) return 'nunca entrou';
  const days = dayNumber(todayInSaoPaulo(now)) - dayNumber(todayInSaoPaulo(at));
  const time = formatDateTime(at).split(', ')[1] ?? '';
  if (days === 0) return `hoje, ${time}`;
  if (days === 1) return `ontem, ${time}`;
  return formatDayMonth(at);
}
