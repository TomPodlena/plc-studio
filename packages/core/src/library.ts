/**
 * Firemní knihovna: vlastní typy zařízení, vlastní šablony bloků FB, firemní hlavička kódu
 * a dokumentů, výchozí volby platformy. Samostatný verzovaný soubor JSON (export / import),
 * kopie může být uložená v projektu (`prj.library`), aby projekt šel otevřít i bez souboru.
 *
 * Vlastní šablona FB nahrazuje vestavěnou (FB_Motor, FB_Ventil, FB_AnalogIn, FB_AnalogOut)
 * jen se STEJNÝM rozhraním (vstupy a výstupy, názvy a typy) — generátor ji volá stejně.
 * `libraryOverrides(prj, plat)` vrací, co nahradit; generátor ji čte přes `codeLibrary()`
 * (codegen.ts: kontrola převoditelnosti pro Unitronics a Logix) a jediný bod výběru textu
 * bloku `fbTemplate()`. Simulace a ověření dál zrcadlí vestavěné šablony (vlastní blok
 * simulací ověřen není), emulátor překladu kontroluje skutečný výstup i s vlastní šablonou.
 */
import { N_, tr, trx } from "./i18n.js";
import {
  CLS, DO_ROLES, Device, DeviceClass, DoRole, PLAT, PlatformKey, Project, nextName, syncIO,
} from "./model.js";
import { SCL_AI, SCL_AO, SCL_MOTOR, SCL_VENTIL, ST_AI, ST_AO, ST_MOTOR, ST_VENTIL, cmtSafe } from "./codegen.js";
import { CAT_LABEL } from "./catalog.js";
import { registerBomProvider, type BomExtra } from "./bom.js";

export const LIBRARY_FORMAT = "plcdesk-library";
/** Verze formátu souboru; novější soubor starší aplikace odmítne (error), starší se převede. */
export const LIBRARY_SCHEMA = 1;

export type FbClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut";
export const FB_CLASSES: FbClass[] = ["Motor", "Ventil", "AnalogIn", "AnalogOut"];
/** Dialekt šablony: SCL (Siemens TIA) nebo IEC ST (ostatní platformy). */
export type FbDialect = "scl" | "st";

export interface LibBomPart {
  /** kategorie kusovníku (`CAT_LABEL`), např. `motor`, `contactor` */
  cat: string;
  qty?: number;
  brand?: string; type?: string; orderCode?: string; note?: string;
  /** předpona označení dílu (např. `-Q`); prázdné = označení zařízení (`-M1`) */
  tagPrefix?: string;
}

export interface LibDeviceType {
  /** identifikátor typu (ASCII, unikátní bez ohledu na velikost písmen) */
  id: string;
  label: string;
  cls: DeviceClass;
  /** předpona označení nových zařízení (jinak podle třídy: M, Y, B…) */
  prefix?: string;
  desc?: string;
  /** volby třídy (`CLS[cls].opts`): fbk, fault, fbkOpen, fbkClosed */
  opt?: Record<string, boolean>;
  unit?: string; rmin?: number; rmax?: number;
  limHi?: number; limLo?: number; setpoint?: number;
  role?: DoRole;
  /** výchozí hlídací čas kroku s tímto zařízením [s] */
  stepTimeS?: number;
  bom?: LibBomPart[];
}

export interface LibFbTemplate {
  id: string;
  cls: FbClass;
  dialect: FbDialect;
  /** jen pro tyto platformy (prázdné = všechny platformy dialektu) */
  platforms?: PlatformKey[];
  /** zdrojový text bloku; jméno bloku musí být vestavěné (FB_Motor…) */
  source: string;
  note?: string;
}

export interface LibCompany {
  name: string;
  /** textové logo do hlavičky (výkresy DXF bez diakritiky) */
  logoText?: string;
  address?: string;
  /** schvalovatelé — nabídka jmen pro schvalování (approval.ts) */
  approvers?: Array<{ name: string; role?: string }>;
  /** další řádky hlavičky generovaného kódu (copyright, kontakt) */
  codeHeader?: string[];
}

export interface LibPlatformDefaults {
  platforms?: PlatformKey[];
  bomPlat?: PlatformKey;
  /** výchozí značka po kategoriích kusovníku (jako `prj.bom.brand`) */
  brand?: Record<string, string>;
  sim?: { motorDelay?: number; valveTravel?: number };
}

