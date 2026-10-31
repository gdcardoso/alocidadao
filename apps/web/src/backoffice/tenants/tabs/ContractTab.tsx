import {
  PLANS,
  contractBodySchema,
  contractTermsSchema,
  type NeighborhoodsSummary,
} from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePenLine, Map as MapIcon, RotateCcw, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { api } from '../../../api';
import { errorCode } from '../../../occurrence/use-occurrence-actions';
import { useSession } from '../../../session/SessionProvider';
import { generalErrorMessage } from '../../../teams/team-errors';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import fields from '../../../ui/Field.module.css';
import { useToast } from '../../../ui/Toast';
import {
  contractIssueError,
  DISPLAY_NAME_TEXT,
  REQUIRED_TEXT,
  type ContractFieldKey,
} from '../contract-form';
import { ContractFields, type ContractFieldsValues } from '../ContractFields';
import cardStyles from '../NewTenantPage.module.css';
import type { TenantTabProps } from '../tenant-tabs';
import styles from './ContractTab.module.css';

const FORMAT_MESSAGE =
  'O arquivo precisa ser GeoJSON com um polígono por bairro e o nome em nome ou name.';

type Errors = Partial<Record<ContractFieldKey | 'displayName', string>>;

function countText(summary: NeighborhoodsSummary): string {
  if (summary.source === null) return 'Nenhum bairro carregado.';
  const origin = summary.source === 'tenant' ? 'enviados pela prefeitura' : 'malha do IBGE';
  return `${summary.count} ${summary.count === 1 ? 'bairro' : 'bairros'} · ${origin}`;
}

