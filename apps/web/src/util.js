/* Drobné UI utility. */
import {
  tr, blankProject, CLS, PLAT, DO_ROLES, isGuid, ensureGuids, projectTitle, isIsoDate,
  withFilePrefix, prefixProjectFiles, projectBundle, projectZip, nextProjectNumber, PREFIX_EXEMPT,
} from "../../../packages/core/dist/index.js";
import { aiNorm } from "./ai.js";
import { normSafety } from "./safety_view.js";
import { normBiz } from "./biz_view.js";
import { licenseFilter, currentProject, gateFor, openLicenseDialog } from "./license.js";

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/** Vlastní klíč tabulky (ne „toString“ / „constructor“ z prototypu — cizí JSON by s ním prošel přes `in`). */
export const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
/** Konečné číslo z čísla nebo číselného textu; cokoli jiného (text, null, bool, objekt, ±Infinity) = undefined. */
const numOf = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  return undefined;
};
/** Číselná pole zařízení, kroku sekvence a konfigurace osy (model.ts Device / SeqStep, axis.ts AxisCfg). */
const DEV_NUM = ["rmin", "rmax", "limHi", "limLo", "setpoint", "rampS", "tol", "tolTimeS", "selBits", "travelS"];
const STEP_NUM = ["sp", "rec", "pos", "vel", "acc", "dec"];
const AXIS_NUM = ["vMax", "aMax", "dMax", "jerk", "vDef", "limNeg", "limPos", "homePos", "posTol", "followMax", "jogVel", "startPos"];
const DIRS = ["DI", "DO", "AI", "AO"];
/**
 * Projekt z načteného JSON (import / localStorage) v bezpečném tvaru: zahodí, co neodpovídá
 * modelu (jinak by rozbitý soubor shodil vykreslení a uložil se). Nejde-li o projekt, vyhodí chybu.
 */
