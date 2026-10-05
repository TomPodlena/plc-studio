// Sprava: obchodni kanban leadu (/api/admin/crm*). Smerovani, prihlaseni, CSRF a audit dela admin.js -
// sem prijde jen overeny pozadavek (ctx.actor, ctx.via, ctx.ip, ctx.url).
//
// Model (schema_admin.sql): crm_leads (karta = firma) + crm_events (historie). Web leady (tabulka leads
// z formulare ke stazeni) se do kanbanu promitnou samy pri nacteni tabule jako faze "new" - bez duplicit
// podle e-mailu; smazana karta s e-mailem jde do crm_suppressed, aby ji synchronizace nevratila.
// Aktivni licence k e-mailu karty = jen navrh "won" (suggest), rucne nastavenou fazi nic neprepisuje.
//
// Hromadne zapisy (synchronizace, import az 500 radku) jdou jednim prikazem pres json_each(?):
// D1 ma limit dotazu na jedno spusteni Workeru a 100 parametru na prikaz - po radcich by to neproslo.
// Osobni udaje: u leadu z pruzkumu jen firemni udaje - import jmeno a telefon zahodi (a rekne kolik),
// contact_name / phone / email jsou pro rucni doplneni.

import { out, readJson, audit, toCsv, csvResponse, likePattern, clip, nowIso } from "./admin_util.js";
import { newId } from "./license.js";

export const CRM_STAGES = ["prospect", "new", "contacted", "trial", "offer", "won", "lost"];
export const CRM_SEGMENTS = ["integrator", "strojirna", "vyrobce", "jine"];
export const CRM_SOURCES = ["web_form", "research", "manual", "import"];
export const IMPORT_MAX = 500;
const IMPORT_BODY = 768 * 1024;
const BOARD_MAX = 5000;      // karet nactenych do tabule
const COLUMN_MAX = 200;      // karet zobrazenych v jednom sloupci (pocet a soucet jsou ze vsech)
const SYNC_BATCH = 500;
const EVENTS_MAX = 200;
const EXPORT_MAX = 50000;
const REPORT_MAX = 100;      // radku v nahledu importu (duplicity, chyby)

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const validEmail = (s) => typeof s === "string" && s.length < 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Bezplatne schranky: domena neni firma (karta z formulare pak nese e-mail misto firmy a nema web)
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "seznam.cz", "email.cz", "post.cz", "centrum.cz", "atlas.cz", "volny.cz", "tiscali.cz",
  "azet.sk", "zoznam.sk", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.de", "gmx.net", "gmx.at", "web.de", "t-online.de", "freenet.de",
  "mail.ru", "yandex.ru", "qq.com", "163.com", "126.com", "wp.pl", "o2.pl", "interia.pl",
]);
// Zeme z narodni domeny (jen jednoznacne; .eu, .com, .io apod. nic)
const CC_TLD = { cz: "CZ", sk: "SK", de: "DE", at: "AT", ch: "CH", pl: "PL", hu: "HU", si: "SI", es: "ES", fr: "FR", it: "IT", nl: "NL", be: "BE", uk: "GB", cn: "CN", se: "SE", dk: "DK", fi: "FI", no: "NO", pt: "PT", ro: "RO" };
const COUNTRY_NAMES = {
  cesko: "CZ", "ceska republika": "CZ", czechia: "CZ", "czech republic": "CZ", tschechien: "CZ", slovensko: "SK", slovakia: "SK",
  slowakei: "SK", nemecko: "DE", germany: "DE", deutschland: "DE", rakousko: "AT", austria: "AT", osterreich: "AT",
  polsko: "PL", poland: "PL", polen: "PL", svycarsko: "CH", switzerland: "CH", schweiz: "CH", madarsko: "HU", hungary: "HU",
  spanelsko: "ES", spain: "ES", espana: "ES", cina: "CN", china: "CN",
};
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const SEGMENT_ALIASES = {
  integrator: "integrator", integrators: "integrator", "system integrator": "integrator", systemintegrator: "integrator",
  strojirna: "strojirna", "machine builder": "strojirna", maschinenbau: "strojirna", maschinenbauer: "strojirna", "machine building": "strojirna",
  vyrobce: "vyrobce", manufacturer: "vyrobce", oem: "vyrobce", hersteller: "vyrobce", producer: "vyrobce",
  jine: "jine", other: "jine", sonstige: "jine",
};

