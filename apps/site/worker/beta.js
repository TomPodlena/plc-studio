// Program pro beta testery platforem ve stavu "beta" (data/verification.json).
//
//   POST /api/beta                  verejna prihlaska (stranka /beta): stejna ochrana jako formular ke stazeni
//                                   (past na boty = honeypot + cas vyplneni, Turnstile, bez TURNSTILE_SECRET zavreno)
//                                   + omezeni pokusu z jedne IP (5 / hodinu, zaznam PRED overenim jako reserveAttempt
//                                   ve sprave). Validace na serveru, limity delek, texty bez ridicich znaku a bez < >.
//   GET  /api/admin/beta            seznam prihlasek (filtr stavu, strankovani) - pres admin.js (prihlaseni, CSRF)
//   GET  /api/admin/beta/app        detail prihlasky (audit beta_view)
//   POST /api/admin/beta            zmena stavu a poznamky (audit beta_update - bez obsahu poznamky a osobnich udaju)
//   POST /api/admin/beta/crm        karta v obchodnim kanbanu BEZ osobnich kontaktu (platforma, IDE, firma jen kdyz
//                                   ji zadatel vyplnil, odkaz na prihlasku). Zasada: osobni kontakty potencialnich
//                                   zakazniku do kanbanu nepatri - e-mail a jmeno zustavaji jen v prihlasce.
//
// Ktere platformy jsou "beta", cte Worker ze stejneho souboru jako web a aplikace (data/verification.json,
// pribali se pri nasazeni) - po overeni platformy naostro zmizi z formulare i z validace sama.
// E-maily: potvrzeni zadateli + upozorneni provozovateli (BETA_NOTIFY_TO, jinak MAIL_REPLY_TO) pres email.js;
// pri MAIL_MODE="direct" (bez posty) se prihlaska jen ulozi. Selhani posty prihlasku neztrati.

import VERIFICATION from "../../../data/verification.json" with { type: "json" };
import CONTENT_CS from "../content/cs.json" with { type: "json" };
import { out, readJson, audit, clip, nowIso, isoAgo, num, clientIp, safeEmail } from "./admin_util.js";
import { newId } from "./license.js";
import { sendBetaConfirmation, sendBetaNotice } from "./email.js";

export const BETA_STATES = ["new", "accepted", "declined", "done"];
// Klice platforem ve stavu beta, v poradi souboru
export const BETA_PLATFORMS = Object.entries(VERIFICATION.platforms).filter(([, v]) => v.state === "beta").map(([k]) => k);
// Nazvy platforem (technicke, stejne ve vsech jazycich) z tabulky platforem webu
const ROW_NAMES = Object.fromEntries((CONTENT_CS.platformy?.rows || []).flatMap((r) =>
  Array.isArray(r.members) ? r.members.map((m) => [m.key, m.name]) : [[r.key, r.name]]));
export const platformName = (k) => ROW_NAMES[k] || k;

