import {
  maskCpf,
  managerCreateBodySchema,
  managerUpdateBodySchema,
  NAME_MIN,
  PERSON_NAME_MAX,
  type ManagerRow,
} from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { apiErrorCode, apiErrorField, generalErrorMessage } from '../teams/team-errors';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import fields from '../ui/Field.module.css';
import { useToast } from '../ui/Toast';
import { departmentsKey, managersKey } from './managers-keys';
import styles from './Managers.module.css';

/** Máscara do CPF enquanto digita: `123`, `123.456`, `123.456.789`, `123.456.789-09`. */
function maskCpfInput(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

export interface ManagerDialogProps {
  /** Sem `manager`, cadastra; com `manager`, edita e-mail e setores. */
  manager?: ManagerRow;
  onClose: () => void;
}

/** Novo gestor e Editar gestor. */
export function ManagerDialog({ manager, onClose }: ManagerDialogProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = useId();
  const editing = manager !== undefined;
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState(manager?.email ?? '');
  const [selected, setSelected] = useState<string[]>(
    manager?.departments.map((department) => department.id) ?? [],
  );
  const [cpfError, setCpfError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const departments = useQuery({
    queryKey: departmentsKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelDepartments(tenantId)),
    staleTime: 60_000,
  });

  const createBody = managerCreateBodySchema.safeParse({
    name,
    cpf,
    email,
    departmentIds: selected,
  });
  const updateBody = managerUpdateBodySchema.safeParse({
    action: 'update',
    email,
    departmentIds: selected,
  });
  const valid = editing ? updateBody.success : createBody.success && name.trim().length >= NAME_MIN;

  const save = useMutation({
    mutationFn: () =>
      session.withAuth(() => {
        if (manager) {
          if (!updateBody.success) throw new Error('invalid');
          return api.panelUpdateManager(tenantId, manager.userId, updateBody.data);
        }
        if (!createBody.success) throw new Error('invalid');
        return api.panelCreateManager(tenantId, createBody.data);
      }),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: managersKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: departmentsKey(tenantId) }),
      ]);
      toast.show(editing ? 'Gestor salvo.' : `${saved.name} cadastrado como gestor.`);
      onClose();
    },
    onError: (error) => {
      setCpfError(null);
      setEmailError(null);
      setGeneralError(null);
      const code = apiErrorCode(error);
      if (code === 'email_mismatch') {
        setEmailError(
          `Este CPF já tem outro e-mail cadastrado: ${apiErrorField(error, 'maskedEmail') ?? ''}.`,
        );
      } else if (code === 'email_in_use') {
        setEmailError('Este e-mail já é de outra pessoa.');
      } else if (code === 'email_change_not_allowed') {
        setEmailError(
          'Esta pessoa também tem acesso a outro painel. Peça a troca ao suporte do Alô Cidadão.',
        );
      } else if (code === 'already_manager') {
        setCpfError('Esta pessoa já é gestora nesta prefeitura.');
      } else if (code === 'cpf_unavailable') {
        setCpfError('Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.');
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  function toggleDepartment(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  const orderedDepartments = departments.data?.items ?? [];

  return (
    <Dialog
      title={editing ? 'Editar gestor' : 'Novo gestor'}
      onClose={onClose}
      footer={
        <>
          {generalError ? (
            <p className={`${fields.error} ${fields.footerError}`} role="alert">
              {generalError}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {editing ? (
        <>
          <div className={fields.field}>
            <span className={fields.label}>Nome</span>
            <span className={fields.readonly}>{manager.name}</span>
          </div>
          <div className={fields.field}>
            <span className={fields.label}>CPF</span>
            <span className={fields.readonly}>{manager.cpf ? maskCpf(manager.cpf) : '—'}</span>
          </div>
        </>
      ) : (
        <>
          <div className={fields.field}>
            <div className={fields.labelRow}>
              <label htmlFor={`${ids}-name`} className={fields.label}>
                Nome
              </label>
              <span className={fields.hint}>obrigatório</span>
            </div>
            <input
              id={`${ids}-name`}
              className={fields.input}
              value={name}
              maxLength={PERSON_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className={fields.field}>
            <div className={fields.labelRow}>
              <label htmlFor={`${ids}-cpf`} className={fields.label}>
                CPF
              </label>
              <span className={fields.hint}>obrigatório</span>
            </div>
            <input
              id={`${ids}-cpf`}
              className={fields.input}
              inputMode="numeric"
              autoComplete="off"
              placeholder="123.456.789-09"
              value={maskCpfInput(cpf)}
              aria-invalid={cpfError !== null}
              aria-describedby={cpfError ? `${ids}-cpf-error` : undefined}
              onChange={(event) => {
                setCpf(event.target.value.replace(/\D/g, '').slice(0, 11));
                setCpfError(null);
              }}
            />
            {cpfError ? (
              <p id={`${ids}-cpf-error`} className={fields.error}>
                {cpfError}
              </p>
            ) : null}
          </div>
        </>
      )}

      <div className={fields.field}>
        <div className={fields.labelRow}>
          <label htmlFor={`${ids}-email`} className={fields.label}>
            E-mail
          </label>
          <span className={fields.hint}>obrigatório</span>
        </div>
        <input
          id={`${ids}-email`}
          type="email"
          autoComplete="off"
          className={fields.input}
          value={email}
          aria-invalid={emailError !== null}
          aria-describedby={emailError ? `${ids}-email-error` : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
        />
        {emailError ? (
          <p id={`${ids}-email-error`} className={fields.error}>
            {emailError}
          </p>
        ) : null}
      </div>

      <fieldset className={styles.checks}>
        <legend className={fields.label}>Setores</legend>
        {departments.isError ? (
          <p className={fields.error} role="alert">
            {generalErrorMessage(departments.error)}
          </p>
        ) : null}
        {orderedDepartments.map((department) => (
          <label key={department.id} className={styles.check}>
            <input
              type="checkbox"
              checked={selected.includes(department.id)}
              onChange={() => toggleDepartment(department.id)}
            />
            {department.name}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
