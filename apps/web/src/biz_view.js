/* PLCdesk — pohled na revize, nabídku a firemní knihovnu (sdílený webem i desktopem).
   Žádné DOM: čisté funkce nad jádrem (revision.ts, quote.ts, library.ts), které z výsledků
   jádra skládají data pro tabulky a formuláře. Web je volá přímo, desktop přes operace mostu
   revision.* / quote.* / library.* (apps/desktop/bridge_biz.mjs). Logika zůstává v jádře —
   tady se jen překládá, formátuje a vybírá, co UI ukáže. */
import {
  tr, CLS, PLAT, syncIO,
  listRevisions, latestRevision, modifiedSinceRevision, revisionLabel, nextRevisionId, createRevision,
  revisionSnapshot, diffRevisions, changesSinceRevision, retestScope, changesMd, changeClassLabel,
  CHANGE_AREAS, CHANGES_FILE, COMMISSION_PHASES,
  buildQuote, parsePriceList, quoteCsv, quoteDoc, fmtMoney, fmtNum, docPagesEstimate, commissioningDaysEstimate,
  QUOTE_PARAM_INFO, QUOTE_DEFAULTS, RATE_LABEL, QUOTE_FILE, proposeSafety,
  importLibrary, exportLibrary, validateLibrary, attachLibrary, addLibraryDevice, libraryApprovers, blankLibrary,
  projectLibrary, codeLibrary, LIBRARY_FORMAT, LIBRARY_SCHEMA, FB_CLASSES,
} from "../../../packages/core/dist/index.js";

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const str = v => typeof v === "string";
const fin = v => typeof v === "number" && Number.isFinite(v);

/** Okamžik v místním čase (YYYY-MM-DD HH:MM) — nezávislé na jazyku (stejně jako schvalování). */
export function fmtStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso || "").slice(0, 16);
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
}

/* ================================================================ úložiště projektu
   Revize, volby nabídky a kopie knihovny v projektu — jen záznamy v platném tvaru (jinak by
   rozbitý soubor shodil kroky). Volá normProject (web) a operace mostu (desktop). */

/** Revize: povinné textové údaje a zmrazený obsah, který jde přečíst (JSON). */
export function normRevisions(raw) {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set();
  const out = raw.filter(r => {
    if (!isObj(r) || !str(r.id) || !/^[A-Za-z0-9._-]{1,12}$/.test(r.id) || !str(r.date) || !str(r.by) || !r.by.trim()
      || !str(r.hash) || !str(r.snapshot) || ids.has(r.id.toUpperCase())) return false;
    try { if (!isObj(JSON.parse(r.snapshot))) return false; } catch { return false; }
    ids.add(r.id.toUpperCase());
    return true;
  }).map(r => {
    const approvalsAt = {};
    for (const [k, a] of Object.entries(isObj(r.approvalsAt) ? r.approvalsAt : {})) {
      if (!isObj(a) || !["approved", "rejected", "proposed"].includes(a.state) || !str(a.by) || !str(a.at) || !str(a.hash)) continue;
      approvalsAt[k] = { state: a.state, by: a.by, at: a.at, hash: a.hash, ...(str(a.note) && a.note ? { note: a.note } : {}), ...(typeof a.valid === "boolean" ? { valid: a.valid } : {}) };
    }
    const ap = isObj(r.approved) && fin(r.approved.valid) && fin(r.approved.required) ? { approved: { valid: r.approved.valid, required: r.approved.required } } : {};
    return { id: r.id, date: r.date, by: r.by, note: str(r.note) ? r.note : "", hash: r.hash, snapshot: r.snapshot, approvalsAt, ...ap };
  });
  return out.length ? out : undefined;
}

