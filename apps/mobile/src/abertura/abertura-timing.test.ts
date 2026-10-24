import { describe, expect, it } from 'vitest';
import { aberturaLogoFrame, MIN_ABERTURA_MS, minimumSplash } from './abertura-timing';

describe('minimumSplash', () => {
  it('waits for the minimum time even when ready', () =>
    expect(minimumSplash(1000, 1500, true)).toEqual({ done: false, waitMs: 1000 }));
  it('finishes once ready and the minimum time has passed', () =>
    expect(minimumSplash(1000, 1000 + MIN_ABERTURA_MS, true)).toEqual({ done: true, waitMs: 0 }));
  it('keeps waiting while not ready, even after the minimum time', () =>
    expect(minimumSplash(0, 10_000, false)).toEqual({ done: false, waitMs: 0 }));
  it('accepts a custom minimum', () =>
    expect(minimumSplash(0, 100, true, 300)).toEqual({ done: false, waitMs: 200 }));
});

describe('aberturaLogoFrame', () => {
  it('matches the Pencil frame at 390x844', () =>
    expect(aberturaLogoFrame(390, 844)).toEqual({ width: 300, height: 130, left: 45, top: 250 }));
  it('scales with the width and keeps the logo centered', () => {
    const f = aberturaLogoFrame(780, 1688);
    expect(f).toEqual({ width: 600, height: 260, left: 90, top: 500 });
  });
  it('keeps the relative height on taller screens', () => {
    const f = aberturaLogoFrame(390, 1688);
    expect(f.top).toBe(500);
    expect(f.left).toBe(45);
  });
});
