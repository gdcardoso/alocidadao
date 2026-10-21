import { z } from 'zod';

export const ROLES = [
  'citizen',
  'field_agent',
  'manager',
  'tenant_admin',
  'platform_admin',
] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Roles scoped to a single prefeitura (tenant). */
export const TENANT_ROLES = [
  'citizen',
  'field_agent',
  'manager',
  'tenant_admin',
] as const satisfies readonly Role[];

/** Actor that can trigger a transition: a role, or the system itself (scheduled jobs). */
export type Actor = Role | 'system';
