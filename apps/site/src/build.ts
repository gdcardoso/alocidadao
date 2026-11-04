import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_DOCUMENTS } from '@alocidadao/shared';
import { renderHome, renderLegalPage } from './render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dist, path)), { recursive: true });
  await writeFile(join(dist, path), content);
}

await write('index.html', renderHome());
for (const doc of Object.values(LEGAL_DOCUMENTS)) {
  await write(`${doc.slug}/index.html`, renderLegalPage(doc));
}
await cp(join(root, 'src', 'styles.css'), join(dist, 'styles.css'));
