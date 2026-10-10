/**
 * PLCdesk — ruční úpravy návrhu (kroky 4–7: Zařízení, I/O, Schéma, Program).
 *
 * Jediné místo s logikou úprav: web i desktop (přes most) volají tytéž funkce, klienti jen
 * sbírají hodnoty z polí a ukazují výsledek. Každá funkce mění projekt na místě a vrací
 * `EditResult` — `ok: false` + `error` (text pro uživatele) znamená, že se nic nezměnilo.
 *
 * Pravidla:
 * - vazby programu (kroky, E-stop, blokování) jdou přes `Device.id` — přejmenování je nemění;
 * - VÝCHOZÍ texty (tag `<označení>_<signál>`, komentář `<popis> – <popisek signálu>` přesně jako
 *   `syncIO`, v kterémkoli jazyce UI) se při změně zařízení přepíšou, ručně změněné zůstanou;
 * - GUID a adresy (připnutí v sestavě hardwaru) se nemění; schválení se zneplatní samo otiskem.
 */
import { tr, withLang, LANGS, type Lang } from "./i18n.js";
import {
  PLAT, CLS, ACTS_FOR, devById, devSignals, syncIO, autoAddr, hasRange, maxRecord, validateProject,
  oneLine, lineSafe, canonIoAddr, MIN_STEP_S, REAL_MAX,
  type Project, type Device, type Dir, type IoEntry, type SeqStep, type SeqAct, type ValidationIssue,
} from "./model.js";
import { axisCfgOf } from "./axis.js";
import { canonAddr } from "./importers.js";
import { hwPlatform } from "./hardware.js";

export interface EditResult {
  ok: boolean;
  /** Proč úprava neprošla (projekt beze změny). */
  error?: string;
  /** renameDevice: ručně změněné tagy, které zůstaly beze změny. */
  keptTags?: string[];
  /** setDeviceDesc / setDeviceRange: tagy signálů s ručním komentářem (komentář beze změny). */
  keptCmts?: string[];
  /** setDeviceOpts: odebrané a přidané signály (tagy). */
  removed?: string[];
  added?: string[];
  /** setDeviceOpts: indexy kroků sekvence zařízení, které čekaly na zpětné hlášení a o vstup přišly. */
  affectedSteps?: number[];
  /** insertStep / duplicateStep: index nového kroku. */
  index?: number;
  /** setIoTag / setIoAddr: uložená hodnota. */
  value?: string;
  /** Nálezy kontroly návrhu, které se úpravy týkají (zařízení, krok, signál). */
  issues?: ValidationIssue[];
}

const fail = (error: string): EditResult => ({ ok: false, error });
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Kanonické adresy (Siemens notace) podle směru — stejně jako `validateProject`. */
const ADDR_RE: Record<Dir, RegExp> = { DI: /^%I\d+\.[0-7]$/, DO: /^%Q\d+\.[0-7]$/, AI: /^%IW\d+$/, AO: /^%QW\d+$/ };
const ADDR_EX: Record<Dir, string> = { DI: "%I0.0", DO: "%Q0.0", AI: "%IW64", AO: "%QW64" };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const ioOfDev = (prj: Project, id: number): IoEntry[] => prj.io.filter(e => e.devId === id);
const issuesFor = (prj: Project, where: Set<string>): ValidationIssue[] => validateProject(prj).filter(i => where.has(i.where));

/* ------------------------------------------------------------------ výchozí texty */

/** Výchozí tag signálu (jako `syncIO`). */
export function defaultTag(d: Pick<Device, "name">, sig: string): string {
  return d.name + "_" + sig;
}

/** Výchozí komentář signálu v aktuálním jazyce (jako `syncIO`): „popis – popisek signálu“. */
export function defaultCmt(d: Device, sig: string): string {
  const s = devSignals(d).find(x => x[0] === sig);
  return lineSafe([d.desc, s ? s[2] : ""].filter(Boolean).join(" – "));
}

