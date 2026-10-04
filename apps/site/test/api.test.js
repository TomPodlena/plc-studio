// Prozene Worker realnymi pozadavky proti SQLite misto D1 (Node 22.5+, bez zavislosti).
// Prevzato z vetve web-a-licencni-api a rozsireno o pouceni z NATA: chybejici
// nastaveni zavira, past na boty, podepsany Stripe i Paddle, free rezim bez e-mailu.
//   node test/api.test.js

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createHmac, createPublicKey, verify, sign, hkdfSync, randomBytes } from "node:crypto";
import worker from "../worker/index.js";
import { ADMIN_PATHS, _resetAccessCache } from "../worker/admin.js";

const db = new DatabaseSync(":memory:");
// schema.sql + migrace spravy zakazniku (schema_admin.sql) - stejne poradi jako pri nasazeni
for (const f of ["../schema.sql", "../schema_admin.sql"]) {
  for (const stmt of readFileSync(new URL(f, import.meta.url), "utf8").split(";")) {
    if (stmt.replace(/--.*$/gm, "").trim()) db.exec(stmt + ";");
  }
}

// --- D1 shim ---
const D1 = {
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

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

// --- R2 shim ---
const files = new Map([
  ["latest.json", JSON.stringify({
    version: "1.0.0",
    assets: { portable: { key: "win/PLCdesk-1.0.0-portable.zip", filename: "PLCdesk-1.0.0-portable.zip" } },
  })],
  ["win/PLCdesk-1.0.0-portable.zip", "PK\x03\x04 pretend-binary"],
]);
const RELEASES = {
  async get(key) {
    if (!files.has(key)) return null;
    const body = files.get(key);
    return { body, size: body.length, text: async () => body };
  },
};

// --- ASSETS shim (staticky web) ---
const assetHits = [];
const ASSETS = { async fetch(req) { assetHits.push(new URL(req.url).pathname); return new Response("<html>", { status: 200 }); } };

const env = {
  DB: D1,
  RELEASES,
  ASSETS,
  APP_NAME: "PLCdesk",
  PUBLIC_SITE: "https://plcdesk.ucet.workers.dev",
  MAIL_MODE: "resend",
  MAIL_FROM: "PLCdesk <noreply@mail.example.eu>",
  RESEND_API_KEY: "re_test",
  FREE_IO_LIMIT: "64",
  TURNSTILE_SECRET: "ts-test-secret",
  PAYMENT_PROVIDER: "stripe",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_test",
  LICENSE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  ADMIN_TOKEN: "test-admin",
};

// Klice Cloudflare Access (testovaci tymova domena) - plni je testy spravy nize
const accessCerts = new Map();
const accessCertFetches = [];

// Odchozi pozadavky odchytime: Resend, Turnstile a certs Cloudflare Access. Nic jineho ven nesmi.
const sentMail = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("resend.com")) {
    sentMail.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
  }
  if (accessCerts.has(u)) {
    accessCertFetches.push(u);
    return new Response(JSON.stringify(accessCerts.get(u)), { status: 200 });
  }
  if (u.includes("challenges.cloudflare.com/turnstile")) {
    const ok = opts.body.get("secret") === "ts-test-secret" && opts.body.get("response") === "human";
    return new Response(JSON.stringify({ success: ok }), { status: 200 });
  }
  throw new Error("necekany odchozi pozadavek: " + u);
};

