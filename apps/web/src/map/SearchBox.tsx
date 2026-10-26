import { PANEL_OCCURRENCE_STATUS_LABELS, type PanelSearchResult } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Badge } from '../ui/Badge';
import { isSearchable } from './map-query';
import styles from './MapPage.module.css';

const DEBOUNCE_MS = 300;

function resultLabel(item: PanelSearchResult): string {
  return [item.protocol, item.categoryName, item.address].filter(Boolean).join(' · ');
}

/** Em triagem e em atendimento primeiro; dentro de cada grupo, a ordem que a API devolveu. */
function byWorkingFirst(items: readonly PanelSearchResult[]): PanelSearchResult[] {
  const working = (item: PanelSearchResult) =>
    item.status === 'triage' || item.status === 'in_progress';
  return [...items.filter(working), ...items.filter((item) => !working(item))];
}

export interface SearchBoxProps {
  onSelect: (item: PanelSearchResult) => void;
}

/** Busca de endereço ou protocolo (300x40), com até 10 resultados embaixo. */
export function SearchBox({ onSelect }: SearchBoxProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = isSearchable(term);
  const query = useQuery({
    queryKey: ['panel', 'search', tenantId, term],
    queryFn: () => session.withAuth(() => api.panelSearch(tenantId, term)),
    enabled,
    staleTime: 30_000,
  });
  const items = enabled ? byWorkingFirst(query.data?.items ?? []) : [];
  const showList = open && enabled && query.isSuccess;

  function choose(item: PanelSearchResult) {
    onSelect(item);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!showList || items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      const item = items[active] ?? items[0];
      if (item) choose(item);
    }
  }

  return (
    <div className={styles.search}>
      <div className={styles.searchBox}>
        <Search size={16} aria-hidden="true" className={styles.searchIcon} />
        <input
          type="search"
          role="combobox"
          aria-label="Buscar endereço ou protocolo"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Buscar endereço ou protocolo"
          className={styles.searchInput}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList ? (
        <ul id={listId} role="listbox" className={styles.searchResults}>
          {items.length === 0 ? (
            <li className={styles.searchEmpty}>{`Nada encontrado para "${term}".`}</li>
          ) : (
            items.map((item, index) => (
              <li
                key={item.occurrenceId + item.protocol}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={styles.searchResult}
                // Antes do blur do campo, para o clique valer.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
              >
                <span className={styles.searchResultText}>{resultLabel(item)}</span>
                <Badge>{PANEL_OCCURRENCE_STATUS_LABELS[item.status]}</Badge>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
