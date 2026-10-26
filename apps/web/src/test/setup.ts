// Registra os matchers do jest-dom (`toBeInTheDocument`…) no `expect` do Vitest.
// oxlint-disable-next-line import/no-unassigned-import
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sem `globals`, o Testing Library não limpa sozinho entre os testes.
afterEach(cleanup);
