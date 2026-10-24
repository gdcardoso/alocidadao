import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { OUTBOX_OWNER_KEY } from '../auth/login-flow';
import { PlaceCache } from '../citizen/place-cache';
import { secureStore } from '../lib/secure-store';
import {
  enqueueCreateRequest,
  enqueueWorkOrderAction,
  type EnqueueDeps,
  type OutboxStore,
} from './outbox';
import { SqliteOutboxStore, createDatabaseOpener, migrateOutbox } from './outbox-schema';
import { clearOutbox } from './outbox-state';

export { SqliteOutboxStore } from './outbox-schema';

const DB_NAME = 'alocidadao.db';

/**
 * Abre o banco do app uma única vez (compartilhado com os caches) e migra a fila. Uma falha na
 * abertura não fica guardada: a próxima chamada tenta de novo.
 */
export const openAppDatabase: () => Promise<SQLiteDatabase> = createDatabaseOpener(async () => {
  const db = await openDatabaseAsync(DB_NAME);
  try {
    await db.execAsync('PRAGMA journal_mode = WAL;');
    // A versão 0 da fila só tinha ações do agente: os itens ficam com o dono guardado.
    await migrateOutbox(db, () => secureStore.getItem(OUTBOX_OWNER_KEY));
    return db;
  } catch (error) {
    // A próxima tentativa abre outra conexão; esta não fica pendurada.
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
});

const outboxRoot = () => new Directory(Paths.document, 'outbox');
const outboxDir = (id: string) => new Directory(Paths.document, 'outbox', id);

function deletePhotos(id: string): void {
  const dir = outboxDir(id);
  if (dir.exists) dir.delete();
}

/** Copia a foto para `Paths.document/outbox/<id>/` e devolve o novo caminho. */
export async function stashPhoto(id: string, uri: string, index: number): Promise<string> {
  const dir = outboxDir(id);
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(uri);
  // Nome por índice: fotos de origem com o mesmo nome não se sobrescrevem.
  const target = new File(dir, `${index}.jpg`);
  await source.copy(target);
  return target.uri;
}

const draftsDir = () => new Directory(Paths.document, 'drafts');

/**
 * Guarda a foto do rascunho fora do cache: com pouco espaço, o Android apaga o cache do app
 * a qualquer momento, inclusive com a Nova solicitação aberta.
 */
export async function keepDraftPhoto(uri: string): Promise<string> {
  const dir = draftsDir();
  dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${randomUUID()}.jpg`);
  await new File(uri).copy(target);
  return target.uri;
}

/** Apaga as fotos de rascunho (a fila já copiou as que foram enviadas). */
export function clearDraftPhotos(): void {
  const dir = draftsDir();
  if (dir.exists) dir.delete();
}

/**
 * Apaga o que a pessoa deixou no aparelho ao sair: fila, cache da última prefeitura e fotos
 * guardadas. O id da instalação (SecureStore) fica. Roda na vez da fila
 * (depois da passada em andamento) e esvazia também a fila que as telas mostram.
 */
export function clearOfflineData(): Promise<void> {
  return clearOutbox(wipeOfflineData);
}

async function wipeOfflineData(): Promise<void> {
  const db = await openAppDatabase();
  // Garante a tabela do cache, que só existe depois do primeiro uso.
  const places = new PlaceCache(db);
  await places.init();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM outbox');
    await db.runAsync('DELETE FROM place_cache');
  });
  const photos = outboxRoot();
  if (photos.exists) photos.delete();
  clearDraftPhotos();
}

export async function openOutboxStore(): Promise<SqliteOutboxStore> {
  return new SqliteOutboxStore(await openAppDatabase(), deletePhotos);
}

/** Enfileira com as dependências nativas e, se falhar no meio (ex.: foto sumiu), apaga a pasta de fotos que sobrou. */
async function enqueueCleaningUp<T>(run: (deps: EnqueueDeps) => Promise<T>): Promise<T> {
  const ids: string[] = [];
  const deps: EnqueueDeps = {
    randomUuid: () => {
      const id = randomUUID();
      ids.push(id);
      return id;
    },
    stashPhoto: async (id, uri, index) => {
      ids.push(id);
      return stashPhoto(id, uri, index);
    },
  };
  try {
    return await run(deps);
  } catch (error) {
    for (const id of new Set(ids)) deletePhotos(id);
    throw error;
  }
}

/** Enfileira uma ação do agente com as dependências nativas (fotos copiadas para a fila). */
export const enqueueNative = (
  store: OutboxStore,
  input: Parameters<typeof enqueueWorkOrderAction>[1],
) => enqueueCleaningUp((deps) => enqueueWorkOrderAction(store, input, deps));

export const enqueueCreateRequestNative = (
  store: OutboxStore,
  input: Parameters<typeof enqueueCreateRequest>[1],
) => enqueueCleaningUp((deps) => enqueueCreateRequest(store, input, deps));
