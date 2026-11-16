import type { BrowserClient } from '@alocidadao/shared';
import Bowser from 'bowser';

/** Tamanho máximo de cada campo guardado, como em `browserClientSchema`. */
const MAX_LENGTH = 64;

const cut = (value: string | undefined) => (value ? value.slice(0, MAX_LENGTH) : null);

/**
 * Navegador e sistema do painel, lidos do User-Agent. Guarda só o resultado, nunca o texto
 * bruto. Sem texto, ou sem navegador nem sistema reconhecidos (curl, robôs), devolve null.
 * O Chrome e o Edge congelam a versão do sistema (Windows 11 aparece como NT 10.0).
 */
export function parseUserAgent(userAgent: string | undefined): BrowserClient | null {
  if (!userAgent) return null;
  const { browser, os } = Bowser.parse(userAgent);
  if (!browser.name && !os.name) return null;
  return {
    browser: cut(browser.name),
    browserVersion: cut(browser.version),
    os: cut(os.name),
    osVersion: cut(os.version),
  };
}
