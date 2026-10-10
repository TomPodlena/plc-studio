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
import { tr, N_, withLang, LANGS, type Lang } from "./i18n.js";
import {
  PLAT, CLS, ACTS_FOR, DO_ROLES, devById, devSignals, syncIO, autoAddr, hasRange, maxRecord, validateProject,
  nextName, sanitizeTag, parseRecordsChecked,
  oneLine, lineSafe, canonIoAddr, MIN_STEP_S, REAL_MAX,
  type Project, type Device, type DeviceClass, type DoRole, type PosRecord, type Dir, type IoEntry, type SeqStep, type SeqAct,
  type SeqCond, type ValidationIssue,
} from "./model.js";
import { axisCfgOf, parseAxisPositionsChecked, type AxisCfg, type AxisPos } from "./axis.js";
import { AXIS_FIELDS } from "./axis_gen.js";
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
  /** addDevice: id nového zařízení. */
  id?: number;
  /** fixIoTags / renumberIo: počet změněných tagů / přečíslovaných signálů. */
  count?: number;
  /** applyAiProposal: označení od AI, která se musela změnit (duplicita, neplatný identifikátor). */
  renamed?: Array<{ from: string; to: string }>;
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
  const problem = rangeProblem(rmin, rmax);
  if (problem) return fail(problem);
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

/* ------------------------------------------------------------------ přidání, parametry a odebrání zařízení */

/** Proč rozsah analogu nejde použít (`null` = v pořádku): čísla, REAL, minimum < maximum. */
export function rangeProblem(rmin: number, rmax: number): string | null {
  if (!Number.isFinite(rmin) || !Number.isFinite(rmax)) return tr("Rozsah musí být číslo.");
  if (Math.abs(rmin) > REAL_MAX || Math.abs(rmax) > REAL_MAX) return tr("Meze rozsahu leží mimo rozsah REAL (±3,4E38) — PLC je neuloží; zkontroluj jednotky.");
  if (rmin >= rmax) return tr("Rozsah měření: minimum musí být menší než maximum.");
  return null;
}

/** Číselné parametry zařízení (formuláře kroku Zařízení ve webu i desktopu). */
export type DeviceParamKey = "limLo" | "limHi" | "setpoint" | "rampS" | "tol" | "tolTimeS" | "selBits" | "travelS";
/** Popisky číselných parametrů (klíče překladu). */
export const DEVICE_PARAM_LABEL: Record<DeviceParamKey, string> = {
  limLo: N_("mez min"), limHi: N_("mez max"), setpoint: N_("žádaná hodnota"), rampS: N_("rampa [s]"),
  tol: N_("tolerance ±"), tolTimeS: N_("doba odchylky [s]"), selBits: N_("bity výběru záznamu"), travelS: N_("doba jízdy (model) [s]"),
};
/** Které číselné parametry třída má (pořadí = pořadí polí ve formuláři). */
export const DEVICE_PARAMS: Partial<Record<DeviceClass, DeviceParamKey[]>> = {
  AnalogIn: ["limLo", "limHi"], AnalogOut: ["setpoint"], Vfd: ["setpoint", "rampS"],
  PropValve: ["setpoint", "rampS", "tol", "tolTimeS"], PosDrive: ["selBits", "travelS"],
};

/**
 * Parametry zařízení z formuláře. `null` = nezadáno → klíč se ze zařízení odebere; klíč, který
 * v objektu není, se nemění. `axis` se slučuje se stávající konfigurací osy (`null` u pole =
 * výchozí z `axisCfgOf`), `positions` ji nahradí celou.
 */
export interface DeviceParams {
  limLo?: number | null; limHi?: number | null; setpoint?: number | null; rampS?: number | null;
  tol?: number | null; tolTimeS?: number | null; selBits?: number | null; travelS?: number | null;
  role?: DoRole | "" | null;
  /** jen servoosa (třídy s rozsahem mění jednotku přes setDeviceRange); prázdná = mm */
  unit?: string | null;
  records?: PosRecord[] | null;
  axis?: { [K in keyof AxisCfg]?: AxisCfg[K] | null } | null;
}

const isSet = (v: unknown) => v !== undefined && v !== null && v !== "";
const noParam = (d: Partial<Device>, k: string) => tr("Zařízení {dev} nemá parametr {par}.", { dev: d.name || String(d.cls), par: k });

