/**
 * PLCdesk — mezivrstva generátoru (IR): popis programu stroje nezávislý na platformě.
 *
 * `buildIR(prj)` převede návrh na program: řízení stroje, uvolnění, sekvenci, instance bloků
 * s napojením na I/O, výstupy s rolí, volné signály a zachycení poruchy. Renderery platforem
 * z IR jen PÍŠÍ text (codegen.ts: Siemens SCL, IEC ST pro CODESYS / TwinCAT / Schneider /
 * GX Works3 / Sysmac, plochý ST Unitronics; logix.ts: Logix ST pro L5X). PLCopen XML se dál
 * staví z finálního textu MAIN (plcopen.ts). Simulátor (sim.ts) IR nečte — sdílí s ním
 * `seqCond`, `enableInputs`, `limitedAnalogs` a zrcadlí `roleExpr` / šablony bloků.
 *
 * Co v IR je (sémantika) a co ne (zápis):
 *  - IR: kdo je instance jaké třídy, co je zapojeno na který vstup / výstup (výraz), meze,
 *    žádané hodnoty, kroky sekvence (operace, povel, podmínka přechodu ze `seqCond`,
 *    hlídací čas, časovač), proměnné řízení (`IR_CTRL`), pořadí vyhodnocení (`IR_EVAL_ORDER`).
 *  - Renderer: syntaxe (`#x`, `"tag"`, `GVL_IO.tag`), komentáře a jejich překlad (`trx`),
 *    rozložení volání na řádky, věci platformy (rawMax, meze FX5 bez počátečních hodnot,
 *    TONR v Logixu, plochá logika Unitronics, `resetIn` v Sysmacu).
 *  - Logika bloků NENÍ v IR: blok nese jen třídu (`cls`, jméno FB z `IR_CLASSES`); text bloku
 *    bere renderer ze šablony třídy `fbTemplate(cls, "st" | "scl")` (codegen.ts: `ST_MOTOR`,
 *    `SCL_MOTOR`…, dál `parseFbTemplate` / `inlineFb` / AOI). Typy portů se berou ze šablony.
 *    Komentáře v IR jsou české klíče překladu (`N_`), překládá až renderer (`trx`).
 *
 * Pořadí vyhodnocení (= generovaný program = simulátor `scan()`):
 *   enable → sekvence (CASE) → časovače kroků → instance bloků (+ role DO) → porucha stroje.
 *
 * Příprava pro fázi 2b / 2c (zatím bez implementace):
 *  - Nové třídy bloků (`Vfd` frekvenční měnič, `PosDrive` polohovací pohon, `PropValve`
 *    proporcionální ventil, `Axis` servoosa): rozšířit `IrFbClass`, `IR_CLASSES` (jméno FB)
 *    a šablony v `fbTemplate` (ST + SCL), v `fbItem` přidat větev s porty (povely jako výrazy,
 *    zpětná hlášení jako I/O, parametry jako `real`); `stCall` bez zvláštního rozložení použije
 *    obecné (port na řádek), Logix (`lxCallIr`) a Unitronics (`inlineFb`) berou porty obecně.
 *    Simulátor a ověření je potřeba doplnit zvlášť (zrcadlo šablony), stejně tak HMI a AOI typy.
 *  - Nové akce kroků (`run`/`stop` pro Vfd s rychlostí, `home`, `posRecord`, `moveAbs`,
 *    `setPressure`, `waitInPos`): rozšířit `IrStepOp`; krok nese povel jako `set`
 *    (proměnná sekvence + hodnota; pro analogové povely přibude `value: IrExpr`) a podmínku
 *    přechodu z `seqCond` (nové druhy zpětného hlášení — „v poloze", „dojeto na referenci").
 *  - Druhý (OOP) renderer téhož IR: třídy / metody (TIA V20 SCL s třídami, CODESYS
 *    `METHOD` / `PROPERTY`, TwinCAT OOP). IR je pro něj připravené: instance s typovanými
 *    porty, povely jako výrazy, kroky jako operace — renderer přidá jen jiný zápis
 *    (`instM1.Start()` místo `cmdStart := …`). Výchozí renderer zůstává klasický FB.
 *  - Vlastní šablony z firemní knihovny (`libraryOverrides(prj, plat)` v library.ts): mají
 *    stejné rozhraní jako vestavěné, IR se tedy nemění — jediné místo výběru textu bloku je
 *    `fbTemplate()` (Gen_Library, AOI v L5X, `inlineFb` u Unitronics); dostane projekt
 *    a platformu a vezme přednostně šablonu z knihovny. Typy portů v IR zůstávají z vestavěné
 *    šablony (rozhraní je validací knihovny hlídané jako shodné).
 *
 * Změna výstupu generátoru jen vědomě: referenční test `golden.test.ts`
 * (přegenerování `node scripts/golden.mjs --write`, zdůvodnění v commitu).
 */