export interface CompanyLibrary {
  format: typeof LIBRARY_FORMAT;
  schema: number;
  name: string;
  /** verze obsahu knihovny (semver, zvyšuje firma) */
  version: string;
  updated?: string;
  company?: LibCompany;
  deviceTypes?: LibDeviceType[];
  fbTemplates?: LibFbTemplate[];
  platformDefaults?: LibPlatformDefaults;
}

export interface LibraryIssue { level: "error" | "warn"; where: string; msg: string; }

export function blankLibrary(name = ""): CompanyLibrary {
  return { format: LIBRARY_FORMAT, schema: LIBRARY_SCHEMA, name, version: "1.0.0", deviceTypes: [], fbTemplates: [] };
}

/* ================================================================ rozhraní FB */

export interface FbPort { name: string; type: string; }
export interface FbInterface { name: string; inputs: FbPort[]; outputs: FbPort[]; inouts: FbPort[]; }

/** Jméno a rozhraní bloku z textu SCL / ST (komentáře se ignorují). */
export function fbInterface(src: string): FbInterface {
  const s = String(src || "").replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/[^\n]*/g, " ").replace(/\{[^}]*\}/g, " ");
  const nm = s.match(/FUNCTION_BLOCK\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/);
  const out: FbInterface = { name: nm ? nm[1] : "", inputs: [], outputs: [], inouts: [] };
  const re = /\bVAR_(INPUT|OUTPUT|IN_OUT)\b([\s\S]*?)\bEND_VAR\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const list = m[1] === "INPUT" ? out.inputs : m[1] === "OUTPUT" ? out.outputs : out.inouts;
    for (const decl of m[2].split(";")) {
      const d = decl.match(/^\s*([A-Za-z_][A-Za-z0-9_,\s]*?)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
      if (d) for (const n of d[1].split(",")) if (n.trim()) list.push({ name: n.trim(), type: d[2].toUpperCase() });
    }
  }
  return out;
}

/* library.ts a codegen.ts se importují navzájem (generátor čte knihovnu) — šablony se proto
   berou až při volání, ne při načtení modulu */
const BUILTIN = (): Record<FbDialect, Record<FbClass, string>> => ({
  scl: { Motor: SCL_MOTOR, Ventil: SCL_VENTIL, AnalogIn: SCL_AI, AnalogOut: SCL_AO },
  st: { Motor: ST_MOTOR, Ventil: ST_VENTIL, AnalogIn: ST_AI, AnalogOut: ST_AO },
});
/** Vestavěná šablona třídy v dialektu (vzor pro vlastní blok). */
export function builtinTemplate(cls: FbClass, dialect: FbDialect): string { return BUILTIN()[dialect][cls]; }
/** Dialekt šablon pro platformu. */
export function dialectFor(plat: PlatformKey): FbDialect { return plat === "siemens" ? "scl" : "st"; }

/* ================================================================ validace */

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Počet výskytů klíčového slova (bez komentářů). */
function kw(s: string, re: RegExp): number { return (s.match(re) || []).length; }

