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
// schema.sql + migrace spravy zakazniku (schema_admin.sql) a beta testeru (schema_beta.sql) - stejne poradi jako pri nasazeni
for (const f of ["../schema.sql", "../schema_admin.sql", "../schema_beta.sql"]) {
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

await check("io_count jen cele cislo: text do mailu ani DB neprojde", async () => {
  const r = await call("POST", "/api/unlock", { email: "spam@integrator.cz", project_id: "p-3", io_count: "64) Navstivte http://zly.example (", turnstile: "human" });
  eq(r.status, 200, "status");
  if (/zly\.example/.test(sentMail.at(-1).text)) throw new Error("text z io_count v mailu");
  eq(count("SELECT COUNT(*) AS n FROM project_unlocks WHERE email = 'spam@integrator.cz' AND io_count IS NULL"), 1, "io_count null");
});
await check("verejne API nese bezpecnostni hlavicky (nosniff, DENY, CSP, HSTS)", async () => {
  const r = await call("GET", "/api/config");
  for (const h of ["x-content-type-options", "x-frame-options", "content-security-policy", "strict-transport-security"]) if (!r.headers.get(h)) throw new Error("chybi " + h);
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
await check("souběžná dávka 12 pokusů z jedné IP: nejvýš 5 se ověří (401), zbytek 429", async () => {
  const ip = { "CF-Connecting-IP": "203.0.113.77" };
  const st = (await Promise.all(Array.from({ length: 12 }, (_, i) => adm("POST", "/api/admin/login", { token: "par" + i }, ip)))).map(r => r.status);
  const n401 = st.filter(s => s === 401).length;
  if (n401 > 5 || n401 + st.filter(s => s === 429).length !== 12) throw new Error("stavy " + st.join(","));
  eq((await adm("POST", "/api/admin/login", { token: "test-admin" }, ip)).status, 429, "pak i spravny token");
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
    ["POST", "/api/admin/license"], ["POST", "/api/admin/activation/release"], ["POST", "/api/admin/note"], ["GET", "/api/admin/export.csv?type=customers"], ["GET", "/api/admin/audit"],
    ["GET", "/api/admin/crm"], ["GET", "/api/admin/crm/lead?id=x"], ["POST", "/api/admin/crm/lead"], ["POST", "/api/admin/crm/move"],
    ["POST", "/api/admin/crm/note"], ["POST", "/api/admin/crm/delete"], ["POST", "/api/admin/crm/import"], ["GET", "/api/admin/crm/export.csv"],
    ["GET", "/api/admin/docs"], ["GET", "/api/admin/doc?slug=plan"], ["POST", "/api/admin/doc"], ["POST", "/api/admin/doc/task"],
    ["GET", "/api/admin/beta"], ["GET", "/api/admin/beta/app?id=x"], ["POST", "/api/admin/beta"], ["POST", "/api/admin/beta/crm"]];
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

// =====================================================================================
console.log("\nsprava: obchodni kanban leadu (CRM)");
const crmGet = async (qs = "") => (await adm("GET", "/api/admin/crm" + qs, undefined, S)).json();
const crmCards = (d) => Object.values(d.columns).flatMap((c) => c.cards);
const crmLead = (id) => db.prepare("SELECT * FROM crm_leads WHERE id = ?").get(id);
const crmEvents = (id) => db.prepare("SELECT type, text, actor FROM crm_events WHERE lead_id = ? ORDER BY id").all(id);
const isoIn = (days) => new Date(Date.now() + days * 864e5).toISOString();
// zakaznik s aktivni licenci -> karta z formulare dostane navrh "won"
db.prepare("INSERT INTO leads (id, email, locale, created_at) VALUES ('crm-l1', 'nakup@strojirna-test.cz', 'cs', ?)").run(isoIn(-3));
db.prepare(`INSERT INTO licenses (key, email, plan, seats, status, valid_until, created_at, updated_at)
  VALUES ('PLCD-CRMT-AAAA-BBBB-CC22', 'nakup@strojirna-test.cz', 'pro', 1, 'active', ?, ?, ?)`).run(isoIn(200), isoIn(-1), isoIn(-1));

let crmManual;
await check("tabule: sloupce vsech fazi, web leady se promitnou jako 'new' (bez duplicit), sync do auditu", async () => {
  const leads = count("SELECT COUNT(*) AS n FROM leads");
  const d = await crmGet();
  eq(d.stages, ["prospect", "new", "contacted", "trial", "offer", "won", "lost"], "faze");
  eq(d.synced, leads, "synchronizovano");
  eq(count("SELECT COUNT(*) AS n FROM crm_leads WHERE source = 'web_form' AND stage = 'new'"), leads, "karty new");
  eq(count("SELECT COUNT(*) AS n FROM crm_events WHERE type = 'import' AND text = 'web_form'"), leads, "udalosti");
  eq(auditRows("crm_sync").length, 1, "audit sync");
  const again = await crmGet();
  eq(again.synced, 0, "druhe nacteni nic nepridava");
  eq(count("SELECT COUNT(*) AS n FROM crm_leads"), leads, "bez duplicit");
  eq(auditRows("crm_sync").length, 1, "audit jen pri zmene");
});
await check("karta z formulare: firma = domena, web, zeme z .cz; bezplatna schranka bez webu", async () => {
  const c = db.prepare("SELECT * FROM crm_leads WHERE email = 'nakup@strojirna-test.cz'").get();
  eq([c.company, c.website, c.domain, c.country, c.segment], ["strojirna-test.cz", "https://strojirna-test.cz", "strojirna-test.cz", "CZ", "jine"], "firma");
  db.prepare("INSERT INTO leads (id, email, locale, created_at) VALUES ('crm-l2', 'jan.novak@gmail.com', 'cs', ?)").run(isoIn(0));
  eq((await crmGet()).synced, 1, "novy lead");
  const g = db.prepare("SELECT * FROM crm_leads WHERE email = 'jan.novak@gmail.com'").get();
  eq([g.company, g.website, g.domain, g.country], ["jan.novak@gmail.com", null, null, null], "gmail");
});
await check("aktivni licence -> navrh 'won', faze se sama neprepise", async () => {
  const d = await crmGet();
  const card = crmCards(d).find((c) => c.company === "strojirna-test.cz");
  eq([card.stage, card.licensed, card.suggest], ["new", true, "won"], "navrh");
  if ("email" in card) throw new Error("tabule nema posilat e-maily");
});
await check("zalozeni karty: validace, faze new, udalost create, audit", async () => {
  eq((await adm("POST", "/api/admin/crm/lead", { segment: "integrator" }, S)).status, 400, "bez firmy");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", website: "javascript:alert(1)" }, S)).json()).error, "bad website", "javascript: web");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", source_url: "ftp://x.cz/a" }, S)).json()).error, "bad source_url", "ftp zdroj");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", segment: "banka" }, S)).json()).error, "bad segment", "segment");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", next_date: "2026-02-30" }, S)).json()).error, "bad next_date", "datum");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", stage: "hotovo" }, S)).json()).error, "bad stage", "faze");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", value_czk: -5 }, S)).json()).error, "bad value_czk", "hodnota");
  eq((await (await adm("POST", "/api/admin/crm/lead", { company: "X", phone: "<script>" }, S)).json()).error, "bad phone", "telefon");
  const r = await adm("POST", "/api/admin/crm/lead", { company: "  Automatizace Test s.r.o. ", website: "www.AutoTest.cz/kontakt", segment: "Integrátor",
    country: "cz", city: "Brno", next_action: "Zavolat", next_date: "2026-11-02", value_czk: 120000, contact_name: "Ing. Test" }, S);
  eq(r.status, 200, "status");
  crmManual = (await r.json()).id;
  const c = crmLead(crmManual);
  eq([c.company, c.website, c.domain, c.segment, c.country, c.stage, c.source, c.value_czk], ["Automatizace Test s.r.o.", "https://www.autotest.cz/kontakt", "autotest.cz", "integrator", "CZ", "new", "manual", 120000], "ulozeno");
  eq(crmEvents(crmManual).map((e) => e.type), ["create"], "udalost");
  eq(auditRows("crm_lead_create").length, 1, "audit");
});
await check("duplicita: stejny e-mail vzdy 409, stejna domena 409 bez allow_duplicate", async () => {
  const dupMail = await adm("POST", "/api/admin/crm/lead", { company: "Jina", email: "NAKUP@strojirna-test.cz", allow_duplicate: true }, S);
  eq(dupMail.status, 409, "e-mail");
  eq((await dupMail.json()).by, "email", "duvod");
  const dupDom = await adm("POST", "/api/admin/crm/lead", { company: "Pobocka", website: "https://autotest.cz" }, S);
  eq(dupDom.status, 409, "domena");
  eq((await dupDom.json()).id, crmManual, "odkaz na existujici");
  const ok = await adm("POST", "/api/admin/crm/lead", { company: "Pobocka", website: "https://autotest.cz", allow_duplicate: true }, S);
  eq(ok.status, 200, "s potvrzenim");
  eq((await adm("POST", "/api/admin/crm/delete", { id: (await ok.json()).id }, S)).status, 200, "uklid");
});
await check("uprava: jen poslana pole, udalost edit se seznamem poli, faze se upravou nemeni", async () => {
  const r = await adm("POST", "/api/admin/crm/lead", { id: crmManual, city: "Ostrava", owner: "Tomáš", stage: "won" }, S);
  eq(r.status, 200, "status");
  eq((await r.json()).changed, ["city", "owner"], "zmenena pole");
  const c = crmLead(crmManual);
  eq([c.city, c.owner, c.stage, c.website], ["Ostrava", "Tomáš", "new", "https://www.autotest.cz/kontakt"], "ulozeno");
  eq(crmEvents(crmManual).at(-1), { type: "edit", text: "city,owner", actor: "token" }, "udalost");
  eq((await (await adm("POST", "/api/admin/crm/lead", { id: crmManual, city: "Ostrava" }, S)).json()).unchanged, true, "beze zmeny");
  eq((await adm("POST", "/api/admin/crm/lead", { id: "neexistuje-1", city: "X" }, S)).status, 404, "neznama karta");
  eq((await adm("POST", "/api/admin/crm/lead", { id: "../x", city: "X" }, S)).status, 400, "spatne id");
});
await check("presun: zmena faze + udalost stage_change, ztraceno s duvodem, neplatna faze 400", async () => {
  const r = await adm("POST", "/api/admin/crm/move", { id: crmManual, stage: "contacted" }, S);
  eq(await r.json(), { ok: true, stage: "contacted", from: "new" }, "odpoved");
  eq((await (await adm("POST", "/api/admin/crm/move", { id: crmManual, stage: "contacted" }, S)).json()).already, true, "uz tam je");
  eq((await adm("POST", "/api/admin/crm/move", { id: crmManual, stage: "zruseno" }, S)).status, 400, "faze");
  await adm("POST", "/api/admin/crm/move", { id: crmManual, stage: "lost", lost_reason: "Ma vlastni reseni" }, S);
  eq([crmLead(crmManual).stage, crmLead(crmManual).lost_reason], ["lost", "Ma vlastni reseni"], "ztraceno");
  await adm("POST", "/api/admin/crm/move", { id: crmManual, stage: "trial" }, S);
  eq(crmLead(crmManual).lost_reason, null, "duvod pri navratu pryc");
  eq(crmEvents(crmManual).filter((e) => e.type === "stage_change").map((e) => e.text), ["new>contacted", "contacted>lost\nMa vlastni reseni", "lost>trial"], "historie");
  eq(auditRows("crm_move").length, 3, "audit");
  const d = await crmGet();
  eq(d.columns.trial.count, 1, "pocet ve sloupci");
  eq(d.columns.trial.value_czk, 120000, "soucet ve sloupci");
});
await check("poznamka a kontakt: udalost, prazdna / dlouha / spatny typ 400", async () => {
  eq((await adm("POST", "/api/admin/crm/note", { id: crmManual, text: "Volal jsem, poslat nabidku" , type: "contact" }, S)).status, 200, "kontakt");
  eq((await adm("POST", "/api/admin/crm/note", { id: crmManual, text: "Radek 1\nRadek 2" }, S)).status, 200, "poznamka");
  eq((await adm("POST", "/api/admin/crm/note", { id: crmManual, text: "  " }, S)).status, 400, "prazdna");
  eq((await adm("POST", "/api/admin/crm/note", { id: crmManual, text: "x".repeat(2001) }, S)).status, 400, "dlouha");
  eq((await adm("POST", "/api/admin/crm/note", { id: crmManual, text: "x", type: "sms" }, S)).status, 400, "typ");
  eq(crmEvents(crmManual).slice(-2).map((e) => [e.type, e.text]), [["contact", "Volal jsem, poslat nabidku"], ["note", "Radek 1\nRadek 2"]], "udalosti");
});
await check("detail: karta, historie nejnovejsi prvni, priznak zakaznika, zobrazeni do auditu", async () => {
  const w = db.prepare("SELECT id FROM crm_leads WHERE email = 'nakup@strojirna-test.cz'").get().id;
  const d = await (await adm("GET", "/api/admin/crm/lead?id=" + w, undefined, S)).json();
  eq([d.lead.email, d.customer, d.licensed, d.suggest], ["nakup@strojirna-test.cz", true, true, "won"], "zakaznik");
  const m = await (await adm("GET", "/api/admin/crm/lead?id=" + crmManual, undefined, S)).json();
  eq([m.customer, m.events[0].type, m.events.at(-1).type], [false, "note", "create"], "historie");
  eq(auditRows("crm_view").length, 2, "audit");
  eq((await adm("GET", "/api/admin/crm/lead?id=nic", undefined, S)).status, 404, "404");
});
await check("filtr: segment, zeme, hledani (LIKE se escapuje)", async () => {
  eq(crmCards(await crmGet("?segment=integrator")).map((c) => c.id), [crmManual], "segment");
  eq(crmCards(await crmGet("?country=CZ")).some((c) => c.id === crmManual), true, "zeme");
  eq(crmCards(await crmGet("?q=ostrava")).map((c) => c.id), [crmManual], "mesto");
  eq(crmCards(await crmGet("?q=%25")).length, 0, "procento neni zastupny znak");
  eq((await crmGet("?segment=banka")).filter.segment, "", "neznamy segment ignorovan");
});

