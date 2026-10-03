/**
 * PLC Studio — datový model návrhu a odvozování I/O.
 * Čistý TypeScript bez závislostí; logika přenesená z prototypu (artifact v8).
 */
import { N_, tr } from "./i18n.js";

export type PlatformKey =
  | "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron" | "unitronics";

export type DeviceClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "DI" | "DO";
export type Dir = "DI" | "DO" | "AI" | "AO";
/** Akce kroku: povel motoru / ventilu, výdrž, nebo čekání na digitální vstup (DI = TRUE / FALSE). */
export type SeqAct = "start" | "stop" | "open" | "close" | "wait" | "waitOn" | "waitOff";
/** Vazba digitálního výstupu na stav stroje (generuje se do programu i do simulace). */
export type DoRole = "run" | "fault" | "ready" | "stopped" | "lock" | "auto";
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
  /** AnalogIn: meze v jednotkách; překročení = porucha stroje (alarm A_<dev>_HI / _LO). */
  limHi?: number;
  limLo?: number;
  /** AnalogOut: žádaná hodnota v jednotkách (konstanta zapisovaná programem). */
  setpoint?: number;
  /** DO: vazba výstupu na stav stroje (maják chod/porucha, zámek krytů…). */
  role?: DoRole;
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
export interface ProgramCfg {
  modes: boolean;
  estop: number | "";
  seq: SeqStep[];
  /**
   * Blokovací vstupy (kryty, světelná závora, tlak vzduchu…): DI zařízení, která jsou spolu
   * s E-stopem součástí `enable` — FALSE zastaví stroj (výstupy vypnout, sekvence do kroku 0).
   * Funkční blokování v běžném programu, NE bezpečnostní funkce. Starší projekty pole nemají.
   */
  interlocks?: number[];
}

export interface Project {
  /** `takt` = požadovaná doba cyklu [s]; ověření ji porovná se simulovaným cyklem. */
  meta: { name: string; desc: string; takt?: number };
  platforms: PlatformKey[];
  devices: Device[];
  io: IoEntry[];
  program: ProgramCfg;
  nextId: number;
  /** Model stroje pro simulaci: doba rozběhu motoru a přestavení ventilu [s]. */
  sim?: { motorDelay?: number; valveTravel?: number };
  /** Kusovník: platforma HW, značka po kategoriích, úpravy řádků (klíč = `BomLine.id`). */
  bom?: BomCfg;
}

export interface BomLineCfg { brand?: string; type?: string; orderCode?: string; supplier?: string; qty?: number; note?: string; }
export interface BomCfg {
  plat?: PlatformKey;
  brand?: Record<string, string>;
  lines?: Record<string, BomLineCfg>;
}

export interface IoModule { dir: Dir; idx: number; ch: IoEntry[]; }

export const PLAT: Record<PlatformKey, PlatformInfo> = {
  siemens:    { name: "Siemens SIMATIC", ide: "TIA Portal V17–V21", cpu: "S7-1200 / S7-1500", lang: "SCL", imp: N_("externí zdroje .scl + SimaticML XML (Openness) + TSV tagů") },
  rockwell:   { name: "Rockwell Allen-Bradley", ide: "Studio 5000", cpu: "CompactLogix / ControlLogix", lang: "ST", imp: N_("ST rutiny + CSV import tagů / L5X") },
  beckhoff:   { name: "Beckhoff", ide: "TwinCAT 3 (XAE)", cpu: "CX / C60xx IPC", lang: "ST", imp: N_("POU + GVL (vložit do editoru)") },
  codesys:    { name: "CODESYS", ide: "CODESYS V3.5", cpu: "WAGO, Festo, Eaton…", lang: "ST", imp: N_("POU + GVL / PLCopen XML") },
  mitsubishi: { name: "Mitsubishi", ide: "GX Works3", cpu: "MELSEC iQ-F / iQ-R", lang: "ST", imp: N_("ST program + global labels CSV") },
  schneider:  { name: "Schneider Electric", ide: "EcoStruxure Machine Expert", cpu: "Modicon M241 / M262", lang: "ST", imp: N_("POU + GVL (báze CODESYS)") },
  omron:      { name: "OMRON", ide: "Sysmac Studio", cpu: "NX / NJ", lang: "ST", imp: N_("ST program + tabulka proměnných") },
  unitronics: { name: "Unitronics", ide: "UniLogic", cpu: "UniStream (US5–US15, USC)", lang: N_("ST (funkce)"), imp: N_("ST funkce k vložení + seznam tagů k založení; Vision/Samba jen Ladder (předloha)") },
};

