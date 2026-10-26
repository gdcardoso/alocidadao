import {
  CATEGORY_ICON_OPTIONS,
  CATEGORY_NAME_MAX,
  CLUSTER_RADIUS_MAX_M,
  DEADLINE_DAYS_MAX,
  DEFAULT_CLUSTER_RADIUS_M,
  ICON_GROUP_LABELS,
  ICON_GROUPS,
  NAME_MIN,
  type CategoryCreateBody,
  type CategoryRow,
  type CategoryUpdateBody,
  type IconGroup,
} from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { api } from '../api';
import { departmentsKey } from '../managers/managers-keys';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { generalErrorMessage } from '../teams/team-errors';
import { Button } from '../ui/Button';
import { CategorySquare } from '../ui/CategorySquare';
import fields from '../ui/Field.module.css';
import { useToast } from '../ui/Toast';
import { categoriesKey } from './category-keys';
import styles from './Categories.module.css';

export interface CategoryEditorProps {
  /** Sem `category`, cria com os padrões; com `category`, edita. */
  category?: CategoryRow;
  onClose: () => void;
}

/** Painel de 400 à direita: `Editar: {nome}` ou `Nova categoria`. */
export function CategoryEditor({ category, onClose }: CategoryEditorProps) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = useId();
  const editing = category !== undefined;
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'circle-ellipsis');
  const [iconGroup, setIconGroup] = useState<IconGroup>(category?.iconGroup ?? 'public_services');
  const [departmentId, setDepartmentId] = useState(category?.departmentId ?? '');
  const [deadline, setDeadline] = useState(String(category?.defaultDeadlineDays ?? 7));
  const [radius, setRadius] = useState(
    String(category?.clusterRadiusM ?? DEFAULT_CLUSTER_RADIUS_M),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const departments = useQuery({
    queryKey: departmentsKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelDepartments(tenantId)),
    staleTime: 60_000,
  });

  const deadlineNumber = Number(deadline);
  const radiusNumber = Number(radius);
  const valid =
    name.trim().length >= NAME_MIN &&
    departmentId !== '' &&
    deadline !== '' &&
    Number.isInteger(deadlineNumber) &&
    deadlineNumber >= 1 &&
    deadlineNumber <= DEADLINE_DAYS_MAX &&
    radius !== '' &&
    Number.isInteger(radiusNumber) &&
    radiusNumber >= 1 &&
    radiusNumber <= CLUSTER_RADIUS_MAX_M;

  const save = useMutation({
    mutationFn: () => {
      const full: CategoryCreateBody = {
        name: name.trim(),
        icon,
        iconGroup,
        departmentId,
        defaultDeadlineDays: deadlineNumber,
        clusterRadiusM: radiusNumber,
        active: true,
      };
      if (!category) return session.withAuth(() => api.panelCreateCategory(tenantId, full));
      // Na edição só vai o que mudou; `active` fica com a chave da tabela.
      const changes: CategoryUpdateBody = {};
      if (full.name !== category.name) changes.name = full.name;
      if (full.icon !== category.icon) changes.icon = full.icon;
      if (full.iconGroup !== category.iconGroup) changes.iconGroup = full.iconGroup;
      if (full.departmentId !== category.departmentId) changes.departmentId = full.departmentId;
      if (full.defaultDeadlineDays !== category.defaultDeadlineDays) {
        changes.defaultDeadlineDays = full.defaultDeadlineDays;
      }
      if (full.clusterRadiusM !== category.clusterRadiusM) {
        changes.clusterRadiusM = full.clusterRadiusM;
      }
      return session.withAuth(() => api.panelUpdateCategory(tenantId, category.id, changes));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: categoriesKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: departmentsKey(tenantId) }),
      ]);
      toast.show(editing ? 'Categoria salva.' : 'Categoria criada.');
      onClose();
    },
    onError: (error) => {
      if (errorCode(error) === 'category_name_taken') {
        setNameError('Já existe uma categoria com este nome.');
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  const title = editing ? `Editar: ${category.name}` : 'Nova categoria';
  const titleId = `${ids}-title`;

  return (
    <aside className={styles.editor} aria-labelledby={titleId}>
      <header className={styles.editorHeader}>
        <h2 id={titleId} className={styles.editorTitle}>
          {title}
        </h2>
        <button type="button" className={styles.close} aria-label="Fechar" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.editorBody}>
        <div className={fields.field}>
          <label htmlFor={`${ids}-name`} className={fields.label}>
            Nome no app
          </label>
          <input
            id={`${ids}-name`}
            className={fields.input}
            value={name}
            maxLength={CATEGORY_NAME_MAX}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? `${ids}-name-error` : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
          />
          {nameError ? (
            <p id={`${ids}-name-error`} className={fields.error}>
              {nameError}
            </p>
          ) : null}
        </div>

        <div className={fields.field}>
          <label htmlFor={`${ids}-icon`} className={fields.label}>
            Ícone
          </label>
          <div className={styles.iconRow}>
            <CategorySquare icon={icon} iconGroup={iconGroup} size={36} />
            <select
              id={`${ids}-icon`}
              className={fields.input}
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
            >
              {CATEGORY_ICON_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={fields.field}>
          <label htmlFor={`${ids}-group`} className={fields.label}>
            Cor do ícone
          </label>
          <select
            id={`${ids}-group`}
            className={fields.input}
            value={iconGroup}
            onChange={(event) => setIconGroup(event.target.value as IconGroup)}
          >
            {ICON_GROUPS.map((group) => (
              <option key={group} value={group}>
                {ICON_GROUP_LABELS[group]}
              </option>
            ))}
          </select>
        </div>

        <div className={fields.field}>
          <label htmlFor={`${ids}-department`} className={fields.label}>
            Setor responsável
          </label>
          <select
            id={`${ids}-department`}
            className={fields.input}
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

        <div className={fields.field}>
          <label htmlFor={`${ids}-deadline`} className={fields.label}>
            Prazo padrão
          </label>
          <div className={styles.withUnit}>
            <input
              id={`${ids}-deadline`}
              type="number"
              min={1}
              max={DEADLINE_DAYS_MAX}
              step={1}
              className={fields.input}
              value={deadline}
              aria-describedby={`${ids}-deadline-help`}
              onChange={(event) => setDeadline(event.target.value)}
            />
            <span className={styles.unit} aria-hidden="true">
              dias
            </span>
          </div>
          <p id={`${ids}-deadline-help`} className={fields.hint}>
            Usado como prazo interno ao atribuir. O cidadão não vê.
          </p>
        </div>

        <div className={fields.field}>
          <label htmlFor={`${ids}-radius`} className={fields.label}>
            Raio de agrupamento
          </label>
          <div className={styles.withUnit}>
            <input
              id={`${ids}-radius`}
              type="number"
              min={1}
              max={CLUSTER_RADIUS_MAX_M}
              step={1}
              className={fields.input}
              value={radius}
              aria-describedby={`${ids}-radius-help`}
              onChange={(event) => setRadius(event.target.value)}
            />
            <span className={styles.unit} aria-hidden="true">
              metros
            </span>
          </div>
          <p id={`${ids}-radius-help`} className={fields.hint}>
            {radius === ''
              ? 'Relatos desta categoria dentro do raio são sugeridos como a mesma ocorrência.'
              : `Relatos desta categoria a até ${radius} m são sugeridos como a mesma ocorrência.`}
          </p>
        </div>
      </div>
      <footer className={styles.editorFooter}>
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
      </footer>
    </aside>
  );
}
