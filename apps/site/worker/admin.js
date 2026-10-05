// Sprava zakazniku: API /api/admin/* (stranka /sprava je staticka, viz sprava/).
//
// Prihlaseni - dve cesty, obe ZAVIRAJI pri chybejicim nebo spatnem nastaveni:
//   a) Cloudflare Access (volitelne): ACCESS_TEAM_DOMAIN + ACCESS_AUD (vars). Hlavicka
//      Cf-Access-Jwt-Assertion se overi (RS256 proti certs tymove domeny, aud, iss, exp, nbf)
//      a e-mail musi byt v ADMIN_EMAILS (var, carkami). Prazdne ADMIN_EMAILS = nikdo.
//   b) Token: POST /api/admin/login {token} -> porovnani s ADMIN_TOKEN (pres SHA-256, konstantni
//      cas, neprozradi delku) -> cookie __Host-plcdesk_admin = v1.<exp>.<nonce>.<HMAC>.
//      Klic HMAC je odvozeny z ADMIN_TOKEN (HKDF-SHA256) - rotace tokenu zneplatni vsechny relace.
//      Relace je i v D1 (admin_sessions): odhlaseni ji zneplatni na serveru.
//      Omezeni pokusu: 5 neuspechu z jedne IP (IPv6 /64) za 15 min -> 429. Kazdy neuspech do logu
//      a do auditu.
//   Bez ADMIN_TOKEN i bez Access -> 503.
// Mutace (POST) navic: Origin = PUBLIC_SITE, hlavicka X-Requested-With, Content-Type JSON
// (CSRF); cookie je SameSite=Strict. Pozadavky se Sec-Fetch-Site: cross-site se odmitaji vsechny.
// Skripty: POST /api/admin/license s X-Admin-Token nebo Authorization: Bearer <ADMIN_TOKEN> funguje
// dal (bez cookie a bez Origin - vlastni hlavicku prohlizec cizi strance poslat nenecha).
//
// Data: parametrizovane dotazy (zadne skladani SQL z hodnot), limit velikosti tela, validace,
// do logu ani auditu nejdou cele licencni klice (shortKey) ani otisky pocitacu.

import { signLicense, newLicenseKey, newId, b64url } from "./license.js";
import { sendLicense } from "./email.js";
import { out, enc, nowIso, isoAgo, clip, num, readJson, audit, likePattern, toCsv, csvResponse } from "./admin_util.js";
import { CRM_ROUTES } from "./crm.js";
export { csvCell, toCsv } from "./admin_util.js";

export const ADMIN_COOKIE = "__Host-plcdesk_admin";
export const SESSION_S = 8 * 3600;
const ATTEMPT_WINDOW_MS = 15 * 60e3;
export const MAX_FAILS = 5;
const PAGE_SIZE = 50;
const AUDIT_PAGE = 100;
const EXPORT_MAX = 50000;
const LEEWAY_S = 60; // tolerance hodin pro JWT

export const PLANS = ["pro", "firma", "trial", "free-unlock"];
export const PLAN_DEFAULTS = { pro: { days: 365, seats: 1 }, firma: { days: 365, seats: 5 }, trial: { days: 14, seats: 1 }, "free-unlock": { days: 365, seats: 1 } };
export const CUSTOMER_STATES = ["active", "past_due", "expired", "canceled", "downloaded", "lead"];
const KEY_RE = /^PLCD-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;

// ------------------------------------------------------------ hlavicky stranky

// Stranka /sprava: prisna CSP (zadne inline skripty ani styly, nic odjinud), bez ramcu, bez cache.
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function securePage(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set("Content-Security-Policy", PAGE_CSP);
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("X-Robots-Tag", "noindex, nofollow");
  r.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  r.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  r.headers.delete("ETag");
  return r;
}

// ------------------------------------------------------------ pomocne

const validEmail = (s) => typeof s === "string" && s.length < 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Licencni klic do logu a auditu jen zkraceny: PLCD-ABCD…WXYZ
export const shortKey = (k) => (typeof k === "string" && k.length > 13 ? `${k.slice(0, 9)}…${k.slice(-4)}` : String(k ?? ""));

function b64urlBytes(s) {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

function expandIPv6(ip) {
  if (!/^[0-9a-f:]+$/i.test(ip)) return null; // vcetne IPv4 uvnitr IPv6 -> beze zmeny
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/i.test(p))) return null;
  return parts.map((p) => p.toLowerCase().replace(/^0+(?=.)/, ""));
}

