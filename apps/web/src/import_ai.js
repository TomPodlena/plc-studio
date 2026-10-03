/* Import stávajícího zařízení — AI vrstva pro podklady, kterým přesný parser jádra nerozumí
   (elektroschémata PDF, naskenované I/O listy, fotky štítků a rozvaděče, P&ID, popis funkce,
   cizí program, u kterého přesná inference skončila jen odhadem).

   Přesné zpracování (exporty PLC, I/O listy CSV…) dělá jádro (packages/core/src/reverse.ts):
   extractFiles → Extracted, inferProject → ImportProposal. Tady vzniká:
     importInstructions  — instrukce pro model (protokol AI návrháře + povinná evidence),
     splitImport         — rozdělení podkladů do dotazů podle limitů Messages API,
     buildImportMessages — zprávy jednoho dotazu (text, PDF jako document, obrázky jako image),
     estimateImport      — odhad tokenů a ceny před odesláním,
     importNorm          — odpověď → ImportProposal (zařízení a sekvence přes aiNorm),
     aiCallImport / aiImport — volání API (web; desktop volá API sám přes ai_client.py).

   Modul importuje i desktopový most v Node — při importu nesmí sahat na DOM ani localStorage.
   Bez závislostí: base64, rozměry obrázků a počet stran PDF čte sám z hlaviček souborů. */
import { CLS, PLAT, blankProject, syncIO, sanitizeTag, normAddr, tr, getLang, LANGS } from "../../../packages/core/dist/index.js";
import { aiNorm, aiSettings, extractJson, AI_DEFAULT_MODEL } from "./ai.js";

/* ------------------------------------------------------------------ limity a ceník
   Ověřeno 2026-10-03 v dokumentaci Anthropic:
   - PDF: https://platform.claude.com/docs/en/build-with-claude/pdf-support
       dotaz max. 32 MB, max. 600 stran na dotaz (100, je-li kontext modelu pod 1M tokenů);
       každá strana = text (typicky 1 500–3 000 tokenů) + obraz strany (cena jako obrázek).
   - obrázky: https://platform.claude.com/docs/en/build-with-claude/vision
       10 MB (base64) na obrázek, max. 8000×8000 px, nad 20 obrázků v dotazu nejvýš 2000 px
       na stranu; 600 obrázků na dotaz (100 u modelů s kontextem 200k); JPEG/PNG/GIF/WebP;
       tokeny = ⌈w/28⌉ × ⌈h/28⌉ po zmenšení — Claude 4.7 a novější: delší strana 2576 px
       a nejvýš 4784 tokenů, ostatní 1568 px / 1568 tokenů.
   - ceny: https://platform.claude.com/docs/en/about-claude/pricing (USD za 1M tokenů). */
export const IMPORT_PRICES_DATE = "2026-10-03";
export const IMPORT_PRICES_SRC = "https://platform.claude.com/docs/en/about-claude/pricing";
/** in/out = USD za 1M tokenů; ctx = kontextové okno; hires = vysoké rozlišení obrázků (Claude 4.7+). */
export const IMPORT_MODELS = {
  "claude-sonnet-5-5": { in: 2, out: 10, ctx: 1000000, hires: true },
  "claude-opus-5-5": { in: 4, out: 20, ctx: 1000000, hires: true },
  "claude-fable-5-1": { in: 10, out: 50, ctx: 1000000, hires: true },
  "claude-haiku-4-5-20251001": { in: 1, out: 5, ctx: 200000, hires: false },
};
/** Neznámý model (vlastní ID): počítá se jako nejdražší, ať odhad nepodstřelí. */
const UNKNOWN_MODEL = { in: 10, out: 50, ctx: 200000, hires: true, unknown: true };

export const API_LIMITS = {
  requestBytes: 32 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,     // base64
  imageMaxPx: 8000,
  manyImages: 20, manyImagesPx: 2000,
  pages1M: 600, pagesSmall: 100,
  imagesPerRequest1M: 600, imagesPerRequestSmall: 100,
};
/** Rezerva pod limitem dotazu (JSON obálka, instrukce, escapování textu). */
const PART_BYTES = 30 * 1024 * 1024;
/** Výstup jednoho dotazu (u Opus / Sonnet 5.5 se do výstupu počítá i přemýšlení). */
export const IMPORT_MAX_TOKENS = 32000;
/** Délka jednoho kusu textového souboru ve znacích (~65k tokenů). */
const TEXT_CHUNK = 200000;
/** Odhad tokenů na stranu PDF: textová vrstva (střed pásma 1 500–3 000). */
const PDF_PAGE_TEXT = 2250;
/** Odhad tokenů obrazu strany PDF (A4 na šířku zmenšené na limit modelu). */
const PDF_PAGE_IMG_HI = 4784, PDF_PAGE_IMG_STD = 1568;
/** Odhad výstupu: zařízení na stranu PDF, strop zařízení z podkladů, tokeny JSON na zařízení. */
const DEV_PER_PAGE = 0.4, DEV_DOC_CAP = 150, TOK_PER_DEV = 200;
/** Znaky na token pro češtinu / kód (novější tokenizér dává víc tokenů než 4 znaky/token). */
const CHARS_PER_TOKEN = 3;

const IMAGE_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EXT_MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  txt: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", md: "text/markdown", json: "application/json",
  xml: "application/xml", st: "text/plain", scl: "text/plain", awl: "text/plain", l5x: "application/xml", gvl: "text/plain",
  exp: "text/plain", log: "text/plain", ini: "text/plain", html: "text/html", htm: "text/html",
};

export function modelInfo(model) {
  return IMPORT_MODELS[model] || UNKNOWN_MODEL;
}

/* ------------------------------------------------------------------ soubory */

