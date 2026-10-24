import { useRef } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors } from '../ui/theme';
import { aberturaLogoFrame } from './abertura-timing';

interface Props {
  /** Chamado quando as duas imagens (fundo e logo) já foram desenhadas. */
  onImagesReady?: () => void;
}

/**
 * Tela 0 do Pencil: `abertura.png` cobrindo a tela (branco no alto, cidade e faixa verde e
 * amarela embaixo) e a logo centralizada na posição relativa da moldura 390x844. Sem texto.
 */
export function AberturaView({ onImagesReady }: Props) {
  const { width, height } = useWindowDimensions();
  const logo = aberturaLogoFrame(width, height);
  // Conta as imagens carregadas para avisar só quando as duas estiverem prontas.
  const loaded = useRef(0);
  const onLoad = () => {
    loaded.current += 1;
    if (loaded.current === 2) onImagesReady?.();
  };

  return (
    <View style={styles.screen} accessible accessibilityLabel="Alô Cidadão">
      <Image
        source={require('../../assets/abertura.png')}
        resizeMode="cover"
        style={styles.background}
        onLoadEnd={onLoad}
        fadeDuration={0}
      />
      <Image
        source={require('../../assets/logo.png')}
        resizeMode="contain"
        style={[styles.logo, logo]}
        onLoadEnd={onLoad}
        fadeDuration={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  background: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  logo: { position: 'absolute' },
});
