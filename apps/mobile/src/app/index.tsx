import { Redirect } from 'expo-router';
import { homeFor } from '../auth/app-mode';
import { needsTermsAcceptance } from '../legal/terms-route';
import { useSession } from '../auth/use-session';

/** Porta de entrada: manda para a abertura, para o login ou para a tela inicial do modo (agente ou cidadão). */
export default function Index() {
  const { status, mode, me } = useSession();
  if (status === 'loading') return <Redirect href="/abertura" />;
  if (status === 'signedOut') return <Redirect href="/(auth)/entrar" />;
  if (needsTermsAcceptance(me)) return <Redirect href="/(app)/aceite" />;
  return <Redirect href={homeFor(mode)} />;
}
