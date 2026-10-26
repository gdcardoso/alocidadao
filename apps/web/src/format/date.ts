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

const DATE_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Dia, mês abreviado e hora no horário de Brasília: `21 out, 15:40`. */
export function formatDateTime(date: Date): string {
  const parts = DATE_TIME_PARTS.formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${formatDayMonth(date)}, ${hour}:${minute}`;
}

const YEAR_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
});

/** Dia, mês abreviado e ano no horário de Brasília: `20 out 2026`. */
export function formatDate(date: Date): string {
  const year = YEAR_PARTS.formatToParts(date).find((part) => part.type === 'year')?.value ?? '';
  return `${formatDayMonth(date)} ${year}`;
}