// Domena z webu nebo e-mailu: male pismena, bez protokolu, www., cesty a portu. Neplatna -> null.
export function domainOf(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@") && !s.includes("/")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  if (/[@\s\\]/.test(s.split(/[/?#]/)[0])) return null;
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(s) ? s : null;
}
const countryOfDomain = (d) => (d ? CC_TLD[d.slice(d.lastIndexOf(".") + 1)] ?? null : null);

// Web jen http(s) (v UI je z nej odkaz). Holou domenu doplni na https://.
function normWebsite(v) {
  const s = String(v ?? "").trim();
  if (!s) return { value: null, domain: null };
  if (s.length > 300) return { error: "bad website" };
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return { error: "bad website" };
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { error: "bad website" };
  const domain = domainOf(u.hostname);
  if (!domain) return { error: "bad website" };
  return { value: u.href.replace(/\/$/, ""), domain };
}
function normUrl(v, max = 500) {
  const s = String(v ?? "").trim();
  if (!s) return { value: null };
  if (s.length > max) return { error: "bad source_url" };
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { error: "bad source_url" };
    return { value: u.href };
  } catch {
    return { error: "bad source_url" };
  }
}
function normCountry(v) {
  const s = String(v ?? "").trim();
  if (!s) return { value: null };
  if (/^[A-Za-z]{2}$/.test(s)) return { value: s.toUpperCase() === "UK" ? "GB" : s.toUpperCase() };
  const c = COUNTRY_NAMES[fold(s)];
  return c ? { value: c } : { error: "bad country" };
}
const normSegment = (v) => SEGMENT_ALIASES[fold(v)] ?? null;
function normDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return { value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: "bad next_date" };
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s || s < "2000-01-01" || s > "2100-12-31") return { error: "bad next_date" };
  return { value: s };
}
// Text: oriznout, ridici znaky pryc (krome konce radku), prazdny -> null, delsi nez max -> chyba
function normText(v, max, field, { multiline = false } = {}) {
  if (v == null) return { value: null };
  if (typeof v !== "string" && typeof v !== "number") return { error: `bad ${field}` };
  let s = String(v).replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ").trim();
  if (!s) return { value: null };
  if (s.length > max) return { error: `bad ${field}` };
  return { value: s };
}

// Pole karty, ktera jde menit pres POST /crm/lead (faze jen pres /crm/move, zdroj jen pri zalozeni).
const FIELDS = {
  company: (v) => {
    const r = normText(v, 200, "company");
    return r.error || !r.value ? { error: "bad company" } : r;
  },
  email: (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) return { value: null };
    return validEmail(s) ? { value: s } : { error: "bad email" };
  },
  contact_name: (v) => normText(v, 120, "contact_name"),
  website: (v) => normWebsite(v),
  phone: (v) => {
    const r = normText(v, 40, "phone");
    return r.value && !/^[0-9+()/.\s-]{3,40}$/.test(r.value) ? { error: "bad phone" } : r;
  },
  segment: (v) => {
    const s = normSegment(v);
    return s ? { value: s } : { error: "bad segment" };
  },
  country: normCountry,
  city: (v) => normText(v, 100, "city"),
  source_url: (v) => normUrl(v),
  value_czk: (v) => {
    if (v == null || v === "") return { value: null };
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 1e9 ? { value: n } : { error: "bad value_czk" };
  },
  value_note: (v) => normText(v, 200, "value_note"),
  next_action: (v) => normText(v, 200, "next_action"),
  next_date: normDate,
  owner: (v) => normText(v, 100, "owner"),
  lost_reason: (v) => normText(v, 300, "lost_reason"),
};
const FIELD_NAMES = Object.keys(FIELDS);

// {fields, domain} nebo {error}. partial = jen poslana pole (uprava).
function cleanLead(body, partial) {
  const fields = {};
  let domain;
  for (const f of FIELD_NAMES) {
    if (!(f in body)) {
      if (partial) continue;
      if (f === "company") return { error: "bad company" };
      if (f === "segment") { fields.segment = "jine"; continue; }
    }
    const r = FIELDS[f](body[f]);
    if (r.error) return { error: r.error };
    fields[f] = r.value;
    if (f === "website") domain = r.domain;
  }
  return { fields, domain };
}

