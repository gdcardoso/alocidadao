import { ApiError } from '@alocidadao/api-client';
import type { FrozenAccountCodeResponse } from '@alocidadao/shared';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { CODE_LENGTH, CodeInput } from '../../auth/CodeInput';
import { formatCountdown } from '../../auth/login-errors';
import { errorCode } from '../../occurrence/use-occurrence-actions';
import { useSession } from '../../session/SessionProvider';
import { generalErrorMessage } from '../../teams/team-errors';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import fields from '../../ui/Field.module.css';
import styles from './FrozenAccountPanel.module.css';

export interface FrozenAccountPanelProps {
  /** CPF (só dígitos) que a tela tentou cadastrar. */
  cpf: string;
  /** E-mail digitado no cadastro: a conta recuperada passa a usá-lo. */
  email: string;
  /** Prefeitura do modo suporte; `null` na P2 e na P6. */
  tenantId: string | null;
  /** O CPF ficou livre ou numa conta ativa: a tela repete o cadastro. */
  onResolved: () => void;
}

const emptyCode = () => Array.from({ length: CODE_LENGTH }, () => '');

function retryAfter(error: unknown): number {
  if (!(error instanceof ApiError)) return 0;
  const value = (error.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof value === 'number' ? value : 0;
}

/**
 * CPF preso numa conta congelada: recuperar a conta antiga (código no e-mail dela, que só
 * aparece mascarado) ou criar uma conta nova (libera o CPF; a antiga continua congelada).
 */
export function FrozenAccountPanel({ cpf, email, tenantId, onResolved }: FrozenAccountPanelProps) {
  const { session } = useSession();
  const [challenge, setChallenge] = useState<FrozenAccountCodeResponse | null>(null);
  const [withoutEmail, setWithoutEmail] = useState(false);
  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [confirmNew, setConfirmNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Erros comuns às três chamadas; devolve a mensagem, ou `null` quando já resolveu. */
  function messageOf(failure: unknown): string | null {
    const code = errorCode(failure);
    if (code === 'frozen_account_not_found') {
      // O CPF já não está numa conta congelada: basta repetir o cadastro.
      onResolved();
      return null;
    }
    if (code === 'code_rate_limited') {
      return `Aguarde ${formatCountdown(retryAfter(failure))} para pedir outro código.`;
    }
    if (code === 'invalid_code') return 'Código incorreto ou expirado. Confira ou peça um novo.';
    if (code === 'email_in_use') return 'Este e-mail já é de outra pessoa.';
    return generalErrorMessage(failure);
  }

  const sendCode = useMutation({
    mutationFn: () => session.withAuth(() => api.backofficeFrozenAccountCode({ cpf, tenantId })),
    onMutate: () => setError(null),
    onSuccess: (sent) => {
      setChallenge(sent);
      setDigits(emptyCode());
    },
    onError: (failure) => {
      if (errorCode(failure) === 'frozen_account_without_email') {
        setWithoutEmail(true);
        return;
      }
      setError(messageOf(failure));
    },
  });

  const recover = useMutation({
    mutationFn: (sent: FrozenAccountCodeResponse) =>
      session.withAuth(() =>
        api.backofficeRecoverFrozenAccount({
          challengeId: sent.challengeId,
          code: digits.join(''),
          email,
          tenantId,
        }),
      ),
    onMutate: () => setError(null),
    onSuccess: () => onResolved(),
    onError: (failure) => setError(messageOf(failure)),
  });

  const release = useMutation({
    mutationFn: () => session.withAuth(() => api.backofficeReleaseFrozenCpf({ cpf, tenantId })),
    onMutate: () => setError(null),
    onSuccess: () => {
      setConfirmNew(false);
      onResolved();
    },
    onError: (failure) => {
      setConfirmNew(false);
      setError(messageOf(failure));
    },
  });

  const codeComplete = digits.every((digit) => digit !== '');
  const busy = sendCode.isPending || recover.isPending || release.isPending;

  return (
    <section className={styles.panel} aria-label="Conta bloqueada">
      <p className={styles.title}>
        <TriangleAlert size={18} aria-hidden="true" />
        Este CPF está numa conta bloqueada.
      </p>

      {withoutEmail ? (
        <p className={fields.hint}>
          A conta antiga não tem e-mail para receber o código. Só dá para criar uma conta nova.
        </p>
      ) : challenge ? (
        <>
          <p className={fields.hint}>
            Enviamos um código para {challenge.maskedEmail}, o e-mail da conta antiga.
          </p>
          <div className={fields.field}>
            <span className={fields.label}>Código</span>
            <CodeInput
              digits={digits}
              onChange={setDigits}
              disabled={busy}
              invalid={error !== null}
            />
          </div>
        </>
      ) : (
        <p className={fields.hint}>
          Recupere a conta antiga com o código enviado ao e-mail dela, ou crie uma conta nova sem o
          histórico da antiga.
        </p>
      )}

      {error ? (
        <p className={fields.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        {withoutEmail ? null : challenge ? (
          <>
            <Button
              size="sm"
              disabled={!codeComplete || busy}
              onClick={() => recover.mutate(challenge)}
            >
              Recuperar conta
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => sendCode.mutate()}>
              Enviar outro código
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => sendCode.mutate()}>
            Recuperar conta antiga
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmNew(true)}>
          Criar conta nova
        </Button>
      </div>

      {confirmNew ? (
        <ConfirmDialog
          title="Criar conta nova?"
          text="O CPF sai da conta antiga, que continua bloqueada e guarda o histórico dela. A pessoa começa do zero numa conta nova."
          confirmLabel="Criar conta nova"
          tone="primary"
          pending={release.isPending}
          onConfirm={() => release.mutate()}
          onClose={() => setConfirmNew(false)}
        />
      ) : null}
    </section>
  );
}
