// PLCdesk - jeden Cloudflare Worker pro cely web (vzor: web NATA Atelier).
//
// Staticky web z dist/ obsluhuje Cloudflare primo (binding ASSETS); Worker se spusti jen
// pro adresy, ktere mezi soubory nejsou - tedy /api/*. Licencni API je prevzate z vetve
// web-a-licencni-api a upravene podle pouceni z NATA:
//   - chybejici nastaveni ZAVIRA, neotevira (bez TURNSTILE_SECRET formular 503,
//     bez secretu zvoleneho platebniho poskytovatele webhook 503, bez ADMIN_TOKEN admin 503),
//   - vyvojovy rezim jen vyslovne pres DEV_MODE,
//   - past na boty (honeypot, cas vyplneni) bota tise "pusti" a nic neudela.
//
// Endpointy:
//   POST /api/lead              e-mail z formulare -> odkaz ke stazeni (e-mailem, nebo primo)
//   GET  /api/download          ?t=<token>&ch=portable -> soubor z R2, nebo presmerovani na DOWNLOAD_URL
//   GET  /api/release/latest    manifest pro aktualizace aplikace
//   GET  /api/config            verejna konfigurace (limit I/O)
//   POST /api/license/activate  klic + otisk pocitace -> podepsany licencni soubor
//   POST /api/license/check     obcasna kontrola stavu, tolerantni
//   POST /api/unlock            odemceni jednoho projektu nad limit
//   POST /api/beta              prihlaska beta testera platforem ve stavu beta (beta.js; sprava #/beta)
//   POST /api/stripe/webhook    platby Stripe   (jen pri PAYMENT_PROVIDER="stripe")
//   POST /api/paddle/webhook    platby Paddle   (jen pri PAYMENT_PROVIDER="paddle")
//   /api/admin/*                sprava zakazniku (admin.js): prihlaseni, prehled, zakaznici,
//                               licence, pocitace, poznamky, export CSV, audit, leady (crm.js),
//                               interni dokumenty (docs.js, obsah jen v D1); stranka /sprava
//   POST /api/admin/license     i skriptem s X-Admin-Token / Bearer (beta, skoly)

import { signLicense, newToken, newId } from "./license.js";
import { handleAdmin, securePage } from "./admin.js";
import { handleStripeWebhook, handlePaddleWebhook } from "./payments.js";
import { sendDownloadLink, sendUnlockConfirmation, customerMail } from "./email.js";
import { handleBetaApply } from "./beta.js";

