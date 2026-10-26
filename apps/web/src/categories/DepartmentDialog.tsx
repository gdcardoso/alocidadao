import { DEPARTMENT_NAME_MAX, NAME_MIN, type DepartmentRow } from '@alocidadao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../api';
import { departmentsKey } from '../managers/managers-keys';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { generalErrorMessage } from '../teams/team-errors';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import fields from '../ui/Field.module.css';
import { useToast } from '../ui/Toast';

export interface DepartmentDialogProps {
  /** Sem `department`, cria; com `department`, renomeia. */
  department?: DepartmentRow;
  onClose: () => void;
}

/** Novo setor e Renomear setor. */
export function DepartmentDialog({ department, onClose }: DepartmentDialogProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = useId();
  const editing = department !== undefined;
  const [name, setName] = useState(department?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      session.withAuth(() =>
        department
          ? api.panelUpdateDepartment(tenantId, department.id, { name: name.trim() })
          : api.panelCreateDepartment(tenantId, { name: name.trim() }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: departmentsKey(tenantId) });
      // Equipes, gestores e categorias mostram o nome do setor.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teams', tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['managers', tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['categories', tenantId] }),
      ]);
      toast.show(editing ? 'Setor salvo.' : 'Setor criado.');
      onClose();
    },
    onError: (error) => {
      if (errorCode(error) === 'department_name_taken') {
        setNameError('Já existe um setor com este nome.');
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  return (
    <Dialog
      title={editing ? 'Renomear setor' : 'Novo setor'}
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
          <Button
            size="sm"
            disabled={name.trim().length < NAME_MIN || save.isPending}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className={fields.field}>
        <div className={fields.labelRow}>
          <label htmlFor={`${id}-name`} className={fields.label}>
            Nome
          </label>
          <span className={fields.hint}>obrigatório</span>
        </div>
        <input
          id={`${id}-name`}
          className={fields.input}
          value={name}
          maxLength={DEPARTMENT_NAME_MAX}
          aria-invalid={nameError !== null}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
        />
        {nameError ? (
          <p id={`${id}-name-error`} className={fields.error}>
            {nameError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