// Domena pro deduplikaci: z webu, jinak z firemniho e-mailu (bezplatne schranky ne)
function dedupDomain(websiteDomain, email) {
  if (websiteDomain) return websiteDomain;
  const d = email ? domainOf(email) : null;
  return d && !FREE_MAIL.has(d) ? d : null;
}

// Karty s aktivni licenci / se zakaznikem ve sprave (podle e-mailu). ?1 = ted.
const LICENSED_SQL = "(c.email IS NOT NULL AND EXISTS (SELECT 1 FROM licenses x WHERE x.email = c.email AND x.status = 'active' AND x.valid_until >= ?1))";
const CUSTOMER_SQL = `(c.email IS NOT NULL AND (EXISTS (SELECT 1 FROM leads l WHERE l.email = c.email)
  OR EXISTS (SELECT 1 FROM licenses x WHERE x.email = c.email) OR EXISTS (SELECT 1 FROM project_unlocks u WHERE u.email = c.email)))`;

const shortTarget = (lead) => `${clip(lead.company, 120)} (${String(lead.id).slice(0, 8)})`;

async function addEvent(env, leadId, actor, type, text) {
  await env.DB.prepare("INSERT INTO crm_events (lead_id, at, actor, type, text) VALUES (?, ?, ?, ?, ?)")
    .bind(leadId, nowIso(), clip(actor, 254), type, clip(text, 2000))
    .run();
}

async function loadLead(env, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { res: out({ error: "bad id" }, 400) };
  const lead = await env.DB.prepare("SELECT * FROM crm_leads WHERE id = ?").bind(id).first();
  if (!lead) return { res: out({ error: "not found" }, 404) };
  return { lead };
}

// ------------------------------------------------------------ synchronizace z formulare ke stazeni

// Web leady bez karty -> karty ve fazi "new". Vraci pocet novych karet.
export async function syncWebLeads(env) {
  const rows = (await env.DB.prepare(
    `SELECT l.email, l.created_at FROM leads l
     WHERE NOT EXISTS (SELECT 1 FROM crm_leads c WHERE c.email = l.email)
       AND NOT EXISTS (SELECT 1 FROM crm_suppressed s WHERE s.email = l.email)
     ORDER BY l.created_at LIMIT ?`
  ).bind(SYNC_BATCH).all()).results || [];
  if (!rows.length) return 0;
  const now = nowIso();
  const cards = [];
  for (const r of rows) {
    const email = String(r.email || "").toLowerCase();
    if (!validEmail(email)) continue;
    const d = domainOf(email);
    const free = !d || FREE_MAIL.has(d);
    cards.push({
      id: newId(), email, company: free ? email : d, website: free ? null : `https://${d}`, domain: free ? null : d,
      country: free ? null : countryOfDomain(d), created_at: r.created_at || now,
    });
  }
  if (!cards.length) return 0;
  const json = JSON.stringify(cards);
  // OR IGNORE: dve soubezna nacteni tabule nezalozi kartu dvakrat (unikatni e-mail); udalost jen k vlozene karte
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO crm_leads (id, email, company, website, domain, segment, country, source, stage, created_at, updated_at)
       SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.email'), json_extract(j.value, '$.company'),
              json_extract(j.value, '$.website'), json_extract(j.value, '$.domain'), 'jine', json_extract(j.value, '$.country'),
              'web_form', 'new', json_extract(j.value, '$.created_at'), ?2
       FROM json_each(?1) j`
    ).bind(json, now),
    env.DB.prepare(
      `INSERT INTO crm_events (lead_id, at, actor, type, text)
       SELECT json_extract(j.value, '$.id'), ?2, 'system', 'import', 'web_form'
       FROM json_each(?1) j WHERE EXISTS (SELECT 1 FROM crm_leads c WHERE c.id = json_extract(j.value, '$.id'))`
    ).bind(json, now),
  ]);
  return cards.length;
}

// ------------------------------------------------------------ tabule

function boardFilter(url) {
  const seg = String(url.searchParams.get("segment") ?? "");
  const cc = String(url.searchParams.get("country") ?? "").toUpperCase();
  const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 100);
  return { segment: CRM_SEGMENTS.includes(seg) ? seg : "", country: /^[A-Z]{2}$/.test(cc) ? cc : "", q };
}

async function handleBoard(req, env, ctx) {
  const synced = await syncWebLeads(env);
  if (synced) await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_sync", detail: `${synced} z formulare`, ip: ctx.ip });
  const f = boardFilter(ctx.url);
  const now = nowIso();
  const where = `WHERE (?2 = '' OR c.segment = ?2) AND (?3 = '' OR c.country = ?3)
    AND (?4 = '' OR c.company LIKE ?5 ESCAPE '\\' OR c.city LIKE ?5 ESCAPE '\\' OR c.email LIKE ?5 ESCAPE '\\'
         OR c.website LIKE ?5 ESCAPE '\\' OR c.next_action LIKE ?5 ESCAPE '\\' OR c.contact_name LIKE ?5 ESCAPE '\\'
         OR c.value_note LIKE ?5 ESCAPE '\\' OR c.owner LIKE ?5 ESCAPE '\\')`;
  const [rows, countries, total] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, c.company, c.segment, c.country, c.city, c.source, c.stage, c.next_action, c.next_date, c.value_czk,
              c.owner, c.updated_at, ${LICENSED_SQL} AS licensed
       FROM crm_leads c ${where}
       ORDER BY (c.next_date IS NULL), c.next_date, c.updated_at DESC LIMIT ?6`
    ).bind(now, f.segment, f.country, f.q, likePattern(f.q), BOARD_MAX).all(),
    env.DB.prepare("SELECT country, COUNT(*) AS n FROM crm_leads WHERE country IS NOT NULL GROUP BY country ORDER BY country").all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM crm_leads").first(),
  ]);
  const columns = Object.fromEntries(CRM_STAGES.map((s) => [s, { count: 0, value_czk: 0, cards: [] }]));
  for (const r of rows.results || []) {
    const col = columns[r.stage] || columns.prospect;
    col.count++;
    col.value_czk += Number(r.value_czk) || 0;
    const licensed = !!Number(r.licensed);
    if (col.cards.length < COLUMN_MAX) col.cards.push({ ...r, licensed, suggest: licensed && r.stage !== "won" ? "won" : null });
  }
  return out({
    stages: CRM_STAGES, segments: CRM_SEGMENTS, sources: CRM_SOURCES, filter: f, columns, synced,
    countries: (countries.results || []).map((c) => c.country), total: Number(total?.n) || 0,
    shown: (rows.results || []).length, column_max: COLUMN_MAX, today: now.slice(0, 10), import_max: IMPORT_MAX,
  });
}

