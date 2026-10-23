import * as Location from 'expo-location';
import { router, type Href } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../ui/Button';
import { Footer } from '../../ui/Footer';
import { Header } from '../../ui/Header';
import { Screen } from '../../ui/Screen';
import { colors, fonts } from '../../ui/theme';

const NEW_REQUEST_ROUTE = '/(app)/nova';

/** Pede a localização antes da Nova solicitação (o Pencil não desenhou: segue os tokens). */
export default function PermissaoLocal() {
  // Negada para sempre: só as configurações do aparelho liberam.
  const [blocked, setBlocked] = useState(false);
  const [asking, setAsking] = useState(false);
  // A volta do diálogo de permissão também dispara o "active": abre a 5 uma vez só.
  const opened = useRef(false);
  const openNewRequest = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    router.replace(NEW_REQUEST_ROUTE as Href);
  }, []);

  const apply = useCallback(
    (permission: Location.LocationPermissionResponse) => {
      if (permission.granted) openNewRequest();
      else setBlocked(!permission.canAskAgain);
    },
    [openNewRequest],
  );

  // Confere ao abrir e ao voltar das configurações.
  useEffect(() => {
    const read = () =>
      Location.getForegroundPermissionsAsync()
        .then(apply)
        .catch(() => undefined);
    void read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    return () => sub.remove();
  }, [apply]);

  const allow = async () => {
    if (blocked) {
      void Linking.openSettings();
      return;
    }
    setAsking(true);
    try {
      apply(await Location.requestForegroundPermissionsAsync());
    } finally {
      setAsking(false);
    }
  };

  return (
    <Screen>
      <Header nav="close" onNavPress={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconCircle}>
          <MapPin size={34} color={colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Precisamos da sua localização
        </Text>
        <Text style={styles.body}>
          Ela mostra para a prefeitura onde está o problema e diz qual prefeitura atende o lugar.
        </Text>
      </ScrollView>
      <Footer variant="plain">
        <PrimaryButton
          label={blocked ? 'Abrir configurações' : 'Permitir localização'}
          icon={MapPin}
          loading={asking}
          onPress={() => void allow()}
        />
      </Footer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
});
