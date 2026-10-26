const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  day: 'numeric',
  month: 'numeric',
});

/** Dia e mês abreviado no horário de Brasília: `20 out`. */
export function formatDayMonth(date: Date): string {
  const parts = PARTS.formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1');
  return `${day} ${MONTHS[month - 1]}`;
}
