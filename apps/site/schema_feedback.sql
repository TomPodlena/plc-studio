-- PLCdesk — zpětná vazba z aplikace (POST /api/feedback, správa #/feedback).
-- Migrace je idempotentní (jen CREATE … IF NOT EXISTS), spouští se po schema.sql, schema_admin.sql,
-- schema_beta.sql a schema_ratelimit.sql a před nasazením Workeru se zpětnou vazbou (z apps/site):
--   npx wrangler@4 d1 execute plcdesk --remote --file=schema_feedback.sql
-- Testy (test/api.test.js) a lokální náhled (scripts/local-env.js) ji načítají za schema_ratelimit.sql
-- a dělí podle středníku: v komentářích proto středník nepoužívat.

-- Záznamy zpětné vazby. kind bug | idea | question, text = čistý text uživatele (max. 5000 znaků,
-- víceřádkový), email = adresa pro odpověď (jen když ji uživatel vyplnil, jinak NULL = anonymně).
-- Kontext z aplikace: client web | desktop, app_version, lang, step (krok aplikace), env (OS / prohlížeč
-- stručně), plan (tarif licence) — nikdy licenční klíč ani otisk počítače.
-- project_json = přiložený projekt .plcstudio.json (jen na výslovné zaškrtnutí, max. 512 kB, R2 není),
-- has_project 1 = projekt je uložený. Seznam ve správě sloupec project_json nečte.
-- status new | read | done | wontfix, note = poznámka provozovatele (max. 2000 znaků).
-- Uchování: nejdéle 2 roky od přijetí (maže správa při načtení seznamu), dřív na žádost (smazání ve správě).
CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  text          TEXT NOT NULL,
  email         TEXT,
  client        TEXT NOT NULL,
  app_version   TEXT,
  lang          TEXT,
  step          TEXT,
  env           TEXT,
  plan          TEXT,
  has_project   INTEGER NOT NULL DEFAULT 0,
  project_json  TEXT,
  project_size  INTEGER,
  status        TEXT NOT NULL DEFAULT 'new',
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_kind ON feedback(kind, created_at);
