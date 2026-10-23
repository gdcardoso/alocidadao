import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createSessionTransport } from '../../auth/native-session';
import { PhotoCapture } from '../../components/photo-capture';
import type { OutboxItem, WorkOrderActionPayload } from '../../offline/outbox';
import { onOutboxSynced } from '../../offline/outbox-service';
import {
  enqueueNative,
  openAppDatabase,
  openOutboxStore,
  type SqliteOutboxStore,
} from '../../offline/sqlite-outbox-store';
import { useOutbox } from '../../offline/use-outbox-sync';
import { WorkOrderCache, type CachedWorkOrder } from '../../offline/work-order-cache';

const CONFLICT_MESSAGE =
  'Esta atividade foi reatribuída ou cancelada pela prefeitura. O que você registrou ficou guardado no aparelho.';
const MAX_PHOTOS = 3;
const MIN_NOTE_LENGTH = 3;

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

const LOCAL_STATUS: Record<'start' | 'complete', string> = {
  start: 'in_execution',
  complete: 'awaiting_review',
};

export default function OfflineLab() {
  const [cache, setCache] = useState<WorkOrderCache | null>(null);
  const [orders, setOrders] = useState<CachedWorkOrder[]>([]);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [note, setNote] = useState('');
  const [store, setStore] = useState<SqliteOutboxStore | null>(null);

  useEffect(() => {
    void openOutboxStore().then(setStore);
  }, []);

  useEffect(() => {
    void openAppDatabase().then(async (db) => {
      const c = new WorkOrderCache(db);
      await c.init();
      setCache(c);
      setOrders(await c.list());
    });
  }, []);

  useEffect(
    () =>
      NetInfo.addEventListener((s) =>
        setOnline(s.isConnected === true && s.isInternetReachable !== false),
      ),
    [],
  );

  const reloadLocal = useCallback(async () => {
    if (cache) setOrders(await cache.list());
  }, [cache]);

  // A tela atualiza a lista depois de cada passada da fila (ver `fetchListRef`).
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  const fetchListRef = useRef<() => Promise<void>>(async () => undefined);
  const outbox = useOutbox();
  const { syncing, lastSyncError, syncNow, refresh } = outbox;
  // Só as ações do agente: a fila do app também guarda solicitações do cidadão.
  const items = useMemo(
    () => outbox.items.filter((i) => i.kind === 'work_order_action'),
    [outbox.items],
  );
  useEffect(
    () =>
      onOutboxSynced(() => {
        void reloadLocal();
        if (onlineRef.current) void fetchListRef.current();
      }),
    [reloadLocal],
  );

  // Mostra no cartão o resultado dos itens já resolvidos (conflito não é reenviado).
  const conflictByOrder = useMemo(
    () => new Set(items.filter((i) => i.status === 'conflict').map((i) => actionOf(i).workOrderId)),
    [items],
  );

  const fetchListOnce = useCallback(async () => {
    if (!cache || !store) return;
    setMessage(null);
    try {
      // A fila é lida ANTES da lista do servidor: item `done` neste instante já estava gravado
      // no servidor quando a lista foi pedida; item não terminal pode não estar, então o
      // status otimista dele prevalece sobre o do servidor (sem corrida com a sincronização).
      const queue = await store.list();
      const transport = await createSessionTransport();
      const list = (await transport.listWorkOrders()) as CachedWorkOrder[];
      await cache.replaceAll(list);
      for (const item of queue) {
        if (item.kind !== 'work_order_action') continue;
        if (item.status === 'pending' || item.status === 'sending') {
          const action = actionOf(item);
          await cache.setLocalStatus(action.workOrderId, LOCAL_STATUS[action.action]);
        }
      }
      setOrders(await cache.list());
    } catch (e) {
      setMessage(`Não foi possível atualizar a lista: ${e instanceof Error ? e.message : e}`);
    }
  }, [cache, store]);

  // Atualizações da lista rodam uma de cada vez (o SQLite não aceita transações aninhadas).
  const fetchChain = useRef<Promise<void>>(Promise.resolve());
  const fetchList = useCallback(() => {
    const run = fetchChain.current.then(() => fetchListOnce());
    fetchChain.current = run;
    return run;
  }, [fetchListOnce]);

  useEffect(() => {
    fetchListRef.current = fetchList;
  }, [fetchList]);

  useEffect(() => {
    if (cache && store && online) void fetchList();
    // Só ao abrir a tela ou ao ganhar rede.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, store, online]);

  const enqueue = async (
    workOrderId: string,
    action: 'start' | 'complete',
    extra?: { note: string; photoUris: string[] },
  ) => {
    if (!cache || !store) return;
    await enqueueNative(store, { workOrderId, action, online, userId: '', ...extra });
    await cache.setLocalStatus(workOrderId, LOCAL_STATUS[action]);
    await Promise.all([reloadLocal(), refresh()]);
    if (online) void syncNow();
  };

  const submitComplete = async () => {
    if (!completing) return;
    if (photos.length < 1 || photos.length > MAX_PHOTOS) {
      setMessage(`Concluir pede de 1 a ${MAX_PHOTOS} fotos.`);
      return;
    }
    if (note.trim().length < MIN_NOTE_LENGTH) {
      setMessage(`Escreva um relato com pelo menos ${MIN_NOTE_LENGTH} letras.`);
      return;
    }
    setMessage(null);
    await enqueue(completing, 'complete', { note, photoUris: photos });
    setCompleting(null);
    setPhotos([]);
    setNote('');
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Atividades offline</Text>
      <Text style={styles.row}>Rede: {online ? 'online' : 'offline'}</Text>
      <View style={styles.actions}>
        <Button label="Atualizar lista" onPress={() => void fetchList()} disabled={!online} />
        <Button
          label={syncing ? 'Sincronizando...' : 'Sincronizar agora'}
          onPress={() => void syncNow()}
          disabled={syncing}
        />
      </View>
      {message && <Text style={styles.error}>{message}</Text>}
      {lastSyncError && <Text style={styles.error}>Falha na sincronização: {lastSyncError}</Text>}

      <Text style={styles.subtitle}>Atividades</Text>
      {orders.length === 0 && <Text style={styles.row}>Nenhuma atividade no aparelho.</Text>}
      {orders.map((o) => (
        <View key={o.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {o.protocol} · {o.categoryName}
          </Text>
          <Text style={styles.row}>{o.description}</Text>
          <Text style={styles.row}>Status: {o.status}</Text>
          {conflictByOrder.has(o.id) && <Text style={styles.error}>{CONFLICT_MESSAGE}</Text>}
          <View style={styles.actions}>
            <Button
              label="Iniciar"
              onPress={() => void enqueue(o.id, 'start')}
              disabled={o.status !== 'assigned'}
            />
            <Button
              label="Concluir"
              onPress={() => {
                setCompleting(o.id);
                setPhotos([]);
                setNote('');
              }}
              disabled={o.status !== 'in_execution'}
            />
          </View>
          {completing === o.id && (
            <View style={styles.form}>
              <Button label="Tirar foto" onPress={() => setCameraOpen(true)} />
              <PhotoCapture
                visible={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCaptured={(p) => {
                  setPhotos((prev) => [...prev, p.uri].slice(0, MAX_PHOTOS));
                  setCameraOpen(false);
                }}
              />
              <Text style={styles.row}>
                Fotos: {photos.length} de {MAX_PHOTOS}
              </Text>
              <TextInput
                style={styles.input}
                value={note}
                onChangeText={setNote}
                placeholder="Relato"
                multiline
              />
              <Button label="Enviar conclusão" onPress={() => void submitComplete()} />
              <Button label="Cancelar" onPress={() => setCompleting(null)} />
            </View>
          )}
        </View>
      ))}

      <Text style={styles.subtitle}>Fila ({items.length})</Text>
      {items.map((i) => (
        <QueueItem key={i.id} item={i} />
      ))}
    </ScrollView>
  );
}

const actionOf = (item: OutboxItem) => item.payload as WorkOrderActionPayload;

function QueueItem({ item }: { item: OutboxItem }) {
  const action = actionOf(item);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {action.action} · {action.workOrderId.slice(0, 8)}
      </Text>
      <Text style={styles.row}>
        Status: {item.status} · tentativas: {item.attempts} · fotos: {item.photoPaths.length}
      </Text>
      {item.lastError && <Text style={styles.row}>Último erro: {item.lastError}</Text>}
      {item.status === 'conflict' && <Text style={styles.error}>{CONFLICT_MESSAGE}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 18, fontWeight: '600', marginTop: 12 },
  row: { fontSize: 15 },
  error: { fontSize: 15, color: '#b00020' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  card: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  form: { gap: 10, marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, minHeight: 60 },
  button: { backgroundColor: '#0b5fff', padding: 12, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
