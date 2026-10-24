import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { AberturaView } from './AberturaView';
import { minimumSplash } from './abertura-timing';

const FADE_MS = 200;
// Se as imagens não avisarem, a abertura nativa sai mesmo assim (nunca trava o app).
const NATIVE_SPLASH_FALLBACK_MS = 3000;

interface Props {
  /** App pronto para mostrar a próxima tela (fontes carregadas e sessão conferida). */
  ready: boolean;
}

/**
 * Tela 0 por cima de tudo: esconde a abertura nativa (branca) assim que as imagens aparecem
 * e sai quando o app fica pronto, depois de pelo menos 1,5 s na tela. Some com um fade de 200 ms,
 * ou na hora com "reduzir movimento".
 */
export function AberturaOverlay({ ready }: Props) {
  const [gone, setGone] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));

  // Momento em que a tela 0 apareceu de fato (a abertura nativa saiu): base do tempo mínimo.
  // Contar daqui (e não da carga do JS) garante os 1,5 s visíveis mesmo com o JS lento.
  const [shownAt, setShownAt] = useState<number | null>(null);
  // Relógio da regra: anda quando a tela 0 aparece e quando o tempo mínimo termina.
  const [now, setNow] = useState(() => Date.now());
  const { leaving, waitMs } = minimumSplash(shownAt, now, ready);

  const show = useCallback(() => {
    SplashScreen.hide();
    const at = Date.now();
    setShownAt((current) => current ?? at);
    setNow(at);
  }, []);

  useEffect(() => {
    if (shownAt !== null) return;
    const fallback = setTimeout(show, NATIVE_SPLASH_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [show, shownAt]);

  // Acorda a regra quando o tempo mínimo termina (se o timer disparar cedo, agenda de novo).
  useEffect(() => {
    if (!waitMs) return;
    const timer = setTimeout(() => setNow(Date.now()), waitMs);
    return () => clearTimeout(timer);
  }, [waitMs]);

  useEffect(() => {
    if (!leaving) return;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!active) return;
        if (reduce) {
          setGone(true);
          return;
        }
        Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(
          ({ finished }) => {
            if (active && finished) setGone(true);
          },
        );
      });
    return () => {
      active = false;
      // Se a saída for cancelada no meio do fade, a tela 0 volta inteira: nunca fica uma
      // camada invisível por cima do app pegando os toques.
      opacity.stopAnimation();
      opacity.setValue(1);
    };
  }, [leaving, opacity]);

  if (gone) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity, pointerEvents: leaving ? 'none' : 'auto' }]}
      // Saindo, o leitor de tela já vai para a próxima tela.
      importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={leaving}
    >
      <AberturaView onImagesReady={show} />
    </Animated.View>
  );
}
