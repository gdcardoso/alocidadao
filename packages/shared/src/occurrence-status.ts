import { z } from 'zod';
import { createStateMachine, type Transition } from './state-machine.js';

export const OCCURRENCE_STATUSES = [
  'triage',
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'rejected',
  'merged',
  'cancelled',
] as const;

export const occurrenceStatusSchema = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatus = z.infer<typeof occurrenceStatusSchema>;

/** Statuses em que uma nova solicitação ainda pode ser agrupada na ocorrência. */
export const CLUSTERABLE_OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = [
  'triage',
  'in_progress',
];

export const OCCURRENCE_ACTIONS = [
  'assign',
  'publish',
  'reopen',
  'close',
  'reject',
  'merge',
  'cancel',
] as const;

export type OccurrenceAction = (typeof OCCURRENCE_ACTIONS)[number];

export const OCCURRENCE_TRANSITIONS: Record<OccurrenceAction, Transition<OccurrenceStatus>> = {
  assign: { from: ['triage'], to: 'in_progress', actors: ['manager', 'tenant_admin'] },
  publish: {
    from: ['in_progress'],
    to: 'awaiting_confirmation',
    actors: ['manager', 'tenant_admin'],
  },
  reopen: { from: ['awaiting_confirmation'], to: 'triage', actors: ['system'] },
  close: { from: ['awaiting_confirmation'], to: 'completed', actors: ['system'] },
  reject: { from: ['triage', 'in_progress'], to: 'rejected', actors: ['manager', 'tenant_admin'] },
  merge: { from: ['triage', 'in_progress'], to: 'merged', actors: ['manager', 'tenant_admin'] },
  cancel: { from: ['triage'], to: 'cancelled', actors: ['system'] },
};

const machine = createStateMachine(OCCURRENCE_ACTIONS, OCCURRENCE_TRANSITIONS);

export const applyOccurrenceAction = machine.apply;
export const availableOccurrenceActions = machine.available;