import {
  Project, Device, IoEntry, SeqStep, SeqAct, DoRole, devById, ioOf, instName, enableInputs,
  interlockDevs, isDiWait,
} from "./model.js";
import { N_ } from "./i18n.js";
/* ir.ts a codegen.ts se importují navzájem: šablony se tu berou až uvnitř funkcí */
import { fbTemplate, parseFbTemplate } from "./codegen.js";

/* ================================================================ výrazy */

/** Datový typ proměnné / portu (IEC). */
export type IrType = "BOOL" | "INT" | "WORD" | "REAL" | "TON";

/**
 * Výraz programu. Závorky jsou výslovné (`paren`) — renderer je nepřidává ani neubírá,
 * takže zápis zůstává přesně takový, jaký IR popisuje.
 */
export type IrExpr =
  | { k: "bool"; v: boolean }
  | { k: "int"; v: number }
  | { k: "real"; v: number }
  /** proměnná programu (řízení stroje, sekvence) — lokální ve strojním bloku, u Unitronics globální */
  | { k: "var"; name: string }
  /** I/O tag (tabulka I/O projektu) */
  | { k: "io"; tag: string }
  /** výstup instance bloku (`instM1.error`) */
  | { k: "member"; inst: string; port: string }
  | { k: "not"; e: IrExpr }
  | { k: "and" | "or"; args: IrExpr[] }
  | { k: "cmp"; op: "=" | "<>"; a: IrExpr; b: IrExpr }
  | { k: "paren"; e: IrExpr };

export const irBool = (v: boolean): IrExpr => ({ k: "bool", v });
export const irInt = (v: number): IrExpr => ({ k: "int", v });
export const irReal = (v: unknown): IrExpr => ({ k: "real", v: Number(v) });
export const irVar = (name: string): IrExpr => ({ k: "var", name });
export const irIo = (tag: string): IrExpr => ({ k: "io", tag });
export const irMember = (inst: string, port: string): IrExpr => ({ k: "member", inst, port });
export const irNot = (e: IrExpr): IrExpr => ({ k: "not", e });
export const irAnd = (...args: IrExpr[]): IrExpr => ({ k: "and", args });
export const irOr = (...args: IrExpr[]): IrExpr => ({ k: "or", args });
export const irEq = (a: IrExpr, b: IrExpr): IrExpr => ({ k: "cmp", op: "=", a, b });
export const irNe = (a: IrExpr, b: IrExpr): IrExpr => ({ k: "cmp", op: "<>", a, b });
export const irParen = (e: IrExpr): IrExpr => ({ k: "paren", e });

/** Jak renderer zapisuje listy výrazu; ostatní (operátory, závorky) je společné IEC ST. */
export interface IrNames {
  /** proměnná programu */
  L: (name: string) => string;
  /** I/O tag */
  R: (tag: string) => string;
  /** výstup instance (výchozí `L(inst).port`) */
  M?: (inst: string, port: string) => string;
  /** REAL literál */
  real: (v: number) => string;
}

