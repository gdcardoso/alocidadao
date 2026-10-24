import { describe, expect, it } from 'vitest';
import { keyboardHeightOnMount } from './keyboard-height';

describe('keyboardHeightOnMount', () => {
  it('uses the keyboard that is already open when the screen mounts', () =>
    // Ex.: Entrar → Código: o teclado do celular continua aberto na tela nova.
    expect(keyboardHeightOnMount(true, { height: 840 })).toBe(840));
  it('is zero when the keyboard is closed', () =>
    expect(keyboardHeightOnMount(false, { height: 840 })).toBe(0));
  it('is zero when the metrics are not known yet', () =>
    expect(keyboardHeightOnMount(true, undefined)).toBe(0));
});
