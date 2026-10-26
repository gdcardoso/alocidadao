const MINUTE_MS = 60_000;

/** Tempo desde `from` sem o "há": `N min`, `N h`, `1 dia` ou `N dias` (data futura vale 0 min). */
export function formatElapsedShort(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / MINUTE_MS));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 dia' : `${days} dias`;
}

/** Tempo desde `from`: `há N min`, `há N h`, `há 1 dia` ou `há N dias`. */
export function formatElapsed(from: Date, now: Date): string {
  return `há ${formatElapsedShort(from, now)}`;
}