/** Aba Contrato da P3: dados e vigência (só o admin edita) e os bairros da prefeitura. */
export function ContractTab({ tenant, isAdmin }: TenantTabProps) {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const { contract } = tenant;
  const [displayName, setDisplayName] = useState(tenant.displayName);
  const [phone, setPhone] = useState(tenant.centralPhone ?? '');
  const [plan, setPlan] = useState<(typeof PLANS)[number]>(contract?.plan ?? PLANS[0]);
  const [included, setIncluded] = useState(String(contract?.includedPanelUsers ?? 50));
  const [startsOn, setStartsOn] = useState(contract?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(contract?.endsOn ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.backofficeUpdateContract>[1]) =>
      session.withAuth(() => api.backofficeUpdateContract(tenant.id, body)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['backoffice'] });
      toast.show('Contrato salvo.');
    },
    onError: (error) => {
      if (errorCode(error) === 'invalid_contract') {
        setGeneralError('Confira os dados e tente de novo.');
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  const neighborhoodsKey = ['backoffice', 'tenant', tenant.id, 'neighborhoods'];
  const neighborhoods = useQuery({
    queryKey: neighborhoodsKey,
    queryFn: () => session.withAuth(() => api.backofficeNeighborhoods(tenant.id)),
  });

  const upload = useMutation({
    mutationFn: (geojson: unknown) =>
      session.withAuth(() => api.backofficePutNeighborhoods(tenant.id, geojson)),
    onSuccess: (summary) => {
      queryClient.setQueryData(neighborhoodsKey, summary);
      toast.show(`Bairros carregados: ${summary.count}.`);
    },
    onError: (error) => {
      if (errorCode(error) === 'invalid_neighborhoods') setFileError(FORMAT_MESSAGE);
      else toast.show(generalErrorMessage(error));
    },
  });

  const reset = useMutation({
    mutationFn: () => session.withAuth(() => api.backofficeResetNeighborhoods(tenant.id)),
    onSuccess: (summary) => {
      setConfirmingReset(false);
      queryClient.setQueryData(neighborhoodsKey, summary);
      toast.show('A prefeitura voltou para a malha do IBGE.');
    },
    onError: (error) => {
      setConfirmingReset(false);
      toast.show(generalErrorMessage(error));
    },
  });

  function changeContract(field: keyof ContractFieldsValues, value: string) {
    setGeneralError(null);
    if (field === 'plan') setPlan(value as (typeof PLANS)[number]);
    else if (field === 'included') {
      setIncluded(value);
      setErrors((current) => ({ ...current, includedPanelUsers: undefined }));
    } else if (field === 'startsOn') {
      setStartsOn(value);
      setErrors((current) => ({ ...current, startsOn: undefined, endsOn: undefined }));
    } else {
      setEndsOn(value);
      setErrors((current) => ({ ...current, endsOn: undefined }));
    }
  }

  function submit() {
    setGeneralError(null);
    const found: Errors = {};
    if (!displayName.trim()) found.displayName = REQUIRED_TEXT;
    if (!startsOn) found.startsOn = REQUIRED_TEXT;
    const terms = contractTermsSchema.safeParse({
      plan,
      includedPanelUsers: included === '' ? Number.NaN : Number(included),
      startsOn,
      endsOn: endsOn === '' ? null : endsOn,
    });
    if (!terms.success) {
      for (const issue of terms.error.issues) {
        const hit = contractIssueError(issue.path.join('.'), issue.message);
        if (hit) found[hit.key] ??= hit.text;
      }
    }
    const body = contractBodySchema.safeParse({
      displayName,
      centralPhone: phone,
      plan,
      startsOn,
      endsOn: endsOn === '' ? null : endsOn,
      includedPanelUsers: included === '' ? Number.NaN : Number(included),
    });
    if (!body.success && body.error.issues.some((issue) => issue.path[0] === 'displayName')) {
      found.displayName ??= DISPLAY_NAME_TEXT;
    }
    setErrors(found);
    if (Object.values(found).some(Boolean) || !terms.success || !body.success) return;
    save.mutate(body.data);
  }

  async function chooseFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    let geojson: unknown;
    try {
      geojson = JSON.parse(await file.text());
    } catch {
      setFileError(FORMAT_MESSAGE);
      return;
    }
    upload.mutate(geojson);
  }

  const readOnly = !isAdmin;
  const summary = neighborhoods.data;

  return (
    <div className={styles.column}>
      <section className={cardStyles.card}>
        <h2 className={cardStyles.cardTitle}>
          <FilePenLine size={18} aria-hidden />
          Contrato
        </h2>
        <div className={cardStyles.row}>
          <div className={`${fields.field} ${cardStyles.grow}`}>
            <label htmlFor={`${ids}-display`} className={fields.label}>
              Nome de exibição
            </label>
            <input
              id={`${ids}-display`}
              className={fields.input}
              maxLength={120}
              value={displayName}
              disabled={readOnly}
              aria-invalid={errors.displayName !== undefined}
              aria-describedby={errors.displayName ? `${ids}-displayName-error` : undefined}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setErrors((current) => ({ ...current, displayName: undefined }));
              }}
            />
            {errors.displayName ? (
              <p id={`${ids}-displayName-error`} className={fields.error}>
                {errors.displayName}
              </p>
            ) : null}
          </div>
          <div className={`${fields.field} ${cardStyles.narrow}`}>
            <label htmlFor={`${ids}-phone`} className={fields.label}>
              Central de atendimento
            </label>
            <input
              id={`${ids}-phone`}
              className={fields.input}
              maxLength={20}
              value={phone}
              disabled={readOnly}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>
        <ContractFields
          idPrefix={ids}
          plan={plan}
          included={included}
          startsOn={startsOn}
          endsOn={endsOn}
          errors={errors}
          disabled={readOnly}
          onChange={changeContract}
        />
        {isAdmin ? (
          <div className={styles.footer}>
            {generalError ? (
              <p className={fields.error} role="alert">
                {generalError}
              </p>
            ) : null}
            <Button size="md" disabled={save.isPending} onClick={submit}>
              Salvar contrato
            </Button>
          </div>
        ) : null}
      </section>

      <section className={cardStyles.card} aria-labelledby={`${ids}-hoods`}>
        <h2 id={`${ids}-hoods`} className={cardStyles.cardTitle}>
          <MapIcon size={18} aria-hidden />
          Bairros
        </h2>
        {summary ? <p className={styles.summary}>{countText(summary)}</p> : null}
        {fileError ? (
          <p className={fields.error} role="alert">
            {fileError}
          </p>
        ) : null}
        {isAdmin ? (
          <div className={styles.buttons}>
            <Button
              variant="secondary"
              size="md"
              icon={<Upload size={16} aria-hidden />}
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              Carregar arquivo de bairros
            </Button>
            {summary?.source === 'tenant' ? (
              <Button
                variant="secondary"
                size="md"
                icon={<RotateCcw size={16} aria-hidden />}
                onClick={() => setConfirmingReset(true)}
              >
                Voltar para a malha do IBGE
              </Button>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              className={styles.hidden}
              aria-label="Arquivo de bairros"
              onChange={(event) => {
                const input = event.target;
                const file = input.files?.[0];
                void chooseFile(file).finally(() => {
                  input.value = '';
                });
              }}
            />
          </div>
        ) : null}
      </section>

      {confirmingReset ? (
        <ConfirmDialog
          title="Voltar para a malha do IBGE?"
          text="Os bairros enviados pela prefeitura são apagados e as ocorrências são recalculadas."
          confirmLabel="Voltar para a malha do IBGE"
          tone="danger"
          pending={reset.isPending}
          onConfirm={() => reset.mutate()}
          onClose={() => setConfirmingReset(false)}
        />
      ) : null}
    </div>
  );
}
