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
import { Project, Device, IoEntry, SeqStep, SeqAct, DoRole } from "./model.js";
/** Datový typ proměnné / portu (IEC). */
export type IrType = "BOOL" | "INT" | "WORD" | "REAL" | "TON";
/**
 * Výraz programu. Závorky jsou výslovné (`paren`) — renderer je nepřidává ani neubírá,
 * takže zápis zůstává přesně takový, jaký IR popisuje.
 */
export type IrExpr = {
    k: "bool";
    v: boolean;
} | {
    k: "int";
    v: number;
} | {
    k: "real";
    v: number;
}
/** proměnná programu (řízení stroje, sekvence) — lokální ve strojním bloku, u Unitronics globální */
 | {
    k: "var";
    name: string;
}
/** I/O tag (tabulka I/O projektu) */
 | {
    k: "io";
    tag: string;
}
/** výstup instance bloku (`instM1.error`) */
 | {
    k: "member";
    inst: string;
    port: string;
} | {
    k: "not";
    e: IrExpr;
} | {
    k: "and" | "or";
    args: IrExpr[];
} | {
    k: "cmp";
    op: "=" | "<>";
    a: IrExpr;
    b: IrExpr;
} | {
    k: "paren";
    e: IrExpr;
};
export declare const irBool: (v: boolean) => IrExpr;
export declare const irInt: (v: number) => IrExpr;
export declare const irReal: (v: unknown) => IrExpr;
export declare const irVar: (name: string) => IrExpr;
export declare const irIo: (tag: string) => IrExpr;
export declare const irMember: (inst: string, port: string) => IrExpr;
export declare const irNot: (e: IrExpr) => IrExpr;
export declare const irAnd: (...args: IrExpr[]) => IrExpr;
export declare const irOr: (...args: IrExpr[]) => IrExpr;
export declare const irEq: (a: IrExpr, b: IrExpr) => IrExpr;
export declare const irNe: (a: IrExpr, b: IrExpr) => IrExpr;
export declare const irParen: (e: IrExpr) => IrExpr;
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
export declare function irText(e: IrExpr, n: IrNames): string;
/** Proměnné řízení stroje (jména jsou rozhraním k HMI — neměnit). */
export declare const IR_CTRL: {
    readonly enable: "enable";
    readonly modeAuto: "modeAuto";
    readonly cmdAutoStart: "cmdAutoStart";
    readonly cmdAck: "cmdAck";
    readonly machineFault: "machineFault";
    readonly faultStep: "faultStep";
    readonly seqStep: "seqStep";
};
/** Pořadí vyhodnocení v jednom scanu (generátor = simulátor). */
export declare const IR_EVAL_ORDER: readonly ["enable", "seq", "seqTimers", "blocks", "fault"];
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
export interface IrEnable {
    inputs: Array<{
        dev: Device;
        tag: string;
        estop: boolean;
    }>;
}
export type IrFbClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut";
/** Třídy bloků: jméno FB; zdroj logiky = šablona třídy (`fbTemplate(cls, dialekt)` v codegen.ts). */
export declare const IR_CLASSES: Record<IrFbClass, {
    fb: string;
}>;
/** Typy portů bloku z vestavěné šablony IEC ST (vstupy, výstupy). */
export declare function irPortTypes(cls: IrFbClass): Record<string, IrType>;
/** Zapojený vstup bloku: `src` = odkud hodnota je (default = náhrada chybějícího signálu). */
export interface IrPort {
    name: string;
    type: IrType;
    expr: IrExpr;
    src: "io" | "ctrl" | "param" | "default";
}
/** Výstup bloku do I/O tagu; bez `tag` = nezapojený (renderer ho pošle do pomocné proměnné). */
export interface IrOut {
    name: string;
    type: IrType;
    tag?: string;
}
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
    limits?: {
        hi?: number;
        lo?: number;
    };
    setpoint?: number;
    /** Motor / Ventil: povel zapnout / otevřít (sekvence NEBO ruční povel) */
    cmd?: IrExpr;
}
/** DO s rolí: výstup = stav stroje. */
export interface IrRole {
    kind: "role";
    dev: Device;
    role: DoRole;
    outs: IoEntry[];
    expr: IrExpr;
}
/** Signál, který program nečte ani neovládá (pro vlastní logiku). */
export interface IrFree {
    kind: "free";
    dev: Device;
    io: IoEntry[];
}
/** DI, na který čeká sekvence (čte ho krok). */
export interface IrSeqInput {
    kind: "seqInput";
    dev: Device;
}
/**
 * Vstup uvolnění (E-stop / blokování) — čte ho `enable`. `alt` = jak by se zařízení zařadilo
 * bez uvolnění (plochý výstup Unitronics vypisuje E-stop i mezi volnými signály).
 */
export interface IrEnableInput {
    kind: "enableInput";
    dev: Device;
    estop: boolean;
    alt: IrDeviceItem;
}
export type IrDeviceItem = IrFb | IrRole | IrFree | IrSeqInput | IrEnableInput;
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
export interface SeqCondition {
    kind: "time" | "fbk" | "none";
    io?: IoEntry;
    neg?: boolean;
}
export interface IrStep {
    /** pořadí od 0; číslo kroku v programu `n` = 10, 20, …; `next` = následující (po posledním 0) */
    index: number;
    n: number;
    next: number;
    op: IrStepOp;
    act: SeqAct;
    dev?: Device;
    /** povel sekvence nastavovaný v kroku */
    set?: {
        var: string;
        value: boolean;
    };
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
export interface IrFault {
    errors: IrExpr[];
    resetFaultStep: boolean;
}
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
/** Analogové vstupy s mezemi — jejich alarm je součástí poruchy stroje. */
export declare function limitedAnalogs(prj: Project): Device[];
/** Digitální vstupy, na které čeká sekvence. */
export declare function waitedDis(prj: Project): Set<number>;
/** Zařízení s funkčním blokem a povelem (motory, ventily). */
export declare function actuators(prj: Project): Device[];
/** Proměnná povelu ze sekvence / ručního povelu z HMI pro dané zařízení. */
export declare function seqVarOf(d: Device): string;
export declare function manVarOf(d: Device): string;
export declare function seqVars(prj: Project): string[];
export declare function seqCond(prj: Project, s: SeqStep): SeqCondition;
/** Kroky s časovačem: výdrž / přechod časem, nebo hlídání kroku se zpětným hlášením. */
export declare function seqTimedSteps(prj: Project): number[];
/**
 * Výraz role výstupu — totéž jako `roleExpr` (model.ts, text pro import a starší volání);
 * shodu zápisu hlídá test. Zrcadlo v simulátoru: `roleValue` (sim.ts).
 */
export declare function roleIr(role: DoRole, hasSeq: boolean): IrExpr;
/** Povel zapnout / otevřít: sekvence NEBO ruční povel (ruční jen mimo AUTO; bez sekvence vždy). */
export declare function cmdIr(prj: Project, d: Device): IrExpr;
/** Program stroje z návrhu (viz hlavička souboru). */
export declare function buildIR(prj: Project): IrProgram;
/** Instance bloků programu (v pořadí zařízení; bez vstupů uvolnění). */
export declare function irBlocks(ir: IrProgram): IrFb[];
