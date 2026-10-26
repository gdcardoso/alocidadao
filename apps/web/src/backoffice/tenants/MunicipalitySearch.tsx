import type { MunicipalityOption } from '@alocidadao/shared';
import { useEffect, useId, useState } from 'react';
import { api } from '../../api';
import { useSession } from '../../session/SessionProvider';
import fields from '../../ui/Field.module.css';
import styles from './MunicipalitySearch.module.css';

const SEARCH_DELAY_MS = 300;

function municipalityLabel(option: MunicipalityOption): string {
  return `${option.name} — ${option.state} · ${option.ibgeCode}`;
}

export interface MunicipalitySearchProps {
  value: MunicipalityOption | null;
  onChange: (value: MunicipalityOption | null) => void;
}

/** Busca de município (IBGE) com lista; os que já têm prefeitura ficam desabilitados. */
export function MunicipalitySearch({ value, onChange }: MunicipalitySearchProps) {
  const { session } = useSession();
  const ids = useId();
  const [text, setText] = useState(value ? municipalityLabel(value) : '');
  const [items, setItems] = useState<MunicipalityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      session
        .withAuth(() => api.backofficeMunicipalities(q))
        .then((response) => {
          if (cancelled) return;
          setItems(response.items);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, open, session]);

  const showList = open && text.trim().length >= 2 && items.length > 0;

  return (
    <div className={styles.wrap}>
      <label htmlFor={`${ids}-input`} className={fields.label}>
        Buscar município (IBGE)
      </label>
      <input
        id={`${ids}-input`}
        className={fields.input}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${ids}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Nome ou código do município"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
      />
      {failed ? (
        <p className={fields.error} role="alert">
          Não foi possível buscar os municípios.
        </p>
      ) : null}
      <ul id={`${ids}-list`} role="listbox" className={styles.list} hidden={!showList}>
        {showList
          ? items.map((item) => (
              <li
                key={item.ibgeCode}
                role="option"
                aria-selected={value?.ibgeCode === item.ibgeCode}
                aria-disabled={item.taken}
                className={`${styles.option} ${item.taken ? styles.taken : ''}`}
                onClick={() => {
                  if (item.taken) return;
                  setText(municipalityLabel(item));
                  setOpen(false);
                  onChange(item);
                }}
              >
                <span>{municipalityLabel(item)}</span>
                {item.taken ? <span className={styles.badge}>já cadastrado</span> : null}
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