// IP klienta: CF-Connecting-IP nastavuje Cloudflare (klient ji nepodvrhne). IPv6 -> prefix /64.
export function clientIp(req) {
  const ip = String(req.headers.get("CF-Connecting-IP") || "").trim().slice(0, 64);
  if (!ip) return "unknown";
  if (ip.includes(":")) {
    const p = expandIPv6(ip);
    return p ? `${p.slice(0, 4).join(":")}::/64` : ip;
  }
  return ip;
}

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
// Porovnani tokenu: otisky SHA-256 maji stejnou delku -> konstantni cas, delka tokenu neunika
export async function tokenMatches(given, expected) {
  if (typeof given !== "string" || !given || given.length > 1024 || !expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  return bytesEqual(a, b);
}

function getCookie(req, name) {
  for (const part of String(req.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// ------------------------------------------------------------ relace (token)

let keyCache = { fp: null, key: null };
async function sessionKey(env) {
  const fp = b64url(await sha256(env.ADMIN_TOKEN));
  if (keyCache.fp === fp) return keyCache.key;
  const ikm = await crypto.subtle.importKey("raw", enc.encode(env.ADMIN_TOKEN), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("plcdesk-admin-session-v1"), info: enc.encode("cookie-hmac") },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
  keyCache = { fp, key };
  return key;
}

const cookieHeader = (value, maxAge) => `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;

async function newSession(env, ip) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const exp = Math.floor(Date.now() / 1000) + SESSION_S;
  await env.DB.prepare("INSERT INTO admin_sessions (id, created_at, expires_at, ip) VALUES (?, ?, ?, ?)")
    .bind(nonce, nowIso(), new Date(exp * 1000).toISOString(), ip)
    .run();
  const payload = `v1.${exp}.${nonce}`;
  const sig = b64url(await crypto.subtle.sign("HMAC", await sessionKey(env), enc.encode(payload)));
  return { cookie: cookieHeader(`${payload}.${sig}`, SESSION_S), exp };
}

// Platna relace z cookie, nebo null. Podpis se overi drive nez se sahne do databaze.
async function sessionFromCookie(req, env) {
  if (!env.ADMIN_TOKEN) return null;
  const raw = getCookie(req, ADMIN_COOKIE);
  if (!raw || raw.length > 200) return null;
  const m = /^v1\.(\d{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!m) return null;
  const exp = Number(m[1]);
  const nowS = Math.floor(Date.now() / 1000);
  if (exp <= nowS || exp > nowS + SESSION_S + LEEWAY_S) return null;
  const ok = await crypto.subtle.verify("HMAC", await sessionKey(env), b64urlBytes(m[3]), enc.encode(`v1.${m[1]}.${m[2]}`));
  if (!ok) return null;
  const row = await env.DB.prepare("SELECT expires_at, revoked_at FROM admin_sessions WHERE id = ?").bind(m[2]).first();
  if (!row || row.revoked_at || row.expires_at <= nowIso()) return null;
  return { id: m[2], exp };
}

// ------------------------------------------------------------ Cloudflare Access

// null = Access vypnuty; {error} = zapnuty, ale nastaveni je chybne (overeni pak vzdy selze)
export function accessConfig(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").trim();
  const aud = String(env.ACCESS_AUD || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!team || !aud.length) return null;
  let host = team.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!host.includes(".")) host += ".cloudflareaccess.com";
  // klice se smi stahovat jen z tymove domeny Cloudflare Access - ne z libovolne adresy
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host)) return { error: "ACCESS_TEAM_DOMAIN neni <tym>.cloudflareaccess.com" };
  return { issuer: `https://${host}`, certs: `https://${host}/cdn-cgi/access/certs`, aud };
}

const jwks = { url: null, keys: new Map(), at: 0, tried: 0 };
export function _resetAccessCache() {
  Object.assign(jwks, { url: null, keys: new Map(), at: 0, tried: 0 });
}

async function accessKey(cfg, kid) {
  const sameUrl = jwks.url === cfg.certs;
  if (sameUrl && Date.now() - jwks.at < 3600e3 && jwks.keys.has(kid)) return jwks.keys.get(kid);
  // neznamy kid (rotace) nebo stary seznam: stahnout znovu, nejvys jednou za 30 s
  if (sameUrl && Date.now() - jwks.tried < 30e3) return jwks.keys.get(kid) ?? null;
  jwks.tried = Date.now();
  const r = await fetch(cfg.certs, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Access certs ${r.status}`);
  const data = await r.json();
  const keys = new Map();
  for (const k of Array.isArray(data?.keys) ? data.keys : []) {
    if (k.kty !== "RSA" || typeof k.kid !== "string" || (k.alg && k.alg !== "RS256") || (k.use && k.use !== "sig")) continue;
    try {
      keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    } catch {
      /* vadny klic preskocit */
    }
  }
  Object.assign(jwks, { url: cfg.certs, keys, at: Date.now() });
  return keys.get(kid) ?? null;
}

const adminEmails = (env) => String(env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// {email} nebo {error, email?}
export async function verifyAccessJwt(jwt, env, cfg) {
  if (!cfg || cfg.error) return { error: "config" };
  if (typeof jwt !== "string" || jwt.length > 8192) return { error: "malformed" };
  const parts = jwt.split(".");
  if (parts.length !== 3) return { error: "malformed" };
  let header, payload;
  try {
    const dec = new TextDecoder();
    header = JSON.parse(dec.decode(b64urlBytes(parts[0])));
    payload = JSON.parse(dec.decode(b64urlBytes(parts[1])));
  } catch {
    return { error: "malformed" };
  }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string") return { error: "alg" };
  const key = await accessKey(cfg, header.kid);
  if (!key) return { error: "kid" };
  let ok = false;
  try {
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    ok = false;
  }
  if (!ok) return { error: "signature" };
  const nowS = Date.now() / 1000;
  if (payload.iss !== cfg.issuer) return { error: "iss" };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some((a) => cfg.aud.includes(a))) return { error: "aud" };
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_S < nowS) return { error: "exp" };
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY_S > nowS) return { error: "nbf" };
  if (typeof payload.iat === "number" && payload.iat - LEEWAY_S > nowS) return { error: "iat" };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !adminEmails(env).includes(email)) return { error: "email", email };
  return { email };
}

// ------------------------------------------------------------ prihlaseni a ochrana

// {actor, via, session?} nebo {res}
async function authenticate(req, env) {
  const cfg = accessConfig(env);
  if (!env.ADMIN_TOKEN && !cfg) return { res: out({ error: "not configured" }, 503) };
  let denied = false;
  const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
  if (cfg && jwt) {
    if (cfg.error) console.error("Sprava: " + cfg.error);
    try {
      const a = await verifyAccessJwt(jwt, env, cfg);
      if (a.email && !a.error) return { actor: a.email, via: "access" };
      denied = a.error === "email";
      console.warn(`Sprava: Access JWT odmitnut (${a.error}${a.error === "email" ? ": " + clip(a.email, 100) : ""})`);
    } catch (err) {
      console.error("Sprava: overeni Access selhalo:", err?.message ?? err);
    }
  }
  const s = await sessionFromCookie(req, env);
  if (s) return { actor: "token", via: "token", session: s };
  return { res: out({ error: denied ? "forbidden" : "unauthorized" }, denied ? 403 : 401) };
}

function sameOrigin(req, env) {
  let expected;
  try {
    expected = new URL(env.PUBLIC_SITE).origin;
  } catch {
    return false; // bez PUBLIC_SITE zadna mutace
  }
  return req.headers.get("Origin") === expected && !!String(req.headers.get("X-Requested-With") || "").trim();
}

// Kolik neuspesnych pokusu ma IP v okne; {n, retry} (retry v sekundach do uvolneni)
async function failures(env, ip) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(at) AS first FROM admin_attempts WHERE ip = ? AND ok = 0 AND at > ?")
    .bind(ip, isoAgo(ATTEMPT_WINDOW_MS))
    .first();
  const n = num(row?.n);
  const retry = row?.first ? Math.max(1, Math.ceil((Date.parse(row.first) + ATTEMPT_WINDOW_MS - Date.now()) / 1000)) : 0;
  return { n, retry };
}
const tooMany = (f) => out({ error: "too many attempts", retry_after: f.retry }, 429, { "Retry-After": String(f.retry) });

// Uchovani (ochrana osobnich udaju, content/*.json soukromi): pokusy o prihlaseni a jejich zaznamy
// v auditu 30 dni, ostatni audit 3 roky, prosle relace den.
async function cleanup(env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_attempts WHERE at < ?").bind(isoAgo(30 * 864e5)),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(isoAgo(864e5)),
    env.DB.prepare("DELETE FROM admin_audit WHERE at < ? OR (action = 'login_failed' AND at < ?)").bind(isoAgo(3 * 365 * 864e5), isoAgo(30 * 864e5)),
  ]);
}

async function recordFailure(env, req, ip, n, how) {
  await cleanup(env);
  await env.DB.prepare("INSERT INTO admin_attempts (ip, ok, at) VALUES (?, 0, ?)").bind(ip, nowIso()).run();
  console.warn(`Sprava: neuspesne prihlaseni (${how}) z ${ip}, pokus ${n + 1}/${MAX_FAILS}`);
  await audit(env, { actor: "-", via: "-", action: "login_failed", target: how, detail: clip(req.headers.get("User-Agent"), 120), ip });
}

// ------------------------------------------------------------ prihlaseni / odhlaseni

async function handleLogin(req, env, ctx) {
  if (!env.ADMIN_TOKEN) return out({ error: "token login not configured" }, 503);
  if (!sameOrigin(req, env)) return out({ error: "forbidden" }, 403);
  const f = await failures(env, ctx.ip);
  if (f.n >= MAX_FAILS) {
    console.warn(`Sprava: prihlaseni z ${ctx.ip} blokovane (${f.n} neuspechu za 15 min)`);
    return tooMany(f);
  }
  const p = await readJson(req);
  if (p.res) return p.res;
  if (!(await tokenMatches(p.body.token, env.ADMIN_TOKEN))) {
    await recordFailure(env, req, ctx.ip, f.n, "form");
    return out({ error: "unauthorized" }, 401);
  }
  const s = await newSession(env, ctx.ip);
  await env.DB.prepare("DELETE FROM admin_attempts WHERE ip = ?").bind(ctx.ip).run();
  await cleanup(env);
  await audit(env, { actor: "token", via: "token", action: "login", ip: ctx.ip });
  return out({ ok: true, expires_at: new Date(s.exp * 1000).toISOString() }, 200, { "Set-Cookie": s.cookie });
}

async function handleLogout(req, env, ctx) {
  if (!sameOrigin(req, env)) return out({ error: "forbidden" }, 403);
  const s = await sessionFromCookie(req, env);
  if (s) {
    await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE id = ?").bind(nowIso(), s.id).run();
    await audit(env, { actor: "token", via: "token", action: "logout", ip: ctx.ip });
  }
  return out({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
}

async function handleMe(req, env, ctx) {
  return out({
    actor: ctx.actor,
    via: ctx.via,
    expires_at: ctx.session ? new Date(ctx.session.exp * 1000).toISOString() : null,
    mail_mode: env.MAIL_MODE || null,
    plans: PLANS,
    plan_defaults: PLAN_DEFAULTS,
  });
}

// ------------------------------------------------------------ prehled

async function handleSummary(req, env) {
  const d7 = isoAgo(7 * 864e5), d30 = isoAgo(30 * 864e5), n = nowIso();
  const [leads, plans, lic, act, pay, unl] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(created_at >= ?) AS d7, SUM(created_at >= ?) AS d30, SUM(confirmed_at IS NOT NULL) AS downloaded FROM leads").bind(d7, d30).first(),
    env.DB.prepare("SELECT plan, COUNT(*) AS n FROM licenses WHERE status = 'active' AND valid_until >= ? GROUP BY plan ORDER BY plan").bind(n).all(),
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'past_due') AS past_due, SUM(status = 'canceled') AS canceled, SUM(status = 'active' AND valid_until < ?) AS expired FROM licenses").bind(n).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM activations WHERE revoked_at IS NULL").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE received_at >= ?").bind(d30).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM project_unlocks").first(),
  ]);
  const active = Object.fromEntries((plans.results || []).map((r) => [r.plan, num(r.n)]));
  return out({
    leads: { d7: num(leads?.d7), d30: num(leads?.d30), total: num(leads?.total), downloaded: num(leads?.downloaded) },
    licenses: {
      active,
      active_total: Object.values(active).reduce((a, b) => a + b, 0),
      past_due: num(lic?.past_due),
      canceled: num(lic?.canceled),
      expired: num(lic?.expired),
      total: num(lic?.total),
    },
    activations: num(act?.n),
    payments_30d: num(pay?.n),
    unlocks: num(unl?.n),
    generated_at: n,
  });
}

// ------------------------------------------------------------ zakaznici

// Zakaznik = e-mail z leads, licenses nebo project_unlocks. Stav: nejlepsi licence, jinak zajem.
// Parametry: ?1 ted, ?2 hledany text, ?3 vzor LIKE, ?4 stav.
const CUSTOMERS_CTE = `
WITH e AS (
  SELECT email FROM leads UNION SELECT email FROM licenses UNION SELECT email FROM project_unlocks
), c AS (
  SELECT e.email AS email,
    l.created_at AS lead_at,
    l.confirmed_at AS downloaded_at,
    l.locale AS locale,
    (SELECT COUNT(*) FROM licenses x WHERE x.email = e.email) AS licenses,
    (SELECT x.plan FROM licenses x WHERE x.email = e.email
      ORDER BY (x.status = 'active' AND x.valid_until >= ?1) DESC, (x.status != 'canceled') DESC, x.valid_until DESC LIMIT 1) AS plan,
    (SELECT MAX(x.valid_until) FROM licenses x WHERE x.email = e.email AND x.status != 'canceled') AS valid_until,
    (SELECT COUNT(*) FROM activations a JOIN licenses x ON x.key = a.license_key
      WHERE x.email = e.email AND a.revoked_at IS NULL) AS devices,
    CASE
      WHEN EXISTS (SELECT 1 FROM licenses x WHERE x.email = e.email AND x.status = 'active' AND x.valid_until >= ?1) THEN 'active'
      WHEN EXISTS (SELECT 1 FROM licenses x WHERE x.email = e.email AND x.status = 'past_due') THEN 'past_due'
      WHEN EXISTS (SELECT 1 FROM licenses x WHERE x.email = e.email AND x.status = 'active') THEN 'expired'
      WHEN EXISTS (SELECT 1 FROM licenses x WHERE x.email = e.email AND x.status = 'canceled') THEN 'canceled'
      WHEN l.confirmed_at IS NOT NULL THEN 'downloaded'
      ELSE 'lead'
    END AS status,
    MAX(COALESCE(l.created_at, ''), COALESCE(l.confirmed_at, ''),
      COALESCE((SELECT MAX(x.updated_at) FROM licenses x WHERE x.email = e.email), ''),
      COALESCE((SELECT MAX(a.last_seen_at) FROM activations a JOIN licenses x ON x.key = a.license_key WHERE x.email = e.email), ''),
      COALESCE((SELECT MAX(u.granted_at) FROM project_unlocks u WHERE u.email = e.email), '')) AS last_activity
  FROM e LEFT JOIN leads l ON l.email = e.email
)`;
const CUSTOMERS_WHERE = `
WHERE (?2 = '' OR c.email LIKE ?3 ESCAPE '\\'
       OR EXISTS (SELECT 1 FROM licenses x WHERE x.email = c.email AND x.key LIKE ?3 ESCAPE '\\'))
  AND (?4 = '' OR c.status = ?4)`;

function customerFilter(url) {
  const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const st = String(url.searchParams.get("status") ?? "");
  const status = CUSTOMER_STATES.includes(st) ? st : "";
  return { q, status, args: [nowIso(), q, likePattern(q), status] };
}

async function handleCustomers(req, env, ctx) {
  const f = customerFilter(ctx.url);
  const page = Math.min(Math.max(Math.floor(num(ctx.url.searchParams.get("page"))) || 1, 1), 10000);
  const [cnt, rows] = await Promise.all([
    env.DB.prepare(`${CUSTOMERS_CTE} SELECT COUNT(*) AS n FROM c ${CUSTOMERS_WHERE}`).bind(...f.args).first(),
    env.DB.prepare(`${CUSTOMERS_CTE} SELECT * FROM c ${CUSTOMERS_WHERE} ORDER BY c.last_activity DESC, c.email LIMIT ?5 OFFSET ?6`)
      .bind(...f.args, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all(),
  ]);
  const total = num(cnt?.n);
  return out({ q: f.q, status: f.status, page, page_size: PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), customers: rows.results || [] });
}

const emailParam = (s) => {
  const e = String(s ?? "").trim().toLowerCase();
  return e && e.length <= 254 && e.includes("@") && !/\s/.test(e) ? e : null;
};

async function handleCustomer(req, env, ctx) {
  const email = emailParam(ctx.url.searchParams.get("email"));
  if (!email) return out({ error: "bad email" }, 400);
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const [lead, dl, lic, act, pay, unl, notes] = await Promise.all([
    q("SELECT locale, source, terms_accepted_at, created_at, confirmed_at, unsubscribed FROM leads WHERE email = ?", email).first(),
    q(`SELECT COUNT(*) AS links, COALESCE(SUM(t.used_count), 0) AS downloads, MAX(t.created_at) AS last_link
       FROM download_tokens t JOIN leads l ON l.id = t.lead_id WHERE l.email = ?`, email).first(),
    q(`SELECT key, plan, seats, status, valid_until, payment_provider, sub_id, note, created_at, updated_at
       FROM licenses WHERE email = ? ORDER BY created_at DESC`, email).all(),
    q(`SELECT a.id, a.license_key, a.device_hash, a.device_label, a.last_seen_at, a.created_at, a.revoked_at
       FROM activations a JOIN licenses x ON x.key = a.license_key WHERE x.email = ?
       ORDER BY (a.revoked_at IS NULL) DESC, a.last_seen_at DESC LIMIT 500`, email).all(),
    q(`SELECT event_id, provider, type, sub_id, received_at FROM payment_log
       WHERE email = ? OR (sub_id IS NOT NULL AND sub_id IN (SELECT sub_id FROM licenses WHERE email = ? AND sub_id IS NOT NULL))
       ORDER BY received_at DESC LIMIT 200`, email, email).all(),
    q("SELECT project_id, io_count, granted_at, granted_by FROM project_unlocks WHERE email = ? ORDER BY granted_at DESC", email).all(),
    q("SELECT id, body, author, created_at FROM customer_notes WHERE email = ? ORDER BY created_at DESC LIMIT 200", email).all(),
  ]);
  const licenses = lic.results || [];
  if (!lead && !licenses.length && !(unl.results || []).length && !(notes.results || []).length) return out({ error: "not found" }, 404);
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "customer_view", target: email, ip: ctx.ip });
  return out({
    email,
    lead: lead ? { ...lead, links: num(dl?.links), downloads: num(dl?.downloads), last_link: dl?.last_link ?? null } : null,
    licenses,
    // otisk pocitace staci zkraceny - rozliseni pocitacu, ne identifikace
    activations: (act.results || []).map((a) => ({ ...a, device_hash: clip(a.device_hash, 12) })),
    payments: pay.results || [],
    unlocks: unl.results || [],
    notes: notes.results || [],
  });
}

// ------------------------------------------------------------ licence

function validUntilFrom(body, base = Date.now()) {
  if (body.valid_until != null && body.valid_until !== "") {
    const s = String(body.valid_until).trim();
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return { error: "bad valid_until" };
    const t = Date.parse(s.length === 10 ? `${s}T23:59:59.000Z` : s);
    if (!Number.isFinite(t) || t <= Date.now() || t > Date.now() + 10 * 365 * 864e5) return { error: "bad valid_until" };
    return { value: new Date(t).toISOString() };
  }
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: "bad days" };
  return { value: new Date(base + days * 864e5).toISOString() };
}

async function issue(env, ctx, body, { legacy }) {
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!validEmail(email)) return out({ error: "bad email" }, 400);
  let plan, seats;
  if (legacy) {
    // puvodni chovani skriptu: firma, jinak pro; vychozi 365 dni a odeslani e-mailem
    plan = body.plan === "firma" ? "firma" : "pro";
    seats = Math.min(Math.max(Math.floor(num(body.seats)) || 1, 1), 100);
    if (body.valid_until == null && body.days == null) body = { ...body, days: 365 };
    else if (body.days != null) body = { ...body, days: Math.floor(num(body.days)) || 365 };
  } else {
    if (!PLANS.includes(body.plan)) return out({ error: "bad plan" }, 400);
    plan = body.plan;
    seats = body.seats == null || body.seats === "" ? PLAN_DEFAULTS[plan].seats : Number(body.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 100) return out({ error: "bad seats" }, 400);
    if (body.valid_until == null && (body.days == null || body.days === "")) body = { ...body, days: PLAN_DEFAULTS[plan].days };
  }
  const vu = validUntilFrom(body);
  if (vu.error) return out({ error: vu.error }, 400);
  const note = body.note == null ? null : String(body.note).trim().slice(0, 200) || null;
  const key = newLicenseKey();
  // nejdriv podepsat: bez LICENSE_PRIVATE_KEY se nic neulozi (zadna licence bez souboru)
  const file = await signLicense(env, { key, email, plan, seats, validUntil: vu.value });
  await env.DB.prepare(
    `INSERT INTO licenses (key, email, plan, seats, status, valid_until, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(key, email, plan, seats, vu.value, note, nowIso(), nowIso())
    .run();
  const send = legacy ? body.send !== false : body.send === true;
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "license_issue", target: `${email} ${shortKey(key)}`,
    detail: `plan=${plan} seats=${seats} valid_until=${vu.value.slice(0, 10)}${send ? " e-mail" : ""}`, ip: ctx.ip });
  const mail = send ? await mailLicense(env, { to: email, key, file, plan, locale: body.locale }) : { sent: false };
  return out({ ok: true, key, license: file, plan, seats, valid_until: vu.value, ...mail });
}

// Licence uz je ulozena - selhani e-mailu ji nesmi "ztratit": odpoved 200 s mail_error,
// soubor je v odpovedi a provozovatel ho preda sam.
async function mailLicense(env, args) {
  try {
    await sendLicense(env, args);
    return { sent: env.MAIL_MODE !== "direct" };
  } catch (err) {
    console.error("Sprava: e-mail s licenci se nepodarilo odeslat:", err?.message ?? err);
    return { sent: false, mail_error: true };
  }
}

async function loadLicense(env, body) {
  const key = String(body.key ?? "").trim().toUpperCase();
  if (!KEY_RE.test(key)) return { res: out({ error: "bad key" }, 400) };
  const lic = await env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(key).first();
  if (!lic) return { res: out({ error: "not found" }, 404) };
  return { lic };
}

async function extend(env, ctx, body) {
  const { lic, res } = await loadLicense(env, body);
  if (res) return res;
  if (lic.status === "canceled") return out({ error: "canceled" }, 409);
  // prodlouzeni od pozdejsiho z: dnes, dosavadni konec platnosti
  const vu = validUntilFrom(body, Math.max(Date.now(), Date.parse(lic.valid_until) || 0));
  if (vu.error) return out({ error: vu.error }, 400);
  const file = await signLicense(env, { key: lic.key, email: lic.email, plan: lic.plan, seats: lic.seats, validUntil: vu.value });
  await env.DB.prepare("UPDATE licenses SET valid_until = ?, updated_at = ? WHERE key = ?").bind(vu.value, nowIso(), lic.key).run();
  const send = body.send === true;
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "license_extend", target: `${lic.email} ${shortKey(lic.key)}`,
    detail: `${String(lic.valid_until).slice(0, 10)} -> ${vu.value.slice(0, 10)}${send ? " e-mail" : ""}`, ip: ctx.ip });
  const mail = send ? await mailLicense(env, { to: lic.email, key: lic.key, file, plan: lic.plan, locale: body.locale }) : { sent: false };
  return out({ ok: true, key: lic.key, valid_until: vu.value, license: file, ...mail });
}

async function cancel(env, ctx, body) {
  const { lic, res } = await loadLicense(env, body);
  if (res) return res;
  if (lic.status === "canceled") return out({ ok: true, already: true });
  await env.DB.prepare("UPDATE licenses SET status = 'canceled', updated_at = ? WHERE key = ?").bind(nowIso(), lic.key).run();
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "license_cancel", target: `${lic.email} ${shortKey(lic.key)}`,
    detail: lic.sub_id ? `predplatne ${lic.payment_provider || "?"} zustava` : null, ip: ctx.ip });
  // predplatne u Stripe/Paddle Worker nerusi - to musi provozovatel udelat u poskytovatele
  return out({ ok: true, key: lic.key, subscription_provider: lic.sub_id ? lic.payment_provider || "unknown" : null });
}

