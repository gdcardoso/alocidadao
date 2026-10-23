import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from './installation-id';

/** Adaptador nativo: guarda pares chave/valor no armazenamento seguro do aparelho. */
export const secureStore: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};
