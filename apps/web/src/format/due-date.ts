const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje em Brasília, `YYYY-MM-DD`. */
export function todayInSaoPaulo(now: Date): string {
  return SAO_PAULO_DATE.format(now);
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Dica ao lado do prazo: `(hoje)`, `(1 dia)` ou `(N dias)`. */
export function dueDateHint(dueDate: string, today: string): string {
  const days = dayNumber(dueDate) - dayNumber(today);
  if (days <= 0) return '(hoje)';
  return days === 1 ? '(1 dia)' : `(${days} dias)`;
}
