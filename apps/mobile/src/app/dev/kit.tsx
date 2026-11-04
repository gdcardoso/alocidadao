import type { RequestCard as RequestCardData } from '@alocidadao/shared';
import { Redirect, router } from 'expo-router';
import { Hand, HandHeart, Send, ThumbsUp } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { toCardModel, toQueuedCardModel } from '../../citizen/requests-view';
import { BottomSheet } from '../../ui/BottomSheet';
import { PrimaryButton, SecondaryButton, TextButton } from '../../ui/Button';
import { CategoryOption } from '../../ui/CategoryOption';
import { Checkbox } from '../../ui/Checkbox';
import { CityChip, FilterChip } from '../../ui/Chip';
import { CodeInput } from '../../ui/CodeInput';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Footer } from '../../ui/Footer';
import { Header } from '../../ui/Header';
import { PhotoStack } from '../../ui/PhotoStack';
import { RequestCard } from '../../ui/RequestCard';
import { Screen } from '../../ui/Screen';
import { StatusBadge } from '../../ui/StatusBadge';
import { StatusNotice } from '../../ui/StatusNotice';
import { TabBar } from '../../ui/TabBar';
import { TeamReport } from '../../ui/TeamReport';
import { TextField } from '../../ui/TextField';
import { Timeline } from '../../ui/Timeline';
import { colors, fonts, space } from '../../ui/theme';

// Vitrine dos componentes do Pencil, só em desenvolvimento: confere fontes, cores e tamanhos
// no aparelho sem passar pelas telas. Os dados são os exemplos do Pencil.

const card = (over: Partial<RequestCardData>): RequestCardData => ({
  id: '00000000-0000-4000-8000-000000000001',
  protocol: '2026-000123',
  status: 'open',
  categoryName: 'Buraco na via',
  icon: 'construction',
  iconGroup: 'infrastructure',
  address: 'Rua das Flores, 120',
  createdAt: new Date().toISOString(),
  statusChangedAt: new Date().toISOString(),
  ...over,
});

