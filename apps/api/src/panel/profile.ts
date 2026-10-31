import { withContext, type Database } from '@alocidadao/db';
import { tenantProfileSchema, type TenantProfile } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { panelDbContext, type PanelIdentity } from './member.js';

/**
 * Dados da prefeitura do contexto. A função `panel_tenant_profile` lê o contrato (que só a
 * equipe lê por RLS) e confere o vínculo ativo; devolve null sem permissão.
 */
export async function loadTenantProfile(
  db: Database,
  identity: PanelIdentity,
): Promise<TenantProfile | null> {
  const result = await withContext(db, panelDbContext(identity), (tx) =>
    tx.execute<{ profile: unknown }>(sql`select panel_tenant_profile() as profile`),
  );
  const profile = result.rows[0]?.profile;
  return profile ? tenantProfileSchema.parse(profile) : null;
}
