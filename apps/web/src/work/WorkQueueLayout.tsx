import type { WorkQueueItem } from '@alocidadao/shared';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import styles from './WorkQueueLayout.module.css';

export interface WorkQueueLayoutProps {
  items: WorkQueueItem[];
  renderCard: (item: WorkQueueItem, selected: boolean) => ReactNode;
  renderDetail: (workOrderId: string) => ReactNode;
  /** Texto de quando a fila está vazia. */
  empty: string;
}

/**
 * Mestre-detalhe da W3 e da W4: fila de 360 à esquerda e detalhe no resto. A URL guarda o item
 * aberto (`?atividade=`). Sem item na URL, ou com um que saiu da fila depois de aberto aqui
 * (publicado, devolvido, decidido), abre o que ocupa o lugar dele: o próximo, ou o último se era
 * o fim da fila. Um id que nunca esteve na fila (link do sino de uma atividade que já saiu) não
 * abre outra atividade: o detalhe avisa e a fila segue usável.
 */
export function WorkQueueLayout({ items, renderCard, renderDetail, empty }: WorkQueueLayoutProps) {
  const [params, setParams] = useSearchParams();
  const [lastIndex, setLastIndex] = useState(0);
  // Último id da URL que foi encontrado na fila: distingue "saiu depois de aberto" de "nunca esteve".
  const [seenId, setSeenId] = useState<string | null>(null);
  const urlId = params.get('atividade');

  const fromUrl = items.findIndex((item) => item.workOrderId === urlId);
  const gone = urlId !== null && fromUrl < 0 && urlId !== seenId && items.length > 0;
  const index = fromUrl >= 0 ? fromUrl : gone ? -1 : Math.min(lastIndex, items.length - 1);
  const selected = items[index];
  const selectedId = selected?.workOrderId ?? null;

  // Guarda a posição aberta (ajuste de estado durante a renderização).
  if (index >= 0 && index !== lastIndex) setLastIndex(index);
  if (fromUrl >= 0 && urlId !== seenId) setSeenId(urlId);

  // Mantém a URL com o item aberto (sem empilhar histórico).
  useEffect(() => {
    if (selectedId && selectedId !== urlId) {
      const next = new URLSearchParams(params);
      next.set('atividade', selectedId);
      setParams(next, { replace: true });
    }
  }, [selectedId, urlId, params, setParams]);

  function open(id: string) {
    const next = new URLSearchParams(params);
    next.set('atividade', id);
    setParams(next, { replace: true });
  }

  if (items.length === 0) {
    return <p className={styles.empty}>{empty}</p>;
  }

  return (
    <div className={styles.layout}>
      <ul className={styles.queue}>
        {items.map((item) => {
          const isSelected = item.workOrderId === selectedId;
          return (
            <li key={item.workOrderId}>
              <button
                type="button"
                className={styles.card}
                data-selected={isSelected}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => open(item.workOrderId)}
              >
                {renderCard(item, isSelected)}
              </button>
            </li>
          );
        })}
      </ul>
      <section className={styles.detail}>
        {selectedId ? (
          renderDetail(selectedId)
        ) : gone ? (
          <p className={styles.empty}>Esta atividade já saiu da fila.</p>
        ) : null}
      </section>
    </div>
  );
}
