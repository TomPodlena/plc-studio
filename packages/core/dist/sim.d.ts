/**
 * PLC Studio — simulace procesu a ověření programu.
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
import { Project, SeqStep } from "./model.js";
/** Timeouty šablon — musí odpovídat T#3S / T#5S v Gen_Library (hlídá test). */
export declare const T_MOTOR_FBK = 3;
export declare const T_VALVE_TRAVEL = 5;
/** Zásahy scénáře v čase: poruchy stroje a úkony obsluhy. */
export type SimFault = 
/** Od `at` (do `until`) zamrznou zpětná hlášení zařízení (vadný snímač, zaseknutý pohon, slepený stykač). */
{
    kind: "frozen";
    dev: number;
    at: number;
    until?: number;
}
/** Od `at` (do `until`) je aktivní vstup poruchy motoru (vybavený jistič). */
 | {
    kind: "fault";
    dev: number;
    at: number;
    until?: number;
}
/** Stisk nouzového zastavení v čase `at`, uvolnění v `release` (jinak zůstane stisknuté). */
 | {
    kind: "estop";
    at: number;
    release?: number;
}
/** Od `at` (do `until`) je vypnutý režim AUTO (přepnutí do ručního režimu). */
 | {
    kind: "manual";
    at: number;
    until?: number;
}
/** Od `at` (do `until`) chybí hlášení chodu motoru / koncák „otevřeno" ventilu (vstup vnucen na FALSE). */
 | {
    kind: "lost";
    dev: number;
    at: number;
    until?: number;
}
/** Od `at` (do `until`) má analogový vstup surovou hodnotu `raw` (např. nad horní mezí). */
 | {
    kind: "analog";
    dev: number;
    at: number;
    until?: number;
    raw: number;
}
/** Od `at` (do `until`) je zapnutý ruční povel zařízení (manRun_X / manOpen_X). */
 | {
    kind: "man";
    dev: number;
    at: number;
    until?: number;
}
/** Od `at` (do `until`) je rozpojený blokovací vstup zařízení (otevřený kryt, přerušená závora). */
 | {
    kind: "interlock";
    dev: number;
    at: number;
    until?: number;
}
/** Stisk kvitace poruchy v čase `at`. */
 | {
    kind: "ack";
    at: number;
}
/** Další stisk tlačítka start v čase `at`. */
 | {
    kind: "start";
    at: number;
};
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
    /** Model stroje: 0..1 = rozběh motoru / poloha ventilu (0 zavřeno, 1 otevřeno). */
    pos: number;
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
export interface SimStepRun {
    i: number;
    tStart: number;
    tEnd: number | null;
}
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
    errors: Array<{
        dev: number;
        t: number;
    }>;
    /** Počet dokončených cyklů a doba posledního z nich [s]. */
    cycles: number;
    lastCycleTime: number | null;
    /** Klíče výstupů (DO) sepnutých na konci simulace. */
    outputsOn: string[];
    tEnd: number;
    opts: Required<Omit<SimOptions, "maxTime" | "faults">> & {
        maxTime: number;
        faults: SimFault[];
    };
}
/** Model procesu: za jak dlouho po vstupu do kroku „čekat na vstup" přijde očekávaný stav [s]. */
export declare const DI_DELAY = 0.5;
export declare function stepTitle(prj: Project, s: SeqStep): string;
/** Podmínka přechodu kroku tak, jak ji generuje seqBody (text pro diagramy). */
export declare function stepCondText(prj: Project, s: SeqStep): string;
/** Hlídací čas kroku [s] — jen u přechodu na zpětné hlášení; jinak null. */
export declare function stepWatchdog(prj: Project, s: SeqStep): number | null;
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
export declare class Simulator {
    private readonly prj;
    t: number;
    readonly dt: number;
    readonly motorDelay: number;
    readonly valveTravel: number;
    readonly controls: SimControls;
    readonly events: SimEvent[];
    readonly frames: SimFrame[];
    readonly steps: SimStepRun[];
    readonly errors: Array<{
        dev: number;
        t: number;
    }>;
    /** Počet dokončených cyklů a doba prvního / posledního z nich [s]. */
    cycles: number;
    firstCycleTime: number | null;
    lastCycleTime: number | null;
    /** Čas dokončení posledního cyklu a zda se sekvence kdy rozběhla. */
    tDone: number;
    everStarted: boolean;
    /** Porucha stroje (machineFault) a první porucha od začátku simulace. */
    machineFault: boolean;
    faultCount: number;
    firstFault: {
        t: number;
        cause: string;
        step: number | null;
    } | null;
    private readonly record;
    private readonly io;
    /** Vstupy podle stroje (model + zásahy obsluhy); `io` z nich vzniká po uplatnění `controls.force`. */
    private readonly model;
    private readonly inputs;
    private readonly forced;
    private readonly estopIo;
    /** Blokovací vstupy (kryty, závory…) — součást enable; poslední hlášený stav. */
    private readonly ilIo;
    private readonly ilPrev;
    private readonly insts;
    private readonly plant;
    private readonly inSeq;
    private readonly seqVar;
    private readonly tonSeq;
    private readonly ioKeys;
    private readonly freeDi;
    private readonly aiKeys;
    private seqStep;
    private faultStep;
    private inCycle;
    private cycleStart;
    private startUntil;
    private ackUntil;
    /** Změna stavu od posledního snímku (krok, porucha, bloky, I/O) — snímek jen při změně. */
    private chg;
    /** Vstupy, jejichž hodnota podle stroje se změnila od posledního promítnutí do `io`. */
    private dirty;
    private nForced;
    /** Předpočítané zařízení a podmínka přechodu každého kroku (projekt se během simulace nemění). */
    private readonly stepDev;
    private readonly stepCond;
    /** Analogy s mezemi (zrcadlo FB_AnalogIn: hodnota v jednotkách, alarm nad / pod mezí). */
    private readonly analogs;
    private alarmPrev;
    /** Výstupy s vazbou na stav stroje. */
    private readonly roles;
    /** Klidové hodnoty DI, na které čeká sekvence (proces je po kroku vrací). */
    private readonly diRest;
    constructor(prj: Project, opts?: {
        dt?: number;
        motorDelay?: number;
        valveTravel?: number;
        record?: boolean;
    });
    /**
     * Nezávislá kopie celého stavu (program, model stroje, zásahy, záznam). Ověření z ní
     * navazuje zásahy v okamžiku `t` místo simulace celého cyklu od začátku — výsledek je
     * shodný, protože scan je deterministický a kopie nese i stav časovačů a hran.
     */
    clone(): Simulator;
    /** Index aktuálního kroku sekvence; -1 = klid. */
    get seqIndex(): number;
    /** Centrální uvolnění: E-stop v pořádku AND všechny blokovací vstupy TRUE (jako `enableExpr`). */
    get enable(): boolean;
    /** Jednorázový stisk tlačítka start / kvitace (držený `duration` sekund času simulace). */
    pressStart(duration?: number): void;
    pressAck(duration?: number): void;
    outputsOn(): string[];
    private devState;
    /** Aktuální stav: krok sekvence, enable, porucha, stavy bloků a hodnoty I/O. */
    frame(t?: number): SimFrame;
    /** Zaznamená snímek, pokud se stav změnil (jen při `record`). */
    snapshot(t: number): void;
    /** Zápis vstupu podle stroje (model); do `io` se promítne v `resolveInputs`. */
    private setModel;
    /** Provede `seconds` času simulace (zaokrouhleno na celé scany). */
    run(seconds: number): void;
    /**
     * Promítne vnější zásahy (E-stop, vstupy poruch, volné a analogové vstupy, vnucené
     * hodnoty) do vstupů. Volá se na začátku každého scanu; samostatně jen při zastaveném
     * čase, aby byl zásah vidět hned — program na něj zareaguje až dalším scanem.
     */
    applyInputs(): void;
    /** Vstupy, jak je čte program: vnucená hodnota (`controls.force`), jinak stav podle stroje. */
    private resolveInputs;
    private setFault;
    /** Jeden scan: vnější zásahy → program (enable → sekvence → časovače → instance → porucha) → stroj. */
    scan(): void;
}
/** Dávková simulace jednoho scénáře: start v čase `startAt`, zásahy podle `faults`. */
export declare function simulate(prj: Project, options?: SimOptions, from?: Simulator): SimResult;
/**
 * Kontrolní body běžného cyklu: cyklus se projede jednou a v žádaných časech se vrací kopie
 * stavu simulátoru. Ověření z nich navazuje zásahy — u velkých linek (desítky kroků × zásahy)
 * to zkrátí výpočet o řády, výsledek je shodný se simulací od začátku.
 */
