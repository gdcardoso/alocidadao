import { randomUUID } from 'expo-crypto';

/** Adaptador nativo: gerador de UUID padrão do id de instalação. */
export const randomUuid = (): string => randomUUID();
