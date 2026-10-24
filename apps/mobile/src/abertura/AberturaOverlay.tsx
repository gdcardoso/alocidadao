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
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));
  const leaving = ready && minElapsed;

  // Momento em que a tela 0 apareceu de fato (a abertura nativa saiu): base do tempo mínimo.
  // Contar daqui (e não da carga do JS) garante os 1,5 s visíveis mesmo com o JS lento.
  const [shownAt, setShownAt] = useState<number | null>(null);

  const show = useCallback(() => {
    SplashScreen.hide();
    setShownAt((current) => current ?? Date.now());
  }, []);

  useEffect(() => {
    if (shownAt !== null) return;
    const fallback = setTimeout(show, NATIVE_SPLASH_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [show, shownAt]);

  // A prontidão do app entra em `leaving`; aqui só o tempo mínimo.
  useEffect(() => {
    if (shownAt === null) return;
    const { waitMs } = minimumSplash(shownAt, Date.now(), true);
    const timer = setTimeout(() => setMinElapsed(true), waitMs);
    return () => clearTimeout(timer);
  }, [shownAt]);

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
          () => active && setGone(true),
        );
      });
    return () => {
      active = false;
    };
  }, [leaving, opacity]);

  if (gone) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity, pointerEvents: leaving ? 'none' : 'auto' }]}
    >
      <AberturaView onImagesReady={show} />
    </Animated.View>
  );
}
