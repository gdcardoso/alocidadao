import { schema, withContext, type Database } from '@alocidadao/db';
import {
  PANEL_NOTIFICATION_KINDS,
  notificationText,
  type PanelNotificationsResponse,
} from '@alocidadao/shared';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { panelDbContext, type PanelIdentity } from './member.js';

const { panelNotifications } = schema;

/** Quantos avisos a lista do sino mostra. */
const BELL_LIMIT = 30;

const EMPTY: PanelNotificationsResponse = { items: [], unreadCount: 0 };

/**
 * Os 30 avisos mais recentes da pessoa na prefeitura e quantos ainda não foram lidos (de todos,
 * não só dos 30). A RLS já limita a pessoa e a prefeitura. Modo suporte: lista vazia.
 */
export async function loadNotifications(
  db: Database,
  identity: PanelIdentity,
): Promise<PanelNotificationsResponse> {
  if (identity.platformRole) return EMPTY;
  return withContext(db, panelDbContext(identity), async (tx) => {
    const rows = await tx
      .select()
      .from(panelNotifications)
      .where(
        and(
          eq(panelNotifications.userId, identity.userId),
          eq(panelNotifications.tenantId, identity.tenantId),
        ),
      )
      .orderBy(desc(panelNotifications.createdAt), desc(panelNotifications.id))
      .limit(BELL_LIMIT);
    const [unread] = await tx
      .select({ total: count() })
      .from(panelNotifications)
      .where(
        and(
          eq(panelNotifications.userId, identity.userId),
          eq(panelNotifications.tenantId, identity.tenantId),
          isNull(panelNotifications.readAt),
        ),
      );
    return {
      items: rows
        // O gatilho só grava tipos do sino; o filtro protege o contrato.
        .filter((row) => (PANEL_NOTIFICATION_KINDS as readonly string[]).includes(row.kind))
        .map((row) => {
          const kind = row.kind as (typeof PANEL_NOTIFICATION_KINDS)[number];
          const details = row.details as { withPhotos?: boolean } | null;
          return {
            id: row.id,
            kind,
            protocol: row.protocol,
            text: notificationText(kind, row.protocol, details ?? undefined),
            occurrenceId: row.occurrenceId,
            workOrderId: row.workOrderId,
            createdAt: row.createdAt.toISOString(),
            readAt: row.readAt?.toISOString() ?? null,
          };
        }),
      unreadCount: unread?.total ?? 0,
    };
  });
}

/**
 * Marca um aviso como lido (repetir não muda a hora). `false` quando o aviso não existe ou é de
 * outra pessoa (a RLS o esconde). Modo suporte: nada a marcar, conta como feito.
 */
export async function markNotificationRead(
  db: Database,
  identity: PanelIdentity,
  id: string,
): Promise<boolean> {
  if (identity.platformRole) return true;
  return withContext(db, panelDbContext(identity), async (tx) => {
    const rows = await tx
      .update(panelNotifications)
      .set({ readAt: sql`coalesce(${panelNotifications.readAt}, now())` })
      .where(eq(panelNotifications.id, id))
      .returning({ id: panelNotifications.id });
    return rows.length > 0;
  });
}

/** Marca como lidos todos os avisos ainda não lidos da pessoa. Modo suporte: sem efeito. */
export async function markAllNotificationsRead(
  db: Database,
  identity: PanelIdentity,
): Promise<void> {
  if (identity.platformRole) return;
  await withContext(db, panelDbContext(identity), (tx) =>
    tx
      .update(panelNotifications)
      .set({ readAt: sql`now()` })
      .where(isNull(panelNotifications.readAt)),
  );
}