let pass = 0, fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log("  ok   " + name);
    pass++;
  } catch (e) {
    console.log("  FAIL " + name + " -> " + e.message);
    fail++;
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

const call = (method, path, body, headers = {}, e = env) =>
  worker.fetch(
    new Request("https://plcdesk.ucet.workers.dev" + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    e
  );
const human = { turnstile: "human", elapsed: 9000, consent: true };
const count = (sql) => db.prepare(sql).get().n;

console.log("\nstaticky web a smerovani");
await check("stranka mimo /api jde na ASSETS", async () => {
  const r = await call("GET", "/funkce/");
  eq(r.status, 200, "status");
  eq(assetHits.at(-1), "/funkce/", "cesta");
});
await check("neznama API cesta -> 404", async () => {
  eq((await call("GET", "/api/nic")).status, 404, "status");
});
await check("spatna metoda -> 405", async () => {
  eq((await call("GET", "/api/lead")).status, 405, "status");
});
await check("GET /api/config vraci limit", async () => {
  eq((await (await call("GET", "/api/config")).json()).free_io_limit, 64, "limit");
});

console.log("\nformular ke stazeni");
await check("neplatny e-mail odmitnut (cesky)", async () => {
  const r = await call("POST", "/api/lead", { email: "neni-email", ...human });
  eq(r.status, 400, "status");
  if (!/platnou/.test((await r.json()).error)) throw new Error("chybi ceska hlaska");
});
await check("neplatny e-mail odmitnut (nemecky)", async () => {
  const r = await call("POST", "/api/lead", { email: "x", locale: "de", ...human });
  if (!/gültige/.test((await r.json()).error)) throw new Error("chybi nemecka hlaska");
});
await check("honeypot: bot dostane ok, nic se neulozi ani neodesle", async () => {
  const r = await call("POST", "/api/lead", { email: "bot@spam.cz", web: "http://spam", ...human });
  eq(r.status, 200, "status");
  eq(count("SELECT COUNT(*) AS n FROM leads"), 0, "leady");
  eq(sentMail.length, 0, "maily");
});
await check("prilis rychle odeslani: bot dostane ok, nic se nestane", async () => {
  const r = await call("POST", "/api/lead", { email: "bot@spam.cz", turnstile: "human", elapsed: 400 });
  eq(r.status, 200, "status");
  eq(count("SELECT COUNT(*) AS n FROM leads"), 0, "leady");
});
await check("bez souhlasu s podminkami -> 400, nic se neulozi", async () => {
  const r = await call("POST", "/api/lead", { email: "bez@souhlasu.cz", turnstile: "human", elapsed: 9000 });
  eq(r.status, 400, "status");
  eq(count("SELECT COUNT(*) AS n FROM leads"), 0, "leady");
});
await check("bez tokenu Turnstile -> 403", async () => {
  eq((await call("POST", "/api/lead", { email: "a@firma.cz", elapsed: 9000, consent: true })).status, 403, "status");
});
await check("bez TURNSTILE_SECRET je formular zavreny (503), ne otevreny", async () => {
  const r = await call("POST", "/api/lead", { email: "a@firma.cz", ...human }, {}, { ...env, TURNSTILE_SECRET: undefined });
  eq(r.status, 503, "status");
  eq(count("SELECT COUNT(*) AS n FROM leads"), 0, "leady");
});
await check("platny e-mail -> mail s odkazem na /stazeni/", async () => {
  const r = await call("POST", "/api/lead", { email: "Integrator@Firma.CZ", ...human });
  eq(r.status, 200, "status");
  eq(sentMail.length, 1, "maily");
  if (!sentMail[0].text.includes("https://plcdesk.ucet.workers.dev/stazeni/?t=")) throw new Error("chybi odkaz: " + sentMail[0].text);
});
await check("anglicky lead -> anglicky mail s /en/ odkazem", async () => {
  await call("POST", "/api/lead", { email: "buyer@example.com", locale: "en", ...human });
  const m = sentMail.at(-1);
  if (!/download link/i.test(m.subject) || !m.text.includes("/en/stazeni/?t=")) throw new Error(m.subject);
});
await check("druhy pokus nezalozi duplicitni lead", async () => {
  await call("POST", "/api/lead", { email: "integrator@firma.cz", ...human });
  eq(count("SELECT COUNT(*) AS n FROM leads WHERE email='integrator@firma.cz'"), 1, "pocet leadu");
});
await check("bez RESEND_API_KEY v ostrem rezimu chyba, ne tiche zahozeni", async () => {
  const r = await call("POST", "/api/lead", { email: "c@firma.cz", ...human }, {}, { ...env, RESEND_API_KEY: undefined });
  eq(r.status, 500, "status");
});
await check("free rezim MAIL_MODE=direct: odkaz v odpovedi, zadny mail", async () => {
  const before = sentMail.length;
  const r = await call("POST", "/api/lead", { email: "free@firma.cz", ...human }, {}, { ...env, MAIL_MODE: "direct", RESEND_API_KEY: undefined });
  eq(r.status, 200, "status");
  const d = await r.json();
  if (!/^\/api\/download\?t=/.test(d.download_url)) throw new Error("chybi download_url");
  eq(sentMail.length, before, "maily");
});

console.log("\nstahovani");
const token = db.prepare("SELECT token FROM download_tokens ORDER BY created_at LIMIT 1").get().token;
await check("platny token stahne soubor z R2", async () => {
  const r = await call("GET", "/api/download?t=" + token);
  eq(r.status, 200, "status");
  if (!r.headers.get("Content-Disposition").includes("PLCdesk-1.0.0-portable.zip")) throw new Error("spatny soubor");
});
await check("bez R2: presmerovani na DOWNLOAD_URL (napr. GitHub Releases)", async () => {
  const e = { ...env, RELEASES: undefined, DOWNLOAD_URL: "https://github.com/x/y/releases/download/v1/PLCdesk.zip" };
  const r = await call("GET", "/api/download?t=" + token, undefined, {}, e);
  eq(r.status, 302, "status");
  eq(r.headers.get("Location"), e.DOWNLOAD_URL, "cil");
});
await check("bez souboru a bez R2 -> 503", async () => {
  const r = await call("GET", "/api/download?t=" + token, undefined, {}, { ...env, RELEASES: undefined });
  eq(r.status, 503, "status");
});
await check("neplatny token odmitnut", async () => {
  eq((await call("GET", "/api/download?t=nesmysl")).status, 404, "status");
});
await check("stazeni oznaci lead jako potvrzeny", async () => {
  if (!db.prepare("SELECT confirmed_at FROM leads WHERE email='integrator@firma.cz'").get().confirmed_at) throw new Error("confirmed_at");
});
await check("vyprsely token odmitnut", async () => {
  db.prepare("UPDATE download_tokens SET expires_at='2020-01-01T00:00:00.000Z' WHERE token=?").run(token);
  eq((await call("GET", "/api/download?t=" + token)).status, 410, "status");
});

console.log("\nlicence");
let licKey, licFile;
await check("admin vystavi licenci", async () => {
  const r = await call("POST", "/api/admin/license", { email: "beta@firma.cz", plan: "pro", days: 365, note: "beta", send: false }, { "X-Admin-Token": "test-admin" });
  eq(r.status, 200, "status");
  const d = await r.json();
  licKey = d.key;
  licFile = d.license;
  if (!/^PLCD-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(licKey)) throw new Error("spatny tvar klice " + licKey);
});
await check("podpis licence jde overit verejnym klicem", async () => {
  const [p, s] = licFile.split(".");
  const ok = verify(null, Buffer.from(p, "base64url"), createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(s, "base64url"));
  if (!ok) throw new Error("podpis nesedi");
  eq(JSON.parse(Buffer.from(p, "base64url")).plan, "pro", "tarif");
});
await check("admin bez tokenu odmitnut", async () => {
  eq((await call("POST", "/api/admin/license", { email: "x@y.cz" })).status, 401, "status");
});
await check("admin se spatnym tokenem odmitnut", async () => {
  eq((await call("POST", "/api/admin/license", { email: "x@y.cz" }, { "X-Admin-Token": "test-admiN" })).status, 401, "status");
});
await check("bez ADMIN_TOKEN je admin zavreny (503)", async () => {
  const r = await call("POST", "/api/admin/license", { email: "x@y.cz" }, { "X-Admin-Token": "" }, { ...env, ADMIN_TOKEN: undefined });
  eq(r.status, 503, "status");
});
await check("aktivace vrati podepsanou licenci", async () => {
  const r = await call("POST", "/api/license/activate", { key: licKey, device_hash: "stroj-A" });
  eq(r.status, 200, "status");
  const d = await r.json();
  if (!d.license.includes(".")) throw new Error("chybi podpis");
  eq(d.plan, "pro", "tarif");
});
await check("druhy pocitac nad pocet mist odmitnut", async () => {
  eq((await call("POST", "/api/license/activate", { key: licKey, device_hash: "stroj-B" })).status, 409, "status");
});
await check("reaktivace tehoz pocitace projde", async () => {
  eq((await call("POST", "/api/license/activate", { key: licKey, device_hash: "stroj-A" })).status, 200, "status");
  eq(count("SELECT COUNT(*) AS n FROM activations"), 1, "pocet aktivaci");
});
await check("neznamy klic -> 404", async () => {
  eq((await call("POST", "/api/license/activate", { key: "PLCD-XXXX-XXXX-XXXX-XXXX", device_hash: "x" })).status, 404, "status");
});
await check("check hlasi stav a toleranci", async () => {
  const d = await (await call("POST", "/api/license/check", { key: licKey, device_hash: "stroj-A" })).json();
  eq(d.status, "active", "stav");
  eq(d.grace_days, 30, "tolerance");
});

console.log("\nodemceni projektu");
await check("prvni odemceni projde a posle mail", async () => {
  const r = await call("POST", "/api/unlock", { email: "maly@integrator.cz", project_id: "p-1", io_count: 78, turnstile: "human" });
  eq(r.status, 200, "status");
  if (!/odemčen/.test(sentMail.at(-1).subject)) throw new Error("mail neodesel");
});
await check("druhe odemceni odmitnuto s odkazem na cenik", async () => {
  const r = await call("POST", "/api/unlock", { email: "maly@integrator.cz", project_id: "p-2", turnstile: "human" });
  eq(r.status, 409, "status");
  if (!(await r.json()).upgrade) throw new Error("chybi odkaz na cenik");
});

console.log("\nStripe");
function signed(event, secret = "whsec_test", ts = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const v1 = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return { payload, header: `t=${ts},v1=${v1}` };
}
const stripe = (event, opts = {}) => {
  const s = signed(event, opts.secret, opts.ts);
  return call("POST", "/api/stripe/webhook", s.payload, { "stripe-signature": opts.header ?? s.header }, opts.env ?? env);
};
const checkout = {
  id: "evt_checkout_1",
  type: "checkout.session.completed",
  data: { object: { customer_details: { email: "platil@firma.cz" }, subscription: "sub_1", metadata: { plan: "pro", locale: "de" } } },
};
await check("bez STRIPE_WEBHOOK_SECRET webhook nic neprijme (503)", async () => {
  eq((await stripe(checkout, { env: { ...env, STRIPE_WEBHOOK_SECRET: undefined } })).status, 503, "status");
  eq(count("SELECT COUNT(*) AS n FROM licenses WHERE email='platil@firma.cz'"), 0, "licence");
});
await check("nepodepsana zprava odmitnuta", async () => {
  eq((await stripe(checkout, { header: "t=1,v1=00" })).status, 400, "status");
});
await check("podpis jinym klicem odmitnut", async () => {
  eq((await stripe(checkout, { secret: "whsec_jiny" })).status, 400, "status");
});
await check("Stripe webhook pri PAYMENT_PROVIDER=paddle neexistuje (404)", async () => {
  eq((await stripe(checkout, { env: { ...env, PAYMENT_PROVIDER: "paddle" } })).status, 404, "status");
});
await check("stara zprava (prehrani) odmitnuta", async () => {
  eq((await stripe(checkout, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 400, "status");
});
await check("checkout.session.completed vystavi licenci a posle ji nemecky", async () => {
  const before = sentMail.length;
  eq((await stripe(checkout)).status, 200, "status");
  eq(sentMail.length, before + 1, "maily");
  if (!/Lizenz/.test(sentMail.at(-1).subject)) throw new Error(sentMail.at(-1).subject);
  eq(db.prepare("SELECT status FROM licenses WHERE email='platil@firma.cz'").get().status, "active", "stav");
});
await check("opakovana udalost (stejne event.id) se nezpracuje znovu", async () => {
  const before = sentMail.length;
  const d = await (await stripe(checkout)).json();
  eq(d.duplicate, true, "duplicate");
  eq(sentMail.length, before, "maily");
});
await check("jina udalost na stejne predplatne nezalozi druhou licenci", async () => {
  await stripe({ ...checkout, id: "evt_checkout_2" });
  eq(count("SELECT COUNT(*) AS n FROM licenses WHERE sub_id='sub_1'"), 1, "pocet");
});
await check("payment_failed -> past_due, ne zamceno", async () => {
  await stripe({ type: "invoice.payment_failed", data: { object: { subscription: "sub_1" } } });
  eq(db.prepare("SELECT status FROM licenses WHERE sub_id='sub_1'").get().status, "past_due", "stav");
});
await check("past_due licence porad aktivuje", async () => {
  const key = db.prepare("SELECT key FROM licenses WHERE sub_id='sub_1'").get().key;
  eq((await call("POST", "/api/license/activate", { key, device_hash: "stroj-C" })).status, 200, "status");
});
await check("invoice.paid vrati active a prodlouzi platnost", async () => {
  await stripe({ type: "invoice.paid", data: { object: { subscription: "sub_1" } } });
  const lic = db.prepare("SELECT status, valid_until FROM licenses WHERE sub_id='sub_1'").get();
  eq(lic.status, "active", "stav");
  if (new Date(lic.valid_until) < new Date(Date.now() + 30 * 864e5)) throw new Error("platnost");
});
await check("subscription.deleted -> zruseno a zamceno", async () => {
  await stripe({ type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } });
  const key = db.prepare("SELECT key FROM licenses WHERE sub_id='sub_1'").get().key;
  eq((await call("POST", "/api/license/activate", { key, device_hash: "stroj-D" })).status, 403, "status");
});

console.log("\nPaddle Billing");
const penv = { ...env, PAYMENT_PROVIDER: "paddle" };
function paddleSigned(event, secret = "pdl_ntfset_test", ts = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const h1 = createHmac("sha256", secret).update(`${ts}:${payload}`).digest("hex");
  return { payload, header: `ts=${ts};h1=${h1}` };
}
const paddle = (event, opts = {}) => {
  const s = paddleSigned(event, opts.secret, opts.ts);
  return call("POST", "/api/paddle/webhook", s.payload, { "Paddle-Signature": opts.header ?? s.header }, opts.env ?? penv);
};
const ptx = {
  event_id: "evt_pdl_1",
  event_type: "transaction.completed",
  data: { id: "txn_1", subscription_id: "sub_pdl_1", customer_id: "ctm_1", custom_data: { plan: "firma", locale: "en", email: "Zakaznik@Firma.eu" } },
};
await check("Paddle webhook pri PAYMENT_PROVIDER=stripe neexistuje (404)", async () => {
  eq((await paddle(ptx, { env })).status, 404, "status");
});
await check("bez PADDLE_WEBHOOK_SECRET webhook nic neprijme (503)", async () => {
  eq((await paddle(ptx, { env: { ...penv, PADDLE_WEBHOOK_SECRET: undefined } })).status, 503, "status");
  eq(count("SELECT COUNT(*) AS n FROM licenses WHERE sub_id='sub_pdl_1'"), 0, "licence");
});
await check("bez PAYMENT_PROVIDER jsou oba webhooky vypnute", async () => {
  const e = { ...env, PAYMENT_PROVIDER: undefined };
  eq((await paddle(ptx, { env: e })).status, 404, "paddle");
  eq((await stripe(checkout, { env: e })).status, 404, "stripe");
});
await check("neplatny podpis odmitnut", async () => {
  eq((await paddle(ptx, { header: `ts=${Math.floor(Date.now() / 1000)};h1=00ff` })).status, 400, "status");
});
await check("podpis jinym klicem odmitnut", async () => {
  eq((await paddle(ptx, { secret: "pdl_ntfset_jiny" })).status, 400, "status");
});
await check("podpis Stripe formatu na Paddle neprojde", async () => {
  const s = signed(ptx, "pdl_ntfset_test");
  eq((await call("POST", "/api/paddle/webhook", s.payload, { "Paddle-Signature": s.header }, penv)).status, 400, "status");
});
await check("stara zprava (prehrani) odmitnuta", async () => {
  eq((await paddle(ptx, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 400, "status");
});
await check("zmenene telo po podpisu odmitnuto", async () => {
  const s = paddleSigned(ptx);
  const tampered = s.payload.replace('"firma"', '"pro"');
  eq((await call("POST", "/api/paddle/webhook", tampered, { "Paddle-Signature": s.header }, penv)).status, 400, "status");
});
await check("transaction.completed vystavi licenci Firma (5 mist) a posle ji anglicky", async () => {
  const before = sentMail.length;
  eq((await paddle(ptx)).status, 200, "status");
  eq(sentMail.length, before + 1, "maily");
  if (!/licence/i.test(sentMail.at(-1).subject)) throw new Error(sentMail.at(-1).subject);
  const lic = db.prepare("SELECT * FROM licenses WHERE sub_id='sub_pdl_1'").get();
  eq([lic.plan, lic.seats, lic.payment_provider, lic.email], ["firma", 5, "paddle", "zakaznik@firma.eu"], "licence");
});
await check("opakovana udalost (stejne event_id) se nezpracuje znovu", async () => {
  const before = sentMail.length;
  const d = await (await paddle(ptx)).json();
  eq(d.duplicate, true, "duplicate");
  eq(sentMail.length, before, "maily");
});
await check("subscription.activated na stejne predplatne nezalozi druhou licenci", async () => {
  await paddle({ event_id: "evt_pdl_2", event_type: "subscription.activated", data: { id: "sub_pdl_1", customer_id: "ctm_1", custom_data: { plan: "firma" } } });
  eq(count("SELECT COUNT(*) AS n FROM licenses WHERE sub_id='sub_pdl_1'"), 1, "pocet");
});
await check("bez e-mailu v udalosti se e-mail dohleda pres Paddle API", async () => {
  const e = { ...penv, PADDLE_API_KEY: "pdl_live_apikey_test" };
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) =>
    String(u).startsWith("https://api.paddle.com/customers/ctm_2")
      ? new Response(JSON.stringify({ data: { email: "api@firma.cz" } }), { status: 200 })
      : orig(u, o);
  try {
    await paddle({ event_id: "evt_pdl_3", event_type: "subscription.activated", data: { id: "sub_pdl_2", customer_id: "ctm_2", custom_data: { plan: "pro", locale: "cs" } } }, { env: e });
  } finally {
    globalThis.fetch = orig;
  }
  eq(db.prepare("SELECT email FROM licenses WHERE sub_id='sub_pdl_2'").get()?.email, "api@firma.cz", "email");
});
await check("subscription.past_due -> past_due, aktivace dal funguje", async () => {
  await paddle({ event_id: "evt_pdl_4", event_type: "subscription.past_due", data: { id: "sub_pdl_1" } });
  const lic = db.prepare("SELECT key, status FROM licenses WHERE sub_id='sub_pdl_1'").get();
  eq(lic.status, "past_due", "stav");
  eq((await call("POST", "/api/license/activate", { key: lic.key, device_hash: "pc-1" })).status, 200, "aktivace");
});
await check("dalsi zaplacena transakce prodlouzi a vrati active", async () => {
  await paddle({ ...ptx, event_id: "evt_pdl_5", data: { ...ptx.data, id: "txn_2" } });
  eq(db.prepare("SELECT status FROM licenses WHERE sub_id='sub_pdl_1'").get().status, "active", "stav");
  eq(count("SELECT COUNT(*) AS n FROM licenses WHERE sub_id='sub_pdl_1'"), 1, "pocet");
});
await check("subscription.canceled -> zruseno a zamceno", async () => {
  await paddle({ event_id: "evt_pdl_6", event_type: "subscription.canceled", data: { id: "sub_pdl_1" } });
  const key = db.prepare("SELECT key FROM licenses WHERE sub_id='sub_pdl_1'").get().key;
  eq((await call("POST", "/api/license/activate", { key, device_hash: "pc-9" })).status, 403, "status");
});

// =====================================================================================
console.log("\nsprava zakazniku: prihlaseni tokenem");
const SITE = "https://plcdesk.ucet.workers.dev";
const COOKIE = "__Host-plcdesk_admin";
const IP = "198.51.100.7";
// pozadavek ze stranky /sprava: spravny Origin, X-Requested-With, IP klienta
const adm = (method, path, body, headers = {}, e = env) =>
  call(method, path, body, { Origin: SITE, "X-Requested-With": "plcdesk-admin", "CF-Connecting-IP": IP, ...headers }, e);
const cookieOf = (r) => {
  const m = new RegExp(`${COOKIE}=([^;]*)`).exec(r.headers.get("set-cookie") || "");
  return m ? m[1] : null;
};
const withCookie = (c, extra = {}) => ({ Cookie: `${COOKIE}=${c}`, ...extra });
const auditRows = (action) => db.prepare("SELECT * FROM admin_audit WHERE action = ? ORDER BY id").all(action);
// cookie podepsana stejne jako ve Workeru (HKDF z tokenu -> HMAC-SHA256), at jde podvrhnout exp/nonce
const sessionSig = (token, payload) =>
  createHmac("sha256", Buffer.from(hkdfSync("sha256", token, "plcdesk-admin-session-v1", "cookie-hmac", 32))).update(payload).digest("base64url");

let session;
await check("spravny token -> 200 a cookie __Host- (HttpOnly, Secure, SameSite=Strict, Path=/, 8 h)", async () => {
  const r = await adm("POST", "/api/admin/login", { token: "test-admin" });
  eq(r.status, 200, "status");
  const sc = r.headers.get("set-cookie");
  for (const a of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=28800"]) if (!sc.includes(a)) throw new Error("chybi " + a + ": " + sc);
  if (/domain=/i.test(sc)) throw new Error("__Host- cookie nesmi mit Domain");
  session = cookieOf(r);
  if (!/^v1\.\d{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(session)) throw new Error("tvar cookie " + session);
  eq(r.headers.get("cache-control"), "no-store", "cache");
  eq(auditRows("login").length, 1, "audit login");
});
await check("cookie otevre /api/admin/me (actor token, konec relace do 8 h)", async () => {
  const r = await adm("GET", "/api/admin/me", undefined, withCookie(session));
  eq(r.status, 200, "status");
  const d = await r.json();
  eq([d.actor, d.via], ["token", "token"], "kdo");
  const left = Date.parse(d.expires_at) - Date.now();
  if (left < 7.9 * 3600e3 || left > 8 * 3600e3 + 5000) throw new Error("platnost " + d.expires_at);
});
await check("spatny token -> 401, pokus v admin_attempts, v auditu i v logu (bez tokenu)", async () => {
  const warn = console.warn;
  const logged = [];
  console.warn = (...a) => logged.push(a.join(" "));
  try {
    const r = await adm("POST", "/api/admin/login", { token: "test-admiN" }, { "CF-Connecting-IP": "192.0.2.10" });
    eq(r.status, 401, "status");
    eq(cookieOf(r), null, "cookie");
  } finally {
    console.warn = warn;
  }
  eq(count("SELECT COUNT(*) AS n FROM admin_attempts WHERE ip = '192.0.2.10' AND ok = 0"), 1, "pokusy");
  if (!auditRows("login_failed").some((a) => a.ip === "192.0.2.10")) throw new Error("audit");
  if (!logged.some((l) => l.includes("192.0.2.10"))) throw new Error("log");
  if (logged.some((l) => l.includes("test-admiN"))) throw new Error("token v logu");
});
await check("prazdny / chybejici / prilis dlouhy token -> 401", async () => {
  for (const token of ["", undefined, 42, "x".repeat(5000)]) {
    eq((await adm("POST", "/api/admin/login", { token }, { "CF-Connecting-IP": "192.0.2.11" })).status, 401, String(token).slice(0, 10));
  }
});
await check("5 neuspechu z jedne IP -> 429 s Retry-After, i spravny token; jina IP projde", async () => {
  const ip = { "CF-Connecting-IP": "203.0.113.9" };
  for (let i = 0; i < 5; i++) eq((await adm("POST", "/api/admin/login", { token: "zkouska" + i }, ip)).status, 401, "pokus " + i);
  const r = await adm("POST", "/api/admin/login", { token: "test-admin" }, ip);
  eq(r.status, 429, "status");
  const ra = Number(r.headers.get("retry-after"));
  if (!(ra > 0 && ra <= 900)) throw new Error("Retry-After " + ra);
  eq(cookieOf(r), null, "cookie");
  eq((await adm("POST", "/api/admin/login", { token: "test-admin" }, { "CF-Connecting-IP": "203.0.113.10" })).status, 200, "jina IP");
});
await check("po 15 minutach se IP odblokuje", async () => {
  db.prepare("UPDATE admin_attempts SET at = ? WHERE ip = '203.0.113.9'").run(new Date(Date.now() - 16 * 60e3).toISOString());
  eq((await adm("POST", "/api/admin/login", { token: "test-admin" }, { "CF-Connecting-IP": "203.0.113.9" })).status, 200, "status");
});
await check("IPv6: omezeni plati pro celou sit /64", async () => {
  for (let i = 1; i <= 5; i++) await adm("POST", "/api/admin/login", { token: "x" }, { "CF-Connecting-IP": `2001:db8:0:7::${i}` });
  eq((await adm("POST", "/api/admin/login", { token: "test-admin" }, { "CF-Connecting-IP": "2001:db8:0:7:abcd::99" })).status, 429, "stejna /64");
  eq((await adm("POST", "/api/admin/login", { token: "test-admin" }, { "CF-Connecting-IP": "2001:db8:0:8::1" })).status, 200, "jina /64");
});
await check("skriptova cesta (X-Admin-Token) taky pocita neuspechy -> 429", async () => {
  const ip = { "CF-Connecting-IP": "203.0.113.50" };
  for (let i = 0; i < 5; i++) eq((await call("POST", "/api/admin/license", { email: "x@y.cz" }, { "X-Admin-Token": "spatne", ...ip })).status, 401, "pokus");
  eq((await call("POST", "/api/admin/license", { email: "x@y.cz" }, { "X-Admin-Token": "test-admin", ...ip })).status, 429, "blok");
});
await check("prosla cookie (exp v minulosti, spravne podepsana) -> 401", async () => {
  const exp = Math.floor(Date.now() / 1000) - 10;
  const nonce = session.split(".")[2];
  const c = `v1.${exp}.${nonce}.${sessionSig("test-admin", `v1.${exp}.${nonce}`)}`;
  eq((await adm("GET", "/api/admin/me", undefined, withCookie(c))).status, 401, "status");
});
await check("cookie s exp dal nez 8 h (spravne podepsana) -> 401", async () => {
  const exp = Math.floor(Date.now() / 1000) + 30 * 864e2;
  const nonce = session.split(".")[2];
  const c = `v1.${exp}.${nonce}.${sessionSig("test-admin", `v1.${exp}.${nonce}`)}`;
  eq((await adm("GET", "/api/admin/me", undefined, withCookie(c))).status, 401, "status");
});
await check("relace prosla v D1 -> 401", async () => {
  const c = cookieOf(await adm("POST", "/api/admin/login", { token: "test-admin" }));
  db.prepare("UPDATE admin_sessions SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), c.split(".")[2]);
  eq((await adm("GET", "/api/admin/me", undefined, withCookie(c))).status, 401, "status");
});
await check("podvrzeny podpis, jiny klic, cizi nonce, nesmysl -> 401", async () => {
  const [v, exp, nonce, sig] = session.split(".");
  const flip = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
  const otherKey = `${v}.${exp}.${nonce}.${sessionSig("jiny-token", `${v}.${exp}.${nonce}`)}`;
  const n2 = randomBytes(16).toString("base64url");
  const unknownNonce = `${v}.${exp}.${n2}.${sessionSig("test-admin", `${v}.${exp}.${n2}`)}`; // podpis sedi, relace v D1 neni
  for (const c of [`${v}.${exp}.${nonce}.${flip}`, otherKey, unknownNonce, "nesmysl", session + "x", ""]) {
    eq((await adm("GET", "/api/admin/me", undefined, withCookie(c))).status, 401, c.slice(0, 20));
  }
});
await check("rotace ADMIN_TOKEN zneplatni dosavadni relace", async () => {
  eq((await adm("GET", "/api/admin/me", undefined, withCookie(session), { ...env, ADMIN_TOKEN: "novy-token" })).status, 401, "status");
});
await check("odhlaseni smaze cookie a relaci zneplatni i na serveru", async () => {
  const c = cookieOf(await adm("POST", "/api/admin/login", { token: "test-admin" }));
  const r = await adm("POST", "/api/admin/logout", {}, withCookie(c));
  eq(r.status, 200, "status");
  if (!/Max-Age=0/.test(r.headers.get("set-cookie"))) throw new Error("cookie nesmazana");
  eq((await adm("GET", "/api/admin/me", undefined, withCookie(c))).status, 401, "stara cookie");
  eq(auditRows("logout").length, 1, "audit");
});
await check("bez ADMIN_TOKEN i bez Access -> 503 (login i API)", async () => {
  const e = { ...env, ADMIN_TOKEN: undefined };
  eq((await adm("POST", "/api/admin/login", { token: "x" }, {}, e)).status, 503, "login");
  eq((await adm("GET", "/api/admin/summary", undefined, withCookie(session), e)).status, 503, "summary");
});

console.log("\nsprava zakazniku: Cloudflare Access");
const accessKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rogueKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TEAM = "https://plcdesk-test.cloudflareaccess.com";
accessCerts.set(`${TEAM}/cdn-cgi/access/certs`, {
  keys: [{ ...accessKeys.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }],
});
const aenv = { ...env, ADMIN_TOKEN: undefined, ACCESS_TEAM_DOMAIN: "plcdesk-test", ACCESS_AUD: "aud-plcdesk-123", ADMIN_EMAILS: "Boss@Firma.cz, druhy@firma.cz" };
function jwt(claims = {}, { kid = "k1", alg = "RS256", key = accessKeys.privateKey, tamper } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: TEAM, aud: ["aud-plcdesk-123"], email: "boss@firma.cz", iat: nowS, nbf: nowS, exp: nowS + 600, sub: "u1", ...claims })).toString("base64url");
  const s = sign("sha256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${tamper ? tamper(body) : body}.${s}`;
}
const viaAccess = (token, method = "GET", path = "/api/admin/me", body, e = aenv) => adm(method, path, body, { "Cf-Access-Jwt-Assertion": token }, e);
_resetAccessCache();
await check("platny JWT podepsany klicem tymu -> 200, actor = e-mail", async () => {
  const r = await viaAccess(jwt());
  eq(r.status, 200, "status");
  const d = await r.json();
  eq([d.actor, d.via], ["boss@firma.cz", "access"], "kdo");
});
await check("klice se cachuji (druhy pozadavek bez stahovani)", async () => {
  const before = accessCertFetches.length;
  eq((await viaAccess(jwt())).status, 200, "status");
  eq(accessCertFetches.length, before, "stahovani");
});
await check("spatne aud -> 401", async () => eq((await viaAccess(jwt({ aud: ["jina-aplikace"] }))).status, 401, "status"));
await check("spatne iss -> 401", async () => eq((await viaAccess(jwt({ iss: "https://jiny.cloudflareaccess.com" }))).status, 401, "status"));
await check("prosly exp -> 401", async () => eq((await viaAccess(jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }))).status, 401, "status"));
await check("nbf v budoucnosti -> 401", async () => eq((await viaAccess(jwt({ nbf: Math.floor(Date.now() / 1000) + 3600 }))).status, 401, "status"));
await check("bez exp -> 401", async () => eq((await viaAccess(jwt({ exp: undefined }))).status, 401, "status"));
await check("e-mail mimo ADMIN_EMAILS -> 403", async () => eq((await viaAccess(jwt({ email: "cizi@firma.cz" }))).status, 403, "status"));
await check("bez e-mailu (service token) -> 403", async () => eq((await viaAccess(jwt({ email: undefined }))).status, 403, "status"));
await check("prazdne ADMIN_EMAILS -> nikdo (403)", async () => eq((await viaAccess(jwt(), "GET", "/api/admin/me", undefined, { ...aenv, ADMIN_EMAILS: "" })).status, 403, "status"));
await check("podpis jinym klicem se stejnym kid -> 401", async () => eq((await viaAccess(jwt({}, { key: rogueKeys.privateKey }))).status, 401, "status"));
await check("zmeneny payload po podpisu -> 401", async () => {
  const forged = Buffer.from(JSON.stringify({ iss: TEAM, aud: ["aud-plcdesk-123"], email: "boss@firma.cz", exp: 9999999999 })).toString("base64url");
  eq((await viaAccess(jwt({ email: "cizi@firma.cz" }, { tamper: () => forged }))).status, 401, "status");
});
await check("alg none / HS256 -> 401", async () => {
  const nowS = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ iss: TEAM, aud: ["aud-plcdesk-123"], email: "boss@firma.cz", exp: nowS + 600 })).toString("base64url");
  const none = `${Buffer.from('{"alg":"none","kid":"k1"}').toString("base64url")}.${p}.`;
  const hsHead = Buffer.from('{"alg":"HS256","kid":"k1"}').toString("base64url");
  const hs = `${hsHead}.${p}.${createHmac("sha256", "k1").update(`${hsHead}.${p}`).digest("base64url")}`;
  eq((await viaAccess(none)).status, 401, "none");
  eq((await viaAccess(hs)).status, 401, "HS256");
});
await check("neznamy kid -> znovu stahne klice, pak 401", async () => {
  _resetAccessCache();
  const before = accessCertFetches.length;
  eq((await viaAccess(jwt({}, { kid: "k-neznamy" }))).status, 401, "status");
  eq(accessCertFetches.length, before + 1, "stahovani");
});
await check("bez hlavicky JWT a bez cookie -> 401", async () => eq((await adm("GET", "/api/admin/me", undefined, {}, aenv)).status, 401, "status"));
await check("tymova domena mimo cloudflareaccess.com -> zadne stahovani, 401", async () => {
  _resetAccessCache();
  const before = accessCertFetches.length;
  eq((await viaAccess(jwt(), "GET", "/api/admin/me", undefined, { ...aenv, ACCESS_TEAM_DOMAIN: "https://utocnik.example.com" })).status, 401, "status");
  eq(accessCertFetches.length, before, "stahovani");
});
await check("jen Access (bez ADMIN_TOKEN): prihlaseni tokenem -> 503", async () => {
  eq((await adm("POST", "/api/admin/login", { token: "x" }, {}, aenv)).status, 503, "status");
});
await check("bez Access nastaveni se hlavicka JWT ignoruje (401)", async () => {
  eq((await viaAccess(jwt(), "GET", "/api/admin/me", undefined, { ...aenv, ACCESS_AUD: "", ADMIN_TOKEN: "test-admin" })).status, 401, "status");
});

