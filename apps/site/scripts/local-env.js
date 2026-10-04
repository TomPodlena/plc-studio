// Lokalni prostredi pro Worker bez Cloudflare: D1 nahrazena SQLite v pameti (node:sqlite),
// vyvojovy rezim (DEV_MODE: e-maily jen do logu, Turnstile se neoveruje) a free rezim
// MAIL_MODE=direct. Pouziva ho scripts/serve.js, aby formular fungoval i lokalne.
// Sprava zakazniku (/sprava) lokalne: ADMIN_TOKEN=lokalni node scripts/serve.js [--demo]

import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function sqliteD1(file = ":memory:") {
  const db = new DatabaseSync(file);
  // schema.sql + migrace spravy zakazniku (schema_admin.sql), stejne poradi jako pri nasazeni
  for (const f of ["schema.sql", "schema_admin.sql"]) {
    const schema = fs.readFileSync(path.join(ROOT, f), "utf-8");
    for (const stmt of schema.split(";")) if (stmt.replace(/--.*$/gm, "").trim()) db.exec(stmt + ";");
  }
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

// Ukazkova data pro nahled spravy (node scripts/serve.js --demo). Jen smyslene adresy example.*.
export function seedDemo(db) {
  const day = 864e5;
  const iso = (d) => new Date(Date.now() + d * day).toISOString();
  const ins = (sql, ...a) => db.prepare(sql).run(...a);
  const people = [
    ["jana.novakova@strojirna-example.cz", "cs", -40, -39], ["integrator@automatika-example.cz", "cs", -25, -24],
    ["m.weber@anlagenbau-example.de", "de", -18, -18], ["buyer@controls-example.com", "en", -12, null],
    ["skola@spst-example.cz", "cs", -9, -8], ["petr.dvorak@example.cz", "cs", -5, -5], ["info@example.eu", "en", -2, null],
  ];
  people.forEach(([email, locale, c, conf], i) => {
    ins("INSERT INTO leads (id, email, locale, source, terms_accepted_at, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      `lead-${i}`, email, locale, i % 2 ? "linkedin" : null, iso(c), iso(c), conf == null ? null : iso(conf));
    ins("INSERT INTO download_tokens (token, lead_id, expires_at, used_count, created_at) VALUES (?, ?, ?, ?, ?)",
      `tok-${i}`, `lead-${i}`, iso(c + 7), conf == null ? 0 : 1 + (i % 3), iso(c));
  });
  const lic = [
    ["PLCD-DEMO-AAAA-BBBB-CC22", "jana.novakova@strojirna-example.cz", "firma", 5, "active", 300, "stripe", "sub_demo_1", null],
    ["PLCD-DEMO-DDDD-EEEE-FF33", "integrator@automatika-example.cz", "pro", 1, "past_due", 20, "stripe", "sub_demo_2", null],
    ["PLCD-DEMO-GGGG-HHHH-JJ44", "m.weber@anlagenbau-example.de", "pro", 1, "active", 340, "paddle", "sub_demo_3", null],
    ["PLCD-DEMO-KKKK-LLLL-MM55", "skola@spst-example.cz", "free-unlock", 20, "active", 360, null, null, "škola — výuka"],
    ["PLCD-DEMO-NNNN-PPPP-QQ66", "petr.dvorak@example.cz", "trial", 1, "canceled", 9, null, null, "zkušební"],
  ];
  for (const [key, email, plan, seats, status, d, prov, sub, note] of lic) {
    ins(`INSERT INTO licenses (key, email, plan, seats, status, valid_until, payment_provider, sub_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, key, email, plan, seats, status, iso(d), prov, sub, note, iso(-30), iso(-1));
  }
  const acts = [
    ["act-1", "PLCD-DEMO-AAAA-BBBB-CC22", "a1b2c3d4e5f6a7b8", "Konstrukce — NB Jana", -1, null],
    ["act-2", "PLCD-DEMO-AAAA-BBBB-CC22", "b2c3d4e5f6a7b8c9", "Dílna — PC u stroje", -3, null],
    ["act-3", "PLCD-DEMO-AAAA-BBBB-CC22", "c3d4e5f6a7b8c9d0", "Starý notebook", -60, -20],
    ["act-4", "PLCD-DEMO-DDDD-EEEE-FF33", "d4e5f6a7b8c9d0e1", "Servisní notebook", -2, null],
    ["act-5", "PLCD-DEMO-GGGG-HHHH-JJ44", "e5f6a7b8c9d0e1f2", "Büro", 0, null],
  ];
  for (const [id, key, hash, label, seen, rev] of acts) {
    ins("INSERT INTO activations (id, license_key, device_hash, device_label, last_seen_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, key, hash, label, iso(seen), iso(-30), rev == null ? null : iso(rev));
  }
  const pays = [["evt_demo_1", "stripe", "checkout.session.completed", "sub_demo_1", -30], ["evt_demo_2", "stripe", "invoice.paid", "sub_demo_1", -1],
    ["evt_demo_3", "stripe", "invoice.payment_failed", "sub_demo_2", -3], ["evt_demo_4", "paddle", "transaction.completed", "sub_demo_3", -18]];
  for (const [id, prov, type, sub, d] of pays) {
    ins("INSERT INTO payment_events (event_id, provider, type, received_at) VALUES (?, ?, ?, ?)", id, prov, type, iso(d));
    ins("INSERT INTO payment_log (event_id, provider, type, sub_id, email, received_at) VALUES (?, ?, ?, ?, (SELECT email FROM licenses WHERE sub_id = ?), ?)",
      id, prov, type, sub, sub, iso(d));
  }
  ins("INSERT INTO project_unlocks (id, email, project_id, io_count, granted_at, granted_by) VALUES (?, ?, ?, ?, ?, ?)",
    "unl-1", "buyer@controls-example.com", "p-demo", 78, iso(-11), "self-serve");
  ins("INSERT INTO customer_notes (id, email, body, author, created_at) VALUES (?, ?, ?, ?, ?)",
    "note-1", "jana.novakova@strojirna-example.cz", "Fakturu posílat na nákup, IČO v podpisu e-mailu. Pátý počítač až po rozšíření licence.", "token", iso(-6));
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
    // licence lokalne podepise docasny klic (kazdy start jiny) - ostry klic sem nepatri
    LICENSE_PRIVATE_KEY: process.env.LICENSE_PRIVATE_KEY ||
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    // sprava zakazniku: lokalne jen s vyslovne zadanym tokenem (ADMIN_TOKEN=... node scripts/serve.js)
    ...(process.env.ADMIN_TOKEN ? { ADMIN_TOKEN: process.env.ADMIN_TOKEN } : {}),
    ...extra,
  };
}