async function handleLicense(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const action = p.body.action ?? "issue";
  if (ctx.legacy && action !== "issue") return out({ error: "bad action" }, 400);
  if (action === "issue") return issue(env, ctx, p.body, { legacy: !!ctx.legacy });
  if (action === "extend") return extend(env, ctx, p.body);
  if (action === "cancel") return cancel(env, ctx, p.body);
  return out({ error: "bad action" }, 400);
}

// Skriptova cesta: X-Admin-Token nebo Authorization: Bearer (puvodni POST /api/admin/license)
function headerToken(req) {
  if (req.headers.has("X-Admin-Token")) return req.headers.get("X-Admin-Token");
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") || "");
  return m ? m[1].trim() : null;
}

async function handleLegacyLicense(req, env, ctx, token) {
  if (!env.ADMIN_TOKEN) return out({ error: "not configured" }, 503);
  const f = await failures(env, ctx.ip);
  if (f.n >= MAX_FAILS) return tooMany(f);
  if (!(await tokenMatches(token, env.ADMIN_TOKEN))) {
    await recordFailure(env, req, ctx.ip, f.n, "api");
    return out({ error: "unauthorized" }, 401);
  }
  return handleLicense(req, env, { ...ctx, actor: "token-api", via: "token-api", legacy: true });
}

