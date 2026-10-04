/**
 * PLCdesk — simulace procesu a ověření programu.
 *
 * Simulátor provádí scan po scanu STEJNOU logiku, jakou generuje codegen.ts
 * (šablony FB_Motor / FB_Ventil, sekvence CASE, porucha stroje a kvitace;
 * pořadí: enable → sekvence → časovače sekvence → instance zařízení → porucha),
 * proti jednoduchému modelu stroje (rozběh motoru, přestavení ventilu).
 * Slouží k ověření NÁVRHU: že cyklus doběhne, jak dlouho trvá a co program
 * udělá při poruše nebo E-stopu.
 *
 * Co neověřuje: kód přeložený v cílovém IDE, HW konfiguraci, bezpečnostní
 * funkce. Nenahrazuje test v simulátoru platformy ani FAT.
 */
import {
  Project, Device, IoEntry, SeqStep, CLS, devById, ioOf, enableInputs, interlockDevs, isDiWait, roleExpr,
  isMotionClass, rampStepOf, tolOf, tolTicksOf, travelOf, devSp, stepSp, isSpAct, instName,
} from "./model.js";
import { seqCond, SeqCondition, limitedAnalogs, motionSeqVars, seqMotionDevs, motionStepSets } from "./codegen.js";
import type { IrExpr, IrSet } from "./ir.js";
import { tr, N_, getLang } from "./i18n.js";

/** Timeouty šablon — musí odpovídat T#3S / T#5S v Gen_Library (hlídá test). */
export const T_MOTOR_FBK = 3;
export const T_VALVE_TRAVEL = 5;
/** Pohony fáze 2a — časy šablon FB_Vfd / FB_PosDrive / FB_PropValve (hlídá test). */
export const T_TICK = 0.1;          // takt rampy a počítání odchylky (T#100MS)
export const T_VFD_SPEED = 5;       // otáčky po doběhu rampy (T#5S)
export const T_POS_SEL = 0.1;       // výběr záznamu ustálený před startem (T#100MS)
export const T_POS_ACK = 1;         // potvrzení startu / referování (T#1S)
export const T_POS_MOVE = 30;       // jízda / referování (T#30S)
export const T_PROP_SETTLE = 5;     // žádaná dosažena po doběhu rampy (T#5S)
/** Předvolby časovačů bloků pohonů podle jména v `MotionState.tons` (emulátor: horizont a přeskočení klidu). */
export const MOTION_TON_PT: Record<string, number> = { tick: T_TICK, fbk: T_VFD_SPEED, sel: T_POS_SEL, ack: T_POS_ACK, move: T_POS_MOVE, settle: T_PROP_SETTLE };
/** Kódy chyb bloků pohonů (errCode) — shodné se šablonami a s dokumentací. */
export const MOTION_ERR: Record<number, string> = {
  1: N_("porucha pohonu"), 2: N_("pohon nepřipraven"), 3: N_("bez referování"), 4: N_("ztráta hlášení"), 5: N_("timeout"), 6: N_("odchylka skutečné hodnoty"),
};
/** Nejdelší vnitřní timeout bloků (pro meze scénářů): ventil 5 s, pohony až 30 s jízdy (tu ale hlídá čas kroku). */
const fr = Math.fround;

/** Zásahy scénáře v čase: poruchy stroje a úkony obsluhy. */
export type SimFault =
  /** Od `at` (do `until`) zamrznou zpětná hlášení zařízení (vadný snímač, zaseknutý pohon, slepený stykač). */
  | { kind: "frozen"; dev: number; at: number; until?: number }
  /** Od `at` (do `until`) je aktivní vstup poruchy motoru (vybavený jistič). */
  | { kind: "fault"; dev: number; at: number; until?: number }
  /** Stisk nouzového zastavení v čase `at`, uvolnění v `release` (jinak zůstane stisknuté). */
  | { kind: "estop"; at: number; release?: number }
  /** Od `at` (do `until`) je vypnutý režim AUTO (přepnutí do ručního režimu). */
  | { kind: "manual"; at: number; until?: number }
  /** Od `at` (do `until`) chybí hlášení chodu motoru / koncák „otevřeno" ventilu (vstup vnucen na FALSE). */
  | { kind: "lost"; dev: number; at: number; until?: number }
  /** Od `at` (do `until`) má analogový vstup surovou hodnotu `raw` (např. nad horní mezí). */
  | { kind: "analog"; dev: number; at: number; until?: number; raw: number }
  /** Od `at` (do `until`) je zapnutý ruční povel zařízení (manRun_X / manOpen_X). */
  | { kind: "man"; dev: number; at: number; until?: number }
  /** Od `at` (do `until`) je rozpojený blokovací vstup zařízení (otevřený kryt, přerušená závora). */
  | { kind: "interlock"; dev: number; at: number; until?: number }
  /** Stisk kvitace poruchy v čase `at`. */
  | { kind: "ack"; at: number }
  /** Další stisk tlačítka start v čase `at`. */
  | { kind: "start"; at: number };

export interface SimOptions {
  /** Perioda scanu [s]. */
  dt?: number;
  /** Doba, za kterou motor po sepnutí (vypnutí) nahlásí běh (klid) [s]. */
  motorDelay?: number;
  /** Doba přestavení ventilu / válce mezi koncovými polohami [s]. */
  valveTravel?: number;
  /** Čas stisku tlačítka start [s]. */
  startAt?: number;
  /** Strop simulace [s]; bez zadání se odhadne z kroků sekvence. */
  maxTime?: number;
  faults?: SimFault[];
}

export interface SimDevState {
  /** Krok stavového automatu bloku (0/10/20/30/90); -1 = blokováno (enable = FALSE). */
  step: number;
  label: string;
  error: boolean;
  busy: boolean;
  /** Model stroje: 0..1 = rozběh motoru / poloha ventilu (0 zavřeno, 1 otevřeno); měnič = otáčky / rozsah, ventil = skutečná / rozsah, pohon = postup jízdy. */
  pos: number;
  /** Pohony fáze 2a: skutečná hodnota v jednotkách (otáčky, tlak), žádaná po rampě, záznam v poloze (−1 = neznámý), kód chyby. */
  value?: number;
  cmd?: number;
  rec?: number;
  errCode?: number;
  /** PosDrive: blok hlásí dokončenou jízdu (done). */
  done?: boolean;
}

export interface SimFrame {
  t: number;
  /** Index kroku sekvence; -1 = klid (čekání na start). */
  step: number;
  enable: boolean;
  /** Porucha stroje drží (do kvitace) a krok, ve kterém vypršel čas (index, jinak null). */
  fault: boolean;
  faultStep: number | null;
  dev: Record<number, SimDevState>;
  io: Record<string, boolean | number>;
}

export interface SimEvent {
  t: number;
  kind: "seq" | "dev" | "err" | "info";
  msg: string;
  step?: number;
  dev?: number;
}

export interface SimStepRun { i: number; tStart: number; tEnd: number | null; }

export interface SimResult {
  /** Cyklus doběhl do konce bez poruchy stroje i bloků. */
  ok: boolean;
  finished: boolean;
  /** Doba cyklu od startu po návrat do klidu [s]. */
  cycleTime: number | null;
  /** Index kroku, ve kterém sekvence zůstala stát (null = nestojí). */
  stalledStep: number | null;
  /** Nastala porucha stroje; čas, příčina a krok první poruchy; zda na konci ještě drží. */
  faulted: boolean;
  faultT: number | null;
  faultCause: string;
  faultStep: number | null;
  fault: boolean;
  steps: SimStepRun[];
  events: SimEvent[];
  /** Snímky stavu — jen v okamžicích změny. */
  frames: SimFrame[];
  /** Zařízení, která během běhu přešla do poruchy. */
  errors: Array<{ dev: number; t: number }>;
  /** Počet dokončených cyklů a doba posledního z nich [s]. */
  cycles: number;
  lastCycleTime: number | null;
  /** Klíče výstupů (DO) sepnutých na konci simulace. */
  outputsOn: string[];
  tEnd: number;
  opts: Required<Omit<SimOptions, "maxTime" | "faults">> & { maxTime: number; faults: SimFault[] };
}

/* Popisky stavů bloků — klíče překladu, překládají se až při použití (devState). */
const MOTOR_LABEL: Record<number, string> = { 0: N_("klid"), 10: N_("rozběh"), 20: N_("běží"), 90: N_("porucha") };
const VALVE_LABEL: Record<number, string> = { 0: N_("zavřeno"), 10: N_("otevírá"), 20: N_("otevřeno"), 30: N_("zavírá"), 90: N_("porucha") };
const VFD_LABEL: Record<number, string> = { 0: N_("klid"), 10: N_("rozběh / změna otáček"), 20: N_("otáčky dosaženy"), 90: N_("porucha") };
const POS_LABEL: Record<number, string> = { 0: N_("stojí"), 10: N_("výběr záznamu"), 20: N_("start"), 30: N_("jede"), 40: N_("start referování"), 45: N_("referuje"), 90: N_("porucha") };
const PROP_LABEL: Record<number, string> = { 0: N_("vypnuto"), 10: N_("rampa"), 20: N_("v toleranci"), 90: N_("porucha") };

/** Časovač TON volaný jednou za scan. */
class Ton {
  et = 0; q = false; private prev = false;
  call(input: boolean, pt: number, dt: number): boolean {
    if (!input) { this.et = 0; this.q = false; }
    else { this.et = this.prev ? this.et + dt : 0; this.q = this.et >= pt - 1e-9; }
    this.prev = input;
    return this.q;
  }
  clone(): Ton {
    const t = new Ton();
    t.et = this.et; t.q = this.q; t.prev = this.prev;
    return t;
  }
}

interface FbInst {
  d: Device; io: Record<string, IoEntry>; auto: boolean;
  step: number; lastA: boolean; lastB: boolean; lastR: boolean; ton: Ton; ton2: Ton;
  out: boolean; busy: boolean; error: boolean; blocked: boolean;
  /** pohony fáze 2a: stav bloku (FB_Vfd / FB_PosDrive / FB_PropValve) a model pohonu */
  x?: MotionState;
}

/**
 * Stav bloku pohonu fáze 2a (zrcadlo šablony: `v` = proměnné bloku stejného jména, REAL ve float32
 * jako v PLC) a model pohonu (`m`: otáčky / poloha / skutečný tlak). Časovače `tons` podle jmen šablony.
 */
interface MotionState {
  tons: Record<string, Ton>;
  last: Record<string, boolean>;
  v: Record<string, number | boolean>;
  m: Record<string, number | boolean>;
}

const round = (t: number) => Math.round(t * 1000) / 1000;
/** Model procesu: za jak dlouho po vstupu do kroku „čekat na vstup" přijde očekávaný stav [s]. */
export const DI_DELAY = 0.5;

/** Hodnota výstupu s vazbou na stav stroje — zrcadlo `roleExpr` z generátoru. */
function roleValue(role: NonNullable<Device["role"]>, hasSeq: boolean, s: { seqStep: number; machineFault: boolean; enable: boolean; modeAuto: boolean }): boolean {
  const running = hasSeq && s.seqStep !== 0;
  switch (role) {
    case "run": case "lock": return running;
    case "fault": return s.machineFault;
    case "ready": return s.enable && !s.machineFault && (!hasSeq || (s.modeAuto && s.seqStep === 0));
    case "stopped": return !s.enable;
    case "auto": return hasSeq && s.modeAuto;
  }
}
const round1 = (t: number) => Math.round(t * 10) / 10;
/** Surová hodnota analogu v rozsahu modulu 0..27648. */
const clampRaw = (v: unknown) => Math.min(27648, Math.max(0, Math.round(+(v as number) || 0)));

/**
 * Počáteční stav bloku pohonu fáze 2a (proměnné jako po zapnutí PLC: 0 / FALSE) a modelu pohonu:
 * měnič stojí a je připraven, pohon stojí v poloze (v poloze = TRUE), ale není referovaný,
 * ventil bez tlaku. Zapíše i počáteční hodnoty vstupů do `io`.
 */
function motionInit(d: Device, dio: Record<string, IoEntry>, io: Record<string, boolean | number>): MotionState {
  const span = (d.rmax - d.rmin) || 1;
  const set = (sig: string, val: boolean | number) => { if (dio[sig]) io[dio[sig].key] = val; };
  set("ready", true);
  set("fault", false);
  if (d.cls === "Vfd") {
    set("atSpeed", false);
    set("rawAct", clampRaw((0 - d.rmin) / span * 27648));
    return { tons: { tick: new Ton(), fbk: new Ton() }, last: { run: false, stop: false, reset: false },
      v: { outRun: false, outRev: false, outReset: false, speedCmd: 0, spLast: 0, revLast: false, inSpeed: false, errCode: 0, frac: 0 },
      m: { spd: 0, dir: false } };
  }
  if (d.cls === "PosDrive") {
    set("inPos", true);
    set("homed", false);
    return { tons: { sel: new Ton(), ack: new Ton(), move: new Ton() }, last: { home: false, move: false, reset: false },
      v: { outEnable: false, outStart: false, outHome: false, outHalt: false, outReset: false, outSel0: false, outSel1: false, outSel2: false,
        outSel3: false, outSel4: false, outSel5: false, actRec: 0, done: false, halted: false, errCode: 0 },
      m: { pos: -1, mv: false, mvT: 0, mvRec: 0, mvHome: false, homed: false, inPos: true, pStart: false, pHome: false } };
  }
  set("rawAct", 0);
  return { tons: { tick: new Ton(), settle: new Ton() }, last: { on: false, reset: false },
    v: { spAct: 0, value: d.rmin, target: 0, spLast: 0, devCnt: 0, inTol: false, errCode: 0, frac: 0 },
    m: { act: d.rmin } };
}

export function stepTitle(prj: Project, s: SeqStep): string {
  if (s.act === "wait") return tr("výdrž {t} s", { t: s.timeS || 1 });
  const d = devById(prj, s.dev);
  const dev = d ? d.name : "?";
  if (d && d.cls === "Vfd" && s.act === "start") {
    const p = { dev, sp: stepSp(s, d), unit: d.unit || "" };
    return (s.rev && d.opt?.rev ? tr("{dev} start vzad {sp} {unit}", p) : tr("{dev} start {sp} {unit}", p)).trim();
  }
  if (s.act === "home") return tr("{dev} referenční jízda", { dev });
  if (s.act === "posRecord") {
    const r = d?.records?.find(x => x.no === s.rec);
    return tr("{dev} jízda na záznam {rec}", { dev, rec: s.rec ?? "?" }) + (r && r.name ? " (" + r.name + ")" : "");
  }
  if (s.act === "setPressure") return tr("{dev} tlak {sp} {unit}", { dev, sp: stepSp(s, d), unit: d?.unit || "" }).trim();
  if (s.act === "setFlow") return tr("{dev} průtok {sp} {unit}", { dev, sp: stepSp(s, d), unit: d?.unit || "" }).trim();
  if (s.act === "start") return tr("{dev} start", { dev });
  if (s.act === "stop") return tr("{dev} stop", { dev });
  if (s.act === "open") return tr("{dev} otevřít", { dev });
  if (s.act === "close") return tr("{dev} zavřít", { dev });
  if (s.act === "waitOn") return tr("čekat na {dev}", { dev });
  if (s.act === "waitOff") return tr("čekat na {dev} = FALSE", { dev });
  return dev + " " + s.act;
}

/** Podmínka přechodu kroku tak, jak ji generuje seqBody (text pro diagramy). */
export function stepCondText(prj: Project, s: SeqStep): string {
  const c = seqCond(prj, s);
  if (c.kind === "time") return tr("po {t} s", { t: s.timeS || 1 });
  if (c.kind === "fbk" && c.expr) return exprText(c.expr);
  if (c.kind === "fbk") return (c.neg ? "NOT " : "") + c.io!.tag;
  const d = devById(prj, s.dev);
  if (isDiWait(s)) return tr("ihned — zařízení není digitální vstup");
  return d && (d.cls === "Motor" || d.cls === "Vfd") ? tr("ihned — bez zpětného hlášení") : d && d.cls === "Ventil" ? tr("ihned — bez koncového snímače") : tr("ihned");
}

