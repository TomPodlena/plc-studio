-- PLCdesk — schéma D1
-- Spuštění:  wrangler d1 execute plcdesk --remote --file=schema.sql

-- Zájemci o stažení. E-mail je jediný povinný údaj.
CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  locale        TEXT NOT NULL DEFAULT 'cs',
  source        TEXT,                      -- utm_source nebo odkud přišel
  created_at    TEXT NOT NULL,
  confirmed_at  TEXT,                      -- kdy poprvé stáhl
  unsubscribed  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

-- Jednorázové tokeny na stažení. Posílají se e-mailem, platí 7 dní.
CREATE TABLE IF NOT EXISTS download_tokens (
  token       TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL REFERENCES leads(id),
  expires_at  TEXT NOT NULL,
  used_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Licence. Tarif free se needituje — ten nemá licenční soubor vůbec.
CREATE TABLE IF NOT EXISTS licenses (
  key           TEXT PRIMARY KEY,          -- PLCD-XXXX-XXXX-XXXX-XXXX
  email         TEXT NOT NULL,
  plan          TEXT NOT NULL,             -- 'pro' | 'firma'
  seats         INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | past_due | canceled
  valid_until   TEXT NOT NULL,
  stripe_sub_id TEXT,
  note          TEXT,                      -- např. 'beta program', 'škola'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);

-- Aktivace na konkrétním počítači. Drží se kvůli počtu seatů, ne kvůli DRM.
CREATE TABLE IF NOT EXISTS activations (
  id           TEXT PRIMARY KEY,
  license_key  TEXT NOT NULL REFERENCES licenses(key),
  device_hash  TEXT NOT NULL,              -- anonymní otisk stroje z aplikace
  device_label TEXT,                       -- uživatelský popis, ať pozná který to je
  last_seen_at TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_unique
  ON activations(license_key, device_hash);

-- Odemčení jednoho projektu nad limit (marketingový nástroj z ceníku).
CREATE TABLE IF NOT EXISTS project_unlocks (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  project_id  TEXT NOT NULL,               -- id projektu z aplikace
  io_count    INTEGER,
  granted_at  TEXT NOT NULL,
  granted_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unlock_unique
  ON project_unlocks(email, project_id);
