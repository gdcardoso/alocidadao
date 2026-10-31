import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MapLegend } from './MapLegend';
import { SummaryStrip } from './SummaryStrip';

const summary = { triage: 12, inProgress: 30, dueSoon: 4, overdue: 3 };

describe('summary strip', () => {
  it('strip shows the four numbers and marks the active one', async () => {
    const onClick = vi.fn();
    render(<SummaryStrip summary={summary} active="overdue" onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Na triagem: 12' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Em atendimento: 30' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vencem em 2 dias: 4' })).toBeInTheDocument();
    const overdue = screen.getByRole('button', { name: 'Atrasadas: 3' });
    expect(overdue).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Na triagem: 12' }));
    expect(onClick).toHaveBeenCalledWith('triage');
  });

  it('shows a dash while loading', () => {
    render(<SummaryStrip summary={undefined} active={null} onClick={vi.fn()} />);
    expect(screen.getAllByText('–')).toHaveLength(4);
  });
});

describe('map legend', () => {
  it('legend shows "Situação do prazo"', () => {
    render(<MapLegend />);
    expect(screen.getByText('Situação do prazo')).toBeInTheDocument();
    for (const text of [
      'No prazo',
      'Vence em até 2 dias',
      'Atrasada',
      'Na triagem (sem prazo)',
      'Número = relatos no ponto',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});
