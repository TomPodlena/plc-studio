/**
 * PLCdesk — datový model návrhu a odvozování I/O.
 * Čistý TypeScript bez závislostí; logika přenesená z prototypu (artifact v8).
 */
import type { SolutionConcept } from "./concept.js";
import type { ApprovalRecord } from "./approval.js";
import type { CommissioningRecord } from "./commission.js";
import type { SafetyCfg } from "./safety.js";
import type { RevisionRecord } from "./revision.js";
import type { QuoteCfg } from "./quote.js";
import type { CompanyLibrary } from "./library.js";
import { N_, tr } from "./i18n.js";
import { newGuid, fillGuids, ioGuidFor, isGuid } from "./guid.js";
import { hwLayout, hwAssign, hwGroups, hwNative, hwIssues, type HwModule } from "./hardware.js";

export type PlatformKey =
  | "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron" | "unitronics"
  /* profily platformy CODESYS (PLAT[…].base = "codesys"): sdílí dialekt, addrFor a emulátor */
  | "wago" | "delta";

/** Styl generovaného kódu: klasické FB (výchozí) nebo OOP (rozhraní, dědičnost) — viz codegen_oop.ts. */
export type CodeStyle = "classic" | "oop";

export type DeviceClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "DI" | "DO"
  /* pohony a proporcionální prvky přes běžné I/O (fáze 2a) — viz CLAUDE.md „Pohony a polohování“ */
  | "Vfd" | "PosDrive" | "PropValve";
export type Dir = "DI" | "DO" | "AI" | "AO";
/**
 * Akce kroku: povel motoru / ventilu, výdrž, nebo čekání na digitální vstup (DI = TRUE / FALSE).
 * Měnič (Vfd): start (otáčky `sp`, směr `rev`) / stop; polohovací pohon (PosDrive): home
 * (referování) / posRecord (jízda na záznam `rec`); proporcionální ventil (PropValve):
 * setPressure / setFlow (žádaná hodnota `sp` — obě akce se chovají stejně, liší se popisem).
 */
export type SeqAct = "start" | "stop" | "open" | "close" | "wait" | "waitOn" | "waitOff"
  | "home" | "posRecord" | "setPressure" | "setFlow";
/** Vazba digitálního výstupu na stav stroje (generuje se do programu i do simulace). */
export type DoRole = "run" | "fault" | "ready" | "stopped" | "lock" | "auto";
export type SeqCond = "fbk" | "time";

export interface PlatformInfo {
  name: string; ide: string; cpu: string; lang: string; imp: string;
  /** Profil jiné platformy (WAGO, Delta AX = CODESYS V3.5): stejný dialekt, adresy i emulátor. */
  base?: PlatformKey;
  /** Platforma umí styl kódu OOP (INTERFACE / METHOD / PROPERTY / EXTENDS). */
  oop?: boolean;
}

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
  /**
   * Vfd / PropValve: rampa žádané hodnoty v PLC [s] na celý rozsah (rmin → rmax), po taktech
   * 0,1 s; 0 / bez zadání = bez rampy (rampu dělá měnič / ventil sám).
   */
  rampS?: number;
  /** PropValve se zpětnou vazbou: povolená odchylka skutečné hodnoty [jednotky] a doba [s], po které je odchylka porucha. */
  tol?: number;
  tolTimeS?: number;
  /** PosDrive: počet bitů výběru záznamu (1–6 → záznamy 1 … 2^n − 1; 0 = referenční poloha). */
  selBits?: number;
  /** PosDrive: tabulka záznamů (jen dokumentace — záznamy žijí v pohonu: poloha, rychlost). */
  records?: PosRecord[];
  /** PosDrive: model stroje pro simulaci — doba jízdy na záznam / referování [s]. */
  travelS?: number;
  /** typ z firemní knihovny (`LibDeviceType.id`, viz library.ts) */
  libType?: string;
  /** Trvalý identifikátor (viz guid.ts) — přidělen jednou při vzniku, export ho jen čte. */
  guid?: string;
}

export interface IoEntry {
  key: string;
  devId: number;
  sig: string;
  dir: Dir;
  tag: string;
  /**
   * Přidělený kanál jako kanonická adresa (Siemens notace, %I0.0 / %IW64) v sestavě hardwaru
   * platformy `prj.hw.plat` (hardware.ts). Výstupy čtou adresu ze sestavy (`addrFor`, `hwAddrText`).
   */
  addr: string;
  cmt: string;
  nc?: boolean;   // jen DI: rozpínací kontakt (bezpečnostní prvky)
  /** Trvalý identifikátor (viz guid.ts): odvozený z GUID zařízení a signálu při vzniku řádku. */
  guid?: string;
}

