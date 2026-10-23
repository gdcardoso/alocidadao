import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  applyWorkOrderAction,
  availableWorkOrderActions,
} from './work-order-status.js';

describe('applyWorkOrderAction', () => {
  it('lets the agent complete after a rework request', () => {
    expect(applyWorkOrderAction('rework_requested', 'complete', 'field_agent')).toEqual({
      ok: true,
      to: 'awaiting_review',
    });
  });

  it('lets a manager publish a work order awaiting review', () => {
    expect(applyWorkOrderAction('awaiting_review', 'publish', 'manager')).toEqual({
      ok: true,
      to: 'completed',
    });
  });

  it('does not let the agent publish', () => {
    expect(applyWorkOrderAction('awaiting_review', 'publish', 'field_agent')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('reschedules an impeded work order back to assigned', () => {
    expect(applyWorkOrderAction('impeded', 'reschedule', 'manager')).toEqual({
      ok: true,
      to: 'assigned',
    });
  });
});

describe('availableWorkOrderActions', () => {
  it('lists agent actions while in execution', () => {
    expect(availableWorkOrderActions('in_execution', 'field_agent')).toEqual([
      'complete',
      'report_impediment',
    ]);
  });
});

describe('ACTIVE_WORK_ORDER_STATUSES', () => {
  it('includes impeded and excludes final statuses', () => {
    expect(ACTIVE_WORK_ORDER_STATUSES).toContain('impeded');
    expect(ACTIVE_WORK_ORDER_STATUSES).not.toContain('completed');
    expect(ACTIVE_WORK_ORDER_STATUSES).not.toContain('cancelled');
  });
});