/** Výchozí komentáře signálu ve všech jazycích UI (komentář vzniká v jazyce platném při založení). */
function defaultCmts(d: Device, sig: string): Set<string> {
  const out = new Set<string>();
  for (const l of Object.keys(LANGS) as Lang[]) out.add(withLang(l, () => defaultCmt(d, sig)));
  return out;
}

/** Výchozí NC (rozpínací) vstupu podle popisu zařízení (jako `syncIO`). */
const defaultNc = (d: Device, dir: Dir) => dir === "DI" && /\bNC\b/i.test(d.desc || "");

/**
 * Po změně zařízení (popis, jednotka) přepíše výchozí komentáře (a výchozí NC) jeho signálů
 * na výchozí podle nového stavu; ručně změněné nechá a vrátí jejich tagy.
 */
function refreshDefaultTexts(prj: Project, before: Device, after: Device): string[] {
  const kept: string[] = [];
  for (const e of ioOfDev(prj, after.id)) {
    if (defaultCmts(before, e.sig).has(e.cmt || "")) e.cmt = defaultCmt(after, e.sig);
    else kept.push(e.tag);
    const ncB = defaultNc(before, e.dir), ncA = defaultNc(after, e.dir);
    if (ncB !== ncA && !!e.nc === ncB) e.nc = ncA;
  }
  return kept;
}

/* ------------------------------------------------------------------ zařízení */

/**
 * Proč označení zařízení nejde použít (`null` = v pořádku). Stejná pravidla jako `validateProject`:
 * identifikátor IEC, nejvýš 32 znaků, bez „__“ a „_“ na konci, jedinečné bez ohledu na velikost písmen.
 */
export function deviceNameProblem(prj: Project, name: string, skipId?: number): string | null {
  if (!NAME_RE.test(name))
    return tr("Označení zařízení musí být identifikátor — písmena bez diakritiky, číslice a _, na začátku písmeno (např. M1, Y2_A). Používá se v názvech instancí v kódu.");
  if (name.length > 32 || /__/.test(name) || /_$/.test(name))
    return tr("Označení zařízení může mít nejvýš 32 znaků, bez „__“ a bez „_“ na konci — vznikají z něj jména jako seqOpen_<označení> a Rockwell Logix povoluje 40 znaků.");
  const other = prj.devices.find(d => d.id !== skipId && d.name.toUpperCase() === name.toUpperCase());
  if (other) return tr("Označení {name} už má zařízení {other} — označení musí být jedinečné (velká a malá písmena se nerozlišují).", { name, other: other.name });
  return null;
}

