-- Bairros: acesso, camada efetiva, gatilho da ocorrência e carga pela equipe
-- (ver docs/decisoes/0001-isolamento-por-prefeitura.md). O bairro de uma ocorrência vem só das
-- camadas consolidadas (própria da prefeitura ou malha do IBGE), nunca do texto do endereço.

-- ── ibge_neighborhoods: dado público, só leitura para app_user; quem grava é o dono (import) ──

GRANT SELECT ON ibge_neighborhoods TO app_user;
--> statement-breakpoint

-- ── tenant_neighborhoods: a prefeitura e a equipe leem; só o admin da plataforma grava ──

ALTER TABLE tenant_neighborhoods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_neighborhoods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_neighborhoods_select ON tenant_neighborhoods FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant() OR app_is_platform_staff());
--> statement-breakpoint
CREATE POLICY tenant_neighborhoods_insert ON tenant_neighborhoods FOR INSERT TO app_user
  WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
CREATE POLICY tenant_neighborhoods_delete ON tenant_neighborhoods FOR DELETE TO app_user
  USING (app_is_platform_admin());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON tenant_neighborhoods TO app_user;
--> statement-breakpoint

-- ── Auxiliares internas: ninguém além do dono (e das funções SECURITY DEFINER) executa ──

-- Verdadeiro quando a sessão é do dono do banco (o script de importação). app_user nunca é.
-- Usa session_user porque, dentro de SECURITY DEFINER, current_user já é o dono da função.
CREATE FUNCTION app_is_db_owner() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(
      (SELECT pg_get_userbyid(d.datdba) = session_user
         FROM pg_database d WHERE d.datname = current_database()),
      false
    )
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_is_db_owner() FROM PUBLIC;
--> statement-breakpoint

-- Camada vigente da prefeitura, sem checar o chamador: a própria, se existir; senão a do IBGE
-- do município da prefeitura (tenants.ibge_code).
CREATE FUNCTION neighborhood_layer(p_tenant uuid)
  RETURNS TABLE (name text, boundary geometry, source text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT n.name, n.boundary, 'tenant'::text
    FROM tenant_neighborhoods n
    WHERE n.tenant_id = p_tenant
    UNION ALL
    SELECT i.name, i.boundary, 'ibge'::text
    FROM ibge_neighborhoods i
    JOIN tenants t ON t.ibge_code = i.ibge_code
    WHERE t.id = p_tenant
      AND NOT EXISTS (SELECT 1 FROM tenant_neighborhoods n WHERE n.tenant_id = p_tenant)
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION neighborhood_layer(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ── effective_neighborhoods: só a prefeitura do contexto, a equipe ou o dono leem ──

CREATE FUNCTION effective_neighborhoods(p_tenant uuid)
  RETURNS TABLE (name text, boundary geometry, source text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT l.name, l.boundary, l.source
    FROM neighborhood_layer(p_tenant) l
    WHERE p_tenant = app_current_tenant() OR app_is_platform_staff() OR app_is_db_owner()
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION effective_neighborhoods(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION effective_neighborhoods(uuid) TO app_user;
--> statement-breakpoint

-- ── neighborhood_at e o gatilho da ocorrência ──

-- Em divisa (ST_Covers vale para o contorno) vence o primeiro nome em ordem alfabética.
CREATE FUNCTION neighborhood_at(p_tenant uuid, p_point geometry)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT l.name
    FROM neighborhood_layer(p_tenant) l
    WHERE ST_Covers(l.boundary, p_point)
    ORDER BY l.name
    LIMIT 1
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION neighborhood_at(uuid, geometry) FROM PUBLIC;
--> statement-breakpoint

-- SECURITY DEFINER para que quem grava a ocorrência não precise de EXECUTE nas auxiliares.
CREATE FUNCTION occurrences_set_neighborhood() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    NEW.neighborhood := neighborhood_at(NEW.tenant_id, NEW.location);
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION occurrences_set_neighborhood() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER occurrences_set_neighborhood
  BEFORE INSERT OR UPDATE OF location ON occurrences
  FOR EACH ROW EXECUTE FUNCTION occurrences_set_neighborhood();
--> statement-breakpoint

-- ── refresh_occurrence_neighborhoods: recalcula todas as ocorrências da prefeitura ──

-- Chamável por app_user só quando app_is_platform_admin(). O script de importação roda como dono
-- do banco, sem contexto: app_is_db_owner() deixa passar. Devolve quantas ocorrências mudaram.
CREATE FUNCTION refresh_occurrence_neighborhoods(p_tenant uuid)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_changed int;
  BEGIN
    IF NOT (app_is_platform_admin() OR app_is_db_owner()) THEN
      RAISE EXCEPTION 'Somente o admin da plataforma recalcula bairros' USING ERRCODE = '42501';
    END IF;
    UPDATE occurrences o
    SET neighborhood = neighborhood_at(o.tenant_id, o.location)
    WHERE o.tenant_id = p_tenant
      AND o.neighborhood IS DISTINCT FROM neighborhood_at(o.tenant_id, o.location);
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION refresh_occurrence_neighborhoods(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION refresh_occurrence_neighborhoods(uuid) TO app_user;
--> statement-breakpoint

-- ── Carga da camada própria: só o admin da plataforma, numa transação ──

-- p_features: [{ "name": "...", "geometry": <GeoJSON Polygon/MultiPolygon> }]. ST_MakeValid conserta
-- laços (anéis que se cruzam) e ST_CollectionExtract descarta linhas e pontos que sobrem.
-- Devolve quantos bairros ficaram na camada.
CREATE FUNCTION replace_tenant_neighborhoods(p_tenant uuid, p_features jsonb)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_count int;
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'Somente o admin da plataforma carrega bairros' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_features) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'p_features deve ser uma lista de { name, geometry }' USING ERRCODE = '22023';
    END IF;
    DELETE FROM tenant_neighborhoods WHERE tenant_id = p_tenant;
    INSERT INTO tenant_neighborhoods (tenant_id, name, boundary)
    SELECT p_tenant,
           btrim(f ->> 'name'),
           ST_Multi(ST_CollectionExtract(
             ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f -> 'geometry'), 4326)), 3))
    FROM jsonb_array_elements(p_features) f;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    PERFORM refresh_occurrence_neighborhoods(p_tenant);
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION replace_tenant_neighborhoods(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION replace_tenant_neighborhoods(uuid, jsonb) TO app_user;
--> statement-breakpoint

CREATE FUNCTION clear_tenant_neighborhoods(p_tenant uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'Somente o admin da plataforma apaga bairros' USING ERRCODE = '42501';
    END IF;
    DELETE FROM tenant_neighborhoods WHERE tenant_id = p_tenant;
    PERFORM refresh_occurrence_neighborhoods(p_tenant);
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION clear_tenant_neighborhoods(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clear_tenant_neighborhoods(uuid) TO app_user;