export interface SeqStep {
  dev: number; act: SeqAct; cond: SeqCond; timeS: number;
  /** Vfd start: žádané otáčky [jednotky zařízení]; PropValve: žádaná hodnota. Bez zadání = `Device.setpoint`. */
  sp?: number;
  /** Vfd start: směr vzad (výstup outRev). */
  rev?: boolean;
  /** PosDrive posRecord: číslo záznamu (1 … 2^selBits − 1). */
  rec?: number;
}
/** Záznam polohovacího pohonu (dokumentace tabulky v pohonu). */
export interface PosRecord { no: number; name: string; pos?: number; vel?: number; }
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
  /** Zvolený koncept řešení z AI nadstavby (viz concept.ts); null = zatím nezvolen. */
  concept?: SolutionConcept | null;
  /** Schválení položek návrhu (klíč = `ApprovalItem.key`, viz approval.ts). Bez záznamu = neschváleno. */
  approvals?: Record<string, ApprovalRecord>;
  /** Výsledky kroků oživení (klíč = `CommissioningStep.id`, viz commission.ts). */
  commissioning?: Record<string, CommissioningRecord>;
  /** Bezpečnostní funkce: parametry výpočtu, volby a úpravy návrhu (viz safety.ts). */
  safety?: SafetyCfg;
  /** Nabídka (interní): ceník, sazby, parametry odhadu hodin (viz quote.ts). */
  quote?: QuoteCfg;
  /** Kopie firemní knihovny (typy zařízení, šablony FB, hlavička; viz library.ts). */
  library?: CompanyLibrary;
  /** Revize projektu (nejstarší první): zmrazený obsah a stav schválení (viz revision.ts). */
  revisions?: RevisionRecord[];
  /** Trvalý identifikátor projektu (viz guid.ts) — přidělen v `blankProject`, export ho jen čte. */
  guid?: string;
  /**
   * GUID fyzických modulů sestavy (I/O karty, hlavy vzdálených stanic) podle klíče „S<stanice>.<slot>“
   * (hardware.ts `HwModule.key`, guid.ts). Starší klíče „<směr><pořadí>“ (DI1…) se při načtení převedou.
   */
  moduleGuids?: Record<string, string>;
  /**
   * Značka adres: `io[].addr` patří sestavě platformy `plat` podle pravidel verze `ver` (hardware.ts
   * `HW_VER`) — jen pak jsou připnutím. Chybí u starších projektů → adresy se přidělí znovu.
   */
  hw?: { plat: PlatformKey; ver: number };
  /**
   * Styl kódu (výchozí classic). OOP platí jen pro platformy s `PLAT[…].oop` (CODESYS, TwinCAT,
   * Schneider, WAGO, Delta AX); ostatní platformy ho ignorují. Chování programu je v obou
   * stylech stejné (stejný IR, stejné šablony bloků) — liší se jen zápis.
   */
  codeStyle?: CodeStyle;
}

export interface BomLineCfg { brand?: string; type?: string; orderCode?: string; supplier?: string; qty?: number; note?: string; }
export interface BomCfg {
  plat?: PlatformKey;
  brand?: Record<string, string>;
  lines?: Record<string, BomLineCfg>;
}

/**
 * Kanálová skupina modulu (modul × směr) ze sestavy hardware.ts — jeden list zapojení a jedna
 * svorkovnice X<n>. `ch[i]` je na kanálu `chNo[i]` modulu `hw`; `idx` = pořadí skupiny ve směru (DI1…).
 */
export interface IoModule {
  dir: Dir; idx: number; ch: IoEntry[];
  /** čísla kanálů modulu pro `ch` (stejná délka) */
  chNo?: number[];
  /** počet kanálů tohoto směru na modulu (katalog) */
  cap?: number;
  /** fyzický modul sestavy */
  hw?: HwModule;
  /** GUID fyzického modulu z `Project.moduleGuids` (klíč `hw.key`). */
  guid?: string;
}

