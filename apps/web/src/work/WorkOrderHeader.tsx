import { AGENT_NEAR_SITE_M, type WorkOrderHeader as Header } from '@alocidadao/shared';
import { Clock3, HardHat, MapPin, MapPinCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDateTime } from '../format/date';
import { formatDistance } from '../format/distance';
import styles from './WorkOrderHeader.module.css';

export interface WorkOrderHeaderProps {
  header: Header;
  dateLabel: 'Concluído em' | 'Registrado em';
  /** Último item da meta (cidadãos aguardando, ou o que os cidadãos veem). */
  lastItem: ReactNode;
}

function Distance({ meters }: { meters: number | null }) {
  if (meters === null) {
    return (
      <span className={`${styles.item} ${styles.muted}`}>
        <MapPin size={16} aria-hidden="true" />
        Sem localização na conclusão
      </span>
    );
  }
  const text = formatDistance(meters);
  return meters <= AGENT_NEAR_SITE_M ? (
    <span className={`${styles.item} ${styles.success}`}>
      <MapPinCheck size={16} aria-hidden="true" />
      No local (a {text})
    </span>
  ) : (
    <span className={`${styles.item} ${styles.warning}`}>
      <MapPin size={16} aria-hidden="true" />
      Longe do local (a {text})
    </span>
  );
}

/** Cabeçalho do detalhe da W3 e da W4: título, agente e equipe, data, distância e cidadãos. */
export function WorkOrderHeader({ header, dateLabel, lastItem }: WorkOrderHeaderProps) {
  const title = header.address ? `${header.categoryName} · ${header.address}` : header.categoryName;
  const who = header.agentName ? `${header.agentName} · ${header.teamName}` : header.teamName;
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.meta}>
        <span className={`${styles.item} ${styles.muted}`}>
          <HardHat size={16} aria-hidden="true" />
          {who}
        </span>
        <span className={`${styles.item} ${styles.muted}`}>
          <Clock3 size={16} aria-hidden="true" />
          {dateLabel} {formatDateTime(new Date(header.eventAt))}
        </span>
        <Distance meters={header.distanceM} />
        <span className={`${styles.item} ${styles.muted}`}>{lastItem}</span>
      </div>
    </header>
  );
}
