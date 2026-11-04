import { readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Caminhos de todos os arquivos que o build copia de `public/` para `dist/`. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('public/ (copied as-is into dist/)', () => {
  it('has no demo-only JPEG sources and no markdown notes', () => {
    const files = listFiles(publicDir);
    expect(files.length).toBeGreaterThan(0);
    const forbidden = files.filter((file) => ['.jpg', '.jpeg', '.md'].includes(extname(file)));
    expect(forbidden).toEqual([]);
  });
});
