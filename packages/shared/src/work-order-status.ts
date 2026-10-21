import { z } from 'zod';

export const WORK_ORDER_STATUSES = [
  'assigned',
  'in_execution',
  'completed',
  'impeded',
  'cancelled',
] as const;

export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  assigned: 'Atribuída',
  in_execution: 'Em execução',
  completed: 'Concluída',
  impeded: 'Impedida',
  cancelled: 'Cancelada',
};

/** Allowed next statuses for a work order. Terminal statuses map to an empty list. */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  assigned: ['in_execution', 'impeded', 'cancelled'],
  in_execution: ['completed', 'impeded', 'cancelled'],
  completed: [],
  impeded: [],
  cancelled: [],
};

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[from].includes(to);
}
