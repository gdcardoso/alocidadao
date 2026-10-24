import { ApiError } from '@alocidadao/api-client';
import { describe, expect, it } from 'vitest';
import {
  cityFromLocate,
  pendingCount,
  phoneChangeErrorMessage,
  signOutWarning,
} from './profile-view';

describe('profile view', () => {
  it('sign out warning agrees in number with the waiting uploads', () => {
    expect(signOutWarning(1)).toBe(
      'Você tem 1 envio aguardando internet. Se sair agora, ele será apagado.',
    );
    expect(signOutWarning(3)).toBe(
      'Você tem 3 envios aguardando internet. Se sair agora, eles serão apagados.',
    );
  });

  it('pendingCount counts only items not sent yet', () => {
    expect(
      pendingCount([
        { status: 'pending' },
        { status: 'sending' },
        { status: 'done' },
        { status: 'conflict' },
        { status: 'failed' },
      ]),
    ).toBe(2);
  });

  it('phone change explains a number already in use', () => {
    expect(phoneChangeErrorMessage(new ApiError(409, { code: 'phone_in_use' }))).toBe(
      'Este número já está em outra conta.',
    );
    expect(phoneChangeErrorMessage(new ApiError(400, { code: 'code_invalid' }))).toBe(
      'Código incorreto. Confira e tente de novo.',
    );
  });

  it('cityFromLocate uses the tenant city or the municipality', () => {
    expect(
      cityFromLocate({
        status: 'served',
        tenant: {
          id: '7d0c6a3e-8f43-4c1e-9a55-2b4f0f6d1a10',
          displayName: 'Prefeitura de São Paulo',
          city: 'São Paulo',
          state: 'SP',
          centralPhone: null,
        },
        categories: [],
      }),
    ).toBe('São Paulo');
    expect(
      cityFromLocate({
        status: 'not_served',
        municipality: { ibgeCode: '3509502', name: 'Campinas', state: 'SP' },
      }),
    ).toBe('Campinas');
    expect(cityFromLocate({ status: 'not_served', municipality: null })).toBeNull();
  });
});