/** Volby nabídky (`prj.quote`): čísla, texty a ceník v platném tvaru. */
export function normQuote(raw) {
  if (!isObj(raw)) return undefined;
  const q = {};
  if (str(raw.currency) && /^[A-Za-z]{3}$/.test(raw.currency.trim())) q.currency = raw.currency.trim().toUpperCase();
  for (const k of ["vatPct", "marginPct"]) if (fin(raw[k]) && raw[k] >= 0) q[k] = raw[k];
  if (raw.inDocs === true) q.inDocs = true;
  if (isObj(raw.rates)) {
    const r = Object.fromEntries(Object.entries(raw.rates).filter(([k, v]) => k in RATE_LABEL && fin(v) && v >= 0));
    if (Object.keys(r).length) q.rates = r;
  }
  if (isObj(raw.fx)) {
    const f = Object.fromEntries(Object.entries(raw.fx).filter(([k, v]) => /^[A-Z]{3}$/.test(k) && fin(v) && v > 0));
    if (Object.keys(f).length) q.fx = f;
  }
  if (isObj(raw.params)) {
    const p = {};
    for (const k of Object.keys(QUOTE_PARAM_INFO)) {
      const v = raw.params[k];
      if (k === "hoursPerDevice") {
        if (isObj(v)) { const h = Object.fromEntries(Object.entries(v).filter(([c, x]) => CLS[c] && fin(x) && x >= 0)); if (Object.keys(h).length) p.hoursPerDevice = h; }
      } else if (fin(v) && v >= 0) p[k] = v;
    }
    if (Object.keys(p).length) q.params = p;
  }
  if (Array.isArray(raw.prices)) {
    const pr = raw.prices.filter(e => isObj(e) && fin(e.price) && e.price >= 0 && fin(e.row) && str(e.currency))
      .map(e => ({ orderCode: String(e.orderCode ?? ""), type: String(e.type ?? ""), brand: String(e.brand ?? ""), cat: String(e.cat ?? ""),
        price: e.price, currency: e.currency, supplier: String(e.supplier ?? ""), leadTime: String(e.leadTime ?? ""), row: e.row }));
    if (pr.length) q.prices = pr;
  }
  return Object.keys(q).length ? q : undefined;
}

/** Kopie knihovny v projektu: jen soubor knihovny PLCdesk známé verze formátu. */
export function normLibrary(raw) {
  if (!isObj(raw) || raw.format !== LIBRARY_FORMAT || !fin(raw.schema) || raw.schema < 1 || raw.schema > LIBRARY_SCHEMA) return undefined;
  const { lib } = importLibrary(JSON.stringify(raw));
  return lib || undefined;
}

/** Doplní do projektu `p` revize, nabídku a knihovnu z načteného `raw` (jen platné části). */
export function normBiz(raw, p) {
  const r = normRevisions(raw.revisions), q = normQuote(raw.quote), l = normLibrary(raw.library);
  if (r) p.revisions = r; else delete p.revisions;
  if (q) p.quote = q; else delete p.quote;
  if (l) p.library = l; else delete p.library;
  return p;
}

/* ================================================================ revize */

/** Označení revize v hlavičce: „B“, „B*“ (změněno od revize), "" bez revize. */
export function revisionBadge(prj) {
  const last = latestRevision(prj);
  if (!last) return { label: "", modified: false };
  const modified = modifiedSinceRevision(prj);
  return {
    label: revisionLabel(prj), modified, id: last.id, by: last.by, date: fmtStamp(last.date),
    title: modified
      ? tr("Revize {rev} — obsah se od vydání revize změnil (rozpracováno). Klik = změny od revize.", { rev: last.id })
      : tr("Revize {rev} vydaná {date}, {by}. Klik = revize projektu.", { rev: last.id, date: fmtStamp(last.date), by: last.by }),
  };
}

/** Třída změny → barva štítku (stejné třídy CSS ve webu, barvy v desktopu). */
export const CLASS_TONE = { cosmetic: "ok", functional: "warn", safety: "err", none: "wait" };

/** Výchozí porovnání jako `17_zmeny.md`: poslední revize → aktuální stav, beze změny předposlední → poslední. */
function pickRange(prj, from, to) {
  const revs = prj.revisions || [];
  const has = id => id === "current" || revs.some(r => r.id === id);
  const last = revs[revs.length - 1];
  if (!has(to)) to = modifiedSinceRevision(prj) || revs.length < 2 ? "current" : last.id;
  const before = id => revs[Math.max(0, revs.findIndex(r => r.id === id) - 1)].id;
  if (!has(from) || from === "current") from = to === "current" ? last.id : before(to);
  /* stejný stav na obou stranách: od předchozí revize, u první revize do aktuálního stavu */
  if (from === to) { if (before(to) !== to) from = before(to); else to = "current"; }
  return { from, to };
}

/** Popis změny bez názvu položky na začátku („označení M1 → M2“ místo „Zařízení M1: označení…“). */
function detailOf(c) {
  const t = String(c.text || "");
  if (c.what && t.startsWith(c.what)) {
    const rest = t.slice(c.what.length).replace(/^\s*[:：]\s*/, "");
    if (rest) return rest;
  }
  return t;
}

