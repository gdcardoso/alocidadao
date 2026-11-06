import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { discardCode, issueCode, type CodePurpose, type Database } from '@alocidadao/db';
import { CODE_LENGTH } from '@alocidadao/shared';
import { maskPhone, type PhoneCodeSender } from '../messaging/phone-code.js';

/** Código de 6 dígitos; no desenvolvimento, o código fixo da variável de ambiente. */
export function generateCode(devFixedCode?: string): string {
  if (devFixedCode) return devFixedCode;
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** HMAC-SHA256(AUTH_SECRET, "<challengeId>:<code>"), em hexadecimal. */
export function hashCode(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export type IssuedChallenge =
  | { issued: true; challengeId: string; code: string }
  | { issued: false; retryAfterSeconds: number };

/**
 * Gera o código, grava só o hash e devolve o código para quem vai enviá-lo. Respeita o
 * limite por finalidade e destino (60 s entre envios, 5 por hora). O destino de e-mail
 * vai em minúsculas, para o limite valer para o mesmo endereço escrito de outro jeito.
 */
export async function issueChallenge(
  db: Database,
  {
    secret,
    devFixedCode,
    purpose,
    target,
    userId,
  }: {
    secret: string;
    devFixedCode?: string;
    purpose: CodePurpose;
    target: string;
    userId: string | null;
  },
): Promise<IssuedChallenge> {
  const challengeId = randomUUID();
  const code = generateCode(devFixedCode);
  const result = await issueCode(db, {
    id: challengeId,
    purpose,
    target: target.includes('@') ? target.toLowerCase() : target,
    userId,
    codeHash: hashCode(secret, challengeId, code),
  });
  if (!result.issued) return { issued: false, retryAfterSeconds: result.retryAfterSeconds };
  return { issued: true, challengeId, code };
}

/**
 * Manda o código para o celular. Se o envio falhar, descarta o código (o cidadão pode pedir
 * outro na hora, sem esperar os 60 s nem gastar o limite por hora), registra no log com o
 * número mascarado e devolve `false`.
 */
export async function deliverPhoneCode(
  db: Database,
  sender: PhoneCodeSender,
  log: FastifyBaseLogger,
  phone: string,
  challenge: { challengeId: string; code: string },
): Promise<boolean> {
  try {
    await sender.send(phone, challenge.code);
    return true;
  } catch (err) {
    await discardCode(db, challenge.challengeId);
    log.warn({ err, phone: maskPhone(phone) }, 'Código pelo celular não enviado');
    return false;
  }
}