export function normProject(raw) {
  if (!isObj(raw)) throw new Error("not a project");
  /* cizí JSON (package.json, export jiné aplikace) není prázdný projekt — nesmí přepsat rozpracovaný návrh */
  if (!["meta", "devices", "io", "program", "platforms"].some(k => ownKey(raw, k))) throw new Error("not a project");
  const p = blankProject();
  if (isObj(raw.meta)) {
    p.meta = { ...raw.meta, name: String(raw.meta.name ?? ""), desc: String(raw.meta.desc ?? "") };
    if (!(Number.isFinite(raw.meta.takt) && raw.meta.takt > 0)) delete p.meta.takt;
    /* číslo projektu, zákazník a složka dat (desktop) — jen text; prázdné se neukládá. Složka dat se
       ve webu nezobrazuje, ale zůstává (projekt putuje mezi webem a desktopem). */
    for (const f of ["number", "customer", "dataDir"]) {
      if (typeof raw.meta[f] === "string" && raw.meta[f].trim()) p.meta[f] = raw.meta[f]; else delete p.meta[f];
    }
    /* datum zahájení projektu: jen platné ISO YYYY-MM-DD */
    if (isIsoDate(raw.meta.startDate)) p.meta.startDate = raw.meta.startDate; else delete p.meta.startDate;
  }
  if (Array.isArray(raw.platforms)) p.platforms = raw.platforms.filter(k => ownKey(PLAT, k));
  /* styl kódu: jen "oop" se ukládá (výchozí klasický = bez pole) */
  if (raw.codeStyle === "oop") p.codeStyle = "oop";
  if (Array.isArray(raw.devices)) {
    const seen = new Set();
    p.devices = raw.devices.filter(d => isObj(d) && ownKey(CLS, d.cls) && Number.isFinite(d.id) && !seen.has(d.id) && seen.add(d.id))
      .map(d => {
        const nd = { ...d, name: String(d.name ?? ""), desc: String(d.desc ?? ""), unit: String(d.unit ?? ""),
          opt: isObj(d.opt) ? Object.fromEntries(Object.entries(d.opt).map(([k, v]) => [k, !!v])) : {} };
        /* čísla jen jako konečná čísla — text z cizího JSON by se jinak dostal do HTML i do kódu (test odolnosti 2026-10-08) */
        for (const f of DEV_NUM) { const n = numOf(d[f]); if (n === undefined) delete nd[f]; else nd[f] = n; }
        /* rozsah je povinný (měřítko analogů v kódu): neplatný → výchozí 0–100 jako při přidání zařízení */
        if (d.rmin !== undefined && nd.rmin === undefined) nd.rmin = 0;
        if (d.rmax !== undefined && nd.rmax === undefined) nd.rmax = 100;
        if (!ownKey(DO_ROLES, d.role)) delete nd.role;
        if (typeof d.libType !== "string") delete nd.libType;
        if (!isGuid(d.guid)) delete nd.guid;
        /* polohovací pohon: tabulka záznamů jen v platném tvaru (číslo, název, poloha, rychlost) */
        if (d.records !== undefined) {
          if (Array.isArray(d.records)) nd.records = d.records.filter(r => isObj(r) && Number.isInteger(r.no))
            .map(r => ({ no: r.no, name: String(r.name ?? ""), ...(Number.isFinite(r.pos) ? { pos: r.pos } : {}), ...(Number.isFinite(r.vel) ? { vel: r.vel } : {}) }));
          else delete nd.records;
        }
        /* servoosa: konfigurační list — čísla, text pohonu, pojmenované polohy */
        if (d.axis !== undefined) {
          if (isObj(d.axis)) {
            const a = {};
            for (const f of AXIS_NUM) { const n = numOf(d.axis[f]); if (n !== undefined) a[f] = n; }
            if (typeof d.axis.drive === "string") a.drive = d.axis.drive;
            if (Array.isArray(d.axis.positions)) a.positions = d.axis.positions.filter(x => isObj(x) && Number.isFinite(numOf(x.pos)))
              .map(x => ({ name: String(x.name ?? ""), pos: numOf(x.pos) }));
            nd.axis = a;
          } else delete nd.axis;
        }
        return nd;
      });
  }
  const ids = new Set(p.devices.map(d => d.id));
  if (Array.isArray(raw.io)) p.io = raw.io.filter(e => isObj(e) && typeof e.key === "string" && ids.has(e.devId))
    .filter(e => DIRS.includes(e.dir))
    .map(e => {
      const ne = { ...e, sig: String(e.sig ?? ""), tag: String(e.tag ?? ""), addr: String(e.addr ?? ""), cmt: String(e.cmt ?? "") };
      if (e.nc !== undefined) ne.nc = e.nc === true;
      if (!isGuid(e.guid)) delete ne.guid;
      return ne;
    });
  if (isObj(raw.program)) {
    const pr = raw.program;
    p.program = {
      ...p.program, ...pr,
      estop: ids.has(pr.estop) ? pr.estop : "",
      interlocks: Array.isArray(pr.interlocks) ? pr.interlocks.filter(id => ids.has(id) && id !== pr.estop) : [],
      modes: pr.modes === undefined ? p.program.modes : !!pr.modes,
      seq: Array.isArray(pr.seq) ? pr.seq.filter(s => isObj(s) && typeof s.act === "string" && (s.act === "wait" || ids.has(s.dev)))
        .map(s => {
          /* čekání bez zařízení: dev vždy 0 (cizí hodnota by šla do data-* atributů výkresů) */
          const ns = { ...s, dev: s.act === "wait" ? (s.dev === "" ? "" : 0) : s.dev, timeS: numOf(s.timeS) > 0 ? numOf(s.timeS) : 1 };
          /* přechod jen „fbk“ / „time“; jiná hodnota = výchozí (zpětné hlášení), chybějící zůstává chybět (otisky schválení) */
          if (s.cond !== undefined && s.cond !== "fbk" && s.cond !== "time") ns.cond = s.act === "wait" ? "time" : "fbk";
          for (const f of STEP_NUM) { const n = numOf(s[f]); if (n === undefined) delete ns[f]; else ns[f] = n; }
          if (s.rev !== undefined) ns.rev = s.rev === true;
          if (typeof s.posRef !== "string") delete ns.posRef;
          return ns;
        }) : [],
    };
  }
  /* volby kusovníku: platforma, výrobce po kategoriích, úpravy řádků (jen texty a čísla) */
  if (isObj(raw.bom)) {
    const b = {};
    if (ownKey(PLAT, raw.bom.plat)) b.plat = raw.bom.plat;
    if (isObj(raw.bom.brand)) {
      const br = Object.fromEntries(Object.entries(raw.bom.brand).filter(([, v]) => typeof v === "string"));
      if (Object.keys(br).length) b.brand = br;
    }
    if (isObj(raw.bom.lines)) {
      const ls = {};
      for (const [id, o] of Object.entries(raw.bom.lines)) {
        if (!isObj(o)) continue;
        const c = {};
        for (const f of ["brand", "type", "orderCode", "supplier", "note"]) if (typeof o[f] === "string") c[f] = o[f];
        if (Number.isFinite(o.qty) && o.qty >= 0) c.qty = o.qty;
        if (Object.keys(c).length) ls[id] = c;
      }
      if (Object.keys(ls).length) b.lines = ls;
    }
    p.bom = b;
  }
  /* schválení položek a výsledky oživení: jen záznamy v platném tvaru (jinak by shodily kroky 11–13) */
  const str = v => typeof v === "string";
  if (isObj(raw.approvals)) {
    const a = {};
    for (const [k, r] of Object.entries(raw.approvals)) {
      if (!isObj(r) || !["approved", "rejected", "proposed"].includes(r.state) || !str(r.by) || !r.by.trim() || !str(r.at) || !str(r.hash)) continue;
      a[k] = { state: r.state, by: r.by, at: r.at, hash: r.hash, ...(str(r.note) && r.note ? { note: r.note } : {}) };
    }
    if (Object.keys(a).length) p.approvals = a;
  }
  if (isObj(raw.commissioning)) {
    const c = {};
    for (const [k, r] of Object.entries(raw.commissioning)) {
      if (!isObj(r) || !["ok", "nok", "na"].includes(r.result) || !str(r.by) || !r.by.trim() || !str(r.at)) continue;
      c[k] = { result: r.result, by: r.by, at: r.at, ...(str(r.note) && r.note ? { note: r.note } : {}), ...(str(r.measured) && r.measured ? { measured: r.measured } : {}) };
    }
    if (Object.keys(c).length) p.commissioning = c;
  }
  /* bezpečnostní data (úpravy návrhu funkcí, parametry výpočtu) */
  const sf = normSafety(raw.safety);
  if (sf) p.safety = sf;
  /* revize, volby nabídky a kopie firemní knihovny (biz_view.js) */
  normBiz(raw, p);
  /* časy modelu stroje pro simulaci (i výchozí z firemní knihovny) a zvolený koncept řešení */
  if (isObj(raw.sim)) {
    const s = {};
    for (const f of ["motorDelay", "valveTravel"]) if (Number.isFinite(raw.sim[f]) && raw.sim[f] > 0) s[f] = raw.sim[f];
    if (Object.keys(s).length) p.sim = s;
  }
  if (isObj(raw.concept)) p.concept = raw.concept;
  p.nextId = Math.max(Number.isFinite(raw.nextId) ? raw.nextId : 1, ...p.devices.map(d => d.id + 1));
  /* GUID (export EPLAN páruje podle nich): převzít uložené, chybějící doplnit — nikdy při exportu */
  if (isGuid(raw.guid)) p.guid = raw.guid;
  if (isObj(raw.moduleGuids)) {
    const mg = Object.fromEntries(Object.entries(raw.moduleGuids).filter(([, g]) => isGuid(g)));
    if (Object.keys(mg).length) p.moduleGuids = mg;
  }
  /* značka sestavy hardwaru: adresy I/O patří platformě `plat` (hardware.ts) — bez ní se přidělí znovu */
  if (isObj(raw.hw) && ownKey(PLAT, raw.hw.plat) && Number.isInteger(raw.hw.ver)) p.hw = { plat: raw.hw.plat, ver: raw.hw.ver };
  /* migrace: starý projekt bez GUID → doplnit; volající ho podle `guidsAdded` uloží (projekt změněn) */
  const hadGuid = isGuid(raw.guid);
  const added = ensureGuids(p);
  Object.defineProperty(p, "guidsAdded", { value: added || !hadGuid, enumerable: false });
  return p;
}

