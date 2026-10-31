import { describe, expect, it } from 'vitest';
import { deadlineTag } from './deadline.js';

// 12:00 em São Paulo (UTC-3) de 10/06/2026.
const NOW = new Date('2026-06-10T15:00:00Z');

describe('deadlineTag', () => {
  it('due today at 23:30 São Paulo is "Vence hoje"', () => {
    expect(deadlineTag('2026-06-11T02:30:00Z', NOW)).toBe('Vence hoje');
  });

  it('due at the end of today is "Vence hoje"', () => {
    expect(deadlineTag('2026-06-11T02:59:59Z', NOW)).toBe('Vence hoje');
  });

  it('due tomorrow is "Vence amanhã"', () => {
    expect(deadlineTag('2026-06-12T02:59:59Z', NOW)).toBe('Vence amanhã');
  });

  it('due in several days counts the days', () => {
    expect(deadlineTag('2026-06-14T02:59:59Z', NOW)).toBe('Vence em 3 dias');
  });

  it('due earlier today is "Atrasada hoje"', () => {
    expect(deadlineTag('2026-06-10T14:00:00Z', NOW)).toBe('Atrasada hoje');
  });

  it('overdue since yesterday is "Atrasada há 1 dia"', () => {
    expect(deadlineTag('2026-06-10T02:59:59Z', NOW)).toBe('Atrasada há 1 dia');
  });

  it('overdue for several days counts the days', () => {
    expect(deadlineTag('2026-06-08T02:59:59Z', NOW)).toBe('Atrasada há 3 dias');
  });

  it('at 23:30 São Paulo, a later time the same day is "Vence hoje"', () => {
    // 23:30 de 10/06 em São Paulo é 02:30Z de 11/06.
    expect(deadlineTag('2026-06-11T02:59:59Z', new Date('2026-06-11T02:30:00Z'))).toBe(
      'Vence hoje',
    );
  });
});