console.log("\nsprava zakazniku: CSRF a pristup");
await check("vsechny /api/admin/* bez prihlaseni -> 401 (no-store, DENY)", async () => {
  const routes = [["GET", "/api/admin/me"], ["GET", "/api/admin/summary"], ["GET", "/api/admin/customers"], ["GET", "/api/admin/customer?email=beta@firma.cz"],
    ["POST", "/api/admin/license"], ["POST", "/api/admin/activation/release"], ["POST", "/api/admin/note"], ["GET", "/api/admin/export.csv?type=customers"], ["GET", "/api/admin/audit"]];
  const covered = new Set(routes.map(([, p]) => p.split("?")[0]));
  for (const p of ADMIN_PATHS) if (!covered.has(p) && !/login|logout/.test(p)) throw new Error("netestovana cesta " + p);
  for (const [m, p] of routes) {
    const r = await adm(m, p, m === "POST" ? { email: "beta@firma.cz", id: "x", body: "x", action: "cancel", key: "PLCD-AAAA-AAAA-AAAA-AAAA" } : undefined);
    eq(r.status, 401, `${m} ${p}`);
    eq(r.headers.get("cache-control"), "no-store", "cache " + p);
    eq(r.headers.get("x-frame-options"), "DENY", "XFO " + p);
  }
});
await check("neznama cesta /api/admin/* -> 404, spatna metoda -> 405", async () => {
  eq((await adm("GET", "/api/admin/nic", undefined, withCookie(session))).status, 404, "404");
  eq((await adm("GET", "/api/admin/note", undefined, withCookie(session))).status, 405, "405");
});
session = cookieOf(await adm("POST", "/api/admin/login", { token: "test-admin" }));
const S = withCookie(session);
await check("cizi Origin -> 403 (mutace, prihlaseni, odhlaseni)", async () => {
  eq((await adm("POST", "/api/admin/note", { email: "beta@firma.cz", body: "x" }, { ...S, Origin: "https://utocnik.example" })).status, 403, "note");
  eq((await adm("POST", "/api/admin/login", { token: "test-admin" }, { Origin: "https://utocnik.example" })).status, 403, "login");
  eq((await adm("POST", "/api/admin/logout", {}, { ...S, Origin: "null" })).status, 403, "logout");
});
await check("chybejici Origin nebo X-Requested-With -> 403", async () => {
  eq((await call("POST", "/api/admin/note", { email: "beta@firma.cz", body: "x" }, { ...S, "X-Requested-With": "x" })).status, 403, "bez Origin");
  eq((await call("POST", "/api/admin/note", { email: "beta@firma.cz", body: "x" }, { ...S, Origin: SITE })).status, 403, "bez XRW");
});
await check("Sec-Fetch-Site: cross-site -> 403 i pro GET", async () => {
  eq((await adm("GET", "/api/admin/summary", undefined, { ...S, "Sec-Fetch-Site": "cross-site" })).status, 403, "status");
});
await check("telo jinak nez JSON -> 415, prilis velke -> 413", async () => {
  eq((await adm("POST", "/api/admin/note", "email=beta@firma.cz", { ...S, "Content-Type": "text/plain" })).status, 415, "415");
  eq((await adm("POST", "/api/admin/note", { email: "beta@firma.cz", body: "x".repeat(20000) }, S)).status, 413, "413");
});
await check("stranka /sprava/: prisna CSP, X-Frame-Options DENY, no-store, noindex", async () => {
  const r = await call("GET", "/sprava/");
  const csp = r.headers.get("content-security-policy") || "";
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "script-src 'self'", "object-src 'none'"]) if (!csp.includes(d)) throw new Error("CSP: " + csp);
  if (csp.includes("unsafe")) throw new Error("unsafe v CSP");
  eq([r.headers.get("x-frame-options"), r.headers.get("cache-control"), r.headers.get("x-robots-tag")], ["DENY", "no-store", "noindex, nofollow"], "hlavicky");
  eq(assetHits.at(-1), "/sprava/", "ASSETS");
  const other = await call("GET", "/funkce/");
  eq(other.headers.get("content-security-policy"), null, "ostatni stranky beze zmeny");
});

