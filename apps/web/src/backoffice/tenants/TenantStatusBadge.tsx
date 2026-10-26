import { TENANT_STATUS_LABELS, type TenantStatus } from '@alocidadao/shared';
import { Badge, type BadgeTone } from '../../ui/Badge';

const TONES: Record<TenantStatus, BadgeTone> = {
  active: 'success',
  onboarding: 'primary',
  suspended: 'muted',
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  return <Badge tone={TONES[status]}>{TENANT_STATUS_LABELS[status]}</Badge>;
}