const LANGS = ["cs", "en", "de"];
const ATTEMPT_WINDOW_MS = 3600e3;
const MAX_ATTEMPTS = 5;
const PAGE_SIZE = 50;
const LIMITS = { ide: 100, ide_version: 60, name: 120, company: 200, note: 2000 };
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const MSG = {
  cs: {
    ok: "Děkujeme, přihláška je odeslaná. Ozveme se e-mailem, obvykle do dvou pracovních dnů.",
    email: "Zadejte platnou e-mailovou adresu.",
    platforms: "Vyberte aspoň jednu platformu.",
    ide: "Vyplňte vývojové prostředí (max. 100 znaků).",
    ide_version: "Vyplňte verzi vývojového prostředí (max. 60 znaků).",
    name: "Jméno je příliš dlouhé (max. 120 znaků).",
    company: "Název firmy je příliš dlouhý (max. 200 znaků).",
    html: "Text nesmí obsahovat znaky < a >.",
    consent: "Pro odeslání je potřeba souhlas se zpracováním údajů pro účel testu.",
    verify: "Ověření se nezdařilo, zkuste to prosím znovu.",
    closed: "Formulář je dočasně mimo provoz. Napište nám prosím e-mailem.",
    many: "Příliš mnoho pokusů. Zkuste to prosím znovu za hodinu.",
    bad: "Neplatný požadavek.",
  },
  en: {
    ok: "Thank you, your application has been sent. We will reply by e-mail, usually within two working days.",
    email: "Please enter a valid e-mail address.",
    platforms: "Select at least one platform.",
    ide: "Enter the development environment (max. 100 characters).",
    ide_version: "Enter the development environment version (max. 60 characters).",
    name: "The name is too long (max. 120 characters).",
    company: "The company name is too long (max. 200 characters).",
    html: "The text must not contain the characters < and >.",
    consent: "Please agree to the processing of your data for the purpose of the test.",
    verify: "Verification failed, please try again.",
    closed: "The form is temporarily unavailable. Please write to us by e-mail.",
    many: "Too many attempts. Please try again in an hour.",
    bad: "Invalid request.",
  },
  de: {
    ok: "Vielen Dank, Ihre Anmeldung ist abgeschickt. Wir antworten per E-Mail, meist innerhalb von zwei Arbeitstagen.",
    email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    platforms: "Wählen Sie mindestens eine Plattform.",
    ide: "Geben Sie die Entwicklungsumgebung an (max. 100 Zeichen).",
    ide_version: "Geben Sie die Version der Entwicklungsumgebung an (max. 60 Zeichen).",
    name: "Der Name ist zu lang (max. 120 Zeichen).",
    company: "Der Firmenname ist zu lang (max. 200 Zeichen).",
    html: "Der Text darf die Zeichen < und > nicht enthalten.",
    consent: "Für das Absenden ist die Zustimmung zur Verarbeitung der Daten für den Test nötig.",
    verify: "Die Prüfung ist fehlgeschlagen, bitte versuchen Sie es erneut.",
    closed: "Das Formular ist vorübergehend nicht verfügbar. Bitte schreiben Sie uns eine E-Mail.",
    many: "Zu viele Versuche. Bitte versuchen Sie es in einer Stunde erneut.",
    bad: "Ungültige Anfrage.",
  },
};
const loc = (l) => (LANGS.includes(l) ? l : "cs");
const fail = (locale, key, status = 400) => out({ error: MSG[loc(locale)][key], field: key }, status);
const validEmail = (s) => typeof s === "string" && s.length < 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Cisty jednoradkovy text: ridici znaky a vicenasobne mezery pryc; {value} / {error: "html" | "long" | "type"}
export function cleanText(v, max) {
  if (v == null) return { value: null };
  if (typeof v !== "string") return { error: "type" };
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return { value: null };
  if (/[<>]/.test(s)) return { error: "html" };
  if (s.length > max) return { error: "long" };
  return { value: s };
}

async function turnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return env.DEV_MODE ? "ok" : "closed";
  if (!token || typeof token !== "string" || token.length > 4096) return "fail";
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const d = await r.json();
    return d.success === true ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

// Pokus se zapise PRED overenim (soubezne pokusy se navzajem vidi), pak se spocita okno. Stare zaznamy pryc.
async function reserveBetaAttempt(env, ip) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM beta_attempts WHERE at < ?").bind(isoAgo(864e5)),
    env.DB.prepare("INSERT INTO beta_attempts (ip, at) VALUES (?, ?)").bind(ip, nowIso()),
  ]);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM beta_attempts WHERE ip = ? AND at > ?").bind(ip, isoAgo(ATTEMPT_WINDOW_MS)).first();
  return num(row?.n);
}

const platformList = (keys) => keys.map(platformName).join(", ");

// Volny text zadatele do e-mailu na jeho (libovolnou) adresu: slova s adresou (://, www., @, domena
// s pismennou koncovkou) nahradi "…", vysledek nejvys 60 znaku. Nazvy IDE a verze ("TIA Portal V19",
// "CODESYS 3.5.21.60") projdou beze zmeny. Upozorneni provozovateli dostava text cely.
const LINKISH = /\S*(?::\/\/|www\.|@|[\p{L}\p{N}-]\.[\p{L}]{2,}(?![\p{L}\p{N}]))\S*/giu;
export function echoSafe(s) {
  const t = String(s ?? "").replace(LINKISH, "…").replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 59) + "…" : t;
}

// ------------------------------------------------------------ verejna prihlaska