/** Zápis výrazu v IEC ST (TRUE/FALSE, AND/OR/NOT, `=`, `<>`); dialekty upravuje renderer. */
export function irText(e: IrExpr, n: IrNames): string {
  switch (e.k) {
    case "bool": return e.v ? "TRUE" : "FALSE";
    case "int": return String(e.v);
    case "real": return n.real(e.v);
    case "var": return n.L(e.name);
    case "io": return n.R(e.tag);
    case "member": return n.M ? n.M(e.inst, e.port) : n.L(e.inst) + "." + e.port;
    case "not": return "NOT " + irText(e.e, n);
    case "and": return e.args.map(a => irText(a, n)).join(" AND ");
    case "or": return e.args.map(a => irText(a, n)).join(" OR ");
    case "cmp": return irText(e.a, n) + " " + e.op + " " + irText(e.b, n);
    case "paren": return "(" + irText(e.e, n) + ")";
  }
}

/* ======================================================= řízení stroje */

/** Proměnné řízení stroje (jména jsou rozhraním k HMI — neměnit). */
export const IR_CTRL = {
  enable: "enable", modeAuto: "modeAuto", cmdAutoStart: "cmdAutoStart", cmdAck: "cmdAck",
  machineFault: "machineFault", faultStep: "faultStep", seqStep: "seqStep",
} as const;

/** Pořadí vyhodnocení v jednom scanu (generátor = simulátor). */
export const IR_EVAL_ORDER = ["enable", "seq", "seqTimers", "blocks", "fault"] as const;
export type IrPhase = typeof IR_EVAL_ORDER[number];

/** Deklarace proměnné strojního bloku; `note` = český klíč komentáře (překládá renderer). */
export interface IrDecl {
  name: string;
  type: IrType;
  /** ctrl = režim / start / kvitace / porucha, man = ruční povel, seq = krok, seqOut = povel sekvence, timer = časovač kroku */
  group: "ctrl" | "man" | "seq" | "seqOut" | "timer";
  note?: string;
  /** komentář začíná „TODO:" (napojit na HMI) */
  todo?: boolean;
}

/** Uvolnění: AND E-stopu a blokovacích vstupů (prázdné = TRUE s TODO). */
export interface IrEnable { inputs: Array<{ dev: Device; tag: string; estop: boolean }>; }

/* ====================================================== bloky zařízení */

export type IrFbClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut";
/* fáze 2b: | "Vfd" | "PosDrive" | "PropValve" | "Axis" */

/** Třídy bloků: jméno FB; zdroj logiky = šablona třídy (`fbTemplate(cls, dialekt)` v codegen.ts). */
export const IR_CLASSES: Record<IrFbClass, { fb: string }> = {
  Motor: { fb: "FB_Motor" },
  Ventil: { fb: "FB_Ventil" },
  AnalogIn: { fb: "FB_AnalogIn" },
  AnalogOut: { fb: "FB_AnalogOut" },
};

/** Typy portů bloku z vestavěné šablony IEC ST (vstupy, výstupy). */
export function irPortTypes(cls: IrFbClass): Record<string, IrType> {
  const out: Record<string, IrType> = {};
  for (const v of parseFbTemplate(fbTemplate(cls, "st")).vars) if (v.kind !== "var") out[v.name] = v.type as IrType;
  return out;
}

/** Zapojený vstup bloku: `src` = odkud hodnota je (default = náhrada chybějícího signálu). */
export interface IrPort { name: string; type: IrType; expr: IrExpr; src: "io" | "ctrl" | "param" | "default"; }
/** Výstup bloku do I/O tagu; bez `tag` = nezapojený (renderer ho pošle do pomocné proměnné). */
export interface IrOut { name: string; type: IrType; tag?: string; }

