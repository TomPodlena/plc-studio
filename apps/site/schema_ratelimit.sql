-- Omezeni pokusu z jedne IP pro verejne endpointy /api/lead, /api/unlock, /api/license/activate
-- a /api/license/check (worker/ratelimit.js). Idempotentni - lze spustit opakovane:
--   npx wrangler@4 d1 execute plcdesk --remote --file=schema_ratelimit.sql
-- bucket = lead | unlock | license, ip = adresa klienta (IPv6 jako prefix /64), at = ISO cas pokusu.

CREATE TABLE IF NOT EXISTS rate_attempts (
  bucket TEXT NOT NULL,
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_attempts_key ON rate_attempts (bucket, ip, at);
CREATE INDEX IF NOT EXISTS idx_rate_attempts_at ON rate_attempts (at);
