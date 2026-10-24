import { REQUEST_STATUS_LABELS, type RequestStatus } from '@alocidadao/shared';

// Datas sempre no horário de São Paulo. O Brasil não tem horário de verão desde 2019, então o
// deslocamento é fixo em UTC−3; assim não dependemos do Intl com fuso, que varia entre motores.
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Dias desde a época no calendário de São Paulo. */
  dayNumber: number;
}

function localParts(value: string | Date): LocalParts {
  const shifted = new Date(new Date(value).getTime() + SAO_PAULO_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayNumber: Math.floor(shifted.getTime() / DAY_MS),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayMonth = (p: LocalParts) => `${pad(p.day)} ${MONTHS[p.month]}`;
const time = (p: LocalParts) => `${pad(p.hour)}:${pad(p.minute)}`;

/** `'+5511987654321'` → `'(11) 98765-4321'`. Número fora do Brasil volta como veio. */
export function formatPhoneBR(e164: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!match) return e164;
  const [, ddd, start, end] = match;
  return `(${ddd}) ${start}-${end}`;
}

/** Texto do campo (com ou sem máscara) → E.164; `null` se não tiver DDD + 9 dígitos. */
export function parsePhoneInput(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  return digits.length === 11 ? `+55${digits}` : null;
}

/**
 * Número sugerido pelo chip (Phone Number Hint) → 11 dígitos (DDD + número), só se for do
 * Brasil. Com E.164, exige o +55; sem ele, o número com "+" também precisa ser +55.
 */
export function phoneHintDigits(hint: { number: string; e164: string | null }): string | null {
  const international = hint.e164 ?? (hint.number.trim().startsWith('+') ? hint.number : null);
  if (international !== null) {
    const digits = international.replace(/\D/g, '');
    return digits.length === 13 && digits.startsWith('55') ? digits.slice(2) : null;
  }
  const digits = hint.number.replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

/** Máscara `(XX) XXXXX-XXXX` aplicada enquanto o cidadão digita. */
export function maskPhoneInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const start = digits.slice(2, 7);
  const end = digits.slice(7);
  return end ? `(${ddd}) ${start}-${end}` : `(${ddd}) ${start}`;
}

/** `'há 3 dias'`, `'há 1 dia'` ou `'hoje'`, em dias de calendário. */
export function formatAgo(since: string, now: Date = new Date()): string {
  const days = Math.max(0, localParts(now).dayNumber - localParts(since).dayNumber);
  if (days === 0) return 'hoje';
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/**
 * Tempo desde `since` para os cartões do agente: `'agora'` (menos de 1 min), `'há N min'`,
 * `'há N h'` ou `'há N dias'` (`'há 1 dia'`), em tempo corrido.
 */
export function formatAgoPrecise(since: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(since).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/** `'350 m'` abaixo de 1 km; `'1,2 km'` com uma casa e vírgula. */
export function formatDistance(meters: number): string {
  const rounded = Math.round(meters);
  if (rounded < 1000) return `${rounded} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** `'Aberta há 3 dias'`, `'Em atendimento há 1 dia'` ou `'Aberta hoje'`, em dias de calendário. */
export function formatElapsed(
  status: RequestStatus,
  since: string,
  now: Date = new Date(),
): string {
  return `${REQUEST_STATUS_LABELS[status]} ${formatAgo(since, now)}`;
}

/** `'20 out 2026, 08:12'`. */
export function formatDateTime(iso: string): string {
  const p = localParts(iso);
  return `${dayMonth(p)} ${p.year}, ${time(p)}`;
}

/** `'21 out, 15:40'` (linha do tempo e relato da equipe). */
export function formatDayTime(iso: string): string {
  const p = localParts(iso);
  return `${dayMonth(p)}, ${time(p)}`;
}

/** Data do cartão: `'Hoje, 08:12'`, `'18 out'` no mesmo ano ou `'30 dez 2025'`. */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const p = localParts(iso);
  const today = localParts(now);
  if (p.dayNumber === today.dayNumber) return `Hoje, ${time(p)}`;
  if (p.year === today.year) return dayMonth(p);
  return `${dayMonth(p)} ${p.year}`;
}

function nameParts(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** Iniciais do primeiro e do último nome: `'Maria da Silva'` → `'MS'`. */
export function initials(name: string): string {
  const parts = nameParts(name);
  if (parts.length === 0) return '';
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

/** `'Maria da Silva'` → `'Maria'`. */
export function firstName(name: string): string {
  return nameParts(name)[0] ?? '';
}