/** Instance bloku zařízení. */
export interface IrFb {
  kind: "fb";
  dev: Device;
  cls: IrFbClass;
  fb: string;
  inst: string;
  /** vstupy v pořadí volání */
  inputs: IrPort[];
  outputs: IrOut[];
  /** AnalogIn: meze (jen zadané); AnalogOut: žádaná hodnota */
  limits?: { hi?: number; lo?: number };
  setpoint?: number;
  /** Motor / Ventil: povel zapnout / otevřít (sekvence NEBO ruční povel) */
  cmd?: IrExpr;
}
/** DO s rolí: výstup = stav stroje. */
export interface IrRole { kind: "role"; dev: Device; role: DoRole; outs: IoEntry[]; expr: IrExpr; }
/** Signál, který program nečte ani neovládá (pro vlastní logiku). */
export interface IrFree { kind: "free"; dev: Device; io: IoEntry[]; }
/** DI, na který čeká sekvence (čte ho krok). */
export interface IrSeqInput { kind: "seqInput"; dev: Device; }
/**
 * Vstup uvolnění (E-stop / blokování) — čte ho `enable`. `alt` = jak by se zařízení zařadilo
 * bez uvolnění (plochý výstup Unitronics vypisuje E-stop i mezi volnými signály).
 */
export interface IrEnableInput { kind: "enableInput"; dev: Device; estop: boolean; alt: IrDeviceItem; }
export type IrDeviceItem = IrFb | IrRole | IrFree | IrSeqInput | IrEnableInput;

/* ============================================================ sekvence */

/**
 * Operace kroku. Fáze 2b přidá: "home" | "posRecord" | "moveAbs" | "setPressure" | "waitInPos"
 * (a run/stop s rychlostí u Vfd).
 */
export type IrStepOp = "dwell" | "waitOn" | "waitOff" | "run" | "stop" | "open" | "close" | "none";

/**
 * Podmínka přechodu kroku — jediný zdroj pro generátor i simulátor:
 *  time = po čase kroku, fbk = na vstup `io` (neg = čeká se na FALSE),
 *  none = ihned (zařízení pro tuto akci nemá zpětné hlášení).
 * U přechodu fbk je čas kroku (`timeS`) hlídací čas: po jeho uplynutí porucha.
 */
export interface SeqCondition { kind: "time" | "fbk" | "none"; io?: IoEntry; neg?: boolean; }

export interface IrStep {
  /** pořadí od 0; číslo kroku v programu `n` = 10, 20, …; `next` = následující (po posledním 0) */
  index: number; n: number; next: number;
  op: IrStepOp;
  act: SeqAct;
  dev?: Device;
  /** povel sekvence nastavovaný v kroku */
  set?: { var: string; value: boolean };
  cond: SeqCondition;
  /** čas kroku [s] (výdrž / přechod časem / hlídací čas zpětného hlášení) */
  timeS: number;
  /** časovač kroku (jen když podmínka není `none`) */
  timer?: string;
}

export interface IrSeq {
  steps: IrStep[];
  /** povely sekvence (seqRun_* / seqOpen_*) — při přerušení se nulují */
  outputs: string[];
  /** přerušení: sekvence do kroku 0, povely vypnout */
  abort: IrExpr;
  /** start cyklu v kroku 0 */
  start: IrExpr;
}

/** Zachycení poruchy bloků (chyby, alarmy mezí) a kvitace. */
export interface IrFault { errors: IrExpr[]; resetFaultStep: boolean; }

/** Program stroje. */
export interface IrProgram {
  prj: Project;
  hasSeq: boolean;
  enable: IrEnable;
  decls: IrDecl[];
  seq: IrSeq | null;
  /** zařízení v pořadí projektu */
  devices: IrDeviceItem[];
  fault: IrFault | null;
  order: typeof IR_EVAL_ORDER;
}

/* ================================================ pomocné (sdílí i sim.ts) */

/** Analogové vstupy s mezemi — jejich alarm je součástí poruchy stroje. */
export function limitedAnalogs(prj: Project): Device[] {
  return prj.devices.filter(d => d.cls === "AnalogIn" && (Number.isFinite(d.limHi) || Number.isFinite(d.limLo)));
}
/** Digitální vstupy, na které čeká sekvence. */
export function waitedDis(prj: Project): Set<number> {
  return new Set(prj.program.seq.filter(isDiWait).map(s => s.dev));
}
/** Zařízení s funkčním blokem a povelem (motory, ventily). */
export function actuators(prj: Project): Device[] {
  return prj.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil");
}
/** Proměnná povelu ze sekvence / ručního povelu z HMI pro dané zařízení. */
export function seqVarOf(d: Device): string { return (d.cls === "Motor" ? "seqRun_" : "seqOpen_") + d.name; }
export function manVarOf(d: Device): string { return (d.cls === "Motor" ? "manRun_" : "manOpen_") + d.name; }

