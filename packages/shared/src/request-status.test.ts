import { describe, expect, it } from 'vitest';
import { applyRequestAction, availableRequestActions } from './request-status.js';

describe('applyRequestAction', () => {
  it('lets a manager assign an open request', () => {
    expect(applyRequestAction('open', 'assign', 'manager')).toEqual({ ok: true, to: 'in_progress' });
  });

  it('sends an impeded request back to open', () => {
    expect(applyRequestAction('in_progress', 'report_impediment', 'field_agent')).toEqual({
      ok: true,
      to: 'open',
    });
  });

  it('rejects an action from the wrong status', () => {
    expect(applyRequestAction('in_progress', 'cancel', 'citizen')).toEqual({
      ok: false,
      reason: 'invalid_status',
    });
  });

  it('rejects an action from the wrong actor', () => {
    expect(applyRequestAction('open', 'assign', 'citizen')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('only lets the system auto-confirm', () => {
    expect(applyRequestAction('awaiting_confirmation', 'auto_confirm', 'citizen').ok).toBe(false);
    expect(applyRequestAction('awaiting_confirmation', 'auto_confirm', 'system').ok).toBe(true);
  });
});

describe('availableRequestActions', () => {
  it('lists citizen actions while awaiting confirmation', () => {
    expect(availableRequestActions('awaiting_confirmation', 'citizen')).toEqual(['confirm', 'contest']);
  });

  it('offers nothing on a final status', () => {
    expect(availableRequestActions('completed', 'tenant_admin')).toEqual([]);
  });
});