export const PLAT: Record<PlatformKey, PlatformInfo> = {
  siemens:    { name: "Siemens SIMATIC", ide: "TIA Portal V17–V21", cpu: "S7-1200 / S7-1500", lang: "SCL", imp: N_("externí zdroje .scl + SimaticML XML (Openness) + TSV tagů") },
  rockwell:   { name: "Rockwell Allen-Bradley", ide: "Studio 5000", cpu: "CompactLogix / ControlLogix", lang: "ST", imp: N_("ST rutiny + CSV import tagů / L5X") },
  beckhoff:   { name: "Beckhoff", ide: "TwinCAT 3 (XAE)", cpu: "CX / C60xx IPC", lang: "ST", imp: N_("POU + GVL (vložit do editoru)"), oop: true },
  codesys:    { name: "CODESYS", ide: "CODESYS V3.5", cpu: "WAGO, Festo, Eaton…", lang: "ST", imp: N_("POU + GVL / PLCopen XML"), oop: true },
  mitsubishi: { name: "Mitsubishi", ide: "GX Works3", cpu: "MELSEC iQ-F / iQ-R", lang: "ST", imp: N_("ST program + global labels CSV") },
  schneider:  { name: "Schneider Electric", ide: "EcoStruxure Machine Expert", cpu: "Modicon M241 / M262", lang: "ST", imp: N_("POU + GVL (báze CODESYS)"), oop: true },
  omron:      { name: "OMRON", ide: "Sysmac Studio", cpu: "NX / NJ", lang: "ST", imp: N_("ST program + tabulka proměnných") },
  unitronics: { name: "Unitronics", ide: "UniLogic", cpu: "UniStream (US5–US15, USC)", lang: N_("ST (funkce)"), imp: N_("ST funkce k vložení + seznam tagů k založení; Vision/Samba jen Ladder (předloha)") },
  wago:       { name: "WAGO", ide: "e!COCKPIT / CODESYS V3.5", cpu: "PFC100 / PFC200 + I/O 750", lang: "ST", imp: N_("POU + GVL / PLCopen XML (báze CODESYS)"), base: "codesys", oop: true },
  delta:      { name: "Delta Electronics", ide: "DIADesigner-AX (CODESYS V3.5)", cpu: "AX-3 / AX-5 / AX-8", lang: "ST", imp: N_("POU + GVL / PLCopen XML (báze CODESYS)"), base: "codesys", oop: true },
};

/** Základ platformy: profil (WAGO, Delta AX) → „codesys“, jinak platforma sama. */
export function platBase(plat: PlatformKey): PlatformKey {
  return PLAT[plat]?.base || plat;
}
/** Rodina CODESYS (GVL_IO, PLCopen XML, adresy %IX / %IW): CODESYS a jeho profily, TwinCAT, Schneider. */
export function isCodesysFamily(plat: PlatformKey): boolean {
  const b = platBase(plat);
  return b === "codesys" || b === "beckhoff" || b === "schneider";
}
/** Platforma umí styl kódu OOP. */
export function supportsOop(plat: PlatformKey): boolean {
  return !!PLAT[plat]?.oop;
}
/** Styl kódu, který pro platformu skutečně platí (OOP jen kde ho platforma umí). */
export function codeStyleFor(prj: Project, plat: PlatformKey): CodeStyle {
  return prj.codeStyle === "oop" && supportsOop(plat) ? "oop" : "classic";
}

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
  Vfd:       { prefix: "M", label: N_("Frekvenční měnič (analogová žádaná)"), opts: {
    fbk: N_("hlášení otáčky dosaženy"), ready: N_("hlášení připraven"), fault: N_("vstup poruchy"),
    rev: N_("výstup směr vzad"), rst: N_("výstup kvitace měniče"), act: N_("analogový vstup skutečných otáček") } },
  PosDrive:  { prefix: "M", label: N_("Polohovací pohon se záznamy (I/O)"), opts: {
    ready: N_("hlášení připraven"), fault: N_("vstup poruchy"), rst: N_("výstup kvitace pohonu") } },
  PropValve: { prefix: "Y", label: N_("Proporcionální ventil (tlak / průtok)"), opts: { fbk: N_("analogová zpětná vazba skutečné hodnoty") } },
};

/** Pohony a proporcionální prvky fáze 2a (blok s analogovou žádanou / výběrem záznamu). */
export function isMotionClass(cls: DeviceClass): boolean { return cls === "Vfd" || cls === "PosDrive" || cls === "PropValve"; }
/** Třídy s analogovým rozsahem (rmin / rmax / jednotka). */
export function hasRange(cls: DeviceClass): boolean { return cls === "AnalogIn" || cls === "AnalogOut" || cls === "Vfd" || cls === "PropValve"; }

