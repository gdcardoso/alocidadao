import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';
import { keyboardHeightOnMount } from './keyboard-height';

/**
 * Altura do teclado aberto (0 quando fechado), já contando o teclado que estava aberto quando
 * a tela montou. No iOS acompanha a animação do teclado.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() =>
    keyboardHeightOnMount(Keyboard.isVisible(), Keyboard.metrics()),
  );

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (duration: number) => {
      if (ios && duration > 0) {
        LayoutAnimation.configureNext({
          duration,
          update: { duration, type: LayoutAnimation.Types.keyboard },
        });
      }
    };
    const subscriptions = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
        animate(event.duration);
        setHeight(event.endCoordinates.height);
      }),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (event) => {
        animate(event.duration);
        setHeight(0);
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  return height;
}
