import { Building2, MapPinned, ScrollText, ShieldUser, type LucideIcon } from 'lucide-react';

export interface BackofficeMenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Itens do menu escuro do backoffice (componente `mQMT4` do Pencil). */
export const BACKOFFICE_MENU: BackofficeMenuItem[] = [
  { to: '/backoffice/prefeituras', label: 'Prefeituras', icon: Building2 },
  { to: '/backoffice/interesse', label: 'Interesse por cidade', icon: MapPinned },
  { to: '/backoffice/equipe', label: 'Equipe Alô Cidadão', icon: ShieldUser },
  { to: '/backoffice/auditoria', label: 'Auditoria', icon: ScrollText },
];
