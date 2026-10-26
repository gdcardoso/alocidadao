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

/**
 * Ícones das categorias, pelo nome em kebab-case guardado na categoria. Mapa explícito, só
 * com os ícones do seed, para o pacote não levar os ~1500 ícones do lucide (o `icons` e o
 * `DynamicIcon` os carregam todos). Categoria nova com outro ícone: acrescentar aqui; até lá,
 * cai em `circle-ellipsis`.
 */
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

export function categoryIconFor(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? CircleEllipsis;
}
