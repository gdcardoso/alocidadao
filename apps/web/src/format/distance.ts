/** Distância em metros (`350 m`) ou, a partir de 1 km, em quilômetros com uma casa (`1,1 km`). */
export function formatDistance(meters: number): string {
  const rounded = Math.round(meters);
  if (rounded < 1000) return `${rounded} m`;
  const km = Math.round(meters / 100) / 10;
  return `${String(km).replace('.', ',')} km`;
}
