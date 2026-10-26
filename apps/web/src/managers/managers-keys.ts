export const managersKey = (tenantId: string) => ['managers', tenantId] as const;
/** Mesma chave e mesmo formato da lista de setores usada pelas equipes. */
export const departmentsKey = (tenantId: string) => ['departments', tenantId] as const;