/** Akce kroku, které třída zařízení umí (UI editoru kroků, validace). `wait` nemá zařízení. */
export const ACTS_FOR: Record<DeviceClass, SeqAct[]> = {
  Motor: ["start", "stop"], Ventil: ["open", "close"], DI: ["waitOn", "waitOff"], DO: [], AnalogIn: [], AnalogOut: [],
  Vfd: ["start", "stop"], PosDrive: ["home", "posRecord"], PropValve: ["setPressure", "setFlow"],
};

/** Je akce proporcionálního ventilu (žádaná hodnota)? */
export function isSpAct(act: SeqAct): boolean { return act === "setPressure" || act === "setFlow"; }

/** Výchozí parametry nového zařízení třídy (UI „přidat zařízení“, AI návrhář). */
export function devDefaults(cls: DeviceClass): Partial<Device> {
  if (cls === "Vfd") return { unit: "Hz", rmin: 0, rmax: 50, setpoint: 50, rampS: 0, opt: { fbk: true, ready: true, fault: true } };
  if (cls === "PosDrive") return { unit: "", rmin: 0, rmax: 0, selBits: 3, travelS: 1, opt: { ready: true, fault: true },
    records: [{ no: 1, name: tr("poloha 1") }, { no: 2, name: tr("poloha 2") }] };
  if (cls === "PropValve") return { unit: "bar", rmin: 0, rmax: 10, setpoint: 0, rampS: 0, tol: 0.3, tolTimeS: 1, opt: { fbk: true } };
  return {};
}

/**
 * Označení přístroje, ke kterému vede signál (výkresy, kusovník, EPLAN): u měniče a polohovacího
 * pohonu řadič -TA<n> (svorky řídicích signálů jsou na řadiči, ne na motoru), jinak zařízení samo.
 */
export function devRef(d: { name: string; cls?: DeviceClass }): string {
  if (d.cls === "Vfd" || d.cls === "PosDrive") return "TA" + (d.name.replace(/^\D+/, "") || d.name);
  return d.name || "";
}

/** Tabulka záznamů PosDrive jako text pro editaci v UI: „1 = převzetí @ 0; 2 = lis @ 180“. */
export function recordsText(recs: PosRecord[] | undefined): string {
  return (recs || []).map(r => r.no + " = " + (r.name || "") + (Number.isFinite(r.pos) ? " @ " + r.pos : "")).join("; ");
}
/** Zpět z textu (řádky / středníky „číslo = název @ poloha“; poloha nepovinná). Neplatné části přeskočí. */
export function parseRecords(s: string): PosRecord[] {
  const out: PosRecord[] = [];
  for (const part of String(s || "").split(/[;\n]+/)) {
    const m = part.match(/^\s*(\d+)\s*[=:.\-]?\s*([^@]*?)\s*(?:@\s*(-?\d+(?:[.,]\d+)?))?\s*$/);
    if (!m) continue;
    const r: PosRecord = { no: +m[1], name: m[2].trim() };
    if (m[3] !== undefined) r.pos = +m[3].replace(",", ".");
    if (!out.some(x => x.no === r.no)) out.push(r);
  }
  return out.sort((a, b) => a.no - b.no);
}

/** Počet bitů výběru záznamu PosDrive (1–6, výchozí 3). */
export function selBitsOf(d: Device): number {
  const n = Math.round(Number(d.selBits));
  return Number.isFinite(n) && n >= 1 ? Math.min(6, n) : 3;
}
/** Nejvyšší číslo záznamu PosDrive (2^bity − 1; záznam 0 = referenční poloha). */
export function maxRecord(d: Device): number { return (1 << selBitsOf(d)) - 1; }
/** Doba jízdy PosDrive v modelu simulace [s] (výchozí 1 s). */
export function travelOf(d: Device): number { const t = Number(d.travelS); return Number.isFinite(t) && t > 0 ? t : 1; }
/**
 * Krok rampy v PLC na jeden takt 0,1 s [jednotky] (Vfd / PropValve); 0 = bez rampy.
 * Zaokrouhleno na 6 platných číslic — generátor píše tentýž literál, simulátor počítá s ním.
 */