/**
 * Revize projektu a změny mezi dvěma stavy pro UI: seznam revizí s klasifikací, tabulka změn,
 * zneplatněná schválení a NÁVRH rozsahu opakovaných zkoušek. `from` / `to` = označení revize
 * nebo "current"; `exact` = spustit ověření simulací (přesné dotčené položky).
 */
export function revisionView(prj, o = {}) {
  syncIO(prj);
  const revs = listRevisions(prj, { classify: true }).map(r => ({
    id: r.id, date: fmtStamp(r.date), by: r.by, note: r.note,
    cls: r.cls === null ? "first" : r.cls || "none",
    clsLabel: r.cls === null ? tr("první vydání") : r.cls === "none" || !r.cls ? tr("beze změny") : changeClassLabel(r.cls),
    tone: r.cls === null ? "wait" : CLASS_TONE[r.cls || "none"],
    approved: r.approved ? r.approved.valid + " / " + r.approved.required : "—",
  }));
  const badge = revisionBadge(prj);
  const out = {
    revisions: revs, label: badge.label, modified: badge.modified, last: badge.id || "", next: nextRevisionId(prj),
    file: CHANGES_FILE, from: "", to: "", diff: null, retest: null,
  };
  if (!revs.length) return out;
  const { from, to } = pickRange(prj, o.from, o.to);
  out.from = from; out.to = to;
  const diff = diffRevisions(prj, from, to, { exact: !!o.exact });
  const b = to === "current" ? prj : revisionSnapshot(prj, to);
  const scope = retestScope(b, diff, { exact: !!o.exact });
  const apprFrom = revisionSnapshot(prj, from).approvals || {};
  const title = k => diff.titles[k] || k;
  out.diff = {
    exact: diff.exact, empty: diff.empty, cls: diff.cls, clsLabel: diff.cls ? changeClassLabel(diff.cls) : tr("beze změny"),
    tone: CLASS_TONE[diff.cls || "none"], counts: diff.counts,
    changes: diff.changes.map((c, i) => ({
      n: i + 1, area: c.area, areaLabel: tr(CHANGE_AREAS[c.area]), op: c.op, ref: c.ref, what: c.what, detail: detailOf(c), text: c.text,
      cls: c.cls, clsLabel: changeClassLabel(c.cls), tone: CLASS_TONE[c.cls],
      affects: c.affects.map(k => ({ key: k, title: title(k) })), maybe: c.maybe.map(k => ({ key: k, title: title(k) })),
    })),
    invalidates: diff.invalidates.map(k => {
      const r = apprFrom[k];
      return { key: k, title: title(k), by: r ? r.by : "", at: r ? fmtStamp(r.at) : "", maybe: diff.maybe.includes(k) };
    }),
    added: diff.added.map(k => ({ key: k, title: title(k) })),
    maybe: diff.maybe.length, unattributed: diff.unattributed.map(k => ({ key: k, title: title(k) })),
  };
  out.retest = {
    notes: scope.notes,
    fat: scope.fat.map(f => ({ section: f.section, ref: f.ref, text: f.text })),
    commissioning: scope.commissioning.map(s => ({ id: s.id, phase: s.phase, phaseLabel: s.phase + ". " + tr(COMMISSION_PHASES[s.phase] || ""), title: s.title })),
    safety: scope.safety.map(s => ({ sf: s.sf, ref: s.ref, title: s.title, steps: s.steps, removed: !!s.removed,
      text: s.removed ? tr("funkce vyřazena nebo zrušena: aktualizuj posouzení rizik a validační zprávu")
        : s.steps.length ? s.steps.join(", ") : tr("validace podle plánu oživení, fáze 10") })),
    approvals: scope.approvals.map(k => ({ key: k, title: title(k) })),
  };
  return out;
}

/** Zpráva `17_zmeny.md` pro zvolené porovnání. */
export function revisionMd(prj, o = {}) {
  syncIO(prj);
  if (!(prj.revisions || []).length) return changesMd(prj);
  const { from, to } = pickRange(prj, o.from, o.to);
  return changesMd(prj, { from, to, exact: !!o.exact });
}