/** Výraz podmínky (výstupy instance) jako text: `instM5.inSpeed`, `instM6.done AND instM6.actRec = 2`. */
function exprText(e: IrExpr): string {
  switch (e.k) {
    case "bool": return e.v ? "TRUE" : "FALSE";
    case "int": case "real": return String(e.v);
    case "var": return e.name;
    case "io": return e.tag;
    case "member": return e.inst + "." + e.port;
    case "not": return "NOT " + exprText(e.e);
    case "and": return e.args.map(exprText).join(" AND ");
    case "or": return e.args.map(exprText).join(" OR ");
    case "cmp": return exprText(e.a) + " " + e.op + " " + exprText(e.b);
    case "paren": return "(" + exprText(e.e) + ")";
  }
}

/** Hlídací čas kroku [s] — jen u přechodu na zpětné hlášení; jinak null. */
export function stepWatchdog(prj: Project, s: SeqStep): number | null {
  return seqCond(prj, s).kind === "fbk" ? (s.timeS || 1) : null;
}

/** Vnější zásahy do běžící simulace — tlačítka obsluhy a vnucené poruchy. */
export interface SimControls {
  /** Přepínač režimu AUTO (FALSE = ruční režim). */
  modeAuto: boolean;
  /** Tlačítko start drženo (jednorázový stisk viz `Simulator.pressStart`). */
  start: boolean;
  /** Tlačítko kvitace poruchy drženo (jednorázový stisk viz `Simulator.pressAck`). */
  ack: boolean;
  /** Nouzové zastavení stisknuto. */
  estop: boolean;
  /** Ruční povely zařízení (manRun_X / manOpen_X podle id) — platí při vypnutém AUTO. */
  man: Record<number, boolean>;
  /** Zařízení se zamrzlým zpětným hlášením (vadný snímač, zaseknutý pohon). */
  frozen: number[];
  /** Motory s aktivním vstupem poruchy (vybavený jistič). */
  fault: number[];
  /** Ruční hodnoty volných digitálních vstupů (klíč I/O → hodnota). */
  di: Record<string, boolean>;
  /** Ruční surové hodnoty analogových vstupů (klíč I/O → 0..27648). */
  ai: Record<string, number>;
  /**
   * Vnucené hodnoty vstupů (klíč I/O → hodnota, jak ji čte program): přebijí model stroje
   * i ostatní zásahy, dokud se klíč neodebere. Digitální vstup boolean, analogový 0..27648.
   * Model stroje běží pod vnucenou hodnotou dál — po uvolnění se vstup vrátí k jeho stavu.
   */
  force: Record<string, boolean | number>;
}

/**
 * Krokovatelný simulátor: jeden `scan()` = jeden scan programu + reakce stroje.
 * Dávková `simulate()` i živá simulace v aplikaci používají tento jediný kód.
 */
export class Simulator {
  t = 0;
  readonly dt: number;
  readonly motorDelay: number;
  readonly valveTravel: number;
  readonly controls: SimControls = { modeAuto: true, start: false, ack: false, estop: false, man: {}, frozen: [], fault: [], di: {}, ai: {}, force: {} };
  readonly events: SimEvent[] = [];
  readonly frames: SimFrame[] = [];
  readonly steps: SimStepRun[] = [];
  readonly errors: Array<{ dev: number; t: number }> = [];
  /** Počet dokončených cyklů a doba prvního / posledního z nich [s]. */
  cycles = 0;
  firstCycleTime: number | null = null;
  lastCycleTime: number | null = null;
  /** Čas dokončení posledního cyklu a zda se sekvence kdy rozběhla. */
  tDone = 0;
  everStarted = false;
  /** Porucha stroje (machineFault) a první porucha od začátku simulace. */
  machineFault = false;
  faultCount = 0;
  firstFault: { t: number; cause: string; step: number | null } | null = null;

  private readonly record: boolean;
  private readonly io: Record<string, boolean | number> = {};
  /** Vstupy podle stroje (model + zásahy obsluhy); `io` z nich vzniká po uplatnění `controls.force`. */
  private readonly model: Record<string, boolean | number> = {};
  private readonly inputs: IoEntry[];
  private readonly forced: Record<string, boolean | number> = {};
  private readonly estopIo: IoEntry | undefined;
  /** Blokovací vstupy (kryty, závory…) — součást enable; poslední hlášený stav. */
  private readonly ilIo: Array<{ dev: Device; io: IoEntry }>;
  private readonly ilPrev: Record<string, boolean> = {};
  private readonly insts: FbInst[] = [];
  private readonly plant: Record<number, number> = {};
  private readonly inSeq: Set<number>;
  private readonly seqVar: Record<number, boolean> = {};   // seqRun_X / seqOpen_X podle id zařízení
  private readonly tonSeq: Record<number, Ton> = {};
  private readonly ioKeys: string[];
  private readonly freeDi: Set<string>;
  private readonly aiKeys: Set<string>;
  private seqStep = 0;                                      // 0, 10, 20… jako v generovaném kódu
  private faultStep = 0;                                    // faultStep z generovaného kódu
  private inCycle = false;
  private cycleStart = 0;
  private startUntil = -1;
  private ackUntil = -1;
  /** Změna stavu od posledního snímku (krok, porucha, bloky, I/O) — snímek jen při změně. */
  private chg = true;
  /** Vstupy, jejichž hodnota podle stroje se změnila od posledního promítnutí do `io`. */
  private dirty = new Set<string>();
  private nForced = 0;
  /** Předpočítané zařízení a podmínka přechodu každého kroku (projekt se během simulace nemění). */
  private readonly stepDev: Array<Device | undefined>;
  private readonly stepCond: SeqCondition[];
  /** Analogy s mezemi (zrcadlo FB_AnalogIn: hodnota v jednotkách, alarm nad / pod mezí). */
  private readonly analogs: Array<{ d: Device; key: string; hi?: number; lo?: number }>;
  private alarmPrev: Record<string, string> = {};
  /** Výstupy s vazbou na stav stroje. */
  private readonly roles: Array<{ key: string; role: NonNullable<Device["role"]> }>;
  /** Klidové hodnoty DI, na které čeká sekvence (proces je po kroku vrací). */
  private readonly diRest: Record<string, boolean> = {};
  /** Povely sekvence pohonů fáze 2a podle jména proměnné (seqSpd_M5, seqRec_M6…; REAL ve float32). */
  private readonly mseq: Record<string, number | boolean> = {};
  /** Hodnoty po přerušení sekvence a povely kroků (předpočítané z IR — totéž jako generátor). */
  private readonly mResets: IrSet[];
  private readonly mStepSets: Array<IrSet[] | undefined>;
  private readonly mInSeq: Set<number>;
  /** DO, které znamenají pohyb (motor, ventil, měnič chod, pohon start / referování) — po zastavení musí být FALSE. */
  readonly motionOuts: string[];
  /** DO pohonů, které pohyb nespouští (povolení, výběr záznamu, HALT, směr, kvitace) — nejsou „sepnuté výstupy“. */
  private readonly passiveOuts: Set<string>;

  constructor(private readonly prj: Project, opts: { dt?: number; motorDelay?: number; valveTravel?: number; record?: boolean } = {}) {
    this.dt = opts.dt ?? 0.01;
    this.motorDelay = opts.motorDelay ?? prj.sim?.motorDelay ?? 0.5;
    this.valveTravel = opts.valveTravel ?? prj.sim?.valveTravel ?? 1.0;
    this.record = opts.record ?? false;
    const seq = prj.program.seq, io = this.io;

    /* --- vstupy a výstupy ------------------------------------------------ */
    const estopDev = devById(prj, prj.program.estop);
    this.estopIo = estopDev ? (ioOf(prj, estopDev).in || Object.values(ioOf(prj, estopDev))[0]) : undefined;
    for (const e of prj.io) {
      if (e.dir === "AI") io[e.key] = 13824;        // polovina rozsahu 0..27648
      else if (e.dir === "AO") io[e.key] = 0;
      else if (e.dir === "DO") io[e.key] = false;
      else io[e.key] = !!e.nc;                      // klidový stav: NC kontakt sepnut = TRUE
    }
    if (this.estopIo) io[this.estopIo.key] = true;  // E-stop uvolněn (TRUE = v pořádku)
    this.ilIo = enableInputs(prj).filter(x => !x.estop).map(x => ({ dev: x.dev, io: x.io }));
    for (const x of this.ilIo) { io[x.io.key] = true; this.ilPrev[x.io.key] = true; }   // kryty zavřené, závora volná
    this.ioKeys = prj.io.map(e => e.key);
    const diDevs = new Set(prj.devices.filter(d => d.cls === "DI").map(d => d.id));
    this.freeDi = new Set(prj.io.filter(e => e.dir === "DI" && diDevs.has(e.devId) && e !== this.estopIo).map(e => e.key));
    this.aiKeys = new Set(prj.io.filter(e => e.dir === "AI").map(e => e.key));

    /* --- instance bloků (pořadí jako v Gen_Main) -------------------------- */
    this.inSeq = new Set(seq.filter(s => s.act !== "wait" && !isDiWait(s)).map(s => s.dev));
    for (const d of prj.devices) {
      if (d.cls !== "Motor" && d.cls !== "Ventil" && !isMotionClass(d.cls)) continue;
      const f: FbInst = {
        d, io: ioOf(prj, d), auto: seq.length > 0 && this.inSeq.has(d.id),
        step: 0, lastA: false, lastB: false, lastR: false, ton: new Ton(), ton2: new Ton(),
        out: false, busy: false, error: false, blocked: false,
      };
      if (isMotionClass(d.cls)) f.x = motionInit(d, f.io, io);
      this.insts.push(f);
      this.plant[d.id] = 0;                          // model stroje: 0..1 = rozběh / poloha
      if (d.cls === "Ventil" && f.io.fbkClosed) io[f.io.fbkClosed.key] = true;   // v klidu zavřeno
    }
    /* pohony fáze 2a: povely sekvence (počáteční hodnota jako deklarace v PLC: 0 / FALSE) */
    const mdevs = seqMotionDevs(prj);
    this.mInSeq = new Set(seq.length ? mdevs.map(d => d.id) : []);
    this.mResets = seq.length ? mdevs.flatMap(motionSeqVars) : [];
    for (const r of this.mResets) this.mseq[r.var] = r.type === "BOOL" ? false : 0;
    this.mStepSets = seq.map(s => { const d = devById(prj, s.dev); return d && isMotionClass(d.cls) && s.act !== "wait" ? motionStepSets(d, s) : undefined; });
    const moving = new Set<string>(), passive = new Set<string>();
    for (const d of prj.devices) {
      const dio = ioOf(prj, d);
      if (d.cls === "Motor" || d.cls === "Ventil") for (const e of Object.values(dio)) { if (e.dir === "DO") moving.add(e.key); }
      else if (isMotionClass(d.cls)) for (const e of Object.values(dio)) {
        if (e.dir !== "DO") continue;
        if (e.sig === "outRun" || e.sig === "outStart" || e.sig === "outHome") moving.add(e.key); else passive.add(e.key);
      }
    }
    this.motionOuts = prj.io.filter(e => moving.has(e.key)).map(e => e.key);
    this.passiveOuts = passive;
    for (const id of this.inSeq) this.seqVar[id] = false;
    this.stepDev = seq.map(s => devById(prj, s.dev));
    this.stepCond = seq.map(s => seqCond(prj, s));
    seq.forEach((s, i) => { if (this.stepCond[i].kind !== "none") this.tonSeq[10 + i * 10] = new Ton(); });
    this.analogs = limitedAnalogs(prj).flatMap(d => {
      const e = ioOf(prj, d).raw;
      if (!e) return [];
      /* běžný provoz: hodnota uprostřed povoleného pásma (model stroje měří „v pořádku") */
      const lo = Number.isFinite(d.limLo) ? d.limLo! : d.rmin, hi = Number.isFinite(d.limHi) ? d.limHi! : d.rmax;
      const span = d.rmax - d.rmin || 1;
      io[e.key] = clampRaw(((lo + hi) / 2 - d.rmin) / span * 27648);
      return [{ d, key: e.key, hi: d.limHi, lo: d.limLo }];
    });
    this.roles = prj.devices.filter(d => d.cls === "DO" && d.role).flatMap(d => Object.values(ioOf(prj, d)).map(e => ({ key: e.key, role: d.role! })));
    /* klid procesu u čekaného vstupu = opak stavu, na který čeká první krok (bedna plná →
       „čekat na FALSE" opravdu čeká a hlídací čas jde vyzkoušet) */
    seq.forEach((s, i) => { const c = this.stepCond[i]; if (isDiWait(s) && c.io && !(c.io.key in this.diRest)) this.diRest[c.io.key] = s.act !== "waitOn"; });
    this.inputs = prj.io.filter(e => e.dir === "DI" || e.dir === "AI");
    for (const e of this.inputs) this.model[e.key] = io[e.key];
    for (const [k, v] of Object.entries(this.diRest)) io[k] = this.model[k] = v;
    this.snapshot(0);
  }

  /**
   * Nezávislá kopie celého stavu (program, model stroje, zásahy, záznam). Ověření z ní
   * navazuje zásahy v okamžiku `t` místo simulace celého cyklu od začátku — výsledek je
   * shodný, protože scan je deterministický a kopie nese i stav časovačů a hran.
   */
  clone(): Simulator {
    const c = Object.create(Simulator.prototype) as Simulator;
    Object.assign(c, this);
    const s = this as unknown as Record<string, unknown>, d = c as unknown as Record<string, unknown>;
    const ctl = this.controls;
    d.controls = { ...ctl, man: { ...ctl.man }, frozen: [...ctl.frozen], fault: [...ctl.fault], di: { ...ctl.di }, ai: { ...ctl.ai }, force: { ...ctl.force } };
    d.events = [...this.events]; d.frames = [...this.frames]; d.errors = [...this.errors];
    d.steps = this.steps.map(x => ({ ...x }));
    for (const k of ["io", "model", "forced", "plant", "seqVar", "ilPrev", "mseq"]) d[k] = { ...(s[k] as object) };
    d.insts = (s.insts as FbInst[]).map(f => ({ ...f, ton: f.ton.clone(), ton2: f.ton2.clone(),
      ...(f.x ? { x: { tons: Object.fromEntries(Object.entries(f.x.tons).map(([k, t]) => [k, t.clone()])), last: { ...f.x.last }, v: { ...f.x.v }, m: { ...f.x.m } } } : {}) }));
    d.tonSeq = Object.fromEntries(Object.entries(s.tonSeq as Record<number, Ton>).map(([k, t]) => [k, t.clone()]));
    d.firstFault = this.firstFault ? { ...this.firstFault } : null;
    d.dirty = new Set(this.dirty);
    d.alarmPrev = { ...this.alarmPrev };
    return c;
  }

  /** Index aktuálního kroku sekvence; -1 = klid. */
  get seqIndex(): number { return this.seqStep === 0 ? -1 : (this.seqStep - 10) / 10; }
  /** Centrální uvolnění: E-stop v pořádku AND všechny blokovací vstupy TRUE (jako `enableExpr`). */
  get enable(): boolean {
    return (this.estopIo ? this.io[this.estopIo.key] === true : true) && this.ilIo.every(x => this.io[x.io.key] === true);
  }

  /** Jednorázový stisk tlačítka start / kvitace (držený `duration` sekund času simulace). */
  pressStart(duration = 0.3): void { this.startUntil = this.t + duration; }
  pressAck(duration = 0.3): void { this.ackUntil = this.t + duration; }

  outputsOn(): string[] {
    /* signalizace s vazbou na stav stroje (maják, připraveno…) se nepočítá — svítit má; stejně tak
       výstupy pohonů, které pohyb nespouští (povolení, výběr záznamu, HALT) */
    return this.prj.io.filter(e => e.dir === "DO" && this.io[e.key] === true && !this.roles.some(r => r.key === e.key) && !this.passiveOuts.has(e.key)).map(e => e.key);
  }

