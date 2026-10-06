-- PLCdesk — správa zákazníků (/sprava, /api/admin/*): doplňkové tabulky D1.
-- Migrace je idempotentní (jen CREATE … IF NOT EXISTS), spouští se po schema.sql
-- a před nasazením Workeru se správou (z apps/site):
--   npx wrangler@4 d1 execute plcdesk --remote --file=schema_admin.sql
-- Testy (test/api.test.js) a lokální náhled (scripts/local-env.js) ji načítají za schema.sql
-- a dělí podle středníku: v komentářích proto středník nepoužívat.

-- Pokusy o přihlášení tokenem (omezení: 5 neúspěchů z jedné IP / 15 min -> 429).
-- IPv6 se ukládá jako prefix /64, ať se omezení nedá obejít střídáním adres v jedné síti.
CREATE TABLE IF NOT EXISTS admin_attempts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ip    TEXT NOT NULL,
  ok    INTEGER NOT NULL DEFAULT 0,
  at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_attempts_ip ON admin_attempts(ip, at);

-- Relace správy po přihlášení tokenem. Cookie nese podepsané (HMAC) id relace a konec
-- platnosti, odhlášení relaci zneplatní i na serveru (ukradená cookie po odhlášení nefunguje).
CREATE TABLE IF NOT EXISTS admin_sessions (
  id          TEXT PRIMARY KEY,            -- náhodný nonce z cookie
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,               -- nejvýš 8 h od přihlášení
  revoked_at  TEXT,
  ip          TEXT
);

-- Auditní záznam: kdo (e-mail z Cloudflare Access, nebo „token“), kdy, co, nad čím.
-- Licenční klíče se sem píší zkrácené.
CREATE TABLE IF NOT EXISTS admin_audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  via     TEXT NOT NULL,                   -- access | token | token-api | -
  action  TEXT NOT NULL,
  target  TEXT,
  detail  TEXT,
  ip      TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at);

-- Poznámky provozovatele k zákazníkovi (podle e-mailu).
CREATE TABLE IF NOT EXISTS customer_notes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  body        TEXT NOT NULL,
  author      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_notes_email ON customer_notes(email, created_at);

-- Přehled platebních událostí k zákazníkovi. payment_events (schema.sql) slouží jen k tomu,
-- aby se událost nezpracovala dvakrát, a e-mail ani předplatné nenese, sem je zapisuje
-- payments.js od nasazení správy (starší události v přehledu nejsou).
CREATE TABLE IF NOT EXISTS payment_log (
  event_id     TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  type         TEXT,
  sub_id       TEXT,
  email        TEXT,
  received_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_log_email ON payment_log(email);
CREATE INDEX IF NOT EXISTS idx_payment_log_sub ON payment_log(sub_id);
CREATE INDEX IF NOT EXISTS idx_payment_log_at ON payment_log(received_at);

-- Obchodní kanban leadů (/sprava #/leady, /api/admin/crm*). Karta = firma.
-- Web leady (tabulka leads z formuláře ke stažení) se promítají samy jako fáze new, bez duplicit
-- podle e-mailu. U leadů z průzkumu (import) jen firemní údaje, contact_name / phone / email
-- jsou pro ruční doplnění. domain = doména webu (nebo firemního e-mailu) pro deduplikaci.
-- Hodnoty: segment integrator | strojirna | vyrobce | jine, source web_form | research | manual | import,
-- stage prospect | new | contacted | trial | offer | won | lost. value_czk = odhad hodnoty v Kč za rok.
CREATE TABLE IF NOT EXISTS crm_leads (
  id            TEXT PRIMARY KEY,
  email         TEXT,
  company       TEXT NOT NULL,
  contact_name  TEXT,
  website       TEXT,
  domain        TEXT,
  phone         TEXT,
  segment       TEXT NOT NULL DEFAULT 'jine',
  country       TEXT,
  city          TEXT,
  source        TEXT NOT NULL,
  source_url    TEXT,
  stage         TEXT NOT NULL DEFAULT 'new',
  value_czk     INTEGER,
  value_note    TEXT,
  next_action   TEXT,
  next_date     TEXT,
  owner         TEXT,
  lost_reason   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_email ON crm_leads(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_leads_domain ON crm_leads(domain);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage, next_date);

-- Historie karty: create | edit | stage_change (text from>to, případně důvod ztráty na dalším řádku)
-- | note | contact | import (text = zdroj web_form / research).
CREATE TABLE IF NOT EXISTS crm_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id  TEXT NOT NULL,
  at       TEXT NOT NULL,
  actor    TEXT NOT NULL,
  type     TEXT NOT NULL,
  text     TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_events_lead ON crm_events(lead_id, at);

-- Smazané karty s e-mailem (námitka, chybný záznam): synchronizace z formuláře je znovu nezaloží.
CREATE TABLE IF NOT EXISTS crm_suppressed (
  email  TEXT PRIMARY KEY,
  at     TEXT NOT NULL
);

-- Interní dokumenty provozovatele (/sprava #/dokumenty, /api/admin/doc*). Obsah žije JEN v D1,
-- nikdy v repozitáři ani ve veřejných souborech webu (repo je veřejné). Čtení i zápis jen po přihlášení
-- do správy. slug = ^[a-z0-9-]{1,64}$, body = Markdown (nejvýš 256 kB UTF-8), version = optimistický
-- zámek (uložení se starší verzí -> 409), updated_by = kdo naposledy uložil (e-mail z Access, nebo token).
CREATE TABLE IF NOT EXISTS admin_docs (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_docs_updated ON admin_docs(updated_at);