const LANGS = ["cs", "en", "de"];
const MSG = {
  cs: {
    email: "Zadejte platnou e-mailovou adresu.",
    consent: "Pro stažení je potřeba souhlas s licenčními podmínkami.",
    verify: "Ověření se nezdařilo, zkuste to prosím znovu.",
    closed: "Formulář je dočasně mimo provoz. Napište nám prosím e-mailem.",
    sent: "Odkaz ke stažení je na cestě.",
    direct: "Odkaz ke stažení je připravený.",
    bad_link: "Odkaz je neplatný.",
    expired: "Odkaz vypršel. Vyžádejte si prosím nový.",
    no_build: "Soubor ke stažení zatím není k dispozici.",
    missing: "Chybí klíč nebo otisk počítače.",
    no_key: "Licenční klíč jsme nenašli.",
    canceled: "Licence byla zrušena.",
    seats: "Licence je už použitá na všech povolených počítačích ({n}). Napište nám a uvolníme ji.",
    unlock_missing: "Chybí e-mail nebo projekt.",
    unlock_used: "Jeden projekt už máte odemčený. Další stroje nad limit potřebují tarif Pro.",
    server: "Došlo k chybě na serveru.",
  },
  en: {
    email: "Please enter a valid e-mail address.",
    consent: "Please accept the licence terms to download.",
    verify: "Verification failed, please try again.",
    closed: "The form is temporarily unavailable. Please write to us by e-mail.",
    sent: "Your download link is on its way.",
    direct: "Your download link is ready.",
    bad_link: "The link is not valid.",
    expired: "The link has expired. Please request a new one.",
    no_build: "The download is not available yet.",
    missing: "Licence key or device fingerprint missing.",
    no_key: "We could not find this licence key.",
    canceled: "The licence has been cancelled.",
    seats: "The licence is already used on all allowed computers ({n}). Write to us and we will release it.",
    unlock_missing: "E-mail or project missing.",
    unlock_used: "You already have one project unlocked. Further machines above the limit need the Pro plan.",
    server: "A server error occurred.",
  },
  de: {
    email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    consent: "Für den Download ist die Zustimmung zu den Lizenzbedingungen nötig.",
    verify: "Die Prüfung ist fehlgeschlagen, bitte versuchen Sie es erneut.",
    closed: "Das Formular ist vorübergehend nicht verfügbar. Bitte schreiben Sie uns eine E-Mail.",
    sent: "Ihr Download-Link ist unterwegs.",
    direct: "Ihr Download-Link ist bereit.",
    bad_link: "Der Link ist ungültig.",
    expired: "Der Link ist abgelaufen. Bitte fordern Sie einen neuen an.",
    no_build: "Der Download ist noch nicht verfügbar.",
    missing: "Lizenzschlüssel oder Geräte-Fingerabdruck fehlt.",
    no_key: "Diesen Lizenzschlüssel haben wir nicht gefunden.",
    canceled: "Die Lizenz wurde gekündigt.",
    seats: "Die Lizenz ist bereits auf allen erlaubten Computern ({n}) aktiv. Schreiben Sie uns, wir geben sie frei.",
    unlock_missing: "E-Mail oder Projekt fehlt.",
    unlock_used: "Sie haben bereits ein Projekt freigeschaltet. Weitere Maschinen über dem Limit benötigen den Tarif Pro.",
    server: "Auf dem Server ist ein Fehler aufgetreten.",
  },
};
const loc = (l) => (LANGS.includes(l) ? l : "cs");
const t = (l, k, v = {}) => MSG[loc(l)][k].replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer", "Strict-Transport-Security": "max-age=31536000",
      ...extra,
    },
  });
}

const now = () => new Date().toISOString();
const plusDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const validEmail = (s) => typeof s === "string" && s.length < 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

// Turnstile: vraci "ok" | "fail" | "closed" (secret chybi a neni DEV_MODE)
async function turnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return env.DEV_MODE ? "ok" : "closed";
  if (!token) return "fail";
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const d = await r.json();
    return d.success === true ? "ok" : "fail";
  } catch {
    return "fail"; // radeji odmitnout nez pustit
  }
}

// ---------------------------------------------------------------- lead