// ------------------------------------------------------------ detail, zalozeni, uprava

async function handleLeadGet(req, env, ctx) {
  const { lead, res } = await loadLead(env, ctx.url.searchParams.get("id"));
  if (res) return res;
  const now = nowIso();
  const [flags, events] = await Promise.all([
    env.DB.prepare(`SELECT ${LICENSED_SQL} AS licensed, ${CUSTOMER_SQL} AS customer FROM crm_leads c WHERE c.id = ?2`).bind(now, lead.id).first(),
    env.DB.prepare("SELECT id, at, actor, type, text FROM crm_events WHERE lead_id = ? ORDER BY at DESC, id DESC LIMIT ?").bind(lead.id, EVENTS_MAX).all(),
  ]);
  const licensed = !!Number(flags?.licensed);
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_view", target: shortTarget(lead), ip: ctx.ip });
  return out({ lead, events: events.results || [], licensed, customer: !!Number(flags?.customer), suggest: licensed && lead.stage !== "won" ? "won" : null });
}

// Jina karta se stejnym e-mailem nebo domenou: {id, company, by} nebo null
async function findDuplicate(env, { email, domain }, exceptId = "") {
  if (!email && !domain) return null;
  const r = await env.DB.prepare(
    `SELECT id, company, CASE WHEN ?1 IS NOT NULL AND email = ?1 THEN 'email' ELSE 'domain' END AS by
     FROM crm_leads WHERE id != ?3 AND ((?1 IS NOT NULL AND email = ?1) OR (?2 IS NOT NULL AND domain = ?2))
     ORDER BY (?1 IS NOT NULL AND email = ?1) DESC LIMIT 1`
  ).bind(email ?? null, domain ?? null, exceptId).first();
  return r || null;
}

