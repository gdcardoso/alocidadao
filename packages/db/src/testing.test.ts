import { describe, expect, it } from 'vitest';
import { resetTestDatabase } from './testing.js';

describe('resetTestDatabase', () => {
  it('refuses a database whose name does not end in _test, before connecting', async () => {
    // Porta 1: se a trava falhasse, a tentativa de conexão daria outro erro.
    await expect(
      resetTestDatabase('postgres://alocidadao:alocidadao@localhost:1/alocidadao'),
    ).rejects.toThrow(/recusou o banco "alocidadao"/);
  });
});
