import type { ReactNode } from 'react';
import styles from './Badge.module.css';

/**
 * Tons das etiquetas do Pencil:
 * - `muted`: fundo `border`, texto secundário (status + tempo);
 * - `subtle`: fundo `bg` (relatos, raio);
 * - `warning`: `warning-soft` (sugestão, motivo de impedimento);
 * - `success`: `success-soft` ("Ativo");
 * - `primary`: `primary-soft`;
 * - `dark`: `text-primary` com texto branco ("Admin").
 */
export type BadgeTone = 'muted' | 'subtle' | 'warning' | 'success' | 'primary' | 'dark';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Ícone de 14 px à esquerda (lucide-react). */
  icon?: ReactNode;
  children: ReactNode;
}

export function Badge({ tone = 'muted', icon, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {icon}
      {children}
    </span>
  );
}