  private devState(f: FbInst): SimDevState {
    const cls = f.d.cls;
    const labels = cls === "Motor" ? MOTOR_LABEL : cls === "Vfd" ? VFD_LABEL : cls === "PosDrive" ? POS_LABEL : cls === "PropValve" ? PROP_LABEL : VALVE_LABEL;
    let pos = Math.round(this.plant[f.d.id] * 1000) / 1000;
    const extra: Partial<SimDevState> = {};
    if (f.x) {
      const d = f.d, span = (d.rmax - d.rmin) || 1, m = f.x.m, v = f.x.v;
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      if (cls === "Vfd") { extra.value = r3(+m.spd); extra.cmd = r3(+v.speedCmd); pos = r3(Math.min(1, Math.max(0, +m.spd / (d.rmax || 1)))); }
      else if (cls === "PropValve") { extra.value = r3(+m.act); extra.cmd = r3(+v.spAct); pos = r3(Math.min(1, Math.max(0, (+m.act - d.rmin) / span))); }
      else { extra.rec = +m.pos; extra.done = !!v.done; extra.cmd = +m.mvRec; pos = m.mv ? r3(Math.min(1, +m.mvT / travelOf(d))) : 0; }
      extra.errCode = +v.errCode;
    }
    return f.blocked ? { step: -1, label: tr("blokováno"), error: false, busy: false, pos, ...extra }
      : { step: f.step, label: labels[f.step] ? tr(labels[f.step]) : String(f.step), error: f.error, busy: f.busy, pos, ...extra };
  }

  /** Hodnota výstupu instance bloku pohonu (`instM5.inSpeed`) pro podmínku kroku — stav z minulého scanu, jako v PLC. */
  private member(inst: string, port: string): number | boolean {
    const f = this.insts.find(x => instName(x.d) === inst);
    return f && f.x ? f.x.v[port] ?? 0 : 0;
  }
  /** Vyhodnocení výrazu podmínky kroku (zrcadlo `irText` — jen co generátor do podmínek píše). */
  private evalExpr(e: IrExpr): number | boolean {
    switch (e.k) {
      case "bool": return e.v;
      case "int": case "real": return e.v;
      case "member": return this.member(e.inst, e.port);
      case "var": return this.mseq[e.name] ?? 0;
      case "io": { const io = this.prj.io.find(x => x.tag === e.tag); return io ? this.io[io.key] ?? 0 : 0; }
      case "not": return !this.evalExpr(e.e);
      case "and": return e.args.every(a => !!this.evalExpr(a));
      case "or": return e.args.some(a => !!this.evalExpr(a));
      case "cmp": { const a = +this.evalExpr(e.a), b = +this.evalExpr(e.b); return e.op === "=" ? a === b : a !== b; }
      case "paren": return this.evalExpr(e.e);
    }
  }
  /**
   * Jeden scan bloku pohonu fáze 2a — přesné zrcadlo šablon ST_VFD / ST_POSDRIVE / ST_PROPVALVE
   * (pořadí příkazů, hrany, časovače, REAL ve float32). Povely: sekvence (`mseq`) NEBO ruční povel
   * mimo AUTO (bez sekvence jen ruční); vstupy z vrstvy `io` (co čte program).
   */
  private motionScan(f: FbInst, enable: boolean, ack: boolean, hasSeq: boolean, man: boolean, modeAuto: boolean): void {
    const x = f.x!, v = x.v, L = x.last, T = x.tons, d = f.d, io = this.io, dt = this.dt, n = d.name;
    const inSeq = this.mInSeq.has(d.id);
    const sv = (k: string) => this.mseq[k + "_" + n];
    const di = (sig: string, dflt: boolean) => f.io[sig] ? io[f.io[sig].key] === true : dflt;
    const manCmd = man && !modeAuto;
    if (!enable) {
      if (d.cls === "Vfd") Object.assign(v, { outRun: false, outRev: false, outReset: false, speedCmd: 0, inSpeed: false, frac: 0 });
      else if (d.cls === "PosDrive") Object.assign(v, { outEnable: false, outStart: false, outHome: false, outHalt: false, outReset: false,
        outSel0: false, outSel1: false, outSel2: false, outSel3: false, outSel4: false, outSel5: false, done: false, halted: false });
      else Object.assign(v, { spAct: fr(d.rmin), inTol: false, devCnt: 0, frac: 0 });
      v.errCode = 0;
      f.step = 0; f.busy = false; f.error = false; f.blocked = true; f.out = false;
      this.writeOuts(f);
      return;
    }
    f.blocked = false;
    const ramp = (cur: number, target: number, step: number, tick: boolean): number => {
      if (step <= 0) return target;
      if (!tick) return cur;
      if (cur < target) { const nv = fr(cur + step); return nv > target ? target : nv; }
      if (cur > target) { const nv = fr(cur - step); return nv < target ? target : nv; }
      return cur;
    };
    let st = f.step;
    if (d.cls === "Vfd") {
      const cmd = hasSeq ? ((inSeq && !!sv("seqRun")) || manCmd) : man;
      const rev = inSeq && !!d.opt?.rev ? !!sv("seqRev") : false;
      const sp = inSeq ? +sv("seqSpd") : fr(devSp(d));
      const trigRun = cmd && !L.run; L.run = cmd;
      const trigStop = !cmd && !L.stop; L.stop = !cmd;
      const trigReset = ack && !L.reset; L.reset = ack;
      const ready = di("ready", true), atSpeed = di("atSpeed", true), fault = di("fault", false);
      switch (st) {
        case 0: v.outRun = false; v.speedCmd = 0; if (trigRun) st = 10; break;
        case 10: v.outRun = true; if (atSpeed && v.speedCmd === sp) { st = 20; v.spLast = sp; v.revLast = rev; } if (trigStop) st = 0; break;
        case 20: v.outRun = true;
          if (v.spLast !== sp || (rev && !v.revLast) || (!!v.revLast && !rev)) st = 10;
          else if (!atSpeed) { st = 90; v.errCode = 4; }
          if (trigStop) st = 0;
          break;
        case 90: v.outRun = false; v.speedCmd = 0; if (trigReset && !fault) { st = 0; v.errCode = 0; } break;
      }
      const tick = T.tick.call(st === 10 && !T.tick.q, T_TICK, dt);
      if (st === 10) v.speedCmd = ramp(+v.speedCmd, sp, fr(rampStepOf(d)), tick);
      if (T.fbk.call(st === 10 && v.speedCmd === sp, T_VFD_SPEED, dt)) { st = 90; v.errCode = 5; }
      if (!ready && (st === 10 || st === 20)) { st = 90; v.errCode = 2; }
      if (fault) { st = 90; v.errCode = 1; }
      v.outRev = !!v.outRun && rev;
      v.outReset = ack && st === 90;
      v.frac = Math.min(1, Math.max(0, (+v.speedCmd - fr(d.rmin)) / (fr(d.rmax) - fr(d.rmin))));
      v.inSpeed = st === 20;
      f.busy = st === 10; f.out = !!v.outRun;
    } else if (d.cls === "PosDrive") {
      const cmdHome = hasSeq ? ((inSeq && !!sv("seqHome")) || manCmd) : man;
      const cmdMove = inSeq ? !!sv("seqMove") : false;
      const recNo = inSeq ? +sv("seqRec") : 0;
      const trigHome = cmdHome && !L.home; L.home = cmdHome;
      const trigMove = cmdMove && !L.move; L.move = cmdMove;
      const trigReset = ack && !L.reset; L.reset = ack;
      const ready = di("ready", true), inPos = di("inPos", true), homed = di("homed", true), fault = di("fault", false);
      v.outEnable = true;
      switch (st) {
        case 0: v.outStart = false; v.outHome = false;
          if (trigHome) { st = 40; v.done = false; v.halted = false; }
          else if (trigMove || (cmdMove && recNo !== v.actRec)) { v.done = false; if (homed) { st = 10; v.halted = false; } else { st = 90; v.errCode = 3; } }
          else if (v.done && !inPos) { st = 90; v.errCode = 4; }
          break;
        case 10: {
          v.outStart = false; v.outHome = false;
          let r = recNo;
          for (const [k, w] of [[5, 32], [4, 16], [3, 8], [2, 4], [1, 2]]) { const b = r >= w; v["outSel" + k] = b; if (b) r -= w; }
          v.outSel0 = r >= 1;
          if (T.sel.q) st = 20;
          if (!cmdMove) { st = 0; v.halted = true; }
          break;
        }
        case 20: v.outStart = true; if (!inPos) st = 30; if (!cmdMove) { st = 0; v.halted = true; v.outStart = false; } break;
        case 30: v.outStart = true; if (inPos) { st = 0; v.actRec = recNo; v.done = true; v.outStart = false; } if (!cmdMove) { st = 0; v.halted = true; v.outStart = false; } break;
        case 40: v.outHome = true; if (!homed) st = 45; if (!cmdHome) { st = 0; v.halted = true; v.outHome = false; } break;
        case 45: v.outHome = true; if (homed && inPos) { st = 0; v.actRec = 0; v.done = true; v.outHome = false; } if (!cmdHome) { st = 0; v.halted = true; v.outHome = false; } break;
        case 90: v.outStart = false; v.outHome = false; v.done = false; if (trigReset && !fault) { st = 0; v.errCode = 0; } break;
      }
      T.sel.call(st === 10, T_POS_SEL, dt);
      const qAck = T.ack.call(st === 20 || st === 40, T_POS_ACK, dt);
      const qMove = T.move.call(st === 30 || st === 45, T_POS_MOVE, dt);
      if (qAck || qMove) { st = 90; v.errCode = 5; }
      if (!ready && st !== 0 && st !== 90) { st = 90; v.errCode = 2; }
      if (fault) { st = 90; v.errCode = 1; }
      v.outHalt = !!v.halted || st === 90;
      v.outReset = ack && st === 90;
      f.busy = st > 0 && st < 90; f.out = !!v.outStart || !!v.outHome;
    } else {
      const cmdOn = hasSeq ? ((inSeq && !!sv("seqOn")) || manCmd) : man;
      const spT = inSeq ? +sv("seqSp") : fr(devSp(d));
      const trigOn = cmdOn && !L.on; L.on = cmdOn;
      const trigReset = ack && !L.reset; L.reset = ack;
      const smin = fr(d.rmin), span = (d.rmax - d.rmin) || 1;
      const target = cmdOn ? spT : smin;
      const useFbk = !!f.io.rawAct;
      const value = useFbk ? (+io[f.io.rawAct.key] || 0) / 27648 * span + d.rmin : d.rmin;
      const tol = fr(tolOf(d));
      const deviated = useFbk && (value > target + tol || value < target - tol);
      v.value = value; v.target = target;
      switch (st) {
        case 0: v.spAct = smin; if (trigOn) st = 10; break;
        case 10: if (v.spAct === target && !deviated) { st = 20; v.spLast = target; } if (!cmdOn) st = 0; break;
        case 20: if (!cmdOn) st = 0; else if (target !== v.spLast) st = 10; break;
        case 90: v.spAct = smin; if (trigReset) { st = 0; v.errCode = 0; } break;
      }
      const tick = T.tick.call((st === 10 || (st === 20 && deviated)) && !T.tick.q, T_TICK, dt);
      if (st === 10) v.spAct = ramp(+v.spAct, target, fr(rampStepOf(d)), tick);
      if (st === 20 && deviated) { if (tick) v.devCnt = +v.devCnt + 1; } else v.devCnt = 0;
      if (+v.devCnt >= tolTicksOf(d)) { st = 90; v.errCode = 6; v.devCnt = 0; }
      if (T.settle.call(st === 10 && v.spAct === target, T_PROP_SETTLE, dt)) { st = 90; v.errCode = 5; }
      v.frac = Math.min(1, Math.max(0, (+v.spAct - smin) / (fr(d.rmax) - smin)));
      v.inTol = st === 20;
      f.busy = st === 10; f.out = st === 10 || st === 20;
    }
    f.step = st; f.error = st === 90;
    this.writeOuts(f);
  }

  /** Výstupy bloku pohonu do I/O: DO podle jména výstupu bloku, AO = podíl rozsahu (0..27648, kanonicky). */
  private writeOuts(f: FbInst): void {
    const v = f.x!.v, io = this.io;
    for (const e of Object.values(f.io)) {
      let val: boolean | number;
      if (e.dir === "DO") val = !!v[e.sig];
      else if (e.dir === "AO") val = Math.round(Math.min(1, Math.max(0, +v.frac || 0)) * 27648);
      else continue;
      if (io[e.key] !== val) { io[e.key] = val; this.chg = true; }
    }
  }

  /**
   * Model pohonu fáze 2a (reakce na výstupy do dalšího scanu; zapisuje jen do vrstvy `model`).
   * Měnič: otáčky sledují žádanou rychlostí rozsah / motorDelay, při změně směru přes nulu;
   * „otáčky dosaženy“ = chod a skutečné otáčky = žádaná. Pohon: start / referování potvrdí
   * poklesem „v poloze“, jízda trvá `travelS`, HALT a odpojení povolení jízdu zastaví.
   * Ventil: skutečná hodnota = žádaná po rampě (bez zpoždění — rampa je v PLC).
   * Zamrzlé zařízení (zásah frozen) = zaseknutá mechanika: otáčky / poloha / tlak se nemění.
   */
  private motionPlant(f: FbInst, frozen: boolean): void {
    const x = f.x!, v = x.v, m = x.m, d = f.d, dt = this.dt;
    const span = (d.rmax - d.rmin) || 1;
    if (d.cls === "Vfd") {
      const run = !!v.outRun, rev = !!v.outRev, target = run ? +v.speedCmd : 0;
      if (!frozen) {
        const R = Math.abs(span) / Math.max(this.motorDelay, dt) * dt;
        let spd = +m.spd;
        if (spd > 0 && !!m.dir !== rev) { spd = Math.max(0, spd - R); if (spd === 0) m.dir = rev; }
        else { if (spd === 0) m.dir = rev; spd = spd < target ? Math.min(target, spd + R) : Math.max(target, spd - R); }
        m.spd = spd;
      }
      if (f.io.atSpeed) this.setModel(f.io.atSpeed.key, run && !!m.dir === rev && +m.spd === target);
      if (f.io.rawAct) this.setModel(f.io.rawAct.key, clampRaw((+m.spd - d.rmin) / span * 27648));
    } else if (d.cls === "PosDrive") {
      const start = !!v.outStart, home = !!v.outHome, halt = !!v.outHalt;
      const rs = start && !m.pStart, rh = home && !m.pHome;
      m.pStart = start; m.pHome = home;
      if (!v.outEnable) m.mv = false;
      else {
        if (rh) Object.assign(m, { mv: true, mvHome: true, mvRec: 0, mvT: 0, inPos: false, homed: false, pos: -1 });
        else if (rs && !halt && m.homed) {
          let rec = 0;
          for (let k = 0; k < 6; k++) if (v["outSel" + k]) rec += 1 << k;
          Object.assign(m, { mv: true, mvHome: false, mvRec: rec, mvT: 0, inPos: false, pos: -1 });
        }
        if (halt && m.mv) Object.assign(m, { mv: false, inPos: false, pos: -1 });
        if (m.mv && !frozen) {
          m.mvT = +m.mvT + dt;
          if (+m.mvT >= travelOf(d) - 1e-9) { m.mv = false; m.inPos = true; m.pos = m.mvRec; if (m.mvHome) m.homed = true; }
        }
      }
      if (f.io.inPos) this.setModel(f.io.inPos.key, !!m.inPos);
      if (f.io.homed) this.setModel(f.io.homed.key, !!m.homed);
    } else {
      if (!frozen) m.act = +v.spAct;
      if (f.io.rawAct) this.setModel(f.io.rawAct.key, clampRaw((+m.act - d.rmin) / span * 27648));
    }
  }

  /** Zápis povelů sekvence pohonů (přerušení, krok, vstup do kroku); REAL ve float32. */
  private applySets(sets: IrSet[] | undefined): void {
    for (const s of sets || []) {
      const v = s.value;
      this.mseq[s.var] = v.k === "bool" ? v.v : v.k === "real" ? fr(v.v) : v.k === "int" ? v.v : 0;
    }
  }

