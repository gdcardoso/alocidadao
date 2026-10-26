import { ApiError } from '@alocidadao/api-client';
import {
  MAX_SUGGESTIONS,
  PANEL_OCCURRENCE_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  type OccurrenceDetail,
} from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  CircleX,
  HardHat,
  Hourglass,
  ImageIcon,
  Merge,
  Radius,
  Split,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatDayMonth } from '../format/date';
import { formatDistance } from '../format/distance';
import { formatElapsed } from '../format/elapsed';
import { useNow } from '../format/use-now';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CategorySquare } from '../ui/CategorySquare';
import { useToast } from '../ui/Toast';
import styles from './PointPanel.module.css';
import { RejectDialog } from './RejectDialog';
import { SplitDialog } from './SplitDialog';
import {
  errorCode,
  OCCURRENCE_CHANGED_MESSAGE,
  occurrenceKey,
  useOccurrenceActions,
  type OccurrenceAction,
  type OccurrenceActionResult,
} from './use-occurrence-actions';

export interface PointPanelProps {
  occurrenceId: string;
  onClose: () => void;
  /** "Atribuir a uma equipe": quem usa o painel abre a W2 com o detalhe. */
  onAssign: (detail: OccurrenceDetail) => void;
  /**
   * Depois de uma ação que deu certo. Em `merge`, o painel deve passar a mostrar
   * `survivorId` (a ocorrência que ficou).
   */
  onChanged?: (result: OccurrenceActionResult) => void;
}

/** Relatos visíveis antes de "Ver os outros…". */
const VISIBLE_REPORTS = 2;

function reportsLabel(count: number): string {
  return count === 1 ? '1 relato' : `${count} relatos`;
}

function moreReportsLabel(count: number): string {
  return count === 1 ? 'Ver mais 1 relato' : `Ver os outros ${count} relatos`;
}

function suggestionTitle(count: number, distanceM: number): string {
  const what = count === 1 ? '1 relato parecido' : `${count} relatos parecidos`;
  return `${what} a ${formatDistance(distanceM)}`;
}

function reportMeta(request: OccurrenceDetail['requests'][number]): string {
  const where =
    request.distanceM < 1 ? 'centro do ponto' : `a ${formatDistance(request.distanceM)}`;
  return `${request.protocol} · ${formatDayMonth(new Date(request.createdAt))} · ${where}`;
}

/**
 * Painel do ponto (440, à direita do mapa; gaveta na triagem): relatos, sugestões de
 * agrupamento e as ações de juntar, separar, atribuir e recusar. Quem usa deve trocar a
 * `key` junto com `occurrenceId`, para as caixas voltarem todas marcadas.
 */
