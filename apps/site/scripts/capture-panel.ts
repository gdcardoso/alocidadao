/**
 * Captura do mapa do painel para a página de apresentação (`public/img/painel-mapa.webp`).
 *
 * Entra como o gestor do seed de Goiânia (CPF fictício, código fixo de desenvolvimento), passa pelo
 * aceite dos Termos se ele aparecer, abre o mapa a 1440×900 e grava a imagem em WebP. Não usa o
 * modo suporte (a faixa "Você está na … como equipe Alô Cidadão" não pode aparecer).
 *
 * Uso: com a API e o painel web no ar (`pnpm dev`), rode antes `demo:scenario` e depois
 * `pnpm --filter @alocidadao/site capture:panel`. Variáveis opcionais:
 * - `PANEL_URL` (padrão `http://localhost:5173`);
 * - `DEV_CODE` (padrão `123456`, o `AUTH_DEV_FIXED_CODE` do `.env` da API);
 * - `CWEBP` (padrão `cwebp` no PATH).
 *
 * Precisa do Chromium do Playwright (`npx playwright install chromium`) e do `cwebp`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const PANEL_URL = process.env.PANEL_URL ?? 'http://localhost:5173';
const DEV_CODE = process.env.DEV_CODE ?? '123456';
const CWEBP = process.env.CWEBP ?? 'cwebp';

/** CPF do gestor do seed (packages/db/src/seed-dev-data.ts), nome fictício "Carlos Demo". */
const MANAGER_CPF = '52998224725';

const VIEWPORT = { width: 1440, height: 900 };
/** Captura em 2x e reduz para 1,5x: nítida em tela retina sem pesar demais. */
const SCALE = 2;
const OUTPUT_SIZE = { width: 2160, height: 1350 };
const OUTPUT = fileURLToPath(new URL('../public/img/painel-mapa.webp', import.meta.url));

/** Espera a rede e o desenho dos blocos do mapa. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2_500);
}

/** Cor do grupo de pinos com atraso (`PIN_COLORS.danger` do painel). */
const CLUSTER_RGB = [0xb9, 0x1c, 0x1c] as const;
/** Menos pixels que isto é um pino solto, não um grupo. */
const CLUSTER_MIN_PIXELS = 1_500;

/**
 * Acha na tela o maior grupo vermelho de pinos (o mapa é um canvas, sem elementos para clicar):
 * fotografa o canvas, lê os pixels na própria página e devolve o centro da cor do grupo, fora da
 * legenda. `null` quando não há grupo grande.
 */
async function findCluster(page: Page): Promise<{ x: number; y: number } | null> {
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) return null;
  const legend = await page.getByText('Situação do prazo').locator('..').boundingBox();
  const shot = await canvas.screenshot({ scale: 'css' });
  const found = await page.evaluate(
    async ({ data, rgb, legendBox }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const draw = document.createElement('canvas');
      draw.width = image.width;
      draw.height = image.height;
      const context = draw.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          if (
            legendBox &&
            x >= legendBox.x &&
            x <= legendBox.x + legendBox.width &&
            y >= legendBox.y &&
            y <= legendBox.y + legendBox.height
          ) {
            continue;
          }
          const i = (y * image.width + x) * 4;
          const near =
            Math.abs(pixels[i]! - rgb[0]) < 24 &&
            Math.abs(pixels[i + 1]! - rgb[1]) < 24 &&
            Math.abs(pixels[i + 2]! - rgb[2]) < 24;
          if (near) {
            count += 1;
            sumX += x;
            sumY += y;
          }
        }
      }
      return count === 0 ? null : { x: sumX / count, y: sumY / count, count };
    },
    {
      data: shot.toString('base64'),
      rgb: CLUSTER_RGB,
      legendBox: legend && {
        x: legend.x - box.x,
        y: legend.y - box.y,
        width: legend.width,
        height: legend.height,
      },
    },
  );
  if (!found || found.count < CLUSTER_MIN_PIXELS) return null;
  return { x: box.x + found.x, y: box.y + found.y };
}

async function main() {
  const browser = await chromium.launch();
  const work = mkdtempSync(join(tmpdir(), 'capture-panel-'));
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    // Login pelo CPF e pelo código fixo.
    await page.goto(`${PANEL_URL}/entrar`);
    await page.getByLabel('CPF').fill(MANAGER_CPF);
    await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.getByLabel('Dígito 1 de 6').click();
    await page.keyboard.type(DEV_CODE);
    const enter = page.getByRole('button', { name: 'Entrar', exact: true });
    // O código completo pode entrar sozinho; se o botão ainda estiver lá, clica.
    if (await enter.isVisible().catch(() => false)) await enter.click().catch(() => undefined);

    // Aceite dos Termos, se a conta ainda não aceitou.
    const terms = page.getByRole('heading', { name: 'Antes de continuar' });
    const map = page.locator('.maplibregl-canvas');
    await Promise.race([terms.waitFor({ timeout: 30_000 }), map.waitFor({ timeout: 30_000 })]);
    if (await terms.isVisible()) {
      await page.getByRole('button', { name: 'Termos de Uso' }).click();
      await page.getByRole('button', { name: 'Li e concordo' }).click();
      await page.getByRole('button', { name: 'Continuar' }).click();
    }

    // Mapa de Goiânia com os pinos.
    if (!page.url().includes('/mapa')) await page.goto(`${PANEL_URL}/mapa`);
    await map.waitFor({ timeout: 30_000 });
    await settle(page);

    // A cidade inteira cabe na tela e os pinos do centro viram um grupo só. Clicar no grupo
    // aproxima (como faria o gestor) até os pinos aparecerem separados pelas cores do prazo.
    for (let step = 0; step < 2; step += 1) {
      const cluster = await findCluster(page);
      if (!cluster) break;
      await page.mouse.click(cluster.x, cluster.y);
      await settle(page);
    }

    if (await page.getByText('como equipe Alô Cidadão').isVisible()) {
      throw new Error('O painel está no modo suporte; a captura precisa do gestor da prefeitura.');
    }
    if (!(await page.getByText('Goiânia').first().isVisible())) {
      throw new Error('O painel não mostra a Prefeitura de Goiânia.');
    }

    const png = join(work, 'painel-mapa.png');
    await page.screenshot({ path: png });
    execFileSync(CWEBP, [
      '-quiet',
      '-q',
      '82',
      '-resize',
      String(OUTPUT_SIZE.width),
      String(OUTPUT_SIZE.height),
      png,
      '-o',
      OUTPUT,
    ]);
    const kb = Math.round(statSync(OUTPUT).size / 1024);
    console.log(`Gravado: ${OUTPUT} (${OUTPUT_SIZE.width}×${OUTPUT_SIZE.height}, ${kb} KB)`);
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