/** Druh souboru pro AI: "pdf" | "image" | "text" | "other". */
export function fileKind(f) {
  const ext = String(f.name || "").toLowerCase().split(".").pop();
  const mime = String(f.mime || EXT_MIME[ext] || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (IMAGE_MIME.includes(mime)) return "image";
  if (typeof f.text === "string") return "text";
  if (/^text\/|\/(json|xml|csv)$/.test(mime)) return "text";
  return "other";
}
function mimeOf(f) {
  const ext = String(f.name || "").toLowerCase().split(".").pop();
  const m = String(f.mime || EXT_MIME[ext] || "").toLowerCase();
  return m === "image/jpg" ? "image/jpeg" : m;
}

/** Bajty z base64 (jen začátek `max` bajtů, je-li zadán). */
function b64bytes(b64, max) {
  let s = String(b64 || "").replace(/\s+/g, "");
  if (max) s = s.slice(0, Math.ceil(max / 3) * 4);
  s = s.slice(0, s.length - (s.length % 4));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Velikost dat z délky base64. */
function b64size(b64) {
  const s = String(b64 || "");
  return Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
}

/** Rozměry obrázku z hlavičky (PNG, JPEG, GIF, WebP); null = nepoznáno. */
export function imageSize(b64) {
  let b;
  try { b = b64bytes(b64, 512 * 1024); } catch { return null; }
  const u16 = (i, le) => le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1];
  const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16(6, true), h: u16(8, true) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      // SOF0–SOF15 kromě DHT (C4), JPG (C8) a DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (tag === "VP8 ") return { w: u16(26, true) & 0x3fff, h: u16(28, true) & 0x3fff };
    if (tag === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) };
    }
  }
  return null;
}

/** Počet stran PDF: objekty /Type /Page, jinak /Count stromu stran; null = nepoznáno
    (objekty ve komprimovaných proudech). */
export function pdfPages(b64) {
  let s;
  try {
    const b = b64bytes(b64);
    s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  } catch { return null; }
  const n = (s.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
  if (n) return n;
  let max = 0;
  for (const m of s.matchAll(/\/Count\s+(\d+)/g)) max = Math.max(max, +m[1]);
  return max || null;
}

/** Tokeny obrázku po zmenšení na limit modelu. */
export function imageTokens(w, h, hires) {
  const edge = hires ? 2576 : 1568, cap = hires ? 4784 : 1568;
  if (!(w > 0 && h > 0)) return cap;
  let s = Math.min(1, edge / Math.max(w, h));
  let tok = Math.ceil(w * s / 28) * Math.ceil(h * s / 28);
  while (tok > cap && s > 0.001) {         // zmenšovat po krocích, dokud se nevejde do limitu tokenů
    s *= 0.998;
    tok = Math.ceil(w * s / 28) * Math.ceil(h * s / 28);
  }
  return tok;
}

const textTokens = s => Math.ceil(String(s || "").length / CHARS_PER_TOKEN);

/** Text souboru (textová pole, nebo UTF-8 z base64). */
function fileText(f) {
  if (typeof f.text === "string") return f.text;
  if (!f.data) return "";
  try { return new TextDecoder("utf-8").decode(b64bytes(f.data)); } catch { return ""; }
}

/** Text rozdělený na kusy po řádcích; řádky očíslované (evidence pak cituje `line`). */
function textChunks(text, size = TEXT_CHUNK) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let cur = [], len = 0, from = 1;
  lines.forEach((l, i) => {
    const row = (i + 1) + ": " + l;
    if (len + row.length > size && cur.length) { out.push({ from, to: i, text: cur.join("\n") }); cur = []; len = 0; from = i + 1; }
    cur.push(row); len += row.length + 1;
  });
  if (cur.length || !out.length) out.push({ from, to: lines.length, text: cur.join("\n") });
  return out;
}

/* ------------------------------------------------------------------ rozdělení podkladů */

/**
 * Položky k odeslání: soubory, kterým jádro nerozumí (`ex.unparsed`, binární data doplní
 * `files` podle jména), a těla programů (`ex.pous`, lze vypnout `code: false`).
 * Každá položka: { name, kind, mime, data?, text?, pages?, w?, h?, tokens, bytes, label }.
 */
