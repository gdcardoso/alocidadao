import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Check, MapPinOff, Megaphone, Phone, PhoneCall } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { sessionApi } from '../../auth/native-session';
import { notServedTexts } from '../../citizen/new-request';
import { PrimaryButton, SecondaryButton, TextButton } from '../../ui/Button';
import { Footer } from '../../ui/Footer';
import { Header } from '../../ui/Header';
import { Screen } from '../../ui/Screen';
import { colors, fonts, radius } from '../../ui/theme';

const HOME_ROUTE = '/(app)/(tabs)/solicitacoes';
const DEFAULT_PHONE = '156';

/** Tela 5c · A cidade do ponto ainda não usa o Alô Cidadão. */
export default function NaoAtende() {
  const params = useLocalSearchParams<{
    name?: string;
    state?: string;
    ibgeCode?: string;
    phone?: string;
  }>();
  const municipality =
    params.name && params.state ? { name: params.name, state: params.state } : null;
  const texts = notServedTexts(municipality);
  const phone = params.phone || DEFAULT_PHONE;

  const [interest, setInterest] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const askForCity = async () => {
    if (!params.ibgeCode || interest !== 'idle') return;
    setInterest('sending');
    setError(null);
    try {
      await sessionApi.cityInterest({ ibgeCode: params.ibgeCode });
      setInterest('done');
    } catch {
      setInterest('idle');
      setError('Não foi possível registrar o pedido. Tente de novo.');
    }
  };

  const goHome = () => router.dismissTo(HOME_ROUTE as Href);

  return (
    <Screen>
      <Header nav="close" onNavPress={() => (router.canGoBack() ? router.back() : goHome())} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconCircle}>
          <MapPinOff size={34} color={colors.textSecondary} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title} accessibilityRole="header">
            {texts.title}
          </Text>
          <Text style={styles.body}>{texts.body}</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Phone size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Fale direto com a prefeitura</Text>
          </View>
          <Text style={styles.cardText}>{texts.contact}</Text>
          <SecondaryButton
            label={`Ligar para ${phone}`}
            icon={PhoneCall}
            size="medium"
            variant="outlinePrimary"
            onPress={() => void Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, '')}`)}
          />
        </View>
      </ScrollView>
      <Footer variant="plain">
        {params.ibgeCode ? (
          <>
            <PrimaryButton
              label={interest === 'done' ? 'Pedido registrado' : 'Quero o Alô Cidadão aqui'}
              icon={interest === 'done' ? Check : Megaphone}
              loading={interest === 'sending'}
              disabled={interest === 'done'}
              onPress={() => void askForCity()}
            />
            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : (
              <Text style={styles.hint}>Avisamos a prefeitura que moradores querem o serviço.</Text>
            )}
          </>
        ) : null}
        <TextButton label="Voltar para minhas solicitações" onPress={goHome} />
      </Footer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 24 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { gap: 12 },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary, flex: 1 },
  cardText: { fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary },
  hint: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  error: {
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
  },
});