async function handleLead(req, env) {
  const body = await req.json().catch(() => ({}));
  const locale = loc(body.locale);
  const email = String(body.email ?? "").trim().toLowerCase();

  // Past na boty: skryte pole vyplnene, nebo odeslano driv nez za 3 s.
  // Bot dostane stejnou odpoved jako clovek, at nehleda jinou cestu.
  const elapsed = Number(body.elapsed);
  if (String(body.web ?? "").trim() !== "" || (Number.isFinite(elapsed) && elapsed < 3000)) {
    return json({ ok: true, message: t(locale, "sent") }, 200, env.DEV_MODE ? { "x-plcdesk": "trap" } : {});
  }

  if (!validEmail(email)) return json({ error: t(locale, "email") }, 400);
  // souhlas s licencnimi podminkami (checkbox ve formulari) - bez nej se nic neulozi
  if (body.consent !== true) return json({ error: t(locale, "consent") }, 400);

  const ts = await turnstile(env, body.turnstile, req.headers.get("CF-Connecting-IP"));
  if (ts === "closed") {
    console.error("TURNSTILE_SECRET neni nastaveny - formular je zavreny.");
    return json({ error: t(locale, "closed") }, 503);
  }
  if (ts !== "ok") return json({ error: t(locale, "verify") }, 403);

  const existing = await env.DB.prepare("SELECT id FROM leads WHERE email = ?").bind(email).first();
  let leadId = existing?.id;
  if (!leadId) {
    leadId = newId();
    await env.DB.prepare("INSERT INTO leads (id, email, locale, source, terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(leadId, email, locale, clip(body.source, 100), now(), now())
      .run();
  }

  const token = newToken();
  await env.DB.prepare("INSERT INTO download_tokens (token, lead_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(token, leadId, plusDays(7), now())
    .run();

  // Free tarif bez vlastni domeny (direct / owner): e-mail zajemci neodchazi, odkaz je rovnou v odpovedi
  if (!customerMail(env)) {
    return json({ ok: true, message: t(locale, "direct"), download_url: `/api/download?t=${token}&ch=portable` });
  }

  await sendDownloadLink(env, { to: email, token, locale });
  // Vzdy stejna odpoved i pro znamy e-mail - pres formular nejde zjistit, kdo je zakaznik
  return json({ ok: true, message: t(locale, "sent") });
}

// ------------------------------------------------------------ download

async function readManifest(env) {
  if (env.RELEASES) {
    const obj = await env.RELEASES.get("latest.json");
    if (obj) return JSON.parse(await obj.text());
  }
  // Bez R2 (free tarif bez platebni karty): verze a adresa souboru z promennych
  if (env.DOWNLOAD_URL) {
    return {
      version: env.RELEASE_VERSION || "0.0.0",
      assets: { portable: { url: env.DOWNLOAD_URL, filename: env.DOWNLOAD_URL.split("/").pop() } },
    };
  }
  return { version: "0.0.0", assets: {} };
}

async function handleDownload(req, env) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const channel = url.searchParams.get("ch") === "msi" ? "msi" : "portable";
  const locale = loc(url.searchParams.get("l"));

  const row = await env.DB.prepare("SELECT token, lead_id, expires_at FROM download_tokens WHERE token = ?")
    .bind(token)
    .first();
  if (!row) return json({ error: t(locale, "bad_link") }, 404);
  if (row.expires_at < now()) return json({ error: t(locale, "expired") }, 410);

  const asset = (await readManifest(env)).assets[channel];
  if (!asset) return json({ error: t(locale, "no_build") }, 503);

  await env.DB.batch([
    env.DB.prepare("UPDATE download_tokens SET used_count = used_count + 1 WHERE token = ?").bind(token),
    env.DB.prepare("UPDATE leads SET confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?").bind(now(), row.lead_id),
  ]);

  if (asset.url) {
    return new Response(null, { status: 302, headers: { Location: asset.url, "Cache-Control": "no-store" } });
  }
  const object = await env.RELEASES.get(asset.key);
  if (!object) return json({ error: t(locale, "no_build") }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asset.filename}"`,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
    },
  });
}

// ------------------------------------------------------------- licence

async function handleActivate(req, env) {
  const body = await req.json().catch(() => ({}));
  const locale = loc(body.locale);
  const key = String(body.key ?? "").trim().toUpperCase();
  const device = String(body.device_hash ?? "").trim();
  if (!key || !device) return json({ error: t(locale, "missing") }, 400);

  const lic = await env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(key).first();
  if (!lic) return json({ error: t(locale, "no_key") }, 404);
  if (lic.status === "canceled") return json({ error: t(locale, "canceled") }, 403);

  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM activations WHERE license_key = ? AND revoked_at IS NULL AND device_hash != ?"
  )
    .bind(key, device)
    .first();
  if ((used?.n ?? 0) >= lic.seats) return json({ error: t(locale, "seats", { n: lic.seats }) }, 409);

  await env.DB.prepare(
    `INSERT INTO activations (id, license_key, device_hash, device_label, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(license_key, device_hash)
     DO UPDATE SET last_seen_at = excluded.last_seen_at, revoked_at = NULL`
  )
    .bind(newId(), key, clip(device, 200), clip(body.device_label, 100), now(), now())
    .run();

  const file = await signLicense(env, { key: lic.key, email: lic.email, plan: lic.plan, seats: lic.seats, validUntil: lic.valid_until });
  return json({ ok: true, license: file, plan: lic.plan, valid_until: lic.valid_until });
}

// Kontrola na pozadi. Zamerne tolerantni: po splatnosti aplikace bezi dal, zamyka se az zruseni.
async function handleCheck(req, env) {
  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "").trim().toUpperCase();
  const lic = await env.DB.prepare("SELECT key, plan, status, valid_until, seats FROM licenses WHERE key = ?").bind(key).first();
  if (!lic) return json({ status: "unknown" }, 404);
  if (body.device_hash) {
    await env.DB.prepare("UPDATE activations SET last_seen_at = ? WHERE license_key = ? AND device_hash = ?")
      .bind(now(), key, String(body.device_hash))
      .run();
  }
  return json({ status: lic.status, plan: lic.plan, seats: lic.seats, valid_until: lic.valid_until, grace_days: 30 });
}