/** Nahradí označení `from` za `to` jako samostatné slovo klíče („drv:M1:dir“, „io:M1.fbk“, „STO_M1“). */
function renameToken(s: string, from: string, to: string): string {
  const re = new RegExp("(^|[:_.#])" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[:.#])", "g");
  return s.replace(re, (_m, pre: string) => pre + to);
}
function renameKeys<T>(rec: Record<string, T> | undefined, from: string, to: string): Record<string, T> | undefined {
  if (!rec) return rec;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) out[renameToken(k, from, to)] = v;
  return out;
}
/** Vstupy (označení DI) a skupiny výstupů („STO_M1“) bezpečnostní funkce; chybějící pole nezakládá. */
function renameRefs(f: { inputs?: string[]; acts?: string[] }, from: string, to: string): void {
  if (f.inputs) f.inputs = f.inputs.map(x => (x === from ? to : x));
  if (f.acts) f.acts = f.acts.map(a => renameToken(a, from, to));
}

/**
 * Přejmenuje zařízení. Výchozí tagy jeho signálů (`<staré>_<signál>`) dostanou nové označení,
 * ručně změněné zůstanou (vrací je v `keptTags`). GUID, adresy, kroky, E-stop a blokování
 * (vazby přes id) se nemění; výsledky oživení a úpravy bezpečnostních funkcí, které nesou
 * označení v klíči, se převedou na nové označení. Schválení se zneplatní samo (otisk obsahu).
 */
export function renameDevice(prj: Project, devId: number, newName: string): EditResult {
  const d = devById(prj, devId);
  if (!d) return fail(tr("Zařízení nenalezeno."));
  const name = oneLine(newName);
  const old = d.name;
  if (name === old) return { ok: true, keptTags: [] };
  const problem = deviceNameProblem(prj, name, d.id);
  if (problem) return fail(problem);
  const mine = ioOfDev(prj, d.id);
  const keptTags: string[] = [];
  const renamed = new Map<IoEntry, string>();
  for (const e of mine) {
    if (e.tag === defaultTag({ name: old }, e.sig)) renamed.set(e, defaultTag({ name }, e.sig));
    else keptTags.push(e.tag);
  }
  /* nový výchozí tag nesmí kolidovat s tagem jiného signálu (velikost písmen se nerozlišuje) */
  const others = new Set(prj.io.filter(e => !renamed.has(e)).map(e => e.tag.toUpperCase()));
  for (const t of renamed.values())
    if (others.has(t.toUpperCase())) return fail(tr("Tag {tag} už v projektu je — přejmenování by vytvořilo duplicitní tag. Zvol jiné označení nebo nejdřív změň ten tag.", { tag: t }));
  for (const [e, t] of renamed) e.tag = t;
  d.name = name;
  prj.commissioning = renameKeys(prj.commissioning, old, name);
  const s = prj.safety;
  if (s) {
    if (s.fn) {
      s.fn = renameKeys(s.fn, old, name);
      for (const f of Object.values(s.fn || {})) renameRefs(f, old, name);
    }
    if (s.add) for (const f of s.add) { f.ref = renameToken(f.ref, old, name); renameRefs(f, old, name); }
  }
  return { ok: true, keptTags, issues: issuesFor(prj, new Set([name])) };
}

/** Změní popis zařízení; výchozí komentáře jeho signálů (a výchozí NC) se přepíšou, ruční zůstanou. */
export function setDeviceDesc(prj: Project, devId: number, desc: string): EditResult {
  const d = devById(prj, devId);
  if (!d) return fail(tr("Zařízení nenalezeno."));
  const before = clone(d);
  d.desc = oneLine(desc);   // popis zařízení je jednořádkový (komentáře I/O, kód, výkresy)
  const keptCmts = refreshDefaultTexts(prj, before, d);
  return { ok: true, keptCmts };
}

/** Volby zapnuté i bez zápisu v `Device.opt` (devSignals je bere jako `!== false`). */
const OPT_ON_BY_DEFAULT: Partial<Record<string, string[]>> = {
  Motor: ["fbk"], Ventil: ["fbkOpen"], Vfd: ["ready", "fbk", "fault"], PosDrive: ["ready", "fault"], PropValve: ["fbk"],
};

/** Skutečný stav všech voleb třídy zařízení (chybějící klíč = výchozí podle `devSignals`). */
export function deviceOpts(d: Device): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const on = OPT_ON_BY_DEFAULT[d.cls] || [];
  for (const k of Object.keys(CLS[d.cls].opts)) {
    const v = (d.opt || {})[k];
    out[k] = v === undefined ? on.includes(k) : !!v;
  }
  return out;
}

/**
 * Změní volby zařízení (zpětná hlášení, vstup poruchy, směr…). Nové signály dostanou kanál
 * sestavy (`syncIO`), ostatní si adresu nechají; odebrané signály zmizí (`removed`). Kroky
 * zařízení s přechodem na zpětné hlášení, které přišly o vstup, vrací `affectedSteps`.
 */