/** Tabulka platforem s texty v nastaveném jazyce (`PLAT` drží české klíče překladu). */
export function platInfo(): Record<PlatformKey, PlatformInfo> {
  const out = {} as Record<PlatformKey, PlatformInfo>;
  for (const k of Object.keys(PLAT) as PlatformKey[]) out[k] = { ...PLAT[k], lang: tr(PLAT[k].lang), imp: tr(PLAT[k].imp) };
  return out;
}

export const IECPLATS: PlatformKey[] = ["rockwell", "beckhoff", "codesys", "mitsubishi", "schneider", "omron"];

export const CLS: Record<DeviceClass, { prefix: string; label: string; opts: Record<string, string> }> = {
  Motor:     { prefix: "M", label: N_("Motor / čerpadlo"), opts: { fbk: N_("zpětné hlášení běhu"), fault: N_("vstup poruchy") } },
  Ventil:    { prefix: "Y", label: N_("Ventil / válec"), opts: { fbkOpen: N_("koncák otevřeno"), fbkClosed: N_("koncák zavřeno") } },
  AnalogIn:  { prefix: "B", label: N_("Analogový vstup"), opts: {} },
  AnalogOut: { prefix: "U", label: N_("Analogový výstup"), opts: {} },
  DI:        { prefix: "S", label: N_("Digitální vstup (snímač)"), opts: {} },
  DO:        { prefix: "H", label: N_("Digitální výstup (signálka…)"), opts: {} },
};

/** Třídy zařízení s texty v nastaveném jazyce (`CLS` drží české klíče překladu). */
export function clsInfo(): Record<DeviceClass, { prefix: string; label: string; opts: Record<string, string> }> {
  const out = {} as Record<DeviceClass, { prefix: string; label: string; opts: Record<string, string> }>;
  for (const k of Object.keys(CLS) as DeviceClass[]) {
    const opts: Record<string, string> = {};
    for (const o of Object.keys(CLS[k].opts)) opts[o] = tr(CLS[k].opts[o]);
    out[k] = { prefix: CLS[k].prefix, label: tr(CLS[k].label), opts };
  }
  return out;
}

/** Vazby výstupů na stav stroje — popisky (klíče překladu) pro výběr v UI. */
export const DO_ROLES: Record<DoRole, string> = {
  run: N_("chod — sekvence běží (maják zelená)"),
  fault: N_("porucha stroje (maják červená, houkačka)"),
  ready: N_("připraveno ke startu"),
  stopped: N_("stop / nouzové zastavení (enable = FALSE)"),
  lock: N_("zámek krytů — zamčeno během cyklu"),
  auto: N_("režim AUTO"),
};

/** Čeká krok na digitální vstup? */
export function isDiWait(s: SeqStep): boolean { return s.act === "waitOn" || s.act === "waitOff"; }

/* ------------------------------------------------------------------ utily */

export function stripDia(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[¿¡]/g, "");
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
    program: { modes: true, estop: "", seq: [], interlocks: [] },
    nextId: 1,
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

/** Vstupní signál digitálního zařízení (DI: „in", jinak první signál). */
function diSignal(prj: Project, d: Device): IoEntry | undefined {
  const io = ioOf(prj, d);
  return io.in || Object.values(io)[0];
}

/** Výraz role výstupu (proměnné strojního bloku přes `L`); `hasSeq` = projekt má sekvenci. */
export function roleExpr(role: DoRole, hasSeq: boolean, L: (v: string) => string): string {
  const running = hasSeq ? L("seqStep") + " <> 0" : "FALSE";
  switch (role) {
    case "run": return running;
    case "fault": return L("machineFault");
    case "ready": return L("enable") + " AND NOT " + L("machineFault") + (hasSeq ? " AND " + L("modeAuto") + " AND " + L("seqStep") + " = 0" : "");
    case "stopped": return "NOT " + L("enable");
    case "lock": return running;
    case "auto": return hasSeq ? L("modeAuto") : "FALSE";
  }
}

/** Blokovací zařízení programu: existující DI, bez E-stopu, bez duplicit, v pořadí projektu. */
export function interlockDevs(prj: Project): Device[] {
  const ids = new Set(prj.program.interlocks || []);
  return prj.devices.filter(d => ids.has(d.id) && d.cls === "DI" && d.id !== prj.program.estop);
}

