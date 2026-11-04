import type { PanelContext, PanelCounts } from '@alocidadao/shared';
import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import simbolo from '../assets/simbolo.png';
import { LegalLinks } from '../legal/LegalLinks';
import { NotificationBell } from './NotificationBell';
import { initialsOf, MENU_GROUPS, roleLabel } from './menu';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  context: PanelContext;
  counts: PanelCounts | undefined;
  onSignOut: () => void;
  /** Modo suporte: a caixa do usuário mostra `Equipe Alô Cidadão` e não tem `Sair`. */
  support?: boolean;
}

export function Sidebar({ context, counts, onSignOut, support = false }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img src={simbolo} alt="" className={styles.logo} />
        <div className={styles.brandText}>
          <span className={styles.brandName}>Alô Cidadão</span>
          <span className={styles.tenant}>{context.tenant.displayName}</span>
        </div>
        <NotificationBell />
      </div>

      <nav className={styles.nav}>
        {MENU_GROUPS.map((group, index) => (
          <div key={group.heading ?? index} className={styles.group}>
            {group.heading ? <p className={styles.heading}>{group.heading}</p> : null}
            {group.items
              .filter((item) => !item.adminOnly || context.role === 'tenant_admin')
              .map((item) => {
                const count = item.counter ? counts?.[item.counter.key] : undefined;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
                  >
                    <item.icon size={20} className={styles.itemIcon} />
                    <span className={styles.itemLabel}>{item.label}</span>
                    {item.counter && count ? (
                      <span className={`${styles.counter} ${styles[item.counter.tone]}`}>
                        {count}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
          </div>
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
            {support ? 'Equipe Alô Cidadão' : roleLabel(context)}
          </span>
        </div>
        {support ? null : (
          <button type="button" className={styles.signOut} aria-label="Sair" onClick={onSignOut}>
            <LogOut size={18} />
          </button>
        )}
      </div>
      <LegalLinks />
    </aside>
  );
}
