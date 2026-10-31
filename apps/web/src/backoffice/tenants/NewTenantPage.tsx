import { PLANS, tenantCreateBodySchema, type MunicipalityOption } from '@alocidadao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePenLine, Map as MapIcon, Tags, UserCog } from 'lucide-react';
import { useId, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../../api';
import { maskCpfInput } from '../../format/cpf';
import { errorCode } from '../../occurrence/use-occurrence-actions';
import { useSession } from '../../session/SessionProvider';
import { apiErrorField, generalErrorMessage } from '../../teams/team-errors';
import { Button } from '../../ui/Button';
import fields from '../../ui/Field.module.css';
import { TopBar } from '../../ui/TopBar';
import { useToast } from '../../ui/Toast';
import { FrozenAccountPanel } from '../frozen/FrozenAccountPanel';
import { useBackofficeContext } from '../use-backoffice-context';
import { contractIssueError, DISPLAY_NAME_TEXT, REQUIRED_TEXT } from './contract-form';
import { ContractFields, type ContractFieldsValues } from './ContractFields';
import { MunicipalitySearch } from './MunicipalitySearch';
import styles from './NewTenantPage.module.css';

const LIST_PATH = '/backoffice/prefeituras';

type FieldKey =
  | 'displayName'
  | 'municipality'
  | 'name'
  | 'cpf'
  | 'email'
  | 'includedPanelUsers'
  | 'startsOn'
  | 'endsOn';
type Errors = Partial<Record<FieldKey, string>>;

/** P2: cadastro de prefeitura, só para o admin da equipe interna. */
export function NewTenantPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const context = useBackofficeContext();
  const ids = useId();
  const [municipality, setMunicipality] = useState<MunicipalityOption | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<(typeof PLANS)[number]>(PLANS[0]);
  const [included, setIncluded] = useState('50');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [copyCatalog, setCopyCatalog] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  /** CPF e e-mail do admin quando o CPF está preso numa conta congelada. */
  const [frozen, setFrozen] = useState<{ cpf: string; email: string } | null>(null);

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.backofficeCreateTenant>[0]) =>
      session.withAuth(() => api.backofficeCreateTenant(body)),
    onMutate: () => setFrozen(null),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['backoffice', 'tenants'] });
      toast.show('Prefeitura criada. Ela está em implantação.');
      void navigate(`${LIST_PATH}/${created.id}`);
    },
    onError: (error, body) => {
      const code = errorCode(error);
      if (code === 'municipality_not_found') {
        setErrors({ municipality: 'Município não encontrado. Busque de novo.' });
      } else if (code === 'tenant_exists') {
        setErrors({ municipality: 'Este município já tem prefeitura cadastrada.' });
      } else if (code === 'email_mismatch') {
        setErrors({
          email: `Este CPF já tem outro e-mail cadastrado: ${apiErrorField(error, 'maskedEmail') ?? ''}.`,
        });
      } else if (code === 'email_in_use') {
        setErrors({ email: 'Este e-mail já é de outra pessoa.' });
      } else if (code === 'staff_account_not_allowed') {
        setErrors({ cpf: 'Esta pessoa é da equipe Alô Cidadão. Use outro CPF.' });
      } else if (code === 'cpf_unavailable') {
        setFrozen({ cpf: body.admin.cpf, email: body.admin.email });
      } else {
        setGeneralError(generalErrorMessage(error));
      }
    },
  });

  if (context.data && context.data.platformRole !== 'admin') {
    return <Navigate to={LIST_PATH} replace />;
  }

  function chooseMunicipality(option: MunicipalityOption | null) {
    setMunicipality(option);
    setErrors((current) => ({ ...current, municipality: undefined }));
    if (option) {
      setDisplayName(`Prefeitura de ${option.name}`);
      setPhone('156');
    }
  }

  function submit() {
    setGeneralError(null);
    const found: Errors = {};
    if (!municipality) found.municipality = REQUIRED_TEXT;
    if (!displayName.trim()) found.displayName = REQUIRED_TEXT;
    if (!name.trim()) found.name = REQUIRED_TEXT;
    if (!cpf) found.cpf = REQUIRED_TEXT;
    if (!email.trim()) found.email = REQUIRED_TEXT;
    if (!startsOn) found.startsOn = REQUIRED_TEXT;
    const parsed = tenantCreateBodySchema.safeParse({
      ibgeCode: municipality?.ibgeCode ?? '',
      displayName,
      centralPhone: phone,
      admin: { name, cpf, email },
      contract: {
        plan,
        includedPanelUsers: included === '' ? Number.NaN : Number(included),
        startsOn,
        endsOn: endsOn === '' ? null : endsOn,
      },
      copyDefaultCatalog: copyCatalog,
    });
    let unmapped = false;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        if (path === 'displayName') found.displayName ??= DISPLAY_NAME_TEXT;
        else if (path === 'ibgeCode') found.municipality ??= REQUIRED_TEXT;
        else if (path === 'admin.name') found.name ??= 'Informe o nome (2 a 80 caracteres).';
        else if (path === 'admin.cpf') found.cpf ??= 'CPF inválido.';
        else if (path === 'admin.email') found.email ??= 'E-mail inválido.';
        else if (path.startsWith('contract.')) {
          const hit = contractIssueError(path.slice('contract.'.length), issue.message);
          if (hit) found[hit.key] ??= hit.text;
          else unmapped = true;
        } else unmapped = true;
      }
    }
    setErrors(found);
    if (unmapped) setGeneralError('Confira os dados e tente de novo.');
    if (Object.values(found).some(Boolean) || !parsed.success) return;
    create.mutate(parsed.data);
  }

  function clear(key: FieldKey) {
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function errorText(key: FieldKey) {
    return errors[key] ? (
      <p id={`${ids}-${key}-error`} className={fields.error}>
        {errors[key]}
      </p>
    ) : null;
  }
  const described = (key: FieldKey) => ({
    'aria-invalid': errors[key] !== undefined,
    'aria-describedby': errors[key] ? `${ids}-${key}-error` : undefined,
  });

  function changeContract(field: keyof ContractFieldsValues, value: string) {
    if (field === 'plan') setPlan(value as (typeof PLANS)[number]);
    else if (field === 'included') {
      setIncluded(value);
      clear('includedPanelUsers');
    } else if (field === 'startsOn') {
      setStartsOn(value);
      clear('startsOn');
      clear('endsOn');
    } else {
      setEndsOn(value);
      clear('endsOn');
    }
  }

  const goBack = () => void navigate(LIST_PATH);

  return (
    <>
      <TopBar
        title="Nova prefeitura"
        subtitle={
          'A prefeitura começa "Em implantação" e só aparece para os cidadãos quando for ativada.'
        }
        onBack={goBack}
      />
      <main className={styles.content}>
        <div className={styles.column}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              <MapIcon size={18} aria-hidden />
              Município
            </h2>
            <MunicipalitySearch
              value={municipality}
              onChange={chooseMunicipality}
              invalid={errors.municipality !== undefined}
              describedBy={errors.municipality ? `${ids}-municipality-error` : undefined}
            />
            {errorText('municipality')}
            {municipality ? (
              <div className={styles.notice}>
                <div className={styles.preview} aria-hidden>
                  <MapIcon size={20} />
                </div>
                <div>
                  <p className={styles.noticeTitle}>Limite do município importado do IBGE</p>
                  <p className={styles.noticeText}>
                    Usado para saber em qual prefeitura cai cada solicitação.
                  </p>
                </div>
              </div>
            ) : null}
            <div className={styles.row}>
              <div className={`${fields.field} ${styles.grow}`}>
                <label htmlFor={`${ids}-display`} className={fields.label}>
                  Nome de exibição
                </label>
                <input
                  id={`${ids}-display`}
                  className={fields.input}
                  maxLength={120}
                  value={displayName}
                  {...described('displayName')}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    clear('displayName');
                  }}
                />
                {errorText('displayName')}
              </div>
              <div className={`${fields.field} ${styles.narrow}`}>
                <label htmlFor={`${ids}-phone`} className={fields.label}>
                  Central de atendimento
                </label>
                <input
                  id={`${ids}-phone`}
                  className={fields.input}
                  maxLength={20}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              <UserCog size={18} aria-hidden />
              Admin da prefeitura
            </h2>
            <div className={fields.field}>
              <label htmlFor={`${ids}-name`} className={fields.label}>
                Nome
              </label>
              <input
                id={`${ids}-name`}
                className={fields.input}
                placeholder="Nome completo"
                maxLength={80}
                value={name}
                {...described('name')}
                onChange={(event) => {
                  setName(event.target.value);
                  clear('name');
                }}
              />
              {errorText('name')}
            </div>
            <div className={styles.row}>
              <div className={`${fields.field} ${styles.grow}`}>
                <label htmlFor={`${ids}-cpf`} className={fields.label}>
                  CPF
                </label>
                <input
                  id={`${ids}-cpf`}
                  className={fields.input}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  value={maskCpfInput(cpf)}
                  {...described('cpf')}
                  onChange={(event) => {
                    setCpf(event.target.value.replace(/\D/g, '').slice(0, 11));
                    clear('cpf');
                    setFrozen(null);
                  }}
                />
                {errorText('cpf')}
              </div>
              <div className={`${fields.field} ${styles.grow}`}>
                <label htmlFor={`${ids}-email`} className={fields.label}>
                  E-mail institucional
                </label>
                <input
                  id={`${ids}-email`}
                  type="email"
                  autoComplete="off"
                  className={fields.input}
                  placeholder="nome@prefeitura.gov.br"
                  value={email}
                  {...described('email')}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clear('email');
                    setFrozen(null);
                  }}
                />
                {errorText('email')}
              </div>
            </div>
            <p className={styles.help}>
              Ele entra no painel com o CPF e recebe o código neste e-mail. Depois cadastra
              gestores, equipes e agentes.
            </p>
            {frozen ? (
              // A prefeitura ainda não existe: a recuperação vai sem prefeitura.
              <FrozenAccountPanel
                cpf={frozen.cpf}
                email={frozen.email}
                tenantId={null}
                onResolved={submit}
              />
            ) : null}
          </section>
        </div>

        <div className={styles.column}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              <FilePenLine size={18} aria-hidden />
              Contrato
            </h2>
            <ContractFields
              idPrefix={ids}
              plan={plan}
              included={included}
              startsOn={startsOn}
              endsOn={endsOn}
              errors={errors}
              onChange={changeContract}
            />
            <p className={styles.help}>
              Registro do que foi contratado. Cobrança fica fora do MVP.
            </p>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              <Tags size={18} aria-hidden />
              Categorias iniciais
            </h2>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={copyCatalog}
                onChange={(event) => setCopyCatalog(event.target.checked)}
              />
              Copiar o catálogo padrão (9 categorias, prazos e raios sugeridos)
            </label>
            <p className={styles.help}>O admin da prefeitura pode ajustar depois em Categorias.</p>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        {generalError ? (
          <p className={`${fields.error} ${styles.footerError}`} role="alert">
            {generalError}
          </p>
        ) : null}
        <Button variant="secondary" size="md" onClick={goBack}>
          Cancelar
        </Button>
        <Button size="md" disabled={create.isPending} onClick={submit}>
          Criar prefeitura
        </Button>
      </footer>
    </>
  );
}