/**
 * Vstupy, ze kterých se skládá `enable` (AND): E-stop a blokovací vstupy.
 * TRUE = v pořádku; FALSE kteréhokoli zastaví stroj. Generátor i simulátor berou odsud.
 */
export function enableInputs(prj: Project): Array<{ dev: Device; io: IoEntry; estop: boolean }> {
  const out: Array<{ dev: Device; io: IoEntry; estop: boolean }> = [];
  const es = devById(prj, prj.program.estop);
  const esIo = es ? diSignal(prj, es) : undefined;
  if (es && esIo) out.push({ dev: es, io: esIo, estop: true });
  for (const d of interlockDevs(prj)) {
    const e = diSignal(prj, d);
    if (e) out.push({ dev: d, io: e, estop: false });
  }
  return out;
}
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
    if (o.fbk !== false) s.push(["fbkRunning", "DI", tr("běh")]);
    if (o.fault) s.push(["fault", "DI", tr("porucha")]);
    s.push(["outRun", "DO", tr("povel chod")]);
  } else if (d.cls === "Ventil") {
    if (o.fbkOpen !== false) s.push(["fbkOpen", "DI", tr("otevřeno")]);
    if (o.fbkClosed) s.push(["fbkClosed", "DI", tr("zavřeno")]);
    s.push(["outOpen", "DO", tr("povel otevřít")]);
  } else if (d.cls === "AnalogIn") s.push(["raw", "AI", d.unit || ""]);
  else if (d.cls === "AnalogOut") s.push(["raw", "AO", d.unit || ""]);
  else if (d.cls === "DI") s.push(["in", "DI", ""]);
  else if (d.cls === "DO") s.push(["out", "DO", ""]);
  return s;
}

