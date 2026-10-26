import type { IconGroup } from '@alocidadao/shared';
import { createElement } from 'react';
import { categoryIconFor } from './category-icons';
import styles from './CategorySquare.module.css';

export type CategorySquareSize = 32 | 36 | 44;

export interface CategorySquareProps {
  /** Nome lucide em kebab-case, como guardado na categoria. */
  icon: string;
  /** Grupo de cor: `infrastructure` primary, `environment` brand-green, `public_services` brand-yellow. */
  iconGroup: IconGroup;
  size?: CategorySquareSize;
}

const ICON_SIZE: Record<CategorySquareSize, number> = { 32: 18, 36: 18, 44: 22 };
const RADIUS: Record<CategorySquareSize, number> = { 32: 8, 36: 10, 44: 12 };

export function CategorySquare({ icon, iconGroup, size = 44 }: CategorySquareProps) {
  return (
    <span
      className={`${styles.square} ${styles[iconGroup]}`}
      style={{ width: size, height: size, borderRadius: RADIUS[size] }}
      aria-hidden="true"
    >
      {createElement(categoryIconFor(icon), { size: ICON_SIZE[size] })}
    </span>
  );
}