function importItems(ex, files, model, { code = true } = {}) {
  const mi = modelInfo(model);
  const pageLimit = mi.ctx >= 1000000 ? API_LIMITS.pages1M : API_LIMITS.pagesSmall;
  const byName = new Map((files || []).map(f => [f.name, f]));
  const src = (ex && Array.isArray(ex.unparsed) ? ex.unparsed : []).map(u => ({ ...u, ...(byName.get(u.name) || {}) }));
  // soubory předané jen v `files`, které jádro nevidělo (zpracované přesně se znovu neposílají)
  const parsed = new Set(((ex && ex.files) || []).filter(r => r.ok).map(r => r.name));
  for (const f of files || []) if (!src.some(u => u.name === f.name) && !parsed.has(f.name)) src.push(f);
  const items = [], warnings = [], skipped = [];
  const skip = (name, msg) => { skipped.push({ name, reason: msg }); warnings.push(msg); };
  for (const f of src) {
    const kind = fileKind(f), mime = mimeOf(f);
    if (kind === "pdf") {
      if (!f.data) { skip(f.name, tr("{name}: chybí obsah souboru PDF.", { name: f.name })); continue; }
      const bytes = String(f.data).length;
      let pages = Number(f.pages) > 0 ? Number(f.pages) : pdfPages(f.data), guessed = false;
      if (!pages) { pages = Math.max(1, Math.round(b64size(f.data) / 80000)); guessed = true; }
      const tokens = pages * (PDF_PAGE_TEXT + (mi.hires ? PDF_PAGE_IMG_HI : PDF_PAGE_IMG_STD));
      if (bytes > PART_BYTES) { skip(f.name, tr("{name}: PDF má {mb} MB, dotaz smí mít nejvýš 32 MB — rozděl ho na menší soubory (např. tisk vybraných stran do PDF).", { name: f.name, mb: (bytes / 1048576).toFixed(1) })); continue; }
      if (pages > pageLimit) { skip(f.name, tr("{name}: PDF má {pages} stran, dotaz smí mít nejvýš {max} — rozděl ho na menší soubory.", { name: f.name, pages, max: pageLimit })); continue; }
      if (tokens > mi.ctx - IMPORT_MAX_TOKENS - 20000) { skip(f.name, tr("{name}: PDF se nevejde do kontextu modelu (odhad {tok} tokenů) — rozděl ho na menší soubory.", { name: f.name, tok: tokens })); continue; }
      if (guessed) warnings.push(tr("{name}: počet stran PDF se nepodařilo zjistit, odhad {pages} podle velikosti.", { name: f.name, pages }));
      items.push({ name: f.name, kind, mime: "application/pdf", data: String(f.data).replace(/\s+/g, ""), pages, tokens, bytes, label: "Soubor „" + f.name + "“ (PDF, " + pages + " str.)" });
    } else if (kind === "image") {
      if (!f.data) { skip(f.name, tr("{name}: chybí obsah obrázku.", { name: f.name })); continue; }
      const bytes = String(f.data).length;
      const dim = (Number(f.w) > 0 && Number(f.h) > 0) ? { w: Number(f.w), h: Number(f.h) } : imageSize(f.data);
      if (bytes > API_LIMITS.imageBytes) { skip(f.name, tr("{name}: obrázek má po zakódování {mb} MB, limit je 10 MB — zmenši ho nebo ulož jako JPEG.", { name: f.name, mb: (bytes / 1048576).toFixed(1) })); continue; }
      if (dim && Math.max(dim.w, dim.h) > API_LIMITS.imageMaxPx) { skip(f.name, tr("{name}: obrázek má {w}×{h} px, limit je 8000 px na stranu — zmenši ho.", { name: f.name, w: dim.w, h: dim.h })); continue; }
      const tokens = imageTokens(dim && dim.w, dim && dim.h, mi.hires);
      items.push({ name: f.name, kind, mime, data: String(f.data).replace(/\s+/g, ""), w: dim ? dim.w : 0, h: dim ? dim.h : 0, tokens, bytes,
        big: !dim || Math.max(dim.w, dim.h) > API_LIMITS.manyImagesPx, label: "Soubor „" + f.name + "“ (obrázek" + (dim ? ", " + dim.w + "×" + dim.h + " px" : "") + ")" });
    } else if (kind === "text") {
      const text = fileText(f);
      if (!text.trim()) { skip(f.name, tr("{name}: soubor je prázdný.", { name: f.name })); continue; }
      const chunks = textChunks(text);
      chunks.forEach((c, i) => items.push({
        name: f.name, kind, text: c.text, tokens: textTokens(c.text), bytes: c.text.length * 2,
        label: "Soubor „" + f.name + "“" + (chunks.length > 1 ? " (část " + (i + 1) + "/" + chunks.length + ", řádky " + c.from + "–" + c.to + ")" : ""),
      }));
    } else {
      skip(f.name, tr("{name}: formát AI nepřečte — převeď ho do PDF, PNG/JPEG nebo textu (tabulku do CSV).", { name: f.name }));
    }
  }
  if (code && ex && Array.isArray(ex.pous)) {
    for (const p of ex.pous) {
      if (!p || !p.body || !String(p.body).trim()) continue;
      const file = (p.src && p.src.file) || p.name;
      const chunks = textChunks(p.body);
      chunks.forEach((c, i) => items.push({
        name: file, kind: "code", text: c.text, tokens: textTokens(c.text), bytes: c.text.length * 2,
        label: "Program " + p.name + " (" + p.lang + ", soubor „" + file + "“" + (chunks.length > 1 ? ", část " + (i + 1) + "/" + chunks.length : "")
          + (p.src && p.src.line ? ", od řádku " + p.src.line : "") + ")",
      }));
    }
  }
  return { items, warnings, skipped };
}

/**
 * Rozdělí podklady do dotazů podle limitů API: velikost dotazu, počet stran PDF, počet a rozměr
 * obrázků (nad 20 obrázků jen do 2000 px) a rozpočet tokenů jednoho dotazu.
 * Vrací { parts: [[položky]], warnings, skipped }. Soubor, který se nevejde ani sám, se
 * přeskočí s upozorněním (PDF bez knihovny dělit neumíme — uživatel ho rozdělí sám).
 */
export function splitImport(ex, files, model, opts = {}) {
  const mi = modelInfo(model);
  const { items, warnings, skipped } = importItems(ex, files, model, opts);
  const pageLimit = mi.ctx >= 1000000 ? API_LIMITS.pages1M : API_LIMITS.pagesSmall;
  const imgLimit = mi.ctx >= 1000000 ? API_LIMITS.imagesPerRequest1M : API_LIMITS.imagesPerRequestSmall;
  const tokBudget = opts.partTokens || (mi.ctx >= 1000000 ? 400000 : 140000);
  const parts = [];
  let cur = null;
  const fresh = () => { cur = { items: [], bytes: 0, pages: 0, images: 0, big: false, tokens: 0 }; parts.push(cur); };
  for (const it of items) {
    const fits = cur && cur.items.length
      && cur.bytes + it.bytes <= PART_BYTES
      && cur.pages + (it.pages || 0) <= pageLimit
      && cur.tokens + it.tokens <= tokBudget
      && (it.kind !== "image" || (cur.images + 1 <= imgLimit
        && (cur.images + 1 <= API_LIMITS.manyImages || !(cur.big || it.big))));
    if (!fits) fresh();
    cur.items.push(it);
    cur.bytes += it.bytes; cur.pages += it.pages || 0; cur.tokens += it.tokens;
    if (it.kind === "image") { cur.images++; cur.big = cur.big || it.big; }
  }
  if (!parts.length) parts.push({ items: [], bytes: 0, pages: 0, images: 0, big: false, tokens: 0 });
  if (parts.length > 1) warnings.push(tr("Podklady se rozdělí do {n} dotazů; každý další dostane výsledek předchozích a doplní ho.", { n: parts.length }));
  return { parts: parts.map(p => p.items), warnings, skipped };
}

