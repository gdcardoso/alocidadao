import { LEGAL_DOCUMENTS, type LegalDocument } from '@alocidadao/shared';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../ui/Button';
import { Footer } from '../ui/Footer';
import { Header } from '../ui/Header';
import { Screen } from '../ui/Screen';
import { colors, fonts, space } from '../ui/theme';
import { markLegalRead } from './acceptance-store';

export interface LegalDocumentViewProps {
  slug: LegalDocument['slug'];
  /** Veio de uma caixa de aceite: mostra "Li e concordo" no fim. */
  fromAcceptance: boolean;
}

/** Tela de leitura de um documento legal: aviso, versão e seções; com "Li e concordo" se pedido. */
export function LegalDocumentView({ slug, fromAcceptance }: LegalDocumentViewProps) {
  const document = LEGAL_DOCUMENTS[slug];
  return (
    <Screen>
      <Header nav="back" onNavPress={() => router.back()} title={document.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.notice}>{document.notice}</Text>
        <Text style={styles.version}>Versão {document.version}</Text>
        {document.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {section.heading}
            </Text>
            {section.blocks.map((block, index) =>
              block.kind === 'paragraph' ? (
                <Text key={index} style={styles.text}>
                  {block.text}
                </Text>
              ) : (
                <View key={index} style={styles.list}>
                  {block.items.map((item) => (
                    <Text key={item} style={styles.text}>
                      {'•'} {item}
                    </Text>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}
      </ScrollView>
      {fromAcceptance ? (
        <Footer variant="plain">
          <PrimaryButton
            label="Li e concordo"
            onPress={() => {
              markLegalRead();
              router.back();
            }}
          />
        </Footer>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutterAuth, gap: 20 },
  notice: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.textSecondary },
  version: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary },
  section: { gap: 8 },
  heading: { fontFamily: fonts.heading, fontSize: 17, color: colors.textPrimary },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  list: { gap: 6 },
});