export function seqVars(prj: Project): string[] {
  const vars = new Set<string>();
  for (const s of prj.program.seq) {
    const d = devById(prj, s.dev);
    if (d && (d.cls === "Motor" || d.cls === "Ventil")) vars.add(seqVarOf(d));
  }
  return [...vars];
}

export function seqCond(prj: Project, s: SeqStep): SeqCondition {
  if (s.act === "wait" || (s.cond === "time" && !isDiWait(s))) return { kind: "time" };
  const d = devById(prj, s.dev);
  if (!d) return { kind: "none" };
  const io = ioOf(prj, d);
  if (isDiWait(s)) {                               // čekání na snímač / tlačítko (hlídací čas = timeS)
    const e = d.cls === "DI" ? (io.in || Object.values(io)[0]) : undefined;
    return e ? { kind: "fbk", io: e, neg: s.act === "waitOff" } : { kind: "none" };
  }
  if (d.cls === "Motor") return io.fbkRunning ? { kind: "fbk", io: io.fbkRunning, neg: s.act !== "start" } : { kind: "none" };
  if (d.cls === "Ventil") {
    if (s.act === "open" && io.fbkOpen) return { kind: "fbk", io: io.fbkOpen };
    if (s.act === "close" && io.fbkClosed) return { kind: "fbk", io: io.fbkClosed };
  }
  return { kind: "none" };
}

/** Kroky s časovačem: výdrž / přechod časem, nebo hlídání kroku se zpětným hlášením. */
export function seqTimedSteps(prj: Project): number[] {
  const list: number[] = [];
  prj.program.seq.forEach((s, i) => { if (seqCond(prj, s).kind !== "none") list.push(10 + i * 10); });
  return list;
}

/**
 * Výraz role výstupu — totéž jako `roleExpr` (model.ts, text pro import a starší volání);
 * shodu zápisu hlídá test. Zrcadlo v simulátoru: `roleValue` (sim.ts).
 */
export function roleIr(role: DoRole, hasSeq: boolean): IrExpr {
  const C = IR_CTRL;
  const running = hasSeq ? irNe(irVar(C.seqStep), irInt(0)) : irBool(false);
  switch (role) {
    case "run": return running;
    case "fault": return irVar(C.machineFault);
    case "ready": return hasSeq
      ? irAnd(irVar(C.enable), irNot(irVar(C.machineFault)), irVar(C.modeAuto), irEq(irVar(C.seqStep), irInt(0)))
      : irAnd(irVar(C.enable), irNot(irVar(C.machineFault)));
    case "stopped": return irNot(irVar(C.enable));
    case "lock": return running;
    case "auto": return hasSeq ? irVar(C.modeAuto) : irBool(false);
  }
}

/* ============================================================ sestavení */

/** Povel zapnout / otevřít: sekvence NEBO ruční povel (ruční jen mimo AUTO; bez sekvence vždy). */
export function cmdIr(prj: Project, d: Device): IrExpr {
  if (!prj.program.seq.length) return irVar(manVarOf(d));
  const man = irParen(irAnd(irVar(manVarOf(d)), irNot(irVar(IR_CTRL.modeAuto))));
  return seqVars(prj).includes(seqVarOf(d)) ? irOr(irVar(seqVarOf(d)), man) : man;
}

