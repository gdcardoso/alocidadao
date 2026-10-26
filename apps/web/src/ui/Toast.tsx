import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import styles from './Toast.module.css';

export const TOAST_DURATION_MS = 4000;

interface ToastContextValue {
  show: (text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Aviso embaixo, no centro, por 4 s. Um aviso novo troca o anterior. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((text: string) => {
    counter.current += 1;
    setMessage({ id: counter.current, text });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region}>
        {message ? (
          <div key={message.id} role="status" className={styles.toast}>
            {message.text}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

// O hook mora junto do provedor, que é o único a publicar o contexto.
// oxlint-disable-next-line react/only-export-components
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast precisa de um ToastProvider');
  return value;
}