// ------------------------------------------------------------ pocitace a poznamky

async function handleRelease(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const id = String(p.body.id ?? "");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return out({ error: "bad id" }, 400);
  const a = await env.DB.prepare(
    "SELECT a.id, a.license_key, a.device_label, a.revoked_at, x.email FROM activations a JOIN licenses x ON x.key = a.license_key WHERE a.id = ?"
  )
    .bind(id)
    .first();
  if (!a) return out({ error: "not found" }, 404);
  if (a.revoked_at) return out({ ok: true, already: true });
  await env.DB.prepare("UPDATE activations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(nowIso(), id).run();
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "activation_release", target: `${a.email} ${shortKey(a.license_key)}`,
    detail: clip(a.device_label, 100), ip: ctx.ip });
  return out({ ok: true });
}

async function customerExists(env, email) {
  const r = await env.DB.prepare(
    `SELECT (EXISTS (SELECT 1 FROM leads WHERE email = ?1) OR EXISTS (SELECT 1 FROM licenses WHERE email = ?1)
       OR EXISTS (SELECT 1 FROM project_unlocks WHERE email = ?1)) AS ok`
  )
    .bind(email)
    .first();
  return !!num(r?.ok);
}

async function handleNote(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const email = emailParam(p.body.email);
  const text = String(p.body.body ?? "").trim();
  if (!email) return out({ error: "bad email" }, 400);
  if (!text || text.length > 2000) return out({ error: "bad body" }, 400);
  if (!(await customerExists(env, email))) return out({ error: "not found" }, 404);
  const id = newId();
  const at = nowIso();
  await env.DB.prepare("INSERT INTO customer_notes (id, email, body, author, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, email, text, ctx.actor, at).run();
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "note_add", target: email, detail: `${text.length} znaku`, ip: ctx.ip });
  return out({ ok: true, note: { id, body: text, author: ctx.actor, created_at: at } });
}