/** Kontrola jedné šablony FB proti vestavěné (rozhraní, jméno, párování bloků, ASCII). */
export function validateFbTemplate(t: LibFbTemplate): LibraryIssue[] {
  const out: LibraryIssue[] = [];
  const where = tr("šablona {id}", { id: t.id || "?" });
  if (!FB_CLASSES.includes(t.cls)) { out.push({ level: "error", where, msg: tr("Neznámá třída bloku {cls} — povoleno Motor, Ventil, AnalogIn, AnalogOut.", { cls: String(t.cls) }) }); return out; }
  if (t.dialect !== "scl" && t.dialect !== "st") { out.push({ level: "error", where, msg: tr("Dialekt šablony musí být scl (Siemens) nebo st (IEC).") }); return out; }
  for (const p of t.platforms || []) {
    if (!PLAT[p]) out.push({ level: "error", where, msg: tr("Neznámá platforma {plat}.", { plat: String(p) }) });
    else if (dialectFor(p) !== t.dialect) out.push({ level: "error", where, msg: tr("Platforma {plat} používá dialekt {d}.", { plat: p, d: dialectFor(p) }) });
  }
  const src = String(t.source || "");
  const ref = fbInterface(BUILTIN()[t.dialect][t.cls]);
  const own = fbInterface(src);
  if (!own.name) { out.push({ level: "error", where, msg: tr("Šablona neobsahuje FUNCTION_BLOCK.") }); return out; }
  if (own.name !== ref.name) out.push({ level: "error", where, msg: tr("Blok se musí jmenovat {name} (generátor volá vestavěné jméno), ne {own}.", { name: ref.name, own: own.name }) });
  const code = src.replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/[^\n]*/g, " ").replace(/'[^']*'/g, "''");
  if (kw(code, /\bFUNCTION_BLOCK\b/g) !== 1 || kw(code, /\bEND_FUNCTION_BLOCK\b/g) !== 1)
    out.push({ level: "error", where, msg: tr("Šablona musí obsahovat právě jeden blok FUNCTION_BLOCK … END_FUNCTION_BLOCK.") });
  if (kw(code, /\bIF\b/g) !== kw(code, /\bEND_IF\b/g)) out.push({ level: "error", where, msg: tr("Nepárové IF / END_IF.") });
  if (kw(code, /\bCASE\b/g) !== kw(code, /\bEND_CASE\b/g)) out.push({ level: "error", where, msg: tr("Nepárové CASE / END_CASE.") });
  if (kw(code, /\b(FOR)\b/g) !== kw(code, /\bEND_FOR\b/g)) out.push({ level: "error", where, msg: tr("Nepárové FOR / END_FOR.") });
  const cmp = (kind: string, a: FbPort[], b: FbPort[]) => {
    for (const p of a) {
      const q = b.find(x => x.name === p.name);
      if (!q) out.push({ level: "error", where, msg: tr("Chybí {kind} {name} : {type} vestavěného bloku.", { kind, name: p.name, type: p.type }) });
      else if (q.type !== p.type) out.push({ level: "error", where, msg: tr("{kind} {name} má typ {own}, vestavěný blok {type}.", { kind, name: p.name, own: q.type, type: p.type }) });
    }
    for (const q of b) if (!a.some(p => p.name === q.name))
      out.push({ level: "error", where, msg: tr("{kind} {name} vestavěný blok nemá — generátor ho nezapojí.", { kind, name: q.name }) });
  };
  cmp(tr("vstup"), ref.inputs, own.inputs);
  cmp(tr("výstup"), ref.outputs, own.outputs);
  if (own.inouts.length) out.push({ level: "error", where, msg: tr("VAR_IN_OUT vestavěné bloky nemají.") });
  if (t.dialect === "st") {
    if (!isAscii(src.replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/[^\n]*/g, " ")))
      out.push({ level: "error", where, msg: tr("Kód šablony ST musí být čisté ASCII (Unitronics, GX Works3, Sysmac a Logix diakritiku neberou).") });
    else if (!isAscii(src)) out.push({ level: "warn", where, msg: tr("Komentáře šablony ST obsahují znaky mimo ASCII — u Unitronics se nahradí.") });
    if (/\(\*(?:(?!\*\))[\s\S])*\(\*/.test(src))
      out.push({ level: "warn", where, msg: tr("Vnořený komentář (* (* — CODESYS / TwinCAT ho čtou jinak než ostatní.") });
    if (/\bRETURN\b/.test(code) && !/^\s*IF\s+NOT\s+enable\s+THEN[\s\S]*?RETURN;[\s\S]*?END_IF;/m.test(code))
      out.push({ level: "warn", where, msg: tr("RETURN mimo úvodní IF NOT enable — u Unitronics (rozepsání bloku) se převádí jen tento tvar.") });
  }
  out.push({ level: "warn", where, msg: tr("Vlastní blok simulace neověřuje — simulace a ověření zrcadlí vestavěnou šablonu. Odladit v cílovém IDE.") });
  return out;
}

