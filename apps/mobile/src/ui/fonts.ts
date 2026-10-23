import { Lexend_500Medium } from '@expo-google-fonts/lexend/500Medium';
import { Lexend_600SemiBold } from '@expo-google-fonts/lexend/600SemiBold';
import { SourceSans3_400Regular } from '@expo-google-fonts/source-sans-3/400Regular';
import { SourceSans3_500Medium } from '@expo-google-fonts/source-sans-3/500Medium';
import { SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3/600SemiBold';
import { useFonts } from 'expo-font';
import { fonts } from './theme';

/** Arquivos das fontes do Pencil, registrados com os nomes de `fonts` (theme.ts). */
const fontFiles = {
  [fonts.heading]: Lexend_600SemiBold,
  [fonts.headingMedium]: Lexend_500Medium,
  [fonts.body]: SourceSans3_400Regular,
  [fonts.bodyMedium]: SourceSans3_500Medium,
  [fonts.bodySemibold]: SourceSans3_600SemiBold,
};

/**
 * Carrega as fontes do app. Devolve `true` quando dá para desenhar: com as fontes ou, se o
 * carregamento falhar, com a fonte do sistema (melhor que travar na abertura).
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontFiles);
  return loaded || error !== null;
}
