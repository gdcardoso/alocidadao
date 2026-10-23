import { REQUEST_STATUSES } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';
import { colors } from './theme';

// O lucide-react-native puxa o react-native, que não roda no Node: cada ícone vira o próprio nome.
vi.mock('lucide-react-native', () => {
  const names = [
    'Construction',
    'Lightbulb',
    'Trash2',
    'Trees',
    'Droplets',
    'Footprints',
    'Signpost',
    'PawPrint',
    'CircleEllipsis',
    'Inbox',
    'HardHat',
    'CircleAlert',
    'CircleCheck',
    'CircleX',
    'Ban',
  ];
  return Object.fromEntries(names.map((name) => [name, name]));
});

const { categoryIcon, groupColors, statusBadge } = await import('./category');

describe('category', () => {
  it('maps the demo catalog icons', () => {
    expect(categoryIcon('construction')).toBe('Construction');
    expect(categoryIcon('trash-2')).toBe('Trash2');
    expect(categoryIcon('paw-print')).toBe('PawPrint');
    expect(categoryIcon('circle-ellipsis')).toBe('CircleEllipsis');
  });

  it('unknown icon falls back to CircleEllipsis', () => {
    expect(categoryIcon('rocket')).toBe('CircleEllipsis');
    expect(categoryIcon(null)).toBe('CircleEllipsis');
  });

  it('group colors follow the Pencil', () => {
    expect(groupColors('infrastructure')).toEqual({ bg: colors.primary, fg: colors.onPrimary });
    expect(groupColors('environment')).toEqual({ bg: colors.brandGreen, fg: colors.onBrandGreen });
    expect(groupColors('public_services')).toEqual({
      bg: colors.brandYellow,
      fg: colors.onBrandYellow,
    });
  });

  it('statusBadge for every RequestStatus', () => {
    for (const status of REQUEST_STATUSES) {
      const badge = statusBadge(status);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.icon).toBeTruthy();
      expect(badge.bg).toMatch(/^#/);
      expect(badge.fg).toMatch(/^#/);
    }
    expect(statusBadge('open')).toEqual({
      label: 'Aberta',
      icon: 'Inbox',
      bg: colors.border,
      fg: colors.textSecondary,
    });
    expect(statusBadge('in_progress')).toEqual({
      label: 'Em atendimento',
      icon: 'HardHat',
      bg: colors.primarySoft,
      fg: colors.primary,
    });
    expect(statusBadge('awaiting_confirmation')).toEqual({
      label: 'Aguardando sua confirmação',
      icon: 'CircleAlert',
      bg: colors.warningSoft,
      fg: colors.warning,
    });
    expect(statusBadge('completed')).toEqual({
      label: 'Concluída',
      icon: 'CircleCheck',
      bg: colors.successSoft,
      fg: colors.success,
    });
    expect(statusBadge('rejected')).toEqual({
      label: 'Recusada',
      icon: 'CircleX',
      bg: colors.dangerSoft,
      fg: colors.danger,
    });
    expect(statusBadge('cancelled').label).toBe('Cancelada');
  });
});
