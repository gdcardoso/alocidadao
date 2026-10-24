// Altura do teclado sem nada nativo (testável em Node); o hook fica em use-keyboard-height.ts.

/**
 * Altura do teclado no momento em que a tela monta. O `KeyboardAvoidingView` do React Native
 * só aprende a altura num evento de "teclado abriu"; se a tela nasce com o teclado já aberto
 * (Entrar → Código), o evento não vem e o rodapé fica atrás do teclado.
 */
export function keyboardHeightOnMount(
  visible: boolean,
  metrics: { height: number } | null | undefined,
): number {
  return visible && metrics ? metrics.height : 0;
}