/* ------------------------------------------------------------------ instrukce */

/** Přesně zjištěné údaje z jádra jako kompaktní text pro kontext. */
function extractedContext(ex, prj) {
  let s = "";
  if (ex && Array.isArray(ex.files) && ex.files.length) {
    s += "\nSOUBORY ZPRACOVANÉ PŘESNÝM PARSEREM (název; formát; signálů; programů):\n"
      + ex.files.map(f => [f.name, f.fmt, f.signals, f.pous].join("; ")).join("\n") + "\n";
  }
  if (ex && ex.platform) s += "Zdrojová platforma (odhad jádra): " + ex.platform + "\n";
  if (ex && Array.isArray(ex.signals) && ex.signals.length) {
    s += "\nSIGNÁLY ZJIŠTĚNÉ PŘESNĚ (tag; adresa; směr; typ; komentář; zařízení; signál; zdroj):\n"
      + ex.signals.map(g => [g.tag, g.addr, g.dir, g.dt, g.cmt, g.dev || "", g.sig || "",
        g.src ? g.src.file + (g.src.line ? ":" + g.src.line : "") : ""].map(v => String(v ?? "").replace(/[;\n]/g, " ")).join("; ")).join("\n") + "\n";
  }
  if (prj && Array.isArray(prj.devices) && prj.devices.length) {
    const nameOf = id => (prj.devices.find(d => d.id === id) || { name: "" }).name;
    s += "\nNÁVRH Z PŘESNÝCH DAT (neměň ho; doplň, co chybí; rozpor uveď v \"conflicts\"):\n"
      + JSON.stringify({
        devices: prj.devices.map(d => ({ name: d.name, cls: d.cls, desc: d.desc, opt: d.opt, unit: d.unit, rmin: d.rmin, rmax: d.rmax, limLo: d.limLo, limHi: d.limHi, setpoint: d.setpoint, role: d.role })),
        estop: nameOf(prj.program && prj.program.estop),
        interlocks: ((prj.program && prj.program.interlocks) || []).map(nameOf),
        seq: ((prj.program && prj.program.seq) || []).map(x => ({ dev: nameOf(x.dev), act: x.act, cond: x.cond, timeS: x.timeS })),
        takt: prj.meta && Number.isFinite(prj.meta.takt) ? prj.meta.takt : null,
      }) + "\n";
  }
  return s;
}

/**
 * Instrukce pro AI import. Protokol je stejný jako u AI návrháře (devices, estop, interlocks,
 * seq, takt, limLo/limHi, setpoint, role, note, questions) a navíc io, evidence, conflicts,
 * missing. Prompt je česky v každém jazyce UI; cizí jazyk přidá pokyn pro texty uživateli.
 * `prj` = návrh z přesných dat (inferProject), `prev` = výsledek předchozích dotazů,
 * `part` = { i, n } u rozdělených podkladů.
 */
