import { Check, X } from 'lucide-react';
import styles from './PhotoToggle.module.css';

export interface PhotoToggleProps {
  url: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * `publish`: miniatura grande com caixa e legenda `Publicar` / `Não publicar` (W3).
   * `discard`: miniatura menor, com o `x` vermelho quando marcada para descarte (W3b).
   */
  variant: 'publish' | 'discard';
  /** Nome acessível da caixa na variante `discard`. */
  label?: string;
}

/**
 * Foto com caixa de marcação. O `label` envolve a imagem: clicar nela alterna a caixa, que é o
 * caminho do teclado.
 */
export function PhotoToggle({ url, checked, onChange, variant, label }: PhotoToggleProps) {
  const publish = variant === 'publish';
  return (
    <label className={`${styles.photo} ${styles[variant]}`} data-checked={checked}>
      <span className={styles.frame} data-off={publish && !checked}>
        <img src={url} alt="" className={styles.image} />
        {!publish && checked ? (
          <span className={styles.discardMark} aria-hidden="true">
            <X size={14} />
          </span>
        ) : null}
      </span>
      <span className={styles.control}>
        <input
          type="checkbox"
          className={publish ? styles.box : styles.hidden}
          checked={checked}
          aria-label={label}
          onChange={(event) => onChange(event.target.checked)}
        />
        {publish ? (
          <>
            <span className={styles.boxFace} aria-hidden="true">
              {checked ? <Check size={14} /> : null}
            </span>
            {checked ? 'Publicar' : 'Não publicar'}
          </>
        ) : null}
      </span>
    </label>
  );
}
