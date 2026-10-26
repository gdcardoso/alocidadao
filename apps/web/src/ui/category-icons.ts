import { CATEGORY_ICON_OPTIONS } from '@alocidadao/shared';
import {
  CircleEllipsis,
  Construction,
  Droplets,
  Footprints,
  Lightbulb,
  PawPrint,
  Signpost,
  Trash2,
  Trees,
  type LucideIcon,
} from 'lucide-react';

/** Componente de cada chave de `CATEGORY_ICON_OPTIONS`; o `Record` obriga a cobrir todas. */
const COMPONENTS: Record<string, LucideIcon> = {
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

/**
 * Ícones das categorias, pelo nome em kebab-case guardado na categoria. As chaves vêm de
 * `CATEGORY_ICON_OPTIONS` (fonte única); o mapa explícito de componentes evita levar os ~1500
 * ícones do lucide. Chave sem componente ou desconhecida cai em `circle-ellipsis`.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((option) => [option.key, COMPONENTS[option.key] ?? CircleEllipsis]),
);

export function categoryIconFor(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? CircleEllipsis;
}
