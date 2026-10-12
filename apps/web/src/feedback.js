/* PLCdesk — zpětná vazba z webové aplikace do správy webu (POST <web>/api/feedback, správa #/feedback).

   - okno Zpětná vazba: typ (chyba / námět / dotaz), text (max. 5000 znaků), e-mail pro odpověď (předvyplněný
     z licence, dá se smazat — bez e-mailu anonymně), zaškrtávátko „Přiložit aktuální projekt“ (výchozí NE,
     limit 512 kB), náhled toho, co se odešle (kontext), Odeslat / Zrušit, výsledek;
   - kontext: verze aplikace, klient web, jazyk, krok, prohlížeč a systém stručně, tarif licence —
     NIKDY licenční klíč ani ID instalace;
   - API běží na webu PLCdesk (LICENSE_SITE, jako licence); endpoint má CORS, aplikace tedy může běžet
     z jiného originu. Adresu jde pro lokální test přepnout parametrem `?feedbackSite=` — jen na localhost;
   - bez sítě: hláška + Kopírovat text / Otevřít e-mail (mailto na kontaktní adresu webu s předvyplněným textem);
   - rozepsaný text se neztratí: koncept v localStorage `plcstudio.feedbackDraft` (typ, text, e-mail), smaže se
     až po úspěšném odeslání. Zaškrtnutí projektu se do konceptu neukládá (pokaždé výchozí NE).
   Volání: `openFeedback()` (tlačítko v hlavičce; krok Nápověda může volat totéž). */
import { tr, escHtml as esc, getLang, LICENSE_SITE, PLCDESK_VERSION } from "../../../packages/core/dist/index.js";
import { licState } from "./license.js";

const LS_DRAFT = "plcstudio.feedbackDraft";
export const FEEDBACK_MAIL = "podlena.t@gmail.com";     // kontakt webu (apps/site/content/site.json → email)
export const TEXT_MAX = 5000;
export const PROJECT_MAX = 512 * 1024;
const TIMEOUT_MS = 15000;
const KINDS = ["bug", "idea", "question"];

let getProject = () => null;
let getStep = () => "";

/** Napojení na aplikaci: aktuální projekt a popis kroku („8: Dokumentace“). */
export function initFeedback(opts = {}) {
  if (opts.project) getProject = opts.project;
  if (opts.step) getStep = opts.step;
}

/** Adresa API: web PLCdesk; `?feedbackSite=` jen pro localhost (lokální test proti scripts/serve.js). */
export function feedbackSite() {
  try {
    const o = new URL(location.href).searchParams.get("feedbackSite");
    if (o) {
      const u = new URL(o);
      if (/^https?:$/.test(u.protocol) && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
    }
  } catch { /* neplatná adresa: výchozí web */ }
  return LICENSE_SITE;
}

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DRAFT) || "null");
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    return {
      kind: KINDS.includes(d.kind) ? d.kind : undefined,
      text: typeof d.text === "string" ? d.text.slice(0, TEXT_MAX) : undefined,
      email: typeof d.email === "string" ? d.email.slice(0, 254) : undefined,
    };
  } catch { return {}; }
}
function writeDraft(d) {
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(d)); } catch { /* bez úložiště: koncept jen do zavření stránky */ }
}
function clearDraft() {
  try { localStorage.removeItem(LS_DRAFT); } catch { /* ignore */ }
}

/** Prohlížeč a systém stručně (bez celého user-agentu a bez otisku). */
export function browserBrief(ua = navigator.userAgent) {
  const m = (re) => (re.exec(ua) || [])[1];
  const br = m(/Edg\/(\d+)/) ? "Edge " + m(/Edg\/(\d+)/) : m(/OPR\/(\d+)/) ? "Opera " + m(/OPR\/(\d+)/)
    : m(/Firefox\/(\d+)/) ? "Firefox " + m(/Firefox\/(\d+)/) : m(/Chrome\/(\d+)/) ? "Chrome " + m(/Chrome\/(\d+)/)
    : m(/Version\/(\d+).*Safari/) ? "Safari " + m(/Version\/(\d+).*Safari/) : "?";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "?";
  return br + ", " + os;
}

const byteLen = (s) => new TextEncoder().encode(s).length;
const projectJson = (prj) => { try { return prj ? JSON.stringify(prj) : ""; } catch { return ""; } };

/** Kontext, který se odešle (bez textu, e-mailu a projektu) — totéž ukazuje náhled. */
export function feedbackContext() {
  let plan = null;
  try { plan = licState().plan || null; } catch { /* licence nenačtená */ }
  return { client: "web", app_version: PLCDESK_VERSION, lang: getLang(), step: String(getStep() || ""), env: browserBrief(), plan };
}

/** Odeslání; vrací { ok, status, data } — chyba sítě = výjimka. */
export async function sendFeedback(body, site = feedbackSite()) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : 0;
  try {
    const r = await fetch(site.replace(/\/+$/, "") + "/api/feedback", {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-PLCdesk-Client": "web" },
      body: JSON.stringify(body), signal: ctl?.signal,
    });
    let data = {};
    try { data = await r.json(); } catch { /* bez JSON */ }
    return { ok: r.ok && data.ok === true, status: r.status, data: data || {} };
  } finally { clearTimeout(timer); }
}

