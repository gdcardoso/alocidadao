import { z } from 'zod';
import { createStateMachine, type Transition } from './state-machine.js';

export const WORK_ORDER_STATUSES = [
  'assigned',
  'in_execution',
  'awaiting_review',
  'rework_requested',
  'impeded',
  'completed',
  'cancelled',
] as const;

export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  assigned: 'Atribuída',
  in_execution: 'Em execução',
  awaiting_review: 'Aguardando revisão',
  rework_requested: 'Ajuste pedido',
  impeded: 'Impedida',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

/** Statuses em que a atividade ainda está em andamento. */
export const ACTIVE_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = WORK_ORDER_STATUSES.filter(
  (status) => status !== 'completed' && status !== 'cancelled',
);

export const WORK_ORDER_ACTIONS = [
  'start',
  'complete',
  'report_impediment',
  'request_rework',
  'publish',
  'reschedule',
  'cancel',
] as const;

export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number];

export const WORK_ORDER_TRANSITIONS: Record<WorkOrderAction, Transition<WorkOrderStatus>> = {
  start: { from: ['assigned'], to: 'in_execution', actors: ['field_agent'] },
  complete: {
    from: ['in_execution', 'rework_requested'],
    to: 'awaiting_review',
    actors: ['field_agent'],
  },
  report_impediment: {
    from: ['assigned', 'in_execution', 'rework_requested'],
    to: 'impeded',
    actors: ['field_agent'],
  },
  request_rework: {
    from: ['awaiting_review'],
    to: 'rework_requested',
    actors: ['manager', 'tenant_admin'],
  },
  publish: { from: ['awaiting_review'], to: 'completed', actors: ['manager', 'tenant_admin'] },
  reschedule: { from: ['impeded'], to: 'assigned', actors: ['manager', 'tenant_admin'] },
  cancel: {
    from: ['assigned', 'in_execution', 'awaiting_review', 'rework_requested', 'impeded'],
    to: 'cancelled',
    actors: ['manager', 'tenant_admin'],
  },
};

const machine = createStateMachine(WORK_ORDER_ACTIONS, WORK_ORDER_TRANSITIONS);

export const applyWorkOrderAction = machine.apply;
export const availableWorkOrderActions = machine.available;
