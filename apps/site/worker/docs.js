// Sprava: interni dokumenty provozovatele (/api/admin/docs, /api/admin/doc*). Smerovani, prihlaseni,
// CSRF (Origin + X-Requested-With u mutaci) dela admin.js - sem prijde jen overeny pozadavek
// (ctx.actor, ctx.via, ctx.ip, ctx.url).
//
// OBSAH dokumentu zije jen v D1 (tabulka admin_docs, schema_admin.sql) - repozitar je verejny, do repa
// ani do verejnych souboru webu (sprava/*.js, assets) obsah nepatri. Tady je jen mechanismus.
//
// Model: slug (^[a-z0-9-]{1,64}$), title, body = Markdown (max. 256 kB UTF-8), version = optimisticky
// zamek: kazde ulozeni posle verzi, ze ktere vychazi; jina verze v D1 -> 409 s aktualni verzi (nikdo
// neprepise cizi zmenu potichu). Zapis jde jednim UPDATE ... WHERE version = ? (soubezne ulozeni
// projde jen jedno). Odskrtnuti ukolu prepne na serveru JEN n-ty radek ukolu, ne cele telo.
// Audit: doc_save / doc_task jen se slugem, delkou a indexem - obsah dokumentu do auditu nejde.

import { out, readJson, audit, clip, nowIso, enc } from "./admin_util.js";

export const DOC_MAX = 256 * 1024;          // telo dokumentu (UTF-8 bajty)
const DOC_REQ_MAX = 3 * DOC_MAX;           // JSON pozadavku (escapovani \n, \" apod.)
const LIST_MAX = 500;
const TITLE_MAX = 200;
export const SLUG_RE = /^[a-z0-9-]{1,64}$/;

