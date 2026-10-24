import { Redirect } from 'expo-router';
import { homeFor } from '../auth/app-mode';
import { useSession } from '../auth/use-session';

/** Porta de entrada: manda para a abertura, para o login ou para a tela inicial do modo (agente ou cidadão). */
export default function Index() {
  const { status, mode } = useSession();
  if (status === 'loading') return <Redirect href="/abertura" />;
  if (status === 'signedOut') return <Redirect href="/(auth)/entrar" />;
  return <Redirect href={homeFor(mode)} />;
}
