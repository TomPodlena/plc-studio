// Lokalni prostredi pro Worker bez Cloudflare: D1 nahrazena SQLite v pameti (node:sqlite),
// vyvojovy rezim (DEV_MODE: e-maily jen do logu, Turnstile se neoveruje) a free rezim
// MAIL_MODE=direct. Pouziva ho scripts/serve.js, aby formular fungoval i lokalne.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function sqliteD1(file = ":memory:") {
  const db = new DatabaseSync(file);
  const schema = fs.readFileSync(path.join(ROOT, "schema.sql"), "utf-8");
  for (const stmt of schema.split(";")) if (stmt.replace(/--.*$/gm, "").trim()) db.exec(stmt + ";");
  return {
    db,
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() { return { success: true, meta: db.prepare(sql).run(...args) }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
      };
      return api;
    },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
  };
}

export function localEnv(extra = {}) {
  return {
    DB: sqliteD1(),
    APP_NAME: "PLCdesk",
    PUBLIC_SITE: "http://localhost:4173",
    DEV_MODE: "1",
    MAIL_MODE: "direct",
    DOWNLOAD_URL: "https://example.com/PLCdesk-dev-portable.zip",
    RELEASE_VERSION: "0.0.0-dev",
    FREE_IO_LIMIT: "64",
    ...extra,
  };
}
