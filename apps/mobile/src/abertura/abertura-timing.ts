/** Tempo mínimo da tela 0 na tela, contado de quando ela aparece. */
export const MIN_ABERTURA_MS = 1500;

/** Moldura da tela 0 no Pencil: 390x844, logo 300x130 em x=45, y=250. */
const FRAME = { width: 390, height: 844 };
const LOGO = { x: 45, y: 250, width: 300, height: 130 };

export interface SplashState {
  /** A abertura já pode sair (tempo mínimo cumprido e app pronto). */
  done: boolean;
  /** Quanto falta do tempo mínimo, em ms (0 quando já passou). */
  waitMs: number;
}

/**
 * Decide se a abertura pode sair: fica pelo menos `minMs` desde `startedAt` ou até o app
 * ficar pronto, o que vier depois.
 */
export function minimumSplash(
  startedAt: number,
  now: number,
  ready: boolean,
  minMs: number = MIN_ABERTURA_MS,
): SplashState {
  const waitMs = Math.max(0, startedAt + minMs - now);
  return { done: ready && waitMs === 0, waitMs };
}

/**
 * Posição da logo na tela do aparelho: escala a moldura do Pencil pela largura (a logo
 * mantém a proporção e fica centralizada) e mantém a altura relativa (250 de 844).
 */
export function aberturaLogoFrame(screenWidth: number, screenHeight: number) {
  const scale = screenWidth / FRAME.width;
  const width = LOGO.width * scale;
  return {
    width,
    height: LOGO.height * scale,
    left: (screenWidth - width) / 2,
    top: (LOGO.y / FRAME.height) * screenHeight,
  };
}
