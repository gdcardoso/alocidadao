import { createApiClient } from '@alocidadao/api-client';
import { REQUEST_STATUS_LABELS, REQUEST_STATUSES } from '@alocidadao/shared';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3333',
});

export default function App() {
  const [apiStatus, setApiStatus] = useState('verificando…');

  useEffect(() => {
    api
      .health()
      .then((health) => setApiStatus(`online (${health.service})`))
      .catch(() => setApiStatus('indisponível'));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Alô Cidadão</Text>
      <Text>API: {apiStatus}</Text>
      <Text style={styles.subtitle}>Status de solicitação</Text>
      {REQUEST_STATUSES.map((status) => (
        <Text key={status}>• {REQUEST_STATUS_LABELS[status]}</Text>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 8 },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
});
