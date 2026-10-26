import { phoneSchema } from './auth.js';

/** `'+5511987654321'` → `'(11) 98765-4321'`. Número fora do Brasil volta como veio. */
export function formatPhoneBR(e164: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!match) return e164;
  const [, ddd, start, end] = match;
  return `(${ddd}) ${start}-${end}`;
}

/** Máscara `(XX) XXXXX-XXXX` aplicada enquanto a pessoa digita. */
export function maskPhoneInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const start = digits.slice(2, 7);
  const end = digits.slice(7);
  return end ? `(${ddd}) ${start}-${end}` : `(${ddd}) ${start}`;
}

/** `(11) 98877-1020` → `+5511988771020`; `null` se não for um celular válido (`phoneSchema`). */
export function phoneFromMasked(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  const parsed = phoneSchema.safeParse(`+55${digits}`);
  return parsed.success ? parsed.data : null;
}