/**
 * Vydá revizi (jméno povinné). Vrací záznam bez zmrazeného obsahu; chyby jako text pro uživatele.
 * Revize nic neschvaluje — jen zaznamená, co v tu chvíli platilo.
 */
export function issueRevision(prj, by, note = "") {
  if (!String(by || "").trim()) throw new Error(tr("Zadej jméno osoby, která revizi vydává."));
  syncIO(prj);
  const r = createRevision(prj, String(by).trim(), String(note || "").trim());
  return { id: r.id, date: fmtStamp(r.date), by: r.by, note: r.note };
}

/**
 * Položky ke schválení dotčené změnou od poslední revize (pro zvýraznění v kroku Schválení):
 * `invalid` = při vydání revize platně schválené a změna je zneplatní (nebo může zneplatnit),
 * `added` = nové povinné položky. `items` = hotové položky aktuálního stavu (přesné).
 */
export function revisionAffected(prj, items) {
  const last = latestRevision(prj);
  if (!last || !modifiedSinceRevision(prj)) return { rev: last ? last.id : "", invalid: [], added: [] };
  const d = changesSinceRevision(prj, undefined, items ? { itemsB: items } : {});
  return { rev: last.id, invalid: d ? d.invalidates : [], added: d ? d.added : [] };
}

/* ================================================================ nabídka */

const safetyCount = prj => { try { return proposeSafety(prj).fns.filter(f => !f.off).length; } catch { return 0; } };

/** Štítky párování ceny (barva: kód zeleně, typ neutrálně, kategorie oranžově „ověř“, bez ceny červeně). */
export function matchLabel(m) {
  return m === "code" ? tr("kód") : m === "type" ? tr("typ") : m === "cat" ? tr("kategorie — ověř") : tr("bez ceny");
}
export const MATCH_TONE = { code: "ok", type: "info", cat: "warn", none: "err" };

/**
 * Nabídka pro UI: parametry odhadu s vysvětlením a výchozí / odhadnutou hodnotou, sazby, kurzy
 * cizích měn z ceníku, oceněný materiál a práce, součty, položky bez ceny a nepoužité řádky ceníku.
 * Ceny se nevymýšlí: bez ceníku / sazby / kurzu zůstane pole prázdné a položka je v `unpriced`.
 */