export function setDeviceOpts(prj: Project, devId: number, opt: Record<string, boolean>): EditResult {
  const d = devById(prj, devId);
  if (!d) return fail(tr("Zařízení nenalezeno."));
  const known = CLS[d.cls].opts;
  for (const k of Object.keys(opt || {}))
    if (!Object.prototype.hasOwnProperty.call(known, k)) return fail(tr("Zařízení {dev} nemá volbu {opt}.", { dev: d.name, opt: k }));
  const before = ioOfDev(prj, d.id);
  const keysBefore = new Set(before.map(e => e.key));
  d.opt = { ...(d.opt || {}) };
  for (const [k, v] of Object.entries(opt || {})) d.opt[k] = !!v;
  syncIO(prj);
  const after = ioOfDev(prj, d.id);
  const keysAfter = new Set(after.map(e => e.key));
  const removedIo = before.filter(e => !keysAfter.has(e.key));
  const removed = removedIo.map(e => e.tag);
  const added = after.filter(e => !keysBefore.has(e.key)).map(e => e.tag);
  const affectedSteps: number[] = [];
  if (removedIo.some(e => e.dir === "DI" || e.dir === "AI"))
    prj.program.seq.forEach((s, i) => { if (s.dev === d.id && s.cond === "fbk" && s.act !== "wait") affectedSteps.push(i); });
  const where = new Set([d.name, ...affectedSteps.map(i => tr("krok {n}", { n: i + 1 }))]);
  return { ok: true, removed, added, affectedSteps, issues: issuesFor(prj, where) };
}

/**
 * Změní jednotku a rozsah analogového zařízení (analog, měnič, proporcionální ventil).
 * Výchozí komentáře signálů s jednotkou se přepíšou, ruční zůstanou.
 */
export function setDeviceRange(prj: Project, devId: number, range: { unit?: string; rmin?: number; rmax?: number }): EditResult {
  const d = devById(prj, devId);
  if (!d) return fail(tr("Zařízení nenalezeno."));
  if (!hasRange(d.cls)) return fail(tr("Zařízení {dev} nemá rozsah ani jednotku.", { dev: d.name }));
  const rmin = range.rmin === undefined ? d.rmin : Number(range.rmin);
  const rmax = range.rmax === undefined ? d.rmax : Number(range.rmax);
  if (!Number.isFinite(rmin) || !Number.isFinite(rmax)) return fail(tr("Rozsah musí být číslo."));
  if (Math.abs(rmin) > REAL_MAX || Math.abs(rmax) > REAL_MAX) return fail(tr("Meze rozsahu leží mimo rozsah REAL (±3,4E38) — PLC je neuloží; zkontroluj jednotky."));
  if (rmin >= rmax) return fail(tr("Rozsah měření: minimum musí být menší než maximum."));
  const before = clone(d);
  if (range.unit !== undefined) d.unit = oneLine(range.unit);
  d.rmin = rmin; d.rmax = rmax;
  const keptCmts = refreshDefaultTexts(prj, before, d);
  return { ok: true, keptCmts, issues: issuesFor(prj, new Set([d.name])) };
}

/* ------------------------------------------------------------------ kroky sekvence */

const NUM_FIELDS = ["sp", "rec", "pos", "vel", "acc", "dec"] as const;

/** Krok jen se známými poli (výdrž bez zařízení = dev 0, přechod časem). */
function cleanStep(s: Partial<SeqStep>): SeqStep {
  const dev = Number(s.dev) || 0;
  const out: SeqStep = dev ? { dev, act: s.act as SeqAct, cond: s.cond === "time" ? "time" : "fbk", timeS: Number(s.timeS) }
    : { dev: 0, act: "wait", cond: "time", timeS: Number(s.timeS) };
  if (!dev) return out;
  for (const k of NUM_FIELDS) if (s[k] !== undefined && s[k] !== null && (s[k] as unknown) !== "") (out as any)[k] = Number(s[k]);
  if (out.rec !== undefined) out.rec = Math.round(out.rec);
  if (s.rev) out.rev = true;
  if (s.posRef) out.posRef = oneLine(s.posRef);
  return out;
}

/**
 * Proč krok nejde uložit (`null` = v pořádku): zařízení existuje, akce patří jeho třídě, čas je
 * kladný (nejvýš 24 h), záznam pohonu v rozsahu, osa má cíl / dráhu / nenulovou rychlost.
 * Ostatní (rozsahy, limity os, platformy) hlásí kontrola návrhu.
 */
