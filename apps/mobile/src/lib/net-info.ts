import NetInfo, { NetInfoStateType, type NetInfoState } from '@react-native-community/netinfo';
import type { NetSnapshot } from './connection';

/** Adaptador nativo: converte o estado do NetInfo para o NetSnapshot. */
export function toNetSnapshot(state: NetInfoState): NetSnapshot {
  return {
    type: state.type,
    isConnected: state.isConnected,
    cellularGeneration:
      state.type === NetInfoStateType.cellular ? state.details.cellularGeneration : null,
  };
}

export async function readNetSnapshot(): Promise<NetSnapshot> {
  return toNetSnapshot(await NetInfo.fetch());
}
