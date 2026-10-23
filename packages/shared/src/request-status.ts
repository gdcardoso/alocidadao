import { z } from 'zod';
import { createStateMachine, type Transition } from './state-machine.js';

export const REQUEST_STATUSES = [
  'open',
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'cancelled',
  'rejected',
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
};

export const FINAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'completed',
  'cancelled',
  'rejected',
];

export const REQUEST_ACTIONS = [
  'cancel',
  'assign',
  'publish',
  'confirm',
  'auto_confirm',
  'contest',
  'reopen',
  'reject',
] as const;

export type RequestAction = (typeof REQUEST_ACTIONS)[number];

/** Ciclo de status da solicitação — ver docs/planejamento-mvp.md, seção "Ciclo de status". */
export const REQUEST_TRANSITIONS: Record<RequestAction, Transition<RequestStatus>> = {
  cancel: { from: ['open'], to: 'cancelled', actors: ['citizen'] },
  assign: { from: ['open'], to: 'in_progress', actors: ['manager', 'tenant_admin'] },
  publish: {
    from: ['in_progress'],
    to: 'awaiting_confirmation',
    actors: ['manager', 'tenant_admin'],
  },
  confirm: { from: ['awaiting_confirmation'], to: 'completed', actors: ['citizen'] },
  auto_confirm: { from: ['awaiting_confirmation'], to: 'completed', actors: ['system'] },
  contest: { from: ['awaiting_confirmation'], to: 'open', actors: ['citizen'] },
  reopen: { from: ['awaiting_confirmation'], to: 'open', actors: ['system'] },
  reject: { from: ['open', 'in_progress'], to: 'rejected', actors: ['manager', 'tenant_admin'] },
};

/** Days without citizen response before a completed request is auto-confirmed. */
export const AUTO_CONFIRM_AFTER_DAYS = 7;

const machine = createStateMachine(REQUEST_ACTIONS, REQUEST_TRANSITIONS);

export const applyRequestAction = machine.apply;
export const availableRequestActions = machine.available;
