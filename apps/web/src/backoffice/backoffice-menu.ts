import { Building2, Globe, MapPinned, ScrollText, ShieldUser, type LucideIcon } from 'lucide-react';

export interface BackofficeMenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Só o Admin vê o item (o Suporte não entra na P6 nem na P7). */
  adminOnly?: boolean;
}

/** Itens do menu escuro do backoffice (componente `mQMT4` do Pencil). */
export const BACKOFFICE_MENU: BackofficeMenuItem[] = [
  { to: '/backoffice/prefeituras', label: 'Prefeituras', icon: Building2 },
  { to: '/backoffice/interesse', label: 'Interesse por cidade', icon: MapPinned },
  { to: '/backoffice/equipe', label: 'Equipe Alô Cidadão', icon: ShieldUser, adminOnly: true },
  { to: '/backoffice/site', label: 'Site', icon: Globe, adminOnly: true },
  { to: '/backoffice/auditoria', label: 'Auditoria', icon: ScrollText, adminOnly: true },
];
