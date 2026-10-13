// Zpetna vazba z aplikace PLCdesk (web i desktop) do spravy webu.
//
//   OPTIONS /api/feedback           preflight CORS - webova aplikace muze bezet z jineho originu
//   POST    /api/feedback           verejny prijem: typ, text, volitelne e-mail pro odpoved, kontext aplikace,
//                                   volitelne prilozeny projekt (jen s attach_project === true, max. 512 kB)
//   GET     /api/admin/feedback               seznam (filtr stavu a typu, pocty, strankovani) - pres admin.js
//   GET     /api/admin/feedback/item          detail (audit feedback_view; "new" se prepne na "read")
//   POST    /api/admin/feedback               stav, poznamka, smazani prilozeneho projektu (audit feedback_update)
//   GET     /api/admin/feedback/project       stazeni prilozeneho projektu (attachment, nosniff; audit)
//   POST    /api/admin/feedback/delete        smazani zaznamu (GDPR; audit feedback_delete)
//
// Ochrana verejneho endpointu (Turnstile NE - desktop ho neumi): JSON objekt s limitem velikosti (readJson),
// hlavicka X-PLCdesk-Client (web | desktop) shodna s polem client, past na boty (skryte pole web), validace
// a limity delek na serveru, limit pokusu z IP (ratelimit.js, bucket feedback 10 / h). CORS jen tady:
// Access-Control-Allow-Origin * BEZ credentials (zadne cookie), jen POST s Content-Type a hlavickou klienta.
// Uzivateli se nic neposila (formular neni posta na cizi adresy). Provozovatel dostane upozorneni (email.js,
// MAIL_OWNER, jinak BETA_NOTIFY_TO, jinak MAIL_REPLY_TO) jen s typem, krokem, verzi a odkazem do spravy -
// bez textu a bez e-mailu. Selhani posty zaznam neztrati (uz je ulozeny).
// Audit spravy: jen zkracene id, typ a zmena stavu - text, e-mail ani obsah poznamky do auditu nejdou.

import { out, readJson, audit, nowIso, isoAgo, num, enc, safeEmail, API_HEADERS } from "./admin_util.js";
import { overLimit } from "./ratelimit.js";
import { newId } from "./license.js";
import { sendFeedbackNotice } from "./email.js";

export const FEEDBACK_KINDS = ["bug", "idea", "question"];
export const FEEDBACK_STATES = ["new", "read", "done", "wontfix"];
export const FEEDBACK_CLIENTS = ["web", "desktop"];
export const TEXT_MAX = 5000;
export const PROJECT_MAX = 512 * 1024;          // serializovany projekt (UTF-8 bajty)
const BODY_MAX = PROJECT_MAX + 96 * 1024;       // telo pozadavku: projekt + text + kontext
const NOTE_MAX = 2000;
const PAGE_SIZE = 50;
const KEEP_MS = 2 * 365 * 864e5;                // uchovani nejdele 2 roky (Ochrana osobnich udaju)
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const LANGS = ["cs", "en", "de", "es", "zh"];
const PLANS = ["free", "pro", "firma", "trial", "free-unlock"];

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PLCdesk-Client",
  "Access-Control-Max-Age": "86400",
};