async function handleLeadSave(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const b = p.body;
  const editing = b.id != null && b.id !== "";
  let lead = null;
  if (editing) {
    const l = await loadLead(env, b.id);
    if (l.res) return l.res;
    lead = l.lead;
  }
  const c = cleanLead(b, editing);
  if (c.error) return out({ error: c.error }, 400);
  const fields = c.fields;
  const now = nowIso();

  const email = "email" in fields ? fields.email : lead?.email ?? null;
  const domain = "website" in fields || "email" in fields
    ? dedupDomain("website" in fields ? c.domain : domainOf(lead?.website), email)
    : lead?.domain ?? null;
  const dup = await findDuplicate(env, { email, domain }, lead?.id ?? "");
  // stejny e-mail nikdy (unikatni index); stejna domena jen s vyslovnym potvrzenim (pobocky, divize)
  if (dup && (dup.by === "email" || b.allow_duplicate !== true)) return out({ error: "duplicate", by: dup.by, id: dup.id, company: dup.company }, 409);

  if (!editing) {
    const stage = b.stage == null || b.stage === "" ? "new" : b.stage;
    if (!CRM_STAGES.includes(stage)) return out({ error: "bad stage" }, 400);
    const id = newId();
    const row = { ...fields, domain, stage, source: "manual", created_at: now, updated_at: now };
    if (stage !== "lost") row.lost_reason = null;
    const cols = Object.keys(row);
    await env.DB.prepare(`INSERT INTO crm_leads (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`)
      .bind(id, ...cols.map((k) => row[k]))
      .run();
    await addEvent(env, id, ctx.actor, "create", "manual");
    await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_lead_create", target: shortTarget({ id, company: row.company }), detail: `stage=${stage}`, ip: ctx.ip });
    return out({ ok: true, id, created: true });
  }

  const changed = Object.keys(fields).filter((k) => (fields[k] ?? null) !== (lead[k] ?? null));
  if (domain !== (lead.domain ?? null)) fields.domain = domain;
  const cols = Object.keys(fields).filter((k) => (fields[k] ?? null) !== (lead[k] ?? null));
  if (!cols.length) return out({ ok: true, id: lead.id, unchanged: true });
  // nazvy sloupcu jen z pevneho seznamu FIELDS (+ domain), hodnoty jako parametry
  await env.DB.prepare(`UPDATE crm_leads SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((k) => fields[k]), now, lead.id)
    .run();
  if (changed.length) await addEvent(env, lead.id, ctx.actor, "edit", changed.join(","));
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_lead_update", target: shortTarget({ ...lead, ...fields }), detail: changed.join(","), ip: ctx.ip });
  return out({ ok: true, id: lead.id, changed });
}

// ------------------------------------------------------------ presun, poznamka, smazani

async function handleMove(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { lead, res } = await loadLead(env, p.body.id);
  if (res) return res;
  const stage = p.body.stage;
  if (!CRM_STAGES.includes(stage)) return out({ error: "bad stage" }, 400);
  const reason = normText(p.body.lost_reason, 300, "lost_reason");
  if (reason.error) return out({ error: reason.error }, 400);
  if (stage === lead.stage) return out({ ok: true, already: true, stage });
  const lostReason = stage === "lost" ? reason.value : null;
  await env.DB.prepare("UPDATE crm_leads SET stage = ?, lost_reason = ?, updated_at = ? WHERE id = ?").bind(stage, lostReason, nowIso(), lead.id).run();
  await addEvent(env, lead.id, ctx.actor, "stage_change", `${lead.stage}>${stage}${lostReason ? "\n" + lostReason : ""}`);
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_move", target: shortTarget(lead), detail: `${lead.stage} -> ${stage}`, ip: ctx.ip });
  return out({ ok: true, stage, from: lead.stage });
}

async function handleNote(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { lead, res } = await loadLead(env, p.body.id);
  if (res) return res;
  const type = p.body.type == null ? "note" : p.body.type;
  if (type !== "note" && type !== "contact") return out({ error: "bad type" }, 400);
  const text = normText(p.body.text, 2000, "body", { multiline: true });
  if (text.error || !text.value) return out({ error: "bad body" }, 400);
  await addEvent(env, lead.id, ctx.actor, type, text.value);
  await env.DB.prepare("UPDATE crm_leads SET updated_at = ? WHERE id = ?").bind(nowIso(), lead.id).run();
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_note", target: shortTarget(lead), detail: `${type}, ${text.value.length} znaku`, ip: ctx.ip });
  return out({ ok: true });
}

// Smazani karty (namitka, chybny zaznam). Karta s e-mailem jde do crm_suppressed, at ji synchronizace
// z formulare ke stazeni nevrati. Zaznam v leads (formular) zustava - ten se maze zvlast.
async function handleDelete(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { lead, res } = await loadLead(env, p.body.id);
  if (res) return res;
  const stmts = [
    env.DB.prepare("DELETE FROM crm_events WHERE lead_id = ?").bind(lead.id),
    env.DB.prepare("DELETE FROM crm_leads WHERE id = ?").bind(lead.id),
  ];
  if (lead.email) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO crm_suppressed (email, at) VALUES (?, ?)").bind(lead.email, nowIso()));
  await env.DB.batch(stmts);
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_delete", target: shortTarget(lead), detail: `source=${lead.source} stage=${lead.stage}`, ip: ctx.ip });
  return out({ ok: true });
}

// ------------------------------------------------------------ import ze souboru pruzkumu

const pick = (r, ...keys) => {
  for (const k of keys) if (r[k] != null && String(r[k]).trim() !== "") return r[k];
  return null;
};
const PERSONAL_KEYS = ["contact_name", "contact", "person", "jmeno", "name_contact", "phone", "telefon", "tel", "mobile"];

// Radek souboru -> {row} nebo {error}. Osobni udaje (jmeno, telefon) se zahazuji.
function importRow(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { error: "bad row" };
  const company = normText(pick(r, "company", "firma", "nazev", "name"), 200, "company");
  if (company.error || !company.value) return { error: "bad company" };
  const web = normWebsite(pick(r, "website", "web", "url", "domain"));
  if (web.error) return { error: web.error };
  const emailRaw = pick(r, "email", "e-mail", "mail");
  const email = emailRaw == null ? null : String(emailRaw).trim().toLowerCase();
  if (email && !validEmail(email)) return { error: "bad email" };
  const src = normUrl(pick(r, "source_url", "zdroj", "source"));
  if (src.error) return { error: src.error };
  const country = normCountry(pick(r, "country", "zeme", "land"));
  const city = normText(pick(r, "city", "mesto", "town", "ort"), 100, "city");
  const note = String(pick(r, "value_note", "note", "poznamka", "notes") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || null;
  const next = normText(pick(r, "next_action"), 200, "next_action");
  const personal = PERSONAL_KEYS.some((k) => r[k] != null && String(r[k]).trim() !== "");
  return {
    personal,
    row: {
      company: company.value, website: web.value, email,
      domain: dedupDomain(web.domain, email),
      segment: normSegment(pick(r, "segment", "typ", "type")) || "jine",
      country: country.value ?? countryOfDomain(web.domain),
      city: city.error ? clip(city.value, 100) : city.value,
      source_url: src.value, value_note: note, next_action: next.error ? null : next.value,
    },
  };
}

async function handleImport(req, env, ctx) {
  const p = await readJson(req, IMPORT_BODY);
  if (p.res) return p.res;
  const list = p.body.leads;
  if (!Array.isArray(list) || !list.length) return out({ error: "bad leads" }, 400);
  if (list.length > IMPORT_MAX) return out({ error: "too many", max: IMPORT_MAX }, 400);
  const dryRun = p.body.dry_run === true;

  const parsed = list.map((r, i) => ({ i: i + 1, ...importRow(r) }));
  const ok = parsed.filter((x) => x.row);
  const emails = [...new Set(ok.map((x) => x.row.email).filter(Boolean))];
  const domains = [...new Set(ok.map((x) => x.row.domain).filter(Boolean))];
  const existing = (await env.DB.prepare(
    `SELECT id, company, email, domain FROM crm_leads
     WHERE email IN (SELECT value FROM json_each(?1)) OR domain IN (SELECT value FROM json_each(?2))`
  ).bind(JSON.stringify(emails), JSON.stringify(domains)).all()).results || [];
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email, e]));
  const byDomain = new Map(existing.filter((e) => e.domain).map((e) => [e.domain, e]));

  const fresh = [], duplicates = [], invalid = [];
  const seenEmail = new Set(), seenDomain = new Set();
  let personal = 0;
  for (const x of parsed) {
    if (x.error) { invalid.push({ row: x.i, error: x.error }); continue; }
    if (x.personal) personal++;
    const r = x.row;
    const hit = (r.email && byEmail.get(r.email)) || (r.domain && byDomain.get(r.domain));
    if (hit) { duplicates.push({ row: x.i, company: r.company, by: r.email && byEmail.has(r.email) ? "email" : "domain", id: hit.id, existing: hit.company }); continue; }
    if ((r.email && seenEmail.has(r.email)) || (r.domain && seenDomain.has(r.domain))) { duplicates.push({ row: x.i, company: r.company, by: "file" }); continue; }
    if (r.email) seenEmail.add(r.email);
    if (r.domain) seenDomain.add(r.domain);
    fresh.push({ ...r, id: newId() });
  }
  const report = {
    total: list.length, new: fresh.length, duplicates: duplicates.length, invalid: invalid.length, personal_ignored: personal,
    duplicate_rows: duplicates.slice(0, REPORT_MAX), invalid_rows: invalid.slice(0, REPORT_MAX),
    sample: fresh.slice(0, 5).map((r) => ({ company: r.company, segment: r.segment, city: r.city, country: r.country })),
  };
  if (dryRun || !fresh.length) return out({ ok: true, dry_run: dryRun, imported: 0, ...report });

  const now = nowIso();
  const json = JSON.stringify(fresh);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO crm_leads (id, email, company, website, domain, segment, country, city, source, source_url,
                                        stage, value_note, next_action, created_at, updated_at)
       SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.email'), json_extract(j.value, '$.company'),
              json_extract(j.value, '$.website'), json_extract(j.value, '$.domain'), json_extract(j.value, '$.segment'),
              json_extract(j.value, '$.country'), json_extract(j.value, '$.city'), 'research', json_extract(j.value, '$.source_url'),
              'prospect', json_extract(j.value, '$.value_note'), json_extract(j.value, '$.next_action'), ?2, ?2
       FROM json_each(?1) j`
    ).bind(json, now),
    env.DB.prepare(
      `INSERT INTO crm_events (lead_id, at, actor, type, text)
       SELECT json_extract(j.value, '$.id'), ?2, ?3, 'import', 'research'
       FROM json_each(?1) j WHERE EXISTS (SELECT 1 FROM crm_leads c WHERE c.id = json_extract(j.value, '$.id'))`
    ).bind(json, now, clip(ctx.actor, 254)),
  ]);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM crm_leads WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))").bind(json).first();
  const imported = Number(n?.n) || 0;
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "crm_import", target: "research",
    detail: `new=${imported} dup=${duplicates.length} invalid=${invalid.length} personal_ignored=${personal}`, ip: ctx.ip });
  return out({ ok: true, dry_run: false, imported, ...report });
}