const CATEGORIES = [
  { name: 'Buraco na via', icon: 'construction', group: 'infrastructure' },
  { name: 'Lixo e entulho', icon: 'trash-2', group: 'environment' },
  { name: 'Animal', icon: 'paw-print', group: 'public_services' },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function Kit() {
  const [phone, setPhone] = useState('(11) 98765-4321');
  const [code, setCode] = useState('482');
  const [terms, setTerms] = useState(true);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('Buraco na via');
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Screen>
      <Header
        nav="back"
        onNavPress={() => router.back()}
        title="Kit de componentes"
        subtitle="Somente em desenvolvimento"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Tipografia">
          <Text style={styles.h26}>Digite o código</Text>
          <Text style={styles.h24}>Minhas solicitações</Text>
          <Text style={styles.body}>
            Avise a prefeitura sobre problemas na sua cidade e acompanhe cada etapa do atendimento.
          </Text>
        </Section>

        <Section title="Botões">
          <PrimaryButton label="Enviar solicitação" icon={Send} onPress={() => undefined} />
          <PrimaryButton label="Confirmar" disabled onPress={() => undefined} />
          <PrimaryButton label="Enviando" loading onPress={() => undefined} />
          <SecondaryButton label="Não, é outro problema" onPress={() => undefined} />
          <SecondaryButton
            label="Cancelar solicitação"
            variant="danger"
            onPress={() => undefined}
          />
          <SecondaryButton
            label="Ligar para 156"
            variant="outlinePrimary"
            size="medium"
            onPress={() => undefined}
          />
          <TextButton label="Voltar para minhas solicitações" onPress={() => undefined} />
        </Section>

        <Section title="Campos">
          <TextField
            label="Seu celular"
            prefix="+55"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            help="Enviaremos um código por SMS para confirmar que o número é seu."
          />
          <TextField
            label="E-mail"
            requirement="optional"
            placeholder="seuemail@exemplo.com"
            help="Ajuda a recuperar sua conta se você trocar de número."
          />
          <TextField label="Nome" requirement="required" error="Informe seu nome" />
          <CodeInput value={code} onChange={setCode} />
          <Checkbox
            checked={terms}
            onChange={setTerms}
            label="Li e aceito os Termos de Uso e estou ciente da Política de Privacidade."
          />
        </Section>

        <Section title="Chips e selos">
          <CityChip label="Você está em São Paulo" />
          <View style={styles.row}>
            {[
              ['all', 'Todas'],
              ['active', 'Em andamento'],
              ['done', 'Concluídas'],
            ].map(([key, label]) => (
              <FilterChip
                key={key}
                label={label!}
                selected={filter === key}
                onPress={() => setFilter(key!)}
              />
            ))}
          </View>
          <View style={styles.wrap}>
            <StatusBadge status="open" />
            <StatusBadge status="in_progress" />
            <StatusBadge status="awaiting_confirmation" />
            <StatusBadge status="completed" />
            <StatusBadge status="rejected" />
          </View>
        </Section>

        <Section title="Categorias">
          <View style={styles.row}>
            {CATEGORIES.map((c) => (
              <CategoryOption
                key={c.name}
                name={c.name}
                icon={c.icon}
                group={c.group}
                selected={category === c.name}
                onPress={() => setCategory(c.name)}
              />
            ))}
          </View>
        </Section>

        <Section title="Cartões">
          <RequestCard
            view={toCardModel(card({ status: 'awaiting_confirmation' }))}
            highlighted
            onPress={() => undefined}
            action={{ label: 'Ver atendimento e confirmar', onPress: () => undefined }}
          />
          <RequestCard
            view={toCardModel(
              card({
                status: 'completed',
                categoryName: 'Poda de árvore',
                icon: 'trees',
                iconGroup: 'environment',
                address: 'Rua Ipê, 33',
                protocol: '2026-000052',
                createdAt: '2026-10-02T13:00:00.000Z',
              }),
            )}
            onPress={() => undefined}
          />
          <RequestCard
            view={toQueuedCardModel({
              id: 'fila-1',
              categoryName: 'Iluminação',
              icon: 'lightbulb',
              iconGroup: 'infrastructure',
              address: 'Av. Brasil, 1450',
              createdAt: '2026-10-23T11:12:00.000Z',
              rejection: null,
            })}
          />
        </Section>

        <Section title="Detalhe">
          <StatusNotice
            tone="awaiting"
            title="A prefeitura concluiu o atendimento"
            text="Confira as fotos e diga se o problema foi resolvido. Sem resposta, confirmamos automaticamente em 7 dias."
          />
          <StatusNotice
            tone="open"
            title="Aberta há 3 dias"
            text="Aguardando a prefeitura analisar e encaminhar para uma equipe. Você recebe um aviso a cada mudança."
          />
          <View style={styles.row}>
            <PhotoStack
              uri={null}
              count={3}
              onPress={() => undefined}
              accessibilityLabel="Sua foto"
            />
          </View>
          <TeamReport
            kind="team"
            title="Equipe Obras · Centro"
            date="Concluído em 21 out, 15:40"
            text="Buraco tapado com asfalto a quente. Área sinalizada até a secagem, liberada no fim da tarde."
          />
          <Timeline
            steps={[
              { title: 'Aberta', detail: '20 out, 08:12', state: 'done' },
              {
                title: 'Em atendimento',
                detail: 'Equipe Obras · Centro · 20 out, 14:30',
                state: 'done',
              },
              { title: 'Concluída pela equipe', detail: '21 out, 15:40', state: 'current' },
              { title: 'Sua confirmação', detail: 'Aguardando você', state: 'waiting' },
            ]}
          />
        </Section>

        <Section title="Painel e confirmação">
          <SecondaryButton label="Abrir painel" icon={Hand} onPress={() => setSheet(true)} />
          <SecondaryButton label="Abrir confirmação" onPress={() => setDialog(true)} />
        </Section>
      </ScrollView>

      <Footer>
        <PrimaryButton label="Sim, foi resolvido" icon={ThumbsUp} onPress={() => undefined} />
      </Footer>
      <TabBar active="requests" onNavigate={() => undefined} />

      <BottomSheet visible={sheet} onClose={() => setSheet(false)}>
        <Text style={styles.h22}>Já relataram isso aqui perto</Text>
        <Text style={styles.body}>
          Se for o mesmo problema, apoie o relato existente. Você acompanha o atendimento e recebe
          os avisos do mesmo jeito.
        </Text>
        <PrimaryButton
          label="É o mesmo, apoiar relato"
          icon={HandHeart}
          onPress={() => setSheet(false)}
        />
        <SecondaryButton label="Não, é outro problema" onPress={() => setSheet(false)} />
      </BottomSheet>
      <ConfirmDialog
        visible={dialog}
        title="Excluir sua conta?"
        message="Seus dados pessoais serão apagados. As solicitações continuam com a prefeitura, sem seu nome."
        confirmLabel="Excluir conta"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => setDialog(false)}
        onCancel={() => setDialog(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, gap: space.section, paddingBottom: 40 },
  section: { gap: 12 },
  sectionTitle: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  h26: { fontFamily: fonts.heading, fontSize: 26, color: colors.textPrimary },
  h24: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
  h22: { fontFamily: fonts.heading, fontSize: 22, color: colors.textPrimary },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
});
