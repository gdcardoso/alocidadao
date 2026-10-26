import {
  BASE_ADDRESS_MAX,
  NAME_MIN,
  TEAM_NAME_MAX,
  type GeoPoint,
  type TeamSummary,
} from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { BasePicker } from './BasePicker';
import { teamsKey } from './team-keys';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { generalErrorMessage } from './team-errors';
import styles from './Teams.module.css';

export interface TeamDialogProps {
  /** Sem `team`, cria; com `team`, edita (o setor não muda). */
  team?: TeamSummary;
  onClose: () => void;
  onSaved: (team: TeamSummary) => void;
}

/** Nova equipe e Editar equipe (diálogo de 560). */
export function TeamDialog({ team, onClose, onSaved }: TeamDialogProps) {
  const { tenantId, context } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = useId();
  const editing = team !== undefined;
  const [name, setName] = useState(team?.name ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [address, setAddress] = useState(team?.baseAddress ?? '');
  const [point, setPoint] = useState<GeoPoint | null>(team?.baseLocation ?? null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const departments = useQuery({
    queryKey: ['departments', tenantId],
    queryFn: () => session.withAuth(() => api.panelDepartments(tenantId)),
    enabled: !editing,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: () => {
      const base = {
        name: name.trim(),
        baseAddress: address.trim() === '' ? null : address.trim(),
        baseLocation: point,
      };
      return session.withAuth(() =>
        team
          ? api.panelUpdateTeam(tenantId, team.id, base)
          : api.panelCreateTeam(tenantId, { ...base, departmentId }),
      );
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: teamsKey(tenantId) });
      toast.show(editing ? 'Equipe salva.' : 'Equipe criada.');
      onSaved(saved);
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'team_name_taken') {
        setNameError('Já existe uma equipe com este nome.');
      } else if (code === 'department_not_eligible') {
        setGeneralError('Este setor não está disponível para você.');
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  const nameValid = name.trim().length >= NAME_MIN;
  const canSave = nameValid && (editing || departmentId !== '') && !save.isPending;

  return (
    <Dialog
      title={editing ? 'Editar equipe' : 'Nova equipe'}
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
          <Button size="sm" disabled={!canSave} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label htmlFor={`${ids}-name`} className={styles.label}>
            Nome
          </label>
          <span className={styles.hint}>obrigatório</span>
        </div>
        <input
          id={`${ids}-name`}
          className={styles.input}
          value={name}
          maxLength={TEAM_NAME_MAX}
          aria-invalid={nameError !== null}
          aria-describedby={nameError ? `${ids}-name-error` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
        />
        {nameError ? (
          <p id={`${ids}-name-error`} className={styles.error}>
            {nameError}
          </p>
        ) : null}
      </div>

      {editing ? (
        <div className={styles.field}>
          <span className={styles.label}>Setor</span>
          <span className={styles.readonly}>{team.departmentName}</span>
        </div>
      ) : (
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor={`${ids}-department`} className={styles.label}>
              Setor
            </label>
            <span className={styles.hint}>obrigatório</span>
          </div>
          <select
            id={`${ids}-department`}
            className={styles.input}
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">Selecione</option>
            {departments.data?.items.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label htmlFor={`${ids}-address`} className={styles.label}>
            Endereço da base
          </label>
          <span className={styles.hint}>opcional</span>
        </div>
        <input
          id={`${ids}-address`}
          className={styles.input}
          value={address}
          maxLength={BASE_ADDRESS_MAX}
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>

      <BasePicker value={point} onChange={setPoint} bounds={context.tenant.bounds} />
    </Dialog>
  );
}