// ------------------------------------------------------------ export CSV a audit

const EXPORTS = {
  customers: {
    cols: ["email", "status", "plan", "licenses", "devices", "valid_until", "lead_at", "downloaded_at", "locale", "last_activity"],
    query: (env) =>
      env.DB.prepare(`${CUSTOMERS_CTE} SELECT * FROM c ${CUSTOMERS_WHERE} ORDER BY c.last_activity DESC, c.email LIMIT ?5`).bind(nowIso(), "", "%", "", EXPORT_MAX),
  },
  licenses: {
    cols: ["key", "email", "plan", "seats", "status", "valid_until", "payment_provider", "sub_id", "note", "active_devices", "created_at", "updated_at"],
    query: (env) =>
      env.DB.prepare(
        `SELECT x.*, (SELECT COUNT(*) FROM activations a WHERE a.license_key = x.key AND a.revoked_at IS NULL) AS active_devices
         FROM licenses x ORDER BY x.created_at DESC LIMIT ?`
      ).bind(EXPORT_MAX),
  },
  leads: {
    cols: ["email", "locale", "source", "terms_accepted_at", "created_at", "confirmed_at", "unsubscribed"],
    query: (env) => env.DB.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT ?").bind(EXPORT_MAX),
  },
};

async function handleExport(req, env, ctx) {
  const type = ctx.url.searchParams.get("type") ?? "customers";
  const ex = EXPORTS[type];
  if (!ex) return out({ error: "bad type" }, 400);
  const rows = (await ex.query(env).all()).results || [];
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "export", target: type, detail: `${rows.length} radku`, ip: ctx.ip });
  return csvResponse(toCsv(ex.cols, rows), `plcdesk-${type}-${nowIso().slice(0, 10)}.csv`);
}

