CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint

-- Papel usado pela API. Em desenvolvimento ele já vem do docker/postgres/init.sql
-- com LOGIN; em produção, criar aqui sem login e definir a senha fora das migrações.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- Contexto da requisição, definido pela API com set_config(..., true) dentro de cada transação.
-- Sem contexto, as funções devolvem NULL e nenhuma política RLS libera linhas.
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app_is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on' $$;
--> statement-breakpoint

-- Protocolo sequencial por prefeitura e ano: 2026-000001.
-- Roda com as permissões de quem chama, então respeita o RLS de request_counters.
CREATE FUNCTION next_request_protocol() RETURNS text
  LANGUAGE plpgsql VOLATILE
  AS $$
DECLARE
  v_year integer := extract(year FROM now())::integer;
  v_value integer;
BEGIN
  INSERT INTO request_counters AS c (tenant_id, year, last_value)
    VALUES (app_current_tenant(), v_year, 1)
    ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = c.last_value + 1
    RETURNING c.last_value INTO v_value;
  RETURN v_year::text || '-' || lpad(v_value::text, 6, '0');
END
$$;