export const $ = (id) => document.getElementById(id);

/** Záhlaví stránky a titulek karty prohlížeče: „číslo · název · zákazník“ (jen vyplněné části). */
export function setProjectHeader(prj) {
  const t = projectTitle(prj);
  const el = $("projName");
  if (el) { el.textContent = t ? "— " + t : ""; el.title = t; }
  document.title = t ? "PLCdesk — " + t : "PLCdesk";
}

/** AI konverzace z úložiště / importu v bezpečném tvaru. */
export function normAi(a) {
  const ok = a && typeof a === "object" && Array.isArray(a.turns);
  return ok ? { turns: a.turns.filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string"), last: a.last && typeof a.last === "object" && Array.isArray(a.last.devices) ? aiNorm(a.last) : null, draft: String(a.draft || "") }
    : { turns: [], last: null, draft: "" };
}

export function card(el, num, title, inner) {
  const c = document.createElement("section");
  c.className = "card";
  c.innerHTML = '<h2><span class="n">' + num + "</span>" + title + "</h2>" + inner;
  el.appendChild(c);
  return c;
}

export function copyText(txt, btn) {
  const done = () => {
    if (!btn) return;
    const t = btn.textContent;
    btn.textContent = tr("Zkopírováno");
    setTimeout(() => (btn.textContent = t), 1500);
  };
  try { navigator.clipboard.writeText(txt).then(done).catch(() => {}); } catch { /* bez clipboardu */ }
}

const MIME = {
  svg: "image/svg+xml", dxf: "application/dxf", csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8", xml: "application/xml", json: "application/json",
};
/** Jméno staženého souboru s předponou čísla projektu „<číslo>_“ (core withFilePrefix; bez čísla beze změny). */
export function prefixedName(name) {
  const prj = currentProject();
  return prj && !PREFIX_EXEMPT.test(name) ? withFilePrefix(prj, name) : name;   // objekty TwinCAT bez předpony
}
/** Stažení souboru přes bránu licence (license.js): ve Free s patičkou, zamčené = okno s vysvětlením a false.
 *  Jméno dostane předponu čísla projektu (stejně jako v projektové složce). */
export function downloadFile(name, body, quiet = false) {
  body = licenseFilter(name, body, quiet);
  if (body == null) return false;
  name = prefixedName(name);
  const ext = (name.split(".").pop() || "").toLowerCase();
  const blob = new Blob([body], { type: MIME[ext] || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
/** Binární soubor ke stažení BEZ licenční brány — jen pro obsah, který není výstupem projektu
 *  uživatele (balík k ověření s pevnými vzory). Výstupy projektu jdou přes downloadFile / downloadBytes. */
export function saveBytesUngated(name, bytes, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/** Víc souborů po sobě: prohlížeč zahazuje stahování spuštěná v jednom okamžiku (ověřeno: z 28 jich došlo 9).
 *  Předpona čísla projektu jako v projektové složce (core prefixProjectFiles: odkazy v README a dokumentech
 *  přepsané na nová jména, kód PLC beze změny, objekty TwinCAT bez předpony). */
export async function downloadFiles(list, btn) {
  if (btn) btn.disabled = true;
  try {
    const num = (currentProject()?.meta?.number || "").trim();
    if (num) list = prefixProjectFiles(list.map(([path, body]) => ({ path, body })), num).map(f => [f.path, f.body]);
    /* licence: zamčené soubory (DXF ve Free, vše nad limitem) se přeskočí a okno s důvodem ukáže jednou */
    const ok = list.filter(([name, body]) => licenseFilter(name, body, true) != null);
    if (ok.length < list.length) {
      const [bn, bb] = list.find(f => !ok.includes(f));
      licenseFilter(bn, bb);            // otevře okno s důvodem
      if (!ok.length) return;
    }
    for (const [i, [name, body]] of ok.entries()) {
      if (i) await new Promise(r => setTimeout(r, 250));
      downloadFile(name, body, true);
    }
  } finally { if (btn) btn.disabled = false; }
}

/**
 * „Stáhnout projekt (ZIP)“: celá projektová složka ze jádra (core projectBundle — struktura
 * 01_Dokumentace … 99_Interni, předpona čísla projektu, licence před přejmenováním, sešit HMI Siemens,
 * soubor projektu `projectText`) jako jeden ZIP „<číslo>_<Název>.zip“. Zamčené soubory (DXF ve Free,
 * vše nad limitem kromě projektu) v archivu nejsou a okno licence s důvodem se ukáže jednou.
 */
export async function downloadProjectZip(prj, projectText, btn) {
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = tr("Připravuji ZIP…"); }
  await new Promise(r => setTimeout(r, 30));          // ať se stav tlačítka vykreslí (výpočet je synchronní)
  try {
    const b = projectBundle(prj, { gate: gateFor(prj), projectText });
    const bytes = projectZip(b);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    a.download = b.folder + ".zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    const blocked = b.files.find(f => f.blocked);
    if (blocked) openLicenseDialog(blocked.blocked);
    return b;
  } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

/* ---------------------------------------------------------------- číslo projektu */
const NUMBERS_KEY = "plcstudio.numbers";
/** Čísla projektů použitá v tomto prohlížeči (návrh dalšího čísla bez kořenového adresáře — project_dir.js). */
function usedNumbers() {
  try { const a = JSON.parse(localStorage.getItem(NUMBERS_KEY) || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
/** Zapamatuje číslo projektu (při uložení stavu); jen tvar RRNNNN, nejvýš 500 posledních. */
export function rememberNumber(n) {
  const v = String(n || "").trim();
  if (!/^\d{6}$/.test(v)) return;
  const list = usedNumbers().filter(x => x !== v);
  list.push(v);
  try { localStorage.setItem(NUMBERS_KEY, JSON.stringify(list.slice(-500))); } catch { /* bez úložiště */ }
}
/**
 * Návrh čísla nového projektu: další volné letošní řady podle čísel, která už tento prohlížeč použil
 * (core nextProjectNumber, přetoková řada RR+50); bez historie RR0001. Záloha bez kořenového adresáře
 * projektů — s ním návrh ze složek na disku (project_dir.js suggestNumberAsync), jako desktop.
 */
export function suggestNumber(extra = []) {
  return nextProjectNumber([...usedNumbers(), ...extra]);
}
