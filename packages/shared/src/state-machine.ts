import type { Actor } from './roles.js';

export interface Transition<S> {
  from: readonly S[];
  to: S;
  actors: readonly Actor[];
}

export type TransitionResult<S> =
  { ok: true; to: S } | { ok: false; reason: 'invalid_status' | 'forbidden' };

/**
 * Monta uma máquina de estados a partir de uma tabela de transições.
 * `invalid_status` tem precedência sobre `forbidden`.
 */
export function createStateMachine<S extends string, A extends string>(
  actions: readonly A[],
  transitions: Record<A, Transition<S>>,
) {
  function apply(current: S, action: A, actor: Actor): TransitionResult<S> {
    const transition = transitions[action];
    if (!transition.from.includes(current)) return { ok: false, reason: 'invalid_status' };
    if (!transition.actors.includes(actor)) return { ok: false, reason: 'forbidden' };
    return { ok: true, to: transition.to };
  }

  function available(current: S, actor: Actor): A[] {
    return actions.filter((action) => apply(current, action, actor).ok);
  }

  return { apply, available };
}
