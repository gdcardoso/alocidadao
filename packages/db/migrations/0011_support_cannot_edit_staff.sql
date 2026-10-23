-- O suporte atende contas de cidadãos e de prefeitura, mas não altera a equipe interna:
-- trocar o e-mail ou o CPF de um admin redirecionaria o código de login do painel (escalada).
-- Só o admin altera contas com platform_role; cada um sempre altera a própria.
DROP POLICY users_update ON users;
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO app_user
  USING (
    id = app_current_user()
    OR app_is_platform_admin()
    OR (app_is_platform_staff() AND platform_role IS NULL)
  )
  WITH CHECK (
    id = app_current_user()
    OR app_is_platform_admin()
    OR (app_is_platform_staff() AND platform_role IS NULL)
  );
-- users_insert fica como está: platform_role está fora do GRANT de INSERT, então toda conta
-- nova nasce sem papel interno e o suporte não consegue criar uma conta da equipe.
