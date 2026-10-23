import { describe, expect, it } from 'vitest';
import {
  CLUSTERABLE_OCCURRENCE_STATUSES,
  applyOccurrenceAction,
  availableOccurrenceActions,
} from './occurrence-status.js';

describe('applyOccurrenceAction', () => {
  it('lets a manager merge from triage and from in_progress', () => {
    expect(applyOccurrenceAction('triage', 'merge', 'manager')).toEqual({ ok: true, to: 'merged' });
    expect(applyOccurrenceAction('in_progress', 'merge', 'manager')).toEqual({
      ok: true,
      to: 'merged',
    });
  });

  it('only lets the system reopen', () => {
    expect(applyOccurrenceAction('awaiting_confirmation', 'reopen', 'manager')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(applyOccurrenceAction('awaiting_confirmation', 'reopen', 'system')).toEqual({
      ok: true,
      to: 'triage',
    });
  });

  it('rejects an action from the wrong status', () => {
    expect(applyOccurrenceAction('completed', 'merge', 'manager')).toEqual({
      ok: false,
      reason: 'invalid_status',
    });
  });
});

describe('availableOccurrenceActions', () => {
  it('lists manager actions on triage', () => {
    expect(availableOccurrenceActions('triage', 'manager')).toEqual(['assign', 'reject', 'merge']);
  });
});

describe('CLUSTERABLE_OCCURRENCE_STATUSES', () => {
  it('is triage and in_progress', () => {
    expect(CLUSTERABLE_OCCURRENCE_STATUSES).toEqual(['triage', 'in_progress']);
  });
});