const research = [
  { company: "Alfa Automation s.r.o.", website: "https://www.alfa-automation.cz/", segment: "integrátor", country: "CZ", city: "Zlín", source_url: "https://firmy.example.cz/alfa", contact_name: "Jan Alfa", phone: "+420 600 000 000" },
  { company: "Beta Maschinenbau GmbH", website: "beta-maschinenbau.de", segment: "Maschinenbau", country: "Deutschland", city: "Dresden" },
  { company: "Alfa (duplicita v souboru)", website: "http://alfa-automation.cz/kontakt" },
  { company: "Autotest pobocka", website: "autotest.cz" },
  { company: "Gama", email: "NAKUP@strojirna-test.cz" },
  { company: "", website: "x.cz" },
  { company: "Delta", website: "javascript:alert(1)" },
  "neni objekt",
  { company: "Epsilon CNC", website: "epsilon-cnc.sk", note: "Hledaji PLC pro linku", segment: "výrobce" },
];
await check("import nahled (dry_run): pocty novych, duplicit (DB i soubor), chyb, osobni udaje; nic se neulozi", async () => {
  const before = count("SELECT COUNT(*) AS n FROM crm_leads");
  const d = await (await adm("POST", "/api/admin/crm/import", { leads: research, dry_run: true }, S)).json();
  eq([d.total, d.new, d.duplicates, d.invalid, d.personal_ignored, d.imported], [9, 3, 3, 3, 1, 0], "pocty");
  eq(d.duplicate_rows.map((x) => [x.row, x.by]), [[3, "file"], [4, "domain"], [5, "email"]], "duplicity");
  eq(d.invalid_rows.map((x) => [x.row, x.error]), [[6, "bad company"], [7, "bad website"], [8, "bad row"]], "chyby");
  eq(count("SELECT COUNT(*) AS n FROM crm_leads"), before, "nic neulozeno");
  eq(auditRows("crm_import").length, 0, "nahled se neaudituje");
});
await check("import: faze prospect, source research, bez jmena a telefonu, udalost import, audit", async () => {
  const d = await (await adm("POST", "/api/admin/crm/import", { leads: research }, S)).json();
  eq([d.imported, d.new, d.duplicates], [3, 3, 3], "pocty");
  const a = db.prepare("SELECT * FROM crm_leads WHERE domain = 'alfa-automation.cz'").get();
  eq([a.stage, a.source, a.segment, a.city, a.country, a.contact_name, a.phone, a.email, a.source_url],
    ["prospect", "research", "integrator", "Zlín", "CZ", null, null, null, "https://firmy.example.cz/alfa"], "karta");
  const b = db.prepare("SELECT * FROM crm_leads WHERE domain = 'beta-maschinenbau.de'").get();
  eq([b.segment, b.country, b.website], ["strojirna", "DE", "https://beta-maschinenbau.de"], "aliasy");
  const e = db.prepare("SELECT * FROM crm_leads WHERE domain = 'epsilon-cnc.sk'").get();
  eq([e.segment, e.country, e.value_note], ["vyrobce", "SK", "Hledaji PLC pro linku"], "zeme z domeny, poznamka");
  eq(crmEvents(a.id).map((x) => [x.type, x.text]), [["import", "research"]], "udalost");
  eq(auditRows("crm_import").length, 1, "audit");
  const again = await (await adm("POST", "/api/admin/crm/import", { leads: research }, S)).json();
  eq([again.imported, again.new, again.duplicates], [0, 0, 6], "opakovany import = same duplicity");
});
await check("import: limit 500 radku, prazdny seznam, ne-JSON, velke telo", async () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ company: `Firma ${i}`, website: `firma${i}.cz` }));
  const r = await adm("POST", "/api/admin/crm/import", { leads: many, dry_run: true }, S);
  eq([r.status, (await r.json()).error], [400, "too many"], "501");
  const ok500 = await (await adm("POST", "/api/admin/crm/import", { leads: many.slice(0, 500), dry_run: true }, S)).json();
  eq(ok500.new, 500, "500 projde");
  eq((await adm("POST", "/api/admin/crm/import", { leads: [] }, S)).status, 400, "prazdny");
  eq((await adm("POST", "/api/admin/crm/import", { leads: "x" }, S)).status, 400, "ne pole");
  eq((await adm("POST", "/api/admin/crm/import", "[{}]", S)).status, 400, "pole misto objektu");
  eq((await adm("POST", "/api/admin/crm/import", { leads: [{ company: "x".repeat(800 * 1024) }] }, S)).status, 413, "telo");
});
await check("CSRF: mutace CRM bez Origin / X-Requested-With / s cizim Origin -> 403, nic se nezmeni", async () => {
  const before = crmLead(crmManual).stage;
  eq((await adm("POST", "/api/admin/crm/move", { id: crmManual, stage: "won" }, { ...S, Origin: "https://utocnik.example" })).status, 403, "cizi Origin");
  eq((await call("POST", "/api/admin/crm/move", { id: crmManual, stage: "won" }, { ...S, Origin: SITE })).status, 403, "bez XRW");
  eq((await call("POST", "/api/admin/crm/import", { leads: research }, { ...S, "X-Requested-With": "x" })).status, 403, "bez Origin");
  eq((await adm("POST", "/api/admin/crm/lead", { company: "CSRF" }, { ...S, "Sec-Fetch-Site": "cross-site" })).status, 403, "cross-site");
  eq((await adm("POST", "/api/admin/crm/note", "id=x", { ...S, "Content-Type": "text/plain" })).status, 415, "formular");
  eq(crmLead(crmManual).stage, before, "faze beze zmeny");
  eq(count("SELECT COUNT(*) AS n FROM crm_leads WHERE company = 'CSRF'"), 0, "nic nezalozeno");
});
await check("export CSV: hlavicka, BOM, ochrana proti vzorcum, no-store, audit", async () => {
  await adm("POST", "/api/admin/crm/lead", { company: "=HYPERLINK(\"http://x\")", website: "vzorec-test.cz" }, S);
  const r = await adm("GET", "/api/admin/crm/export.csv", undefined, S);
  eq([r.status, r.headers.get("cache-control"), r.headers.get("content-type")], [200, "no-store", "text/csv; charset=utf-8"], "hlavicky");
  if (!/attachment; filename="plcdesk-leady-\d{4}-\d{2}-\d{2}\.csv"/.test(r.headers.get("content-disposition"))) throw new Error("nazev souboru");
  const text = Buffer.from(await r.arrayBuffer()).toString("utf8");
  if (!text.startsWith("﻿id;company;segment;country;city;website;email")) throw new Error("hlavicka CSV");
  if (!text.includes(`"'=HYPERLINK(""http://x"")"`)) throw new Error("vzorec neosetren");
  eq(text.trim().split("\r\n").length - 1, count("SELECT COUNT(*) AS n FROM crm_leads"), "radky");
  eq(db.prepare("SELECT * FROM admin_audit WHERE action = 'export' AND target = 'crm'").all().length, 1, "audit");
});
await check("smazani (namitka): karta i historie pryc, e-mail se synchronizaci nevrati", async () => {
  const g = db.prepare("SELECT id FROM crm_leads WHERE email = 'jan.novak@gmail.com'").get().id;
  eq((await adm("POST", "/api/admin/crm/delete", { id: g }, S)).status, 200, "smazano");
  eq([crmLead(g) ?? null, crmEvents(g).length], [null, 0], "karta a historie");
  eq((await crmGet()).synced, 0, "nevraci se");
  eq(count("SELECT COUNT(*) AS n FROM crm_leads WHERE email = 'jan.novak@gmail.com'"), 0, "bez karty");
  eq((await adm("POST", "/api/admin/crm/delete", { id: g }, S)).status, 404, "podruhe 404");
  eq(auditRows("crm_delete").length, 2, "audit");
});
await check("audit CRM: bez kontaktnich udaju a obsahu poznamek, 401 bez relace i s podvrzenou cookie", async () => {
  const rows = JSON.stringify(db.prepare("SELECT target, detail FROM admin_audit WHERE action LIKE 'crm_%'").all());
  for (const s of ["Ing. Test", "Volal jsem", "Radek 1"]) if (rows.includes(s)) throw new Error("v auditu: " + s);
  eq((await adm("GET", "/api/admin/crm", undefined, withCookie("v1.9999999999.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))).status, 401, "podvrh");
  eq((await adm("POST", "/api/admin/crm/import", { leads: research })).status, 401, "bez cookie");
});

// =====================================================================================
console.log("\nsprava: interni dokumenty (obsah jen v D1)");
const D = withCookie(cookieOf(await adm("POST", "/api/admin/login", { token: "test-admin" })));
const docRow = (slug) => db.prepare("SELECT * FROM admin_docs WHERE slug = ?").get(slug);
const DOC_MD = [
  "# Plan",
  "- [ ] prvni ukol",
  "- [x] druhy ukol",
  "```",
  "- [ ] v bloku kodu se nepocita",
  "```",
  "  * [ ] vnoreny ukol",
  "> - [ ] v citaci se nepocita",
  "1. [ ] cislovany se nepocita",
  "+ [X] posledni",
].join("\n");
await check("dokumenty bez prihlaseni -> 401 (seznam, cteni, ulozeni, ukol)", async () => {
  eq((await adm("GET", "/api/admin/docs")).status, 401, "seznam");
  eq((await adm("GET", "/api/admin/doc?slug=plan")).status, 401, "cteni");
  eq((await adm("POST", "/api/admin/doc", { slug: "plan", title: "x", body: "x", version: 0 })).status, 401, "ulozeni");
  eq((await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 0, done: true, version: 1 })).status, 401, "ukol");
  eq(count("SELECT COUNT(*) AS n FROM admin_docs"), 0, "nic");
});
await check("zalozeni, cteni, seznam (bez tela), CRLF -> LF", async () => {
  const r = await adm("POST", "/api/admin/doc", { slug: "plan", title: "Plan kampane", body: DOC_MD.replace(/\n/g, "\r\n"), version: 0 }, D);
  eq(r.status, 200, "status");
  const d = await r.json();
  eq([d.created, d.version, d.updated_by], [true, 1, "token"], "zalozeno");
  const g = await (await adm("GET", "/api/admin/doc?slug=plan", undefined, D)).json();
  eq([g.doc.title, g.doc.body, g.doc.version], ["Plan kampane", DOC_MD, 1], "dokument");
  const l = await (await adm("GET", "/api/admin/docs", undefined, D)).json();
  eq(l.docs.map((x) => [x.slug, x.title, x.updated_by, x.size]), [["plan", "Plan kampane", "token", Buffer.byteLength(DOC_MD)]], "seznam");
  if ("body" in l.docs[0]) throw new Error("seznam nese telo");
  eq((await adm("GET", "/api/admin/doc?slug=neni", undefined, D)).status, 404, "neexistuje");
  const again = await adm("POST", "/api/admin/doc", { slug: "plan", title: "Jiny", body: "prepis", version: 0 }, D);
  eq([again.status, (await again.json()).error], [409, "exists"], "zalozeni existujiciho");
  eq(docRow("plan").body, DOC_MD, "neprepsano");
});
await check("ulozeni se spravnou verzi -> verze +1, se starou -> 409 s aktualni verzi, nic se neprepise", async () => {
  const body2 = DOC_MD + "\nDalsi odstavec.";
  const r = await (await adm("POST", "/api/admin/doc", { slug: "plan", title: "Plan kampane", body: body2, version: 1 }, D)).json();
  eq([r.ok, r.version], [true, 2], "ulozeno");
  const stale = await adm("POST", "/api/admin/doc", { slug: "plan", title: "Plan kampane", body: "stara verze", version: 1 }, D);
  eq(stale.status, 409, "konflikt");
  const c = await stale.json();
  eq([c.error, c.version, c.updated_by], ["conflict", 2, "token"], "aktualni verze");
  eq([docRow("plan").body, docRow("plan").version], [body2, 2], "beze zmeny");
  const same = await (await adm("POST", "/api/admin/doc", { slug: "plan", title: "Plan kampane", body: body2, version: 2 }, D)).json();
  eq([same.unchanged, same.version], [true, 2], "beze zmeny verze nestoupa");
  eq((await adm("POST", "/api/admin/doc", { slug: "neni", title: "x", body: "x", version: 3 }, D)).status, 404, "uprava neexistujiciho");
});
await check("ukol: prepne jen n-ty radek ukolu (mimo kod, citaci a cislovany seznam), stara verze 409", async () => {
  const before = docRow("plan");
  const lines = before.body.split("\n");
  // ukoly: 0 = "- [ ] prvni", 1 = "- [x] druhy", 2 = "  * [ ] vnoreny", 3 = "+ [X] posledni"
  let r = await (await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 2, done: true, version: before.version }, D)).json();
  eq([r.ok, r.version], [true, before.version + 1], "ok");
  let after = docRow("plan").body.split("\n");
  eq(after.filter((l, i) => l !== lines[i]), ["  * [x] vnoreny ukol"], "zmeneny jen radek ukolu 2");
  r = await (await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 3, done: false, version: before.version + 1 }, D)).json();
  eq(docRow("plan").body.split("\n").find((l) => l.includes("posledni")), "+ [ ] posledni", "odskrtnuti");
  const v = docRow("plan").version;
  const already = await (await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 0, done: false, version: v }, D)).json();
  eq([already.already, already.version], [true, v], "uz v tom stavu");
  const stale = await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 0, done: true, version: v - 1 }, D);
  eq([stale.status, (await stale.json()).version], [409, v], "stara verze");
  eq((await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 4, done: true, version: v }, D)).status, 400, "index mimo ukoly");
  eq((await adm("POST", "/api/admin/doc/task", { slug: "plan", index: -1, done: true, version: v }, D)).status, 400, "zaporny index");
  eq((await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 0, done: "ano", version: v }, D)).status, 400, "done neni boolean");
  if (!docRow("plan").body.includes("- [ ] v bloku kodu se nepocita") || !docRow("plan").body.includes("1. [ ] cislovany")) throw new Error("zmenen radek mimo ukoly");
  eq(docRow("plan").version, v, "verze beze zmeny");
});
await check("limit 256 kB tela (413), neplatny slug / nazev / verze (400)", async () => {
  const big = "a".repeat(256 * 1024 + 1);
  const r = await adm("POST", "/api/admin/doc", { slug: "velky", title: "Velky", body: big, version: 0 }, D);
  eq(r.status, 413, "velke telo");
  eq((await adm("POST", "/api/admin/doc", { slug: "akorat", title: "Akorat", body: "a".repeat(256 * 1024), version: 0 }, D)).status, 200, "presne 256 kB projde");
  const multi = "č".repeat(128 * 1024 + 1); // 2 bajty na znak -> pres limit v UTF-8
  eq((await adm("POST", "/api/admin/doc", { slug: "utf", title: "Utf", body: multi, version: 0 }, D)).status, 413, "limit v bajtech UTF-8");
  eq((await adm("POST", "/api/admin/doc", { slug: "x".repeat(2000), title: "Velky", body: "x".repeat(900 * 1024), version: 0 }, D)).status, 413, "cely pozadavek");
  for (const slug of ["Plan", "plan kampane", "../etc", "", "a".repeat(65), "plán", 5, null])
    eq((await adm("POST", "/api/admin/doc", { slug, title: "x", body: "x", version: 0 }, D)).status, 400, "slug " + slug);
  eq((await adm("GET", "/api/admin/doc?slug=..%2Fplan", undefined, D)).status, 400, "slug v dotazu");
  eq((await adm("GET", "/api/admin/doc", undefined, D)).status, 400, "bez slugu");
  eq((await adm("POST", "/api/admin/doc", { slug: "ok", title: "  ", body: "x", version: 0 }, D)).status, 400, "prazdny nazev");
  eq((await adm("POST", "/api/admin/doc", { slug: "ok", title: "x".repeat(201), body: "x", version: 0 }, D)).status, 400, "dlouhy nazev");
  eq((await adm("POST", "/api/admin/doc", { slug: "ok", title: "x", body: 5, version: 0 }, D)).status, 400, "telo neni text");
  eq((await adm("POST", "/api/admin/doc", { slug: "ok", title: "x", body: "x", version: "1" }, D)).status, 400, "verze neni cislo");
  eq((await adm("POST", "/api/admin/doc", { slug: "ok", title: "x", body: "x" }, D)).status, 400, "bez verze");
  eq(count("SELECT COUNT(*) AS n FROM admin_docs WHERE slug IN ('velky', 'utf', 'ok')"), 0, "nic nezalozeno");
});
await check("CSRF: cizi Origin / bez X-Requested-With / cross-site / formular -> 403 / 415, nic se nezmeni", async () => {
  const v = docRow("plan").version;
  eq((await adm("POST", "/api/admin/doc", { slug: "plan", title: "x", body: "CSRF", version: v }, { ...D, Origin: "https://utocnik.example" })).status, 403, "cizi Origin");
  eq((await call("POST", "/api/admin/doc", { slug: "plan", title: "x", body: "CSRF", version: v }, { ...D, Origin: SITE })).status, 403, "bez XRW");
  eq((await adm("POST", "/api/admin/doc/task", { slug: "plan", index: 0, done: true, version: v }, { ...D, Origin: "https://utocnik.example" })).status, 403, "ukol cizi Origin");
  eq((await adm("GET", "/api/admin/doc?slug=plan", undefined, { ...D, "Sec-Fetch-Site": "cross-site" })).status, 403, "cteni cross-site");
  eq((await adm("POST", "/api/admin/doc", "slug=plan", { ...D, "Content-Type": "text/plain" })).status, 415, "formular");
  eq(docRow("plan").version, v, "beze zmeny");
});
await check("audit doc_save / doc_task: slug, delka a index - bez obsahu dokumentu", async () => {
  const saves = auditRows("doc_save"), tasks = auditRows("doc_task");
  eq(saves.length, 3, "doc_save (plan zalozeni + uprava, akorat)");
  eq(tasks.length, 2, "doc_task");
  eq(saves[0].target, "plan", "cil");
  if (!/^zalozeno, \d+ B$/.test(saves[0].detail) || !/^v2, \d+ B$/.test(saves[1].detail)) throw new Error("detail ulozeni: " + saves.map((x) => x.detail));
  eq(tasks.map((x) => x.detail), ["ukol 2 -> hotovo", "ukol 3 -> otevreno"], "detail ukolu");
  const all = JSON.stringify(db.prepare("SELECT * FROM admin_audit WHERE action LIKE 'doc_%'").all());
  for (const s of ["Plan kampane", "prvni ukol", "Dalsi odstavec", "vnoreny"]) if (all.includes(s)) throw new Error("v auditu: " + s);
});
await check("klient: sprava.js taskLines = worker/docs.js taskLines (stejne regularni vyrazy)", async () => {
  const js = readFileSync(new URL("../sprava/sprava.js", import.meta.url), "utf8");
  const wk = readFileSync(new URL("../worker/docs.js", import.meta.url), "utf8");
  for (const name of ["TASK_RE", "FENCE_RE"]) {
    const re = new RegExp(`const ${name} = (.*);`);
    eq(re.exec(js)?.[1], re.exec(wk)?.[1], name);
  }
  if (/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(js)) throw new Error("sprava.js nesmi vkladat HTML");
});