/**
 * Proč hodnoty parametrů zařízení nejdou uložit (`null` = v pořádku). Kontroluje jen klíče v `p`
 * (u mezí i druhou mez zařízení `d`): čísla a rozsah REAL, mez min < mez max, rampa 0–3600 s,
 * tolerance a doba odchylky ventilu, bity výběru záznamu 1–6, doba jízdy, role výstupu, pole osy.
 * Stejné meze jako kontrola návrhu (`validateProject`) — formuláře je hlásí hned při zadání.
 */
export function deviceParamsProblem(d: Pick<Device, "cls"> & Partial<Device>, p: DeviceParams): string | null {
  p = p || {};
  const keys = DEVICE_PARAMS[d.cls] || [];
  for (const k of Object.keys(p) as Array<keyof DeviceParams>) {
    if (!isSet(p[k])) continue;
    if (k === "role") {
      if (d.cls !== "DO") return noParam(d, k);
      if (!Object.prototype.hasOwnProperty.call(DO_ROLES, p.role as string)) return tr("Neznámá vazba výstupu na stav stroje: {role}.", { role: String(p.role) });
      continue;
    }
    if (k === "records") { if (d.cls !== "PosDrive" || !Array.isArray(p.records)) return noParam(d, k); continue; }
    if (k === "unit") { if (d.cls !== "Axis" || typeof p.unit !== "string") return noParam(d, k); continue; }
    if (k === "axis") { if (d.cls !== "Axis" || typeof p.axis !== "object") return noParam(d, k); continue; }
    if (!keys.includes(k as DeviceParamKey)) return noParam(d, k);
    const v = p[k] as number, label = tr(DEVICE_PARAM_LABEL[k as DeviceParamKey]);
    if (typeof v !== "number" || !Number.isFinite(v)) return tr("Neplatné číslo v poli „{field}“.", { field: label });
    if (Math.abs(v) > REAL_MAX) return tr("Hodnota {par} je mimo rozsah REAL (±3,4E38) — PLC ji neuloží; zkontroluj jednotky.", { par: label });
  }
  const val = (k: DeviceParamKey): number | undefined =>
    k in p ? (isSet(p[k]) ? p[k] as number : undefined) : (Number.isFinite(d[k] as number) ? d[k] as number : undefined);
  const lo = val("limLo"), hi = val("limHi");
  if (("limLo" in p || "limHi" in p) && lo !== undefined && hi !== undefined && lo >= hi) return tr("Mez min musí být menší než mez max.");
  const n = (k: DeviceParamKey) => (isSet(p[k]) ? p[k] as number : undefined);
  const ramp = n("rampS"), tol = n("tol"), tolT = n("tolTimeS"), bits = n("selBits"), travel = n("travelS");
  if (ramp !== undefined && ramp < 0) return tr("Rampa musí být 0 (bez rampy) nebo kladný čas v sekundách.");
  if (ramp !== undefined && ramp > 3600) return tr("Rampa může být nejvýš 3600 s (delší rampa by ověření simulací zamrazila).");
  if (tol !== undefined && !(tol > 0)) return tr("Povolená odchylka proporcionálního ventilu musí být kladná.");
  if (tolT !== undefined && !(tolT > 0 && tolT <= 3276.7))
    return tr("Doba odchylky proporcionálního ventilu musí být kladná a nejvýš 3 276,7 s (počítá se v taktech 0,1 s v proměnné INT).");
  if (bits !== undefined && !(Number.isInteger(bits) && bits >= 1 && bits <= 6)) return tr("Počet bitů výběru záznamu musí být 1 až 6.");
  if (travel !== undefined && !(travel > 0 && travel <= 3600)) return tr("Doba jízdy (model simulace) musí být kladná a nejvýš 3600 s.");
  if (isSet(p.axis)) {
    const ax = p.axis as Record<string, unknown>;
    for (const f of AXIS_FIELDS) {
      const v = ax[f.key];
      if (!isSet(v)) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) return tr("Neplatné číslo v poli „{field}“.", { field: tr(f.label) });
      if (Math.abs(v) > REAL_MAX) return tr("Hodnota {par} je mimo rozsah REAL (±3,4E38) — PLC ji neuloží; zkontroluj jednotky.", { par: tr(f.label) });
    }
  }
  return null;
}

