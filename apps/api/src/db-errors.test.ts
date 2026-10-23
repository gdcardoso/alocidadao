import { describe, expect, it } from 'vitest';
import { isUniqueViolation, violatedConstraint } from './db-errors.js';

describe('db errors', () => {
  it('isUniqueViolation recognizes the code on the error and on its cause', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error())).toBe(false);
  });

  it('violatedConstraint reads the constraint on the error and on its cause', () => {
    expect(violatedConstraint({ constraint: 'a' })).toBe('a');
    expect(violatedConstraint({ cause: { constraint: 'b' } })).toBe('b');
    expect(violatedConstraint(new Error())).toBeUndefined();
  });
});
