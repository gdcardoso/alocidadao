import type { AgentRow, TeamSummary } from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Pencil, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { inviteErrorMessage, inviteSentMessage } from '../ui/invite-errors';
import { Tabs } from '../ui/Tabs';
import { useToast } from '../ui/Toast';
import { TopBar } from '../ui/TopBar';
import {
  AddAgentDialog,
  ChangeEmailDialog,
  ChangePhoneDialog,
  MoveAgentDialog,
} from './AgentDialog';
import { AgentsTable, type AgentAction } from './AgentsTable';
import { generalErrorMessage } from './team-errors';
import { agentsKey, teamsKey } from './team-keys';
import { TeamDialog } from './TeamDialog';
import styles from './Teams.module.css';

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

function subtitle(teams: TeamSummary[]): string {
  const agents = teams.reduce((sum, team) => sum + team.activeAgentCount, 0);
  return `${plural(teams.length, 'equipe', 'equipes')} · ${plural(agents, 'agente ativo', 'agentes ativos')}`;
}

function cardMeta(team: TeamSummary): string {
  return [
    team.departmentName,
    plural(team.agentCount, 'agente', 'agentes'),
    plural(team.openWorkOrderCount, 'aberta', 'abertas'),
  ].join(' · ');
}

type Dialogs =
  | { kind: 'create-team' }
  | { kind: 'edit-team' }
  | { kind: 'add-agent' }
  | { kind: 'change-phone'; agent: AgentRow }
  | { kind: 'change-email'; agent: AgentRow }
  | { kind: 'move'; agent: AgentRow }
  | { kind: 'deactivate'; agent: AgentRow };