export function stepProblem(prj: Project, step: Partial<SeqStep>): string | null {
  const s = cleanStep(step);
  if (!(Number.isFinite(s.timeS) && s.timeS > 0 && s.timeS <= 86400))
    return tr("Čas kroku musí být kladné číslo sekund (nejvýš 86 400 s = 24 h).");
  if (s.timeS < MIN_STEP_S) return tr("Čas kroku musí být aspoň 0,01 s (jeden scan) — kratší čas kód zapíše jako T#0S.");
  if (s.act === "wait") return null;
  const d = devById(prj, s.dev);
  if (!d) return tr("Zařízení kroku nenalezeno.");
  const acts = ACTS_FOR[d.cls] || [];
  if (!acts.includes(s.act)) return tr("Akce „{act}“ neplatí pro zařízení {dev} ({cls}).", { act: s.act, dev: d.name, cls: tr(CLS[d.cls].label) });
  if (d.cls === "DI" && s.cond !== "fbk") return tr("Krok čekání na vstup má vždy přechod na zpětné hlášení (vstup); čas je hlídací.");
  if (d.cls === "PosDrive" && s.act === "posRecord" && !(Number.isInteger(s.rec) && (s.rec as number) >= 1 && (s.rec as number) <= maxRecord(d)))
    return tr("Číslo záznamu {dev} musí být 1 až {max} (záznam 0 = referenční poloha, jede se na ni akcí home).", { dev: d.name, max: maxRecord(d) });
  for (const k of NUM_FIELDS) if (s[k] !== undefined && !Number.isFinite(s[k] as number)) return tr("Neplatné číslo v poli „{field}“.", { field: k });
  for (const k of NUM_FIELDS) if (s[k] !== undefined && Math.abs(s[k] as number) > REAL_MAX) return tr("Hodnota {par} je mimo rozsah REAL (±3,4E38) — PLC ji neuloží; zkontroluj jednotky.", { par: k });
  if (d.cls === "Axis") {
    if (s.act === "moveAbs" && s.posRef && !axisCfgOf(d).positions.some(x => x.name === s.posRef))
      return tr("Osa {dev} nemá pojmenovanou polohu „{name}“.", { dev: d.name, name: s.posRef });
    if ((s.act === "moveAbs" && !s.posRef || s.act === "moveRel") && s.pos === undefined) return tr("Zadej cílovou polohu / dráhu osy.");
    if (s.act === "velocity" && !(s.vel !== undefined && s.vel !== 0)) return tr("Krok „rychlost“ osy {dev} potřebuje nenulovou rychlost (znaménko = směr).", { dev: d.name });
  }
  return null;
}

const stepWhere = (i: number) => new Set([tr("krok {n}", { n: i + 1 })]);

/** Uloží změněný krok `index` (stejná kontrola jako při přidání). */
export function updateStep(prj: Project, index: number, step: Partial<SeqStep>): EditResult {
  const seq = prj.program.seq;
  if (!(Number.isInteger(index) && index >= 0 && index < seq.length)) return fail(tr("Krok nenalezen."));
  const problem = stepProblem(prj, step);
  if (problem) return fail(problem);
  seq[index] = cleanStep(step);
  return { ok: true, index, issues: issuesFor(prj, stepWhere(index)) };
}

/** Vloží krok za krok `afterIndex` (−1 = na začátek, za poslední / mimo = na konec). */
export function insertStep(prj: Project, afterIndex: number, step: Partial<SeqStep>): EditResult {
  const problem = stepProblem(prj, step);
  if (problem) return fail(problem);
  const seq = prj.program.seq;
  const at = Number.isInteger(afterIndex) && afterIndex >= -1 && afterIndex < seq.length ? afterIndex + 1 : seq.length;
  seq.splice(at, 0, cleanStep(step));
  return { ok: true, index: at, issues: issuesFor(prj, stepWhere(at)) };
}

/** Zkopíruje krok `index` hned za něj. */
export function duplicateStep(prj: Project, index: number): EditResult {
  const seq = prj.program.seq;
  if (!(Number.isInteger(index) && index >= 0 && index < seq.length)) return fail(tr("Krok nenalezen."));
  seq.splice(index + 1, 0, clone(seq[index]));
  return { ok: true, index: index + 1, issues: issuesFor(prj, stepWhere(index + 1)) };
}

