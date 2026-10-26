import type { PanelContext, PanelCounts } from '@alocidadao/shared';
import {
  ClipboardCheck,
  HardHat,
  Inbox,
  List,
  Map as MapIcon,
  OctagonAlert,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';

type CounterKey = keyof PanelCounts;

interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Só o admin da prefeitura vê o item. */
  adminOnly?: boolean;
  counter?: { key: CounterKey; tone: 'primary' | 'warning' | 'danger' };
}

interface MenuGroup {
  heading?: string;
  items: MenuItem[];
}

/** Itens, na ordem da seção 1.1 da spec do Pencil. */
export const MENU_GROUPS: MenuGroup[] = [
  { items: [{ to: '/mapa', label: 'Mapa', icon: MapIcon }] },
  {
    heading: 'Filas',
    items: [
      {
        to: '/triagem',
        label: 'Triagem',
        icon: Inbox,
        counter: { key: 'triage', tone: 'primary' },
      },
      {
        to: '/revisao',
        label: 'Aguardando revisão',
        icon: ClipboardCheck,
        counter: { key: 'awaitingReview', tone: 'warning' },
      },
      {
        to: '/impedimentos',
        label: 'Impedimentos',
        icon: OctagonAlert,
        counter: { key: 'impeded', tone: 'danger' },
      },
    ],
  },
  {
    heading: 'Acompanhar',
    items: [
      { to: '/em-atendimento', label: 'Em atendimento', icon: HardHat },
      { to: '/solicitacoes', label: 'Todas as solicitações', icon: List },
    ],
  },
  {
    heading: 'Configurar',
    items: [
      { to: '/equipes', label: 'Equipes e agentes', icon: Users },
      { to: '/categorias', label: 'Categorias', icon: Tags, adminOnly: true },
    ],
  },
];

/** Iniciais das duas primeiras palavras do nome. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** `Admin da prefeitura`, `Gestor · Obras, Limpeza` ou só `Gestor`. */
export function roleLabel(context: PanelContext): string {
  if (context.role === 'tenant_admin') return 'Admin da prefeitura';
  if (context.departments.length === 0) return 'Gestor';
  return `Gestor · ${context.departments.map((department) => department.name).join(', ')}`;
}
