import type { ImpedimentReason } from '@alocidadao/shared';
import { Ban, CircleEllipsis, Landmark, PackageX, Users, type LucideIcon } from 'lucide-react';

/** Ícones dos motivos de impedimento (os mesmos do app do agente). */
export const REASON_ICONS: Record<ImpedimentReason, LucideIcon> = {
  missing_material: PackageX,
  inaccessible: Ban,
  needs_other_team: Users,
  not_municipal: Landmark,
  other: CircleEllipsis,
};