/** Zapíše parametry do zařízení (`null` / "" = odebrat klíč); osa se slučuje. Bez kontroly. */
function applyParams(d: Device, p: DeviceParams): void {
  for (const [k, v] of Object.entries(p || {})) {
    if (v === undefined) continue;
    if (k === "axis") {
      if (!isSet(v)) { delete d.axis; continue; }
      const ax: Record<string, unknown> = { ...(d.axis || {}) };
      for (const [ak, av] of Object.entries(v as object)) {
        if (!isSet(av)) delete ax[ak];
        else ax[ak] = ak === "drive" ? oneLine(String(av)) : clone(av);
      }
      d.axis = ax as Partial<AxisCfg>;
    } else if (k === "unit") d.unit = oneLine(String(v ?? "")) || "mm";
    else if (!isSet(v)) delete (d as any)[k];
    else (d as any)[k] = clone(v);
  }
}

/**
 * Uloží parametry zařízení (meze, žádaná hodnota, rampa, tolerance, bity výběru záznamu, doba jízdy,
 * role výstupu, záznamy pohonu, konfigurace osy) po kontrole `deviceParamsProblem`. Změna bitů výběru
 * záznamu mění signály pohonu (`syncIO`, vrací `added` / `removed`).
 */
export function setDeviceParams(prj: Project, devId: number, params: DeviceParams): EditResult {
  const d = devById(prj, devId);
  if (!d) return fail(tr("Zařízení nenalezeno."));
  const problem = deviceParamsProblem(d, params || {});
  if (problem) return fail(problem);
  const before = ioOfDev(prj, d.id).map(e => e.tag);
  const bits = d.selBits;
  applyParams(d, params || {});
  if (d.cls !== "PosDrive" || d.selBits === bits) return { ok: true, issues: issuesFor(prj, new Set([d.name])) };
  syncIO(prj);                                   // jiný počet bitů výběru záznamu = jiné signály pohonu
  const after = ioOfDev(prj, d.id).map(e => e.tag);
  return { ok: true, added: after.filter(t => !before.includes(t)), removed: before.filter(t => !after.includes(t)), issues: issuesFor(prj, new Set([d.name])) };
}

/** Nové zařízení z formuláře: třída, označení (prázdné = další volné), popis, volby, jednotka a rozsah, parametry. */
export interface NewDevice extends DeviceParams {
  cls: DeviceClass; name?: string; desc?: string; opt?: Record<string, boolean>;
  unit?: string; rmin?: number; rmax?: number; libType?: string;
}

/**
 * Přidá zařízení po kontrole označení (`deviceNameProblem`), rozsahu (`rangeProblem`, jen třídy
 * s rozsahem) a parametrů (`deviceParamsProblem`). Dostane id, GUID a signály (`syncIO`); vrací `id`.
 */
export function addDevice(prj: Project, nd: NewDevice): EditResult {
  if (!nd || !Object.prototype.hasOwnProperty.call(CLS, nd.cls)) return fail(tr("Neznámá třída zařízení."));
  const { cls, name: rawName, desc, opt, unit, rmin: rawMin, rmax: rawMax, libType, ...params } = nd;
  const name = oneLine(rawName || "") || nextName(prj, cls);
  const nameErr = deviceNameProblem(prj, name);
  if (nameErr) return fail(nameErr);
  const ranged = hasRange(cls);
  const rmin = ranged ? Number(rawMin ?? 0) : 0, rmax = ranged ? Number(rawMax ?? 100) : cls === "Axis" ? 0 : 100;
  if (ranged) { const r = rangeProblem(rmin, rmax); if (r) return fail(r); }
  const d: Device = {
    id: prj.nextId, name, cls, desc: oneLine(desc || ""),
    opt: Object.fromEntries(Object.entries(opt || {}).filter(([k]) => Object.prototype.hasOwnProperty.call(CLS[cls].opts, k)).map(([k, v]) => [k, !!v])),
    unit: ranged || cls === "Axis" ? oneLine(unit || "") || (cls === "Axis" ? "mm" : "") : "", rmin, rmax,
  };
  const problem = deviceParamsProblem(d, params);
  if (problem) return fail(problem);
  applyParams(d, params);
  if (typeof libType === "string" && libType) d.libType = libType;
  prj.nextId = d.id + 1;
  prj.devices.push(d);
  syncIO(prj);                                   // signály, adresy ze sestavy a GUID
  return { ok: true, id: d.id, issues: issuesFor(prj, new Set([d.name])) };
}

