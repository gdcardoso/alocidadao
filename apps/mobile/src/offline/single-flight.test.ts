import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './single-flight';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createSingleFlight', () => {
  it('shares one run between concurrent calls', async () => {
    let runs = 0;
    const run = createSingleFlight(async () => {
      runs++;
      await tick();
      return runs;
    });
    const results = await Promise.all([run(), run(), run()]);
    expect(runs).toBe(1);
    expect(results).toEqual([1, 1, 1]);
  });

  it('allows a new run after the previous one finishes, even on failure', async () => {
    let runs = 0;
    const run = createSingleFlight(async () => {
      runs++;
      if (runs === 1) throw new Error('boom');
    });
    await expect(run()).rejects.toThrow('boom');
    await run();
    expect(runs).toBe(2);
  });
});
