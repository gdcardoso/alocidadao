-- Sessões do painel passam a vencer após 1 h sem renovação (eram 12 h). As já abertas
-- adotam o prazo novo; as do app continuam sem prazo.

UPDATE sessions
SET idle_timeout_seconds = 3600,
    expires_at = least(expires_at, last_used_at + interval '1 hour')
WHERE idle_timeout_seconds IS NOT NULL
  AND revoked_at IS NULL;
