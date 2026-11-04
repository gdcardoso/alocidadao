import { z } from 'zod';
import { phoneSchema } from './auth.js';
import { formatPhoneBR } from './phone.js';

/** Contato mostrado na página de apresentação (alocidadao.com.br), editado no backoffice. */
export const siteContactSchema = z.object({
  /** Celular do WhatsApp em E.164. */
  whatsapp: phoneSchema,
  email: z.email().transform((value) => value.toLowerCase()),
  /** Frase embaixo do WhatsApp, como "Resposta no mesmo dia". */
  responseNote: z.string().trim().min(1).max(60),
});
export type SiteContact = z.infer<typeof siteContactSchema>;

/** Valores iniciais (linha criada pela migração) e substitutos quando a API não responde. */
export const DEFAULT_SITE_CONTACT: SiteContact = {
  whatsapp: '+5562982089667',
  email: 'gdcardoso@gmail.com',
  responseNote: 'Resposta no mesmo dia',
};

/** `'+5562982089667'` → `'(62) 98208-9667'`. */
export function formatWhatsapp(e164: string): string {
  return formatPhoneBR(e164);
}

/** `'+5562982089667'` → `'https://wa.me/5562982089667'`. */
export function whatsappLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}