export function importInstructions(ex, prj, { prev = null, part = null } = {}) {
  const l = getLang();
  const langNote = l === "cs" ? "" : '\nTexty určené uživateli (otázky "questions", poznámka "note", popisy zařízení "desc", "missing", "conflicts[].note", "evidence[].note") piš v jazyce „' + LANGS[l] + '" — tento pokyn má přednost před pokynem psát popisy česky; označení zařízení, tagy, citace "quote" a klíče JSON zůstávají beze změny.';
  return "Jsi zkušený technik průmyslové automatizace v nástroji PLC Studio. Úkol: ZPĚTNĚ zjistit z podkladů STÁVAJÍCÍHO stroje (elektroschémata, I/O listy, štítky, fotky rozvaděče, P&ID, popis funkce, program PLC) sestavu zařízení řízených PLC, jejich I/O, blokování, sekvenci a meze — a u každé položky doložit, odkud ji víš.\n"
    + "Dostupné třídy zařízení (jiné neexistují):\n"
    + '- "Motor" (M1…): pohon/čerpadlo/dopravník (typicky stykač -K a motor -M); opt.fbk = zpětné hlášení běhu zapojené do vstupu PLC (pomocný kontakt stykače), opt.fault = vstup poruchy (pomocný kontakt jističe / motorového spouštěče -Q, termistor)\n'
    + '- "Ventil" (Y1…): cívka ventilu / pneumatický či hydraulický válec; opt.fbkOpen, opt.fbkClosed = koncáky polohy zapojené do PLC\n'
    + '- "AnalogIn" (B1…): analogové měření (převodník 4–20 mA / 0–10 V); unit, rmin, rmax = rozsah ze štítku nebo schématu; limLo / limHi = meze, jejichž překročení je porucha stroje\n'
    + '- "AnalogOut" (U1…): analogový výstup (frekvenční měnič – žádaná rychlost, proporcionální ventil); unit, rmin, rmax; setpoint = žádaná hodnota\n'
    + '- "DI" (S1…): samostatný digitální vstup — tlačítko, snímač, koncák krytu, světelná závora, E-stop\n'
    + '- "DO" (H1…): samostatný digitální výstup — signálka, houkačka, zámek; role: "run" | "fault" | "ready" | "stopped" | "lock" | "auto"\n'
    + "PRAVIDLA (závazná):\n"
    + "1. NIC NEVYMÝŠLEJ. Každé zařízení, signál I/O, krok sekvence, E-stop, blokování i takt musí mít oporu v podkladu. Co v podkladu není, nepřidávej — a pokud to stroj zjevně potřebuje (např. motor bez zpětného hlášení, válec bez koncáku, chybí popis cyklu), napiš to do \"missing\".\n"
    + '2. EVIDENCE ke každé položce: "evidence": { "<klíč>": { "conf": "sure|guess|missing", "src": [ { "file": "přesný název souboru", "page": číslo strany PDF od 1, "line": řádek textu, "quote": "doslovná krátká citace z podkladu (do 200 znaků)" } ], "note": "" } }. Klíče: "dev:<název>", "io:<tag>", "seq:<index od 0>", "estop", "lock:<název>", "meta". conf "sure" = v podkladu výslovně uvedeno; "guess" = odvozeno (ze značky, z kontextu, z názvu); "missing" = položka je nutná, ale podklad ji nedokládá. Bez zdroje = conf "missing", nebo položku vynech. Název souboru uváděj přesně tak, jak je zadán (řádky textových souborů jsou očíslované).\n'
    + "3. OZNAČENÍ podle IEC 81346 ze schémat: -M1 → \"M1\", =A1+S2-Y3 → \"Y3\" (bez =, + a -). Zachovej původní číslo; jen třídu zařízení urči podle funkce. Při kolizi stejného označení ve dvou částech stroje doplň příponu (M1_2) a uveď to v \"conflicts\".\n"
    + "4. Do sestavy patří jen zařízení, jejichž signál je zapojen do PLC (svorka vstupní/výstupní karty, adresa, tag). Silové obvody bez vazby na PLC nepřidávej, jen je zmiň v \"note\".\n"
    + '5. BEZPEČNOST: E-stop a kryty, světelné závory, zámky převezmi JEN jako signály (DI), pokud je jejich kontakt zapojen do PLC (např. zpětné hlášení bezpečnostního relé). NIKDY neodvozuj ani nepopisuj bezpečnostní okruh, bezpečnostní relé, safety PLC ani bezpečnostní logiku a nedávej je do sekvence. Název E-stop DI vrať v "estop"; ochranné prvky, které podle podkladu zastavují stroj, vrať v "interlocks" (funkční blokování, ne bezpečnostní funkce). Nouzové zastavení nevymýšlej — chybí-li v podkladu, uveď to v "missing".\n'
    + "6. PŘESNÁ DATA z exportů a programů (viz níže) jsou ověřená: neměň je, jen doplň (popisy, třídy, chybějící signály, meze ze štítků). Pokud podklad tvrdí něco jiného, nech přesnou hodnotu a rozpor zapiš do \"conflicts\": [{\"what\":\"<klíč evidence>\",\"note\":\"v čem se liší\",\"src\":[...]}].\n"
    + "7. ADRESY: v \"io\" uveď skutečné zapojení: {\"dev\":\"M1\",\"sig\":\"fbkRunning|fault|outRun|fbkOpen|fbkClosed|outOpen|raw|in|out\",\"addr\":\"%I0.0\",\"tag\":\"původní tag\",\"cmt\":\"původní popis\",\"nc\":true|false}. Adresu převeď do Siemens notace (%I bajt.bit, %Q bajt.bit, %IW / %QW bajt); CODESYS %IX0.0 = %I0.0. Není-li převod jednoznačný (Rockwell Local:1:I.Data.3, Mitsubishi X/Y, Omron), nech \"addr\" prázdnou a původní adresu dej do \"cmt\". nc = rozpínací kontakt.\n"
    + '8. SEKVENCE jen tehdy, když ji podklad popisuje (popis funkce, diagram, program): kroky {"dev","act":"start|stop|open|close|wait|waitOn|waitOff","cond":"fbk|time","timeS"}; wait má dev "" a cond "time"; waitOn/waitOff mají dev = DI a cond "fbk". Časy, takt a meze jen z podkladu; jinak je vynech a uveď v "missing".\n'
    + "9. Chybí-li zásadní informace, polož nejvýš 3 otázky v \"questions\" (sestavu přesto vrať se vším doloženým).\n"
    + extractedContext(ex, prj)
    + (part && part.n > 1 ? "\nToto je dotaz " + part.i + " z " + part.n + " (podklady jsou rozdělené).\n" : "")
    + (prev ? "\nVÝSLEDEK Z PŘEDCHOZÍCH DOTAZŮ — doplň ho o podklady tohoto dotazu a vrať CELÝ aktualizovaný JSON (evidence z předchozích dotazů zachovej):\n" + JSON.stringify(prev) + "\n" : "")
    + '\nOdpověz POUZE jedním JSON objektem: {"questions":[],"name":"název stroje","devices":[{"name","cls","desc","opt":{},"unit","rmin","rmax","limLo","limHi","setpoint","role"}],"estop":"S1","interlocks":["S2"],"seq":[],"takt":null,"io":[],"evidence":{"dev:M1":{"conf":"sure","src":[{"file":"schema.pdf","page":3,"quote":"-M1 Čerpadlo 4 kW"}]}},"conflicts":[],"missing":[],"note":"shrnutí"}'
    + langNote;
}

/* ------------------------------------------------------------------ zprávy */

/** Blok obsahu Messages API pro položku. */
function itemBlocks(it) {
  if (it.kind === "pdf") return [{ type: "text", text: it.label + ":" }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: it.data }, title: it.name }];
  if (it.kind === "image") return [{ type: "text", text: it.label + ":" }, { type: "image", source: { type: "base64", media_type: it.mime, data: it.data } }];
  return [{ type: "text", text: it.label + ":\n```\n" + it.text + "\n```" }];
}

