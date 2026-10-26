import { PLATFORM_ROLE_LABELS, type BackofficeContext } from '@alocidadao/shared';
import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import simbolo from '../assets/simbolo.png';
import { initialsOf } from '../shell/menu';
import { BACKOFFICE_MENU } from './backoffice-menu';
import styles from './BackofficeSidebar.module.css';

export interface BackofficeSidebarProps {
  context: BackofficeContext;
  onSignOut: () => void;
}

export function BackofficeSidebar({ context, onSignOut }: BackofficeSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logoBox}>
          <img src={simbolo} alt="" className={styles.logo} />
        </span>
        <div className={styles.brandText}>
          <span className={styles.brandName}>Alô Cidadão</span>
          <span className={styles.brandSub}>Backoffice</span>
        </div>
      </div>

      <nav className={styles.nav}>
        {BACKOFFICE_MENU.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
          >
            <item.icon size={20} className={styles.itemIcon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.user}>
        <span className={styles.avatar} aria-hidden="true">
          {initialsOf(context.user.name)}
        </span>
        <div className={styles.userText}>
          <span className={styles.userName}>{context.user.name}</span>
          <span className={styles.userRole}>
            {PLATFORM_ROLE_LABELS[context.platformRole]} · Alô Cidadão
          </span>
        </div>
        <button type="button" className={styles.signOut} aria-label="Sair" onClick={onSignOut}>
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}