const KIND_LABEL = { bug: () => tr("Chyba"), idea: () => tr("Námět"), question: () => tr("Dotaz") };

/** Text pro schránku / e-mail (bez sítě): typ, text a kontext. */
function plainText(kind, text, ctx) {
  return tr("Zpětná vazba PLCdesk") + " — " + KIND_LABEL[kind]() + "\n\n" + text + "\n\n---\n"
    + tr("Verze {v}, {client}, jazyk {lang}, krok {step}, {env}, tarif {plan}", { v: ctx.app_version, client: ctx.client, lang: ctx.lang, step: ctx.step || "—", env: ctx.env, plan: ctx.plan || "—" });
}

function fieldMessage(field, status) {
  if (status === 429) return tr("Příliš mnoho zpráv za hodinu. Zkus to prosím později, nebo použij e-mail.");
  switch (field) {
    case "text": return tr("Napiš text zpětné vazby (nejvýš 5000 znaků).");
    case "email": return tr("E-mail pro odpověď není platný — oprav ho, nebo pole nech prázdné.");
    case "kind": return tr("Vyber typ zpětné vazby.");
    case "project": return tr("Projekt je větší než 512 kB — odešli zprávu bez něj, nebo ho pošli e-mailem.");
    default: return tr("Odeslání se nezdařilo (HTTP {status}).", { status });
  }
}