/**
 * Zprávy jednoho dotazu pro Messages API: podklady (PDF jako document, obrázky jako image,
 * text jako text — každý s popiskem souboru), na konci instrukce s přesnými daty.
 * `files` = vstupní soubory (InputFile + `data` = base64 u binárních), `part` = index dotazu,
 * `prev` = surový JSON předchozího dotazu, `prj` = návrh z přesných dat.
 * Vrací { messages, part, parts, files, warnings, skipped }.
 */
export function buildImportMessages(ex, files, { part = 0, prev = null, prj = null, model = AI_DEFAULT_MODEL, code = true, plan = null } = {}) {
  const sp = plan || splitImport(ex, files, model, { code });
  const items = sp.parts[part] || [];
  const content = items.flatMap(itemBlocks);
  content.push({ type: "text", text: importInstructions(ex, prj, { prev, part: { i: part + 1, n: sp.parts.length } }) });
  return {
    messages: [{ role: "user", content }],
    part, parts: sp.parts.length,
    files: [...new Set(items.map(i => i.name))],
    warnings: sp.warnings, skipped: sp.skipped,
  };
}

/* ------------------------------------------------------------------ odhad ceny */

/**
 * Odhad tokenů a ceny před odesláním. PDF podle stran (text + obraz strany), obrázky podle
 * rozměrů, text podle znaků; výstup podle očekávaného počtu zařízení (každý další dotaz
 * vrací celý výsledek znovu a dostává předchozí jako vstup). Je to odhad — skutečnost
 * ukáže `usage` odpovědi.
 * Vrací { inputTokens, outputTokens, usd, parts: [{files, inputTokens, outputTokens}], warnings, model, priceDate }.
 */
export function estimateImport(files, model = AI_DEFAULT_MODEL, { ex = null, prj = null, code = true } = {}) {
  const exx = ex || { files: [], signals: [], pous: [], unparsed: [] };
  const mi = modelInfo(model);
  const sp = splitImport(exx, files, model, { code });
  const warnings = [...sp.warnings];
  if (mi.unknown) warnings.push(tr("Model {model} není v ceníku — odhad počítá s cenou nejdražšího modelu.", { model }));
  const instr = textTokens(importInstructions(exx, prj));
  const nSig = (exx.signals || []).length;
  let cum = 0, inTok = 0, outTok = 0, prevJson = 0, warned = false;
  const parts = sp.parts.map((items, i) => {
    /* Očekávaná zařízení: z přesných signálů + z podkladů až po tuto část. Strana PDF
       (manuál, popis, schéma) dá v průměru ~0,4 zařízení — I/O listy a schémata víc, textové
       strany manuálů nic; podklady jako celek nejvýš 150 zařízení (střední linka). */
    cum += items.reduce((a, it) => a + (it.kind === "pdf" ? it.pages * DEV_PER_PAGE : it.kind === "image" ? 2 : it.tokens / 3000), 0);
    const devs = Math.max(3, Math.ceil(nSig / 2 + Math.min(DEV_DOC_CAP, cum)));
    const json = devs * TOK_PER_DEV;       // zařízení + io + evidence v JSON odpovědi
    const want = 2500 + json;              // + přemýšlení a shrnutí
    const out = Math.min(IMPORT_MAX_TOKENS, want);
    const inp = instr + items.reduce((a, it) => a + it.tokens + 20, 0) + prevJson;
    prevJson = Math.min(json, out);
    inTok += inp; outTok += out;
    // varovat jen tehdy, když výsledek limit odpovědi opravdu ohrožuje (a jen jednou)
    if (want > IMPORT_MAX_TOKENS * 0.9 && !warned) {
      warned = true;
      warnings.push(tr("Dotaz {n}: výsledek (odhad {devs} zařízení) se může blížit limitu odpovědi {max} tokenů — při chybě rozděl podklady na menší celky.", { n: i + 1, devs, max: IMPORT_MAX_TOKENS }));
    }
    return { files: [...new Set(items.map(it => it.name))], inputTokens: inp, outputTokens: out };
  });
  const usd = (inTok * mi.in + outTok * mi.out) / 1e6;
  return { inputTokens: inTok, outputTokens: outTok, usd: Math.round(usd * 10000) / 10000, parts, warnings, skipped: sp.skipped, model, priceDate: IMPORT_PRICES_DATE, priceSrc: IMPORT_PRICES_SRC };
}

/* ------------------------------------------------------------------ normalizace */

const CONF = ["sure", "guess", "missing"];
/** Označení podle IEC 81346 → název zařízení: "=A1+S2-M1" → "M1", "-M1" → "M1". */
export function iecName(n) {
  let s = String(n ?? "").trim();
  if (/[-=+]/.test(s)) { const parts = s.split(/[-=+]/).filter(Boolean); s = parts.length ? parts[parts.length - 1] : ""; }
  return s ? sanitizeTag(s) : "";
}
/** Zdroj s existujícím souborem; jinak null. */
function normSrc(s, known) {
  if (!s || typeof s !== "object") return null;
  const file = String(s.file || "").trim();
  if (!file || !known.has(file)) return null;
  const o = { file };
  if (Number.isInteger(Number(s.page)) && Number(s.page) > 0) o.page = Number(s.page);
  if (Number.isInteger(Number(s.line)) && Number(s.line) > 0) o.line = Number(s.line);
  if (s.quote) o.quote = String(s.quote).slice(0, 300);
  return o;
}

/**
 * Odpověď AI (surový JSON nebo text) → ImportProposal { prj, evidence, conflicts, missing }
 * + { questions, note, dropped }. Zařízení a sekvence projdou `aiNorm`, projekt je kompletní
 * (blankProject + syncIO). Adresa I/O se převezme jen z "io" s evidencí "io:<tag>" se zdrojem;
 * ostatní adresy zůstanou prázdné a doplní je jádro po sloučení (syncIO). Evidence jen se známým klíčem, platnou jistotou
 * a zdrojem v existujícím souboru (název z `ex` nebo `files`); jistota „sure"/„guess" bez
 * platného zdroje se zahodí. Položky bez evidence dostanou conf „missing".
 */
