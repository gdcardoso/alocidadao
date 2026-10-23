import { REQUEST_STATUS_LABELS, REQUEST_STATUSES } from '@alocidadao/shared';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { api } from '../lib/api';

export default function Home() {
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
      <Link href="/laboratorio" style={styles.link}>
        Laboratório
      </Link>
      {__DEV__ ? (
        <Link href="/dev/kit" style={styles.link}>
          Kit de componentes
        </Link>
      ) : null}
      <Text style={styles.subtitle}>Status de solicitação</Text>
      {REQUEST_STATUSES.map((status) => (
        <Text key={status}>• {REQUEST_STATUS_LABELS[status]}</Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  link: { fontSize: 18, color: '#0b5fff', marginTop: 8 },
});