  /** Aktuální stav: krok sekvence, enable, porucha, stavy bloků a hodnoty I/O. */
  frame(t = this.t): SimFrame {
    const fr: SimFrame = {
      t: round(t), step: this.seqIndex, enable: this.enable,
      fault: this.machineFault, faultStep: this.machineFault && this.faultStep ? (this.faultStep - 10) / 10 : null,
      dev: {}, io: { ...this.io },
    };
    for (const f of this.insts) fr.dev[f.d.id] = this.devState(f);
    return fr;
  }

  /** Zaznamená snímek, pokud se stav změnil (jen při `record`). */
  snapshot(t: number): void {
    if (!this.record || !this.chg) return;
    this.chg = false;
    this.frames.push(this.frame(t));
  }

  /** Zápis vstupu podle stroje (model); do `io` se promítne v `resolveInputs`. */
  private setModel(key: string, v: boolean | number): void {
    if (this.model[key] !== v) { this.model[key] = v; this.dirty.add(key); }
  }

  /** Provede `seconds` času simulace (zaokrouhleno na celé scany). */
  run(seconds: number): void {
    for (let n = Math.max(1, Math.round(seconds / this.dt)); n > 0; n--) this.scan();
  }

  /**
   * Promítne vnější zásahy (E-stop, vstupy poruch, volné a analogové vstupy, vnucené
   * hodnoty) do vstupů. Volá se na začátku každého scanu; samostatně jen při zastaveném
   * čase, aby byl zásah vidět hned — program na něj zareaguje až dalším scanem.
   */
  applyInputs(): void {
    const { model: io, controls: c, events, estopIo } = this, t = this.t;
    if (estopIo && io[estopIo.key] === c.estop) {
      this.setModel(estopIo.key, !c.estop);
      events.push({ t: round(t), kind: c.estop ? "err" : "info", msg: c.estop ? tr("Stisk nouzového zastavení") : tr("Nouzové zastavení uvolněno") });
    }
    for (const f of this.insts) {
      if (!f.io.fault) continue;
      const want = c.fault.includes(f.d.id);
      if ((io[f.io.fault.key] === true) !== want) {
        this.setModel(f.io.fault.key, want);
        events.push({ t: round(t), kind: want ? "err" : "info", dev: f.d.id, msg: want ? tr("{dev}: vstup poruchy aktivní", { dev: f.d.name }) : tr("{dev}: vstup poruchy odezněl", { dev: f.d.name }) });
      }
    }
    for (const key of Object.keys(c.di)) if (this.freeDi.has(key)) this.setModel(key, !!c.di[key]);
    for (const key of Object.keys(c.ai)) if (this.aiKeys.has(key)) this.setModel(key, clampRaw(c.ai[key]));
    this.resolveInputs(true);
    for (const x of this.ilIo) {                       // hlášení rozpojení / obnovení blokování
      const ok = this.io[x.io.key] === true;
      if (ok === this.ilPrev[x.io.key]) continue;
      this.ilPrev[x.io.key] = ok;
      const p = { dev: x.dev.name, desc: x.dev.desc || x.io.tag };
      events.push({ t: round(t), kind: ok ? "info" : "err", dev: x.dev.id,
        msg: ok ? tr("Blokování {dev} obnoveno ({desc})", p) : tr("Blokování {dev} rozpojeno ({desc}) — stroj zastaven", p) });
    }
  }

  /** Vstupy, jak je čte program: vnucená hodnota (`controls.force`), jinak stav podle stroje. */
  private resolveInputs(log: boolean): void {
    const { io, model, forced, events } = this, force = this.controls.force || {};
    let anyForce = false;
    for (const _k in force) { anyForce = true; break; }
    if (!anyForce && !this.nForced) {                // nic vnuceno: stačí změněné vstupy
      for (const k of this.dirty) {
        const v = model[k];
        if (io[k] !== v) { io[k] = v; this.chg = true; }
      }
      this.dirty.clear();
      return;
    }
    for (const e of this.inputs) {
      const raw = force[e.key];
      const on = raw !== undefined && raw !== null;
      const v = !on ? model[e.key] : e.dir === "AI" ? clampRaw(raw) : !!raw;
      if (log) {
        const was = forced[e.key];
        /* u analogu se hlásí jen začátek a konec vnucení, ne každá změna hodnoty */
        if (on ? (was === undefined || (e.dir !== "AI" && was !== v)) : was !== undefined) {
          events.push({
            t: round(this.t), kind: "info", dev: e.devId,
            msg: on ? tr("{tag}: vstup vnucen na {value}", { tag: e.tag, value: e.dir === "AI" ? v : v ? "TRUE" : "FALSE" })
              : tr("{tag}: vnucení vstupu zrušeno", { tag: e.tag }),
          });
        }
        if (on) forced[e.key] = v; else delete forced[e.key];
      }
      if (io[e.key] !== v) { io[e.key] = v; this.chg = true; }
    }
    this.dirty.clear();
    if (log) this.nForced = Object.keys(forced).length;
  }

  private setFault(cause: string, step: number | null): void {
    if (step !== null) this.faultStep = 10 + step * 10;
    if (this.machineFault) return;
    this.machineFault = true;
    this.chg = true;
    this.faultCount++;
    if (!this.firstFault) this.firstFault = { t: round(this.t), cause, step };
    this.events.push({ t: round(this.t), kind: "err", step: step ?? undefined, msg: tr("PORUCHA STROJE: {cause}", { cause }) });
  }

  /** Jeden scan: vnější zásahy → program (enable → sekvence → časovače → instance → porucha) → stroj. */
  scan(): void {
    const { prj, io, controls: c, dt, events, steps, insts, seqVar, tonSeq, inSeq } = this;
    const seq = prj.program.seq, t = this.t;
    const cmdAutoStart = c.start || t < this.startUntil - 1e-9;
    const cmdAck = c.ack || t < this.ackUntil - 1e-9;
    this.applyInputs();

    /* --- scan programu: enable → sekvence → časovače → instance → porucha -- */
    const enable = this.enable;
    const before = this.seqStep;
    let seqStep = before, completed = false;
    if (seq.length) {
      if (!c.modeAuto || !enable || this.machineFault) { seqStep = 0; for (const id of inSeq) seqVar[id] = false; this.applySets(this.mResets); }
      if (seqStep === 0) {
        if (c.modeAuto && enable && !this.machineFault && cmdAutoStart) { seqStep = 10; this.applySets(this.mStepSets[0]); }
      } else {
        const i = (seqStep - 10) / 10, s = seq[i];
        const next = i === seq.length - 1 ? 0 : seqStep + 10;
        const d = this.stepDev[i];
        if (s.act !== "wait" && d && d.cls === "Motor") seqVar[d.id] = s.act === "start";
        else if (s.act !== "wait" && d && d.cls === "Ventil") seqVar[d.id] = s.act === "open";
        else this.applySets(this.mStepSets[i]);
        const cnd = this.stepCond[i];
        let go = false;
        if (cnd.kind === "time") go = tonSeq[seqStep].q;
        else if (cnd.kind === "fbk") {
          const v = cnd.expr ? !!this.evalExpr(cnd.expr) : io[cnd.io!.key] === true;
          go = cnd.neg ? !v : v;
          if (!go && tonSeq[seqStep].q) this.setFault(tr("timeout kroku {n} ({title}, {t} s)", { n: i + 1, title: stepTitle(prj, s), t: s.timeS || 1 }), i);
        } else go = true;
        /* povely pohonů dalšího kroku už při přechodu (jako generátor — IrStep.sets) */
        if (go) { seqStep = next; completed = next === 0; if (next) this.applySets(this.mStepSets[(next - 10) / 10]); }
      }
      /* časovače kroků (TON s IN := seqStep = n): aktivní je nejvýš jeden; ostatní stojí na
         nule, takže stačí vynulovat časovač opouštěného kroku a krokovat ten aktuální */
      const tb = tonSeq[before], tn = tonSeq[seqStep];
      if (tb && before !== seqStep) tb.call(false, 1, dt);
      if (tn) tn.call(true, seq[(seqStep - 10) / 10].timeS || 1, dt);
    }
    if (seqStep !== this.seqStep) this.chg = true;
    this.seqStep = seqStep;
    if (seqStep !== before) {
      const open = steps[steps.length - 1];
      if (open && open.tEnd === null) open.tEnd = round(t);
      if (seqStep === 0) {
        if (completed && this.inCycle) {
          this.cycles++;
          this.lastCycleTime = round(t - this.cycleStart);
          if (this.firstCycleTime === null) this.firstCycleTime = this.lastCycleTime;
          this.tDone = t;
          events.push({ t: round(t), kind: "seq", msg: tr("Cyklus dokončen — návrat do klidu ({t} s)", { t: this.lastCycleTime }) });
        } else events.push({ t: round(t), kind: "err", msg: tr("Sekvence přerušena — návrat do kroku 0") });
        this.inCycle = false;
      } else {
        const i = (seqStep - 10) / 10;
        if (!this.inCycle) { this.inCycle = true; this.everStarted = true; this.cycleStart = t; }
        steps.push({ i, tStart: round(t), tEnd: null });
        events.push({ t: round(t), kind: "seq", step: i, dev: seq[i].dev || undefined, msg: tr("Krok {n}: {title}", { n: i + 1, title: stepTitle(prj, seq[i]) }) });
      }
    }

    const hasSeq = seq.length > 0;
    for (const f of insts) {
      const was = f.blocked ? -1 : f.step;
      if (f.x) {
        /* pohony fáze 2a: zrcadlo FB_Vfd / FB_PosDrive / FB_PropValve */
        this.motionScan(f, enable, cmdAck, hasSeq, !!c.man[f.d.id], c.modeAuto);
        const now = f.blocked ? -1 : f.step;
        if (now !== was) {
          this.chg = true;
          const st = this.devState(f);
          if (st.error) {
            this.errors.push({ dev: f.d.id, t: round(t) });
            events.push({ t: round(t), kind: "err", dev: f.d.id, msg: tr("{dev}: PORUCHA bloku (status 16#8002, {err})", { dev: f.d.name, err: tr(MOTION_ERR[+f.x.v.errCode] || "?") }) });
          } else events.push({ t: round(t), kind: "dev", dev: f.d.id, msg: f.d.name + ": " + st.label });
        }
        continue;
      }
      if (!enable) {
        f.out = false; f.busy = false; f.error = false; f.step = 0; f.blocked = true;
      } else {
        f.blocked = false;
        /* povel: sekvence NEBO ruční povel v ručním režimu (bez sekvence jen ruční) */
        const man = !!c.man[f.d.id];
        const cmd = hasSeq ? ((f.auto && seqVar[f.d.id]) || (man && !c.modeAuto)) : man;
        const trigA = cmd && !f.lastA; f.lastA = cmd;
        const trigB = !cmd && !f.lastB; f.lastB = !cmd;
        const trigR = cmdAck && !f.lastR; f.lastR = cmdAck;
        if (f.d.cls === "Motor") {
          const fbk = f.io.fbkRunning ? io[f.io.fbkRunning.key] === true : true;
          const fault = f.io.fault ? io[f.io.fault.key] === true : false;
          if (f.step === 0) { f.out = false; if (trigA) f.step = 10; }
          else if (f.step === 10) { f.out = true; if (fbk) f.step = 20; if (trigB) f.step = 0; }
          else if (f.step === 20) { f.out = true; if (!fbk) f.step = 90; if (trigB) f.step = 0; }
          else if (f.step === 90) { f.out = false; if (trigR && !fault) f.step = 0; }
          if (f.ton.call(f.step === 10, T_MOTOR_FBK, dt) || fault) f.step = 90;
          f.busy = f.step === 10;
        } else {
          const fbkOpen = f.io.fbkOpen ? io[f.io.fbkOpen.key] === true : true;
          const fbkClosed = f.io.fbkClosed ? io[f.io.fbkClosed.key] === true : true;
          if (f.step === 0) { f.out = false; if (trigA) f.step = 10; }
          else if (f.step === 10) { f.out = true; if (fbkOpen) f.step = 20; if (trigB) f.step = 30; }
          else if (f.step === 20) { f.out = true; if (!fbkOpen) f.step = 90; if (trigB) f.step = 30; }
          else if (f.step === 30) { f.out = false; if (fbkClosed) f.step = 0; if (trigA) f.step = 10; }
          else if (f.step === 90) { f.out = false; if (trigR) f.step = 0; }
          const qOpen = f.ton.call(f.step === 10, T_VALVE_TRAVEL, dt);
          const qClose = f.ton2.call(f.step === 30, T_VALVE_TRAVEL, dt);
          if (qOpen || qClose) f.step = 90;
          f.busy = f.step === 10 || f.step === 30;
        }
        f.error = f.step === 90;
      }
      const outIo = f.d.cls === "Motor" ? f.io.outRun : f.io.outOpen;
      if (outIo && io[outIo.key] !== f.out) { io[outIo.key] = f.out; this.chg = true; }
      const now = f.blocked ? -1 : f.step;
      if (now !== was) {
        this.chg = true;
        const st = this.devState(f);
        if (st.error) {
          this.errors.push({ dev: f.d.id, t: round(t) });
          events.push({ t: round(t), kind: "err", dev: f.d.id, msg: tr("{dev}: PORUCHA bloku (status 16#8002)", { dev: f.d.name }) });
        } else events.push({ t: round(t), kind: "dev", dev: f.d.id, msg: f.d.name + ": " + st.label });
      }
    }

    /* analogy s mezemi (FB_AnalogIn) */
    const alarms: string[] = [];
    for (const a of this.analogs) {
      const d = a.d, raw = +io[a.key] || 0;
      const v = raw / 27648 * (d.rmax - d.rmin) + d.rmin;
      const al = a.hi !== undefined && Number.isFinite(a.hi) && v > a.hi ? "hi" : a.lo !== undefined && Number.isFinite(a.lo) && v < a.lo ? "lo" : "";
      if (al) alarms.push(al === "hi" ? tr("{dev} nad mezí ({v} > {lim} {unit})", { dev: d.name, v: round1(v), lim: a.hi, unit: d.unit }) : tr("{dev} pod mezí ({v} < {lim} {unit})", { dev: d.name, v: round1(v), lim: a.lo, unit: d.unit }));
      if (al !== (this.alarmPrev[a.key] || "")) {
        this.alarmPrev[a.key] = al;
        events.push({ t: round(t), kind: al ? "err" : "info", dev: d.id, msg: al ? alarms[alarms.length - 1] : tr("{dev}: hodnota zpět v mezích", { dev: d.name }) });
      }
    }
    /* výstupy s vazbou na stav stroje */
    for (const r of this.roles) {
      const v = roleValue(r.role, seq.length > 0, { seqStep: this.seqStep, machineFault: this.machineFault, enable, modeAuto: c.modeAuto });
      if (io[r.key] !== v) { io[r.key] = v; this.chg = true; }
    }

    /* porucha stroje a kvitace — za instancemi, z čerstvých výstupů error a alarmů mezí */
    const bad = insts.filter(f => f.error);
    if (bad.length) this.setFault(tr("chyba bloku {names}", { names: bad.map(f => f.d.name).join(", ") }), null);
    if (alarms.length) this.setFault(alarms.join("; "), null);
    if (cmdAck && !bad.length && !alarms.length) {
      this.faultStep = 0;
      if (this.machineFault) {
        this.machineFault = false;
        this.chg = true;
        events.push({ t: round(t), kind: "info", msg: tr("Porucha kvitována") });
      }
    }

    this.snapshot(t);

    /* --- model stroje: reakce na výstupy do dalšího scanu ----------------- */
    const model = this.model;
    for (const f of insts) {
      if (f.x) { this.motionPlant(f, c.frozen.includes(f.d.id)); continue; }
      if (c.frozen.includes(f.d.id)) continue;
      const rate = dt / Math.max(f.d.cls === "Motor" ? this.motorDelay : this.valveTravel, dt);
      const p = this.plant[f.d.id] = Math.min(1, Math.max(0, this.plant[f.d.id] + (f.out ? rate : -rate)));
      if (f.d.cls === "Motor") {
        const e = f.io.fbkRunning;
        if (e) { if (p >= 1 - 1e-9) this.setModel(e.key, true); else if (p <= 1e-9) this.setModel(e.key, false); }
      } else {
        if (f.io.fbkOpen) this.setModel(f.io.fbkOpen.key, p >= 1 - 1e-9);
        if (f.io.fbkClosed) this.setModel(f.io.fbkClosed.key, p <= 1e-9);
      }
    }
    /* proces u kroků „čekat na vstup": po DI_DELAY dodá stav (díl dojel, obsluha stiskla…);
       po opuštění kroku se vstup vrátí do klidu. Zamrzlé zařízení (zásah frozen) neodpoví. */
    const cur = this.seqIndex;
    for (const [i, s2] of seq.entries()) {
      if (!isDiWait(s2)) continue;
      const cnd = this.stepCond[i];
      if (!cnd.io) continue;
      const key = cnd.io.key, want = s2.act === "waitOn";
      if (i === cur) {
        const run = steps[steps.length - 1];
        if (run && run.i === i && t - run.tStart >= DI_DELAY - 1e-9 && !c.frozen.includes(s2.dev) && !(key in c.di)) this.setModel(key, want);
      } else if (cur < 0 && this.model[key] !== this.diRest[key]) {
        this.setModel(key, this.diRest[key]);        // konec cyklu: proces se vrátí do klidu
      }
    }
    this.resolveInputs(false);
    this.t = t + dt;
  }
}

