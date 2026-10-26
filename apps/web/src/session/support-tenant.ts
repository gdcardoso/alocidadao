/** Prefeitura em que a equipe interna está no modo suporte. */
export interface SupportTenant {
  tenantId: string;
  displayName: string;
}

export const SUPPORT_TENANT_KEY = 'ac_support_tenant';

/** Lê a prefeitura do modo suporte; valor ausente, ilegível ou fora do formato dá `null`. */
export function getSupportTenant(): SupportTenant | null {
  try {
    const raw = sessionStorage.getItem(SUPPORT_TENANT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SupportTenant> | null;
    if (typeof value?.tenantId === 'string' && typeof value.displayName === 'string') {
      return { tenantId: value.tenantId, displayName: value.displayName };
    }
  } catch {
    // sessionStorage indisponível ou JSON inválido: sem modo suporte.
  }
  return null;
}

export function setSupportTenant(value: SupportTenant): void {
  try {
    sessionStorage.setItem(SUPPORT_TENANT_KEY, JSON.stringify(value));
  } catch {
    // sem armazenamento, o modo suporte vale só até recarregar.
  }
}

export function clearSupportTenant(): void {
  try {
    sessionStorage.removeItem(SUPPORT_TENANT_KEY);
  } catch {
    // nada a apagar.
  }
}
