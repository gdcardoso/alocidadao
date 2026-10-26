import { NavLink } from 'react-router';
import styles from './Tabs.module.css';

export interface TabsProps {
  items: { to: string; label: string }[];
}

/** Abas da W6: links com a ativa em `primary` e sublinhado de 3. */
export function Tabs({ items }: TabsProps) {
  return (
    <nav className={styles.tabs} aria-label="Seções">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
