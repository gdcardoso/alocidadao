import type { AgentWorkOrderDetail, DeviceLocation, ImpedimentReason } from '@alocidadao/shared';
import { router, useNavigation, usePreventRemove, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { homeFor } from '../auth/app-mode';
import { OUTBOX_OWNER_KEY } from '../auth/login-flow';
import { useSession } from '../auth/use-session';
import type { CapturedPhoto } from '../components/photo-capture';
import { createActionLock } from '../lib/action-lock';
import { getCurrentPoint } from '../lib/location';
import { isOnline } from '../lib/net-info';
import { deleteFile } from '../lib/photo-native';
import { secureStore } from '../lib/secure-store';
import { submitWorkOrderAction } from '../offline/outbox-service';
import { clearDraftPhotos, keepDraftPhoto } from '../offline/sqlite-outbox-store';
import { useOutbox } from '../offline/use-outbox-sync';
import { toAgentDetail, type AgentDetailView } from './detail-view';
import { closeDecision, finishIsReadOnly, hasDraft, type LocationReading } from './finish-form';
import { useAgentWorkOrder, type AgentWorkOrderState } from './use-agent-work-order';

// Estado comum da A3 (Concluir atendimento) e da A4 (Não consigo resolver).

const HOME_ROUTE = homeFor('agent');
const SEND_ERROR = 'Não foi possível enviar. Tente de novo.';
const PHOTO_ERROR = 'Não foi possível guardar a foto. Tente de novo.';
/** Ao enviar com a posição ainda sendo lida, espera no máximo isto e segue sem ela. */
const SEND_LOCATION_WAIT_MS = 5_000;

/** Lê a posição do aparelho (com a precisão); `null` sem permissão ou sem GPS. */
async function readDeviceLocation(): Promise<DeviceLocation | null> {
  const current = await getCurrentPoint();
  return 'point' in current ? { ...current.point, accuracyM: current.accuracyM } : null;
}

export interface SendInput {
  note: string;
  impedimentReason?: ImpedimentReason;
}

export interface FinishScreen {
  state: AgentWorkOrderState;
  detail: AgentWorkOrderDetail | null;
  view: AgentDetailView | null;
  reload(): Promise<void>;
  /** Posição lida ao abrir a tela (`'reading'` enquanto lê). */
  location: LocationReading;
  photos: string[];
  addPhoto(photo: CapturedPhoto): Promise<void>;
  removePhoto(index: number): void;
  note: string;
  setNote(note: string): void;
  reason: ImpedimentReason | null;
  setReason(reason: ImpedimentReason): void;
  cameraOpen: boolean;
  setCameraOpen(open: boolean): void;
  sending: boolean;
  /** Foto sendo guardada: enviar e fechar esperam a cópia terminar. */
  addingPhoto: boolean;
  /** A atividade não aceita mais a ação: a tela mostra `view.readOnlyNote` no lugar do formulário. */
  readOnly: boolean;
  error: string | null;
  /** Fechar: com algo preenchido, pergunta antes. */
  close(): void;
  confirmDiscard: boolean;
  discard(): void;
  keepEditing(): void;
  /** Envia pela fila (com ou sem rede) e volta à A1. */
  send(action: 'complete' | 'report_impediment', input: SendInput): Promise<void>;
}

export function useFinishScreen(id: string, { prefillNote }: { prefillNote: boolean }) {
  const { me } = useSession();
  const navigation = useNavigation();
  const { items: queue } = useOutbox();
  const { state, here, now, reload } = useAgentWorkOrder(id);
  const detail = state.phase === 'ready' ? state.detail : null;
  const view = useMemo(
    () => (detail ? toAgentDetail(detail, { here, queue, now }) : null),
    [detail, here, queue, now],
  );

  const [location, setLocation] = useState<LocationReading>('reading');
  const reading = useRef<Promise<DeviceLocation | null> | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  // `null`: a pessoa ainda não mexeu no relato (vale o preenchido).
  const [editedNote, setEditedNote] = useState<string | null>(null);
  const [reason, setReasonState] = useState<ImpedimentReason | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Toque duplo em enviar não enfileira duas vezes.
  const [lock] = useState(createActionLock);
  // Saída já decidida: libera a navegação sem confirmação e navega no efeito.
  const [exit, setExit] = useState<(() => void) | null>(null);
  const pendingRemoval = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);

  // A posição é lida uma vez, ao abrir a tela.
  useEffect(() => {
    let active = true;
    const promise = readDeviceLocation().catch(() => null);
    reading.current = promise;
    void promise.then((value) => {
      if (active) setLocation(value);
    });
    return () => {
      active = false;
    };
  }, []);

  // Reenvio depois do ajuste: o relato anterior vem preenchido.
  const initialNote = prefillNote && view?.footer === 'rework' ? (detail?.previousNote ?? '') : '';
  const note = editedNote ?? initialNote;

  // Fotos de rascunho de outra tela não servem mais; ao sair, as desta também não (as
  // enviadas já foram copiadas para a fila).
  useEffect(() => {
    clearDraftPhotos();
    return clearDraftPhotos;
  }, []);

  // A atividade já não aceita a ação: a tela troca o formulário pela nota. Durante o envio
  // desta tela, o status otimista da fila não conta (a tela já vai voltar à A1).
  const readOnly = view !== null && finishIsReadOnly(view, { busy: sending || exit !== null });
  // Sem formulário, o rascunho não vale mais: fechar não pergunta.
  const dirty = !readOnly && hasDraft({ photos, note, reason, initialNote });
  // Enviando ou guardando a foto: voltar e descartar esperam (o rascunho ainda está em uso).
  const busy = sending || addingPhoto;

  usePreventRemove((dirty || busy) && exit === null, ({ data }) => {
    if (closeDecision({ busy, dirty }) !== 'confirm') return;
    pendingRemoval.current = data.action;
    setConfirmDiscard(true);
  });

  useEffect(() => {
    exit?.();
  }, [exit]);

  const leave = useCallback((go: () => void) => setExit(() => go), []);

  const addPhoto = async (photo: CapturedPhoto) => {
    setCameraOpen(false);
    setError(null);
    setAddingPhoto(true);
    try {
      // Fora do cache: com pouco espaço o Android apaga o cache a qualquer momento.
      const kept = await keepDraftPhoto(photo.uri);
      setPhotos((list) => [...list, kept]);
    } catch (cause) {
      console.warn('Falha ao guardar a foto', cause);
      setError(PHOTO_ERROR);
    } finally {
      deleteFile(photo.uri);
      setAddingPhoto(false);
    }
  };

  const removePhoto = (index: number) => {
    const removed = photos[index];
    setPhotos(photos.filter((_, i) => i !== index));
    if (removed) deleteFile(removed);
  };

  const close = () => {
    const decision = closeDecision({ busy, dirty });
    if (decision === 'confirm') setConfirmDiscard(true);
    else if (decision === 'leave') router.back();
  };

  const discard = () => {
    if (busy) return;
    setConfirmDiscard(false);
    const action = pendingRemoval.current;
    pendingRemoval.current = null;
    leave(() => (action ? navigation.dispatch(action) : router.back()));
  };

  const keepEditing = () => {
    pendingRemoval.current = null;
    setConfirmDiscard(false);
  };

  /** Posição para o envio: a lida, ou a que chegar em poucos segundos; senão, sem ela. */
  const locationForSend = async (): Promise<DeviceLocation | null> => {
    if (location !== 'reading') return location;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SEND_LOCATION_WAIT_MS);
    });
    try {
      return await Promise.race([reading.current ?? Promise.resolve(null), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const send = async (action: 'complete' | 'report_impediment', input: SendInput) => {
    if (!detail || addingPhoto) return;
    await lock.run(async () => {
      setError(null);
      setSending(true);
      try {
        // Sem dono conhecido, o item ficaria órfão na fila: não enfileira.
        const userId = me?.id ?? (await secureStore.getItem(OUTBOX_OWNER_KEY));
        if (!userId) {
          setError(SEND_ERROR);
          return;
        }
        await submitWorkOrderAction({
          tenantId: detail.tenantId,
          workOrderId: detail.id,
          action,
          note: input.note.trim(),
          ...(input.impedimentReason ? { impedimentReason: input.impedimentReason } : {}),
          location: await locationForSend(),
          photoUris: photos,
          online: await isOnline(),
          userId,
          display: { categoryName: detail.categoryName, address: detail.address },
        });
        // A A1 mostra o status otimista que vem da fila.
        leave(() => router.dismissTo(HOME_ROUTE as Href));
      } catch (cause) {
        console.warn('Falha ao enviar a ação do agente', cause);
        setError(SEND_ERROR);
      } finally {
        setSending(false);
      }
    });
  };

  const screen: FinishScreen = {
    state,
    detail,
    view,
    reload,
    location,
    photos,
    addPhoto,
    removePhoto,
    note,
    setNote: (text) => {
      setEditedNote(text);
      setError(null);
    },
    reason,
    setReason: (value) => {
      setReasonState(value);
      setError(null);
    },
    cameraOpen,
    setCameraOpen,
    sending,
    addingPhoto,
    readOnly,
    error,
    close,
    confirmDiscard,
    discard,
    keepEditing,
    send,
  };
  return screen;
}