export declare class Checkpoints {
    private readonly prj;
    private readonly base;
    private sim;
    private readonly cache;
    constructor(prj: Project, base?: SimOptions);
    /** Stav běžného cyklu v čase `t` (první scan s časem ≥ t). */
    at(t: number): Simulator;
    /** Simulace scénáře; začíná-li první zásah až po startu cyklu, naváže z kontrolního bodu. */
    run(opts: SimOptions): SimResult;
}
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
export declare function simScenarios(prj: Project, base?: SimOptions): SimScenario[];
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
export interface MatrixCol {
    id: string;
    label: string;
}
export interface MatrixCell {
    /** true = reakce odpovídá konceptu, false = neodpovídá, null = kombinace nedává smysl. */
    ok: boolean | null;
    /** Krátký text do buňky (✔ / ✔ 0.5 s / ✖ / —). */
    text: string;
    detail: string;
    /** Scénář k přehrání (jen u zkoušených kombinací). */
    scenario?: SimScenario;
}
export interface MatrixRow {
    step: number;
    title: string;
    cells: Record<string, MatrixCell>;
}
export interface StateMatrix {
    cols: MatrixCol[];
    rows: MatrixRow[];
    total: number;
    failed: number;
}
/**
 * Matice stavů: v klidu a v každém kroku sekvence se vyzkouší každý zásah (E-stop, blokování,
 * vypnutí AUTO, zamrzlé hlášení kroku, porucha a ztráta hlášení běžícího pohonu) a vyhodnotí
 * se proti konceptu (FDS): zásahy obsluhy a blokování zastaví stroj do 3 scanů a cyklus se
 * sám neobnoví; poruchy vyhlásí poruchu stroje, zastaví stroj a zablokují nový start.
 */
export declare function stateMatrix(prj: Project, base?: SimOptions, nominalRun?: SimResult, checkpoints?: Checkpoints): StateMatrix;
export declare function verifyProject(prj: Project, base?: SimOptions): VerifyResult;
/** Protokol o ověření simulací (Markdown do dokumentace projektu). */
export declare function docVerifyMd(prj: Project): string;