/* ------------------------------------------------------------------ I/O */

/** Změní tag signálu; prázdný = výchozí `<označení>_<signál>`. Nálezy (diakritika, duplicita) vrací v `issues`. */
export function setIoTag(prj: Project, key: string, tag: string): EditResult {
  const e = prj.io.find(x => x.key === key);
  if (!e) return fail(tr("Signál nenalezen."));
  const d = devById(prj, e.devId);
  e.tag = oneLine(tag) || defaultTag({ name: d ? d.name : "IO" }, e.sig);
  return { ok: true, value: e.tag, issues: issuesFor(prj, new Set([e.tag, e.tag.toUpperCase()])) };
}

/** Změní komentář signálu (prázdný = výchozí podle zařízení). */
export function setIoCmt(prj: Project, key: string, cmt: string): EditResult {
  const e = prj.io.find(x => x.key === key);
  if (!e) return fail(tr("Signál nenalezen."));
  const d = devById(prj, e.devId);
  e.cmt = oneLine(cmt) || (d ? defaultCmt(d, e.sig) : "");   // komentář je jednořádkový (kód, CSV / TSV, XML)
  return { ok: true, value: e.cmt };
}

/**
 * Převede ruční adresu na kanonickou (Siemens notace) — přijme Siemens notaci (%I0.0, %Q1.7,
 * %IW64, %QW80; i bez % a německé E/A) a notaci platformy hardwaru, kterou jde jednoznačně
 * převést (CODESYS %IX0.0 / %QX0.0, Mitsubishi X10 / Y7). `%IW` / `%QW` se bere vždy jako Siemens
 * (bajtová adresa). Vrací `null`, když adresa nepasuje ke směru signálu.
 */
export function parseIoAddr(prj: Project, dir: Dir, addr: string): string | null {
  const a = String(addr ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!a) return "";
  const withPct = canonIoAddr(a.startsWith("%") ? a : "%" + a);   // %Q00.1 → %Q0.1 (kontrola obsazenosti na kanonickém tvaru)
  if (ADDR_RE[dir].test(withPct)) return withPct;
  const c = canonAddr(a, /^%[IQ]W/.test(a) ? undefined : hwPlatform(prj));
  return c && ADDR_RE[dir].test(canonIoAddr(c)) ? canonIoAddr(c) : null;
}

/**
 * Ruční adresa signálu: platná adresa kanál sestavy připne (adresa mimo sestavu zůstane
 * s upozorněním kontroly), prázdná = přidělit automaticky. Neplatný zápis nebo adresa, kterou
 * už má jiný signál, = chyba (projekt beze změny).
 */
export function setIoAddr(prj: Project, key: string, addr: string): EditResult {
  const e = prj.io.find(x => x.key === key);
  if (!e) return fail(tr("Signál nenalezen."));
  const a = parseIoAddr(prj, e.dir, addr);
  if (a === null)
    return fail(tr("Adresa {addr} neodpovídá signálu {dir} — zapiš ji v Siemens notaci (např. {ex}) nebo v notaci platformy hardwaru {plat}.", { addr: String(addr).trim(), dir: e.dir, ex: ADDR_EX[e.dir], plat: PLAT[hwPlatform(prj)]?.name || hwPlatform(prj) }));
  if (a) {
    const m = /^%[IQ](W?)(\d+)/.exec(a);
    if (m && Number(m[2]) + (m[1] ? 1 : 0) > 65535)
      return fail(tr("Adresa {addr} leží mimo adresní prostor řídicích systémů (bajt nejvýš 65 535).", { addr: a }));
    const other = prj.io.find(x => x !== e && x.addr && canonIoAddr(x.addr) === a);
    if (other) return fail(tr("Adresu {addr} už má signál {tag}.", { addr: a, tag: other.tag }));
  }
  e.addr = a;
  autoAddr(prj, false);
  return { ok: true, value: e.addr, issues: issuesFor(prj, new Set([e.tag, e.addr])) };
}