// ------------------------------------------------------------ export

const EXPORT_COLS = ["id", "company", "segment", "country", "city", "website", "email", "contact_name", "phone", "source", "source_url",
  "stage", "value_czk", "value_note", "next_action", "next_date", "owner", "lost_reason", "created_at", "updated_at"];

async function handleExport(req, env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT ${EXPORT_COLS.join(", ")} FROM crm_leads
     ORDER BY CASE stage WHEN 'prospect' THEN 0 WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'trial' THEN 3
                         WHEN 'offer' THEN 4 WHEN 'won' THEN 5 ELSE 6 END, company LIMIT ?`
  ).bind(EXPORT_MAX).all()).results || [];
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "export", target: "crm", detail: `${rows.length} radku`, ip: ctx.ip });
  return csvResponse(toCsv(EXPORT_COLS, rows), `plcdesk-leady-${nowIso().slice(0, 10)}.csv`);
}

export const CRM_ROUTES = {
  "GET /api/admin/crm": { fn: handleBoard },
  "GET /api/admin/crm/lead": { fn: handleLeadGet },
  "POST /api/admin/crm/lead": { fn: handleLeadSave },
  "POST /api/admin/crm/move": { fn: handleMove },
  "POST /api/admin/crm/note": { fn: handleNote },
  "POST /api/admin/crm/delete": { fn: handleDelete },
  "POST /api/admin/crm/import": { fn: handleImport },
  "GET /api/admin/crm/export.csv": { fn: handleExport },
};
