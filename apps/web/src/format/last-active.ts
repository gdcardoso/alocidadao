import { formatDate, formatDateTime, formatDayMonth } from './date';
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

/** Até quantos dias o último acesso da equipe aparece como `há N dias`. */
const RELATIVE_DAYS_MAX = 30;

/**
 * Último acesso da equipe interna (P6): `hoje, 09:40`, `ontem, 16:30`, `há 3 dias` (até 30),
 * depois `25 set 2026`; sem acesso, `nunca entrou`.
 */
export function formatLastAccess(at: Date | null, now: Date): string {
  if (!at) return 'nunca entrou';
  const days = dayNumber(todayInSaoPaulo(now)) - dayNumber(todayInSaoPaulo(at));
  if (days <= 1) return formatLastActive(at, now);
  if (days <= RELATIVE_DAYS_MAX) return `há ${days} dias`;
  return formatDate(at);
}
