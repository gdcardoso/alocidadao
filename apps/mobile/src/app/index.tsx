import { Redirect } from 'expo-router';
import { useSession } from '../auth/use-session';

/** Porta de entrada: manda para a abertura, para o login ou para o app, conforme a sessão. */
export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <Redirect href="/abertura" />;
  if (status === 'signedOut') return <Redirect href="/(auth)/entrar" />;
  return <Redirect href="/(app)/solicitacoes" />;
}
