import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { phoneHintDigits } from '../ui/format';

// Número do chip pelo Phone Number Hint do Google (expo-phone-number-hint, só Android).
// O módulo nativo é opcional: num build anterior à dependência ele não existe e o app segue
// sem a sugestão, em vez de quebrar na importação (o pacote usa `requireNativeModule`).
interface PhoneHintModule {
  isAvailableAsync(): Promise<boolean>;
  showPhoneNumberHintAsync(): Promise<
    { canceled: false; hint: { number: string; e164: string | null } } | { canceled: true }
  >;
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<PhoneHintModule>('ExpoPhoneNumberHint')
    : null;

/** Se o aparelho pode mostrar a lista de números do chip. Nunca rejeita. */
export async function isPhoneHintAvailable(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Abre a lista do sistema e devolve os 11 dígitos (DDD + número) do celular escolhido, ou
 * `null` se a pessoa fechou a lista, o número não é do Brasil ou algo falhou.
 */
export async function pickPhoneHint(): Promise<string | null> {
  if (!native) return null;
  try {
    const result = await native.showPhoneNumberHintAsync();
    if (result.canceled) return null;
    return phoneHintDigits(result.hint);
  } catch (error) {
    console.warn('Falha ao sugerir o número do chip', error);
    return null;
  }
}
