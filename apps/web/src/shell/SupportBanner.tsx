import { LogOut, ShieldUser } from 'lucide-react';
import styles from './SupportBanner.module.css';

export interface SupportBannerProps {
  displayName: string;
  pending?: boolean;
  onLeave: () => void;
}

/** Faixa de 44 no topo do painel quando a equipe interna está numa prefeitura. */
export function SupportBanner({ displayName, pending = false, onLeave }: SupportBannerProps) {
  return (
    <div className={styles.banner}>
      <ShieldUser size={18} className={styles.icon} aria-hidden />
      <span className={styles.text}>
        {`Você está na ${displayName} como equipe Alô Cidadão · suas ações ficam registradas na auditoria`}
      </span>
      <button type="button" className={styles.leave} disabled={pending} onClick={onLeave}>
        <LogOut size={14} aria-hidden />
        Sair da prefeitura
      </button>
    </div>
  );
}
