import { isValidCpf } from '@alocidadao/shared';
import type { PanelChallengeResponse } from '@alocidadao/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../api';
import panelLoginImage from '../assets/painel-login.png';
import symbolImage from '../assets/simbolo.png';
import { maskCpfInput } from '../format/cpf';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { CODE_LENGTH, CodeInput } from './CodeInput';
import { formatCountdown, INVALID_CPF_MESSAGE, loginErrorMessage } from './login-errors';
import styles from './LoginPage.module.css';

const HOME_PATH = '/mapa';
const BACKOFFICE_PATH = '/backoffice/prefeituras';

const emptyCode = (): string[] => Array.from({ length: CODE_LENGTH }, () => '');

type Step = { kind: 'cpf' } | { kind: 'code'; challenge: PanelChallengeResponse; resendAt: number };

/** W0a (CPF) e W0b (código do e-mail) na mesma rota, por etapa. */
export function LoginPage() {
  const { status, expiredNotice, session } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'cpf' });
  const [cpfDigits, setCpfDigits] = useState('');
  const [code, setCode] = useState<string[]>(emptyCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Evita enviar o mesmo código duas vezes (auto-envio + clique).
  const verifying = useRef(false);
  const cpfId = useId();
  const cpfHelpId = useId();
  const errorId = useId();

  const resendAt = step.kind === 'code' ? step.resendAt : 0;
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (resendAt === 0) return;
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAt) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendAt]);

  if (status === 'loading') return null;
  // Sessão restaurada: o painel (`PanelLayout`) manda a equipe interna sem modo suporte ao
  // backoffice e mantém quem está no modo suporte na prefeitura.
  if (status === 'signed_in' && !busy) return <Navigate to={HOME_PATH} replace />;

  /** Pede o código (primeira vez ou reenvio) e vai para a etapa do código. */
  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.panelStart({ cpf: cpfDigits });
      const current = Date.now();
      setNow(current);
      setCode(emptyCode());
      setStep({ kind: 'code', challenge, resendAt: current + challenge.resendInSeconds * 1000 });
    } catch (caught) {
      setError(loginErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitCpf = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!isValidCpf(cpfDigits)) {
      setError(INVALID_CPF_MESSAGE);
      return;
    }
    void requestCode();
  };

  const verify = async (digits: string[]) => {
    if (step.kind !== 'code' || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    try {
      const { session: access } = await api.panelVerify({
        challengeId: step.challenge.challengeId,
        code: digits.join(''),
      });
      session.signIn(access);
      // Equipe interna entra no backoffice; qualquer falha na consulta cai no mapa.
      const me = await session.withAuth(() => api.me()).catch(() => null);
      void navigate(me?.platformRole ? BACKOFFICE_PATH : HOME_PATH, { replace: true });
    } catch (caught) {
      setError(loginErrorMessage(caught));
      setCode(emptyCode());
      setBusy(false);
    } finally {
      verifying.current = false;
    }
  };

  const changeCode = (digits: string[]) => {
    setCode(digits);
    if (digits.every((digit) => digit !== '')) void verify(digits);
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (code.every((digit) => digit !== '')) void verify(code);
  };

  const backToCpf = () => {
    setStep({ kind: 'cpf' });
    setError(null);
  };

  return (
    <div className={styles.page}>
      <aside className={styles.brandSide} style={{ backgroundImage: `url(${panelLoginImage})` }}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <img src={symbolImage} alt="" width={38} height={38} />
          </span>
          <span className={styles.brandName}>Alô Cidadão</span>
        </div>
        <div className={styles.message}>
          <p className={styles.overline}>PAINEL DA PREFEITURA</p>
          <p className={styles.headline}>
            <span>Cada solicitação,</span>
            <span className={styles.headlineAccent}>uma cidade melhor.</span>
          </p>
          <p className={styles.lead}>
            Acompanhe as solicitações dos cidadãos, organize as equipes e responda com
            transparência.
          </p>
        </div>
        <p className={styles.restricted}>
          Acesso restrito a servidores cadastrados pela prefeitura.
        </p>
      </aside>

      <main className={styles.formSide}>
        {step.kind === 'cpf' ? (
          <form className={styles.card} onSubmit={submitCpf} noValidate>
            {expiredNotice && (
              <p className={styles.notice} role="status">
                Sua sessão expirou. Entre de novo.
              </p>
            )}
            <div className={styles.titles}>
              <h1 className={styles.title}>Entrar</h1>
              <p className={styles.subtitle}>Use o CPF cadastrado pela sua prefeitura.</p>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={cpfId}>
                CPF
              </label>
              <input
                id={cpfId}
                className={styles.input}
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={maskCpfInput(cpfDigits)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${errorId} ${cpfHelpId}` : cpfHelpId}
                onChange={(event) => {
                  setCpfDigits(event.target.value.replace(/\D/g, '').slice(0, 11));
                  setError(null);
                }}
              />
              {error && (
                <p id={errorId} className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <p id={cpfHelpId} className={styles.help}>
                Vamos enviar um código para o e-mail cadastrado.
              </p>
            </div>
            <Button type="submit" fullWidth disabled={busy}>
              {busy ? 'Enviando…' : 'Enviar código'}
            </Button>
            <p className={styles.footnote}>
              Não recebeu acesso? Fale com o administrador do Alô Cidadão na sua prefeitura.
            </p>
          </form>
        ) : (
          <form className={styles.card} onSubmit={submitCode} noValidate>
            <button type="button" className={styles.back} onClick={backToCpf}>
              <ArrowLeft size={16} aria-hidden />
              Trocar CPF
            </button>
            <div className={styles.titles}>
              <h1 className={styles.title}>Confira seu e-mail</h1>
              <p className={styles.subtitle}>
                Enviamos um código de 6 dígitos para {step.challenge.maskedEmail}. Ele vale por{' '}
                {Math.round(step.challenge.expiresInSeconds / 60)} minutos.
              </p>
            </div>
            <div className={styles.field}>
              <CodeInput digits={code} onChange={changeCode} disabled={busy} invalid={!!error} />
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" fullWidth disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
            <p className={styles.footnote}>
              {secondsLeft > 0 ? (
                `Não chegou? Veja o spam ou reenvie em ${formatCountdown(secondsLeft)}.`
              ) : (
                <>
                  Não chegou? Veja o spam ou{' '}
                  <button
                    type="button"
                    className={styles.link}
                    disabled={busy}
                    onClick={() => void requestCode()}
                  >
                    reenvie o código
                  </button>
                </>
              )}
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
