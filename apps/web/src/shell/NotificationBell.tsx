import type { PanelNotification } from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { formatElapsed } from '../format/elapsed';
import { useNow } from '../format/use-now';
import { useSession } from '../session/SessionProvider';
import styles from './NotificationBell.module.css';
import { panelNotificationsKey, usePanel } from './use-panel';

const NOTIFICATIONS_REFRESH_MS = 60_000;

/** Para onde o aviso leva: a fila da atividade ou a lista/gaveta da ocorrência. */
function destinationOf(item: PanelNotification): string {
  switch (item.kind) {
    case 'work_order_completed':
      return `/revisao?atividade=${item.workOrderId}`;
    case 'work_order_impeded':
      return `/impedimentos?atividade=${item.workOrderId}`;
    case 'occurrence_new':
      return `/triagem?ocorrencia=${item.occurrenceId}`;
    case 'request_contested':
    case 'request_cancelled':
      return `/solicitacoes?ocorrencia=${item.occurrenceId}`;
  }
}

/** Sino de avisos do painel: contador de não lidos e lista dos 30 mais recentes. */
export function NotificationBell() {
  const { tenantId, support } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // No modo suporte a API responde lista vazia; nem consulta.
  const query = useQuery({
    queryKey: panelNotificationsKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelNotifications(tenantId)),
    enabled: !support,
    refetchInterval: NOTIFICATIONS_REFRESH_MS,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: panelNotificationsKey(tenantId) });
  const readOne = useMutation({
    mutationFn: (id: string) => session.withAuth(() => api.panelReadNotification(tenantId, id)),
    onSettled: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => session.withAuth(() => api.panelReadAllNotifications(tenantId)),
    onSettled: refresh,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (support) return null;

  const items = query.data?.items ?? [];
  const unread = query.data?.unreadCount ?? 0;

  function select(item: PanelNotification) {
    if (!item.readAt) readOne.mutate(item.id);
    setOpen(false);
    void navigate(destinationOf(item));
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-label="Avisos"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 ? <span className={styles.count}>{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className={styles.popover}>
          <div className={styles.header}>
            <h2 className={styles.title}>Avisos</h2>
            {unread > 0 ? (
              <button type="button" className={styles.markAll} onClick={() => readAll.mutate()}>
                Marcar todos como lidos
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className={styles.empty}>Nenhum aviso por enquanto.</p>
          ) : (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`${styles.item} ${item.readAt ? '' : styles.unread}`}
                    onClick={() => select(item)}
                  >
                    <span className={styles.text}>{item.text}</span>
                    <span className={styles.time}>
                      {formatElapsed(new Date(item.createdAt), now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
