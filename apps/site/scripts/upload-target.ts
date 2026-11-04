/**
 * Destino do envio da foto. A API assina a URL com o endpoint que o aparelho enxerga (no emulador
 * Android, `10.0.2.2:9000`), que este computador pode não alcançar. O envio vai então para
 * `endpoint` (ex.: `http://localhost:9000`), mas com o `Host` assinado, senão a assinatura falha.
 */
export function uploadTarget(
  signedUrl: string,
  endpoint: string | undefined,
): { url: string; host: string } {
  const signed = new URL(signedUrl);
  if (!endpoint) return { url: signedUrl, host: signed.host };
  const local = new URL(endpoint);
  if (local.origin === signed.origin) return { url: signedUrl, host: signed.host };
  return {
    url: `${local.origin}${signed.pathname}${signed.search}`,
    host: signed.host,
  };
}
