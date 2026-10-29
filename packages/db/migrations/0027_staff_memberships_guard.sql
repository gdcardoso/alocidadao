-- Separação equipe interna × prefeitura no próprio vínculo (Plano 6b). As funções de cadastro já
-- recusam conta da equipe (0026), mas o vínculo também nasce ou volta por INSERT e UPDATE diretos
-- da API (reativar gestor ou agente, cadastrar gestor que já teve vínculo). Este trigger cobre
-- todos os caminhos: vínculo de gestor, admin ou agente ativo ou convidado de conta com
-- platform_role é recusado com check_violation 'staff_account_not_allowed'.
-- Só confere quando o vínculo passa a dar acesso (novo, reativado, papel ou pessoa trocados): a
-- ativação do convite no login (invited → active) não muda nada e não é barrada.
-- SECURITY DEFINER: quem grava o vínculo (gestor) não enxerga a conta da equipe pelo RLS.

CREATE FUNCTION memberships_staff_guard()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status NOT IN ('active', 'invited')
      OR NEW.role NOT IN ('manager', 'tenant_admin', 'field_agent') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD.status IN ('active', 'invited')
      AND OLD.role = NEW.role
      AND OLD.user_id = NEW.user_id THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.platform_role IS NOT NULL) THEN
      RAISE EXCEPTION 'staff_account_not_allowed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION memberships_staff_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER memberships_staff_guard
  BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_staff_guard();
