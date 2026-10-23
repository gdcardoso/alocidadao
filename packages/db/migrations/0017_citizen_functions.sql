-- App do cidadão: municípios do IBGE e leitura das próprias solicitações em todas as prefeituras
-- (ver docs/decisoes/0001-isolamento-por-prefeitura.md).

-- ── municipalities: dado público, só leitura para app_user; quem grava é o dono (import) ──

ALTER TABLE municipalities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE municipalities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY municipalities_select ON municipalities FOR SELECT TO app_user USING (true);
--> statement-breakpoint
GRANT SELECT ON municipalities TO app_user;
--> statement-breakpoint

-- ── Lista "Minhas solicitações": todas as prefeituras, com a categoria de cada uma ──
-- Solicitações e categorias são da prefeitura (RLS por tenant), por isso a função roda como o
-- dono. Não há política de leitura direta das próprias solicitações: ela somaria linhas de
-- outras prefeituras às leituras feitas no contexto de uma prefeitura.
-- Sem usuário no contexto, app_current_user() é nulo e nada é devolvido.

CREATE FUNCTION citizen_list_requests(p_statuses text[])
  RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    protocol text,
    status text,
    category_name text,
    icon text,
    icon_group text,
    address text,
    created_at timestamptz,
    status_changed_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT r.id, r.tenant_id, r.protocol, r.status::text, c.name, c.icon, c.icon_group::text,
      r.address, r.created_at, r.status_changed_at
    FROM requests r
    JOIN categories c ON c.tenant_id = r.tenant_id AND c.id = r.category_id
    WHERE r.citizen_id = app_current_user()
      AND r.status::text = ANY (p_statuses)
    -- As que aguardam a confirmação do cidadão primeiro.
    ORDER BY (r.status = 'awaiting_confirmation') DESC, r.status_changed_at DESC, r.id
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION citizen_list_requests(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION citizen_list_requests(text[]) TO app_user;
--> statement-breakpoint

-- ── Prefeitura de uma solicitação, só se ela é do usuário do contexto (senão, nulo) ──
-- A API usa o resultado para abrir o contexto da prefeitura certa.

CREATE FUNCTION citizen_request_tenant(p_request_id uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT r.tenant_id
    FROM requests r
    WHERE r.id = p_request_id AND r.citizen_id = app_current_user()
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION citizen_request_tenant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION citizen_request_tenant(uuid) TO app_user;