console.log("\nsprava zakazniku: data");
await check("souhrn odpovida databazi", async () => {
  const r = await adm("GET", "/api/admin/summary", undefined, S);
  eq(r.status, 200, "status");
  const d = await r.json();
  const nowI = new Date().toISOString();
  eq(d.leads.total, count("SELECT COUNT(*) AS n FROM leads"), "leady");
  eq(d.leads.d30, count(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= '${new Date(Date.now() - 30 * 864e5).toISOString()}'`), "leady 30");
  eq(d.licenses.active_total, count(`SELECT COUNT(*) AS n FROM licenses WHERE status='active' AND valid_until >= '${nowI}'`), "aktivni");
  eq(d.licenses.canceled, count("SELECT COUNT(*) AS n FROM licenses WHERE status='canceled'"), "zrusene");
  eq(d.licenses.past_due, count("SELECT COUNT(*) AS n FROM licenses WHERE status='past_due'"), "po splatnosti");
  eq(d.activations, count("SELECT COUNT(*) AS n FROM activations WHERE revoked_at IS NULL"), "aktivace");
  eq(d.payments_30d, count("SELECT COUNT(*) AS n FROM payment_events"), "platby");
  if (!(d.licenses.active.pro >= 1)) throw new Error("rozpad podle tarifu " + JSON.stringify(d.licenses.active));
});
await check("seznam zakazniku = sjednoceni leads, licenses a unlocks, stav podle licence", async () => {
  const d = await (await adm("GET", "/api/admin/customers", undefined, S)).json();
  eq(d.total, count("SELECT COUNT(*) AS n FROM (SELECT email FROM leads UNION SELECT email FROM licenses UNION SELECT email FROM project_unlocks)"), "pocet");
  const beta = d.customers.find((c) => c.email === "beta@firma.cz");
  eq([beta.status, beta.plan, beta.devices], ["active", "pro", 1], "beta");
  eq(d.customers.find((c) => c.email === "maly@integrator.cz").status, "lead", "jen odemceni");
  eq(d.customers.find((c) => c.email === "integrator@firma.cz").status, "downloaded", "stahl");
  eq(d.customers.find((c) => c.email === "platil@firma.cz").status, "canceled", "zrusena");
});
await check("hledani podle e-mailu i casti klice, filtr stavu, LIKE bez zastupnych znaku", async () => {
  const q = async (qs) => await (await adm("GET", "/api/admin/customers?" + qs, undefined, S)).json();
  eq((await q("q=BETA@")).customers.map((c) => c.email), ["beta@firma.cz"], "e-mail");
  eq((await q("q=" + encodeURIComponent(licKey.slice(5, 14)))).customers.map((c) => c.email), ["beta@firma.cz"], "klic");
  const canceled = (await q("status=canceled")).customers;
  if (!canceled.length || canceled.some((c) => c.status !== "canceled")) throw new Error("filtr");
  eq((await q("q=%25")).total, 0, "% doslova");
  eq((await q("q=_")).total, 0, "_ doslova");
  eq((await q("status=" + encodeURIComponent("x' OR 1=1 --"))).total, (await q("")).total, "neznamy stav = vse");
});
await check("strankovani po 50", async () => {
  for (let i = 0; i < 55; i++) db.prepare("INSERT INTO leads (id, email, locale, created_at) VALUES (?, ?, 'cs', ?)").run("bulk" + i, `hromadny${i}@example.cz`, new Date(Date.now() - i * 1000).toISOString());
  const p1 = await (await adm("GET", "/api/admin/customers?q=hromadny", undefined, S)).json();
  const p2 = await (await adm("GET", "/api/admin/customers?q=hromadny&page=2", undefined, S)).json();
  eq([p1.total, p1.pages, p1.customers.length, p2.customers.length], [55, 2, 50, 5], "strany");
  if (p1.customers.some((c) => p2.customers.find((x) => x.email === c.email))) throw new Error("prekryv stran");
});
await check("detail zakaznika: lead, licence, pocitace (zkraceny otisk), platby, audit zobrazeni", async () => {
  const r = await adm("GET", "/api/admin/customer?email=Beta@Firma.cz", undefined, S);
  eq(r.status, 200, "status");
  const d = await r.json();
  eq(d.licenses.map((l) => l.key), [licKey], "licence");
  eq(d.activations.length, 1, "pocitace");
  if (d.activations[0].device_hash.length > 12) throw new Error("otisk nezkraceny");
  if (!auditRows("customer_view").some((a) => a.target === "beta@firma.cz")) throw new Error("audit");
  const p = await (await adm("GET", "/api/admin/customer?email=platil@firma.cz", undefined, S)).json();
  // (testovaci udalosti Stripe bez id se neeviduji - realne Stripe id posila vzdy)
  if (!p.payments.some((x) => x.type === "checkout.session.completed")) throw new Error("platby k zakaznikovi: " + JSON.stringify(p.payments));
  // subscription.canceled e-mail nenese - k zakaznikovi se priradi pres predplatne (sub_id -> licence)
  const z = await (await adm("GET", "/api/admin/customer?email=zakaznik@firma.eu", undefined, S)).json();
  const types = z.payments.map((x) => x.type);
  for (const ty of ["transaction.completed", "subscription.past_due", "subscription.canceled"]) if (!types.includes(ty)) throw new Error("Paddle platby: " + types);
});
await check("detail: neznamy e-mail -> 404, neplatny -> 400", async () => {
  eq((await adm("GET", "/api/admin/customer?email=nikdo@nikde.cz", undefined, S)).status, 404, "404");
  eq((await adm("GET", "/api/admin/customer?email=nesmysl", undefined, S)).status, 400, "400");
});

console.log("\nsprava zakazniku: licence, pocitace, poznamky");
let uiKey;
await check("vystaveni trial (vychozi 14 dni, 1 misto), podpis sedi, bez e-mailu, klic v auditu zkraceny", async () => {
  const before = sentMail.length;
  const r = await adm("POST", "/api/admin/license", { action: "issue", email: "Zkouska@Firma.cz", plan: "trial", note: "veletrh" }, S);
  eq(r.status, 200, "status");
  const d = await r.json();
  uiKey = d.key;
  eq([d.plan, d.seats, d.sent], ["trial", 1, false], "licence");
  const days = (Date.parse(d.valid_until) - Date.now()) / 864e5;
  if (days < 13.9 || days > 14.1) throw new Error("platnost " + d.valid_until);
  const [p, sg] = d.license.split(".");
  if (!verify(null, Buffer.from(p, "base64url"), createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(sg, "base64url"))) throw new Error("podpis");
  eq(JSON.parse(Buffer.from(p, "base64url")).email, "zkouska@firma.cz", "e-mail v licenci");
  eq(sentMail.length, before, "maily");
  const a = auditRows("license_issue").at(-1);
  if (a.target.includes(uiKey) || !a.target.includes(uiKey.slice(0, 9) + "…")) throw new Error("klic v auditu nezkraceny: " + a.target);
  eq(a.actor, "token", "kdo");
});
await check("vystaveni free-unlock s datem a firma (vychozi 5 mist)", async () => {
  const until = new Date(Date.now() + 100 * 864e5).toISOString().slice(0, 10);
  const r = await adm("POST", "/api/admin/license", { action: "issue", email: "skola@firma.cz", plan: "free-unlock", seats: 20, valid_until: until }, S);
  eq(r.status, 200, "status");
  eq((await r.json()).valid_until.slice(0, 10), until, "datum");
  const f = await (await adm("POST", "/api/admin/license", { action: "issue", email: "skola@firma.cz", plan: "firma" }, S)).json();
  eq(f.seats, 5, "firma = 5 mist");
});
await check("vystaveni s e-mailem posle licenci", async () => {
  const before = sentMail.length;
  const d = await (await adm("POST", "/api/admin/license", { action: "issue", email: "mail@firma.cz", plan: "pro", send: true }, S)).json();
  eq(sentMail.length, before + 1, "maily");
  if (!sentMail.at(-1).text.includes(d.key)) throw new Error("klic v mailu");
});
await check("bez LICENSE_PRIVATE_KEY se licence neulozi (500, zadny radek)", async () => {
  const before = count("SELECT COUNT(*) AS n FROM licenses");
  const err = console.error;
  console.error = () => {};
  try {
    eq((await adm("POST", "/api/admin/license", { action: "issue", email: "bezklice@firma.cz", plan: "pro" }, S, { ...env, LICENSE_PRIVATE_KEY: undefined })).status, 500, "status");
  } finally {
    console.error = err;
  }
  eq(count("SELECT COUNT(*) AS n FROM licenses"), before, "licence");
});
await check("selhani e-mailu licenci neztrati (200, mail_error, soubor v odpovedi)", async () => {
  const err = console.error;
  console.error = () => {};
  let d;
  try {
    d = await (await adm("POST", "/api/admin/license", { action: "issue", email: "mailfail@firma.cz", plan: "pro", send: true }, S, { ...env, RESEND_API_KEY: undefined })).json();
  } finally {
    console.error = err;
  }
  eq([d.ok, d.sent, d.mail_error, !!d.license], [true, false, true, true], "odpoved");
  eq(count("SELECT COUNT(*) AS n FROM licenses WHERE email = 'mailfail@firma.cz'"), 1, "licence");
});
await check("validace: tarif, mista, dny, datum, e-mail, akce", async () => {
  const bad = [
    { email: "a@firma.cz", plan: "enterprise" }, { email: "a@firma.cz", plan: "pro", seats: 0 }, { email: "a@firma.cz", plan: "pro", seats: 1.5 },
    { email: "a@firma.cz", plan: "pro", seats: 1000 }, { email: "a@firma.cz", plan: "pro", days: 99999 }, { email: "a@firma.cz", plan: "pro", days: -1 },
    { email: "a@firma.cz", plan: "pro", valid_until: "2020-01-01" }, { email: "a@firma.cz", plan: "pro", valid_until: "zitra" }, { email: "nesmysl", plan: "pro" },
    { action: "smazat", key: uiKey },
  ];
  for (const b of bad) eq((await adm("POST", "/api/admin/license", { action: "issue", ...b }, S)).status, 400, JSON.stringify(b));
});
await check("prodlouzeni: od konce platnosti, novy podepsany soubor s novym exp", async () => {
  const old = db.prepare("SELECT valid_until FROM licenses WHERE key = ?").get(uiKey).valid_until;
  const d = await (await adm("POST", "/api/admin/license", { action: "extend", key: uiKey, days: 30 }, S)).json();
  const diff = (Date.parse(d.valid_until) - Date.parse(old)) / 864e5;
  if (Math.abs(diff - 30) > 0.01) throw new Error("prodlouzeni o " + diff);
  eq(JSON.parse(Buffer.from(d.license.split(".")[0], "base64url")).exp, d.valid_until, "exp v souboru");
  eq(db.prepare("SELECT valid_until FROM licenses WHERE key = ?").get(uiKey).valid_until, d.valid_until, "D1");
});
await check("prodlouzeni / zruseni: neplatny a neznamy klic", async () => {
  eq((await adm("POST", "/api/admin/license", { action: "extend", key: "nesmysl", days: 30 }, S)).status, 400, "tvar");
  eq((await adm("POST", "/api/admin/license", { action: "cancel", key: "PLCD-AAAA-BBBB-CCCC-DDDD" }, S)).status, 404, "neznamy");
});
await check("zruseni: licence se zamkne, prodlouzit uz nejde (409), opakovani je neskodne", async () => {
  eq((await adm("POST", "/api/admin/license", { action: "cancel", key: uiKey }, S)).status, 200, "zruseni");
  eq((await call("POST", "/api/license/activate", { key: uiKey, device_hash: "pc-x" })).status, 403, "aktivace");
  eq((await adm("POST", "/api/admin/license", { action: "extend", key: uiKey, days: 30 }, S)).status, 409, "prodlouzeni");
  eq((await (await adm("POST", "/api/admin/license", { action: "cancel", key: uiKey }, S)).json()).already, true, "opakovani");
});
await check("zruseni licence s predplatnym upozorni, ze predplatne bezi dal", async () => {
  const key = db.prepare("SELECT key FROM licenses WHERE sub_id = 'sub_pdl_2'").get().key;
  const d = await (await adm("POST", "/api/admin/license", { action: "cancel", key }, S)).json();
  eq(d.subscription_provider, "paddle", "poskytovatel");
});
await check("skripty: Authorization: Bearer i X-Admin-Token bez cookie a Origin, jen vystaveni", async () => {
  const r = await call("POST", "/api/admin/license", { email: "skript@firma.cz", plan: "firma", send: false }, { Authorization: "Bearer test-admin", "CF-Connecting-IP": "198.51.100.200" });
  eq(r.status, 200, "Bearer");
  const d = await r.json();
  eq([d.plan, d.seats], ["firma", 1], "puvodni chovani (mista z tela, vychozi 1)");
  eq(auditRows("license_issue").at(-1).actor, "token-api", "audit");
  eq((await call("POST", "/api/admin/license", { action: "cancel", key: d.key }, { "X-Admin-Token": "test-admin", "CF-Connecting-IP": "198.51.100.200" })).status, 400, "jen vystaveni");
});
await check("uvolneni pocitace: misto se uvolni pro jiny pocitac", async () => {
  eq((await call("POST", "/api/license/activate", { key: licKey, device_hash: "stroj-B" })).status, 409, "plno");
  const id = db.prepare("SELECT id FROM activations WHERE license_key = ? AND device_hash = 'stroj-A'").get(licKey).id;
  eq((await adm("POST", "/api/admin/activation/release", { id }, S)).status, 200, "uvolneni");
  if (!db.prepare("SELECT revoked_at FROM activations WHERE id = ?").get(id).revoked_at) throw new Error("revoked_at");
  eq((await (await adm("POST", "/api/admin/activation/release", { id }, S)).json()).already, true, "opakovani");
  eq((await call("POST", "/api/license/activate", { key: licKey, device_hash: "stroj-B" })).status, 200, "jiny pocitac");
  eq((await adm("POST", "/api/admin/activation/release", { id: "neexistuje" }, S)).status, 404, "neznama");
  eq((await adm("POST", "/api/admin/activation/release", { id: "a'; DROP TABLE activations; --" }, S)).status, 400, "tvar");
});
await check("poznamka: ulozi se s autorem, detail ji ukaze; validace", async () => {
  const r = await adm("POST", "/api/admin/note", { email: "beta@firma.cz", body: "Faktura na nákup; <script>alert(1)</script>" }, S);
  eq(r.status, 200, "status");
  const d = await (await adm("GET", "/api/admin/customer?email=beta@firma.cz", undefined, S)).json();
  eq([d.notes[0].body.startsWith("Faktura"), d.notes[0].author], [true, "token"], "poznamka");
  eq((await adm("POST", "/api/admin/note", { email: "beta@firma.cz", body: "   " }, S)).status, 400, "prazdna");
  eq((await adm("POST", "/api/admin/note", { email: "beta@firma.cz", body: "x".repeat(2001) }, S)).status, 400, "dlouha");
  eq((await adm("POST", "/api/admin/note", { email: "nikdo@nikde.cz", body: "x" }, S)).status, 404, "neznamy zakaznik");
});
await check("mutace pres Access: v auditu je e-mail", async () => {
  _resetAccessCache();
  const r = await viaAccess(jwt(), "POST", "/api/admin/note", { email: "beta@firma.cz", body: "pres Access" });
  eq(r.status, 200, "status");
  const a = auditRows("note_add").at(-1);
  eq([a.actor, a.via], ["boss@firma.cz", "access"], "audit");
});

console.log("\nsprava zakazniku: export a audit");
await check("export zakazniku: BOM, strednik, CRLF, hlavicky ke stazeni", async () => {
  const r = await adm("GET", "/api/admin/export.csv?type=customers", undefined, S);
  eq(r.status, 200, "status");
  eq(r.headers.get("content-type"), "text/csv; charset=utf-8", "typ");
  if (!/attachment; filename="plcdesk-customers-\d{4}-\d{2}-\d{2}\.csv"/.test(r.headers.get("content-disposition"))) throw new Error("disposition");
  eq(r.headers.get("cache-control"), "no-store", "cache");
  const buf = Buffer.from(await r.arrayBuffer());
  eq([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM");
  const lines = buf.toString("utf8").slice(1).split("\r\n");
  eq(lines[0], "email;status;plan;licenses;devices;valid_until;lead_at;downloaded_at;locale;last_activity", "hlavicka");
  eq(lines.at(-1), "", "konec CRLF");
  eq(lines.length - 2, count("SELECT COUNT(*) AS n FROM (SELECT email FROM leads UNION SELECT email FROM licenses UNION SELECT email FROM project_unlocks)"), "radky");
  if (!lines.some((l) => l.startsWith("beta@firma.cz;active;pro;"))) throw new Error("radek beta");
});
await check("export: vzorce Excelu neutralizovane, strednik a uvozovky v uvozovkach", async () => {
  db.prepare("INSERT INTO leads (id, email, locale, source, created_at) VALUES ('evil', 'evil@example.cz', 'cs', ?, ?)").run('=HYPERLINK("http://x";"y")', new Date().toISOString());
  const text = Buffer.from(await (await adm("GET", "/api/admin/export.csv?type=leads", undefined, S)).arrayBuffer()).toString("utf8");
  const line = text.split("\r\n").find((l) => l.startsWith("evil@example.cz;"));
  if (!line.includes(`"'=HYPERLINK(""http://x"";""y"")"`)) throw new Error(line);
});
await check("export licenci obsahuje klice a pocet aktivnich pocitacu; neznamy typ -> 400", async () => {
  const text = Buffer.from(await (await adm("GET", "/api/admin/export.csv?type=licenses", undefined, S)).arrayBuffer()).toString("utf8");
  if (!text.split("\r\n")[0].replace(/^﻿/, "").startsWith("key;email;plan;seats;status")) throw new Error("hlavicka");
  if (!text.includes(licKey)) throw new Error("klic");
  eq((await adm("GET", "/api/admin/export.csv?type=hesla", undefined, S)).status, 400, "typ");
  eq(auditRows("export").length, 3, "audit exportu");
});
await check("audit: nejnovejsi prvni, hledani, bez celych klicu a tokenu", async () => {
  const d = await (await adm("GET", "/api/admin/audit", undefined, S)).json();
  eq(d.total, count("SELECT COUNT(*) AS n FROM admin_audit"), "pocet");
  if (d.entries[0].id < d.entries[1].id) throw new Error("poradi");
  const f = await (await adm("GET", "/api/admin/audit?q=login_failed", undefined, S)).json();
  if (!f.entries.length || f.entries.some((e) => e.action !== "login_failed")) throw new Error("hledani");
  const full = JSON.stringify(db.prepare("SELECT * FROM admin_audit").all());
  for (const k of db.prepare("SELECT key FROM licenses").all().map((r) => r.key)) if (full.includes(k)) throw new Error("cely klic v auditu " + k);
  if (full.includes("test-admin")) throw new Error("token v auditu");
});

await check("uchovani: neuspesna prihlaseni po 30 dnech pryc, ostatni audit 3 roky", async () => {
  const old = new Date(Date.now() - 40 * 864e5).toISOString();
  db.prepare("INSERT INTO admin_audit (at, actor, via, action, ip) VALUES (?, '-', '-', 'login_failed', '192.0.2.99')").run(old);
  db.prepare("INSERT INTO admin_audit (at, actor, via, action, target) VALUES (?, 'token', 'token', 'note_add', 'stary@firma.cz')").run(old);
  db.prepare("INSERT INTO admin_attempts (ip, ok, at) VALUES ('192.0.2.99', 0, ?)").run(old);
  await adm("POST", "/api/admin/login", { token: "spatne" }, { "CF-Connecting-IP": "192.0.2.98" });
  eq(count("SELECT COUNT(*) AS n FROM admin_audit WHERE ip = '192.0.2.99'"), 0, "stary login_failed");
  eq(count("SELECT COUNT(*) AS n FROM admin_attempts WHERE ip = '192.0.2.99'"), 0, "stary pokus");
  eq(count("SELECT COUNT(*) AS n FROM admin_audit WHERE target = 'stary@firma.cz'"), 1, "ostatni audit zustava");
});

// Cloudflare: s run_worker_first jako seznamem dostane Worker JEN uvedené cesty — bez "/api/*"
// skončí celé API stránkou 404 z assets (lokální serve.js to neodhalí, výpadek 2026-10-04).
await check("wrangler.toml: run_worker_first obsahuje /api/* i /sprava", async () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const m = /^run_worker_first\s*=\s*(\[[^\]]*\]|true|false)/m.exec(toml);
  if (!m) return;                                   // bez volby = výchozí chování, API jde do Workeru
  if (m[1] === "true") return;
  const list = JSON.parse(m[1]);
  for (const p of ["/api/*", "/sprava", "/sprava/*"]) if (!list.includes(p)) throw new Error("chybi " + p);
});

console.log(`\n${pass} proslo, ${fail} selhalo`);
process.exit(fail ? 1 : 0);
