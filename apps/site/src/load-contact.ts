import { DEFAULT_SITE_CONTACT, siteContactSchema, type SiteContact } from '@alocidadao/shared';

/** Aviso no terminal quando o build não consegue o contato da API. */
export const FALLBACK_WARNING =
  'Aviso: contato do site com os valores iniciais (API indisponível).';

/** Tempo máximo de espera pela API, no build e na página. */
export const CONTACT_TIMEOUT_MS = 3000;

/** Endereço da rota pública do contato, sem barra duplicada. */
export function siteContactUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/public/site-contact`;
}

/**
 * Contato gravado no HTML no build: vem da rota pública quando `SITE_API_URL` existe e responde
 * em até 3 s com um contato válido; senão, os valores iniciais (o build nunca falha por isso).
 */
export async function loadBuildContact(
  apiUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<SiteContact> {
  if (!apiUrl) {
    console.warn(FALLBACK_WARNING);
    return DEFAULT_SITE_CONTACT;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, CONTACT_TIMEOUT_MS);
  });
  const request = (async (): Promise<SiteContact | null> => {
    const response = await fetchFn(siteContactUrl(apiUrl), { signal: controller.signal });
    if (!response.ok) return null;
    const parsed = siteContactSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  })().catch(() => null);
  try {
    const contact = await Promise.race([request, timeout]);
    if (contact) return contact;
  } finally {
    clearTimeout(timer);
  }
  console.warn(FALLBACK_WARNING);
  return DEFAULT_SITE_CONTACT;
}