/** Kontrola celé knihovny; `error` = knihovnu (nebo položku) nelze použít. */
export function validateLibrary(lib: CompanyLibrary): LibraryIssue[] {
  const out: LibraryIssue[] = [];
  const W = tr("knihovna");
  if (!lib || typeof lib !== "object") return [{ level: "error", where: W, msg: tr("Soubor není knihovna PLCdesk.") }];
  if (lib.format !== LIBRARY_FORMAT) out.push({ level: "error", where: W, msg: tr("Soubor není knihovna PLCdesk (format = {f}).", { f: String(lib.format) }) });
  if (!fin(lib.schema) || lib.schema < 1) out.push({ level: "error", where: W, msg: tr("Chybí verze formátu knihovny (schema).") });
  else if (lib.schema > LIBRARY_SCHEMA) out.push({ level: "error", where: W, msg: tr("Knihovna má novější formát {s}, tato aplikace zná {max} — aktualizuj aplikaci.", { s: lib.schema, max: LIBRARY_SCHEMA }) });
  if (!String(lib.name || "").trim()) out.push({ level: "warn", where: W, msg: tr("Knihovna nemá název.") });
  if (!SEMVER.test(String(lib.version || ""))) out.push({ level: "warn", where: W, msg: tr("Verze knihovny „{v}“ není ve tvaru 1.2.3.", { v: String(lib.version ?? "") }) });

  /* firma */
  const c = lib.company;
  if (c) {
    const cw = tr("firma");
    if (!String(c.name || "").trim()) out.push({ level: "warn", where: cw, msg: tr("Chybí název firmy.") });
    for (const [i, a] of (c.approvers || []).entries()) if (!String(a?.name || "").trim())
      out.push({ level: "error", where: cw, msg: tr("Schvalovatel {n} nemá jméno.", { n: i + 1 }) });
    for (const l of c.codeHeader || []) if (/\*\)|\(\*/.test(l))
      out.push({ level: "error", where: cw, msg: tr("Řádek hlavičky kódu nesmí obsahovat (* ani *) — rozbil by komentář.") });
  }

  /* typy zařízení */
  const ids = new Map<string, number>();
  for (const t of lib.deviceTypes || []) {
    const where = tr("typ {id}", { id: t.id || "?" });
    const id = String(t.id || "");
    ids.set(id.toUpperCase(), (ids.get(id.toUpperCase()) || 0) + 1);
    if (!IDENT.test(id)) out.push({ level: "error", where, msg: tr("Identifikátor typu musí být písmena bez diakritiky, číslice a _, na začátku písmeno.") });
    if (!CLS[t.cls]) { out.push({ level: "error", where, msg: tr("Neznámá třída zařízení {cls}.", { cls: String(t.cls) }) }); continue; }
    if (!String(t.label || "").trim()) out.push({ level: "warn", where, msg: tr("Typ nemá popisek.") });
    if (t.prefix !== undefined && !/^[A-Za-z]{1,4}$/.test(t.prefix))
      out.push({ level: "error", where, msg: tr("Předpona označení musí být 1–4 písmena bez diakritiky (z ní vzniká identifikátor M1, Y2…).") });
    for (const k of Object.keys(t.opt || {})) if (!(k in CLS[t.cls].opts))
      out.push({ level: "error", where, msg: tr("Volba {opt} u třídy {cls} neexistuje.", { opt: k, cls: t.cls }) });
    const analog = t.cls === "AnalogIn" || t.cls === "AnalogOut";
    if (!analog && (t.unit !== undefined || t.rmin !== undefined || t.rmax !== undefined))
      out.push({ level: "warn", where, msg: tr("Jednotka a rozsah platí jen pro analogové třídy.") });
    if (fin(t.rmin) && fin(t.rmax) && t.rmin >= t.rmax) out.push({ level: "error", where, msg: tr("Rozsah měření: minimum musí být menší než maximum.") });
    if ((t.limHi !== undefined || t.limLo !== undefined) && t.cls !== "AnalogIn") out.push({ level: "error", where, msg: tr("Meze platí jen pro analogový vstup.") });
    if (fin(t.limLo) && fin(t.limHi) && t.limLo >= t.limHi) out.push({ level: "error", where, msg: tr("Mez min musí být menší než mez max — jinak je měření stále v poruše.") });
    if (t.setpoint !== undefined && t.cls !== "AnalogOut") out.push({ level: "error", where, msg: tr("Žádaná hodnota platí jen pro analogový výstup.") });
    if (t.role !== undefined && (t.cls !== "DO" || !(t.role in DO_ROLES))) out.push({ level: "error", where, msg: tr("Role výstupu platí jen pro digitální výstup a musí být jedna z: {roles}.", { roles: Object.keys(DO_ROLES).join(", ") }) });
    if (t.stepTimeS !== undefined && (!fin(t.stepTimeS) || t.stepTimeS <= 0)) out.push({ level: "error", where, msg: tr("Hlídací čas kroku musí být kladné číslo v sekundách.") });
    for (const p of t.bom || []) {
      if (!p || !String(p.cat || "")) { out.push({ level: "error", where, msg: tr("Díl kusovníku nemá kategorii.") }); continue; }
      if (!CAT_LABEL[p.cat.split("@")[0]]) out.push({ level: "warn", where, msg: tr("Kategorie kusovníku {cat} není v katalogu — řádek ponese jen zadané údaje.", { cat: p.cat }) });
      if (p.qty !== undefined && (!Number.isInteger(p.qty) || p.qty < 0)) out.push({ level: "error", where, msg: tr("Množství dílu {cat} musí být celé číslo ≥ 0.", { cat: p.cat }) });
      if (p.tagPrefix !== undefined && !/^[-+=][A-Za-z]{1,3}$/.test(p.tagPrefix)) out.push({ level: "error", where, msg: tr("Předpona označení dílu musí být např. -Q, -K (IEC 81346).") });
    }
  }
  for (const [id, n] of ids) if (n > 1 && id) out.push({ level: "error", where: id, msg: tr("Duplicitní identifikátor typu (bez ohledu na velikost písmen).") });

  /* šablony FB */
  const slot = new Map<string, number>();
  for (const t of lib.fbTemplates || []) {
    const key = t.cls + "|" + t.dialect + "|" + (t.platforms && t.platforms.length ? [...t.platforms].sort().join(",") : "*");
    slot.set(key, (slot.get(key) || 0) + 1);
    if (!IDENT.test(String(t.id || ""))) out.push({ level: "error", where: tr("šablona {id}", { id: t.id || "?" }), msg: tr("Identifikátor šablony musí být písmena bez diakritiky, číslice a _, na začátku písmeno.") });
    out.push(...validateFbTemplate(t));
  }
  for (const [k, n] of slot) if (n > 1) out.push({ level: "error", where: k, msg: tr("Pro stejnou třídu, dialekt a platformy jsou dvě šablony — nevím, kterou použít.") });

  /* výchozí volby platformy */
  const d = lib.platformDefaults;
  if (d) {
    const dw = tr("výchozí platforma");
    for (const p of [...(d.platforms || []), ...(d.bomPlat ? [d.bomPlat] : [])]) if (!PLAT[p]) out.push({ level: "error", where: dw, msg: tr("Neznámá platforma {plat}.", { plat: String(p) }) });
    for (const k of ["motorDelay", "valveTravel"] as const) {
      const v = d.sim?.[k];
      if (v !== undefined && (!fin(v) || v <= 0)) out.push({ level: "error", where: dw, msg: tr("Čas modelu stroje musí být kladné číslo v sekundách.") });
    }
  }
  return out;
}

