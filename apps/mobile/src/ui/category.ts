import { REQUEST_STATUS_LABELS, type IconGroup, type RequestStatus } from '@alocidadao/shared';
import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleEllipsis,
  CircleX,
  Construction,
  Droplets,
  Footprints,
  HardHat,
  Inbox,
  Lightbulb,
  PawPrint,
  Signpost,
  Trash2,
  Trees,
  type LucideIcon,
} from 'lucide-react-native';
import { colors } from './theme';

/** Ícones do catálogo da demo, pelo nome Lucide gravado na categoria. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  construction: Construction,
  lightbulb: Lightbulb,
  'trash-2': Trash2,
  trees: Trees,
  droplets: Droplets,
  footprints: Footprints,
  signpost: Signpost,
  'paw-print': PawPrint,
  'circle-ellipsis': CircleEllipsis,
};

/** Componente do ícone da categoria; nome desconhecido ou vazio vira "Outro". */
export function categoryIcon(name: string | null): LucideIcon {
  return (name && CATEGORY_ICONS[name]) || CircleEllipsis;
}

export interface ColorPair {
  bg: string;
  fg: string;
}

const GROUP_COLORS: Record<IconGroup, ColorPair> = {
  infrastructure: { bg: colors.primary, fg: colors.onPrimary },
  environment: { bg: colors.brandGreen, fg: colors.onBrandGreen },
  public_services: { bg: colors.brandYellow, fg: colors.onBrandYellow },
};

/** Fundo e cor do ícone conforme o grupo da categoria. */
export function groupColors(group: IconGroup): ColorPair {
  return GROUP_COLORS[group];
}

export interface StatusBadgeStyle extends ColorPair {
  label: string;
  icon: LucideIcon;
}

const BADGES: Record<RequestStatus, Omit<StatusBadgeStyle, 'label'>> = {
  open: { icon: Inbox, bg: colors.border, fg: colors.textSecondary },
  in_progress: { icon: HardHat, bg: colors.primarySoft, fg: colors.primary },
  awaiting_confirmation: { icon: CircleAlert, bg: colors.warningSoft, fg: colors.warning },
  completed: { icon: CircleCheck, bg: colors.successSoft, fg: colors.success },
  // O Pencil não desenha cancelada: selo neutro, como aberta.
  cancelled: { icon: Ban, bg: colors.border, fg: colors.textSecondary },
  rejected: { icon: CircleX, bg: colors.dangerSoft, fg: colors.danger },
};

/** Selo de status da lista. Na lista, o pedido de confirmação fala com o cidadão. */
export function statusBadge(status: RequestStatus): StatusBadgeStyle {
  const label =
    status === 'awaiting_confirmation'
      ? 'Aguardando sua confirmação'
      : REQUEST_STATUS_LABELS[status];
  return { label, ...BADGES[status] };
}