export function rampStepOf(d: Device): number {
  const r = Number(d.rampS), span = Math.abs((d.rmax ?? 0) - (d.rmin ?? 0));
  if (!Number.isFinite(r) || r <= 0 || !span) return 0;
  return Number((span / (r * 10)).toPrecision(6));
}
/** Povolená odchylka PropValve [jednotky] (výchozí 3 % rozsahu). */
export function tolOf(d: Device): number {
  const t = Number(d.tol);
  return Number.isFinite(t) && t > 0 ? t : Math.abs((d.rmax ?? 0) - (d.rmin ?? 0)) * 0.03 || 0.1;
}
/** Doba odchylky PropValve, po které je porucha, v taktech 0,1 s (výchozí 1 s; nejméně 1 takt). */
export function tolTicksOf(d: Device): number {
  const t = Number(d.tolTimeS);
  return Math.max(1, Math.round((Number.isFinite(t) && t > 0 ? t : 1) * 10));
}
/** Žádaná hodnota kroku (Vfd start / PropValve): `sp` kroku, jinak výchozí žádaná zařízení. */
export function stepSp(s: SeqStep, d: Device | undefined): number {
  if (Number.isFinite(s.sp)) return s.sp as number;
  return d ? devSp(d) : 0;
}
/** Výchozí žádaná hodnota zařízení (ruční režim, po přerušení sekvence): `setpoint`, jinak 0 / rmin. */
export function devSp(d: Device): number {
  if (Number.isFinite(d.setpoint)) return d.setpoint as number;
  return d.cls === "PropValve" && Number.isFinite(d.rmin) ? d.rmin : 0;
}

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
    concept: null,
    guid: newGuid(),
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
  else if (d.cls === "Vfd") {
    if (o.ready !== false) s.push(["ready", "DI", tr("měnič připraven")]);
    if (o.fbk !== false) s.push(["atSpeed", "DI", tr("otáčky dosaženy")]);
    if (o.fault !== false) s.push(["fault", "DI", tr("porucha měniče")]);
    s.push(["outRun", "DO", tr("povel chod")]);
    if (o.rev) s.push(["outRev", "DO", tr("směr vzad")]);
    if (o.rst) s.push(["outReset", "DO", tr("kvitace měniče")]);
    s.push(["rawSpeed", "AO", tr("žádané otáčky") + (d.unit ? " [" + d.unit + "]" : "")]);
    if (o.act) s.push(["rawAct", "AI", tr("skutečné otáčky") + (d.unit ? " [" + d.unit + "]" : "")]);
  } else if (d.cls === "PosDrive") {
    if (o.ready !== false) s.push(["ready", "DI", tr("pohon připraven")]);
    s.push(["inPos", "DI", tr("v poloze (pohyb dokončen)")]);
    s.push(["homed", "DI", tr("referováno")]);
    if (o.fault !== false) s.push(["fault", "DI", tr("porucha pohonu")]);
    s.push(["outEnable", "DO", tr("povolení pohonu")]);
    s.push(["outStart", "DO", tr("start jízdy na záznam")]);
    s.push(["outHome", "DO", tr("referenční jízda")]);
    s.push(["outHalt", "DO", tr("zastavení pohybu (HALT)")]);
    for (let k = 0; k < selBitsOf(d); k++) s.push(["outSel" + k, "DO", tr("výběr záznamu bit {k}", { k })]);
    if (o.rst) s.push(["outReset", "DO", tr("kvitace pohonu")]);
  } else if (d.cls === "PropValve") {
    s.push(["rawSp", "AO", tr("žádaná hodnota") + (d.unit ? " [" + d.unit + "]" : "")]);
    if (o.fbk !== false) s.push(["rawAct", "AI", tr("skutečná hodnota") + (d.unit ? " [" + d.unit + "]" : "")]);
  }
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
    /* nové zařízení dostane GUID hned (z něj se odvozují GUID jeho signálů) */
    if (!isGuid(d.guid)) d.guid = newGuid();
    for (const [sig, dir, lbl] of devSignals(d)) {
      const key = d.id + ":" + sig;
      const old = prj.io.find(e => e.key === key);
      fresh.push(old || {
        key, devId: d.id, sig, dir,
        tag: d.name + "_" + sig,
        addr: "",
        cmt: [d.desc, lbl].filter(Boolean).join(" – "),   // DI/DO bez popisku signálu: bez visící pomlčky
        nc: dir === "DI" && /\bNC\b/i.test(d.desc || ""),
        guid: ioGuidFor(d.guid, sig),
      });
    }
  }
  prj.io = fresh;
  autoAddr(prj, false);
  ensureGuids(prj);
}