const MSG = {
  cs: {
    ok: "Děkujeme, zpětná vazba je odeslaná.",
    kind: "Vyberte typ zpětné vazby.", text: "Napište text zpětné vazby (max. 5000 znaků).", email: "Zadejte platnou e-mailovou adresu, nebo pole nechte prázdné.",
    client: "Neplatný požadavek (klient).", project: "Přiložený projekt je větší než 512 kB nebo není platný.", many: "Příliš mnoho zpráv. Zkuste to prosím znovu za hodinu.",
  },
  en: {
    ok: "Thank you, your feedback has been sent.",
    kind: "Choose the type of feedback.", text: "Write the feedback text (max. 5000 characters).", email: "Enter a valid e-mail address or leave the field empty.",
    client: "Invalid request (client).", project: "The attached project is larger than 512 kB or not valid.", many: "Too many messages. Please try again in an hour.",
  },
  de: {
    ok: "Vielen Dank, Ihr Feedback wurde gesendet.",
    kind: "Wählen Sie die Art des Feedbacks.", text: "Schreiben Sie den Feedback-Text (max. 5000 Zeichen).", email: "Geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld leer.",
    client: "Ungültige Anfrage (Client).", project: "Das angehängte Projekt ist größer als 512 kB oder ungültig.", many: "Zu viele Nachrichten. Bitte versuchen Sie es in einer Stunde erneut.",
  },
  zh: {
    ok: "谢谢，您的反馈已发送。",
    kind: "请选择反馈类型。", text: "请填写反馈内容（最多 5000 个字符）。", email: "请输入有效的电子邮件地址，或将此栏留空。",
    client: "无效请求（客户端）。", project: "附加的项目大于 512 kB 或无效。", many: "消息过多。请一小时后再试。",
  },
};
// hlasky: cs / en / de / zh; jiny jazyk (es, neznamy) = anglicky, bez jazyka = cesky
const loc = (l) => (l === "cs" || l === "de" || l === "en" || l === "zh" ? l : l ? "en" : "cs");

/** Odpoved verejneho endpointu vzdy s hlavickami CORS (i chyby z readJson - prohlizec je jinak nepreda). */
export function withCors(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}
const fail = (locale, field, status = 400) => out({ error: MSG[loc(locale)][field], field }, status);

// Text uzivatele: viceradkovy, ridici znaky krome konce radku a tabulatoru pryc; {value} | {error}
export function cleanMultiline(v, max) {
  if (typeof v !== "string") return { error: "type" };
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f\p{Zl}\p{Zp}]/gu, " ").trim();
  if (!s) return { error: "empty" };
  if (s.length > max) return { error: "long" };
  return { value: s };
}
// Jednoradkovy kontext (krok, prostredi): ridici znaky pryc, orez na max (kontext neni vstup uzivatele)
const oneLine = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) || null : null);

