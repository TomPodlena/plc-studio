-- PLCdesk — program pro beta testery platforem (stránka /beta, POST /api/beta, správa #/beta).
-- Migrace je idempotentní (jen CREATE … IF NOT EXISTS), spouští se po schema.sql a schema_admin.sql
-- a před nasazením Workeru s přihláškami (z apps/site):
--   npx wrangler@4 d1 execute plcdesk --remote --file=schema_beta.sql
-- Testy (test/api.test.js) a lokální náhled (scripts/local-env.js) ji načítají za schema_admin.sql
-- a dělí podle středníku: v komentářích proto středník nepoužívat.

-- Přihlášky beta testerů. Texty jsou čistý text (bez řídicích znaků a bez znaků < >), délky hlídá Worker.
-- platforms = klíče platforem ve stavu beta z data/verification.json, oddělené čárkou (např. siemens,omron).
-- status new | accepted | declined | done, note = poznámka provozovatele (max. 2000 znaků).
-- crm_lead_id = karta v obchodním kanbanu (bez osobních kontaktů), license_key = vystavená licence (jen evidence).
CREATE TABLE IF NOT EXISTS beta_applications (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  platforms    TEXT NOT NULL,
  ide          TEXT NOT NULL,
  ide_version  TEXT NOT NULL,
  name         TEXT,
  company      TEXT,
  email        TEXT NOT NULL,
  locale       TEXT NOT NULL DEFAULT 'cs',
  consent_at   TEXT NOT NULL,             -- souhlas se zpracováním údajů pro účel testu (checkbox ve formuláři)
  status       TEXT NOT NULL DEFAULT 'new',
  note         TEXT,
  crm_lead_id  TEXT,
  license_key  TEXT
);
CREATE INDEX IF NOT EXISTS idx_beta_status ON beta_applications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_beta_email ON beta_applications(email);

-- Pokusy o odeslání přihlášky z jedné IP (IPv6 jako prefix /64): nejvýš 5 za hodinu, záznamy se mažou po dni.
CREATE TABLE IF NOT EXISTS beta_attempts (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  ip  TEXT NOT NULL,
  at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_beta_attempts_ip ON beta_attempts(ip, at);