export async function handleBetaApply(req, env) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const b = p.body;
  const locale = loc(b.locale);

  // Past na boty: skryte pole nebo odeslani driv nez za 3 s -> stejna odpoved jako cloveku, nic se neulozi
  // (chybejici nebo neciselny cas = bot - formular webu ho posila vzdy)
  const elapsed = typeof b.elapsed === "number" || typeof b.elapsed === "string" ? Number(b.elapsed) : NaN;
  if (String(b.web ?? "").trim() !== "" || !Number.isFinite(elapsed) || elapsed < 3000) {
    return out({ ok: true, message: MSG[locale].ok }, 200, env.DEV_MODE ? { "x-plcdesk": "trap" } : {});
  }

  // omezeni pokusu z jedne IP (ve vyvojovem rezimu DEV_MODE vypnute - lokalni nahled a jeho testy)
  const ip = clientIp(req);
  if (!env.DEV_MODE && (await reserveBetaAttempt(env, ip)) > MAX_ATTEMPTS) return out({ error: MSG[locale].many }, 429, { "Retry-After": "3600" });

  // Validace (poradi = poradi poli ve formulari)
  if (!Array.isArray(b.platforms) || b.platforms.length > 20) return fail(locale, "platforms");
  const platforms = [...new Set(b.platforms)];
  if (!platforms.length || platforms.some((k) => typeof k !== "string" || !BETA_PLATFORMS.includes(k))) return fail(locale, "platforms");
  platforms.sort((a, c) => BETA_PLATFORMS.indexOf(a) - BETA_PLATFORMS.indexOf(c));
  const fields = {};
  for (const f of ["ide", "ide_version", "name", "company"]) {
    const r = cleanText(b[f], LIMITS[f]);
    if (r.error === "html") return fail(locale, "html");
    if (r.error || ((f === "ide" || f === "ide_version") && !r.value)) return fail(locale, f);
    fields[f] = r.value;
  }
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!validEmail(email) || !safeEmail(email)) return fail(locale, "email");
  if (b.consent !== true) return fail(locale, "consent");

  const ts = await turnstile(env, b.turnstile, req.headers.get("CF-Connecting-IP"));
  if (ts === "closed") {
    console.error("TURNSTILE_SECRET neni nastaveny - prihlaska beta testera je zavrena.");
    return out({ error: MSG[locale].closed }, 503);
  }
  if (ts !== "ok") return out({ error: MSG[locale].verify }, 403);

  // Jedna otevrena prihlaska na e-mail: dalsi odeslani nic nezaklada (odpoved stejna - formular neprozradi,
  // kdo uz se prihlasil). Novou lze podat, az je predchozi vyrizena (declined / done).
  const open = await env.DB.prepare("SELECT id FROM beta_applications WHERE email = ? AND status IN ('new', 'accepted')").bind(email).first();
  if (open) return out({ ok: true, message: MSG[locale].ok });

  const id = newId();
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO beta_applications (id, created_at, updated_at, platforms, ide, ide_version, name, company, email, locale, consent_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
  ).bind(id, at, at, platforms.join(","), fields.ide, fields.ide_version, fields.name, fields.company, email, locale, at).run();

  const names = platformList(platforms);
  const ide = `${fields.ide} ${fields.ide_version}`;
  try {
    // Potvrzeni jde na adresu, kterou zadal kdokoli: volny text zadatele jen bez odkazu a zkraceny
    await sendBetaConfirmation(env, { to: email, locale, platforms: names, ide: echoSafe(ide) });
  } catch (err) {
    console.error("Beta: potvrzeni zadateli se nepodarilo odeslat:", err?.message ?? err);
  }
  const notify = String(env.BETA_NOTIFY_TO || env.MAIL_REPLY_TO || "").trim();
  if (validEmail(notify)) {
    try {
      await sendBetaNotice(env, { to: notify, id, platforms: names, ide, locale });
    } catch (err) {
      console.error("Beta: upozorneni provozovateli se nepodarilo odeslat:", err?.message ?? err);
    }
  }
  return out({ ok: true, message: MSG[locale].ok });
}

// ------------------------------------------------------------ sprava (prihlaseni, CSRF a smerovani: admin.js)

const shortId = (id) => String(id).slice(0, 8);
const COLS = "id, created_at, updated_at, platforms, ide, ide_version, name, company, email, locale, consent_at, status, note, crm_lead_id, license_key";

async function loadApp(env, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { res: out({ error: "bad id" }, 400) };
  const app = await env.DB.prepare(`SELECT ${COLS} FROM beta_applications WHERE id = ?`).bind(id).first();
  if (!app) return { res: out({ error: "not found" }, 404) };
  return { app };
}

const withNames = (a) => ({ ...a, platform_names: String(a.platforms || "").split(",").filter(Boolean).map(platformName) });

async function handleList(req, env, ctx) {
  const st = String(ctx.url.searchParams.get("status") ?? "");
  const status = BETA_STATES.includes(st) ? st : "";
  const page = Math.min(Math.max(Math.floor(num(ctx.url.searchParams.get("page"))) || 1, 1), 10000);
  const [cnt, rows, counts] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM beta_applications WHERE (?1 = '' OR status = ?1)").bind(status).first(),
    env.DB.prepare(`SELECT ${COLS} FROM beta_applications WHERE (?1 = '' OR status = ?1) ORDER BY created_at DESC, id LIMIT ?2 OFFSET ?3`)
      .bind(status, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM beta_applications GROUP BY status").all(),
  ]);
  const total = num(cnt?.n);
  return out({
    status, page, page_size: PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    states: BETA_STATES, platforms: BETA_PLATFORMS.map((k) => ({ key: k, name: platformName(k) })),
    counts: Object.fromEntries(BETA_STATES.map((s) => [s, num((counts.results || []).find((r) => r.status === s)?.n)])),
    applications: (rows.results || []).map(withNames),
  });
}