// ------------------------------------------------------- odemceni projektu

// Kdo narazi na limit u realne zakazky, dostane prvni projekt odemceny zdarma.
async function handleUnlock(req, env) {
  const body = await req.json().catch(() => ({}));
  const locale = loc(body.locale);
  const email = String(body.email ?? "").trim().toLowerCase();
  const projectId = String(body.project_id ?? "").trim();
  if (!validEmail(email) || !projectId) return json({ error: t(locale, "unlock_missing") }, 400);
  // pocet I/O jde do databaze i do textu e-mailu: jen cele cislo v rozumnem rozsahu, jinak nic
  const io = Number(body.io_count);
  const ioCount = Number.isInteger(io) && io > 0 && io <= 100000 ? io : null;

  const ts = await turnstile(env, body.turnstile, req.headers.get("CF-Connecting-IP"));
  if (ts === "closed") return json({ error: t(locale, "closed") }, 503);
  if (ts !== "ok") return json({ error: t(locale, "verify") }, 403);

  const already = await env.DB.prepare("SELECT COUNT(*) AS n FROM project_unlocks WHERE email = ?").bind(email).first();
  if ((already?.n ?? 0) >= 1) {
    return json({ error: t(locale, "unlock_used"), upgrade: `${env.PUBLIC_SITE}/cenik/` }, 409);
  }

  await env.DB.prepare(
    `INSERT INTO project_unlocks (id, email, project_id, io_count, granted_at, granted_by)
     VALUES (?, ?, ?, ?, ?, 'self-serve')`
  )
    .bind(newId(), email, clip(projectId, 100), ioCount, now())
    .run();

  await sendUnlockConfirmation(env, { to: email, ioCount, locale });
  return json({ ok: true, unlocked: projectId });
}

// Platby (Stripe / Paddle) jsou v payments.js

// Sprava zakazniku (/api/admin/*) je v admin.js

// --------------------------------------------------------------- router

const ROUTES = {
  "POST /api/lead": handleLead,
  "GET /api/download": handleDownload,
  "GET /api/release/latest": async (req, env) => json(await readManifest(env), 200, { "Cache-Control": "public, max-age=300" }),
  // version + stránka ke stažení: kontrola aktualizací v aplikaci (plc_studio/updates.py) jedním dotazem
  "GET /api/config": async (req, env) => json({ free_io_limit: Number(env.FREE_IO_LIMIT ?? 64), site: env.PUBLIC_SITE, payment_provider: env.PAYMENT_PROVIDER || null,
    version: env.RELEASE_VERSION || "0.0.0", download_page: (env.PUBLIC_SITE || "") + "/stazeni/" }),
  "POST /api/license/activate": handleActivate,
  "POST /api/license/check": handleCheck,
  "POST /api/unlock": handleUnlock,
  "POST /api/beta": handleBetaApply,
  "POST /api/stripe/webhook": handleStripeWebhook,
  "POST /api/paddle/webhook": handlePaddleWebhook,
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) {
      if (!env.ASSETS) return new Response("Not found", { status: 404 });
      // /sprava (run_worker_first ve wrangler.toml): staticka stranka s prisnymi hlavickami
      if (url.pathname === "/sprava" || url.pathname.startsWith("/sprava/")) return securePage(await env.ASSETS.fetch(req));
      // vse ostatni je staticky web (sem se dostane jen to, co v dist/ neni -> 404 stranka)
      return env.ASSETS.fetch(req);
    }
    if (url.pathname.startsWith("/api/admin/")) return handleAdmin(req, env);
    const route = ROUTES[`${req.method} ${url.pathname}`];
    if (!route) {
      const known = Object.keys(ROUTES).some((r) => r.endsWith(" " + url.pathname));
      return json({ error: known ? "method not allowed" : "not found" }, known ? 405 : 404);
    }
    try {
      return await route(req, env);
    } catch (err) {
      console.error(err?.stack ?? String(err));
      return json({ error: t("cs", "server") }, 500);
    }
  },
};