export function PointPanel({ occurrenceId, onClose, onAssign, onChanged }: PointPanelProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const actions = useOccurrenceActions(tenantId);
  const hintId = useId();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<'split' | 'reject' | null>(null);
  const now = useNow();

  const query = useQuery({
    queryKey: occurrenceKey(occurrenceId),
    queryFn: () => session.withAuth(() => api.panelOccurrence(tenantId, occurrenceId)),
  });
  const detail = query.data;
  // A ocorrência sumiu do alcance (outro gestor juntou ou ela mudou de setor): fecha com o
  // aviso, mesmo com o detalhe antigo ainda no cache.
  const gone = errorCode(query.error) === 'occurrence_not_found';
  const toast = useToast();
  const closedRef = useRef(false);
  useEffect(() => {
    if (!gone || closedRef.current) return;
    closedRef.current = true;
    toast.show(OCCURRENCE_CHANGED_MESSAGE);
    onClose();
  }, [gone, toast, onClose]);

  async function run(action: OccurrenceAction) {
    const outcome = await actions.run(action);
    if (outcome.status === 'failed') return;
    setDialog(null);
    if (action.kind === 'split' || outcome.status === 'stale') setUnchecked(new Set());
    if (outcome.status === 'done') onChanged?.(outcome.result);
  }

  function toggle(id: string) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const closeButton = (
    <button type="button" className={styles.close} aria-label="Fechar painel" onClick={onClose}>
      <X size={18} />
    </button>
  );

  if (!detail) {
    const message = query.error
      ? gone
        ? OCCURRENCE_CHANGED_MESSAGE
        : query.error instanceof ApiError
          ? UNEXPECTED_ERROR_MESSAGE
          : NETWORK_ERROR_MESSAGE
      : null;
    return (
      <aside className={styles.panel} aria-label="Painel do ponto" aria-busy={!message}>
        <div className={styles.loadingHeader}>{closeButton}</div>
        {message ? <p className={styles.state}>{message}</p> : null}
      </aside>
    );
  }

  const inTriage = detail.status === 'triage';
  const inProgress = detail.status === 'in_progress';
  // Só valem os desmarcados que ainda estão no ponto.
  const uncheckedIds = detail.requests.filter((r) => unchecked.has(r.id)).map((r) => r.id);
  const hasUnchecked = inTriage && uncheckedIds.length > 0;
  const canSplit = hasUnchecked && uncheckedIds.length < detail.requests.length;
  const hiddenCount = detail.requests.length - VISIBLE_REPORTS;
  const requests = expanded ? detail.requests : detail.requests.slice(0, VISIBLE_REPORTS);
  const suggestions =
    inTriage || inProgress
      ? detail.suggestions.toSorted((a, b) => a.distanceM - b.distanceM).slice(0, MAX_SUGGESTIONS)
      : [];
  const busy = actions.pending;
  const statusLabel = `${PANEL_OCCURRENCE_STATUS_LABELS[detail.status]} ${formatElapsed(new Date(detail.statusSince), now)}`;

  return (
    <aside className={styles.panel} aria-label="Painel do ponto">
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <CategorySquare
            icon={detail.category.icon ?? 'circle-ellipsis'}
            iconGroup={detail.category.iconGroup}
          />
          <div className={styles.titles}>
            <h2 className={styles.title}>{detail.category.name}</h2>
            {detail.address ? <p className={styles.address}>{detail.address}</p> : null}
          </div>
          {closeButton}
        </div>
        <div className={styles.badges}>
          <Badge tone="muted" icon={<Hourglass />}>
            {statusLabel}
          </Badge>
          <Badge tone="subtle" icon={<Users />}>
            {reportsLabel(detail.requestCount)}
          </Badge>
          <Badge tone="subtle" icon={<Radius />}>
            Raio {detail.category.clusterRadiusM} m
          </Badge>
        </div>
      </header>

      <div className={styles.content}>
        <h3 className={styles.sectionTitle}>Relatos neste ponto</h3>
        <ul className={styles.reports}>
          {requests.map((request) => (
            <li key={request.id} className={styles.report}>
              {inTriage ? (
                <span className={styles.checkWrap}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    aria-label={`Relato ${request.protocol}`}
                    checked={!unchecked.has(request.id)}
                    onChange={() => toggle(request.id)}
                  />
                  <Check size={14} className={styles.checkIcon} aria-hidden="true" />
                </span>
              ) : null}
              {request.photoUrl ? (
                <img className={styles.thumb} src={request.photoUrl} alt="" />
              ) : (
                <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden="true">
                  <ImageIcon size={20} />
                </span>
              )}
              <div className={styles.reportTexts}>
                <p className={styles.reportText}>{request.description ?? 'Sem observação'}</p>
                <p className={styles.reportMeta}>{reportMeta(request)}</p>
              </div>
            </li>
          ))}
        </ul>
        {!expanded && hiddenCount > 0 ? (
          <button type="button" className={styles.link} onClick={() => setExpanded(true)}>
            {moreReportsLabel(hiddenCount)}
          </button>
        ) : null}

        {suggestions.map((suggestion) => (
          <section key={suggestion.occurrenceId} className={styles.suggestion}>
            <div className={styles.suggestionTitle}>
              <Merge size={18} aria-hidden="true" />
              <h4>{suggestionTitle(suggestion.requestCount, suggestion.distanceM)}</h4>
            </div>
            <p className={styles.suggestionText}>
              {[
                suggestion.protocol,
                suggestion.categoryName,
                suggestion.description ? `"${suggestion.description}"` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className={styles.suggestionActions}>
              <Button
                variant="warning"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run({
                    kind: 'merge',
                    occurrenceId,
                    otherOccurrenceId: suggestion.occurrenceId,
                  })
                }
              >
                Juntar a este ponto
              </Button>
              <Button
                variant="warning-outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run({
                    kind: 'dismiss',
                    occurrenceId,
                    otherOccurrenceId: suggestion.occurrenceId,
                  })
                }
              >
                É outro problema
              </Button>
            </div>
          </section>
        ))}
      </div>

      {inTriage ? (
        <footer className={styles.footer}>
          <Button
            fullWidth
            icon={<UserCheck size={18} />}
            disabled={hasUnchecked}
            aria-describedby={hasUnchecked ? hintId : undefined}
            onClick={() => onAssign(detail)}
          >
            Atribuir a uma equipe
          </Button>
          {hasUnchecked ? (
            <p id={hintId} className={styles.hint}>
              Separe os relatos desmarcados antes de atribuir.
            </p>
          ) : null}
          <div className={styles.footerRow}>
            <Button
              variant="secondary"
              size="md"
              className={styles.grow}
              icon={<Split size={16} />}
              disabled={!canSplit || busy}
              onClick={() => setDialog('split')}
            >
              Separar desmarcados
            </Button>
            <Button
              variant="danger-outline"
              size="md"
              className={styles.grow}
              icon={<CircleX size={16} />}
              disabled={busy}
              onClick={() => setDialog('reject')}
            >
              Recusar
            </Button>
          </div>
        </footer>
      ) : null}

      {inProgress ? (
        <footer className={styles.footer}>
          {detail.activeWorkOrder ? (
            <p className={styles.assigned}>
              <HardHat size={16} aria-hidden="true" />
              {`Atribuída a ${detail.activeWorkOrder.teamName} · ${
                WORK_ORDER_STATUS_LABELS[detail.activeWorkOrder.status]
              }`}
            </p>
          ) : null}
          <Button
            variant="danger-outline"
            size="md"
            fullWidth
            icon={<CircleX size={16} />}
            disabled={busy}
            onClick={() => setDialog('reject')}
          >
            Recusar
          </Button>
        </footer>
      ) : null}

      {dialog === 'split' ? (
        <SplitDialog
          count={uncheckedIds.length}
          pending={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run({ kind: 'split', occurrenceId, requestIds: uncheckedIds })}
        />
      ) : null}
      {dialog === 'reject' ? (
        <RejectDialog
          detail={detail}
          pending={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => void run({ kind: 'reject', occurrenceId, reason })}
        />
      ) : null}
    </aside>
  );
}
