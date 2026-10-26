const numberFormat = new Intl.NumberFormat('pt-BR');

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

const daysFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Sempre com uma casa decimal e `dias`: `4,2 dias`, `4,0 dias`, `1,0 dias`; sem dado, `—`. */
export function formatDays(value: number | null): string {
  if (value === null) return '—';
  return `${daysFormat.format(value)} dias`;
}

/** Nome do mês anterior ao de `now`, em minúsculas, no horário de Brasília. */
export function previousMonthName(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const previous = new Date(Date.UTC(year, month - 2, 15));
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(previous);
}

/** `2026-11-01` vira `01/11/2026`. */
export function formatIsoDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
