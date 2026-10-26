import { z } from 'zod';

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** Confere 11 dígitos, recusa sequências repetidas e valida os dois dígitos verificadores. */
export function isValidCpf(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits)) return false;
  if (/^(.)\1{10}$/.test(digits)) return false;
  return (
    checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10])
  );
}

/** Aplica a máscara `123.456.789-09` a 11 dígitos. */
export function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

/** Aceita `529.982.247-25`, `52998224725` (com espaços ou `/` soltos) e devolve só os dígitos. */
export const cpfSchema = z
  .string()
  .transform((value) => value.replace(/[\s./-]/g, ''))
  .refine(isValidCpf, { message: 'CPF inválido' });

/** Esconde o miolo do CPF para a tela: `12345678909` → `123.***.***-09`. */
export function maskCpf(digits: string): string {
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`;
}
