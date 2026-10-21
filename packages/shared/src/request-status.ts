import { z } from 'zod';
import type { Actor } from './roles.js';

export const REQUEST_STATUSES = [
  'open',
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'cancelled',
  'rejected',
  'duplicate',
] as const;

export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  open: 'Aberta',
  in_progress: 'Em atendimento',
  awaiting_confirmation: 'Aguardando confirmação',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  rejected: 'Recusada',
  duplicate: 'Duplicada',
};

export const FINAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'completed',
  'cancelled',
  'rejected',
  'duplicate',
];

export const REQUEST_ACTIONS = [
  'cancel',
  'reject',
  'mark_duplicate',
  'assign',
  'complete_work',
  'report_impediment',
  'confirm',
  'auto_confirm',
  'contest',
] as const;

export type RequestAction = (typeof REQUEST_ACTIONS)[number];

interface Transition {
  from: RequestStatus;
  to: RequestStatus;
  actors: readonly Actor[];
}

/** Ciclo de status da solicitação — ver docs/planejamento-mvp.md, seção "Ciclo de status". */
export const REQUEST_TRANSITIONS: Record<RequestAction, Transition> = {
  cancel: { from: 'open', to: 'cancelled', actors: ['citizen'] },
  reject: { from: 'open', to: 'rejected', actors: ['manager', 'tenant_admin'] },
  mark_duplicate: { from: 'open', to: 'duplicate', actors: ['manager', 'tenant_admin'] },
  assign: { from: 'open', to: 'in_progress', actors: ['manager', 'tenant_admin'] },
  complete_work: { from: 'in_progress', to: 'awaiting_confirmation', actors: ['field_agent'] },
  report_impediment: { from: 'in_progress', to: 'open', actors: ['field_agent'] },
  confirm: { from: 'awaiting_confirmation', to: 'completed', actors: ['citizen'] },
  auto_confirm: { from: 'awaiting_confirmation', to: 'completed', actors: ['system'] },
  contest: { from: 'awaiting_confirmation', to: 'open', actors: ['citizen'] },
};

/** Days without citizen response before a completed request is auto-confirmed. */
export const AUTO_CONFIRM_AFTER_DAYS = 7;

export type TransitionResult =
  { ok: true; to: RequestStatus } | { ok: false; reason: 'invalid_status' | 'forbidden' };

export function applyRequestAction(
  current: RequestStatus,
  action: RequestAction,
  actor: Actor,
): TransitionResult {
  const transition = REQUEST_TRANSITIONS[action];
  if (transition.from !== current) return { ok: false, reason: 'invalid_status' };
  if (!transition.actors.includes(actor)) return { ok: false, reason: 'forbidden' };
  return { ok: true, to: transition.to };
}

export function availableRequestActions(current: RequestStatus, actor: Actor): RequestAction[] {
  return REQUEST_ACTIONS.filter((action) => applyRequestAction(current, action, actor).ok);
}