/** W6 · Equipes e agentes: lista de equipes à esquerda e a equipe aberta à direita. */
export function TeamsPage() {
  const { tenantId, context } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const teamsQuery = useQuery({
    queryKey: teamsKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelTeamsList(tenantId)),
  });
  const teams = (teamsQuery.data?.items ?? []).toSorted(
    (a, b) =>
      a.departmentName.localeCompare(b.departmentName, 'pt-BR') ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
  const requested = params.get('equipe');
  const selected = teams.find((team) => team.id === requested) ?? teams[0];

  const agentsQuery = useQuery({
    queryKey: agentsKey(tenantId, selected?.id ?? ''),
    queryFn: () => session.withAuth(() => api.panelAgents(tenantId, selected?.id ?? '')),
    enabled: selected !== undefined,
  });

  function select(teamId: string) {
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        search.set('equipe', teamId);
        return search;
      },
      { replace: true },
    );
  }

  const toggle = useMutation({
    mutationFn: (input: { agent: AgentRow; action: 'deactivate' | 'reactivate' }) =>
      session.withAuth(() =>
        api.panelUpdateAgent(tenantId, input.agent.userId, { action: input.action }),
      ),
    onSuccess: async (_row, input) => {
      await queryClient.invalidateQueries({ queryKey: teamsKey(tenantId) });
      toast.show(
        input.action === 'deactivate'
          ? `${input.agent.name} desativado.`
          : `${input.agent.name} reativado.`,
      );
      setDialog(null);
    },
    onError: (error) => {
      // Reativar agente que entrou na equipe Alô Cidadão: o banco recusa.
      setActionError(
        errorCode(error) === 'staff_account_not_allowed'
          ? 'Este número é de alguém da equipe Alô Cidadão. Use outro número.'
          : generalErrorMessage(error),
      );
      setDialog(null);
    },
  });

  const resend = useMutation({
    mutationFn: (agent: AgentRow) =>
      session.withAuth(() => api.panelResendAgentInvite(tenantId, agent.userId)),
    onSuccess: (result) => toast.show(inviteSentMessage(result.maskedEmail)),
    onError: (error) => setActionError(inviteErrorMessage(error)),
  });

  function onAgentAction(action: AgentAction, agent: AgentRow) {
    setActionError(null);
    if (action === 'change_phone') setDialog({ kind: 'change-phone', agent });
    else if (action === 'change_email') setDialog({ kind: 'change-email', agent });
    else if (action === 'resend_invite') resend.mutate(agent);
    else if (action === 'move') setDialog({ kind: 'move', agent });
    else if (action === 'deactivate') setDialog({ kind: 'deactivate', agent });
    else toggle.mutate({ agent, action: 'reactivate' });
  }

  const tabs = [{ to: '/equipes', label: 'Equipes e agentes' }];
  if (context.role === 'tenant_admin') tabs.push({ to: '/equipes/gestores', label: 'Gestores' });

  const close = () => setDialog(null);

  return (
    <div className={styles.page}>
      <TopBar
        title="Equipes e agentes"
        {...(teamsQuery.data ? { subtitle: subtitle(teams) } : {})}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setDialog({ kind: 'create-team' })}
          >
            Nova equipe
          </Button>
        }
      />
      <Tabs items={tabs} />
      <div className={styles.area}>
        {teamsQuery.isError ? (
          <p className={styles.state} role="alert">
            {generalErrorMessage(teamsQuery.error)}
          </p>
        ) : teamsQuery.data && teams.length === 0 ? (
          <p className={styles.state}>
            Nenhuma equipe cadastrada. Crie a primeira em "Nova equipe".
          </p>
        ) : (
          <>
            <ul className={styles.list} aria-label="Equipes">
              {teams.map((team) => (
                <li key={team.id}>
                  <button
                    type="button"
                    className={`${styles.card} ${team.id === selected?.id ? styles.cardSelected : ''}`}
                    aria-current={team.id === selected?.id ? 'true' : undefined}
                    onClick={() => select(team.id)}
                  >
                    <span className={styles.cardName}>{team.name}</span>
                    <span className={styles.cardMeta}>{cardMeta(team)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <section className={styles.detail} aria-label={selected.name}>
                <div className={styles.detailHeader}>
                  <div className={styles.detailTitles}>
                    <h2 className={styles.detailTitle}>{selected.name}</h2>
                    <p className={styles.detailMeta}>
                      {selected.baseAddress
                        ? `Setor: ${selected.departmentName} · base: ${selected.baseAddress}`
                        : `Setor: ${selected.departmentName} · sem base`}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Pencil size={14} aria-hidden="true" />}
                    onClick={() => setDialog({ kind: 'edit-team' })}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    icon={<UserPlus size={14} aria-hidden="true" />}
                    onClick={() => setDialog({ kind: 'add-agent' })}
                  >
                    Adicionar agente
                  </Button>
                </div>
                {actionError ? (
                  <p className={styles.error} role="alert">
                    {actionError}
                  </p>
                ) : null}
                {agentsQuery.isError ? (
                  <p className={styles.state} role="alert">
                    {generalErrorMessage(agentsQuery.error)}
                  </p>
                ) : agentsQuery.data && agentsQuery.data.items.length === 0 ? (
                  <p className={styles.state}>Nenhum agente nesta equipe.</p>
                ) : agentsQuery.data ? (
                  <AgentsTable agents={agentsQuery.data.items} onAction={onAgentAction} />
                ) : null}
                <p className={styles.note}>
                  <Info size={16} aria-hidden="true" />O agente entra no app com o celular
                  cadastrado aqui. Em "⋯": trocar número, trocar e-mail, reenviar convite, mudar de
                  equipe ou desativar.
                </p>
              </section>
            ) : null}
          </>
        )}
      </div>

      {dialog?.kind === 'create-team' ? (
        <TeamDialog
          onClose={close}
          onSaved={(team) => {
            select(team.id);
            close();
          }}
        />
      ) : null}
      {dialog?.kind === 'edit-team' && selected ? (
        <TeamDialog team={selected} onClose={close} onSaved={close} />
      ) : null}
      {dialog?.kind === 'add-agent' && selected ? (
        <AddAgentDialog team={selected} onClose={close} />
      ) : null}
      {dialog?.kind === 'change-phone' ? (
        <ChangePhoneDialog agent={dialog.agent} onClose={close} />
      ) : null}
      {dialog?.kind === 'change-email' ? (
        <ChangeEmailDialog agent={dialog.agent} onClose={close} />
      ) : null}
      {dialog?.kind === 'move' ? (
        <MoveAgentDialog
          agent={dialog.agent}
          teams={teams.filter((team) => team.id !== selected?.id)}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'deactivate' ? (
        <ConfirmDialog
          title={`Desativar ${dialog.agent.name}?`}
          text="Ele deixa de ver as atividades no app. Dá para reativar depois."
          confirmLabel="Desativar"
          tone="danger"
          pending={toggle.isPending}
          onConfirm={() => toggle.mutate({ agent: dialog.agent, action: 'deactivate' })}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
