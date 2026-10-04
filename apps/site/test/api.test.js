// Prozene Worker realnymi pozadavky proti SQLite misto D1 (Node 22.5+, bez zavislosti).
// Prevzato z vetve web-a-licencni-api a rozsireno o pouceni z NATA: chybejici
// nastaveni zavira, past na boty, podepsany Stripe i Paddle, free rezim bez e-mailu.
//   node test/api.test.js

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createHmac, createPublicKey, verify } from "node:crypto";
import worker from "../worker/index.js";

const db = new DatabaseSync(":memory:");
for (const stmt of readFileSync(new URL("../schema.sql", import.meta.url), "utf8").split(";")) {
  if (stmt.replace(/--.*$/gm, "").trim()) db.exec(stmt + ";");
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

// Odchozi pozadavky odchytime: Resend a Turnstile. Nic jineho ven nesmi.
const sentMail = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("resend.com")) {
    sentMail.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
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

console.log(`\n${pass} proslo, ${fail} selhalo`);
process.exit(fail ? 1 : 0);