/* ================================================================ export / import */

/** Převod starších formátů na aktuální (zatím jen schema 1). */
function migrate(lib: CompanyLibrary): CompanyLibrary {
  return { ...lib, deviceTypes: lib.deviceTypes || [], fbTemplates: lib.fbTemplates || [] };
}

/** Knihovna jako JSON k uložení (stabilní pořadí klíčů, razítko formátu a data). */
export function exportLibrary(lib: CompanyLibrary, updated?: string): string {
  const o: CompanyLibrary = {
    format: LIBRARY_FORMAT, schema: LIBRARY_SCHEMA, name: lib.name || "", version: lib.version || "1.0.0",
    updated: updated ?? lib.updated ?? new Date().toISOString().slice(0, 10),
    ...(lib.company ? { company: lib.company } : {}),
    deviceTypes: lib.deviceTypes || [],
    fbTemplates: lib.fbTemplates || [],
    ...(lib.platformDefaults ? { platformDefaults: lib.platformDefaults } : {}),
  };
  return JSON.stringify(o, null, 2) + "\n";
}

/** Načte knihovnu ze souboru; `lib` je null, když nejde použít (viz `issues`). */
export function importLibrary(text: string): { lib: CompanyLibrary | null; issues: LibraryIssue[] } {
  let raw: unknown;
  try { raw = JSON.parse(String(text || "").replace(/^﻿/, "")); }
  catch { return { lib: null, issues: [{ level: "error", where: tr("knihovna"), msg: tr("Soubor knihovny není platný JSON.") }] }; }
  const issues = validateLibrary(raw as CompanyLibrary);
  const r = raw as Partial<CompanyLibrary> | null;
  const fatal = !r || typeof r !== "object" || r.format !== LIBRARY_FORMAT || !fin(r.schema) || r.schema < 1 || r.schema > LIBRARY_SCHEMA;
  return { lib: fatal ? null : migrate(raw as CompanyLibrary), issues };
}