export function quoteView(prj) {
  syncIO(prj);
  const cfg = prj.quote || {};
  const q = buildQuote(prj);
  const cur = q.currency;
  const M = x => fmtMoney(x, cur);
  const prices = cfg.prices || [];
  const byRow = new Map(prices.map(p => [p.row, p]));
  const nSafety = safetyCount(prj);
  const est = { docPages: docPagesEstimate(prj, nSafety), commissioningDays: commissioningDaysEstimate(prj) };
  const params = [];
  for (const k of Object.keys(QUOTE_PARAM_INFO)) {
    const inf = QUOTE_PARAM_INFO[k];
    if (k === "hoursPerDevice") {
      for (const c of Object.keys(CLS)) {
        const n = prj.devices.filter(d => d.cls === c).length;
        if (!n) continue;
        const v = cfg.params?.hoursPerDevice?.[c];
        params.push({ key: "hoursPerDevice." + c, label: tr("Hodiny na zařízení — {cls}", { cls: tr(CLS[c].label) }), unit: "h",
          help: tr(inf.help), value: fin(v) ? v : null, placeholder: fmtNum(QUOTE_DEFAULTS.hoursPerDevice[c] ?? 0), count: n });
      }
      continue;
    }
    const v = cfg.params?.[k];
    const estimated = k in est;
    params.push({ key: k, label: tr(inf.label), unit: tr(inf.unit), help: tr(inf.help), value: fin(v) ? v : null,
      placeholder: estimated ? tr("odhad {v}", { v: fmtNum(est[k]) }) : fmtNum(QUOTE_DEFAULTS[k]), estimated });
  }
  const rates = Object.keys(RATE_LABEL).map(k => ({ key: k, label: tr(RATE_LABEL[k]), unit: k === "km" ? cur + "/km" : cur + "/h",
    value: fin(cfg.rates?.[k]) ? cfg.rates[k] : null }));
  const foreign = [...new Set(prices.map(p => p.currency))].filter(c => c && c !== cur).sort()
    .map(c => ({ cur: c, value: fin(cfg.fx?.[c]) ? cfg.fx[c] : null, label: tr("Kurz: 1 {from} = ? {to}", { from: c, to: cur }) }));
  const reason = new Map(q.unpriced.filter(u => u.kind === "material").map(u => [u.id, u.reason]));
  const laborReason = new Map(q.unpriced.filter(u => u.kind === "labor").map(u => [u.id, u.reason]));
  const t = q.totals;
  return {
    currency: cur, vatPct: t.vatPct, marginPct: q.marginPct, inDocs: !!cfg.inDocs, file: QUOTE_FILE,
    priceCount: prices.length, foreign, rates, params,
    material: q.material.map(l => ({
      id: l.bomId, pos: l.pos, tag: l.tag, item: l.item, brand: l.brand, type: l.type, orderCode: l.orderCode,
      qty: l.qty, unit: l.unit, supplier: l.supplier, leadTime: l.leadTime, safety: !!l.safety,
      unitPrice: l.unitPrice === undefined ? "" : M(l.unitPrice), total: l.total === undefined ? "" : M(l.total),
      src: l.srcPrice !== undefined && l.srcCurrency !== cur ? fmtMoney(l.srcPrice, l.srcCurrency) : "",
      match: l.match || "none", matchLabel: matchLabel(l.match), tone: MATCH_TONE[l.match || "none"],
      priceRow: l.priceRow || null, reason: reason.get(l.bomId) || "",
    })),
    labor: q.labor.map(l => ({ key: l.key, label: l.label, basis: l.basis, qty: fmtNum(l.qty) + " " + l.unit,
      rate: l.rate === undefined ? "" : M(l.rate) + "/" + l.unit, total: l.total === undefined ? "" : M(l.total),
      help: l.help, reason: laborReason.get(l.key) || "" })),
    totals: {
      materialCost: M(t.materialCost), margin: M(t.margin), material: M(t.material), labor: M(t.labor),
      hours: fmtNum(t.hours) + " h", net: M(t.net), vat: M(t.vat), gross: M(t.gross), complete: t.complete,
      marginLabel: tr("Přirážka na materiál {p} %", { p: fmtNum(q.marginPct) }),
      vatLabel: tr("DPH {p} %", { p: fmtNum(t.vatPct) }),
    },
    unpriced: q.unpriced.map(u => ({ kind: u.kind, id: u.id, label: u.label, reason: u.reason })),
    unused: q.unusedPrices.map(r => byRow.get(r)).filter(Boolean)
      .map(e => ({ row: e.row, orderCode: e.orderCode, type: e.type, brand: e.brand, cat: e.cat, price: fmtMoney(e.price, e.currency) })),
  };
}

/**
 * Načte ceník (CSV / TSV) do `prj.quote.prices`. Když se nenajde záhlaví, stávající ceník
 * zůstane. Vrací počet položek, varování jádra a oddělovač.
 */
export function importPrices(prj, text, defaultCurrency) {
  const pl = parsePriceList(String(text || ""), defaultCurrency ? { defaultCurrency } : {});
  if (pl.entries.length) prj.quote = { ...(prj.quote || {}), prices: pl.entries };
  const delim = pl.delimiter === "\t" ? tr("tabulátor") : pl.delimiter === ";" ? tr("středník") : pl.delimiter === "," ? tr("čárka") : "";
  return { count: pl.entries.length, warnings: pl.warnings, delimiter: delim, kept: !pl.entries.length && !!(prj.quote?.prices || []).length };
}

/**
 * Změní jednu volbu nabídky: `currency`, `vatPct`, `marginPct`, `inDocs`, `rates.<klíč>`,
 * `fx.<měna>`, `params.<parametr>`, `params.hoursPerDevice.<třída>`, `prices` (null = odebrat).
 * `value` null / undefined / "" = výchozí (klíč se smaže — v projektu zůstanou jen zadané volby).
 */
export function setQuote(prj, path, value) {
  const q = prj.quote = { ...(prj.quote || {}) };
  const parts = String(path).split(".");
  const empty = value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
  if (parts[0] === "currency") { if (empty) delete q.currency; else q.currency = String(value).trim().toUpperCase().slice(0, 3); }
  else if (parts[0] === "inDocs") { if (value) q.inDocs = true; else delete q.inDocs; }
  else if (parts[0] === "prices") delete q.prices;
  else if (parts.length === 1) { if (empty) delete q[parts[0]]; else q[parts[0]] = Number(value); }
  else {
    let o = q;
    const chain = parts.slice(0, -1);
    for (const p of chain) o = o[p] = { ...(o[p] || {}) };
    if (empty) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = Number(value);
    /* prázdné podobjekty pryč */
    for (let i = chain.length; i > 0; i--) {
      let par = q;
      for (const p of chain.slice(0, i - 1)) par = par[p];
      const k = chain[i - 1];
      if (par[k] && !Object.keys(par[k]).length) delete par[k];
    }
  }
  if (!Object.keys(q).length) delete prj.quote;
  return prj.quote || null;
}