async function handleGet(req, env, ctx) {
  const { app, res } = await loadApp(env, ctx.url.searchParams.get("id"));
  if (res) return res;
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "beta_view", target: shortId(app.id), ip: ctx.ip });
  return out({ application: withNames(app), states: BETA_STATES });
}

async function handleUpdate(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { app, res } = await loadApp(env, p.body.id);
  if (res) return res;
  const set = {};
  if ("status" in p.body) {
    if (!BETA_STATES.includes(p.body.status)) return out({ error: "bad status" }, 400);
    set.status = p.body.status;
  }
  if ("note" in p.body) {
    if (p.body.note != null && typeof p.body.note !== "string") return out({ error: "bad note" }, 400);
    // poznamka smi byt viceradkova; ridici znaky krome konce radku pryc, < > ne (zadne HTML v datech)
    const s = String(p.body.note ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
    if (s.length > LIMITS.note || /[<>]/.test(s)) return out({ error: "bad note" }, 400);
    set.note = s || null;
  }
  if ("license_key" in p.body) {
    const k = p.body.license_key == null || p.body.license_key === "" ? null : String(p.body.license_key).trim().toUpperCase();
    if (k !== null && !/^PLCD-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(k)) return out({ error: "bad key" }, 400);
    set.license_key = k;
  }
  const cols = Object.keys(set).filter((k) => (set[k] ?? null) !== (app[k] ?? null));
  if (!Object.keys(set).length) return out({ error: "nothing to update" }, 400);
  if (!cols.length) return out({ ok: true, unchanged: true, application: withNames(app) });
  const at = nowIso();
  // nazvy sloupcu jen z pevneho seznamu (status, note, license_key), hodnoty jako parametry
  await env.DB.prepare(`UPDATE beta_applications SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((k) => set[k]), at, app.id).run();
  const detail = [
    cols.includes("status") ? `${app.status} -> ${set.status}` : null,
    cols.includes("note") ? `poznamka ${set.note ? set.note.length : 0} znaku` : null,
    cols.includes("license_key") ? "licence" : null,
  ].filter(Boolean).join(", ");
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "beta_update", target: shortId(app.id), detail, ip: ctx.ip });
  return out({ ok: true, changed: cols, application: withNames({ ...app, ...set, updated_at: at }) });
}

// Karta kanbanu z prihlasky: firma (jen kdyz ji zadatel vyplnil), platformy, IDE a odkaz na prihlasku.
// E-mail, jmeno ani telefon se do karty NEPRENASEJI. Karta uz existuje -> vrati ji (zadna duplicita).
async function handleCrm(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { app, res } = await loadApp(env, p.body.id);
  if (res) return res;
  if (app.crm_lead_id) {
    const ex = await env.DB.prepare("SELECT id FROM crm_leads WHERE id = ?").bind(app.crm_lead_id).first();
    if (ex) return out({ ok: true, already: true, lead_id: ex.id });
  }
  const names = String(app.platforms || "").split(",").filter(Boolean).map(platformName);
  const company = clip(app.company || `Beta tester ${shortId(app.id)} (${names.join(", ")})`, 200);
  const id = newId();
  const at = nowIso();
  let link = null;
  try {
    link = new URL(`/sprava/#/beta/${encodeURIComponent(app.id)}`, env.PUBLIC_SITE).href;
  } catch {
    link = null;
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO crm_leads (id, email, company, contact_name, website, domain, phone, segment, source, source_url, stage,
                              value_note, next_action, created_at, updated_at)
       VALUES (?, NULL, ?, NULL, NULL, NULL, NULL, 'jine', 'beta', ?, 'trial', ?, ?, ?, ?)`
    ).bind(id, company, link, clip(`Beta: ${names.join(", ")} · ${app.ide} ${app.ide_version}`, 200), "Čeká na protokol beta testu", at, at),
    env.DB.prepare("INSERT INTO crm_events (lead_id, at, actor, type, text) VALUES (?, ?, ?, 'import', 'beta')").bind(id, at, clip(ctx.actor, 254)),
    env.DB.prepare("UPDATE beta_applications SET crm_lead_id = ?, updated_at = ? WHERE id = ?").bind(id, at, app.id),
  ]);
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "beta_crm", target: shortId(app.id), detail: `karta ${shortId(id)}`, ip: ctx.ip });
  return out({ ok: true, created: true, lead_id: id });
}

export const BETA_ROUTES = {
  "GET /api/admin/beta": { fn: handleList },
  "GET /api/admin/beta/app": { fn: handleGet },
  "POST /api/admin/beta": { fn: handleUpdate },
  "POST /api/admin/beta/crm": { fn: handleCrm },
};
