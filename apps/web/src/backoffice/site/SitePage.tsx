import {
  formatWhatsapp,
  maskPhoneInput,
  phoneFromMasked,
  siteContactSchema,
  type SiteContact,
} from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { api } from '../../api';
import { useSession } from '../../session/SessionProvider';
import { generalErrorMessage } from '../../teams/team-errors';
import { Button } from '../../ui/Button';
import fieldStyles from '../../ui/Field.module.css';
import { useToast } from '../../ui/Toast';
import { TopBar } from '../../ui/TopBar';
import { useBackofficeContext } from '../use-backoffice-context';
import { SITE_CONTACT_KEY } from './site-keys';
import styles from './SitePage.module.css';

const LIST_PATH = '/backoffice/prefeituras';

type FieldErrors = Partial<Record<keyof SiteContact, string>>;

const FIELD_MESSAGES: Record<keyof SiteContact, string> = {
  whatsapp: 'Informe um celular com DDD, como (62) 98208-9667.',
  email: 'Informe um e-mail válido.',
  responseNote: 'Escreva a frase com até 60 caracteres.',
};

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  help?: string;
  type?: string;
  placeholder?: string;
}

function TextField({ label, value, onChange, error, help, type, placeholder }: TextFieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, help ? `${id}-help` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={fieldStyles.field}>
      <label htmlFor={id} className={fieldStyles.label}>
        {label}
      </label>
      <input
        id={id}
        type={type ?? 'text'}
        autoComplete="off"
        placeholder={placeholder}
        className={fieldStyles.input}
        value={value}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={`${id}-error`} className={fieldStyles.error}>
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={`${id}-help`} className={fieldStyles.hint}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

interface ContactFormProps {
  contact: SiteContact;
}

/** Formulário com os valores salvos; remonta (via `key`) quando o servidor devolve outros. */
function ContactForm({ contact }: ContactFormProps) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [whatsapp, setWhatsapp] = useState(formatWhatsapp(contact.whatsapp));
  const [email, setEmail] = useState(contact.email);
  const [responseNote, setResponseNote] = useState(contact.responseNote);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: SiteContact) =>
      session.withAuth(() => api.backofficeUpdateSiteContact(body)),
    onSuccess: (saved) => {
      queryClient.setQueryData(SITE_CONTACT_KEY, saved);
      setWhatsapp(formatWhatsapp(saved.whatsapp));
      setEmail(saved.email);
      setResponseNote(saved.responseNote);
      toast.show('Contato salvo.');
    },
    onError: (error) => setFormError(generalErrorMessage(error)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = siteContactSchema.safeParse({
      whatsapp: phoneFromMasked(whatsapp) ?? '',
      email: email.trim(),
      responseNote,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SiteContact;
        next[key] ??= FIELD_MESSAGES[key];
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <h2 className={styles.title}>Contato da página de apresentação</h2>
      <TextField
        label="WhatsApp"
        type="tel"
        placeholder="(62) 98208-9667"
        value={whatsapp}
        onChange={(value) => setWhatsapp(maskPhoneInput(value))}
        error={errors.whatsapp}
      />
      <TextField
        label="E-mail"
        type="email"
        value={email}
        onChange={setEmail}
        error={errors.email}
      />
      <TextField
        label="Frase de prazo de resposta"
        value={responseNote}
        onChange={setResponseNote}
        error={errors.responseNote}
        help="Aparece embaixo do WhatsApp. Ex.: Resposta no mesmo dia."
      />
      {formError ? (
        <p role="alert" className={styles.alert}>
          {formError}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" size="md" disabled={save.isPending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

/** Tela Site: só o Admin; o Suporte volta para as prefeituras. */
export function SitePage() {
  const { session } = useSession();
  const context = useBackofficeContext();
  const isAdmin = context.data?.platformRole === 'admin';

  const query = useQuery({
    queryKey: SITE_CONTACT_KEY,
    queryFn: () => session.withAuth(() => api.backofficeSiteContact()),
    enabled: isAdmin,
  });

  if (context.data && !isAdmin) return <Navigate to={LIST_PATH} replace />;

  return (
    <>
      <TopBar title="Site" subtitle="O que aparece na página de apresentação" />
      <main className={styles.content}>
        {query.isError ? (
          <div role="alert" className={styles.error}>
            <p>Não foi possível carregar o contato.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {query.data ? <ContactForm contact={query.data} /> : null}
      </main>
    </>
  );
}
