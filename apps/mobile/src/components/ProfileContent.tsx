import { router, type Href } from 'expo-router';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import {
  ChevronRight,
  FileText,
  HardHat,
  LogOut,
  Mail,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiErrorMessage } from '../auth/login-flow';
import { sessionApi } from '../auth/native-session';
import { useSession } from '../auth/use-session';
import { pendingCount, signOutWarning } from '../citizen/profile-view';
import { openOutboxStore } from '../offline/sqlite-outbox-store';
import { SecondaryButton, TextButton } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FormError } from '../ui/FormLayout';
import { formatPhoneBR, initials } from '../ui/format';
import { Screen } from '../ui/Screen';
import { colors, fonts, radius, space } from '../ui/theme';

const TERMS_URL = 'https://alocidadao.com.br/termos';
const PRIVACY_URL = 'https://alocidadao.com.br/privacidade';

/** Envios na fila (de qualquer tipo) que a saída apagaria. Sem conseguir ler, conta zero. */
async function countPendingUploads(): Promise<number> {
  try {
    const store = await openOutboxStore();
    return pendingCount(await store.list());
  } catch {
    return 0;
  }
}

/**
 * Conteúdo do Perfil (tela 8), usado pelas abas do cidadão e do agente: conta, links, troca de
 * modo (só para quem tem vínculo de agente) e sessão.
 */
export function ProfileContent() {
  const { me, signOut, mode, setMode, isAgent } = useSession();
  const tabBarHeight = useBottomTabBarHeight();
  const [leaving, setLeaving] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      setLeaving(false);
    }
  };

  const askToLeave = async () => {
    setError(null);
    const count = await countPendingUploads();
    if (count > 0) setPendingWarning(count);
    else await leave();
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await sessionApi.deleteMe();
      // A conta não existe mais: sai e apaga o que ficou no aparelho.
      await signOut();
    } catch (e) {
      setConfirmDelete(false);
      setError(apiErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
  const go = (href: Href) => router.push(href);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: tabBarHeight + 24 }}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Perfil
          </Text>
          {me ? (
            <View style={styles.identity}>
              <View
                style={styles.avatar}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                <Text style={styles.avatarText}>{initials(me.name)}</Text>
              </View>
              <View style={styles.identityTexts}>
                <Text style={styles.name}>{me.name}</Text>
                {me.phone ? <Text style={styles.phone}>{formatPhoneBR(me.phone)}</Text> : null}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.content}>
          <Section title="Conta">
            <Row
              icon={User}
              label="Nome"
              value={me?.name ?? ''}
              action="Editar"
              onPress={() => go('/(app)/perfil/nome')}
            />
            <Row
              icon={Smartphone}
              label="Celular"
              value={me?.phone ? formatPhoneBR(me.phone) : ''}
              action="Trocar número"
              onPress={() => go('/(app)/perfil/celular')}
            />
            <Row
              icon={Mail}
              label="E-mail de recuperação"
              value={me?.email ?? 'Não informado'}
              action={me?.email ? 'Editar' : 'Adicionar'}
              onPress={() => go('/(app)/perfil/email')}
            />
          </Section>

          <Section title="Sobre">
            <Row icon={FileText} label="Termos de Uso" link onPress={() => open(TERMS_URL)} />
            <Row
              icon={ShieldCheck}
              label="Política de Privacidade"
              link
              onPress={() => open(PRIVACY_URL)}
            />
          </Section>

          <Section title="Sessão">
            {isAgent ? (
              <Row
                icon={mode === 'agent' ? User : HardHat}
                label={mode === 'agent' ? 'Usar o app como cidadão' : 'Usar o app como agente'}
                link
                onPress={() => void setMode(mode === 'agent' ? 'citizen' : 'agent')}
              />
            ) : null}
            <Row
              icon={LogOut}
              label="Sair da conta"
              value="Para entrar de novo, use seu celular"
              link
              busy={leaving}
              onPress={() => void askToLeave()}
            />
          </Section>

          <View style={styles.danger}>
            <FormError message={error} />
            <SecondaryButton
              label="Excluir minha conta"
              icon={Trash2}
              variant="danger"
              size="medium"
              style={styles.deleteButton}
              onPress={() => {
                setError(null);
                setConfirmDelete(true);
              }}
            />
          </View>

          {__DEV__ ? (
            <View style={styles.dev}>
              <TextButton label="Laboratório" onPress={() => go('/laboratorio')} />
              <TextButton label="Kit de componentes" onPress={() => go('/dev/kit')} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={pendingWarning !== null}
        title="Sair da conta?"
        message={pendingWarning !== null ? signOutWarning(pendingWarning) : undefined}
        confirmLabel="Sair mesmo assim"
        cancelLabel="Ficar"
        destructive
        loading={leaving}
        onConfirm={() => void leave()}
        onCancel={() => setPendingWarning(null)}
      />
      <ConfirmDialog
        visible={confirmDelete}
        title="Excluir sua conta?"
        message="Seus dados pessoais serão apagados. As solicitações continuam com a prefeitura, sem seu nome."
        confirmLabel="Excluir conta"
        cancelLabel="Cancelar"
        destructive
        loading={deleting}
        onConfirm={() => void deleteAccount()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  // Linhas condicionais (`null`) não contam: sem elas, nada de divisória sobrando.
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.card}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  action,
  link = false,
  busy = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  /** Texto da ação à direita (15/600 `primary`), como "Editar". */
  action?: string;
  /** Sem ação escrita: seta `chevron-right`. */
  link?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const a11y = [label, value, action].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole={link ? 'link' : 'button'}
      accessibilityLabel={a11y}
      accessibilityState={{ busy, disabled: busy }}
      style={({ pressed }) => [styles.row, (pressed || busy) && styles.rowPressed]}
    >
      <Icon size={20} color={colors.primary} />
      <View style={styles.rowTexts}>
        <Text style={styles.rowLabel}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {action ? <Text style={styles.rowAction}>{action}</Text> : null}
      {link ? <ChevronRight size={20} color={colors.textSecondary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingVertical: 8, paddingHorizontal: space.gutter, gap: 14 },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.heading, fontSize: 20, color: colors.primary },
  identityTexts: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemibold, fontSize: 18, color: colors.textPrimary },
  phone: { fontFamily: fonts.body, fontSize: 15, color: colors.textSecondary },
  content: {
    paddingTop: 16,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
    gap: space.section,
  },
  section: { gap: 8 },
  sectionTitle: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.textSecondary },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  rowPressed: { backgroundColor: colors.bg },
  rowTexts: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  rowValue: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  rowAction: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.primary },
  danger: { gap: 8 },
  deleteButton: { minHeight: 52, borderRadius: 26 },
  dev: { gap: 4 },
});