/**
 * Doplní chybějící GUID projektu, zařízení, I/O karet a signálů (viz guid.ts); platné nemění.
 * Vrací true, když něco doplnila — při načtení starého projektu ho volající označí jako změněný.
 * Export GUID nikdy negeneruje (jen čte); volá se při vzniku objektů (`syncIO`) a při načtení.
 */
export function ensureGuids(prj: Project): boolean {
  return fillGuids(prj, hwLayout(prj).modules);
}

/**
 * Přidělí adresy podle sestavy hardwaru (hardware.ts `hwAssign`): nové signály dostanou volný kanál,
 * připnuté a cizí adresy zůstanou; `force` = přečíslovat vše (pořadí signálů zůstane).
 */
export function autoAddr(prj: Project, force: boolean): void {
  hwAssign(prj, force);
}

export function dtFor(e: IoEntry): "BOOL" | "INT" {
  return (e.dir === "AI" || e.dir === "AO") ? "INT" : "BOOL";
}

/** Adresa signálu v notaci cílové platformy — kanál sestavy hardwaru platformy (hardware.ts). */
export function addrFor(plat: PlatformKey, e: IoEntry, prj: Project): string {
  return hwNative(prj, plat, e);
}

/** Převod kanonické (Siemens) adresy `a` signálu směru `dir` na notaci cílové platformy. */
export function nativeAddr(plat: PlatformKey, a: string, dir: Dir): string {
  a = a || "";
  if (plat === "siemens") return a;
  /* TwinCAT: pevné adresy nedoporučuje — AT %I* / %Q* a nalinkování na kanály svorek */
  if (plat === "beckhoff") return dir === "DI" || dir === "AI" ? "%I*" : "%Q*";
  /* WAGO e!COCKPIT: kanály lokální sběrnice se v I/O mapování přiřazují proměnným (obraz procesu
     řadí analogy před digitály, adresy se mění s osazením) — v kódu bez pevné adresy AT */
  if (plat === "wago") return "";
  /* Delta AX (DIADesigner-AX): notace CODESYS; počáteční adresy BuiltIn IO / LocalBus neověřeny (README) */
  if (plat === "codesys" || plat === "schneider" || platBase(plat) === "codesys") {
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

/**
 * Číslo vodiče kanálu: stovky = svorkovnice X<n> (pořadí kanálové skupiny z `modules()`), zbytek =
 * svorka X<n>:<k> — X1:1 → -W101, X2:3 → -W203, X10:1 → -W1001. Unikátní v celém projektu (skupina
 * má nejvýš 16 kanálů) a stabilní: změna jednoho modulu nepřečísluje vodiče ostatních.
 * Jediný zdroj pro výkresy (SVG/DXF), seznam svorek dokumentace a export EPLAN.
 */
export function wireNo(xnum: number, ch: number): string {
  return "-W" + (xnum * 100 + ch + 1);
}

/**
 * Kanálové skupiny modulů sestavy hardwaru (hardware.ts): vestavěné I/O CPU, karty lokálního racku
 * a vzdálených stanic, po směrech — pro schémata, svorkovnice a FDS. Počty a typy = kusovník.
 */
export function modules(prj: Project): IoModule[] {
  return hwGroups(prj);
}

/* --------------------------------------------------- validace & sanitizace */

export interface ValidationIssue {
  /** info = jen upozornění na způsob řešení (nic není potřeba opravit) */
  level: "error" | "warn" | "info";
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
    if (hasRange(d.cls) && Number.isFinite(d.rmin) && Number.isFinite(d.rmax) && d.rmin >= d.rmax)
      out.push({ level: "error", where: d.name, msg: tr("Rozsah měření: minimum musí být menší než maximum.") });
    if ((d.cls === "Vfd" || d.cls === "PropValve") && Number.isFinite(d.setpoint) && Number.isFinite(d.rmin) && Number.isFinite(d.rmax) && d.rmin < d.rmax
      && ((d.setpoint as number) < d.rmin || (d.setpoint as number) > d.rmax))
      out.push({ level: "warn", where: d.name, msg: tr("Žádaná hodnota leží mimo rozsah výstupu.") });
    if (d.cls === "PosDrive" && d.selBits !== undefined && (!Number.isInteger(d.selBits) || d.selBits < 1 || d.selBits > 6))
      out.push({ level: "error", where: d.name, msg: tr("Počet bitů výběru záznamu musí být 1 až 6.") });
    if ((d.cls === "Vfd" || d.cls === "PropValve") && d.rampS !== undefined && !(Number(d.rampS) >= 0))
      out.push({ level: "error", where: d.name, msg: tr("Rampa musí být 0 (bez rampy) nebo kladný čas v sekundách.") });
    if (d.cls === "PropValve" && d.opt?.fbk !== false && d.tol !== undefined && !(Number(d.tol) > 0))
      out.push({ level: "error", where: d.name, msg: tr("Povolená odchylka proporcionálního ventilu musí být kladná.") });
    if (d.cls === "AnalogIn" && Number.isFinite(d.limLo) && Number.isFinite(d.limHi) && (d.limLo as number) >= (d.limHi as number))
      out.push({ level: "error", where: d.name, msg: tr("Mez min musí být menší než mez max — jinak je měření stále v poruše.") });
    if (d.cls === "AnalogOut" && Number.isFinite(d.setpoint) && Number.isFinite(d.rmin) && Number.isFinite(d.rmax) && d.rmin < d.rmax
      && ((d.setpoint as number) < d.rmin || (d.setpoint as number) > d.rmax))
      out.push({ level: "warn", where: d.name, msg: tr("Žádaná hodnota leží mimo rozsah výstupu.") });
  }
  /* kroky pohonů a proporcionálních prvků: akce musí patřit třídě, záznam a žádaná hodnota v rozsahu */
  for (const [i, s] of prj.program.seq.entries()) {
    const d = devById(prj, s.dev);
    const where = tr("krok {n}", { n: i + 1 });
    const newAct = s.act === "home" || s.act === "posRecord" || isSpAct(s.act);
    if (!d) continue;
    if ((newAct || isMotionClass(d.cls)) && !ACTS_FOR[d.cls].includes(s.act))
      out.push({ level: "error", where, msg: tr("Akce „{act}“ neplatí pro zařízení {dev} ({cls}).", { act: s.act, dev: d.name, cls: tr(CLS[d.cls].label) }) });
    else if (d.cls === "PosDrive" && s.act === "posRecord" && !(Number.isInteger(s.rec) && (s.rec as number) >= 1 && (s.rec as number) <= maxRecord(d)))
      out.push({ level: "error", where, msg: tr("Číslo záznamu {dev} musí být 1 až {max} (záznam 0 = referenční poloha, jede se na ni akcí home).", { dev: d.name, max: maxRecord(d) }) });
    else if ((d.cls === "Vfd" && s.act === "start" || d.cls === "PropValve") && Number.isFinite(s.sp) && d.rmin < d.rmax && ((s.sp as number) < d.rmin || (s.sp as number) > d.rmax))
      out.push({ level: "warn", where, msg: tr("Žádaná hodnota kroku leží mimo rozsah {dev} ({min}–{max} {unit}).", { dev: d.name, min: d.rmin, max: d.rmax, unit: d.unit || "" }) });
  }
  /* FX5 (GX Works3): TON bere PT jen 0–32 767 ms → delší čas kroku generátor píše časovačem
     TIMER_100_FB_M (předvolba INT × 100 ms, tj. nejvýš 3 276,7 s) — codegen.ts `fx5Timer100` */
  if (prj.platforms.includes("mitsubishi")) {
    for (const [i, s] of prj.program.seq.entries()) {
      if (!Number.isFinite(s.timeS) || Math.round(s.timeS * 1000) <= 32767) continue;
      const where = tr("krok {n}", { n: i + 1 });
      if (Math.ceil(Math.round(s.timeS * 1000) / 100) > 32767)
        out.push({ level: "warn", where, msg: tr("Mitsubishi FX5: krok s {t} s je delší i než rozsah časovače TIMER_100_FB_M (3 276,7 s) — rozděl ho na víc kroků.", { t: s.timeS }) });
      else
        out.push({ level: "info", where, msg: tr("Mitsubishi FX5: krok s {t} s je delší než rozsah TON (32,767 s) — kód pro FX5 použije časovač TIMER_100_FB_M s rozlišením 100 ms.", { t: s.timeS }) });
    }
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
  /* sestava hardwaru: projekt se do platformy nevejde, cizí adresy, nepasující volby modulů */
  out.push(...hwIssues(prj));
  return out;
}
