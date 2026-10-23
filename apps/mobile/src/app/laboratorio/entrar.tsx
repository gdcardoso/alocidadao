import { ApiError } from '@alocidadao/api-client';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { LAB_TENANT_KEY, session, sessionApi } from '../../auth/native-session';
import { api } from '../../lib/api';
import { getDeviceInstallationId } from '../../lib/device-installation-id';
import { secureStore } from '../../lib/secure-store';

// Agente do seed de desenvolvimento (`pnpm db:seed:dev`).
const DEV_AGENT_PHONE = '+5511900000001';

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const code = (error.body as { code?: string } | null)?.code;
    return `A API respondeu ${error.status}${code ? ` (${code})` : ''}.`;
  }
  return `Não foi possível falar com a API: ${error instanceof Error ? error.message : error}`;
}

/** Login do Laboratório (só desenvolvimento): celular → código → sessão. */
export default function EntrarLab() {
  const [phone, setPhone] = useState(DEV_AGENT_PHONE);
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setStatus(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const challenge = await api.phoneStart({ phone: phone.trim() });
      setChallengeId(challenge.challengeId);
      setCode('');
      setStatus('Código enviado. Fora de produção, ele aparece no log da API.');
    });

  const verify = () =>
    run(async () => {
      if (!challengeId) return;
      const result = await api.phoneVerify({
        challengeId,
        code: code.trim(),
        device: {
          installationId: await getDeviceInstallationId(),
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          appVersion: Constants.expoConfig?.version ?? 'dev',
        },
      });
      if (result.status === 'needs_profile') {
        setStatus('Status: needs_profile (falta o cadastro, que é do Plano 3).');
        return;
      }
      if (result.status === 'email_check') {
        setStatus(`Status: email_check (código enviado para ${result.maskedEmail}).`);
        return;
      }
      await session.signIn(result.session);
      const me = await sessionApi.me();
      const tenant = me.agentTenants[0];
      if (tenant) {
        await secureStore.setItem(LAB_TENANT_KEY, tenant.tenantId);
        setStatus(`Logado como ${me.name}, agente em ${tenant.tenantName}.`);
      } else {
        await secureStore.deleteItem(LAB_TENANT_KEY);
        setStatus(`Logado como ${me.name}, sem vínculo de agente.`);
      }
      setChallengeId(null);
    });

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Entrar</Text>
      <Text style={styles.label}>Celular</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <Button label="Enviar código" onPress={() => void sendCode()} disabled={busy} />
      {challengeId && (
        <>
          <Text style={styles.label}>Código</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <Button label="Entrar" onPress={() => void verify()} disabled={busy} />
        </>
      )}
      {status && <Text style={styles.status}>{status}</Text>}
    </ScrollView>
  );
}

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

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  label: { fontSize: 15, fontWeight: '600' },
  status: { fontSize: 15 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  button: { backgroundColor: '#0b5fff', padding: 12, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