// =====================================================================================
console.log("\nbeta testeri: verejna prihlaska /api/beta");
const betaRows = () => db.prepare("SELECT * FROM beta_applications ORDER BY created_at, id").all();
const betaCount = () => count("SELECT COUNT(*) AS n FROM beta_applications");
let betaIp = 0;
// kazdy pozadavek z jine IP (omezeni pokusu se testuje zvlast)
const beta = (body, e = env, ip = `203.0.113.${++betaIp}`) => call("POST", "/api/beta", body, { "CF-Connecting-IP": ip }, e);
const betaOk = { ...human, platforms: ["siemens", "omron"], ide: "TIA Portal", ide_version: "V19 Update 3", name: "Ing. Beta Tester", company: "Testovaci Strojirna s.r.o.", email: "Tester@Firma-Example.cz", locale: "cs" };

await check("prihlaska OK -> ulozena (stav new, platformy v poradi, e-mail malymi), potvrzeni zadateli", async () => {
  const before = sentMail.length;
  const r = await beta({ ...betaOk, platforms: ["omron", "siemens", "omron"] });
  eq(r.status, 200, "status");
  const d = await r.json();
  eq(d.ok, true, "ok");
  const rows = betaRows();
  eq(rows.length, 1, "radek");
  const a = rows[0];
  eq([a.platforms, a.ide, a.ide_version, a.email, a.status, a.locale, a.name, a.company], ["siemens,omron", "TIA Portal", "V19 Update 3", "tester@firma-example.cz", "new", "cs", "Ing. Beta Tester", "Testovaci Strojirna s.r.o."], "data");
  if (!a.consent_at) throw new Error("chybi consent_at");
  eq(sentMail.length - before, 1, "jeden e-mail (bez BETA_NOTIFY_TO a MAIL_REPLY_TO jen zadateli)");
  const m = sentMail.at(-1);
  eq(m.to, ["tester@firma-example.cz"], "adresat");
  if (!m.text.includes("Siemens SIMATIC") || !m.text.includes("OMRON") || !m.text.includes("TIA Portal V19 Update 3")) throw new Error("text potvrzeni: " + m.text.slice(0, 200));
});
await check("upozorneni provozovateli (BETA_NOTIFY_TO): bez e-mailu, jmena a firmy zadatele, s odkazem do spravy", async () => {
  const before = sentMail.length;
  const r = await beta({ ...betaOk, email: "druhy@firma-example.cz", locale: "de" }, { ...env, BETA_NOTIFY_TO: "provoz@mail.example.eu" });
  eq(r.status, 200, "status");
  eq(sentMail.length - before, 2, "dva e-maily");
  const [conf, notice] = sentMail.slice(-2);
  eq(conf.to, ["druhy@firma-example.cz"], "potvrzeni");
  if (!/Betatest/.test(conf.subject)) throw new Error("nemecky predmet: " + conf.subject);
  eq(notice.to, ["provoz@mail.example.eu"], "upozorneni");
  for (const s of ["druhy@firma-example.cz", "Ing. Beta Tester", "Testovaci Strojirna"]) if (notice.text.includes(s) || notice.subject.includes(s)) throw new Error("v upozorneni: " + s);
  const id = db.prepare("SELECT id FROM beta_applications WHERE email = 'druhy@firma-example.cz'").get().id;
  if (!notice.text.includes(`/sprava/#/beta/${id}`)) throw new Error("odkaz do spravy: " + notice.text);
});
await check("validace: jen beta platformy, povinne IDE a verze, delky, < >, e-mail, souhlas -> 400, nic se neulozi", async () => {
  const n = betaCount();
  const bad = [
    [{ platforms: ["codesys"] }, "platforms"], [{ platforms: [] }, "platforms"], [{ platforms: "siemens" }, "platforms"],
    [{ platforms: ["siemens", 5] }, "platforms"], [{ platforms: Array(21).fill("siemens") }, "platforms"],
    [{ ide: "" }, "ide"], [{ ide: "   " }, "ide"], [{ ide: "x".repeat(101) }, "ide"], [{ ide: 5 }, "ide"],
    [{ ide_version: undefined }, "ide_version"], [{ ide_version: "v".repeat(61) }, "ide_version"],
    [{ name: "n".repeat(121) }, "name"], [{ company: "c".repeat(201) }, "company"],
    [{ ide: "<b>TIA</b>" }, "html"], [{ company: "Firma <script>" }, "html"], [{ name: "a > b" }, "html"],
    [{ email: "neni-email" }, "email"], [{ email: "" }, "email"], [{ email: "a<b>@firma.cz" }, "email"],
    [{ consent: false }, "consent"], [{ consent: "true" }, "consent"],
  ];
  for (const [patch, field] of bad) {
    const r = await beta({ ...betaOk, email: "validace@firma-example.cz", ...patch });
    const d = await r.json();
    eq([r.status, d.field], [400, field], JSON.stringify(patch).slice(0, 60));
    if (!d.error || /[a-z]_[a-z]/.test(d.error)) throw new Error("chybova hlaska pro lidi: " + d.error);
  }
  eq(betaCount(), n, "nic nezalozeno");
  const en = await (await beta({ ...betaOk, email: "x@firma-example.cz", platforms: [], locale: "en" })).json();
  eq(en.error, "Select at least one platform.", "anglicka hlaska");
});
await check("ridici znaky a vicenasobne mezery se v textu slouci, presne limity projdou", async () => {
  const r = await beta({ ...betaOk, email: "limity@firma-example.cz", ide: "TIA\u0000\tPortal\n\n V19", ide_version: "v".repeat(60), name: null, company: "c".repeat(200) });
  eq(r.status, 200, "status");
  const a = db.prepare("SELECT * FROM beta_applications WHERE email = 'limity@firma-example.cz'").get();
  eq([a.ide, a.ide_version.length, a.name, a.company.length], ["TIA Portal V19", 60, null, 200], "ulozeno");
});
await check("past na boty (honeypot, pod 3 s): 200 jako cloveku, nic se neulozi ani neposle", async () => {
  const n = betaCount(), m = sentMail.length;
  eq((await beta({ ...betaOk, email: "bot1@spam.example", web: "http://spam" })).status, 200, "honeypot");
  eq((await beta({ ...betaOk, email: "bot2@spam.example", elapsed: 800 })).status, 200, "rychle");
  eq([betaCount(), sentMail.length], [n, m], "nic");
});
await check("Turnstile: spatny token 403, chybejici secret mimo DEV_MODE 503 (zavreno)", async () => {
  const n = betaCount();
  eq((await beta({ ...betaOk, email: "ts@firma-example.cz", turnstile: "robot" })).status, 403, "spatny token");
  eq((await beta({ ...betaOk, email: "ts@firma-example.cz" }, { ...env, TURNSTILE_SECRET: undefined })).status, 503, "bez secretu");
  eq(betaCount(), n, "nic");
});
await check("jedna otevrena prihlaska na e-mail: opakovani 200, ale bez noveho radku a bez e-mailu", async () => {
  const n = betaCount(), m = sentMail.length;
  const r = await beta({ ...betaOk, email: "TESTER@firma-example.cz" });
  eq(r.status, 200, "status");
  eq([betaCount(), sentMail.length], [n, m], "nic noveho");
});
await check("omezeni pokusu: 6. pozadavek z jedne IP za hodinu -> 429 (pocitaji se i chybne), jina IP projde", async () => {
  const ip = "198.51.100.99";
  for (let i = 0; i < 5; i++) eq((await beta({ ...betaOk, email: `limit${i}@firma-example.cz`, platforms: i % 2 ? [] : ["rockwell"] }, env, ip)).status, i % 2 ? 400 : 200, "pokus " + i);
  const r = await beta({ ...betaOk, email: "limit9@firma-example.cz" }, env, ip);
  eq([r.status, r.headers.get("retry-after")], [429, "3600"], "blokovano");
  eq(db.prepare("SELECT COUNT(*) AS n FROM beta_applications WHERE email = 'limit9@firma-example.cz'").get().n, 0, "neulozeno");
  eq((await beta({ ...betaOk, email: "limit9@firma-example.cz" }, env, "198.51.100.100")).status, 200, "jina IP");
  // IPv6: cela sit /64 se pocita dohromady
  for (let i = 0; i < 5; i++) await beta({ ...betaOk, email: `v6-${i}@firma-example.cz` }, env, `2001:db8:1:2::${i + 1}`);
  eq((await beta({ ...betaOk, email: "v6-x@firma-example.cz" }, env, "2001:db8:1:2:ffff::1")).status, 429, "IPv6 /64");
});
await check("telo: jine nez JSON 415, nad 16 kB 413, pole misto objektu 400", async () => {
  eq((await call("POST", "/api/beta", "platforms=siemens", { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.250" })).status, 415, "formular");
  eq((await beta({ ...betaOk, email: "velky@firma-example.cz", note: "x".repeat(17 * 1024) })).status, 413, "velke");
  eq((await beta([1, 2])).status, 400, "pole");
});
await check("MAIL_MODE=direct: prihlaska se ulozi, nic se neposila", async () => {
  const m = sentMail.length;
  eq((await beta({ ...betaOk, email: "direct@firma-example.cz" }, { ...env, MAIL_MODE: "direct", BETA_NOTIFY_TO: "provoz@mail.example.eu" })).status, 200, "status");
  eq(sentMail.length, m, "bez e-mailu");
  eq(db.prepare("SELECT status FROM beta_applications WHERE email = 'direct@firma-example.cz'").get().status, "new", "ulozeno");
});
await check("selhani posty prihlasku neztrati (200, radek ulozen)", async () => {
  const r = await beta({ ...betaOk, email: "posta@firma-example.cz" }, { ...env, RESEND_API_KEY: undefined });
  eq(r.status, 200, "status");
  eq(db.prepare("SELECT COUNT(*) AS n FROM beta_applications WHERE email = 'posta@firma-example.cz'").get().n, 1, "ulozeno");
});
await check("platformy beta = data/verification.json (stav beta)", async () => {
  const { BETA_PLATFORMS } = await import("../worker/beta.js");
  const v = JSON.parse(readFileSync(new URL("../../../data/verification.json", import.meta.url), "utf8")).platforms;
  eq(BETA_PLATFORMS, Object.keys(v).filter((k) => v[k].state === "beta"), "seznam");
  if (!BETA_PLATFORMS.length) return;
  const lang = (await beta({ ...betaOk, email: "lang@firma-example.cz", platforms: Object.keys(v).filter((k) => v[k].state !== "beta").slice(0, 1) })).status;
  eq(lang, 400, "overena platforma neprojde");
});

// =====================================================================================
console.log("\nbeta testeri: sprava (seznam, stav, poznamka, licence, kanban)");
const B = withCookie(cookieOf(await adm("POST", "/api/admin/login", { token: "test-admin" })));
const firstBeta = () => db.prepare("SELECT * FROM beta_applications WHERE email = 'tester@firma-example.cz'").get();
await check("bez prihlaseni 401 (seznam, detail, zmena, kanban)", async () => {
  const id = firstBeta().id;
  eq((await adm("GET", "/api/admin/beta")).status, 401, "seznam");
  eq((await adm("GET", "/api/admin/beta/app?id=" + id)).status, 401, "detail");
  eq((await adm("POST", "/api/admin/beta", { id, status: "accepted" })).status, 401, "zmena");
  eq((await adm("POST", "/api/admin/beta/crm", { id })).status, 401, "kanban");
  eq(firstBeta().status, "new", "beze zmeny");
});
await check("seznam: pocty podle stavu, filtr stavu, nazvy platforem, neplatny filtr = vse", async () => {
  const d = await (await adm("GET", "/api/admin/beta", undefined, B)).json();
  eq(d.total, betaCount(), "celkem");
  eq(d.counts.new, betaCount(), "vse nove");
  eq(d.states, ["new", "accepted", "declined", "done"], "stavy");
  const a = d.applications.find((x) => x.email === "tester@firma-example.cz");
  eq(a.platform_names, ["Siemens SIMATIC", "OMRON"], "nazvy");
  eq((await (await adm("GET", "/api/admin/beta?status=done", undefined, B)).json()).total, 0, "filtr done");
  eq((await (await adm("GET", "/api/admin/beta?status=xxx", undefined, B)).json()).total, betaCount(), "neplatny filtr");
});
await check("detail -> audit beta_view (zkracene id, bez e-mailu)", async () => {
  const id = firstBeta().id;
  const r = await adm("GET", "/api/admin/beta/app?id=" + id, undefined, B);
  eq(r.status, 200, "status");
  eq((await r.json()).application.email, "tester@firma-example.cz", "detail");
  const au = auditRows("beta_view").at(-1);
  eq(au.target, id.slice(0, 8), "cil");
  eq((await adm("GET", "/api/admin/beta/app?id=neni", undefined, B)).status, 404, "neexistuje");
  eq((await adm("GET", "/api/admin/beta/app?id=../x", undefined, B)).status, 400, "spatne id");
});
await check("zmena stavu a poznamky -> ulozeno, audit beta_update bez obsahu poznamky", async () => {
  const id = firstBeta().id;
  const r = await adm("POST", "/api/admin/beta", { id, status: "accepted", note: "Domluveno: TIA V19,\r\nposlat licenci" }, B);
  eq(r.status, 200, "status");
  const d = await r.json();
  eq(d.changed, ["status", "note"], "zmeny");
  eq([firstBeta().status, firstBeta().note], ["accepted", "Domluveno: TIA V19,\nposlat licenci"], "ulozeno");
  const au = auditRows("beta_update").at(-1);
  eq([au.target, au.detail], [id.slice(0, 8), "new -> accepted, poznamka 34 znaku"], "audit");
  const all = JSON.stringify(db.prepare("SELECT * FROM admin_audit WHERE action LIKE 'beta_%'").all());
  for (const s of ["Domluveno", "tester@firma-example.cz", "Ing. Beta"]) if (all.includes(s)) throw new Error("v auditu: " + s);
  const same = await (await adm("POST", "/api/admin/beta", { id, status: "accepted" }, B)).json();
  eq(same.unchanged, true, "beze zmeny");
});
await check("validace spravy: stav, poznamka (delka, < >), klic licence, prazdna zmena", async () => {
  const id = firstBeta().id;
  eq((await adm("POST", "/api/admin/beta", { id, status: "hotovo" }, B)).status, 400, "stav");
  eq((await adm("POST", "/api/admin/beta", { id, note: "x".repeat(2001) }, B)).status, 400, "dlouha poznamka");
  eq((await adm("POST", "/api/admin/beta", { id, note: "<img src=x>" }, B)).status, 400, "HTML v poznamce");
  eq((await adm("POST", "/api/admin/beta", { id, note: 5 }, B)).status, 400, "poznamka neni text");
  eq((await adm("POST", "/api/admin/beta", { id, license_key: "neni-klic" }, B)).status, 400, "klic");
  eq((await adm("POST", "/api/admin/beta", { id }, B)).status, 400, "nic ke zmene");
  eq((await adm("POST", "/api/admin/beta", { id: "neni", status: "done" }, B)).status, 404, "neexistuje");
  eq(firstBeta().status, "accepted", "beze zmeny");
});
await check("CSRF: cizi Origin / bez X-Requested-With / cross-site / formular -> 403 / 415, nic se nezmeni", async () => {
  const id = firstBeta().id;
  eq((await adm("POST", "/api/admin/beta", { id, status: "declined" }, { ...B, Origin: "https://utocnik.example" })).status, 403, "cizi Origin");
  eq((await call("POST", "/api/admin/beta", { id, status: "declined" }, { ...B, Origin: SITE })).status, 403, "bez XRW");
  eq((await adm("POST", "/api/admin/beta/crm", { id }, { ...B, Origin: "https://utocnik.example" })).status, 403, "kanban cizi Origin");
  eq((await adm("GET", "/api/admin/beta", undefined, { ...B, "Sec-Fetch-Site": "cross-site" })).status, 403, "cteni cross-site");
  eq((await adm("POST", "/api/admin/beta", "id=" + id, { ...B, "Content-Type": "text/plain" })).status, 415, "formular");
  eq([firstBeta().status, firstBeta().crm_lead_id], ["accepted", null], "beze zmeny");
});
await check("licence Pro pro testera: vystaveni pres /api/admin/license + klic ulozeny k prihlasce (audit)", async () => {
  const id = firstBeta().id;
  const lic = await (await adm("POST", "/api/admin/license", { action: "issue", email: "tester@firma-example.cz", plan: "pro", days: 90, note: `Beta tester ${id.slice(0, 8)}` }, B)).json();
  eq(lic.ok, true, "vystaveno");
  eq(lic.sent, false, "bez odeslani (send nezadano)");
  const r = await (await adm("POST", "/api/admin/beta", { id, license_key: lic.key.toLowerCase() }, B)).json();
  eq(r.changed, ["license_key"], "ulozeno");
  eq(firstBeta().license_key, lic.key, "klic velkymi");
  eq(auditRows("beta_update").at(-1).detail, "licence", "audit bez klice");
});
await check("kanban: karta BEZ osobnich kontaktu (firma, platformy, IDE, odkaz na prihlasku), podruhe stejna karta", async () => {
  const a = firstBeta();
  const r = await adm("POST", "/api/admin/beta/crm", { id: a.id }, B);
  eq(r.status, 200, "status");
  const d = await r.json();
  eq(d.created, true, "zalozeno");
  const c = db.prepare("SELECT * FROM crm_leads WHERE id = ?").get(d.lead_id);
  eq([c.email, c.contact_name, c.phone, c.website, c.domain], [null, null, null, null, null], "bez kontaktu");
  eq([c.company, c.source, c.stage, c.segment], ["Testovaci Strojirna s.r.o.", "beta", "trial", "jine"], "karta");
  eq(c.source_url, `${SITE}/sprava/#/beta/${a.id}`, "odkaz na prihlasku");
  if (!c.value_note.includes("Siemens SIMATIC") || !c.value_note.includes("TIA Portal V19 Update 3")) throw new Error("platforma a IDE: " + c.value_note);
  const flat = JSON.stringify(c) + JSON.stringify(db.prepare("SELECT * FROM crm_events WHERE lead_id = ?").all(d.lead_id));
  for (const s of ["tester@firma-example.cz", "Ing. Beta Tester", "firma-example"]) if (flat.includes(s)) throw new Error("v kanbanu: " + s);
  eq(firstBeta().crm_lead_id, d.lead_id, "vazba");
  const again = await (await adm("POST", "/api/admin/beta/crm", { id: a.id }, B)).json();
  eq([again.already, again.lead_id], [true, d.lead_id], "podruhe stejna");
  eq(auditRows("beta_crm").length, 1, "audit jednou");
  // bez vyplnene firmy: zastupny nazev z id a platforem, ne e-mail ani jmeno
  const b = db.prepare("SELECT * FROM beta_applications WHERE email = 'limity@firma-example.cz'").get();
  db.prepare("UPDATE beta_applications SET company = NULL WHERE id = ?").run(b.id);
  const d2 = await (await adm("POST", "/api/admin/beta/crm", { id: b.id }, B)).json();
  eq(db.prepare("SELECT company FROM crm_leads WHERE id = ?").get(d2.lead_id).company, `Beta tester ${b.id.slice(0, 8)} (Siemens SIMATIC, OMRON)`, "zastupny nazev");
});
await check("kanban: karty z prihlasky se ukazou na tabuli (sloupec Zkouší, zdroj beta) a projdou upravou", async () => {
  const id = firstBeta().crm_lead_id;
  const board = await (await adm("GET", "/api/admin/crm", undefined, B)).json();
  const card = board.columns.trial.cards.find((x) => x.id === id);
  eq([!!card, card?.source], [true, "beta"], "na tabuli");
  eq(board.sources.includes("beta"), true, "zdroj v seznamu");
  eq((await adm("POST", "/api/admin/crm/lead", { id, next_action: "Poslat balik k overeni" }, B)).status, 200, "uprava karty");
});
await check("klient sprava.js: zalozka beta bez vkladani HTML, Nova licence predvyplnuje z prihlasky", async () => {
  const js = readFileSync(new URL("../sprava/sprava.js", import.meta.url), "utf8");
  for (const s of ['"/api/admin/beta"', '"/api/admin/beta/crm"', "#/nova?", 'plan: "pro"', 'r.params.get("beta")']) if (!js.includes(s)) throw new Error("chybi " + s);
  if (/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(js)) throw new Error("sprava.js nesmi vkladat HTML");
  const html = readFileSync(new URL("../sprava/index.html", import.meta.url), "utf8");
  if (!html.includes('href="#/beta"')) throw new Error("chybi odkaz v navigaci spravy");
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
// /admin/ (CMS) běží na stejném originu jako /sprava: cizí skript jen v pevné verzi s SRI
await check("admin/index.html: skript CMS s pevnou verzí a integrity", async () => {
  const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*>/g)) {
    if (!/@\d+\.\d+\.\d+\//.test(m[1])) throw new Error("bez verze: " + m[1]);
    if (!/\bintegrity="sha(256|384|512)-/.test(m[0]) || !/crossorigin=/.test(m[0])) throw new Error("bez SRI: " + m[1]);
  }
});
await check("build.js zapisuje _headers s nosniff a frame-ancestors", async () => {
  const js = readFileSync(new URL("../scripts/build.js", import.meta.url), "utf8");
  if (!/"_headers"/.test(js) || !/nosniff/.test(js) || !/frame-ancestors 'none'/.test(js)) throw new Error("_headers chybi");
});

console.log(`\n${pass} proslo, ${fail} selhalo`);
process.exit(fail ? 1 : 0);