/* ================================================================ použití v projektu */

/** Knihovna projektu (kopie v `prj.library`). */
export function projectLibrary(prj: Project): CompanyLibrary | null {
  return prj.library && prj.library.format === LIBRARY_FORMAT ? prj.library : null;
}

/**
 * Připojí knihovnu k projektu (kopie). `defaults` = převzít výchozí platformy, značky
 * kusovníku a časy modelu stroje — jen tam, kde projekt ještě nic nezvolil.
 */
export function attachLibrary(prj: Project, lib: CompanyLibrary, defaults = true): void {
  prj.library = JSON.parse(JSON.stringify(lib));
  const d = lib.platformDefaults;
  if (!defaults || !d) return;
  if (d.platforms?.length && !prj.devices.length) prj.platforms = [...d.platforms];
  if (d.bomPlat || d.brand) {
    prj.bom = prj.bom || {};
    if (d.bomPlat && !prj.bom.plat) prj.bom.plat = d.bomPlat;
    if (d.brand) prj.bom.brand = { ...d.brand, ...(prj.bom.brand || {}) };
  }
  if (d.sim) prj.sim = { ...d.sim, ...(prj.sim || {}) };
}

export function libDeviceType(prj: Project, id: string | undefined): LibDeviceType | undefined {
  if (!id) return undefined;
  return projectLibrary(prj)?.deviceTypes?.find(t => t.id === id);
}

/** Řádek kusovníku, který díl typu dostane u zařízení (označení + kategorie = `BomLine.id`). */
function partTag(d: Device, p: LibBomPart): string {
  const n = d.name.replace(/^\D+/, "") || String(d.id);
  return p.tagPrefix ? p.tagPrefix + n : "-" + d.name;
}

/**
 * Přidá do projektu zařízení podle typu z knihovny: třída, popis, volby, rozsah, meze, role;
 * synchronizuje I/O a zapíše značku / typ / kód dílů do voleb kusovníku (bez přepsání voleb
 * uživatele). Vrací nové zařízení; `name` = vlastní označení (jinak předpona + číslo).
 */
export function addLibraryDevice(prj: Project, typeId: string, name?: string): Device {
  const t = libDeviceType(prj, typeId);
  if (!t) throw new Error(tr("Typ {id} v knihovně projektu není.", { id: typeId }));
  let nm = name;
  if (!nm) {
    const pre = t.prefix || CLS[t.cls].prefix;
    let n = 1;
    while (prj.devices.some(d => d.name.toUpperCase() === (pre + n).toUpperCase())) n++;
    nm = t.prefix ? pre + n : nextName(prj, t.cls);
  }
  const d: Device = {
    id: prj.nextId++, name: nm, cls: t.cls, desc: t.desc ?? t.label ?? "", opt: { ...(t.opt || {}) },
    unit: t.unit ?? "", rmin: t.rmin ?? 0, rmax: t.rmax ?? 100, libType: t.id,
  };
  if (fin(t.limHi)) d.limHi = t.limHi;
  if (fin(t.limLo)) d.limLo = t.limLo;
  if (fin(t.setpoint)) d.setpoint = t.setpoint;
  if (t.role) d.role = t.role;
  prj.devices.push(d);
  syncIO(prj);
  for (const p of t.bom || []) {
    if (!p.brand && !p.type && !p.orderCode) continue;
    const id = partTag(d, p) + ":" + p.cat;
    prj.bom = prj.bom || {};
    prj.bom.lines = prj.bom.lines || {};
    const cur = prj.bom.lines[id] || {};
    prj.bom.lines[id] = {
      ...(p.brand ? { brand: p.brand } : {}), ...(p.type ? { type: p.type } : {}), ...(p.orderCode ? { orderCode: p.orderCode } : {}),
      ...cur,
    };
  }
  return d;
}

/** Výchozí hlídací čas kroku pro zařízení (z typu knihovny), jinak `fallback`. */
export function libStepTime(prj: Project, devId: number, fallback: number): number {
  const d = prj.devices.find(x => x.id === devId);
  const t = libDeviceType(prj, d?.libType);
  return t && fin(t.stepTimeS) ? t.stepTimeS : fallback;
}

