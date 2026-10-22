import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '../../lib/api';
import { registerForPush, type PushRegistration } from '../../lib/push';

type Registered = Extract<PushRegistration, { token: string }>;
type PushResult = { kind: 'sent' | 'invalid_token' | 'retry'; reason?: string };

const TEST_PROTOCOL = '2026-000123';
const TEST_STATUS = 'in_progress'; // "em atendimento"
const DELAY_MS = 10_000;

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

async function sendTest(registration: Registered): Promise<string> {
  try {
    const response = await fetch(`${API_URL}/dev/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: registration.platform,
        token: registration.token,
        protocol: TEST_PROTOCOL,
        status: TEST_STATUS,
      }),
    });
    if (response.status === 503) {
      return 'A API ainda não está configurada para enviar push (push_not_configured). Veja a seção "Push (Firebase)" do .env.example.';
    }
    if (!response.ok) return `A API respondeu com erro ${response.status}.`;
    const result = (await response.json()) as PushResult;
    const reason = result.reason ? ` (${result.reason})` : '';
    return `Resultado do envio: ${result.kind}${reason}`;
  } catch {
    return 'Não foi possível falar com a API. Confira se ela está rodando.';
  }
}

export default function NotificacoesLab() {
  const [registration, setRegistration] = useState<PushRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const register = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      setRegistration(await registerForPush());
    } finally {
      setBusy(false);
    }
  };

  const send = async (registered: Registered) => {
    setBusy(true);
    setOutcome(await sendTest(registered));
    setBusy(false);
  };

  const sendLater = (registered: Registered) => {
    if (timer.current) clearTimeout(timer.current);
    setOutcome('Envio em 10 s: ponha o app em segundo plano ou feche-o.');
    timer.current = setTimeout(() => void send(registered), DELAY_MS);
  };

  const registered = registration && 'token' in registration ? registration : null;
  const error = registration && 'error' in registration ? registration.error : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Notificações</Text>
      <Button
        label={busy ? 'Aguarde...' : 'Registrar aparelho'}
        onPress={() => void register()}
        disabled={busy}
      />
      {registered && (
        <View style={styles.section}>
          <Text style={styles.row}>Plataforma: {registered.platform}</Text>
          <Text style={styles.row}>Token:</Text>
          <Text selectable style={styles.token}>
            {registered.token}
          </Text>
          <Button label="Enviar teste" onPress={() => void send(registered)} disabled={busy} />
          <Button label="Enviar em 10 s" onPress={() => sendLater(registered)} disabled={busy} />
        </View>
      )}
      {error === 'permission_denied' && (
        <View style={styles.section}>
          <Text style={styles.row}>
            Sem permissão de notificações não dá para avisar sobre o andamento da solicitação.
            Libere a permissão nas configurações do aparelho.
          </Text>
          <Button label="Abrir configurações" onPress={() => void Linking.openSettings()} />
        </View>
      )}
      {error === 'push_not_configured' && (
        <Text style={styles.error}>
          Push ainda não configurado neste build (falta o google-services.json).
        </Text>
      )}
      {registration && 'error' in registration && registration.error === 'token_failed' && (
        <Text style={styles.error}>
          Não foi possível obter o token de push: {registration.message}
        </Text>
      )}
      {error === 'unsupported' && (
        <Text style={styles.error}>Este aparelho ou simulador não recebe push remoto.</Text>
      )}
      {outcome && <Text style={styles.row}>{outcome}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  section: { gap: 12 },
  row: { fontSize: 16 },
  token: { fontSize: 12, fontFamily: 'monospace' },
  error: { fontSize: 16, color: '#b00020' },
  button: { backgroundColor: '#0b5fff', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
