import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { api } from '../../lib/api';
import { measureApiLatency, toConnectionContext } from '../../lib/connection';
import { getDeviceInstallationId } from '../../lib/device-installation-id';
import { toNetSnapshot } from '../../lib/net-info';

export default function Rede() {
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [context, setContext] = useState<ReturnType<typeof toConnectionContext> | null>(null);

  useEffect(() => {
    getDeviceInstallationId().then(setInstallationId);
  }, []);

  const latest = useRef(0);

  const refresh = useCallback(async (state: Parameters<typeof toNetSnapshot>[0]) => {
    const run = ++latest.current;
    const net = toNetSnapshot(state);
    const apiLatencyMs =
      net.isConnected === false ? null : await measureApiLatency(() => api.health());
    if (run !== latest.current) return; // chegou uma mudança de rede mais nova
    setContext(
      toConnectionContext(net, { apiLatencyMs, uploadDurationMs: null, sentOffline: false }),
    );
  }, []);

  // Atualiza a cada mudança de rede informada pelo NetInfo.
  useEffect(() => NetInfo.addEventListener((state) => void refresh(state)), [refresh]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Rede</Text>
      <Text style={styles.row}>Id de instalação: {installationId ?? '...'}</Text>
      <Text style={styles.row}>Tipo de rede: {context?.networkType ?? '...'}</Text>
      <Text style={styles.row}>
        Geração móvel: {context ? (context.cellularGeneration ?? '-') : '...'}
      </Text>
      <Text style={styles.row}>
        Latência até a API:{' '}
        {context
          ? context.apiLatencyMs === null
            ? 'sem resposta'
            : `${context.apiLatencyMs} ms`
          : '...'}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  row: { fontSize: 16 },
});
