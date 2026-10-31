import { INCLUDED_USERS_MAX, PLANS, PLAN_LABELS } from '@alocidadao/shared';
import type { ContractFieldKey } from './contract-form';
import fields from '../../ui/Field.module.css';
import styles from './NewTenantPage.module.css';

export interface ContractFieldsValues {
  plan: (typeof PLANS)[number];
  included: string;
  startsOn: string;
  endsOn: string;
}

export interface ContractFieldsProps extends ContractFieldsValues {
  /** Prefixo dos ids; os erros ficam em `${idPrefix}-${campo}-error`. */
  idPrefix: string;
  errors: Partial<Record<ContractFieldKey, string>>;
  disabled?: boolean;
  onChange: (field: keyof ContractFieldsValues, value: string) => void;
}

/** Campos do contrato (plano, incluídos e vigência), usados no cadastro (P2) e na aba Contrato (P3). */
export function ContractFields({
  idPrefix,
  plan,
  included,
  startsOn,
  endsOn,
  errors,
  disabled = false,
  onChange,
}: ContractFieldsProps) {
  const described = (key: ContractFieldKey) => ({
    'aria-invalid': errors[key] !== undefined,
    'aria-describedby': errors[key] ? `${idPrefix}-${key}-error` : undefined,
  });
  const errorText = (key: ContractFieldKey) =>
    errors[key] ? (
      <p id={`${idPrefix}-${key}-error`} className={fields.error}>
        {errors[key]}
      </p>
    ) : null;

  return (
    <>
      <div className={styles.row}>
        <div className={`${fields.field} ${styles.grow}`}>
          <label htmlFor={`${idPrefix}-plan`} className={fields.label}>
            Plano
          </label>
          <select
            id={`${idPrefix}-plan`}
            className={fields.input}
            value={plan}
            disabled={disabled}
            onChange={(event) => onChange('plan', event.target.value)}
          >
            {PLANS.map((item) => (
              <option key={item} value={item}>
                {PLAN_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <div className={`${fields.field} ${styles.grow}`}>
          <label htmlFor={`${idPrefix}-included`} className={fields.label}>
            Agentes e gestores incluídos
          </label>
          <input
            id={`${idPrefix}-included`}
            type="number"
            min={1}
            max={INCLUDED_USERS_MAX}
            className={fields.input}
            value={included}
            disabled={disabled}
            {...described('includedPanelUsers')}
            onChange={(event) => onChange('included', event.target.value)}
          />
          {errorText('includedPanelUsers')}
        </div>
      </div>
      <div className={styles.row}>
        <div className={`${fields.field} ${styles.grow}`}>
          <label htmlFor={`${idPrefix}-starts`} className={fields.label}>
            Início da vigência
          </label>
          <input
            id={`${idPrefix}-starts`}
            type="date"
            className={fields.input}
            value={startsOn}
            disabled={disabled}
            {...described('startsOn')}
            onChange={(event) => onChange('startsOn', event.target.value)}
          />
          {errorText('startsOn')}
        </div>
        <div className={`${fields.field} ${styles.grow}`}>
          <label htmlFor={`${idPrefix}-ends`} className={fields.label}>
            Fim da vigência
          </label>
          <input
            id={`${idPrefix}-ends`}
            type="date"
            className={fields.input}
            value={endsOn}
            disabled={disabled}
            {...described('endsOn')}
            onChange={(event) => onChange('endsOn', event.target.value)}
          />
          {errorText('endsOn')}
        </div>
      </div>
    </>
  );
}
