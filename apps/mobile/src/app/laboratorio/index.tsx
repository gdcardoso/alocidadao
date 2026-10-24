import { Link, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { session, sessionApi, signOutAndClear } from '../../auth/native-session';

const sections: { href: Href; label: string }[] = [
  { href: '/laboratorio/rede', label: 'Rede' },
  { href: '/laboratorio/camera', label: 'Câmera e local' },
  { href: '/laboratorio/notificacoes', label: 'Notificações' },
];

/** Quem está logado: nome pela API; sem rede, só que há sessão no aparelho. */
async function describeSession(): Promise<string | null> {
  if (!(await session.isSignedIn())) return null;
  try {
    const me = await sessionApi.me();
    return `${me.name} (${me.phone ?? 'sem celular'})`;
  } catch {
    return (await session.isSignedIn()) ? 'sessão guardada (sem resposta da API)' : null;
  }
}

export default function Laboratorio() {
  const [who, setWho] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Atualiza ao voltar ao Laboratório.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void describeSession().then((value) => {
        if (active) setWho(value);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const signOut = async () => {
    setBusy(true);
    try {
      await signOutAndClear();
      setWho(null);
    } catch (error) {
      console.warn('Falha ao sair', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Laboratório</Text>
      {who === undefined ? (
        <Text style={styles.row}>Verificando a sessão...</Text>
      ) : who ? (
        <>
          <Text style={styles.row}>Logado: {who}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            disabled={busy}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Sair</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.row}>Ninguém logado.</Text>
      )}
      {sections.map((section) => (
        <Link key={String(section.href)} href={section.href} style={styles.link}>
          {section.label}
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  row: { fontSize: 15 },
  link: { fontSize: 18, color: '#0b5fff' },
  button: { backgroundColor: '#0b5fff', padding: 12, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
