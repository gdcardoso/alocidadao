import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../auth/use-session';
import { SecondaryButton, TextButton } from '../../ui/Button';
import { firstName } from '../../ui/format';
import { Screen } from '../../ui/Screen';
import { colors, fonts, space } from '../../ui/theme';

// Provisória: a Task 8 troca pela lista de solicitações com as abas.
export default function MinhasSolicitacoes() {
  const { me, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);

  return (
    <Screen>
      <View style={styles.header}>
        {me ? <Text style={styles.hello}>Olá, {firstName(me.name)}</Text> : null}
        <Text style={styles.title} accessibilityRole="header">
          Minhas solicitações
        </Text>
      </View>
      {__DEV__ ? (
        <View style={styles.dev}>
          <TextButton label="Laboratório" onPress={() => router.push('/laboratorio')} />
          <TextButton label="Kit de componentes" onPress={() => router.push('/dev/kit')} />
          <SecondaryButton
            label="Sair da conta"
            loading={leaving}
            onPress={() => {
              setLeaving(true);
              void signOut().finally(() => setLeaving(false));
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 4, paddingHorizontal: space.gutter, paddingBottom: 8, gap: 4 },
  hello: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
  dev: { padding: space.gutter, gap: 12 },
});
