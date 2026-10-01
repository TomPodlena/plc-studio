/**
 * PLC Studio — datový model návrhu a odvozování I/O.
 * Čistý TypeScript bez závislostí; logika přenesená z prototypu (artifact v8).
 */

export type PlatformKey =
  | "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron";

export type DeviceClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "DI" | "DO";
export type Dir = "DI" | "DO" | "AI" | "AO";
export type SeqAct = "start" | "stop" | "open" | "close" | "wait";
export type SeqCond = "fbk" | "time";

export interface PlatformInfo { name: string; ide: string; cpu: string; lang: string; imp: string; }

export interface Device {
  id: number;
  name: string;
  cls: DeviceClass;
  desc: string;
  opt: Record<string, boolean>;
  unit: string;
  rmin: number;
  rmax: number;
}

export interface IoEntry {
  key: string;
  devId: number;
  sig: string;
  dir: Dir;
  tag: string;
  addr: string;   // kanonicky v Siemens notaci (%I0.0, %IW64); pro ostatní platformy převádí addrFor()
  cmt: string;
  nc?: boolean;   // jen DI: rozpínací kontakt (bezpečnostní prvky)
}

export interface SeqStep { dev: number; act: SeqAct; cond: SeqCond; timeS: number; }
export interface ProgramCfg { modes: boolean; estop: number | ""; seq: SeqStep[]; }

import type { SolutionConcept } from "./concept.js";

export interface Project {
  meta: { name: string; desc: string };
  platforms: PlatformKey[];
  devices: Device[];
  io: IoEntry[];
  program: ProgramCfg;
  nextId: number;
  /** Zvolený koncept řešení z AI nadstavby (viz concept.ts); null = zatím nezvolen. */
  concept?: SolutionConcept | null;
}

export interface IoModule { dir: Dir; idx: number; ch: IoEntry[]; }

export const PLAT: Record<PlatformKey, PlatformInfo> = {
  siemens:    { name: "Siemens SIMATIC", ide: "TIA Portal V17–V21", cpu: "S7-1200 / S7-1500", lang: "SCL", imp: "externí zdroje .scl + SimaticML XML (Openness) + TSV tagů" },
  rockwell:   { name: "Rockwell Allen-Bradley", ide: "Studio 5000", cpu: "CompactLogix / ControlLogix", lang: "ST", imp: "ST rutiny + CSV import tagů / L5X" },
  beckhoff:   { name: "Beckhoff", ide: "TwinCAT 3 (XAE)", cpu: "CX / C60xx IPC", lang: "ST", imp: "POU + GVL (vložit do editoru)" },
  codesys:    { name: "CODESYS", ide: "CODESYS V3.5", cpu: "WAGO, Festo, Eaton…", lang: "ST", imp: "POU + GVL / PLCopen XML" },
  mitsubishi: { name: "Mitsubishi", ide: "GX Works3", cpu: "MELSEC iQ-F / iQ-R", lang: "ST", imp: "ST program + global labels CSV" },
  schneider:  { name: "Schneider Electric", ide: "EcoStruxure Machine Expert", cpu: "Modicon M241 / M262", lang: "ST", imp: "POU + GVL (báze CODESYS)" },
  omron:      { name: "OMRON", ide: "Sysmac Studio", cpu: "NX / NJ", lang: "ST", imp: "ST program + tabulka proměnných" },
};

export const IECPLATS: PlatformKey[] = ["rockwell", "beckhoff", "codesys", "mitsubishi", "schneider", "omron"];

export const CLS: Record<DeviceClass, { prefix: string; label: string; opts: Record<string, string> }> = {
  Motor:     { prefix: "M", label: "Motor / čerpadlo", opts: { fbk: "zpětné hlášení běhu", fault: "vstup poruchy" } },
  Ventil:    { prefix: "Y", label: "Ventil / válec", opts: { fbkOpen: "koncák otevřeno", fbkClosed: "koncák zavřeno" } },
  AnalogIn:  { prefix: "B", label: "Analogový vstup", opts: {} },
  AnalogOut: { prefix: "U", label: "Analogový výstup", opts: {} },
  DI:        { prefix: "S", label: "Digitální vstup (snímač)", opts: {} },
  DO:        { prefix: "H", label: "Digitální výstup (signálka…)", opts: {} },
};

