import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { TopBar } from '../../ui/TopBar';
import { useBackofficeContext } from '../use-backoffice-context';
import { AuditView } from './AuditView';
import styles from './AuditPage.module.css';

const LIST_PATH = '/backoffice/prefeituras';

const pageFrame = (filters: ReactNode, content: ReactNode) => (
  <>
    <TopBar title="Auditoria" subtitle="O que a equipe fez no backoffice" filters={filters} />
    <main className={styles.content}>{content}</main>
  </>
);

/** P7 · Auditoria: o que a equipe fez no backoffice. Só o Admin; o Suporte volta para as prefeituras. */
export function AuditPage() {
  const context = useBackofficeContext();
  const isAdmin = context.data?.platformRole === 'admin';
  if (context.data && !isAdmin) return <Navigate to={LIST_PATH} replace />;

  return <AuditView enabled={isAdmin} frame={pageFrame} />;
}
