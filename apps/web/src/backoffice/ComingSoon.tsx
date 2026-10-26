import { TopBar } from '../ui/TopBar';

/** Página provisória das telas do backoffice que chegam nas próximas etapas. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <TopBar title={title} />
      <main style={{ padding: 24, color: 'var(--text-secondary)' }}>
        <p>Esta tela chega na próxima etapa do backoffice.</p>
      </main>
    </>
  );
}