/** Vstup, který zásah „analog“ vnutí: měření (AnalogIn raw), skutečná hodnota pohonu (rawAct). */
export function analogFaultIo(prj: Project, d: Device): IoEntry | undefined {
  const io = ioOf(prj, d);
  return io.raw && d.cls === "AnalogIn" ? io.raw : io.rawAct;
}
/** Vstup, který zásah „lost“ vnutí na FALSE: hlášení chodu / otevřeno / otáčky dosaženy / v poloze. */
export function lostFaultIo(prj: Project, d: Device): IoEntry | undefined {
  const io = ioOf(prj, d);
  return io.fbkRunning || io.fbkOpen || io.atSpeed || io.inPos;
}

/**
 * Odhad doby cyklu pro strop simulace [s] (simulate i emulátor): výdrž / přechod časem = čas kroku,
 * pohon fáze 2a podle modelu (jízda, rampa), ostatní nejdelší přestavení + rezerva.
 */
export function seqEstimate(prj: Project, motorDelay: number, valveTravel: number): number {
  return prj.program.seq.reduce((a, s) => {
    if (s.act === "wait" || s.cond === "time") return a + (s.timeS || 1);
    const d = devById(prj, s.dev);
    if (d && d.cls === "PosDrive") return a + travelOf(d) + 0.7;
    if (d && (d.cls === "Vfd" || d.cls === "PropValve")) return a + (Number(d.rampS) > 0 ? Number(d.rampS) * 1.2 : 0) + Math.max(motorDelay, valveTravel) + 0.5;
    return a + Math.max(motorDelay, valveTravel) + 0.5;
  }, 0);
}

/** Dávková simulace jednoho scénáře: start v čase `startAt`, zásahy podle `faults`. */
export function simulate(prj: Project, options: SimOptions = {}, from?: Simulator): SimResult {
  /* `from` = kontrolní bod běžného cyklu (stejný projekt i model) — simulace z něj naváže */
  const sim = from ? from.clone() : new Simulator(prj, { dt: options.dt, motorDelay: options.motorDelay, valveTravel: options.valveTravel, record: true });
  const { dt, motorDelay, valveTravel } = sim;
  const startAt = options.startAt ?? 0.2;
  const faults = options.faults ?? [];
  const seq = prj.program.seq;
  const maxTime = options.maxTime ?? (startAt + seqEstimate(prj, motorDelay, valveTravel) + T_VALVE_TRAVEL + 5);
  const on = (f: { at: number; until?: number }, t: number) => t >= f.at - 1e-9 && !(f.until !== undefined && t >= f.until - 1e-9);
  const pulse = (at: number, t: number) => t >= at - 1e-9 && t < at + 0.3;
  const c = sim.controls;

  let t = 0;
  for (;;) {
    t = sim.t;
    if (t > maxTime + 1e-9) break;
    c.start = pulse(startAt, t) || faults.some(f => f.kind === "start" && pulse(f.at, t));
    c.ack = faults.some(f => f.kind === "ack" && pulse(f.at, t));
    c.estop = faults.some(f => f.kind === "estop" && t >= f.at - 1e-9 && !(f.release !== undefined && t >= f.release - 1e-9));
    c.fault = faults.filter(f => f.kind === "fault" && on(f, t)).map(f => (f as { dev: number }).dev);
    c.frozen = faults.filter(f => f.kind === "frozen" && on(f, t)).map(f => (f as { dev: number }).dev);
    c.modeAuto = !faults.some(f => f.kind === "manual" && on(f, t));
    if (faults.some(f => f.kind === "man")) c.man = Object.fromEntries(faults.filter(f => f.kind === "man" && on(f, t)).map(f => [(f as { dev: number }).dev, true]));
    for (const f of faults) {
      if (f.kind === "interlock") {
        const d = devById(prj, f.dev), e = d ? (ioOf(prj, d).in || Object.values(ioOf(prj, d))[0]) : undefined;
        if (e) c.di[e.key] = !on(f, t);
      } else if (f.kind === "analog") {
        const d = devById(prj, f.dev), e = d ? analogFaultIo(prj, d) : undefined;
        if (e) { if (on(f, t)) c.force[e.key] = f.raw; else delete c.force[e.key]; }
      } else if (f.kind === "lost") {
        const d = devById(prj, f.dev), e = d ? lostFaultIo(prj, d) : undefined;
        if (e) { if (on(f, t)) c.force[e.key] = false; else delete c.force[e.key]; }
      }
    }
    sim.scan();
    /* po dokončení cyklu ještě 1 s na doběh — pokud sekvence stojí a nečeká žádný další zásah */
    if (sim.cycles > 0 && t - sim.tDone >= 1 && sim.seqIndex < 0 && !faults.some(f => f.at > t)) break;
  }
  const tEnd = round(Math.min(t, maxTime));
  sim.snapshot(tEnd);

  const finished = sim.cycles > 0;
  const stalled = seq.length > 0 && sim.everStarted && !finished && sim.seqIndex >= 0;
  const ff = sim.firstFault;
  return {
    ok: finished && sim.errors.length === 0 && !ff,
    finished, cycleTime: sim.firstCycleTime, cycles: sim.cycles, lastCycleTime: sim.lastCycleTime,
    stalledStep: stalled ? sim.seqIndex : null,
    faulted: !!ff, faultT: ff ? ff.t : null, faultCause: ff ? ff.cause : "", faultStep: ff ? ff.step : null,
    fault: sim.machineFault,
    steps: sim.steps, events: sim.events, frames: sim.frames, errors: sim.errors,
    outputsOn: sim.outputsOn(),
    tEnd,
    opts: { dt, motorDelay, valveTravel, startAt, maxTime, faults },
  };
}

/* ------------------------------------------------------------ kontrolní body */

/**
 * Kontrolní body běžného cyklu: cyklus se projede jednou a v žádaných časech se vrací kopie
 * stavu simulátoru. Ověření z nich navazuje zásahy — u velkých linek (desítky kroků × zásahy)
 * to zkrátí výpočet o řády, výsledek je shodný se simulací od začátku.
 */
export class Checkpoints {
  private sim: Simulator | null = null;
  private readonly cache = new Map<number, Simulator>();
  constructor(private readonly prj: Project, private readonly base: SimOptions = {}) {}

  /** Stav běžného cyklu v čase `t` (první scan s časem ≥ t). */
  at(t: number): Simulator {
    const key = round(t);
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.sim || this.sim.t > t + 1e-9) {
      this.sim = new Simulator(this.prj, { dt: this.base.dt, motorDelay: this.base.motorDelay, valveTravel: this.base.valveTravel, record: true });
    }
    const s = this.sim, c = s.controls, startAt = this.base.startAt ?? 0.2;
    while (s.t < t - 1e-9) {                    // stejné řízení jako běžný cyklus v simulate()
      c.start = s.t >= startAt - 1e-9 && s.t < startAt + 0.3;
      s.scan();
    }
    const cp = s.clone();
    this.cache.set(key, cp);
    return cp;
  }

  /** Simulace scénáře; začíná-li první zásah až po startu cyklu, naváže z kontrolního bodu. */
  run(opts: SimOptions): SimResult {
    const startAt = this.base.startAt ?? 0.2;
    const ts = (opts.faults || []).map(f => f.at);
    const sameStart = opts.startAt === undefined || opts.startAt === startAt;
    const sameModel = opts.dt === this.base.dt && opts.motorDelay === this.base.motorDelay && opts.valveTravel === this.base.valveTravel;
    if (!ts.length || !sameStart || !sameModel) return simulate(this.prj, opts);
    const first = Math.min(...ts);
    if (first <= startAt + 0.3 + 1e-9) return simulate(this.prj, opts);
    return simulate(this.prj, opts, this.at(first));
  }
}

/* ------------------------------------------------------------ scénáře */

export interface SimScenario {
  id: string;
  label: string;
  /** Co scénář zkouší (pro protokol). */
  purpose: string;
  opts: SimOptions;
  step?: number;
  dev?: number;
}

/** Sada scénářů k ověření: běžný cyklus, poruchy v jednotlivých krocích, E-stop, kvitace. */
export function simScenarios(prj: Project, base: SimOptions = {}): SimScenario[] {
  const out: SimScenario[] = [{ id: "nominal", label: tr("Běžný cyklus"), purpose: tr("cyklus bez poruch"), opts: { ...base } }];
  const seq = prj.program.seq;
  if (!seq.length) return out;
  const nominal = simulate(prj, base);
  const startAt = base.startAt ?? 0.2;
  let recover: SimScenario | null = null;
  for (const run of nominal.steps) {
    const s = seq[run.i], d = devById(prj, s.dev);
    if (!d || seqCond(prj, s).kind !== "fbk") continue;
    if (run.tEnd !== null && run.tEnd - run.tStart <= 2 * (base.dt ?? 0.01) + 1e-9) continue;   // podmínka platila hned
    if (!frozenDetectable(prj, s, d, nominal, run)) continue;                                 // zaseknutý ventil změnu „splní“
    const limit = (s.timeS || 1) + T_VALVE_TRAVEL;         // hlídací čas kroku + nejdelší timeout bloku
    out.push({
      id: "frozen-" + run.i, step: run.i, dev: d.id,
      label: tr("Krok {n}: {dev} bez zpětného hlášení", { n: run.i + 1, dev: d.name }),
      purpose: tr("výpadek zpětného hlášení {dev} při akci „{title}“", { dev: d.name, title: stepTitle(prj, s) }),
      opts: { ...base, faults: [{ kind: "frozen", dev: d.id, at: run.tStart }], maxTime: run.tStart + limit + 3 },
    });
    if (!recover && nominal.cycleTime) {
      const until = round1(run.tStart + limit + 1);
      recover = {
        id: "recover", step: run.i, dev: d.id,
        label: tr("Kvitace a nový cyklus po poruše (krok {n})", { n: run.i + 1 }),
        purpose: tr("závada {dev} v kroku {n}, po odstranění kvitace ({t} s) a nový start", { dev: d.name, n: run.i + 1, t: round1(until + 0.5) }),
        opts: {
          ...base, maxTime: until + 2 + nominal.cycleTime + valveMargin(nominal) + 3,
          faults: [{ kind: "frozen", dev: d.id, at: run.tStart, until }, { kind: "ack", at: round1(until + 0.5) }, { kind: "start", at: round1(until + 2) }],
        },
      };
    }
  }
  const seen = new Set<number>();
  for (const run of nominal.steps) {
    const s = seq[run.i], d = devById(prj, s.dev);
    const drive = d && (d.cls === "Vfd" && s.act === "start" || d.cls === "PosDrive" && (s.act === "posRecord" || s.act === "home"));
    if (!d || !(d.cls === "Motor" && s.act === "start" || drive) || seen.has(d.id) || !ioOf(prj, d).fault) continue;
    seen.add(d.id);
    const at = round((run.tEnd ?? run.tStart) + 0.5);
    out.push({
      id: "fault-" + d.id, step: run.i, dev: d.id,
      label: d.cls === "Motor" ? tr("Porucha motoru {dev} za chodu", { dev: d.name }) : tr("Porucha pohonu {dev}", { dev: d.name }),
      purpose: tr("aktivace vstupu poruchy {dev} za chodu", { dev: d.name }),
      opts: { ...base, faults: [{ kind: "fault", dev: d.id, at }], maxTime: at + 4 },
    });
  }
  if (devById(prj, prj.program.estop) && nominal.cycleTime) {
    const at = round1(startAt + nominal.cycleTime / 2);
    out.push({
      id: "estop", label: tr("Nouzové zastavení v polovině cyklu"),
      purpose: tr("stisk E-stopu v čase {t} s, uvolnění po 2 s", { t: at }),
      opts: { ...base, faults: [{ kind: "estop", at, release: at + 2 }], maxTime: at + 6 },
    });
  }
  if (nominal.cycleTime) {
    const at = round1(startAt + nominal.cycleTime / 2);
    for (const d of interlockDevs(prj)) {
      out.push({
        id: "interlock-" + d.id, dev: d.id,
        label: tr("Rozpojení blokování {dev} v polovině cyklu", { dev: d.name }),
        purpose: tr("{dev} ({desc}) rozpojeno v čase {t} s, obnoveno po 2 s", { dev: d.name, desc: d.desc || d.name, t: at }),
        opts: { ...base, faults: [{ kind: "interlock", dev: d.id, at, until: at + 2 }], maxTime: at + 6 },
      });
    }
  }
  if (recover) out.push(recover);
  return out;
}

function valveMargin(r: SimResult): number { return r.opts.valveTravel + r.opts.motorDelay; }

/* ------------------------------------------------------------ ověření */

export interface SimCheck {
  level: "ok" | "info" | "warn" | "error";
  title: string;
  detail: string;
  /** Scénář, kterým lze nález přehrát. */
  scenario?: string;
  step?: number;
  dev?: number;
}

export interface VerifyResult {
  /** Žádný nález úrovně „error". */
  ok: boolean;
  checks: SimCheck[];
  scenarios: SimScenario[];
  nominal: SimResult | null;
  /** Matice stavů: klid a každý krok × každý zásah, s vyhodnocením reakce. */
  matrix: StateMatrix;
}

/* ------------------------------------------------------------ matice stavů */

export interface MatrixCol { id: string; label: string; }
export interface MatrixCell {
  /** true = reakce odpovídá konceptu, false = neodpovídá, null = kombinace nedává smysl. */
  ok: boolean | null;
  /** Krátký text do buňky (✔ / ✔ 0.5 s / ✖ / —). */
  text: string;
  detail: string;
  /** Scénář k přehrání (jen u zkoušených kombinací). */
  scenario?: SimScenario;
}
export interface MatrixRow { step: number; title: string; cells: Record<string, MatrixCell>; }
export interface StateMatrix { cols: MatrixCol[]; rows: MatrixRow[]; total: number; failed: number; }

/** Stav v čase `t` (poslední zaznamenaný snímek do `t`). */
function stateAt(r: SimResult, t: number): SimFrame | undefined {
  let last: SimFrame | undefined;
  for (const fr of r.frames) { if (fr.t <= t + 1e-9) last = fr; else break; }
  return last;
}

/**
 * Zařízení pro sloupce matice stavů (sdílí emulátor): porucha pohonu (motor, měnič, polohovací
 * pohon se vstupem poruchy), ztráta hlášení chodu (motor, měnič „otáčky dosaženy“), ztráta polohy
 * ventilu, ztráta „v poloze“ polohovacího pohonu, odchylka proporcionálního ventilu se zpětnou vazbou.
 */
export function matrixDevs(prj: Project): { fault: Device[]; lost: Device[]; lostv: Device[]; lostp: Device[]; dev: Device[] } {
  const io = (d: Device) => ioOf(prj, d);
  return {
    fault: prj.devices.filter(d => (d.cls === "Motor" || d.cls === "Vfd" || d.cls === "PosDrive") && io(d).fault),
    lost: prj.devices.filter(d => (d.cls === "Motor" && io(d).fbkRunning) || (d.cls === "Vfd" && io(d).atSpeed)),
    lostv: prj.devices.filter(d => d.cls === "Ventil" && io(d).fbkOpen),
    lostp: prj.devices.filter(d => d.cls === "PosDrive" && io(d).inPos),
    dev: prj.devices.filter(d => d.cls === "PropValve" && io(d).rawAct),
  };
}