function fbItem(prj: Project, d: Device): IrFb | null {
  if (d.cls !== "Motor" && d.cls !== "Ventil" && d.cls !== "AnalogIn" && d.cls !== "AnalogOut") return null;
  const cls: IrFbClass = d.cls;
  const T = irPortTypes(cls);
  const io = ioOf(prj, d);
  const C = IR_CTRL;
  const port = (name: string, expr: IrExpr, src: IrPort["src"]): IrPort => ({ name, type: T[name], expr, src });
  const sig = (name: string, e: IoEntry | undefined, dflt: IrExpr): IrPort => e ? port(name, irIo(e.tag), "io") : port(name, dflt, "default");
  const out = (name: string, e: IoEntry | undefined): IrOut => e ? { name, type: T[name], tag: e.tag } : { name, type: T[name] };
  const base = { kind: "fb" as const, dev: d, cls, fb: IR_CLASSES[cls].fb, inst: instName(d) };
  if (cls === "Motor" || cls === "Ventil") {
    const cmd = cmdIr(prj, d);
    const [on, off] = cls === "Motor" ? ["cmdStart", "cmdStop"] : ["cmdOpen", "cmdClose"];
    const inputs = [port("enable", irVar(C.enable), "ctrl"), port(on, cmd, "ctrl"), port(off, irNot(irParen(cmd)), "ctrl"), port("reset", irVar(C.cmdAck), "ctrl")];
    if (cls === "Motor") {
      inputs.push(sig("fbkRunning", io.fbkRunning, irBool(true)), sig("fault", io.fault, irBool(false)));
      return { ...base, cmd, inputs, outputs: [out("outRun", io.outRun)] };
    }
    inputs.push(sig("fbkOpen", io.fbkOpen, irBool(true)), sig("fbkClosed", io.fbkClosed, irBool(true)));
    return { ...base, cmd, inputs, outputs: [out("outOpen", io.outOpen)] };
  }
  if (cls === "AnalogIn") {
    const inputs = [sig("rawValue", io.raw, irInt(0)), port("scaleMin", irReal(d.rmin), "param"), port("scaleMax", irReal(d.rmax), "param")];
    const limits: { hi?: number; lo?: number } = {};
    if (Number.isFinite(d.limHi)) { limits.hi = d.limHi; inputs.push(port("limitHi", irReal(d.limHi), "param")); }
    if (Number.isFinite(d.limLo)) { limits.lo = d.limLo; inputs.push(port("limitLo", irReal(d.limLo), "param")); }
    return { ...base, inputs, outputs: [], limits };
  }
  const sp = Number.isFinite(d.setpoint);
  return {
    ...base, ...(sp ? { setpoint: d.setpoint } : {}),
    inputs: [sp ? port("value", irReal(d.setpoint), "param") : port("value", irReal(0), "default"), port("scaleMin", irReal(d.rmin), "param"), port("scaleMax", irReal(d.rmax), "param")],
    outputs: [out("rawValue", io.raw)],
  };
}

/** Zařazení zařízení bez ohledu na uvolnění (blok, role, čtený vstup, volný signál). */
function deviceItem(prj: Project, d: Device, waited: Set<number>, hasSeq: boolean): IrDeviceItem {
  const fb = fbItem(prj, d);
  if (fb) return fb;
  if (d.cls === "DO" && d.role) return { kind: "role", dev: d, role: d.role, outs: Object.values(ioOf(prj, d)), expr: roleIr(d.role, hasSeq) };
  if (d.cls === "DI" && waited.has(d.id)) return { kind: "seqInput", dev: d };
  return { kind: "free", dev: d, io: Object.values(ioOf(prj, d)) };
}

