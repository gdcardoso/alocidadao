import {
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLES,
  staffCreateBodySchema,
  staffUpdateBodySchema,
  type PlatformRole,
  type StaffMember,
} from '@alocidadao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../../api';
import { maskCpfInput } from '../../format/cpf';
import { errorCode } from '../../occurrence/use-occurrence-actions';
import { useSession } from '../../session/SessionProvider';
import { apiErrorField } from '../../teams/team-errors';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import fields from '../../ui/Field.module.css';
import { useToast } from '../../ui/Toast';
import { FrozenAccountPanel } from '../frozen/FrozenAccountPanel';
import { staffErrorMessage } from './staff-errors';
import { STAFF_KEY } from './staff-keys';

export interface StaffDialogProps {
  /** Sem `member`, adiciona; com `member`, edita nome e e-mail (o papel tem ação própria). */
  member?: StaffMember;
  onClose: () => void;
}

/** P6: Adicionar pessoa e Editar pessoa. */
export function StaffDialog({ member, onClose }: StaffDialogProps) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = useId();
  const editing = member !== undefined;
  const [name, setName] = useState(member?.name ?? '');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState(member?.email ?? '');
  const [role, setRole] = useState<PlatformRole>('support');
  const [cpfError, setCpfError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);

  const createBody = staffCreateBodySchema.safeParse({ name, cpf, email, platformRole: role });
  const updateBody = staffUpdateBodySchema.safeParse({ name, email });
  const valid = editing ? updateBody.success : createBody.success;

  const save = useMutation({
    mutationFn: () =>
      session.withAuth(async () => {
        if (member) {
          if (!updateBody.success) throw new Error('invalid');
          await api.backofficeUpdateStaff(member.userId, updateBody.data);
          return;
        }
        if (!createBody.success) throw new Error('invalid');
        return (await api.backofficeAddStaff(createBody.data)).id;
      }),
    onMutate: () => {
      setCpfError(null);
      setEmailError(null);
      setGeneralError(null);
      setFrozen(false);
    },
    onSuccess: async (addedId) => {
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      if (editing) {
        toast.show('Pessoa salva.');
      } else {
        // Conta que já existia pelo CPF guarda o nome dela: o aviso usa o nome da lista relida.
        const added = queryClient
          .getQueryData<{ items: StaffMember[] }>(STAFF_KEY)
          ?.items.find((item) => item.userId === addedId);
        toast.show(`${added?.name ?? name.trim()} entrou na equipe.`);
      }
      onClose();
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'email_mismatch') {
        setEmailError(
          `Este CPF já tem outro e-mail cadastrado: ${apiErrorField(error, 'maskedEmail') ?? ''}.`,
        );
      } else if (code === 'email_in_use') {
        setEmailError('Este e-mail já é de outra pessoa.');
      } else if (code === 'already_staff') {
        setCpfError('Esta pessoa já está na equipe Alô Cidadão.');
      } else if (code === 'tenant_member_not_allowed') {
        setCpfError('Esta pessoa é gestora ou agente de uma prefeitura. Use outro CPF.');
      } else if (code === 'cpf_unavailable') {
        setFrozen(true);
      } else {
        setGeneralError(staffErrorMessage(error));
      }
    },
  });

  return (
    <Dialog
      title={editing ? 'Editar pessoa' : 'Adicionar pessoa'}
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
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {editing ? (
        <div className={fields.field}>
          <span className={fields.label}>CPF</span>
          <span className={fields.readonly}>{member.maskedCpf || '—'}</span>
        </div>
      ) : (
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
              setFrozen(false);
            }}
          />
          {cpfError ? (
            <p id={`${ids}-cpf-error`} className={fields.error}>
              {cpfError}
            </p>
          ) : null}
        </div>
      )}

      <div className={fields.field}>
        <div className={fields.labelRow}>
          <label htmlFor={`${ids}-email`} className={fields.label}>
            E-mail
          </label>
          <span className={fields.hint}>recebe o código</span>
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

      {editing ? null : (
        <div className={fields.field}>
          <label htmlFor={`${ids}-role`} className={fields.label}>
            Papel
          </label>
          <select
            id={`${ids}-role`}
            className={fields.input}
            value={role}
            onChange={(event) => setRole(event.target.value as PlatformRole)}
          >
            {PLATFORM_ROLES.map((item) => (
              <option key={item} value={item}>
                {PLATFORM_ROLE_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      )}

      {frozen && createBody.success ? (
        <FrozenAccountPanel
          cpf={createBody.data.cpf}
          email={createBody.data.email}
          tenantId={null}
          onResolved={() => save.mutate()}
        />
      ) : null}
    </Dialog>
  );
}