/* díly typů knihovny navíc ke kusovníku (motor typu „čerpadlo s frekvenčním měničem“ → + měnič) */
registerBomProvider((prj) => {
  const add: BomExtra[] = [];
  if (!projectLibrary(prj)) return { add };
  for (const d of prj.devices) {
    const t = libDeviceType(prj, d.libType);
    for (const p of t?.bom || []) {
      add.push({
        tag: partTag(d, p), cat: p.cat, qty: p.qty ?? 1, desc: d.desc || d.name, devId: d.id, note: p.note,
        preset: { brand: p.brand, type: p.type, orderCode: p.orderCode },
      });
    }
  }
  return { add };
}, "library");

/* ================================================================ napojení generátoru */

export interface LibraryOverrides {
  /** text šablony místo vestavěné (`SCL_MOTOR` / `ST_MOTOR`…), jen bez chyb validace */
  templates: Partial<Record<FbClass, string>>;
  /** identifikátor použité šablony knihovny (pro README a dokumentaci) */
  ids: Partial<Record<FbClass, string>>;
  /** knihovna, ze které šablony a hlavička jsou (název a verze) */
  library?: { name: string; version: string };
  /** řádky firemní hlavičky (bez značek komentáře; ASCII a bezpečné pro (* *) u ST) */
  header: string[];
  /** šablony vynechané pro chyby a upozornění */
  issues: LibraryIssue[];
}

/**
 * Co má generátor pro platformu převzít z knihovny projektu. Šablona přesně pro platformu má
 * přednost před šablonou dialektu pro všechny platformy; šablona s chybou se nepoužije.
 * Generátor ji čte přes `codeLibrary()` (codegen.ts), který navíc vyřadí šablony, které nejde
 * spolehlivě převést pro Unitronics (rozepsání) nebo Logix (AOI).
 */
export function libraryOverrides(prj: Project, plat: PlatformKey): LibraryOverrides {
  const res: LibraryOverrides = { templates: {}, ids: {}, header: [], issues: [] };
  const lib = projectLibrary(prj);
  if (!lib) return res;
  res.library = { name: lib.name || "", version: lib.version || "" };
  const dia = dialectFor(plat);
  for (const cls of FB_CLASSES) {
    const cands = (lib.fbTemplates || []).filter(t => t.cls === cls && t.dialect === dia && (!t.platforms?.length || t.platforms.includes(plat)));
    cands.sort((a, b) => (b.platforms?.length ? 1 : 0) - (a.platforms?.length ? 1 : 0));
    const t = cands[0];
    if (!t) continue;
    const iss = validateFbTemplate(t);
    res.issues.push(...iss);
    if (iss.some(i => i.level === "error")) continue;
    res.templates[cls] = t.source;
    res.ids[cls] = t.id;
  }
  const c = lib.company;
  if (c) {
    const ascii = (s: string) => plat === "siemens" ? s : cmtSafe(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");
    if (c.name) res.header.push(ascii(c.name + (c.logoText && c.logoText !== c.name ? " — " + c.logoText : "")));
    if (c.address) res.header.push(ascii(c.address));
    for (const l of c.codeHeader || []) res.header.push(ascii(l.replace(/\(\*|\*\)/g, "")));
    res.header.push(ascii(trx("Knihovna {name} {v}", { name: lib.name, v: lib.version })));
  }
  return res;
}

/** Firemní hlavička do dokumentů (Markdown) — název firmy, adresa, schvalovatelé. */
export function libraryDocHeader(prj: Project): string {
  const c = projectLibrary(prj)?.company;
  if (!c?.name) return "";
  const out = ["**" + c.name + "**" + (c.logoText && c.logoText !== c.name ? " · " + c.logoText : "")];
  if (c.address) out.push(c.address);
  if (c.approvers?.length) out.push(tr("Schvalovatelé: {list}", { list: c.approvers.map(a => a.name + (a.role ? " (" + a.role + ")" : "")).join(", ") }));
  return out.join("  \n") + "\n";
}

/** Jména schvalovatelů z knihovny (nabídka v dialogu schválení). */
export function libraryApprovers(prj: Project): string[] {
  return (projectLibrary(prj)?.company?.approvers || []).map(a => a.name).filter(Boolean);
}

/** Popisky pro UI (české klíče). */
export const LIBRARY_LABEL = {
  deviceTypes: N_("Vlastní typy zařízení"),
  fbTemplates: N_("Vlastní šablony bloků"),
  company: N_("Firemní hlavička"),
  platformDefaults: N_("Výchozí volby platformy"),
};