/** Program stroje z návrhu (viz hlavička souboru). */
export function buildIR(prj: Project): IrProgram {
  const C = IR_CTRL;
  const steps = prj.program.seq, hasSeq = steps.length > 0;
  const acts = actuators(prj), analogs = limitedAnalogs(prj);
  const svars = seqVars(prj);

  /* deklarace řízení stroje */
  const decls: IrDecl[] = [];
  if (hasSeq) {
    decls.push({ name: C.modeAuto, type: "BOOL", group: "ctrl", todo: true, note: N_("přepínač režimu (HMI); FALSE = ruční režim") });
    decls.push({ name: C.cmdAutoStart, type: "BOOL", group: "ctrl", todo: true, note: N_("tlačítko start auto") });
  }
  /* stejná podmínka jako u poruchy / role: meze analogů a DO s vazbou na stav stroje */
  if (hasSeq || acts.length || analogs.length || prj.devices.some(d => d.cls === "DO" && d.role)) {
    decls.push({ name: C.cmdAck, type: "BOOL", group: "ctrl", todo: true, note: N_("tlačítko kvitace poruchy (HMI)") });
    decls.push({ name: C.machineFault, type: "BOOL", group: "ctrl", note: N_("porucha stroje (chyba bloku / timeout kroku); drží do kvitace") });
  }
  for (const d of acts) decls.push({ name: manVarOf(d), type: "BOOL", group: "man", todo: true, note: hasSeq ? N_("ruční povel z HMI (platí při vypnutém AUTO)") : N_("ruční povel z HMI") });
  if (hasSeq) {
    decls.push({ name: C.faultStep, type: "INT", group: "ctrl", note: N_("krok sekvence, ve kterém vypršel čas (diagnostika)") });
    decls.push({ name: C.seqStep, type: "INT", group: "seq" });
    for (const v of svars) decls.push({ name: v, type: "BOOL", group: "seqOut" });
    for (const n of seqTimedSteps(prj)) decls.push({ name: "tonSeq" + n, type: "TON", group: "timer" });
  }

  /* sekvence */
  let seq: IrSeq | null = null;
  if (hasSeq) {
    seq = {
      outputs: svars,
      abort: irOr(irNot(irVar(C.modeAuto)), irNot(irVar(C.enable)), irVar(C.machineFault)),
      start: irAnd(irVar(C.modeAuto), irVar(C.enable), irNot(irVar(C.machineFault)), irVar(C.cmdAutoStart)),
      steps: steps.map((s, i): IrStep => {
        const n = 10 + i * 10, next = i === steps.length - 1 ? 0 : 10 + (i + 1) * 10;
        const d = devById(prj, s.dev);
        const cond = seqCond(prj, s);
        let op: IrStepOp = "none", set: IrStep["set"];
        if (s.act === "wait") op = "dwell";
        else if (isDiWait(s)) op = s.act === "waitOn" ? "waitOn" : "waitOff";
        else if (d && d.cls === "Motor") { op = s.act === "start" ? "run" : "stop"; set = { var: seqVarOf(d), value: s.act === "start" }; }
        else if (d && d.cls === "Ventil") { op = s.act === "open" ? "open" : "close"; set = { var: seqVarOf(d), value: s.act === "open" }; }
        return {
          index: i, n, next, op, act: s.act, ...(d ? { dev: d } : {}), ...(set ? { set } : {}), cond,
          timeS: s.timeS || 1, ...(cond.kind !== "none" ? { timer: "tonSeq" + n } : {}),
        };
      }),
    };
  }

  /* zařízení: E-stop a blokování jsou v enable, DI čekání čte sekvence */
  const enIds = new Set(interlockDevs(prj).map(d => d.id));
  const waited = waitedDis(prj);
  const devices: IrDeviceItem[] = prj.devices.map(d => {
    const item = deviceItem(prj, d, waited, hasSeq);
    if (d.id === prj.program.estop || enIds.has(d.id)) return { kind: "enableInput", dev: d, estop: d.id === prj.program.estop, alt: item };
    return item;
  });

  /* porucha stroje: chyby bloků akčních členů a alarmy mezí analogů */
  let fault: IrFault | null = null;
  const errors: IrExpr[] = [];
  for (const d of acts) errors.push(irMember(instName(d), "error"));
  for (const d of analogs) {
    if (Number.isFinite(d.limHi)) errors.push(irMember(instName(d), "alarmHi"));
    if (Number.isFinite(d.limLo)) errors.push(irMember(instName(d), "alarmLo"));
  }
  if (acts.length || hasSeq || errors.length) fault = { errors, resetFaultStep: hasSeq };

  return {
    prj, hasSeq, decls, seq, devices, fault, order: IR_EVAL_ORDER,
    enable: { inputs: enableInputs(prj).map(x => ({ dev: x.dev, tag: x.io.tag, estop: x.estop })) },
  };
}

/** Instance bloků programu (v pořadí zařízení; bez vstupů uvolnění). */
export function irBlocks(ir: IrProgram): IrFb[] {
  return ir.devices.filter((x): x is IrFb => x.kind === "fb");
}
