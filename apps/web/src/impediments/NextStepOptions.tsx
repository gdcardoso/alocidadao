import { ApiError } from '@alocidadao/api-client';
import {
  MANAGER_INSTRUCTIONS_MAX,
  REJECT_REASON_MAX,
  REJECT_REASON_MIN,
  type ImpedimentDetail,
} from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, CircleX, Users } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatDistance } from '../format/distance';
import { todayInSaoPaulo } from '../format/due-date';
import { useNow } from '../format/use-now';
import { DueDateField } from '../occurrence/DueDateField';
import { rejectHelp } from '../occurrence/reject-help';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import styles from './NextStepOptions.module.css';

/** Próximo passo completo, pronto para enviar. */
export type NextStep =
  | {
      kind: 'reassign';
      teamId: string;
      teamName: string;
      dueDate: string;
      instructions: string | null;
    }
  | { kind: 'reschedule'; dueDate: string }
  | { kind: 'reject'; reason: string };

type Kind = NextStep['kind'];

export interface NextStepOptionsProps {
  impediment: ImpedimentDetail;
  /** Recebe o passo quando a opção marcada está completa; `null` enquanto não está. */
  onChange: (step: NextStep | null) => void;
}

const teamsKey = (tenantId: string, occurrenceId: string) =>
  ['occurrence', occurrenceId, 'teams', tenantId] as const;

function Option(props: {
  kind: Kind;
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  danger?: boolean;
  children?: ReactNode;
}) {
  const { selected, onSelect, icon, title, subtitle, danger, children } = props;
  return (
    <div className={`${styles.option} ${selected ? styles.optionSelected : ''}`}>
      <label className={styles.optionHead}>
        <input
          type="radio"
          name="next-step"
          className={styles.radio}
          checked={selected}
          onChange={onSelect}
        />
        <span className={danger ? styles.dangerIcon : styles.icon}>{icon}</span>
        <span className={styles.optionText}>
          <span className={danger ? styles.dangerTitle : styles.optionTitle}>{title}</span>
          <span className={styles.optionSubtitle}>{subtitle}</span>
        </span>
      </label>
      {selected ? <div className={styles.fields}>{children}</div> : null}
    </div>
  );
}

/** As três opções da W4. Nenhuma vem marcada; ao marcar, os campos aparecem abaixo. */
export function NextStepOptions({ impediment, onChange }: NextStepOptionsProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const now = useNow();
  const today = todayInSaoPaulo(now);
  const teamId = useId();
  const instructionsId = useId();
  const rescheduleId = useId();
  const reasonId = useId();
  const reasonHelpId = useId();
  const [kind, setKind] = useState<Kind | null>(null);
  const [teamChoice, setTeamChoice] = useState<string | null>(null);
  const [dueChoice, setDueChoice] = useState<string | null>(null);
  const [instructions, setInstructions] = useState(impediment.managerInstructions ?? '');
  const [reason, setReason] = useState('');

  const needsTeams = kind === 'reassign' || kind === 'reschedule';
  const teams = useQuery({
    queryKey: teamsKey(tenantId, impediment.occurrenceId),
    queryFn: () => session.withAuth(() => api.panelTeams(tenantId, impediment.occurrenceId)),
    enabled: needsTeams,
    staleTime: 0,
    gcTime: 0,
  });
  const data = teams.data;
  const others = data?.items.filter((team) => team.id !== impediment.teamId) ?? [];
  const selectedTeam = others.find((team) => team.id === teamChoice) ?? others[0];
  const dueDate = dueChoice ?? data?.defaultDueDate ?? '';
  const trimmedReason = reason.trim();

  let step: NextStep | null = null;
  if (kind === 'reassign' && selectedTeam && dueDate >= today && dueDate !== '') {
    step = {
      kind,
      teamId: selectedTeam.id,
      teamName: selectedTeam.name,
      dueDate,
      instructions: instructions.trim() === '' ? null : instructions.trim(),
    };
  } else if (kind === 'reschedule' && dueDate >= today && dueDate !== '') {
    step = { kind, dueDate };
  } else if (
    kind === 'reject' &&
    trimmedReason.length >= REJECT_REASON_MIN &&
    trimmedReason.length <= REJECT_REASON_MAX
  ) {
    step = { kind, reason: trimmedReason };
  }

  const stepKey = step ? JSON.stringify(step) : null;
  useEffect(() => {
    onChange(step);
    // `stepKey` resume o conteúdo de `step`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const loadError = teams.isError
    ? teams.error instanceof ApiError
      ? UNEXPECTED_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE
    : null;

  return (
    <div className={styles.options}>
      <Option
        kind="reassign"
        selected={kind === 'reassign'}
        onSelect={() => setKind('reassign')}
        icon={<Users size={18} aria-hidden="true" />}
        title="Reatribuir a outra equipe"
        subtitle="A nova equipe recebe a atividade com suas instruções"
      >
        {loadError ? (
          <p className={styles.message} role="alert">
            {loadError}
          </p>
        ) : null}
        {data && others.length === 0 ? (
          <p className={styles.message}>
            Nenhuma outra equipe do setor {data.departmentName}. Cadastre uma em Equipes e agentes.
          </p>
        ) : null}
        {others.length > 0 ? (
          <>
            <div className={styles.field}>
              <label htmlFor={teamId} className={styles.label}>
                Equipe
              </label>
              <span className={styles.select}>
                <select
                  id={teamId}
                  className={styles.selectInput}
                  value={selectedTeam?.id ?? ''}
                  onChange={(event) => setTeamChoice(event.target.value)}
                >
                  {others.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.baseDistanceM !== null
                        ? `${team.name} · base a ${formatDistance(team.baseDistanceM)}`
                        : team.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </span>
            </div>
            <DueDateField label="Prazo interno" value={dueDate} onChange={setDueChoice} />
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label htmlFor={instructionsId} className={styles.label}>
                  Instruções para o agente
                </label>
                <span className={styles.hint}>opcional</span>
              </div>
              <textarea
                id={instructionsId}
                className={styles.textarea}
                rows={3}
                maxLength={MANAGER_INSTRUCTIONS_MAX}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </div>
          </>
        ) : null}
      </Option>

      <Option
        kind="reschedule"
        selected={kind === 'reschedule'}
        onSelect={() => setKind('reschedule')}
        icon={<CalendarClock size={18} aria-hidden="true" />}
        title="Reagendar com a mesma equipe"
        subtitle="Define uma nova data; a equipe atual continua responsável"
      >
        <DueDateField
          key={rescheduleId}
          label="Nova data"
          value={dueDate}
          onChange={setDueChoice}
        />
      </Option>

      <Option
        kind="reject"
        danger
        selected={kind === 'reject'}
        onSelect={() => setKind('reject')}
        icon={<CircleX size={18} aria-hidden="true" />}
        title="Recusar solicitação"
        subtitle="Você escreve o motivo que os cidadãos vão ler"
      >
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor={reasonId} className={styles.label}>
              Motivo para os cidadãos
            </label>
            <span className={styles.hint}>obrigatório</span>
          </div>
          <textarea
            id={reasonId}
            className={styles.textarea}
            rows={3}
            maxLength={REJECT_REASON_MAX}
            value={reason}
            aria-describedby={reasonHelpId}
            onChange={(event) => setReason(event.target.value)}
          />
          <p id={reasonHelpId} className={styles.hint}>
            {rejectHelp(impediment.activeRequestCount)}
          </p>
        </div>
      </Option>
    </div>
  );
}
