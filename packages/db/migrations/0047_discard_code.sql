-- Descarta um código de verificação que não chegou a ser enviado (falha no provedor de
-- mensagens), para que ele não conte no reenvio de 60 s nem no limite de 5 por hora.
-- Só apaga código ainda não consumido; id desconhecido ou já consumido não faz nada.

CREATE FUNCTION auth_discard_code(p_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DELETE FROM verification_codes WHERE id = p_id AND consumed_at IS NULL;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_discard_code(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_discard_code(uuid) TO app_user;