async function handleAudit(req, env, ctx) {
  const q = String(ctx.url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const page = Math.min(Math.max(Math.floor(num(ctx.url.searchParams.get("page"))) || 1, 1), 10000);
  const where = "WHERE (?1 = '' OR actor LIKE ?2 ESCAPE '\\' OR action LIKE ?2 ESCAPE '\\' OR target LIKE ?2 ESCAPE '\\' OR ip LIKE ?2 ESCAPE '\\')";
  const [cnt, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit ${where}`).bind(q, likePattern(q)).first(),
    env.DB.prepare(`SELECT id, at, actor, via, action, target, detail, ip FROM admin_audit ${where} ORDER BY id DESC LIMIT ?3 OFFSET ?4`)
      .bind(q, likePattern(q), AUDIT_PAGE, (page - 1) * AUDIT_PAGE)
      .all(),
  ]);
  const total = num(cnt?.n);
  return out({ q, page, page_size: AUDIT_PAGE, total, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE)), entries: rows.results || [] });
}

// ------------------------------------------------------------ smerovani

const ROUTES = {
  "POST /api/admin/login": { fn: handleLogin, open: true },
  "POST /api/admin/logout": { fn: handleLogout, open: true },
  "GET /api/admin/me": { fn: handleMe },
  "GET /api/admin/summary": { fn: handleSummary },
  "GET /api/admin/customers": { fn: handleCustomers },
  "GET /api/admin/customer": { fn: handleCustomer },
  "POST /api/admin/license": { fn: handleLicense },
  "POST /api/admin/activation/release": { fn: handleRelease },
  "POST /api/admin/note": { fn: handleNote },
  "GET /api/admin/export.csv": { fn: handleExport },
  "GET /api/admin/audit": { fn: handleAudit },
  // obchodni kanban leadu (crm.js) - stejne prihlaseni, CSRF i audit jako zbytek spravy
  ...CRM_ROUTES,
};
export const ADMIN_PATHS = [...new Set(Object.keys(ROUTES).map((r) => r.split(" ")[1]))];

export async function handleAdmin(req, env) {
  const url = new URL(req.url);
  try {
    const route = ROUTES[`${req.method} ${url.pathname}`];
    if (!route) {
      const known = ADMIN_PATHS.includes(url.pathname);
      return out({ error: known ? "method not allowed" : "not found" }, known ? 405 : 404);
    }
    if (req.headers.get("Sec-Fetch-Site") === "cross-site") return out({ error: "forbidden" }, 403);
    const ctx = { url, ip: clientIp(req) };

    if (url.pathname === "/api/admin/license" && req.method === "POST") {
      const token = headerToken(req);
      if (token !== null) return await handleLegacyLicense(req, env, ctx, token);
    }
    if (route.open) return await route.fn(req, env, ctx);

    const auth = await authenticate(req, env);
    if (auth.res) return auth.res;
    if (req.method !== "GET" && !sameOrigin(req, env)) return out({ error: "forbidden" }, 403);
    return await route.fn(req, env, { ...ctx, actor: auth.actor, via: auth.via, session: auth.session });
  } catch (err) {
    console.error("Sprava:", err?.stack ?? String(err));
    return out({ error: "server error" }, 500);
  }
}
