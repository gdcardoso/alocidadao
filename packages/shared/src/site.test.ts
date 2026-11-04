import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_CONTACT, formatWhatsapp, siteContactSchema, whatsappLink } from './site.js';

describe('site contact', () => {
  it('formats the WhatsApp number for display', () => {
    expect(formatWhatsapp('+5562982089667')).toBe('(62) 98208-9667');
  });

  it('builds the wa.me link', () => {
    expect(whatsappLink('+5562982089667')).toBe('https://wa.me/5562982089667');
  });

  it('accepts the default contact', () => {
    expect(siteContactSchema.parse(DEFAULT_SITE_CONTACT)).toEqual(DEFAULT_SITE_CONTACT);
  });

  it('lowercases the e-mail', () => {
    const parsed = siteContactSchema.parse({
      ...DEFAULT_SITE_CONTACT,
      email: 'Contato@Exemplo.COM',
    });
    expect(parsed.email).toBe('contato@exemplo.com');
  });

  it.each([
    ['landline WhatsApp', { whatsapp: '+556232221234' }],
    ['invalid e-mail', { email: 'not-an-email' }],
    ['empty response note', { responseNote: '' }],
    ['blank response note', { responseNote: '   ' }],
    ['response note with 61 characters', { responseNote: 'a'.repeat(61) }],
  ])('rejects %s', (_name, change) => {
    expect(siteContactSchema.safeParse({ ...DEFAULT_SITE_CONTACT, ...change }).success).toBe(false);
  });

  it('accepts a response note with 60 characters', () => {
    const body = { ...DEFAULT_SITE_CONTACT, responseNote: 'a'.repeat(60) };
    expect(siteContactSchema.safeParse(body).success).toBe(true);
  });
});
