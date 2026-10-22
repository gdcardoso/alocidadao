import { getInstallationId } from './installation-id';
import { randomUuid } from './random-uuid';
import { secureStore } from './secure-store';

/** Id desta instalação no aparelho: SecureStore + UUID do expo-crypto. */
export const getDeviceInstallationId = (): Promise<string> =>
  getInstallationId(secureStore, randomUuid);
