import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_DOCUMENTS } from '@alocidadao/shared';
import { loadBuildContact } from './load-contact.js';
import { renderHome, renderLegalPage } from './render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const require = createRequire(import.meta.url);

/** Arquivos `woff2` (subconjunto latino) copiados dos pacotes @fontsource para `dist/fonts/`. */
const FONTS: Array<{ pkg: string; file: string }> = [
  ...[500, 600, 700, 800].map((weight) => ({
    pkg: '@fontsource/lexend',
    file: `lexend-latin-${weight}-normal.woff2`,
  })),
  ...[400, 600].map((weight) => ({
    pkg: '@fontsource/source-sans-3',
    file: `source-sans-3-latin-${weight}-normal.woff2`,
  })),
];

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dist, path)), { recursive: true });
  await writeFile(join(dist, path), content);
}

const apiUrl = process.env.SITE_API_URL?.trim() || undefined;
const contact = await loadBuildContact(apiUrl);

await rm(dist, { recursive: true, force: true });
await write('index.html', renderHome(contact, { apiUrl }));
for (const doc of Object.values(LEGAL_DOCUMENTS)) {
  await write(`${doc.slug}/index.html`, renderLegalPage(doc));
}
for (const css of ['styles.css', 'home.css', 'fonts.css']) {
  await copyFile(join(root, 'src', css), join(dist, css));
}
await cp(join(root, 'public'), dist, { recursive: true });
await mkdir(join(dist, 'fonts'), { recursive: true });
for (const font of FONTS) {
  const pkgDir = dirname(require.resolve(`${font.pkg}/package.json`));
  await copyFile(join(pkgDir, 'files', font.file), join(dist, 'fonts', font.file));
}
