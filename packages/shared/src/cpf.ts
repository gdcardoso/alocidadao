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

/** Aceita `529.982.247-25` ou `52998224725` e devolve só os dígitos. */
export const cpfSchema = z
  .string()
  .transform((value) => value.replace(/[.-]/g, ''))
  .refine(isValidCpf, { message: 'CPF inválido' });
