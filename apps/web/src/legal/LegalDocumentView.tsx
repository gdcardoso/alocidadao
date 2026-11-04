import type { LegalDocument } from '@alocidadao/shared';
import styles from './LegalDocumentView.module.css';

/** Mostra um documento legal: aviso, versão e seções com parágrafos e listas. */
export function LegalDocumentView({ document }: { document: LegalDocument }) {
  return (
    <>
      <p className={styles.notice}>{document.notice}</p>
      <p className={styles.version}>Versão {document.version}</p>
      {document.sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h3 className={styles.heading}>{section.heading}</h3>
          {section.blocks.map((block, index) =>
            block.kind === 'paragraph' ? (
              <p key={index} className={styles.text}>
                {block.text}
              </p>
            ) : (
              <ul key={index} className={styles.list}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </>
  );
}
