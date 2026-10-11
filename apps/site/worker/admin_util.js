// Spolecne pomucky spravy (admin.js, crm.js): odpovedi API s bezpecnostnimi hlavickami, cteni JSON
// s limitem velikosti, auditni zaznam, CSV pro cesky Excel. Bez vazby na smerovani (zadny kruhovy import).

export const MAX_BODY = 16 * 1024;

export const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
export const out = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, ...extra } });

export const enc = new TextEncoder();
export const nowIso = () => new Date().toISOString();
export const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
export const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
export const num = (v) => Number(v) || 0;

// Telo jen JSON objekt; limit velikosti (vychozi 16 kB, import leadu vic)
export async function readJson(req, max = MAX_BODY) {
  if (!/^application\/json(\s*;|$)/i.test(req.headers.get("Content-Type") || "")) return { res: out({ error: "unsupported media type" }, 415) };
  if (num(req.headers.get("Content-Length")) > max) return { res: out({ error: "too large" }, 413) };
  const text = await req.text();
  if (enc.encode(text).length > max) return { res: out({ error: "too large" }, 413) };
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return { body: v };
  } catch {
    return { res: out({ error: "bad json" }, 400) };
  }
}

export async function audit(env, { actor, via, action, target = null, detail = null, ip = null }) {
  try {
    await env.DB.prepare("INSERT INTO admin_audit (at, actor, via, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(nowIso(), clip(actor, 254), via, action, clip(target, 300), clip(detail, 500), clip(ip, 64))
      .run();
  } catch (err) {
    console.error("admin_audit: zapis se nezdaril:", err?.message ?? err);
  }
}

// E-mail z verejneho formulare: tvar a@b.cz, bez mezer, ridicich znaku a znaku HTML / CSV / SQL
// (< > " ' ( ) ; , \) a bez vzorce na zacatku (= + - @) - data jdou do spravy, kanbanu, exportu a e-mailu.
const EMAIL_BAD = /[\s<>"'();,\\\p{Cc}\p{Zl}\p{Zp}]/u;
export const safeEmail = (s) =>
  typeof s === "string" && s.length < 254 && !EMAIL_BAD.test(s) && !/^[=+\-@]/.test(s) && /^[^@]+@[^@]+\.[^@.]{2,}$/.test(s);

export const likePattern =(q) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

// Strednik, BOM UTF-8, CRLF (cesky Excel). Bunky zacinajici = + - @ dostanou apostrof
// (ochrana proti vzorcum v Excelu); text s ; " nebo koncem radku jde do uvozovek.
export function csvCell(v) {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (cols, rows) => "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(";"))].join("\r\n") + "\r\n";

// CSV ke stazeni se stejnymi hlavickami jako API (no-store, nosniff, DENY, CSP none)
export function csvResponse(text, filename) {
  return new Response(text, {
    headers: { ...API_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
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

// IP klienta (sprava i verejne formulare s omezenim pokusu): CF-Connecting-IP nastavuje Cloudflare (klient ji nepodvrhne). IPv6 -> prefix /64.
export function clientIp(req) {
  const ip = String(req.headers.get("CF-Connecting-IP") || "").trim().slice(0, 64);
  if (!ip) return "unknown";
  if (ip.includes(":")) {
    const p = expandIPv6(ip);
    return p ? `${p.slice(0, 4).join(":")}::/64` : ip;
  }
  return ip;
}