/** Kde program zařízení používá: kroky sekvence (počet), vstup E-stop, blokovací vstup. */
export function deviceUsage(prj: Project, devId: number): { steps: number; estop: boolean; lock: boolean; used: boolean } {
  const prog = prj.program;
  const steps = prog.seq.filter(s => s.act !== "wait" && s.dev === devId).length;
  const estop = prog.estop === devId, lock = (prog.interlocks || []).includes(devId);
  return { steps, estop, lock, used: steps > 0 || estop || lock };
}

/** Odebere zařízení i s jeho kroky sekvence, vazbou E-stop a blokováním; signály zmizí (`syncIO`). */
export function deleteDevice(prj: Project, devId: number): EditResult {
  const d = devById(prj, devId);
  if (!d) return fail(tr("Zařízení nenalezeno."));
  const removed = ioOfDev(prj, devId).map(e => e.tag);
  prj.devices = prj.devices.filter(x => x.id !== devId);
  const prog = prj.program;
  prog.seq = prog.seq.filter(s => s.act === "wait" || !!devById(prj, s.dev));
  prog.interlocks = (prog.interlocks || []).filter(i => !!devById(prj, i));
  if (prog.estop !== "" && !devById(prj, prog.estop)) prog.estop = "";
  syncIO(prj);
  return { ok: true, removed };
}

/** Text „nesrozumitelné části: …; duplicitní: …“ pro hlášku formuláře ("" = v pořádku). */
function parseProblems(bad: string[], dup: Array<string | number>): string {
  const out: string[] = [];
  if (bad.length) out.push(tr("nesrozumitelné části: {parts}", { parts: bad.slice(0, 5).join("; ") }));
  if (dup.length) out.push(tr("duplicitní: {items}", { items: dup.slice(0, 10).join(", ") }));
  return out.join("; ");
}
/** Záznamy pohonu z textu formuláře; nesrozumitelné části / duplicity = `error` (nic se tiše nezahodí). */
export function parseRecordsForm(text: string): { records: PosRecord[]; error: string | null } {
  const r = parseRecordsChecked(text);
  const probs = parseProblems(r.bad, r.dup);
  return { records: r.records, error: probs ? tr("Záznamy pohonu nejsou uložené — {problems}. Zapiš je ve tvaru „1 = název @ poloha; 2 = …“.", { problems: probs }) : null };
}
/** Pojmenované polohy osy z textu formuláře; nesrozumitelné části / duplicity = `error`. */
export function parseAxisPositionsForm(text: string): { positions: AxisPos[]; error: string | null } {
  const r = parseAxisPositionsChecked(text);
  const probs = parseProblems(r.bad, r.dup);
  return { positions: r.positions, error: probs ? tr("Pojmenované polohy osy nejsou uložené — {problems}. Zapiš je ve tvaru „název @ poloha; …“.", { problems: probs }) : null };
}

/* ------------------------------------------------------------------ I/O hromadně */

/** Přečísluje adresy všech signálů od nuly podle sestavy hardwaru (ruční připnutí se zahodí). */
export function renumberIo(prj: Project): EditResult {
  for (const e of prj.io) e.addr = "";
  autoAddr(prj, true);
  return { ok: true, count: prj.io.length };
}

/** Opraví tagy na přenositelné (ASCII identifikátor, `sanitizeTag`) a jedinečné; vrací počet změněných. */
export function fixIoTags(prj: Project): EditResult {
  const used = new Set<string>();
  let count = 0;
  for (const e of prj.io) {
    const base = sanitizeTag(e.tag);
    let t = base, n = 2;
    while (used.has(t)) t = base + "_" + n++;
    used.add(t);
    if (t !== e.tag) { e.tag = t; count++; }
  }
  return { ok: true, count };
}

/* ------------------------------------------------------------------ model stroje (simulace) */

/** Výchozí časy modelu stroje (sim.ts): rozběh motoru, přestavení ventilu [s]. */
export const SIM_MODEL_DEFAULT = { motorDelay: 0.5, valveTravel: 1.0 } as const;
/** Rozsah času modelu stroje zadaného v UI [s] (validace pustí nejvýš 3600 s; UI drží rozumnou mez). */
export const SIM_MODEL_RANGE = { min: 0.05, max: 600 } as const;

/**
 * Časy modelu stroje `prj.sim` (rozběh motoru, přestavení ventilu) — ovlivňují ověření simulací,
 * takt a dokumenty. Web i desktop zadávají totéž: číslo 0,05…600 s (desetinná čárka i tečka);
 * prázdné / nezadané pole = beze změny.
 */
