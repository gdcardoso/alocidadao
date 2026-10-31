import { AuditView } from '../../audit/AuditView';
import type { TenantTabProps } from '../tenant-tabs';

/** Aba Auditoria da P3 (só o Admin, já conferido pela página): a auditoria da prefeitura. */
export function AuditTab({ tenant }: TenantTabProps) {
  return <AuditView enabled tenantId={tenant.id} />;
}
