import { Link, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

const sections: { href: Href; label: string }[] = [
  { href: '/laboratorio/rede', label: 'Rede' },
  { href: '/laboratorio/camera', label: 'Câmera e local' },
  { href: '/laboratorio/offline', label: 'Atividades offline' },
  { href: '/laboratorio/notificacoes', label: 'Notificações' },
];

export default function Laboratorio() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Laboratório</Text>
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
  link: { fontSize: 18, color: '#0b5fff' },
});
