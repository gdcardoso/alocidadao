import type { AgentRow } from '@alocidadao/shared';
import { formatPhoneBR } from '@alocidadao/shared';
import { CircleCheck, CircleOff, Mail } from 'lucide-react';
import { formatLastActive } from '../format/last-active';
import { useNow } from '../format/use-now';
import { Badge } from '../ui/Badge';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { RowMenu, type RowMenuItem } from '../ui/RowMenu';
import styles from './Teams.module.css';

export type AgentAction =
  'change_phone' | 'change_email' | 'resend_invite' | 'move' | 'deactivate' | 'reactivate';

export interface AgentsTableProps {
  agents: AgentRow[];
  onAction: (action: AgentAction, agent: AgentRow) => void;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function statusBadge(status: AgentRow['status']) {
  if (status === 'active') {
    return (
      <Badge tone="success" icon={<CircleCheck aria-hidden="true" />}>
        Ativo
      </Badge>
    );
  }
  if (status === 'invited') {
    return (
      <Badge tone="muted" icon={<Mail aria-hidden="true" />}>
        Convidado
      </Badge>
    );
  }
  return (
    <Badge tone="muted" icon={<CircleOff aria-hidden="true" />}>
      Desativado
    </Badge>
  );
}

/** Ativos e convidados por nome, depois os desativados. */
function sortAgents(agents: readonly AgentRow[]): AgentRow[] {
  const rank = (agent: AgentRow) => (agent.status === 'inactive' ? 1 : 0);
  return agents.toSorted(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );
}

function menuItems(agent: AgentRow, onAction: AgentsTableProps['onAction']): RowMenuItem[] {
  const items: RowMenuItem[] = [];
  if (agent.lastActiveAt === null) {
    items.push({ label: 'Trocar número', onSelect: () => onAction('change_phone', agent) });
  }
  if (agent.status !== 'inactive') {
    items.push({ label: 'Trocar e-mail', onSelect: () => onAction('change_email', agent) });
    if (agent.email) {
      items.push({ label: 'Reenviar convite', onSelect: () => onAction('resend_invite', agent) });
    }
  }
  items.push({ label: 'Mudar de equipe', onSelect: () => onAction('move', agent) });
  items.push(
    agent.status === 'inactive'
      ? { label: 'Reativar', onSelect: () => onAction('reactivate', agent) }
      : { label: 'Desativar', tone: 'danger', onSelect: () => onAction('deactivate', agent) },
  );
  return items;
}

/** Tabela de agentes da equipe (W6): sem a coluna "Em aberto". */
export function AgentsTable({ agents, onAction }: AgentsTableProps) {
  const now = useNow();
  const columns: DataTableColumn<AgentRow>[] = [
    {
      key: 'agent',
      header: 'Agente',
      width: 240,
      render: (agent) => (
        <div className={styles.cell}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(agent.name)}
          </span>
          <span className={styles.name}>{agent.name}</span>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Celular (login)',
      width: 180,
      render: (agent) => (agent.phone ? formatPhoneBR(agent.phone) : '—'),
    },
    {
      key: 'email',
      header: 'E-mail',
      width: 240,
      render: (agent) => agent.email ?? '—',
    },
    { key: 'status', header: 'Situação', width: 140, render: (agent) => statusBadge(agent.status) },
    {
      key: 'last',
      header: 'Último acesso',
      width: 160,
      render: (agent) => (
        <span className={styles.muted}>
          {formatLastActive(agent.lastActiveAt ? new Date(agent.lastActiveAt) : null, now)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 70,
      render: (agent) => <RowMenu label={agent.name} items={menuItems(agent, onAction)} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={sortAgents(agents)}
      rowKey={(agent) => agent.userId}
      rowLabel={(agent) => agent.name}
    />
  );
}
