import { useNavigate } from 'react-router';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import styles from './NoAccessPage.module.css';

/** Mostrada quando o usuário não tem prefeitura ou a API responde 403 `not_a_member`. */
export function NoAccessPage() {
  const { session } = useSession();
  const navigate = useNavigate();

  async function signOut() {
    await session.signOut();
    void navigate('/entrar', { replace: true });
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Seu acesso ao painel não está ativo</h1>
        <p className={styles.text}>Fale com o administrador do Alô Cidadão na sua prefeitura.</p>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sair
        </Button>
      </div>
    </main>
  );
}