/** DO, které znamenají pohyb (po zastavení stroje musí být FALSE): motor, ventil, měnič chod, pohon start / referování. */
export function motionOutKeys(prj: Project): string[] {
  return prj.io.filter(e => e.dir === "DO" && prj.devices.some(d => d.id === e.devId && (d.cls === "Motor" || d.cls === "Ventil"
    || (isMotionClass(d.cls) && (e.sig === "outRun" || e.sig === "outStart" || e.sig === "outHome"))))).map(e => e.key);
}

/**
 * Zamrzlé hlášení (zaseknutá mechanika) v kroku jde zjistit? Proporcionální ventil jen se zpětnou
 * vazbou a se změnou žádané výrazně nad toleranci (malou změnu zaseknutý ventil „splní“); ostatní ano.
 */
export function frozenDetectable(prj: Project, s: SeqStep, d: Device, nominal: SimResult, run: SimStepRun): boolean {
  if (d.cls !== "PropValve") return true;
  if (!ioOf(prj, d).rawAct) return false;
  const fr0 = stateAt(nominal, run.tStart - 1e-6);
  const before = fr0 && fr0.dev[d.id] && fr0.dev[d.id].value !== undefined ? fr0.dev[d.id].value! : d.rmin;
  return Math.abs(stepSp(s, d) - before) > 2 * tolOf(d) + Math.abs(d.rmax - d.rmin) * 0.002;
}
/** Lhůta, do které musí odchylka proporcionálního ventilu vyhlásit poruchu [s] (takty 0,1 s + scan + rezerva). */
export function devDeadline(d: Device, dt: number): number {
  return Math.round((tolTicksOf(d) * (T_TICK + dt) + 0.2) * 1000) / 1000;
}
/** Surová hodnota skutečné hodnoty daleko mimo toleranci kolem žádané `sp` (zásah „odchylka“). */
export function devFaultRaw(d: Device, sp: number): number {
  const span = (d.rmax - d.rmin) || 1, off = 3 * tolOf(d) + 0.1 * Math.abs(span);
  const v = sp + off <= d.rmax ? sp + off : Math.max(d.rmin, sp - off);
  return clampRaw((v - d.rmin) / span * 27648);
}

/**
 * Matice stavů: v klidu a v každém kroku sekvence se vyzkouší každý zásah (E-stop, blokování,
 * vypnutí AUTO, zamrzlé hlášení kroku, porucha a ztráta hlášení běžícího pohonu) a vyhodnotí
 * se proti konceptu (FDS): zásahy obsluhy a blokování zastaví stroj do 3 scanů a cyklus se
 * sám neobnoví; poruchy vyhlásí poruchu stroje, zastaví stroj a zablokují nový start.
 */