export function handleFeedbackPreflight() {
  return new Response(null, { status: 204, headers: { ...CORS, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}

export async function handleFeedback(req, env) {
  try {
    return withCors(await receive(req, env));
  } catch (err) {
    console.error("Feedback:", err?.stack ?? String(err));
    return withCors(out({ error: "server error" }, 500));
  }
}

async function receive(req, env) {
  const p = await readJson(req, BODY_MAX);
  if (p.res) return p.res;
  const b = p.body;
  const locale = loc(b.lang);

  // Past na boty: skryte pole vyplnene -> stejna odpoved jako cloveku, nic se neulozi
  if (String(b.web ?? "").trim() !== "") return out({ ok: true, message: MSG[locale].ok }, 200, env.DEV_MODE ? { "x-plcdesk": "trap" } : {});

  // Hlavicka klienta (web | desktop) a shodne pole v tele: cizi formular ani prosty POST bez ni neprojde
  const hdr = String(req.headers.get("X-PLCdesk-Client") || "").trim().toLowerCase();
  if (!FEEDBACK_CLIENTS.includes(hdr) || b.client !== hdr) return fail(locale, "client");

  if (!FEEDBACK_KINDS.includes(b.kind)) return fail(locale, "kind");
  const text = cleanMultiline(b.text, TEXT_MAX);
  if (text.error) return fail(locale, "text");
  let email = null;
  if (b.email != null && String(b.email).trim() !== "") {
    email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!safeEmail(email)) return fail(locale, "email");
  }
  // Projekt jen na vyslovne zaskrtnuti (attach_project === true); jinak se ignoruje a neulozi
  let project = null;
  if (b.attach_project === true && b.project != null) {
    if (typeof b.project !== "object" || Array.isArray(b.project)) return fail(locale, "project");
    project = JSON.stringify(b.project);
    if (enc.encode(project).length > PROJECT_MAX) return fail(locale, "project", 413);
  }
  const ver = typeof b.app_version === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(b.app_version) ? b.app_version : null;
  const lang = LANGS.includes(b.lang) ? b.lang : null;
  const plan = PLANS.includes(b.plan) ? b.plan : null;
  const step = oneLine(b.step, 80);
  const envText = oneLine(b.env, 160);

  // limit pokusu z IP az po validaci (neplatny vstup se nepocita - jako ostatni formulare)
  if (await overLimit(env, req, "feedback")) return out({ error: MSG[locale].many }, 429, { "Retry-After": "3600" });

  const id = newId();
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO feedback (id, created_at, updated_at, kind, text, email, client, app_version, lang, step, env, plan, has_project, project_json, project_size, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
  ).bind(id, at, at, b.kind, text.value, email, hdr, ver, lang, step, envText, plan, project ? 1 : 0, project, project ? enc.encode(project).length : null).run();

  // Upozorneni provozovateli: bez textu a e-mailu, jen typ, krok, verze a odkaz do spravy
  const notify = String(env.MAIL_OWNER || env.BETA_NOTIFY_TO || env.MAIL_REPLY_TO || "").trim();
  if (safeEmail(notify)) {
    try {
      // krok do e-mailu jen jako kratky nazev (pismena, cislice, mezery a . : - ( )), jinak "?" - zadne odkazy
      const stepMail = step && /^[\p{L}\p{N} .:()\-]{1,80}$/u.test(step) && !/\.\p{L}{2,}/u.test(step) ? step : step ? "?" : null;
      await sendFeedbackNotice(env, { to: notify, id, kind: b.kind, client: hdr, version: ver, step: stepMail, lang, hasProject: !!project, hasEmail: !!email });
    } catch (err) {
      console.error("Feedback: upozorneni provozovateli se nepodarilo odeslat:", err?.message ?? err);
    }
  }
  return out({ ok: true, message: MSG[locale].ok, ref: id.slice(0, 8) });
}

// ------------------------------------------------------------ sprava (prihlaseni, CSRF a smerovani: admin.js)

const shortId = (id) => String(id).slice(0, 8);
const COLS = "id, created_at, updated_at, kind, text, email, client, app_version, lang, step, env, plan, has_project, project_size, status, note";

async function loadItem(env, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { res: out({ error: "bad id" }, 400) };
  const item = await env.DB.prepare(`SELECT ${COLS} FROM feedback WHERE id = ?`).bind(id).first();
  if (!item) return { res: out({ error: "not found" }, 404) };
  return { item };
}

async function handleList(req, env, ctx) {
  // uchovani: starsi nez 2 roky pryc (levne, jen pri nacteni seznamu)
  await env.DB.prepare("DELETE FROM feedback WHERE created_at < ?").bind(isoAgo(KEEP_MS)).run();
  const st = String(ctx.url.searchParams.get("status") ?? "");
  const kd = String(ctx.url.searchParams.get("kind") ?? "");
  const status = FEEDBACK_STATES.includes(st) ? st : "";
  const kind = FEEDBACK_KINDS.includes(kd) ? kd : "";
  const page = Math.min(Math.max(Math.floor(num(ctx.url.searchParams.get("page"))) || 1, 1), 10000);
  const where = "WHERE (?1 = '' OR status = ?1) AND (?2 = '' OR kind = ?2)";
  const [cnt, rows, byStatus, byKind] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM feedback ${where}`).bind(status, kind).first(),
    env.DB.prepare(
      `SELECT id, created_at, kind, substr(text, 1, 160) AS snippet, length(text) AS text_len, email IS NOT NULL AS has_email,
              client, app_version, lang, step, plan, has_project, status
       FROM feedback ${where} ORDER BY created_at DESC, id LIMIT ?3 OFFSET ?4`
    ).bind(status, kind, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM feedback GROUP BY status").all(),
    env.DB.prepare("SELECT kind, COUNT(*) AS n FROM feedback GROUP BY kind").all(),
  ]);
  const total = num(cnt?.n);
  const countOf = (list, key, k) => num((list.results || []).find((r) => r[key] === k)?.n);
  return out({
    status, kind, page, page_size: PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    states: FEEDBACK_STATES, kinds: FEEDBACK_KINDS,
    counts: Object.fromEntries(FEEDBACK_STATES.map((s) => [s, countOf(byStatus, "status", s)])),
    kind_counts: Object.fromEntries(FEEDBACK_KINDS.map((k) => [k, countOf(byKind, "kind", k)])),
    items: (rows.results || []).map((r) => ({ ...r, has_email: !!r.has_email, has_project: !!r.has_project })),
  });
}

async function handleGet(req, env, ctx) {
  const { item, res } = await loadItem(env, ctx.url.searchParams.get("id"));
  if (res) return res;
  let detail = null;
  if (item.status === "new") {
    // otevreni = precteno (jako posta); zmena jde do auditu spolu se zobrazenim
    item.updated_at = nowIso();
    await env.DB.prepare("UPDATE feedback SET status = 'read', updated_at = ? WHERE id = ? AND status = 'new'").bind(item.updated_at, item.id).run();
    item.status = "read";
    detail = "new -> read";
  }
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "feedback_view", target: shortId(item.id), detail, ip: ctx.ip });
  return out({ item: { ...item, has_project: !!item.has_project }, states: FEEDBACK_STATES });
}

async function handleUpdate(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { item, res } = await loadItem(env, p.body.id);
  if (res) return res;
  const set = {};
  if ("status" in p.body) {
    if (!FEEDBACK_STATES.includes(p.body.status)) return out({ error: "bad status" }, 400);
    set.status = p.body.status;
  }
  if ("note" in p.body) {
    if (p.body.note != null && typeof p.body.note !== "string") return out({ error: "bad note" }, 400);
    const s = String(p.body.note ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
    if (s.length > NOTE_MAX || /[<>]/.test(s)) return out({ error: "bad note" }, 400);
    set.note = s || null;
  }
  const drop = p.body.drop_project === true && !!item.has_project;
  if (!Object.keys(set).length && p.body.drop_project !== true) return out({ error: "nothing to update" }, 400);
  const cols = Object.keys(set).filter((k) => (set[k] ?? null) !== (item[k] ?? null));
  if (!cols.length && !drop) return out({ ok: true, unchanged: true, item: { ...item, has_project: !!item.has_project } });
  const at = nowIso();
  // nazvy sloupcu jen z pevneho seznamu (status, note), hodnoty jako parametry
  const parts = [...cols.map((k) => `${k} = ?`), ...(drop ? ["has_project = 0", "project_json = NULL", "project_size = NULL"] : [])];
  await env.DB.prepare(`UPDATE feedback SET ${parts.join(", ")}, updated_at = ? WHERE id = ?`).bind(...cols.map((k) => set[k]), at, item.id).run();
  const detail = [
    cols.includes("status") ? `${item.status} -> ${set.status}` : null,
    cols.includes("note") ? `poznamka ${set.note ? set.note.length : 0} znaku` : null,
    drop ? "projekt smazan" : null,
  ].filter(Boolean).join(", ");
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "feedback_update", target: shortId(item.id), detail, ip: ctx.ip });
  const next = { ...item, ...set, updated_at: at, ...(drop ? { has_project: 0, project_size: null } : {}) };
  return out({ ok: true, changed: [...cols, ...(drop ? ["project"] : [])], item: { ...next, has_project: !!next.has_project } });
}

async function handleProject(req, env, ctx) {
  const id = ctx.url.searchParams.get("id");
  if (typeof id !== "string" || !ID_RE.test(id)) return out({ error: "bad id" }, 400);
  const row = await env.DB.prepare("SELECT id, project_json FROM feedback WHERE id = ? AND has_project = 1").bind(id).first();
  if (!row || row.project_json == null) return out({ error: "not found" }, 404);
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "feedback_project", target: shortId(row.id), ip: ctx.ip });
  return new Response(row.project_json, {
    headers: {
      ...API_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="feedback-${shortId(row.id)}.plcstudio.json"`,
    },
  });
}

async function handleDelete(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { item, res } = await loadItem(env, p.body.id);
  if (res) return res;
  await env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(item.id).run();
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "feedback_delete", target: shortId(item.id), detail: item.kind, ip: ctx.ip });
  return out({ ok: true, deleted: true });
}

export const FEEDBACK_ROUTES = {
  "GET /api/admin/feedback": { fn: handleList },
  "GET /api/admin/feedback/item": { fn: handleGet },
  "POST /api/admin/feedback": { fn: handleUpdate },
  "GET /api/admin/feedback/project": { fn: handleProject },
  "POST /api/admin/feedback/delete": { fn: handleDelete },
};