// Radky ukolu: "- [ ] text", "* [x] text", "+ [X]" (i odsazene), mimo bloky ``` kodu.
// Stejnou funkci ma klient (sprava.js taskLines) - index n-teho ukolu musi sedet na obou stranach.
const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\](?:\s|$))/;
const FENCE_RE = /^\s*```/;
export function taskLines(lines) {
  const idx = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) { fence = !fence; continue; }
    if (!fence && TASK_RE.test(lines[i])) idx.push(i);
  }
  return idx;
}
// Prepne n-ty ukol na done; {body, changed} nebo null (index mimo rozsah)
export function toggleTask(body, n, done) {
  const lines = String(body).split("\n");
  const at = taskLines(lines)[n];
  if (at === undefined) return null;
  const mark = done ? "x" : " ";
  const cur = TASK_RE.exec(lines[at])[2];
  if ((cur !== " ") === done) return { body, changed: false };
  lines[at] = lines[at].replace(TASK_RE, (m, a, b, c) => a + mark + c);
  return { body: lines.join("\n"), changed: true };
}

const badSlug = (s) => typeof s !== "string" || !SLUG_RE.test(s);
const conflict = (doc) =>
  out({ error: "conflict", version: doc ? doc.version : null, updated_at: doc?.updated_at ?? null, updated_by: doc?.updated_by ?? null }, 409);
const loadDoc = (env, slug) => env.DB.prepare("SELECT slug, title, body, updated_at, updated_by, version FROM admin_docs WHERE slug = ?").bind(slug).first();
const validVersion = (v) => Number.isInteger(v) && v >= 0 && v < 2 ** 31;

function normTitle(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s && s.length <= TITLE_MAX ? s : null;
}

async function handleList(req, env) {
  const rows = await env.DB.prepare(
    "SELECT slug, title, updated_at, updated_by, version, length(CAST(body AS BLOB)) AS size FROM admin_docs ORDER BY updated_at DESC, slug LIMIT ?"
  ).bind(LIST_MAX).all();
  return out({ docs: rows.results || [] });
}

async function handleGet(req, env, ctx) {
  const slug = ctx.url.searchParams.get("slug");
  if (badSlug(slug)) return out({ error: "bad slug" }, 400);
  const doc = await loadDoc(env, slug);
  if (!doc) return out({ error: "not found" }, 404);
  return out({ doc });
}

// {slug, title, body, version}: version 0 = zalozeni noveho (existujici slug -> 409 exists),
// jinak verze, ze ktere uprava vychazi.
async function handleSave(req, env, ctx) {
  const p = await readJson(req, DOC_REQ_MAX);
  if (p.res) return p.res;
  const { slug, version } = p.body;
  if (badSlug(slug)) return out({ error: "bad slug" }, 400);
  const title = normTitle(p.body.title);
  if (!title) return out({ error: "bad title" }, 400);
  if (typeof p.body.body !== "string") return out({ error: "bad body" }, 400);
  const body = p.body.body.replace(/\r\n?/g, "\n");
  const size = enc.encode(body).length;
  if (size > DOC_MAX) return out({ error: "too large" }, 413);
  if (!validVersion(version)) return out({ error: "bad version" }, 400);
  const at = nowIso();
  const actor = clip(ctx.actor, 254);

  if (version === 0) {
    const r = await env.DB.prepare(
      "INSERT INTO admin_docs (slug, title, body, updated_at, updated_by, version) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(slug) DO NOTHING"
    ).bind(slug, title, body, at, actor).run();
    if (!Number(r?.meta?.changes)) {
      const cur = await loadDoc(env, slug);
      return out({ error: "exists", version: cur?.version ?? null }, 409);
    }
    await audit(env, { actor: ctx.actor, via: ctx.via, action: "doc_save", target: slug, detail: `zalozeno, ${size} B`, ip: ctx.ip });
    return out({ ok: true, created: true, slug, version: 1, updated_at: at, updated_by: actor });
  }

  const cur = await loadDoc(env, slug);
  if (!cur) return out({ error: "not found" }, 404);
  if (cur.version !== version) return conflict(cur);
  if (cur.title === title && cur.body === body) return out({ ok: true, unchanged: true, slug, version: cur.version, updated_at: cur.updated_at, updated_by: cur.updated_by });
  const r = await env.DB.prepare("UPDATE admin_docs SET title = ?, body = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE slug = ? AND version = ?")
    .bind(title, body, at, actor, slug, version).run();
  if (!Number(r?.meta?.changes)) return conflict(await loadDoc(env, slug));
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "doc_save", target: slug, detail: `v${version + 1}, ${size} B`, ip: ctx.ip });
  return out({ ok: true, slug, version: version + 1, updated_at: at, updated_by: actor });
}

// {slug, index, done, version}: prepne jen n-ty radek ukolu
async function handleTask(req, env, ctx) {
  const p = await readJson(req);
  if (p.res) return p.res;
  const { slug, index, done, version } = p.body;
  if (badSlug(slug)) return out({ error: "bad slug" }, 400);
  if (!Number.isInteger(index) || index < 0 || index > 100000) return out({ error: "bad index" }, 400);
  if (typeof done !== "boolean") return out({ error: "bad done" }, 400);
  if (!validVersion(version) || version === 0) return out({ error: "bad version" }, 400);
  const cur = await loadDoc(env, slug);
  if (!cur) return out({ error: "not found" }, 404);
  if (cur.version !== version) return conflict(cur);
  const t = toggleTask(cur.body, index, done);
  if (!t) return out({ error: "bad index" }, 400);
  if (!t.changed) return out({ ok: true, already: true, version: cur.version, updated_at: cur.updated_at, updated_by: cur.updated_by });
  const at = nowIso();
  const actor = clip(ctx.actor, 254);
  const r = await env.DB.prepare("UPDATE admin_docs SET body = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE slug = ? AND version = ?")
    .bind(t.body, at, actor, slug, version).run();
  if (!Number(r?.meta?.changes)) return conflict(await loadDoc(env, slug));
  await audit(env, { actor: ctx.actor, via: ctx.via, action: "doc_task", target: slug, detail: `ukol ${index} -> ${done ? "hotovo" : "otevreno"}`, ip: ctx.ip });
  return out({ ok: true, version: version + 1, updated_at: at, updated_by: actor });
}

export const DOC_ROUTES = {
  "GET /api/admin/docs": { fn: handleList },
  "GET /api/admin/doc": { fn: handleGet },
  "POST /api/admin/doc": { fn: handleSave },
  "POST /api/admin/doc/task": { fn: handleTask },
};