export function importNorm(raw, ex, files = []) {
  let r = raw;
  if (typeof r === "string") r = extractJson(r);
  if (!r || typeof r !== "object") r = {};
  // IEC 81346 → názvy zařízení (i v odkazech: estop, interlocks, seq, io, klíče evidence)
  const ren = n => iecName(n);
  const r2 = {
    ...r,
    devices: (Array.isArray(r.devices) ? r.devices : []).map(d => d && typeof d === "object" ? { ...d, name: ren(d.name) } : d),
    estop: r.estop ? ren(r.estop) : "",
    interlocks: (Array.isArray(r.interlocks) ? r.interlocks : []).map(ren),
    seq: (Array.isArray(r.seq) ? r.seq : []).map(s => s && typeof s === "object" ? { ...s, dev: s.dev ? ren(s.dev) : "" } : s),
  };
  const a = aiNorm(r2);

  const prj = blankProject();
  if (ex && ex.platform && PLAT[ex.platform]) prj.platforms = [ex.platform];
  prj.meta.name = String(r.name || "").trim();
  const byName = {};
  for (const d of a.devices) {
    if (!d.name || byName[d.name]) continue;
    const nd = { id: prj.nextId++, ...d };
    prj.devices.push(nd); byName[d.name] = nd;
  }
  // io z odpovědi: volby signálů, které podklad dokládá, zapnout ještě před syncIO
  const ioRaw = (Array.isArray(r.io) ? r.io : []).filter(e => e && typeof e === "object").map(e => ({ ...e, dev: ren(e.dev), sig: String(e.sig || "") }));
  const SIG_OPT = { Motor: { fbkRunning: "fbk", fault: "fault" }, Ventil: { fbkOpen: "fbkOpen", fbkClosed: "fbkClosed" } };
  for (const e of ioRaw) {
    const d = byName[e.dev], k = d && SIG_OPT[d.cls] && SIG_OPT[d.cls][e.sig];
    if (k && CLS[d.cls].opts[k] !== undefined && d.opt[k] === undefined) d.opt[k] = true;
  }
  syncIO(prj);
  /* Adresy: platí jen ty, které AI uvedla a doložila evidencí "io:<tag>" se zdrojem (viz níže).
     Ostatní zůstávají prázdné — volné adresy doplní jádro až po sloučení s přesným návrhem
     (syncIO / autoAddr), aby je mergeProposals nebral jako zjištěné z podkladů. */
  for (const e of prj.io) e.addr = "";
  const ioMap = new Map(prj.io.map(e => [(prj.devices.find(d => d.id === e.devId) || {}).name + ":" + e.sig, e]));
  const tagAlias = {};                    // výchozí tag (M1_fbkRunning) → původní tag stroje
  const usedTag = new Set(prj.io.map(e => e.tag));
  const wantAddr = new Map();             // řádek I/O → adresa navržená AI (zatím bez ověření zdroje)
  for (const e of ioRaw) {
    const io = ioMap.get(e.dev + ":" + e.sig);
    if (!io) continue;
    const addr = /^%/.test(String(e.addr || "").trim()) ? normAddr(String(e.addr)) : "";
    const okDir = addr && (io.dir === "DI" ? /^%I\d+\.\d+$/ : io.dir === "DO" ? /^%Q\d+\.\d+$/ : io.dir === "AI" ? /^%IW\d+$/ : /^%QW\d+$/).test(addr);
    if (okDir) wantAddr.set(io, addr);
    const t = e.tag ? sanitizeTag(String(e.tag)) : "";
    if (t && t !== io.tag && !usedTag.has(t)) { tagAlias[io.tag] = t; usedTag.delete(io.tag); usedTag.add(t); io.tag = t; }
    if (e.cmt) io.cmt = String(e.cmt).slice(0, 200);
    if (io.dir === "DI" && typeof e.nc === "boolean") io.nc = e.nc;
  }

  prj.program.estop = byName[a.estop] ? byName[a.estop].id : "";
  prj.program.interlocks = a.interlocks.map(n => byName[n]).filter(d => d && d.cls === "DI").map(d => d.id);
  prj.program.seq = a.seq.map(s => ({ dev: s.act === "wait" ? 0 : (byName[s.dev] || { id: 0 }).id, act: s.act, cond: s.cond, timeS: s.timeS }))
    .filter(s => s.act === "wait" || s.dev);
  if (a.takt) prj.meta.takt = a.takt;

  // evidence: známé klíče, platná jistota, zdroj v existujícím souboru
  const known = new Set([
    ...((ex && ex.files) || []).map(f => f.name), ...((ex && ex.unparsed) || []).map(f => f.name),
    ...((ex && ex.pous) || []).map(p => p.src && p.src.file).filter(Boolean),
    ...((ex && ex.signals) || []).map(g => g.src && g.src.file).filter(Boolean),
    ...(files || []).map(f => f.name),
  ]);
  const keys = new Set([
    ...prj.devices.map(d => "dev:" + d.name), ...prj.io.map(e => "io:" + e.tag),
    ...prj.program.seq.map((_, i) => "seq:" + i),
    ...(prj.program.estop !== "" ? ["estop"] : []),
    ...prj.program.interlocks.map(id => "lock:" + prj.devices.find(d => d.id === id).name), "meta",
  ]);
  const normKey = k => {
    const m = String(k).match(/^(dev|lock|io):(.*)$/);
    if (!m) return String(k);
    if (m[1] === "io") { const t = sanitizeTag(m[2]); return "io:" + (!keys.has("io:" + t) && tagAlias[t] ? tagAlias[t] : t); }
    return m[1] + ":" + ren(m[2]);
  };
  const evidence = {}, dropped = [];
  const ev = r.evidence && typeof r.evidence === "object" && !Array.isArray(r.evidence) ? r.evidence : {};
  for (const [k0, v] of Object.entries(ev)) {
    const k = normKey(k0);
    if (!keys.has(k) || !v || typeof v !== "object" || !CONF.includes(v.conf)) { dropped.push(k0); continue; }
    const src = (Array.isArray(v.src) ? v.src : [v.src]).map(s => normSrc(s, known)).filter(Boolean);
    if (v.conf !== "missing" && !src.length) { dropped.push(k0); continue; }
    evidence[k] = { conf: v.conf, src, ...(v.note ? { note: String(v.note).slice(0, 300) } : {}) };
  }
  // adresy I/O: převzít jen doložené (evidence io:<tag> „sure"/„guess" se zdrojem), bez duplicit
  const usedAddr = new Set(), conflictsAddr = [];
  for (const [io, addr] of wantAddr) {
    const k = "io:" + io.tag, e = evidence[k];
    const sourced = e && e.conf !== "missing" && e.src.length;
    if (sourced && !usedAddr.has(addr)) { io.addr = addr; usedAddr.add(addr); }
    else if (sourced) conflictsAddr.push({ what: k, note: tr("Adresa {addr} je v podkladech uvedena u více signálů.", { addr }), src: e.src });
    else if (!e) {
      evidence[k] = { conf: "missing", src: [], note: tr("Adresa {addr} bez zdroje v podkladech — nepřevzata, doplní se automaticky.", { addr }) };
    }
  }
  // položky bez doložení — k revizi
  const noSrc = tr("AI neuvedla zdroj — ověř v podkladech.");
  for (const k of keys) {
    if (k === "meta" || k.startsWith("io:") || evidence[k]) continue;
    evidence[k] = { conf: "missing", src: [], note: noSrc };
  }
  const conflicts = (Array.isArray(r.conflicts) ? r.conflicts : []).filter(c => c && typeof c === "object" && (c.what || c.note)).slice(0, 100).map(c => ({
    what: normKey(String(c.what || "")), note: String(c.note || "").slice(0, 500),
    src: (Array.isArray(c.src) ? c.src : []).map(s => normSrc(s, known)).filter(Boolean),
  })).concat(conflictsAddr);
  const missing = (Array.isArray(r.missing) ? r.missing : []).map(m => String(m || "").trim()).filter(Boolean).slice(0, 100);
  return { prj, evidence, conflicts, missing, questions: a.questions, note: a.note, dropped };
}

