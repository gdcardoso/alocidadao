export const teamsKey = (tenantId: string) => ['teams', tenantId] as const;
export const agentsKey = (tenantId: string, teamId: string) =>
  ['teams', tenantId, 'agents', teamId] as const;
