import { ApiError } from '@alocidadao/api-client';
import { MANAGER_INSTRUCTIONS_MAX, type OccurrenceDetail } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { EyeOff, UserCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { todayInSaoPaulo } from '../format/due-date';
import { useNow } from '../format/use-now';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './AssignDialog.module.css';
import { DueDateField } from './DueDateField';
import { teamMeta } from './team-meta';
import { useOccurrenceActions } from './use-occurrence-actions';

export interface AssignDialogProps {
  occurrence: OccurrenceDetail;
  onClose: () => void;
  /** Chamado depois que a atribuição deu certo (o diálogo não se fecha sozinho). */
  onAssigned: () => void;
}

const teamOptionsKey = (tenantId: string, occurrenceId: string) =>
  ['occurrence', occurrenceId, 'teams', tenantId] as const;

function reportsLabel(count: number): string {
  return count === 1 ? '1 relato' : `${count} relatos`;
}

/** W2 · Atribuir a uma equipe: equipe do setor, prazo interno e instruções. */
export function AssignDialog({ occurrence, onClose, onAssigned }: AssignDialogProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const actions = useOccurrenceActions(tenantId);
  const now = useNow();
  const today = todayInSaoPaulo(now);
  const dateId = useId();
  const instructionsId = useId();
  const instructionsHelpId = useId();
  const [teamChoice, setTeamChoice] = useState<string | null>(null);
  const [dueChoice, setDueChoice] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');

  const teams = useQuery({
    queryKey: teamOptionsKey(tenantId, occurrence.id),
    queryFn: () => session.withAuth(() => api.panelTeams(tenantId, occurrence.id)),
    staleTime: 0,
    gcTime: 0,
  });
  const data = teams.data;
  const teamId = teamChoice ?? data?.suggestedTeamId ?? null;
  const dueDate = dueChoice ?? data?.defaultDueDate ?? '';
  const selectedTeam = data?.items.find((team) => team.id === teamId);
  const noTeams = data !== undefined && data.items.length === 0;
  const canAssign = Boolean(selectedTeam) && dueDate >= today && dueDate !== '' && !actions.pending;

  const subtitle = [
    occurrence.category.name,
    occurrence.address,
    reportsLabel(occurrence.requestCount),
  ]
    .filter(Boolean)
    .join(' · ');

  async function assign() {
    if (!selectedTeam) return;
    const outcome = await actions.run({
      kind: 'assign',
      occurrenceId: occurrence.id,
      teamId: selectedTeam.id,
      teamName: selectedTeam.name,
      dueDate,
      instructions: instructions.trim() === '' ? null : instructions.trim(),
    });
    if (outcome.status === 'done') onAssigned();
    if (outcome.status === 'stale') onClose();
  }

  return (
    <Dialog
      title="Atribuir a uma equipe"
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <p className={styles.effect}>
            A equipe recebe um aviso e o cidadão vê &quot;Em atendimento&quot;.
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            icon={<UserCheck size={16} aria-hidden="true" />}
            disabled={!canAssign}
            onClick={() => void assign()}
          >
            Atribuir
          </Button>
        </>
      }
    >
      <div className={styles.field} role="radiogroup" aria-labelledby={`${dateId}-teams`}>
        <div className={styles.labelRow}>
          <span id={`${dateId}-teams`} className={styles.label}>
            Equipe
          </span>
          <span className={styles.hint}>obrigatório</span>
        </div>
        {teams.isError ? (
          <p className={styles.message} role="alert">
            {teams.error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE}
          </p>
        ) : null}
        {noTeams ? (
          <p className={styles.message}>
            Nenhuma equipe do setor {data.departmentName}. Cadastre uma em Equipes e agentes.
          </p>
        ) : null}
        <ul className={styles.teams}>
          {data?.items.map((team) => {
            const selected = team.id === teamId;
            return (
              <li key={team.id}>
                <label className={`${styles.team} ${selected ? styles.teamSelected : ''}`}>
                  <input
                    type="radio"
                    name="team"
                    className={styles.radio}
                    checked={selected}
                    onChange={() => setTeamChoice(team.id)}
                  />
                  <span className={styles.teamText}>
                    <span className={styles.teamName}>{team.name}</span>
                    <span className={styles.teamMeta}>{teamMeta(team)}</span>
                  </span>
                  {team.id === data.suggestedTeamId ? (
                    <span className={styles.badge}>Sugerida: mais próxima</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <DueDateField
        label="Prazo interno"
        hint="visível só para a prefeitura e a equipe"
        help={`Sugerido pela categoria ${occurrence.category.name}.`}
        value={dueDate}
        onChange={setDueChoice}
      />

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
          rows={4}
          maxLength={MANAGER_INSTRUCTIONS_MAX}
          value={instructions}
          aria-describedby={instructionsHelpId}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <p id={instructionsHelpId} className={styles.helpIcon}>
          <EyeOff size={14} aria-hidden="true" />
          Aparece no topo da atividade do agente. O cidadão não vê.
        </p>
      </div>
    </Dialog>
  );
}