/* ------------------------------------------------------------------ volání API (web) */

/**
 * Jeden dotaz na Messages API se zprávami z buildImportMessages (obsah = seznam bloků).
 * Klíč a model z nastavení AI (lze přepsat `key` / `model`), `signal` = tlačítko Stop.
 * Vrací { text, usage, stopReason }. Chybové kódy jako aiCall + "too_large", "truncated", "refusal".
 */
export async function aiCallImport(messages, { signal, key, model, maxTokens = IMPORT_MAX_TOKENS } = {}) {
  const cfg = aiSettings();
  const k = key || cfg.key;
  if (!k) { const e = new Error(tr("Chybí API klíč.")); e.code = "no_key"; throw e; }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": k,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: model || cfg.model || AI_DEFAULT_MODEL, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) {
    const e = new Error("API " + res.status);
    e.code = { 400: "bad_request", 401: "bad_key", 413: "too_large", 429: "rate_limited" }[res.status] || "api_error";
    try { e.detail = (await res.json()).error?.message; } catch { /* ignore */ }
    throw e;
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") { const e = new Error(tr("Model odmítl dotaz zpracovat.")); e.code = "refusal"; throw e; }
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  if (data.stop_reason === "max_tokens") { const e = new Error(tr("Odpověď se nevešla do limitu — rozděl podklady na menší celky.")); e.code = "truncated"; e.text = text; throw e; }
  return { text, usage: data.usage || {}, stopReason: data.stop_reason || "" };
}

/**
 * Celý AI import: rozdělí podklady, pošle dotazy postupně (každý další dostane výsledek
 * předchozích) a odpověď znormalizuje. `onPart(i, n)` hlásí průběh.
 * Vrací { proposal, raw, usage: {input_tokens, output_tokens}, parts, partsDone, warnings, skipped }.
 * Selže-li (nebo je zastaven Stopem) některý další dotaz, vrátí výsledek posledního úspěšného:
 * { proposal: null, partial: ImportProposal, error, partsDone, raw, usage, parts, … }.
 * Selže-li hned první dotaz, chybu vyhodí (není co nabídnout).
 * Sloučení s přesným návrhem jádra: core.mergeProposals(přesný, proposal || partial).
 */
export async function aiImport(ex, files, { signal, prj = null, key, model, code = true, onPart } = {}) {
  const m = model || aiSettings().model || AI_DEFAULT_MODEL;
  const plan = splitImport(ex, files, m, { code });
  let prev = null, done = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const base = () => ({ raw: prev, usage, parts: plan.parts.length, partsDone: done, warnings: plan.warnings, skipped: plan.skipped });
  try {
    for (let i = 0; i < plan.parts.length; i++) {
      if (onPart) onPart(i, plan.parts.length);
      const { messages } = buildImportMessages(ex, files, { part: i, prev, prj, model: m, plan });
      const r = await aiCallImport(messages, { signal, key, model: m });
      usage.input_tokens += r.usage.input_tokens || 0;
      usage.output_tokens += r.usage.output_tokens || 0;
      prev = extractJson(r.text);
      done = i + 1;
    }
  } catch (error) {
    if (!done) throw error;
    return { proposal: null, partial: importNorm(prev, ex, files), error, ...base() };
  }
  return { proposal: importNorm(prev, ex, files), ...base() };
}