/** CSV a dokument nabídky (stažení / uložení). */
export function quoteFiles(prj) {
  syncIO(prj);
  const name = (prj.meta.name || "plc-projekt").replace(/[<>:"/\\|?*]+/g, "_").trim() || "plc-projekt";
  const doc = quoteDoc(prj);
  return { csvName: name + "_nabidka.csv", csv: quoteCsv(prj), mdName: doc.path, md: doc.body };
}

/* ================================================================ firemní knihovna */

const ISSUE_ORDER = { error: 0, warn: 1 };

/**
 * Knihovna pro UI: firma, schvalovatelé, typy zařízení, šablony bloků se stavem (chyba /
 * neověřeno simulací) a výsledek kontroly. S projektem `prj` navíc použití šablon na platformách
 * projektu (vlastní / vestavěná + důvod) — přesně jak je vezme generátor (`codeLibrary`).
 */
export function libraryView(lib, prj) {
  if (!lib) return null;
  const issues = validateLibrary(lib).map(i => ({ level: i.level, where: i.where, msg: i.msg }))
    .sort((a, b) => ISSUE_ORDER[a.level] - ISSUE_ORDER[b.level]);
  const c = lib.company || {};
  const tplIssues = id => issues.filter(i => i.where === tr("šablona {id}", { id }));
  const out = {
    name: lib.name || "", version: lib.version || "", updated: lib.updated || "",
    company: { name: c.name || "", logoText: c.logoText || "", address: c.address || "",
      approvers: (c.approvers || []).map(a => ({ name: a.name || "", role: a.role || "" })), codeHeader: c.codeHeader || [] },
    deviceTypes: (lib.deviceTypes || []).map(t => ({
      id: t.id, label: t.label || "", cls: t.cls, clsLabel: CLS[t.cls] ? tr(CLS[t.cls].label) : String(t.cls),
      prefix: t.prefix || (CLS[t.cls] ? CLS[t.cls].prefix : ""), desc: t.desc || "",
      opts: Object.entries(t.opt || {}).filter(([, v]) => v).map(([k]) => CLS[t.cls] && CLS[t.cls].opts[k] ? tr(CLS[t.cls].opts[k]) : k).join(", "),
      range: (t.cls === "AnalogIn" || t.cls === "AnalogOut") && (fin(t.rmin) || fin(t.rmax)) ? (t.rmin ?? 0) + "–" + (t.rmax ?? 100) + (t.unit ? " " + t.unit : "") : "",
      bom: (t.bom || []).length, stepTimeS: fin(t.stepTimeS) ? t.stepTimeS : null,
    })),
    fbTemplates: (lib.fbTemplates || []).map(t => {
      const iss = tplIssues(t.id || "?");
      const errors = iss.filter(i => i.level === "error").length;
      return {
        id: t.id, cls: t.cls, dialect: t.dialect, note: t.note || "", errors,
        platforms: (t.platforms || []).length ? t.platforms.map(p => PLAT[p] ? PLAT[p].name : p).join(", ") : t.dialect === "scl" ? PLAT.siemens.name : tr("všechny platformy IEC ST"),
        status: errors ? "error" : "unverified",
        statusLabel: errors ? tr("chyba — nepoužije se") : tr("neověřeno simulací"),
      };
    }),
    defaults: lib.platformDefaults ? {
      platforms: (lib.platformDefaults.platforms || []).map(p => PLAT[p] ? PLAT[p].name : p).join(", "),
      bomPlat: lib.platformDefaults.bomPlat ? (PLAT[lib.platformDefaults.bomPlat] || { name: lib.platformDefaults.bomPlat }).name : "",
    } : null,
    issues, errors: issues.filter(i => i.level === "error").length, warns: issues.filter(i => i.level === "warn").length,
    usage: [],
  };
  if (prj && (lib.fbTemplates || []).length) {
    const probe = { ...prj, library: lib };
    for (const plat of prj.platforms || []) {
      let cl;
      try { cl = codeLibrary(probe, plat); } catch { continue; }
      const errs = cl.issues.filter(i => i.level === "error");
      const dia = plat === "siemens" ? "scl" : "st";
      for (const cls of FB_CLASSES) {
        const own = cl.ids[cls];
        const cands = (lib.fbTemplates || []).filter(t => t.cls === cls && t.dialect === dia && (!(t.platforms || []).length || t.platforms.includes(plat)));
        if (!own && !cands.length) continue;
        const wheres = new Set(cands.map(t => tr("šablona {id}", { id: t.id || "?" })));
        out.usage.push({ plat, platName: PLAT[plat] ? PLAT[plat].name : plat, cls: "FB_" + cls, used: !!own, id: own || "",
          text: own ? tr("vlastní blok {id} — neověřeno simulací", { id: own }) : tr("vestavěný blok — vlastní šablona nepoužita"),
          why: own ? "" : [...new Set(errs.filter(i => wheres.has(i.where)).map(i => i.msg))].slice(0, 2).join(" ") });
      }
    }
  }
  return out;
}

/** Načte soubor knihovny; `lib` null = nejde použít (viz nálezy). */
export function loadLibrary(text) {
  const r = importLibrary(String(text || ""));
  return { lib: r.lib, issues: r.issues.map(i => ({ level: i.level, where: i.where, msg: i.msg })).sort((a, b) => ISSUE_ORDER[a.level] - ISSUE_ORDER[b.level]) };
}

/** Knihovna jako soubor (stabilní pořadí klíčů, razítko formátu a data). */
export function saveLibrary(lib) {
  return { name: (String(lib.name || "knihovna").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "knihovna") + ".plcdesk-library.json", text: exportLibrary(lib) };
}

/** Vzor knihovny k vyplnění: firma, dva schvalovatelé, jeden typ zařízení s díly kusovníku. */
export function libraryTemplate() {
  const lib = blankLibrary(tr("Firemní standard"));
  lib.company = { name: tr("Název firmy s.r.o."), logoText: "", address: tr("Ulice 1, Město"),
    approvers: [{ name: tr("Jméno Příjmení"), role: tr("vedoucí elektro") }], codeHeader: ["(c) 2026"] };
  lib.deviceTypes = [{ id: "PumpStd", label: tr("Čerpadlo (firemní standard)"), cls: "Motor", prefix: "P", desc: tr("Čerpadlo"),
    opt: { fbk: true, fault: true }, stepTimeS: 5, bom: [{ cat: "motor" }] }];
  return lib;
}

/** Připojí kopii knihovny k projektu (výchozí volby jen tam, kde projekt nic nezvolil). */
export function attachToProject(prj, lib) {
  const { lib: ok, issues } = loadLibrary(JSON.stringify(lib));
  if (!ok) throw new Error(issues.map(i => i.msg).join(" ") || tr("Soubor není knihovna PLCdesk."));
  attachLibrary(prj, ok, true);
  syncIO(prj);
  return prj;
}

/** Odpojí knihovnu od projektu (zařízení z ní zůstanou, generátor vezme vestavěné bloky). */
export function detachLibrary(prj) {
  delete prj.library;
  return prj;
}

/** Typy zařízení knihovny projektu pro výběr „Přidat z knihovny“. */
export function libraryDeviceTypes(prj) {
  const lib = projectLibrary(prj);
  return lib ? (lib.deviceTypes || []).filter(t => CLS[t.cls]).map(t => ({ id: t.id, label: t.label || t.id, cls: t.cls, clsLabel: tr(CLS[t.cls].label) })) : [];
}

/** Přidá zařízení podle typu knihovny projektu; vrací označení nového zařízení. */
export function addFromLibrary(prj, typeId, name) {
  const nm = String(name || "").trim();
  if (nm && prj.devices.some(d => d.name.toUpperCase() === nm.toUpperCase())) throw new Error(tr("Zařízení s označením {name} už v návrhu je — zvol jiné.", { name: nm }));
  const d = addLibraryDevice(prj, typeId, nm || undefined);
  syncIO(prj);
  return { id: d.id, name: d.name };
}

/** Jména schvalovatelů z knihovny projektu. */
export function approverNames(prj) {
  try { return libraryApprovers(prj); } catch { return []; }
}