export function setSimModel(prj: Project, model: { motorDelay?: unknown; valveTravel?: unknown }): EditResult {
  const cur = { motorDelay: prj.sim?.motorDelay ?? SIM_MODEL_DEFAULT.motorDelay, valveTravel: prj.sim?.valveTravel ?? SIM_MODEL_DEFAULT.valveTravel };
  const next = { ...cur };
  for (const k of ["motorDelay", "valveTravel"] as const) {
    const raw = model[k];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const v = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(v) || v < SIM_MODEL_RANGE.min || v > SIM_MODEL_RANGE.max)
      return fail(tr("Čas modelu stroje zadej jako číslo {min} až {max} s.", { min: SIM_MODEL_RANGE.min, max: SIM_MODEL_RANGE.max }));
    next[k] = v;
  }
  if (next.motorDelay === cur.motorDelay && next.valveTravel === cur.valveTravel) return { ok: true, count: 0 };
  prj.sim = next;
  return { ok: true, count: 1 };
}

/* ------------------------------------------------------------------ projekt */

/**
 * Projekt bez obsahu (žádná zařízení, název ani popis) — jeho nahrazení (nový projekt, otevření
 * souboru, příklad) se neptá. Konverzaci kroku AI návrh (stav klienta) přidá klient.
 */
export function projectIsEmpty(prj: Project): boolean {
  return !(prj.devices || []).length && !String(prj.meta?.name || "").trim() && !String(prj.meta?.desc || "").trim();
}

/* ------------------------------------------------------------------ převzetí návrhu AI */

/** Zařízení návrhu AI (výstup `aiNorm` z apps/web/src/ai.js). */
export interface AiProposalDevice extends Partial<Omit<Device, "id" | "name" | "cls">> { name: string; cls: DeviceClass }
/** Návrh AI (`aiNorm`): zařízení, E-stop a blokování podle označení, sekvence, takt. */
export interface AiProposal {
  devices: AiProposalDevice[];
  estop?: string; interlocks?: string[];
  seq?: Array<{ dev: string; act: string; cond?: string; timeS: number; sp?: number; rec?: number; rev?: boolean; posRef?: string; pos?: number; vel?: number; acc?: number; dec?: number }>;
  takt?: number | null;
}

const AI_ACTS: SeqAct[] = ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow",
  "moveAbs", "moveRel", "velocity", "halt", "waitInPos"];
/** Číselná pole návrhu AI podle třídy (aiNorm je pustí jen u správné třídy; tady ještě jednou). */
const AI_DEV_FIELDS: Partial<Record<DeviceClass, DeviceParamKey[]>> = DEVICE_PARAMS;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** První volné označení třídy, které projde `deviceNameProblem` (jedinečné i bez ohledu na velikost písmen). */
function freeName(prj: Project, cls: DeviceClass): string {
  const pre = CLS[cls].prefix;
  let n = 1;
  while (deviceNameProblem(prj, pre + n)) n++;
  return pre + n;
}

/**
 * Převezme návrh AI do projektu (nahradí zařízení, E-stop, blokování a sekvenci; takt jen když ho
 * AI navrhla). Zařízení, které v návrhu zůstalo (stejné označení a třída), si nechá VŠECHNA svá pole
 * (GUID — identita pro export EPLAN —, knihovní typ, záznamy, konfiguraci osy…) a přepíšou se jen
 * hodnoty, které AI poslala; jeho signály si nechají adresu, komentář, NC a GUID (úpravy z kroku I/O),
 * změněný popis se propíše do komentáře. Duplicitní (i jen velikostí písmen) nebo neplatné označení
 * od AI dostane další volné (`renamed`). Kroky na neznámé zařízení se zahodí, čekání jen na třídu DI.
 * Vrací `issues` = chyby kontroly návrhu po převzetí.
 */