/* ------------------------------------------------------------------ utily */

export function stripDia(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export const xmlEsc = esc;

export function blankProject(): Project {
  return {
    meta: { name: "", desc: "" },
    platforms: ["siemens"],
    devices: [],
    io: [],
    program: { modes: true, estop: "", seq: [] },
    nextId: 1,
    concept: null,
  };
}

export function devById(prj: Project, id: number | ""): Device | undefined {
  return prj.devices.find(d => d.id === id);
}
export function nextName(prj: Project, cls: DeviceClass): string {
  const pre = CLS[cls].prefix;
  let n = 1;
  while (prj.devices.some(d => d.name === pre + n)) n++;
  return pre + n;
}
export function instName(d: Device): string { return "inst" + d.name; }
export function usedClasses(prj: Project): Set<DeviceClass> {
  return new Set(prj.devices.map(d => d.cls));
}
export function ioOf(prj: Project, dev: Device): Record<string, IoEntry> {
  const o: Record<string, IoEntry> = {};
  for (const e of prj.io) if (e.devId === dev.id) o[e.sig] = e;
  return o;
}

/* --------------------------------------------------- signály & I/O tabulka */

export function devSignals(d: Device): Array<[sig: string, dir: Dir, label: string]> {
  const o = d.opt || {};
  const s: Array<[string, Dir, string]> = [];
  if (d.cls === "Motor") {
    if (o.fbk !== false) s.push(["fbkRunning", "DI", "běh"]);
    if (o.fault) s.push(["fault", "DI", "porucha"]);
    s.push(["outRun", "DO", "povel chod"]);
  } else if (d.cls === "Ventil") {
    if (o.fbkOpen !== false) s.push(["fbkOpen", "DI", "otevřeno"]);
    if (o.fbkClosed) s.push(["fbkClosed", "DI", "zavřeno"]);
    s.push(["outOpen", "DO", "povel otevřít"]);
  } else if (d.cls === "AnalogIn") s.push(["raw", "AI", d.unit || ""]);
  else if (d.cls === "AnalogOut") s.push(["raw", "AO", d.unit || ""]);
  else if (d.cls === "DI") s.push(["in", "DI", ""]);
  else if (d.cls === "DO") s.push(["out", "DO", ""]);
  return s;
}

/** Synchronizuje I/O tabulku se zařízeními; existující řádky (edity) zachová. */
export function syncIO(prj: Project): void {
  const fresh: IoEntry[] = [];
  for (const d of prj.devices) {
    for (const [sig, dir, lbl] of devSignals(d)) {
      const key = d.id + ":" + sig;
      const old = prj.io.find(e => e.key === key);
      fresh.push(old || {
        key, devId: d.id, sig, dir,
        tag: d.name + "_" + sig,
        addr: "",
        cmt: (d.desc ? d.desc + " – " : "") + lbl,
        nc: dir === "DI" && /\bNC\b/i.test(d.desc || ""),
      });
    }
  }
  prj.io = fresh;
  autoAddr(prj, false);
}

/** Doplní (force=true: přepíše) adresy v Siemens notaci. */
export function autoAddr(prj: Project, force: boolean): void {
  let di = 0, dq = 0, ai = 64, ao = 64;
  const taken = new Set(force ? [] : prj.io.filter(e => e.addr).map(e => e.addr));
  const next = (dir: Dir): string => {
    for (;;) {
      let a: string;
      if (dir === "DI") { a = "%I" + (di >> 3) + "." + (di & 7); di++; }
      else if (dir === "DO") { a = "%Q" + (dq >> 3) + "." + (dq & 7); dq++; }
      else if (dir === "AI") { a = "%IW" + ai; ai += 2; }
      else { a = "%QW" + ao; ao += 2; }
      if (!taken.has(a)) return a;
    }
  };
  for (const e of prj.io) {
    if (force || !e.addr) { e.addr = next(e.dir); taken.add(e.addr); }
  }
}

export function dtFor(e: IoEntry): "BOOL" | "INT" {
  return (e.dir === "AI" || e.dir === "AO") ? "INT" : "BOOL";
}

/** Převod kanonické (Siemens) adresy na notaci cílové platformy. */
export function addrFor(plat: PlatformKey, e: IoEntry): string {
  const a = e.addr || "";
  if (plat === "siemens") return a;
  if (plat === "beckhoff" || plat === "codesys" || plat === "schneider") {
    const m = a.match(/^%([IQ])(\d+)\.(\d+)$/);
    return m ? "%" + m[1] + "X" + m[2] + "." + m[3] : a;
  }
  if (plat === "mitsubishi") {
    const m = a.match(/^%([IQ])(\d+)\.(\d+)$/);
    if (m) return (m[1] === "I" ? "X" : "Y") + ((+m[2]) * 8 + (+m[3])).toString(16).toUpperCase();
    return "";
  }
  return ""; // rockwell, omron: symbolicky / alias tagy
}

export function addrOrd(e: IoEntry): number {
  const m = (e.addr || "").match(/%[IQ](W)?(\d+)(?:\.(\d+))?/);
  if (!m) return 999999;
  return m[1] ? 100000 + (+m[2]) : (+m[2]) * 8 + (+(m[3] || 0));
}

/** Rozdělení I/O do modulů (DI16 / DO16 / AI8 / AO4) pro schémata a FDS. */
export function modules(prj: Project): IoModule[] {
  const per: Record<Dir, number> = { DI: 16, DO: 16, AI: 8, AO: 4 };
  const mods: IoModule[] = [];
  for (const dir of ["DI", "DO", "AI", "AO"] as Dir[]) {
    const list = prj.io.filter(e => e.dir === dir).sort((a, b) => addrOrd(a) - addrOrd(b));
    let idx = 1;
    for (let i = 0; i < list.length; i += per[dir]) {
      mods.push({ dir, idx: idx++, ch: list.slice(i, i + per[dir]) });
    }
  }
  return mods;
}

/* --------------------------------------------------- validace & sanitizace */

export interface ValidationIssue {
  level: "error" | "warn";
  where: string;   // tag / zařízení / adresa
  msg: string;
}

/** Tag bezpečný pro všechny platformy: ASCII, bez mezer, nezačíná číslicí. */
export function sanitizeTag(tag: string): string {
  let t = stripDia(tag).replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (/^\d/.test(t)) t = "T_" + t;
  return t.slice(0, 32) || "TAG";
}

const RESERVED = new Set([
  "IF", "THEN", "ELSE", "CASE", "OF", "FOR", "WHILE", "DO", "NOT", "AND", "OR", "XOR",
  "TRUE", "FALSE", "VAR", "END_VAR", "BOOL", "INT", "REAL", "WORD", "TIME", "RETURN",
]);

export function validateProject(prj: Project): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const names = new Map<string, number>();
  for (const d of prj.devices) names.set(d.name, (names.get(d.name) || 0) + 1);
  for (const [n, c] of names) if (c > 1) out.push({ level: "error", where: n, msg: "Duplicitní označení zařízení." });

  const tags = new Map<string, number>();
  const addrs = new Map<string, number>();
  for (const e of prj.io) {
    tags.set(e.tag, (tags.get(e.tag) || 0) + 1);
    if (e.addr) addrs.set(e.addr, (addrs.get(e.addr) || 0) + 1);
    if (e.tag !== sanitizeTag(e.tag)) {
      out.push({ level: "warn", where: e.tag, msg: "Tag obsahuje diakritiku/mezery — Rockwell, GX Works3 a Sysmac ho odmítnou. Doporučeno: " + sanitizeTag(e.tag) });
    }
    if (RESERVED.has(e.tag.toUpperCase())) {
      out.push({ level: "error", where: e.tag, msg: "Tag koliduje s klíčovým slovem IEC 61131-3." });
    }
    if ((e.dir === "AI" || e.dir === "AO")) {
      const m = e.addr.match(/^%[IQ]W(\d+)$/);
      if (m && (+m[1]) % 2 === 1) out.push({ level: "warn", where: e.addr, msg: "Analogová adresa by měla být sudá (slovo = 2 byty)." });
    }
  }
  for (const [t, c] of tags) if (c > 1) out.push({ level: "error", where: t, msg: "Duplicitní tag." });
  for (const [a, c] of addrs) if (c > 1) out.push({ level: "error", where: a, msg: "Duplicitní adresa." });
  return out;
}
