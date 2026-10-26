import { describe, expect, it } from 'vitest';
import { dueDateHint, todayInSaoPaulo } from './due-date';

describe('due date', () => {
  it('due date hint counts days', () => {
    expect(dueDateHint('2026-10-26', '2026-10-26')).toBe('(hoje)');
    expect(dueDateHint('2026-10-27', '2026-10-26')).toBe('(1 dia)');
    expect(dueDateHint('2026-10-29', '2026-10-26')).toBe('(3 dias)');
    expect(dueDateHint('2026-11-02', '2026-10-30')).toBe('(3 dias)');
  });

  it('today follows the Brasilia date', () => {
    expect(todayInSaoPaulo(new Date('2026-10-27T01:30:00Z'))).toBe('2026-10-26');
  });
});