export function applyAiProposal(prj: Project, pr: AiProposal): EditResult {
  if (!pr || !Array.isArray(pr.devices) || !pr.devices.some(a => a && Object.prototype.hasOwnProperty.call(CLS, a.cls)))
    return fail(tr("Návrh AI neobsahuje žádná zařízení."));
  const oldIo = prj.io;
  const oldByKey = new Map(prj.devices.map(d => [d.name + "|" + d.cls, d] as const));
  const oldById = new Map(prj.devices.map(d => [d.id, d] as const));
  prj.devices = []; prj.io = []; prj.nextId = 1;
  const byAiName = new Map<string, Device>(), byName = new Map<string, Device>();
  const renamed: Array<{ from: string; to: string }> = [];
  for (const a of pr.devices) {
    if (!a || !Object.prototype.hasOwnProperty.call(CLS, a.cls)) continue;
    const aiName = oneLine(String(a.name || ""));
    let name = aiName;
    if (!name || deviceNameProblem(prj, name)) {
      name = freeName(prj, a.cls);
      if (aiName) renamed.push({ from: aiName, to: name });
    }
    const od = oldByKey.get(name + "|" + a.cls);
    const nd: Device = od ? clone(od) : ({} as Device);
    Object.assign(nd, {
      id: prj.nextId++, name, cls: a.cls, desc: oneLine(String(a.desc || "")),
      opt: a.opt && typeof a.opt === "object" ? { ...a.opt } : {},
      unit: oneLine(String(a.unit || "")), rmin: finite(a.rmin) ? a.rmin : 0, rmax: finite(a.rmax) ? a.rmax : 100,
    });
    for (const f of AI_DEV_FIELDS[a.cls] || []) if (finite(a[f])) nd[f] = a[f];
    if (a.cls === "DO" && a.role && Object.prototype.hasOwnProperty.call(DO_ROLES, a.role)) nd.role = a.role;
    if (a.cls === "PosDrive" && Array.isArray(a.records)) nd.records = clone(a.records);
    if (typeof a.libType === "string" && a.libType) nd.libType = a.libType;
    /* konfigurace osy: pole, která AI neposlala (pohon, ryv…), zůstanou z původní */
    if (a.cls === "Axis" && a.axis && typeof a.axis === "object") nd.axis = { ...(nd.axis || {}), ...clone(a.axis) };
    prj.devices.push(nd);
    if (aiName && !byAiName.has(aiName)) byAiName.set(aiName, nd);
    byName.set(name, nd);
  }
  /* I/O zařízení, které zůstalo (stejné označení a třída): převzít — jen nové id a klíč */
  prj.io = oldIo.flatMap(e => {
    const od = oldById.get(e.devId), nd = od && byName.get(od.name);
    if (!od || !nd || nd.cls !== od.cls) return [];
    const ne: IoEntry = { ...e, devId: nd.id, key: nd.id + ":" + e.sig };
    if (od.desc && nd.desc && nd.desc !== od.desc && typeof ne.cmt === "string" && ne.cmt.startsWith(od.desc)) ne.cmt = nd.desc + ne.cmt.slice(od.desc.length);
    return [ne];
  });
  syncIO(prj);
  const dev = (n: unknown) => byAiName.get(oneLine(String(n || "")));
  const es = dev(pr.estop);
  prj.program.estop = es && es.cls === "DI" ? es.id : "";
  prj.program.interlocks = [...new Set((pr.interlocks || []).map(dev)
    .filter((d): d is Device => !!d && d.cls === "DI" && d.id !== prj.program.estop).map(d => d.id))];
  prj.program.seq = (pr.seq || []).flatMap((s): SeqStep[] => {
    if (!s || typeof s !== "object") return [];
    const act: SeqAct = (AI_ACTS as string[]).includes(s.act) ? s.act as SeqAct : "wait";
    const wait = act === "waitOn" || act === "waitOff";
    const d = dev(s.dev);
    const devId = act !== "wait" && d && (!wait || d.cls === "DI") ? d.id : 0;
    if (act !== "wait" && !devId) return [];
    const cond: SeqCond = wait ? "fbk" : act === "wait" ? "time" : s.cond === "time" ? "time" : "fbk";
    const st: SeqStep = { dev: devId, act, cond, timeS: finite(s.timeS) ? s.timeS : 1 };
    if (finite(s.sp)) st.sp = s.sp;
    if (Number.isInteger(s.rec)) st.rec = s.rec;
    if (s.rev === true) st.rev = true;
    if (typeof s.posRef === "string" && s.posRef) st.posRef = oneLine(s.posRef);
    for (const f of ["pos", "vel", "acc", "dec"] as const) if (finite(s[f])) st[f] = s[f];
    return [st];
  });
  if (finite(pr.takt) && pr.takt > 0) prj.meta.takt = pr.takt;
  return { ok: true, renamed, issues: validateProject(prj).filter(i => i.level === "error") };
}
