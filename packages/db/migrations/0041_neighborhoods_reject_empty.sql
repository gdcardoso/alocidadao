-- Carga de bairros: recusa polígono degenerado. Um anel de área zero vira MULTIPOLYGON EMPTY
-- depois de ST_MakeValid/ST_CollectionExtract e era gravado como bairro que nunca cobre ponto
-- algum. Agora a carga inteira falha (SQLSTATE 22023) e a camada anterior fica como estava.
-- Corpo igual ao da 0037, com a checagem a mais; grants e REVOKE seguem os da função original.

CREATE OR REPLACE FUNCTION replace_tenant_neighborhoods(p_tenant uuid, p_features jsonb)
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
    IF EXISTS (SELECT 1 FROM tenant_neighborhoods WHERE tenant_id = p_tenant AND ST_IsEmpty(boundary)) THEN
      RAISE EXCEPTION 'Bairro com geometria vazia (polígono sem área)' USING ERRCODE = '22023';
    END IF;
    PERFORM refresh_occurrence_neighborhoods(p_tenant);
    RETURN v_count;
  END
  $$;