export function stateMatrix(prj: Project, base: SimOptions = {}, nominalRun?: SimResult, checkpoints?: Checkpoints): StateMatrix {
  const cps = checkpoints ?? new Checkpoints(prj, base);
  const seq = prj.program.seq;
  const cols: MatrixCol[] = [];
  const es = devById(prj, prj.program.estop);
  const locks = interlockDevs(prj);
  const mx = matrixDevs(prj);
  const faultMotors = mx.fault, lostMotors = mx.lost;
  if (es) cols.push({ id: "estop", label: tr("E-stop") });
  for (const d of locks) cols.push({ id: "lock-" + d.id, label: tr("blokování {dev}", { dev: d.name }) });
  cols.push({ id: "manual", label: tr("vypnutí AUTO") });
  cols.push({ id: "fbk", label: tr("zamrzlé hlášení kroku") });
  if (faultMotors.length) cols.push({ id: "fault", label: tr("porucha pohonu") });
  if (lostMotors.length) cols.push({ id: "lost", label: tr("ztráta hlášení chodu") });
  const lostValves = mx.lostv;
  if (lostValves.length) cols.push({ id: "lostv", label: tr("ztráta polohy ventilu") });
  if (mx.lostp.length) cols.push({ id: "lostp", label: tr("ztráta „v poloze“") });
  if (mx.dev.length) cols.push({ id: "dev", label: tr("odchylka skutečné hodnoty") });
  /* meze analogů: každá mez jako zkušební případ (hodnota 5 % rozsahu za mezí) */
  const limitCases: Array<{ d: Device; dir: "hi" | "lo"; raw: number; label: string }> = [];
  for (const d of limitedAnalogs(prj)) {
    const span = d.rmax - d.rmin || 1;
    const rawOf = (v: number) => clampRaw((v - d.rmin) / span * 27648);
    if (Number.isFinite(d.limHi)) {
      const v = Math.min(d.rmax, d.limHi! + 0.05 * span);
      if (v > d.limHi!) limitCases.push({ d, dir: "hi", raw: rawOf(v), label: d.name + "↑" });
    }
    if (Number.isFinite(d.limLo)) {
      const v = Math.max(d.rmin, d.limLo! - 0.05 * span);
      if (v < d.limLo!) limitCases.push({ d, dir: "lo", raw: rawOf(v), label: d.name + "↓" });
    }
  }
  if (limitCases.length) cols.push({ id: "limit", label: tr("analog mimo mez") });
  if (!seq.length) return { cols, rows: [], total: 0, failed: 0 };

  const nominal = nominalRun ?? simulate(prj, base);
  const dt = nominal.opts.dt, react = 3 * dt + 1e-9;
  const outs = motionOutKeys(prj);
  const tagOf = (k: string) => (prj.io.find(e => e.key === k) || { tag: k }).tag;
  const stopped = (fr: SimFrame | undefined) => !!fr && fr.step === -1 && outs.every(k => fr.io[k] !== true);
  const na: MatrixCell = { ok: null, text: "—", detail: "" };
  const mk = (id: string, label: string, purpose: string, opts: SimOptions): SimScenario => ({ id, label, purpose, opts });

  /* zásah obsluhy / blokování: stroj stojí do 3 scanů, po odeznění se sám nerozběhne */
  const evalStop = (sc: SimScenario, at: number, idle: boolean, mustRun = false): MatrixCell => {
    const r = cps.run(sc.opts);
    const after = stateAt(r, at + react), prior = stateAt(r, at - 1e-6);
    if (mustRun && !(prior && outs.some(k => prior.io[k] === true))) {
      return { ok: false, text: "✖", scenario: sc, detail: sc.purpose + ": " + tr("před zásahem nic neběželo — ruční povely nezabraly") };
    }
    const restarted = r.frames.some(fr => fr.t > at + react && (fr.step >= 0 || outs.some(k => fr.io[k] === true)));
    const left = after ? outs.filter(k => after.io[k] === true).map(tagOf) : [];
    if (stopped(after) && !restarted) {
      return {
        ok: true, text: "✔", scenario: sc,
        detail: idle ? tr("Start je zablokovaný, stroj zůstává v klidu.")
          : tr("Stroj zastaven do {ms} ms, výstupy vypnuté, sekvence v klidu; po odeznění čeká na nový start.", { ms: Math.round(react * 1000) }),
      };
    }
    const why: string[] = [];
    if (left.length) why.push(tr("sepnuté zůstávají: {tags}", { tags: left.join(", ") }));
    if (after && after.step >= 0 && !idle) why.push(tr("sekvence pokračuje v kroku {n}", { n: after.step + 1 }));
    if (restarted) why.push(idle ? tr("cyklus se přesto spustil") : tr("cyklus se sám znovu rozběhl"));
    return { ok: false, text: "✖", scenario: sc, detail: sc.purpose + ": " + (why.join("; ") || tr("stroj nezastavil")) };
  };
  /* zásah v několika okamžicích kroku (hned po vstupu, uprostřed pohybu, těsně před
     přechodem) — kryt se může otevřít v kterékoli fázi; buňka platí, jen když obstojí všechny */
  const instants = (run: SimStepRun): number[] => {
    const end = run.tEnd ?? run.tStart + 0.6;
    const pts = [run.tStart + 2 * dt, (run.tStart + end) / 2, end - 4 * dt].map(round)
      .filter(t => t > run.tStart + 1e-9 && t < end - 1e-9);
    return [...new Set(pts.length ? pts : [round(run.tStart + dt)])];
  };
  const evalStopAt = (ats: number[], build: (at: number) => SimScenario): MatrixCell => {
    let last: MatrixCell | null = null;
    for (const at of ats) {
      last = evalStop(build(at), at, false);
      if (!last.ok) return last;
    }
    return { ...last!, text: ats.length > 1 ? "✔ ×" + ats.length : "✔" };
  };
  /* porucha: porucha stroje do lhůty, stroj zastaven, nový start zablokovaný */
  const evalFault = (scs: SimScenario[], at: number, deadline: number): MatrixCell => {
    let worst = 0;
    for (const sc of scs) {
      const r = cps.run(sc.opts);
      const ok = r.faulted && r.faultT! <= deadline + 1e-9 && stopped(stateAt(r, r.faultT! + react))
        && !r.frames.some(fr => fr.t > r.faultT! + react && fr.step >= 0);
      if (!ok) {
        const why = !r.faulted ? tr("program poruchu nevyhlásí")
          : r.faultT! > deadline + 1e-9 ? tr("porucha až za {t} s", { t: round1(r.faultT! - at) })
          : tr("stroj po poruše nezastavil nebo se znovu rozběhl");
        return { ok: false, text: "✖", scenario: sc, detail: sc.purpose + ": " + why };
      }
      worst = Math.max(worst, r.faultT! - at);
    }
    const t = round1(Math.max(worst, 0));
    return { ok: true, text: "✔ " + t + " s", scenario: scs[0], detail: tr("Porucha stroje nejpozději za {t} s, stroj zastaven, nový start až po kvitaci.", { t }) };
  };

  const limitCell = (scs: SimScenario[], cases: typeof limitCases, at: number, deadline: number): MatrixCell => {
    const c = evalFault(scs, at, deadline);
    return c.ok ? { ...c, text: "✔ " + cases.map(x => x.label).join(" ") } : c;
  };

  const rows: MatrixRow[] = [];
  /* klid: zásah trvá, START nesmí zabrat */
  {
    const at = 0.3, start = 1.0, o = { ...base, startAt: start, maxTime: 2.5 };
    const cells: Record<string, MatrixCell> = {};
    const pre = tr("Klid");
    if (es) cells.estop = evalStop(mk("m-idle-estop", pre + " + " + tr("E-stop"), tr("E-stop stisknutý v klidu, pak START"), { ...o, faults: [{ kind: "estop", at }] }), at, true);
    for (const d of locks) cells["lock-" + d.id] = evalStop(mk("m-idle-lock-" + d.id, pre + " + " + tr("blokování {dev}", { dev: d.name }), tr("{dev} rozpojeno v klidu, pak START", { dev: d.name }), { ...o, faults: [{ kind: "interlock", dev: d.id, at }] }), at, true);
    cells.manual = evalStop(mk("m-idle-manual", pre + " + " + tr("vypnutí AUTO"), tr("AUTO vypnuto v klidu, pak START"), { ...o, faults: [{ kind: "manual", at }] }), at, true);
    cells.fbk = na;
    if (faultMotors.length) {
      cells.fault = evalFault(faultMotors.map(d => mk("m-idle-fault-" + d.id, pre + " + " + tr("porucha {dev}", { dev: d.name }),
        tr("vstup poruchy {dev} aktivní v klidu, pak START", { dev: d.name }), { ...o, faults: [{ kind: "fault", dev: d.id, at }] })), at, start);
    }
    if (lostMotors.length) cells.lost = na;
    if (lostValves.length) cells.lostv = na;
    if (mx.lostp.length) cells.lostp = na;
    if (mx.dev.length) cells.dev = na;
    if (limitCases.length) {
      const share = limitCases.filter((_c, k) => k % (nominal.steps.length + 1) === 0);
      cells.limit = limitCell(share.map(lc => mk("m-idle-lim-" + lc.d.id + lc.dir, pre + " + " + lc.label,
        tr("{dev} mimo mez ({dir}) v klidu, pak START", { dev: lc.d.name, dir: lc.dir === "hi" ? "↑" : "↓" }),
        { ...o, faults: [{ kind: "analog", dev: lc.d.id, at, raw: lc.raw }] })), share, at, start);
    }
    rows.push({ step: -1, title: pre, cells });
  }
  /* ruční režim: AUTO vypnuto, pohony spuštěné ručními povely; E-stop a blokování je musí
     vypnout a po odeznění se samy znovu nerozběhnou (povel potřebuje novou hranu) */
  {
    const acts = prj.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil" || isMotionClass(d.cls));
    if (acts.length) {
      const at = 2.0, man = acts.map(d => ({ kind: "man" as const, dev: d.id, at: 0.5 }));
      const o = { ...base, startAt: 99, maxTime: at + 1.4 };
      const cells: Record<string, MatrixCell> = {};
      const pre = tr("Ruční režim");
      const lab = (what: string) => pre + " + " + what;
      if (es) cells.estop = evalStop(mk("m-man-estop", lab(tr("E-stop")), tr("ruční povely všech pohonů, E-stop v čase {t} s, uvolnění po 1 s", { t: at }),
        { ...o, faults: [{ kind: "manual", at: 0.1 }, ...man, { kind: "estop", at, release: at + 1 }] }), at, false, true);
      for (const d of locks) cells["lock-" + d.id] = evalStop(mk("m-man-lock-" + d.id, lab(tr("blokování {dev}", { dev: d.name })),
        tr("ruční povely všech pohonů, {dev} rozpojeno v čase {t} s, obnoveno po 1 s", { dev: d.name, t: at }),
        { ...o, faults: [{ kind: "manual", at: 0.1 }, ...man, { kind: "interlock", dev: d.id, at, until: at + 1 }] }), at, false, true);
      for (const col of cols) if (!cells[col.id]) cells[col.id] = na;
      rows.push({ step: -2, title: pre, cells });
    }
  }
  /* kroky sekvence (první průchod v běžném cyklu) */
  const seen = new Set<number>();
  let rowNo = 1;
  for (const run of nominal.steps) {
    if (seen.has(run.i)) continue;
    seen.add(run.i);
    const st = seq[run.i], title = tr("Krok {n}: {title}", { n: run.i + 1, title: stepTitle(prj, st) });
    const dur = (run.tEnd ?? run.tStart + 0.6) - run.tStart;
    const at = round(run.tStart + Math.min(0.3, Math.max(dt, dur / 2)));
    const cells: Record<string, MatrixCell> = {};
    const lab = (what: string) => tr("Krok {n}", { n: run.i + 1 }) + " + " + what;
    const id = (k: string) => "m-" + run.i + "-" + k;
    const ats = instants(run);
    const sfx = (a: number) => ats.length > 1 ? "-" + ats.indexOf(a) : "";
    if (es) cells.estop = evalStopAt(ats, a => mk(id("estop") + sfx(a), lab(tr("E-stop")), tr("E-stop v kroku {n} (t = {t} s), uvolnění po 1 s", { n: run.i + 1, t: a }),
      { ...base, faults: [{ kind: "estop", at: a, release: a + 1 }], maxTime: a + 1.4 }));
    for (const d of locks) cells["lock-" + d.id] = evalStopAt(ats, a => mk(id("lock-" + d.id) + sfx(a), lab(tr("blokování {dev}", { dev: d.name })),
      tr("{dev} rozpojeno v kroku {n} (t = {t} s), obnoveno po 1 s", { dev: d.name, n: run.i + 1, t: a }),
      { ...base, faults: [{ kind: "interlock", dev: d.id, at: a, until: a + 1 }], maxTime: a + 1.4 }));
    cells.manual = evalStopAt(ats, a => mk(id("manual") + sfx(a), lab(tr("vypnutí AUTO")), tr("AUTO vypnuto v kroku {n} (t = {t} s), zapnuto po 1 s", { n: run.i + 1, t: a }),
      { ...base, faults: [{ kind: "manual", at: a, until: a + 1 }], maxTime: a + 1.4 }));
    const d0 = devById(prj, st.dev), cnd = seqCond(prj, st);
    /* podmínka platí už při vstupu do kroku (např. „čekat na FALSE" u vstupu, který je FALSE):
       zaseknutý snímač drží správnou hodnotu → poruchu vyvolat nemůže, kombinace nemá smysl */
    const instant = run.tEnd !== null && run.tEnd - run.tStart <= 2 * dt + 1e-9;
    if (d0 && cnd.kind === "fbk" && !instant && frozenDetectable(prj, st, d0, nominal, run)) {
      const deadline = round(run.tStart + (st.timeS || 1) + T_VALVE_TRAVEL + 0.1);
      cells.fbk = evalFault([mk(id("fbk"), lab(tr("zamrzlé hlášení {dev}", { dev: d0.name })),
        tr("zpětné hlášení {dev} zamrzne na začátku kroku {n}, pak START", { dev: d0.name, n: run.i + 1 }),
        { ...base, faults: [{ kind: "frozen", dev: d0.id, at: run.tStart }, { kind: "start", at: deadline }], maxTime: deadline + 1.5 })], run.tStart, deadline);
    } else cells.fbk = na;
    const fr = stateAt(nominal, at);
    const runningF = faultMotors.filter(d => fr && fr.dev[d.id] && fr.dev[d.id].step >= 10 && fr.dev[d.id].step < 90);
    const runningL = lostMotors.filter(d => fr && fr.dev[d.id] && fr.dev[d.id].step === 20);
    if (faultMotors.length) cells.fault = runningF.length ? evalFault(runningF.map(d => mk(id("fault-" + d.id), lab(tr("porucha {dev}", { dev: d.name })),
      tr("vstup poruchy {dev} v kroku {n} (t = {t} s), pak START", { dev: d.name, n: run.i + 1, t: at }),
      { ...base, faults: [{ kind: "fault", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 })), at, at + 0.5) : na;
    if (lostMotors.length) cells.lost = runningL.length ? evalFault(runningL.map(d => mk(id("lost-" + d.id), lab(tr("ztráta hlášení {dev}", { dev: d.name })),
      tr("hlášení chodu {dev} vypadne v kroku {n} (t = {t} s), pak START", { dev: d.name, n: run.i + 1, t: at }),
      { ...base, faults: [{ kind: "lost", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 })), at, at + 0.5) : na;
    const runningV = lostValves.filter(d => fr && fr.dev[d.id] && fr.dev[d.id].step === 20);
    if (lostValves.length) cells.lostv = runningV.length ? evalFault(runningV.map(d => mk(id("lostv-" + d.id), lab(tr("ztráta polohy {dev}", { dev: d.name })),
      tr("koncák „otevřeno“ {dev} vypadne v kroku {n} (t = {t} s), pak START", { dev: d.name, n: run.i + 1, t: at }),
      { ...base, faults: [{ kind: "lost", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 })), at, at + 0.5) : na;
    /* polohovací pohon stojí v dosažené poloze → ztráta „v poloze“ = porucha */
    const atPos = mx.lostp.filter(d => fr && fr.dev[d.id] && fr.dev[d.id].step === 0 && fr.dev[d.id].done);
    if (mx.lostp.length) cells.lostp = atPos.length ? evalFault(atPos.map(d => mk(id("lostp-" + d.id), lab(tr("ztráta „v poloze“ {dev}", { dev: d.name })),
      tr("hlášení „v poloze“ {dev} vypadne v kroku {n} (t = {t} s), pak START", { dev: d.name, n: run.i + 1, t: at }),
      { ...base, faults: [{ kind: "lost", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 })), at, at + 0.5) : na;
    /* proporcionální ventil v toleranci → skutečná hodnota mimo toleranci = porucha po nastavené době */
    const inTol = mx.dev.filter(d => fr && fr.dev[d.id] && fr.dev[d.id].step === 20);
    if (mx.dev.length) {
      const wait = Math.max(0, ...inTol.map(d => devDeadline(d, dt)));
      cells.dev = inTol.length ? evalFault(inTol.map(d => mk(id("dev-" + d.id), lab(tr("odchylka {dev}", { dev: d.name })),
        tr("skutečná hodnota {dev} mimo toleranci v kroku {n} (t = {t} s), pak START", { dev: d.name, n: run.i + 1, t: at }),
        { ...base, faults: [{ kind: "analog", dev: d.id, at, raw: devFaultRaw(d, fr!.dev[d.id].cmd ?? d.rmin) }, { kind: "start", at: round(at + wait + 0.5) }], maxTime: round(at + wait + 0.9) })), at, round(at + wait)) : na;
    }
    if (limitCases.length) {
      const share = limitCases.filter((_c, k) => k % (nominal.steps.length + 1) === rowNo);
      cells.limit = share.length ? limitCell(share.map(lc => mk(id("lim-" + lc.d.id + lc.dir), lab(lc.label),
        tr("{dev} mimo mez ({dir}) v kroku {n} (t = {t} s), pak START", { dev: lc.d.name, dir: lc.dir === "hi" ? "↑" : "↓", n: run.i + 1, t: at }),
        { ...base, faults: [{ kind: "analog", dev: lc.d.id, at, raw: lc.raw }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 })), share, at, at + 0.5) : na;
    }
    rowNo++;
    rows.push({ step: run.i, title, cells });
  }
  let total = 0, failed = 0;
  for (const r of rows) for (const c of Object.values(r.cells)) { if (c.ok !== null) { total++; if (!c.ok) failed++; } }
  return { cols, rows, total, failed };
}

/* ------------------------------------------------------------ koncept zařízení */

/** Statická kontrola konceptu: má každé zařízení v programu svou roli? */
function conceptChecks(prj: Project): SimCheck[] {
  const out: SimCheck[] = [], extra: SimCheck[] = [];
  const seq = prj.program.seq;
  const used = new Set(enableInputs(prj).map(x => x.dev.id));
  for (const s of seq) if (isDiWait(s)) used.add(s.dev);
  const inSeq = new Set(seq.filter(s => s.act !== "wait" && !isDiWait(s)).map(s => s.dev));
  for (const d of prj.devices) {
    const p = { dev: d.name, desc: d.desc || tr(CLS[d.cls].label) };
    if (d.cls === "DI" && !used.has(d.id)) {
      out.push({ level: "warn", dev: d.id, title: tr("Vstup {dev} ({desc}) program nečte", p), detail: tr("Signál je jen mezi volnými signály — na jeho stav stroj nereaguje. Pokud jde o kryt, závoru nebo jiné uvolnění, zařaď ho do blokovacích vstupů; jinak (tlačítko, podmínka kroku, hlídání zásobníku) doplň logiku ručně.") });
    } else if (d.cls === "DO" && !d.role) {
      out.push({ level: "warn", dev: d.id, title: tr("Výstup {dev} ({desc}) program neovládá", p), detail: tr("Výstup zůstává trvale FALSE — signalizaci nebo akci (maják, houkačka, zámek) je potřeba napojit na stav stroje ručně (např. chod = sekvence běží, porucha = machineFault).") });
    } else if (d.cls === "AnalogIn" && !Number.isFinite(d.limHi) && !Number.isFinite(d.limLo)) {
      out.push({ level: "info", dev: d.id, title: tr("Měření {dev} ({desc}) se jen zobrazuje", p), detail: tr("Meze limitHi / limitLo nejsou nastavené a program na hodnotu nereaguje (žádný alarm ani podmínka kroku). Doplň meze podle technologie.") });
    } else if (d.cls === "AnalogOut" && !Number.isFinite(d.setpoint)) {
      out.push({ level: "warn", dev: d.id, title: tr("Žádaná hodnota {dev} ({desc}) není zadána", p), detail: tr("Výstup má v kódu TODO — bez žádané hodnoty zůstává na 0. Doplň zdroj (HMI, receptura, regulace).") });
    } else if ((d.cls === "Motor" || d.cls === "Ventil" || isMotionClass(d.cls)) && seq.length && !inSeq.has(d.id)) {
      out.push({ level: "warn", dev: d.id, title: tr("Zařízení {dev} ({desc}) automatický cyklus nepoužívá", p), detail: tr("V režimu AUTO stojí; ovládá se jen ručním povelem. Pokud má v cyklu pracovat, doplň krok sekvence.") });
    }
    /* pohony fáze 2a: referování, zpětná vazba */
    if (d.cls === "PosDrive" && seq.length) {
      const iMove = seq.findIndex(s => s.dev === d.id && s.act === "posRecord"), iHome = seq.findIndex(s => s.dev === d.id && s.act === "home");
      if (iMove >= 0 && (iHome < 0 || iHome > iMove))
        extra.push({ level: "warn", dev: d.id, title: tr("Pohon {dev} ({desc}) jede na záznam bez referenční jízdy v cyklu", p), detail: tr("Blok odmítne jízdu bez referování (porucha „bez referování“). Doplň krok „referenční jízda“ před první jízdu, nebo pohon referuj ručně (manHome_{dev}) po každém zapnutí.", { dev: d.name }) });
    }
    if (d.cls === "PropValve" && !ioOf(prj, d).rawAct)
      extra.push({ level: "info", dev: d.id, title: tr("Proporcionální ventil {dev} ({desc}) bez zpětné vazby", p), detail: tr("Skutečná hodnota se neměří — krok přejde po doběhu rampy a odchylka se nehlídá. Pro hlídání tlaku / průtoku zapni analogovou zpětnou vazbu.") });
    if (d.cls === "Vfd" && !ioOf(prj, d).atSpeed)
      extra.push({ level: "info", dev: d.id, title: tr("Měnič {dev} ({desc}) bez hlášení „otáčky dosaženy“", p), detail: tr("Krok rozběhu přejde po doběhu rampy v PLC bez potvrzení měničem a ztráta otáček za chodu se nezjistí. Doporučeno: reléový výstup měniče „frequency reached“ na vstup PLC.") });
  }
  const roles = out.filter(c => c.level === "warn").length;
  out.unshift(roles
    ? { level: "warn", title: tr("Koncept stroje není v programu pokrytý celý ({n} zařízení bez funkce)", { n: roles }), detail: tr("Některá zařízení z návrhu program nečte nebo neovládá — stroj tak nedělá všechno, co popis slibuje. Seznam je v nálezech níže; doplň je do blokování, sekvence nebo vlastní logiky.") }
    : { level: "ok", title: tr("Každé zařízení má v programu svou roli"), detail: tr("Všechny vstupy program čte, všechny výstupy a pohony ovládá.") });
  for (const x of enableInputs(prj)) {
    if (!x.estop && !x.io.nc) out.push({ level: "warn", dev: x.dev.id, title: tr("Blokování {dev} není rozpínací kontakt (NC)", { dev: x.dev.name }), detail: tr("Program čeká TRUE = v pořádku. U spínacího kontaktu by přerušený vodič vypadal jako zavřený kryt / volná závora — použij NC a označ vstup v kroku I/O.") });
  }
  return [...out, ...extra];
}

/* Ověření je drahé (stovky simulací) a dokumentace ho volá opakovaně — výsledek se drží
   pro posledních pár kombinací projekt × volby × jazyk. */
const verifyCache = new Map<string, VerifyResult>();

export function verifyProject(prj: Project, base: SimOptions = {}): VerifyResult {
  const key = JSON.stringify([prj, base, getLang()]);
  const hit = verifyCache.get(key);
  if (hit) return hit;
  const res = verifyUncached(prj, base);
  verifyCache.set(key, res);
  if (verifyCache.size > 6) verifyCache.delete(verifyCache.keys().next().value as string);
  return res;
}

function verifyUncached(prj: Project, base: SimOptions): VerifyResult {
  const checks: SimCheck[] = [];
  const seq = prj.program.seq;
  const tagOf = (key: string) => (prj.io.find(e => e.key === key) || { tag: key }).tag;
  const scenarios = simScenarios(prj, base);

  const estop = devById(prj, prj.program.estop);
  if (!estop) {
    checks.push({ level: "warn", title: tr("Není zvoleno centrální uvolnění (E-stop)"), detail: tr("Signál enable je trvale TRUE — program stroj na žádný vstup nezastaví. Zvol vstup v kroku Program.") });
  } else {
    const e = ioOf(prj, estop).in || Object.values(ioOf(prj, estop))[0];
    if (e && !e.nc) checks.push({ level: "warn", dev: estop.id, title: tr("E-stop {dev} není označen jako NC", { dev: estop.name }), detail: tr("Program čeká TRUE = v pořádku (rozpínací kontakt). U spínacího kontaktu by přerušený vodič stroj nezastavil — označ vstup jako NC v kroku I/O.") });
  }

  if (!seq.length) {
    checks.push({ level: "info", title: tr("Projekt nemá automatickou sekvenci"), detail: tr("Není co simulovat — zařízení se ovládají jen ručními povely z HMI (manRun_* / manOpen_*).") });
    checks.push(...conceptChecks(prj));
    return { ok: !checks.some(c => c.level === "error"), checks, scenarios, nominal: null, matrix: stateMatrix(prj, base) };
  }

  for (const [i, s] of seq.entries()) {
    const d = devById(prj, s.dev);
    if (s.act === "wait") continue;
    if (!d) { checks.push({ level: "error", step: i, title: tr("Krok {n} odkazuje na neexistující zařízení", { n: i + 1 }), detail: tr("Krok se v programu přeskočí (podmínka TRUE). Oprav sekvenci v kroku Program.") }); continue; }
    if (s.cond === "fbk" && seqCond(prj, s).kind === "none") {
      checks.push({ level: "warn", step: i, dev: d.id, title: tr("Krok {n} ({title}) se nepotvrzuje", { n: i + 1, title: stepTitle(prj, s) }), detail: tr("Přechod je nastaven na zpětné hlášení, ale {dev} ho pro tuto akci nemá — krok přejde okamžitě, aniž se akce provedla. Doplň snímač, nebo přechod časem.", { dev: d.name }) });
    }
  }

  /* 1) běžný cyklus */
  const nominal = simulate(prj, base);
  const model = tr("model: rozběh motoru {motor} s, přestavení ventilu {valve} s", { motor: nominal.opts.motorDelay, valve: nominal.opts.valveTravel });
  if (nominal.ok) {
    checks.push({ level: "ok", scenario: "nominal", title: tr("Běžný cyklus doběhne do konce"), detail: tr("Všech {n} kroků proběhlo, doba cyklu {t} s ({model}).", { n: seq.length, t: nominal.cycleTime, model }) });
  } else if (nominal.faulted) {
    checks.push({ level: "error", scenario: "nominal", step: nominal.faultStep ?? undefined, title: tr("Běžný cyklus skončí poruchou: {cause}", { cause: nominal.faultCause }), detail: tr("Bez jakékoli závady program vyhlásí poruchu v čase {t} s ({model}). Hlídací čas kroku nebo timeout bloku (motor {motor} s, ventil {valve} s) je kratší než skutečná doba akce — prodluž čas kroku, nebo uprav model stroje.", { t: nominal.faultT, model, motor: T_MOTOR_FBK, valve: T_VALVE_TRAVEL }) });
  } else {
    checks.push({ level: "error", scenario: "nominal", step: nominal.stalledStep ?? undefined, title: tr("Běžný cyklus nedoběhne"), detail: nominal.stalledStep !== null ? tr("Sekvence zůstane stát v kroku {n} ({title}).", { n: nominal.stalledStep + 1, title: stepTitle(prj, seq[nominal.stalledStep]) }) : tr("Sekvence se nespustila.") });
  }
  /* časové hledisko */
  const takt = prj.meta.takt;
  if (nominal.finished && nominal.cycleTime !== null) {
    const slow = nominal.steps.filter(r => r.tEnd !== null).map(r => ({ i: r.i, d: round(r.tEnd! - r.tStart) }))
      .sort((a, b) => b.d - a.d).slice(0, 3).map(x => tr("krok {n} ({title}) {t} s", { n: x.i + 1, title: stepTitle(prj, seq[x.i]), t: x.d })).join(", ");
    if (takt && takt > 0) {
      checks.push(nominal.cycleTime <= takt + 1e-9
        ? { level: "ok", scenario: "nominal", title: tr("Cyklus {t} s splňuje takt {takt} s", { t: nominal.cycleTime, takt }), detail: tr("Rezerva {r} s. Nejdelší kroky: {slow}.", { r: round(takt - nominal.cycleTime), slow }) }
        : { level: "error", scenario: "nominal", title: tr("Takt {takt} s překročen: cyklus trvá {t} s", { t: nominal.cycleTime, takt }), detail: tr("Chybí {r} s. Nejdelší kroky: {slow}. Zkrať výdrže, zrychli pohyby, nebo uprav takt.", { r: round(nominal.cycleTime - takt), slow }) });
    } else {
      checks.push({ level: "info", scenario: "nominal", title: tr("Cílový takt není zadán (cyklus {t} s)", { t: nominal.cycleTime }), detail: tr("Zadej požadovanou dobu cyklu v kroku Projekt — ověření ji pak porovná se simulací. Nejdelší kroky: {slow}.", { slow }) });
    }
  }
  for (const r of nominal.steps) {
    const st = seq[r.i], wd = stepWatchdog(prj, st);
    if (wd === null || r.tEnd === null) continue;
    const d = round(r.tEnd - r.tStart);
    if (d > 0.8 * wd) checks.push({ level: "warn", step: r.i, scenario: "nominal", title: tr("Krok {n} ({title}): malá rezerva hlídacího času", { n: r.i + 1, title: stepTitle(prj, st) }), detail: tr("Akce trvá {d} s, hlídací čas je {wd} s (rezerva {pct} %). Při běžném rozptylu hrozí falešná porucha — prodluž hlídací čas.", { d, wd, pct: Math.round((1 - d / wd) * 100) }) });
  }

  if (nominal.finished && nominal.cycleTime) {
    const again = round1((base.startAt ?? 0.2) + nominal.cycleTime + 1);
    const r2 = simulate(prj, { ...base, faults: [{ kind: "start", at: again }], maxTime: again + nominal.cycleTime + 3 });
    const same = r2.cycles >= 2 && r2.lastCycleTime !== null && Math.abs(r2.lastCycleTime - nominal.cycleTime) < 0.1 && !r2.faulted;
    const broken = r2.faulted || r2.cycles < 2;
    checks.push(same
      ? { level: "ok", scenario: "nominal", title: tr("Druhý cyklus proběhne stejně ({t} s)", { t: r2.lastCycleTime }), detail: tr("Po dokončení cyklu a novém STARTu proběhl další cyklus se stejnou dobou — stroj se po cyklu vrací do výchozího stavu.") }
      : broken
        ? { level: "error", title: tr("Druhý cyklus neproběhne"), detail: r2.faulted ? tr("Při druhém cyklu vznikla porucha: {cause}.", { cause: r2.faultCause }) : tr("Po novém STARTu cyklus nedoběhl — stroj po prvním cyklu nezůstal ve výchozím stavu.") }
        : { level: "warn", title: tr("Druhý cyklus trvá jinak ({t} s místo {t0} s)", { t: r2.lastCycleTime, t0: nominal.cycleTime }), detail: tr("Stroj po prvním cyklu nezačíná z výchozího stavu (např. pohony zůstaly v chodu) — další cykly se chovají jinak než první. Pokud to není záměr, vrať akční členy na konci cyklu do výchozího stavu.") });
  }
  if (nominal.finished && nominal.outputsOn.length) {
    checks.push({ level: "warn", scenario: "nominal", title: tr("Po skončení cyklu zůstávají sepnuté výstupy"), detail: tr("{tags} — sekvence je nevypíná. Pokud to není záměr, doplň kroky stop/zavřít.", { tags: nominal.outputsOn.map(tagOf).join(", ") }) });
  }

  /* 2) koncept zařízení a matice stavů */
  checks.push(...conceptChecks(prj));
  const cps = new Checkpoints(prj, base);
  const matrix = stateMatrix(prj, base, nominal, cps);
  if (matrix.total) {
    if (!matrix.failed) {
      checks.push({ level: "ok", title: tr("Všechny stavy odpovídají konceptu ({n} kombinací)", { n: matrix.total }), detail: tr("V klidu a v každém kroku byl vyzkoušen každý zásah ({cols}); stroj vždy zastavil, poruchy byly vyhlášeny a nový start byl zablokovaný.", { cols: matrix.cols.map(c => c.label).join(", ") }) });
    } else {
      for (const row of matrix.rows) for (const col of matrix.cols) {
        const cell = row.cells[col.id];
        if (!cell || cell.ok !== false || !cell.scenario) continue;
        scenarios.push(cell.scenario);
        checks.push({ level: "error", scenario: cell.scenario.id, step: row.step >= 0 ? row.step : undefined, title: tr("{state} + {what}: neodpovídá konceptu", { state: row.title, what: col.label }), detail: cell.detail });
      }
    }
  }

  /* 3) poruchy, E-stop, kvitace */
  const roleKeys = new Set(prj.devices.filter(d => d.cls === "DO" && d.role).flatMap(d => Object.values(ioOf(prj, d)).map(e => e.key)));
  /* výstupy pohonů, které pohyb nespouští (povolení, výběr záznamu, HALT, směr, kvitace) — po uvolnění smí být zase TRUE */
  for (const d of prj.devices) if (isMotionClass(d.cls)) for (const e of Object.values(ioOf(prj, d))) if (e.dir === "DO" && !motionOutKeys(prj).includes(e.key)) roleKeys.add(e.key);
  for (const sc of scenarios) {
    if (sc.id === "nominal") continue;
    const r = cps.run(sc.opts);
    const d = devById(prj, sc.dev ?? 0);
    const left = r.outputsOn.map(tagOf);
    const at = (sc.opts.faults![0] as { at: number }).at;
    if (sc.id === "estop") {
      const after = r.frames.filter(fr => fr.t > at + 2 * r.opts.dt);
      const live = prj.io.filter(e => e.dir === "DO" && !roleKeys.has(e.key) && after.some(fr => fr.io[e.key] === true)).map(e => e.tag);
      const restarted = after.some(fr => fr.step >= 0);
      if (!live.length && !restarted) checks.push({ level: "ok", scenario: sc.id, title: tr("Nouzové zastavení vypne výstupy a cyklus se sám neobnoví"), detail: tr("Po stisku v čase {t} s jsou všechny výstupy bloků FALSE do jednoho scanu, sekvence je v kroku 0 a po uvolnění čeká na nový start. Pozor: skutečnou bezpečnost zajišťuje safety technika, ne program.", { t: at }) });
      else checks.push({ level: "error", scenario: sc.id, title: tr("Nouzové zastavení stroj spolehlivě nezastaví"), detail: (live.length ? tr("Po stisku zůstávají sepnuté: {tags}.", { tags: live.join(", ") }) + " " : "") + (restarted ? tr("Sekvence se po uvolnění sama znovu rozběhla.") : "") });
      continue;
    }
    if (sc.id.startsWith("interlock-") && d) {
      const after = r.frames.filter(fr => fr.t > at + 2 * r.opts.dt);
      const live = prj.io.filter(e => e.dir === "DO" && !roleKeys.has(e.key) && after.some(fr => fr.io[e.key] === true)).map(e => e.tag);
      const restarted = after.some(fr => fr.step >= 0);
      if (!live.length && !restarted) checks.push({ level: "ok", scenario: sc.id, dev: d.id, title: tr("Rozpojení blokování {dev} zastaví stroj a cyklus se sám neobnoví", { dev: d.name }), detail: tr("{dev} ({desc}) rozpojeno v čase {t} s: výstupy bloků vypnuté do jednoho scanu, sekvence v kroku 0; po obnovení stroj čeká na nový start.", { dev: d.name, desc: d.desc || d.name, t: at }) });
      else checks.push({ level: "error", scenario: sc.id, dev: d.id, title: tr("Rozpojení blokování {dev} stroj nezastaví", { dev: d.name }), detail: (live.length ? tr("Po rozpojení zůstávají sepnuté: {tags}.", { tags: live.join(", ") }) + " " : "") + (restarted ? tr("Sekvence se po obnovení sama znovu rozběhla.") : "") });
      continue;
    }
    if (sc.id === "recover") {
      if (r.finished && !r.fault) checks.push({ level: "ok", scenario: sc.id, dev: sc.dev, step: sc.step, title: tr("Po odstranění závady a kvitaci proběhne nový cyklus"), detail: tr("Porucha ({cause}) držela do kvitace; po kvitaci a novém startu cyklus doběhl za {t} s.", { cause: r.faultCause, t: r.cycleTime }) });
      else checks.push({ level: "error", scenario: sc.id, dev: sc.dev, step: sc.step, title: tr("Po kvitaci se cyklus neobnoví"), detail: (r.fault ? (r.errors.length ? tr("Porucha stroje po kvitaci stále drží (blok v poruše).") : tr("Porucha stroje po kvitaci stále drží.")) + " " : "") + (r.finished ? "" : tr("Nový cyklus nedoběhl.")) });
      continue;
    }
    if (!d) continue;
    /* podmět nálezu (1. pád) — dosazuje se do titulků níže jako {what} */
    const what = sc.id.startsWith("fault-") ? (d.cls === "Motor" ? tr("Porucha motoru {dev} za chodu", { dev: d.name }) : tr("Porucha pohonu {dev}", { dev: d.name })) : tr("Krok {n}: výpadek hlášení {dev}", { n: sc.step! + 1, dev: d.name });
    if (!r.faulted) {
      const p = { n: (r.stalledStep ?? 0) + 1, tags: left.join(", ") };
      const detail = r.stalledStep !== null
        ? (left.length ? tr("Program závadu nezachytí, sekvence zůstane stát v kroku {n}; sepnuté zůstávají: {tags}.", p) : tr("Program závadu nezachytí, sekvence zůstane stát v kroku {n}.", p))
        : (left.length ? tr("Program závadu nezachytí; sepnuté zůstávají: {tags}.", p) : tr("Program závadu nezachytí."));
      checks.push({ level: "error", scenario: sc.id, dev: d.id, step: sc.step, title: tr("{what} nevyvolá poruchu stroje", { what }), detail });
    } else {
      /* cyklus dokončený ještě PŘED poruchou není chyba (motor spuštěný posledním krokem) */
      const ranOn = r.finished && r.opts.startAt + r.cycleTime! > r.faultT! + 1e-9;
      const after = round1(r.faultT! - at);
      if (left.length || ranOn) {
        checks.push({ level: "error", scenario: sc.id, dev: d.id, step: sc.step, title: tr("{what} → porucha, ale stroj nezastaví", { what }), detail: tr("Porucha: {cause}.", { cause: r.faultCause }) + (left.length ? " " + tr("Sepnuté zůstávají: {tags}.", { tags: left.join(", ") }) : "") + (ranOn ? " " + tr("Cyklus přesto doběhl.") : "") });
      } else {
        checks.push({ level: "ok", scenario: sc.id, dev: d.id, step: sc.step, title: after < 0.1 ? tr("{what} → porucha stroje okamžitě", { what }) : tr("{what} → porucha stroje po {t} s", { what, t: after }), detail: tr("Příčina: {cause}. Sekvence se vrátila do kroku 0, všechny výstupy jsou vypnuté a nový start je možný až po kvitaci.", { cause: r.faultCause }) });
      }
    }
  }

  return { ok: !checks.some(c => c.level === "error"), checks, scenarios, nominal, matrix };
}

/** Protokol o ověření simulací (Markdown do dokumentace projektu). */
export function docVerifyMd(prj: Project): string {
  const v = verifyProject(prj);
  const seq = prj.program.seq;
  const icon = { ok: "✔", info: "ℹ", warn: "⚠", error: "✖" } as const;
  const n = (lvl: string) => v.checks.filter(c => c.level === lvl).length;
  let s = "# " + tr("Ověření programu simulací procesu") + "\n\n" + tr("**Projekt:** {name} · generováno nástrojem PLCdesk", { name: prj.meta.name || "—" }) + "\n\n";
  const counts = { ok: n("ok"), warn: n("warn"), error: n("error") };
  s += (v.ok ? tr("**Výsledek:** bez chyb — {ok} v pořádku, {warn} upozornění, {error} chyb", counts)
    : tr("**Výsledek:** NALEZENY CHYBY — {ok} v pořádku, {warn} upozornění, {error} chyb", counts)) + "\n\n";
  s += "## 1. " + tr("Co simulace ověřuje") + "\n" + tr("Simulátor provádí scan po scanu logiku generovaných bloků (stavové automaty FB_Motor a FB_Ventil, timeouty {motor} s a {valve} s, sekvence CASE s hlídáním času kroků, porucha stroje a kvitace) proti modelu stroje.", { motor: T_MOTOR_FBK, valve: T_VALVE_TRAVEL }) + "\n";
  if (v.nominal) s += tr("Model stroje: zpětné hlášení motoru přijde {motor} s po sepnutí, ventil / válec se přestaví za {valve} s, scan {scan} ms.", { motor: v.nominal.opts.motorDelay, valve: v.nominal.opts.valveTravel, scan: v.nominal.opts.dt * 1000 }) + "\n";
  if (prj.devices.some(d => isMotionClass(d.cls))) s += tr("Pohony a proporcionální prvky: bloky FB_Vfd / FB_PosDrive / FB_PropValve (rampa v PLC po taktech 0,1 s, potvrzení startu, hlídání odchylky). Model: měnič dosáhne otáček rychlostí celého rozsahu za dobu rozběhu motoru, polohovací pohon dojede za dobu jízdy zadanou u zařízení, skutečná hodnota ventilu sleduje žádanou po rampě; zamrzlé zařízení = zaseknutá mechanika.") + "\n";
  s += "\n" + tr("**Neověřuje** kód přeložený v cílovém IDE, HW konfiguraci, komunikaci ani bezpečnostní funkce. Nenahrazuje test v simulátoru platformy (PLCSIM, Logix Echo…) ani FAT.") + "\n\n";
  if (v.nominal && seq.length) {
    s += "## 2. " + tr("Běžný cyklus") + "\n" + tr("| Krok | Akce | Přechod | Hlídací čas [s] | Začátek [s] | Trvání [s] |") + "\n|---|---|---|---|---|---|\n";
    for (const [i, st] of seq.entries()) {
      const run = v.nominal.steps.find(r => r.i === i);
      s += "| " + (i + 1) + " | " + stepTitle(prj, st) + " | " + stepCondText(prj, st) + " | " + (stepWatchdog(prj, st) ?? "—") + " | " + (run ? run.tStart : "—") + " | " + (run && run.tEnd !== null ? round(run.tEnd - run.tStart) : tr("nedokončen")) + " |\n";
    }
    s += "\n" + (v.nominal.cycleTime !== null ? tr("Doba cyklu: {t} s", { t: v.nominal.cycleTime }) : tr("Doba cyklu: cyklus nedoběhl")) + "\n\n";
  }
  const m = v.matrix;
  let sec = v.nominal && seq.length ? 3 : 2;
  if (m.rows.length) {
    s += "## " + sec++ + ". " + tr("Matice stavů") + "\n" + tr("V klidu a v každém kroku se vyzkouší každý zásah. ✔ = reakce odpovídá konceptu (stroj zastaven, porucha vyhlášena, nový start zablokovaný), ✖ = neodpovídá, — = kombinace nedává smysl. U poruch je uvedena doba do vyhlášení poruchy.") + "\n\n";
    s += "| " + tr("Stav") + " | " + m.cols.map(c => c.label).join(" | ") + " |\n|" + "---|".repeat(m.cols.length + 1) + "\n";
    for (const r of m.rows) s += "| " + r.title + " | " + m.cols.map(c => (r.cells[c.id] || { text: "—" }).text).join(" | ") + " |\n";
    s += "\n" + (m.failed ? tr("**{failed} z {total} kombinací neodpovídá konceptu** — viz nálezy.", { failed: m.failed, total: m.total })
      : tr("Všech {total} kombinací odpovídá konceptu.", { total: m.total })) + "\n\n";
  }
  s += "## " + sec + ". " + tr("Nálezy") + "\n";
  for (const c of v.checks) s += "- " + icon[c.level] + " **" + c.title + "** — " + c.detail + "\n";
  s += "\n" + tr("Upozornění nejsou chyby generátoru, ale místa, kde návrh spoléhá na doplnění ručně nebo na rozhodnutí projektanta.");
  return s;
}