/**
 * Synchronizuje I/O tabulku se zařízeními; existující řádky (edity) zachová.
 * Komentář nového signálu vzniká v jazyce nastaveném v okamžiku vytvoření — je to obsah
 * projektu, při přepnutí jazyka se nepřekládá.
 */
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
        cmt: [d.desc, lbl].filter(Boolean).join(" – "),   // DI/DO bez popisku signálu: bez visící pomlčky
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
  /* TwinCAT: pevné adresy nedoporučuje — AT %I* / %Q* a nalinkování na kanály svorek */
  if (plat === "beckhoff") return e.dir === "DI" || e.dir === "AI" ? "%I*" : "%Q*";
  if (plat === "codesys" || plat === "schneider") {
    const m = a.match(/^%([IQ])(\d+)\.(\d+)$/);
    if (m) return "%" + m[1] + "X" + m[2] + "." + m[3];
    const w = a.match(/^%([IQ])W(\d+)$/);         // Siemens bajt → CODESYS index slova (%IW64 → %IW32)
    return w ? "%" + w[1] + "W" + (+w[2] >> 1) : a;
  }
  if (plat === "mitsubishi") {
    const m = a.match(/^%([IQ])(\d+)\.(\d+)$/);
    if (m) return (m[1] === "I" ? "X" : "Y") + ((+m[2]) * 8 + (+m[3])).toString(8);   // FX5 (iQ-F): X/Y osmičkově
    return "";
  }
  return ""; // rockwell, omron, unitronics: symbolicky / alias tagy
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
  for (const d of prj.devices) names.set(d.name.toUpperCase(), (names.get(d.name.toUpperCase()) || 0) + 1);   // CODESYS nerozlišuje velikost
  for (const [n, c] of names) if (c > 1) out.push({ level: "error", where: n, msg: tr("Duplicitní označení zařízení.") });
  for (const d of prj.devices) {
    /* z označení vznikají jména instancí a povelů (instM1, manRun_M1) na všech platformách */
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(d.name))
      out.push({ level: "error", where: d.name, msg: tr("Označení zařízení musí být identifikátor — písmena bez diakritiky, číslice a _, na začátku písmeno (např. M1, Y2_A). Používá se v názvech instancí v kódu.") });
    /* Logix: jméno tagu max. 40 znaků, bez „__“ a bez „_“ na konci; nejdelší předpona je seqOpen_ / manOpen_ (8) */
    else if (d.name.length > 32 || /__/.test(d.name) || /_$/.test(d.name))
      out.push({ level: "error", where: d.name, msg: tr("Označení zařízení může mít nejvýš 32 znaků, bez „__“ a bez „_“ na konci — vznikají z něj jména jako seqOpen_<označení> a Rockwell Logix povoluje 40 znaků.") });
    if ((d.cls === "AnalogIn" || d.cls === "AnalogOut") && Number.isFinite(d.rmin) && Number.isFinite(d.rmax) && d.rmin >= d.rmax)
      out.push({ level: "error", where: d.name, msg: tr("Rozsah měření: minimum musí být menší než maximum.") });
    if (d.cls === "AnalogIn" && Number.isFinite(d.limLo) && Number.isFinite(d.limHi) && (d.limLo as number) >= (d.limHi as number))
      out.push({ level: "error", where: d.name, msg: tr("Mez min musí být menší než mez max — jinak je měření stále v poruše.") });
    if (d.cls === "AnalogOut" && Number.isFinite(d.setpoint) && Number.isFinite(d.rmin) && Number.isFinite(d.rmax) && d.rmin < d.rmax
      && ((d.setpoint as number) < d.rmin || (d.setpoint as number) > d.rmax))
      out.push({ level: "warn", where: d.name, msg: tr("Žádaná hodnota leží mimo rozsah výstupu.") });
  }
  /* FX5 (GX Works3): TON bere PT jen 0–32767 ms — delší výdrž / hlídací čas nebude fungovat správně */
  if (prj.platforms.includes("mitsubishi")) {
    for (const [i, s] of prj.program.seq.entries())
      if (Number.isFinite(s.timeS) && s.timeS > 32.767)
        out.push({ level: "warn", where: tr("krok {n}", { n: i + 1 }), msg: tr("Mitsubishi FX5: časovač TON bere nejvýš 32,767 s — krok s {t} s rozděl nebo v GX Works3 použij TIMER_100_FB_M.", { t: s.timeS }) });
  }
  const ADDR_RE: Record<Dir, RegExp> = { DI: /^%I\d+\.[0-7]$/, DO: /^%Q\d+\.[0-7]$/, AI: /^%IW\d+$/, AO: /^%QW\d+$/ };

  const tags = new Map<string, number>();
  const addrs = new Map<string, number>();
  for (const e of prj.io) {
    tags.set(e.tag.toUpperCase(), (tags.get(e.tag.toUpperCase()) || 0) + 1);   // CODESYS / Sysmac nerozlišují velikost
    if (e.addr) addrs.set(e.addr, (addrs.get(e.addr) || 0) + 1);
    if (e.addr && ADDR_RE[e.dir] && !ADDR_RE[e.dir].test(e.addr)) {
      out.push({ level: "warn", where: e.tag, msg: tr("Adresa {addr} neodpovídá směru {dir} v Siemens notaci (např. %I0.0, %Q0.0, %IW64, %QW64) — pro ostatní platformy se nepřevede.", { addr: e.addr, dir: e.dir }) });
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.tag) || /__/.test(e.tag)) {
      out.push({ level: "error", where: e.tag, msg: tr("Tag není platný identifikátor IEC 61131-3 (písmena bez diakritiky, číslice, jedno _) — žádná platforma ho nepřijme. Doporučeno: {tag}", { tag: sanitizeTag(e.tag) }) });
    } else if (e.tag !== sanitizeTag(e.tag)) {
      out.push({ level: "warn", where: e.tag, msg: tr("Tag obsahuje diakritiku/mezery — Rockwell, GX Works3 a Sysmac ho odmítnou. Doporučeno: {tag}", { tag: sanitizeTag(e.tag) }) });
    }
    if ((prj.platforms || []).includes("rockwell") && e.tag.length > 40) {
      out.push({ level: "error", where: e.tag, msg: tr("Tag je delší než 40 znaků — Rockwell Logix ho nepřijme.") });
    }
    if (RESERVED.has(e.tag.toUpperCase())) {
      out.push({ level: "error", where: e.tag, msg: tr("Tag koliduje s klíčovým slovem IEC 61131-3.") });
    }
    if ((e.dir === "AI" || e.dir === "AO")) {
      const m = e.addr.match(/^%[IQ]W(\d+)$/);
      if (m && (+m[1]) % 2 === 1) out.push({ level: "warn", where: e.addr, msg: tr("Analogová adresa by měla být sudá (slovo = 2 byty).") });
    }
  }
  for (const [t, c] of tags) if (c > 1) out.push({ level: "error", where: t, msg: tr("Duplicitní tag.") });
  for (const [a, c] of addrs) if (c > 1) out.push({ level: "error", where: a, msg: tr("Duplicitní adresa.") });
  return out;
}
