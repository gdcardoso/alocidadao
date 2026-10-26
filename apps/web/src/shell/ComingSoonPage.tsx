import { TopBar } from '../ui/TopBar';
import styles from './ComingSoonPage.module.css';

/** Página provisória dos itens de menu que chegam no 5b. */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <TopBar title={title} />
      <div className={styles.body}>
        <p className={styles.text}>Esta tela chega na próxima etapa do painel.</p>
      </div>
    </>
  );
}