/** Okno Zpětná vazba. */
export function openFeedback() {
  let m = document.getElementById("fbModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "fbModal"; m.className = "modal";
    document.body.appendChild(m);
  }
  document.body.classList.add("modal-open");
  const draft = readDraft();
  let licEmail = "";
  try { licEmail = licState().email || ""; } catch { /* ignore */ }
  const email0 = draft.email !== undefined ? draft.email : licEmail;
  const kind0 = draft.kind || "bug";
  const prj = getProject();
  const pj = projectJson(prj);
  const pSize = pj ? byteLen(pj) : 0;
  const tooBig = pSize > PROJECT_MAX;
  const kb = (n) => Math.max(1, Math.round(n / 1024));
  m.innerHTML = `<div class="dialog fbdialog" role="dialog" aria-modal="true" aria-labelledby="fbTitle" tabindex="-1">
    <div class="mhead"><h2 id="fbTitle">${esc(tr("Zpětná vazba"))}</h2><button class="small" id="fbClose" aria-label="${esc(tr("Zavřít"))}">×</button></div>
    <div class="mbody">
      <p class="hint">${esc(tr("Napiš nám, co nefunguje, co ti chybí, nebo se zeptej. Zpráva jde přímo autorům PLCdesk."))}</p>
      <fieldset class="fbkinds"><legend>${esc(tr("Typ"))}</legend>
        ${KINDS.map(k => `<label><input type="radio" name="fbKind" value="${k}"${k === kind0 ? " checked" : ""}> ${esc(KIND_LABEL[k]())}</label>`).join("")}
      </fieldset>
      <label for="fbText"><b>${esc(tr("Text"))}</b></label>
      <textarea id="fbText" rows="7" maxlength="${TEXT_MAX}" style="width:100%"></textarea>
      <div class="hint fbcount" id="fbCount" aria-live="polite"></div>
      <label for="fbEmail"><b>${esc(tr("E-mail pro odpověď (nepovinné)"))}</b></label>
      <div class="row" style="margin:4px 0 0"><input type="email" id="fbEmail" maxlength="254" autocomplete="email" style="flex:1 1 260px">
        <button class="small" id="fbEmailClear" type="button">${esc(tr("Smazat e-mail"))}</button></div>
      <p class="hint">${esc(tr("Bez e-mailu se zpráva odešle anonymně a nemůžeme odpovědět."))}</p>
      <label class="fbattach"><input type="checkbox" id="fbAttach"${prj && !tooBig ? "" : " disabled"}> ${esc(tr("Přiložit aktuální projekt (může obsahovat údaje zákazníka)"))}</label>
      <p class="hint" id="fbPrjHint">${esc(!prj ? tr("Žádný projekt není otevřený.") : tooBig
        ? tr("Projekt má {k} kB — víc než limit 512 kB, přiložit ho nejde.", { k: kb(pSize) })
        : tr("Projekt „{name}“, {k} kB. Přikládej ho jen tehdy, když to smíš — uvidí ho jen provozovatel PLCdesk.", { name: prj.meta?.name || tr("(bez názvu)"), k: kb(pSize) }))}</p>
      <input type="text" name="web" id="fbWeb" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
      <details class="fbpreview"><summary>${esc(tr("Co se odešle"))}</summary><pre id="fbPreview" style="white-space:pre-wrap;font-size:.78rem"></pre></details>
      <div id="fbOut" role="status" aria-live="polite"></div>
    </div>
    <div class="mfoot"><span class="hint" style="margin:0">${esc(tr("Odesílá se na {site}", { site: feedbackSite().replace(/^https?:\/\//, "") }))}</span>
      <div class="row" style="margin:0"><button id="fbCancel">${esc(tr("Zrušit"))}</button><button class="primary" id="fbSend">${esc(tr("Odeslat"))}</button></div></div>
  </div>`;
  const $m = (s) => m.querySelector(s);
  const ta = $m("#fbText"), em = $m("#fbEmail"), att = $m("#fbAttach"), out = $m("#fbOut");
  ta.value = draft.text || "";
  em.value = email0;
  const kindNow = () => (m.querySelector("input[name=fbKind]:checked") || {}).value || "bug";
  const saveDraft = () => writeDraft({ kind: kindNow(), text: ta.value, email: em.value });
  const preview = () => {
    const ctx = feedbackContext();
    const show = {
      kind: kindNow(), text: tr("({n} znaků)", { n: ta.value.trim().length }), email: em.value.trim() || tr("(anonymně)"),
      ...ctx, project: att.checked ? tr("ano, {k} kB", { k: kb(pSize) }) : tr("ne"),
    };
    $m("#fbPreview").textContent = JSON.stringify(show, null, 2);
    $m("#fbCount").textContent = tr("{n} / {max} znaků", { n: ta.value.length, max: TEXT_MAX });
  };
  preview();
  const close = () => { saveDraft(); m.remove(); document.body.classList.remove("modal-open"); };
  ta.addEventListener("input", () => { saveDraft(); preview(); });
  em.addEventListener("input", () => { saveDraft(); preview(); });
  m.querySelectorAll("input[name=fbKind]").forEach(r => r.addEventListener("change", () => { saveDraft(); preview(); }));
  att.addEventListener("change", preview);
  $m("#fbEmailClear").addEventListener("click", () => { em.value = ""; saveDraft(); preview(); em.focus(); });
  $m("#fbClose").addEventListener("click", close);
  $m("#fbCancel").addEventListener("click", close);
  m.onkeydown = e => { if (e.key === "Escape") close(); };
  m.addEventListener("click", e => { if (e.target === m) close(); });

  const offline = (kind, text, ctx) => {
    const body = plainText(kind, text, ctx);
    out.className = "notice err";
    out.innerHTML = esc(tr("Server PLCdesk se nepodařilo zastihnout (bez internetu nebo blokováno). Text můžeš zkopírovat, nebo ho poslat e-mailem — rozepsaná zpráva zůstává uložená.")) + "<div class='row' style='margin:8px 0 0'>"
      + "<button class='small' id='fbCopy'>" + esc(tr("Kopírovat text")) + "</button>"
      + "<button class='small' id='fbMail'>" + esc(tr("Otevřít e-mail")) + "</button></div>";
    out.querySelector("#fbCopy").addEventListener("click", () => {
      try { navigator.clipboard.writeText(body).then(() => { out.querySelector("#fbCopy").textContent = "✓ " + tr("Zkopírováno"); }, () => {}); } catch { /* bez schránky */ }
    });
    /* mailto: délku adresy omezují klienti pošty — text zkrátit */
    const short = body.length > 1800 ? body.slice(0, 1800) + "…" : body;
    const href = "mailto:" + FEEDBACK_MAIL + "?subject=" + encodeURIComponent(tr("Zpětná vazba PLCdesk")) + "&body=" + encodeURIComponent(short);
    out.querySelector("#fbMail").dataset.href = href;
    out.querySelector("#fbMail").addEventListener("click", () => { location.href = href; });
  };

  $m("#fbSend").addEventListener("click", async () => {
    const btn = $m("#fbSend");
    const text = ta.value.trim();
    const kind = kindNow();
    const email = em.value.trim();
    out.className = ""; out.textContent = "";
    if (!text) { out.className = "errtxt"; out.textContent = fieldMessage("text"); ta.focus(); return; }
    const ctx = feedbackContext();
    const body = { kind, text, ...ctx, web: $m("#fbWeb").value };
    if (email) body.email = email;
    if (att.checked && prj && !tooBig) { body.attach_project = true; body.project = prj; }
    btn.disabled = true; out.className = "hint"; out.textContent = tr("Odesílám…");
    let r;
    try {
      r = await sendFeedback(body);
    } catch {
      if (btn.isConnected) btn.disabled = false;
      offline(kind, text, ctx);
      return;
    }
    if (!btn.isConnected) return;
    btn.disabled = false;
    if (r.ok) {
      clearDraft();
      ta.value = ""; att.checked = false; preview();
      out.className = "notice";
      out.textContent = "✓ " + tr("Děkujeme, zpětná vazba je odeslaná (číslo {ref}).", { ref: r.data.ref || "—" });
      $m("#fbSend").hidden = true;
      $m("#fbCancel").textContent = tr("Zavřít");
      return;
    }
    if (r.status === 0 || r.status >= 500 && !r.data.field) { offline(kind, text, ctx); return; }
    out.className = "errtxt";
    out.textContent = fieldMessage(r.data.field, r.status);
  });
  const d = m.querySelector(".dialog");
  d.focus();
  ta.focus();
}
