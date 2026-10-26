import type { ReviewDetail } from '@alocidadao/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReworkDialog } from './ReworkDialog';

const photoA = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const photoB = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const review = {
  agentName: 'João Pereira',
  categoryName: 'Buraco na via',
  address: 'Rua das Flores, 120',
  pendingPhotos: [
    { id: photoA, url: 'https://x/a.jpg' },
    { id: photoB, url: 'https://x/b.jpg' },
  ],
} as ReviewDetail;

describe('ReworkDialog', () => {
  it('rework dialog needs a reason and a message and sends discarded photos', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ReworkDialog review={review} pending={false} onCancel={vi.fn()} onConfirm={onConfirm} />,
    );

    expect(screen.getByText('João Pereira · Buraco na via · Rua das Flores, 120')).toBeVisible();
    const send = screen.getByRole('button', { name: 'Devolver' });
    expect(send).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Tirar novas fotos' }));
    expect(send).toBeDisabled();

    const message = screen.getByLabelText('Mensagem para o agente');
    await user.type(message, '  ab ');
    expect(send).toBeDisabled();
    await user.type(message, 'c');
    expect(send).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: 'Descartar foto 2' }));
    await user.click(send);
    expect(onConfirm).toHaveBeenCalledWith({
      reasons: ['new_photos'],
      discardedPhotoIds: [photoB],
      message: 'ab c',
    });
  });

  it('hides the photo section without pending photos', () => {
    render(
      <ReworkDialog
        review={{ ...review, pendingPhotos: [] }}
        pending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText('Fotos que não servem')).not.toBeInTheDocument();
  });
});
