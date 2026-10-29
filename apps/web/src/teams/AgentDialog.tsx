import {
  maskPhoneInput,
  NAME_MIN,
  PERSON_NAME_MAX,
  phoneFromMasked,
  type AgentRow,
  type TeamSummary,
} from '@alocidadao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { apiErrorField, generalErrorMessage } from './team-errors';
import { teamsKey } from './team-keys';
import styles from './Teams.module.css';

interface PhoneFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  help?: string;
}

function PhoneField({ label, value, onChange, error, help }: PhoneFieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, help ? `${id}-help` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <span className={styles.hint}>obrigatório</span>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        placeholder="(11) 98877-1020"
        className={styles.input}
        value={value}
        aria-invalid={error !== null}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(maskPhoneInput(event.target.value))}
      />
      {error ? (
        <p id={`${id}-error`} className={styles.error}>
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={`${id}-help`} className={styles.hint}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

function useAfterAgentChange(tenantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: teamsKey(tenantId) });
}

export interface AddAgentDialogProps {
  team: TeamSummary;
  onClose: () => void;
}

/** Adicionar agente: nome e celular; o agente entra como convidado. */
export function AddAgentDialog({ team, onClose }: AddAgentDialogProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const toast = useToast();
  const refresh = useAfterAgentChange(tenantId);
  const nameId = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const e164 = phoneFromMasked(phone);

  const add = useMutation({
    mutationFn: () =>
      session.withAuth(() =>
        api.panelAddAgent(tenantId, team.id, { name: name.trim(), phone: e164 ?? '' }),
      ),
    onSuccess: async (agent: AgentRow) => {
      await refresh();
      toast.show(`${agent.name} adicionado à equipe.`);
      onClose();
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'agent_in_other_team') {
        const teamName = apiErrorField(error, 'teamName');
        setPhoneError(
          teamName
            ? `Este celular já é de um agente da equipe ${teamName}.`
            : 'Este celular já é de um agente de outra equipe.',
        );
      } else if (code === 'agent_already_in_team') {
        setPhoneError('Este agente já está nesta equipe.');
      } else if (code === 'staff_account_not_allowed') {
        setPhoneError('Este número é de alguém da equipe Alô Cidadão. Use outro número.');
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  const canAdd = name.trim().length >= NAME_MIN && e164 !== null && !add.isPending;

  return (
    <Dialog
      title="Adicionar agente"
      subtitle={team.name}
      onClose={onClose}
      footer={
        <>
          {generalError ? (
            <p className={`${styles.error} ${styles.footerError}`} role="alert">
              {generalError}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" disabled={!canAdd} onClick={() => add.mutate()}>
            Adicionar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label htmlFor={nameId} className={styles.label}>
            Nome
          </label>
          <span className={styles.hint}>obrigatório</span>
        </div>
        <input
          id={nameId}
          className={styles.input}
          value={name}
          maxLength={PERSON_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <PhoneField
        label="Celular"
        value={phone}
        onChange={(value) => {
          setPhone(value);
          setPhoneError(null);
        }}
        error={phoneError}
        help="Ele recebe o código de acesso por SMS neste número."
      />
    </Dialog>
  );
}

export interface ChangePhoneDialogProps {
  agent: AgentRow;
  onClose: () => void;
}

/** Trocar número: só para quem nunca entrou no app. */
export function ChangePhoneDialog({ agent, onClose }: ChangePhoneDialogProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const toast = useToast();
  const refresh = useAfterAgentChange(tenantId);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const e164 = phoneFromMasked(phone);

  const change = useMutation({
    mutationFn: () =>
      session.withAuth(() =>
        api.panelUpdateAgent(tenantId, agent.userId, {
          action: 'change_phone',
          phone: e164 ?? '',
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show('Número trocado.');
      onClose();
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'phone_in_use') {
        setPhoneError('Este número já é de outra conta.');
      } else if (code === 'phone_change_not_allowed') {
        setGeneralError(
          'Não dá para trocar o número deste agente pelo painel. Ele troca no Perfil do app.',
        );
        void refresh();
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  return (
    <Dialog
      title="Trocar número"
      subtitle={agent.name}
      onClose={onClose}
      footer={
        <>
          {generalError ? (
            <p className={`${styles.error} ${styles.footerError}`} role="alert">
              {generalError}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={e164 === null || change.isPending}
            onClick={() => change.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <PhoneField
        label="Novo celular"
        value={phone}
        onChange={(value) => {
          setPhone(value);
          setPhoneError(null);
        }}
        error={phoneError}
      />
    </Dialog>
  );
}

export interface MoveAgentDialogProps {
  agent: AgentRow;
  /** Equipes do alcance, sem a atual. */
  teams: TeamSummary[];
  onClose: () => void;
}

/** Mudar de equipe: select com as outras equipes do alcance. */
export function MoveAgentDialog({ agent, teams, onClose }: MoveAgentDialogProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const toast = useToast();
  const refresh = useAfterAgentChange(tenantId);
  const id = useId();
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: () =>
      session.withAuth(() =>
        api.panelUpdateAgent(tenantId, agent.userId, { action: 'move', teamId }),
      ),
    onSuccess: async () => {
      await refresh();
      const target = teams.find((team) => team.id === teamId);
      toast.show(`${agent.name} agora está na equipe ${target?.name ?? ''}.`);
      onClose();
    },
    onError: (failure) => {
      setError(
        errorCode(failure) === 'team_not_eligible'
          ? 'Esta equipe não está disponível para você.'
          : generalErrorMessage(failure),
      );
    },
  });

  return (
    <Dialog
      title="Mudar de equipe"
      subtitle={agent.name}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <p className={`${styles.error} ${styles.footerError}`} role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={teamId === '' || move.isPending}
            onClick={() => move.mutate()}
          >
            Mudar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label htmlFor={id} className={styles.label}>
            Equipe
          </label>
          <span className={styles.hint}>obrigatório</span>
        </div>
        <select
          id={id}
          className={styles.input}
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
        >
          <option value="">Selecione</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}
