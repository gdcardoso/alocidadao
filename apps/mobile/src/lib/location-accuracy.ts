/**
 * Precisão informada pelo GPS em metros. Alguns aparelhos devolvem valor negativo ou não
 * finito: vira `null`, para a ação nunca ser recusada pela API (400) por causa dela.
 */
export function toAccuracyM(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
