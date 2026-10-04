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
 * Pohony fáze 2a (hotovo — `Vfd`, `PosDrive`, `PropValve`, viz CLAUDE.md „Pohony a polohování“):
 *  - bloky `motionFbItem` (porty: povely jako výrazy, hlášení jako I/O, parametry `real`,
 *    surový rozsah analogu `src: "rawMax"` dosazuje renderer), šablony `ST_VFD` / `ST_POSDRIVE` /
 *    `ST_PROPVALVE` (SCL ze ST), obecné volání `stCall` / `lxCallIr` / `inlineFb`;
 *  - kroky: `IrStep.sets` (povely kroku, zapisované i při přechodu DO kroku), `IrSeq.resets`
 *    (hodnoty po přerušení), podmínka `SeqCondition.expr` nad výstupy instance.
 * Příprava pro fázi 2b / 2c (zatím bez implementace):
 *  - Servoosa `Axis`: obálka FB_Axis nad bloky MC platformy (nejsou společné — S7-1200 / 1500,
 *    TwinCAT, CODESYS SM3, Omron, Logix instrukce v hlavní rutině), stejný vzor jako 2a: třída
 *    v `IrFbClass`, šablona per platforma, akce `moveAbs` / `moveRel` / `moveVel` / `halt`
 *    s parametry v `IrStep.sets`, podmínka „v poloze“ přes `expr`; emulátor potřebuje modely MC
 *    bloků a implicitních objektů os (TO, AXIS_REF), simulátor lichoběžníkový profil.
 *  - Druhý (OOP) renderer téhož IR je `codegen_oop.ts` (rodina CODESYS: INTERFACE I_Device,
 *    ABSTRACT FB_DeviceBase, třídy zařízení s Cycle ze šablony, FB_Sequence, pole odkazů v MAIN;
 *    volba `prj.codeStyle = "oop"`). Výchozí renderer zůstává klasický FB; shodu chování obou
 *    hlídá emulátor (emu_oop.test.ts). TIA V20 SCL s třídami zatím ne.
 *  - Vlastní šablony z firemní knihovny (napojeno, fáze 2c): `libraryOverrides(prj, plat)`
 *    (library.ts) → `codeLibrary(prj, plat)` (codegen.ts; vyřadí šablony, které nejde spolehlivě
 *    převést pro Unitronics / Logix, a vrátí důvod) → jediné místo výběru textu bloku
 *    `fbTemplate(cls, dialekt, lib)` (Gen_Library, AOI v L5X, `inlineFb` u Unitronics). Mají
 *    stejné rozhraní jako vestavěné, IR se tedy nemění; typy portů v IR zůstávají z vestavěné
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
export type IrFbClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "Vfd" | "PosDrive" | "PropValve";
/** Třídy bloků: jméno FB; zdroj logiky = šablona třídy (`fbTemplate(cls, dialekt)` v codegen.ts). */
export declare const IR_CLASSES: Record<IrFbClass, {
    fb: string;
}>;
/** Pořadí tříd v knihovně bloků (Gen_Library, AOI, OOP) — nové třídy za původními (golden). */
export declare const IR_CLASS_ORDER: IrFbClass[];
/** Typy portů bloku z vestavěné šablony IEC ST (vstupy, výstupy). */
export declare function irPortTypes(cls: IrFbClass): Record<string, IrType>;
/**
 * Zapojený vstup bloku: `src` = odkud hodnota je (default = náhrada chybějícího signálu,
 * rawMax = surový rozsah analogu — hodnotu dosadí renderer podle platformy, `expr` je Siemens 27648).
 */
export interface IrPort {
    name: string;
    type: IrType;
    expr: IrExpr;
    src: "io" | "ctrl" | "param" | "default" | "rawMax";
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
    /** Motor / Ventil / Vfd / PropValve: povel zapnout / otevřít (sekvence NEBO ruční povel); PosDrive: referování */
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
 * Operace kroku (run / stop platí pro motor i měnič; home / posRecord = polohovací pohon,
 * setPressure = proporcionální ventil — akce setPressure i setFlow). Fáze 2b přidá
 * "moveAbs" | "moveRel" | "moveVel" | "halt" (servoosa).
 */
export type IrStepOp = "dwell" | "waitOn" | "waitOff" | "run" | "stop" | "open" | "close" | "home" | "posRecord" | "setPressure" | "none";
/**
 * Podmínka přechodu kroku — jediný zdroj pro generátor i simulátor:
 *  time = po čase kroku, fbk = na vstup `io` (neg = čeká se na FALSE) nebo na výraz `expr`
 *  nad výstupy instance bloku (měnič: otáčky dosaženy, pohon: v poloze záznamu, ventil:
 *  v toleranci), none = ihned (zařízení pro tuto akci nemá zpětné hlášení).
 * U přechodu fbk je čas kroku (`timeS`) hlídací čas: po jeho uplynutí porucha.
 */
export interface SeqCondition {
    kind: "time" | "fbk" | "none";
    io?: IoEntry;
    neg?: boolean;
    expr?: IrExpr;
}
/** Přiřazení povelu sekvence (proměnná + hodnota) — u pohonů fáze 2a i při vstupu do kroku. */
export interface IrSet {
    var: string;
    type: IrType;
    value: IrExpr;
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
    /**
     * Povely pohonů / proporcionálních prvků (žádaná, záznam, směr…). Zapisují se v kroku
     * i už při přechodu DO kroku (`IF … THEN seqSpd_M5 := 30.0; seqStep := 30;`): blok je tak
     * zpracuje ještě v tomtéž scanu a sekvence v kroku nečte stav z předchozí jízdy.
     */
    sets?: IrSet[];
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
    /** povely pohonů fáze 2a (BOOL / REAL / INT) a jejich hodnota po přerušení (výchozí žádaná, 0) */
    resets: IrSet[];
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
/** Zařízení s funkčním blokem a povelem (motory, ventily, měniče, polohovací pohony, proporcionální ventily). */
export declare function actuators(prj: Project): Device[];
/** Proměnná povelu ze sekvence (BOOL) / ručního povelu z HMI pro dané zařízení. */
export declare function seqVarOf(d: Device): string;
/** Ruční povel z HMI: motor / měnič chod, ventil otevřít, polohovací pohon referování, proporcionální ventil zapnout. */
export declare function manVarOf(d: Device): string;
/** Povely sekvence motorů a ventilů (BOOL, pořadí prvního výskytu v sekvenci). */
export declare function seqVars(prj: Project): string[];
/** Proměnné povelů sekvence pohonu fáze 2a (jméno → typ a hodnota po přerušení). */
export declare function motionSeqVars(d: Device): IrSet[];
/** Pohony fáze 2a, které sekvence ovládá (pořadí prvního výskytu v sekvenci). */
export declare function seqMotionDevs(prj: Project): Device[];
/** Povely kroku pohonu fáze 2a (prázdné u ostatních). Zrcadlo v simulátoru. */
export declare function motionStepSets(d: Device, s: SeqStep): IrSet[];
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
