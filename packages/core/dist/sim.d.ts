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
import { Project, Device, IoEntry, SeqStep } from "./model.js";
/** Timeouty šablon — musí odpovídat T#3S / T#5S v Gen_Library (hlídá test). */
export declare const T_MOTOR_FBK = 3;
export declare const T_VALVE_TRAVEL = 5;
/** Pohony fáze 2a — časy šablon FB_Vfd / FB_PosDrive / FB_PropValve (hlídá test). */
export declare const T_TICK = 0.1;
export declare const T_VFD_SPEED = 5;
export declare const T_POS_SEL = 0.1;
export declare const T_POS_ACK = 1;
export declare const T_POS_MOVE = 30;
export declare const T_PROP_SETTLE = 5;
/** Předvolby časovačů bloků pohonů podle jména v `MotionState.tons` (emulátor: horizont a přeskočení klidu). */
/** Servoosa: regulace musí naběhnout do 5 s (T#5S v FB_Axis). */
export declare const T_AXIS_POWER = 5;
export declare const MOTION_TON_PT: Record<string, number>;
/** Kódy chyb bloků pohonů (errCode) — shodné se šablonami a s dokumentací. */
export declare const MOTION_ERR: Record<number, string>;
/** Příčina poruchy servoosy v modelu (hlášení simulace; v PLC je v diagnostice osy). */
export declare const AXIS_ERR_CAUSE: Record<number, string>;
/** Zásahy scénáře v čase: poruchy stroje a úkony obsluhy. */
export type SimFault = 
/** Od `at` (do `until`) zamrznou zpětná hlášení zařízení (vadný snímač, zaseknutý pohon, slepený stykač). */
{
    kind: "frozen";
    dev: number;
    at: number;
    until?: number;
}
/** Od `at` (do `until`) je aktivní vstup poruchy motoru (vybavený jistič); u servoosy porucha pohonu. */
 | {
    kind: "fault";
    dev: number;
    at: number;
    until?: number;
}
/** Od `at` (do `until`) má servoosa přerušenou komunikaci s pohonem (PROFINET / EtherCAT…). */
 | {
    kind: "comm";
    dev: number;
    at: number;
    until?: number;
}
/** Od `at` (do `until`) je pohon servoosy nepřipraven (STO aktivní, bez silového napájení): regulace nenaběhne. */
 | {
    kind: "notReady";
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
    /** Model stroje: 0..1 = rozběh motoru / poloha ventilu (0 zavřeno, 1 otevřeno); měnič = otáčky / rozsah, ventil = skutečná / rozsah, pohon = postup jízdy. */
    pos: number;
    /** Pohony fáze 2a: skutečná hodnota v jednotkách (otáčky, tlak), žádaná po rampě, záznam v poloze (−1 = neznámý), kód chyby. */
    value?: number;
    cmd?: number;
    rec?: number;
    errCode?: number;
    /** PosDrive: blok hlásí dokončenou jízdu (done). */
    done?: boolean;
    /** Servoosa: regulace zapnuta, referováno, osa jede (moving). */
    powered?: boolean;
    homed?: boolean;
    moving?: boolean;
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
    /** Motory s aktivním vstupem poruchy (vybavený jistič); u servoosy porucha pohonu. */
    fault: number[];
    /** Servoosy s přerušenou komunikací s pohonem. */
    comm: number[];
    /** Servoosy s nepřipraveným pohonem (STO aktivní, bez silového napájení) — regulace nenaběhne. */
    notReady?: number[];
    /**
     * Ruční povely servoosy z HMI (manPower_ / manHome_ / manJogP_ / manJogN_). `man[id]` u osy =
     * regulace + pojezd + (scénáře ručního režimu).
     */
    axMan: Record<number, {
        power?: boolean;
        home?: boolean;
        jogP?: boolean;
        jogN?: boolean;
    }>;
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
    /** Povely sekvence pohonů fáze 2a podle jména proměnné (seqSpd_M5, seqRec_M6…; REAL ve float32). */
    private readonly mseq;
    /** Hodnoty po přerušení sekvence a povely kroků (předpočítané z IR — totéž jako generátor). */
    private readonly mResets;
    private readonly mStepSets;
    private readonly mInSeq;
    /** DO, které znamenají pohyb (motor, ventil, měnič chod, pohon start / referování) — po zastavení musí být FALSE. */
    readonly motionOuts: string[];
    /** DO pohonů, které pohyb nespouští (povolení, výběr záznamu, HALT, směr, kvitace) — nejsou „sepnuté výstupy“. */
    private readonly passiveOuts;
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
    /** Hodnota výstupu instance bloku pohonu (`instM5.inSpeed`) pro podmínku kroku — stav z minulého scanu, jako v PLC. */
    private member;
    /** Vyhodnocení výrazu podmínky kroku (zrcadlo `irText` — jen co generátor do podmínek píše). */
    private evalExpr;
    /**
     * Jeden scan bloku pohonu fáze 2a — přesné zrcadlo šablon ST_VFD / ST_POSDRIVE / ST_PROPVALVE
     * (pořadí příkazů, hrany, časovače, REAL ve float32). Povely: sekvence (`mseq`) NEBO ruční povel
     * mimo AUTO (bez sekvence jen ruční); vstupy z vrstvy `io` (co čte program).
     */
    private motionScan;
    /**
     * Jeden scan FB_Axis — přesné zrcadlo šablon axis_gen.ts (`AXIS_SM`, čtení stavu na začátku, bloky
     * MC na konci); bloky MC a osa = model axis.ts (týž, který emulátor spouští pod kódem platformy).
     * Vstupy: povel sekvence (`mseq`), regulace v AUTO / ručně, ruční referování a pojezd jen mimo AUTO.
     */
    private axisFbScan;
    /** Výstupy bloku pohonu do I/O: DO podle jména výstupu bloku, AO = podíl rozsahu (0..27648, kanonicky). */
    private writeOuts;
    /**
     * Model pohonu fáze 2a (reakce na výstupy do dalšího scanu; zapisuje jen do vrstvy `model`).
     * Měnič: otáčky sledují žádanou rychlostí rozsah / motorDelay, při změně směru přes nulu;
     * „otáčky dosaženy“ = chod a skutečné otáčky = žádaná. Pohon: start / referování potvrdí
     * poklesem „v poloze“, jízda trvá `travelS`, HALT a odpojení povolení jízdu zastaví.
     * Ventil: skutečná hodnota = žádaná po rampě (bez zpoždění — rampa je v PLC).
     * Zamrzlé zařízení (zásah frozen) = zaseknutá mechanika: otáčky / poloha / tlak se nemění.
     */
    private motionPlant;
    /** Zápis povelů sekvence pohonů (přerušení, krok, vstup do kroku); REAL ve float32. */
    private applySets;
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
/** Vstup, který zásah „analog“ vnutí: měření (AnalogIn raw), skutečná hodnota pohonu (rawAct). */
export declare function analogFaultIo(prj: Project, d: Device): IoEntry | undefined;
/** Vstup, který zásah „lost“ vnutí na FALSE: hlášení chodu / otevřeno / otáčky dosaženy / v poloze. */
export declare function lostFaultIo(prj: Project, d: Device): IoEntry | undefined;
/**
 * Odhad doby cyklu pro strop simulace [s] (simulate i emulátor): výdrž / přechod časem = čas kroku,
 * pohon fáze 2a podle modelu (jízda, rampa), ostatní nejdelší přestavení + rezerva.
 */
export declare function seqEstimate(prj: Project, motorDelay: number, valveTravel: number): number;
/** Nejdelší odhad cyklu [s], který ověření simulací ještě pustí (simuluje se po scanech 10 ms). */
export declare const SIM_MAX_CYCLE_S: number;
/**
 * Proč projekt NEJDE ověřit simulací (prázdné = jde): zadání, které je chybou návrhu (validace) a které by
 * simulaci nafouklo na hodiny až dny výpočtu — čas kroku mimo 0…24 h, rampa nad hodinu, doba jízdy / model
 * stroje nad hodinu, doba odchylky nad rozsah INT, odhad cyklu nad 48 h. Ověření (verifyProject, dokumentace,
 * emulace běhu, diagramy) pak neběží a protokol řekne „neověřeno — oprav chyby návrhu“ (test odolnosti
 * 2026-10-08: krok 1e9 s zamrazil dokumentaci na víc než 15 min). Platí pro web i desktop (jedno jádro).
 */
export declare function simBlockers(prj: Project): string[];
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
 * Zařízení pro sloupce matice stavů (sdílí emulátor): porucha pohonu (motor, měnič, polohovací
 * pohon se vstupem poruchy), ztráta hlášení chodu (motor, měnič „otáčky dosaženy“), ztráta polohy
 * ventilu, ztráta „v poloze“ polohovacího pohonu, odchylka proporcionálního ventilu se zpětnou vazbou.
 */
export declare function matrixDevs(prj: Project): {
    fault: Device[];
    lost: Device[];
    lostv: Device[];
    lostp: Device[];
    dev: Device[];
    comm: Device[];
};
/** DO, které znamenají pohyb (po zastavení stroje musí být FALSE): motor, ventil, měnič chod, pohon start / referování. */
export declare function motionOutKeys(prj: Project): string[];
/**
 * Zamrzlé hlášení (zaseknutá mechanika) v kroku jde zjistit? Proporcionální ventil jen se zpětnou
 * vazbou a se změnou žádané výrazně nad toleranci (malou změnu zaseknutý ventil „splní“); ostatní ano.
 */
export declare function frozenDetectable(prj: Project, s: SeqStep, d: Device, nominal: SimResult, run: SimStepRun): boolean;
/** Lhůta, do které musí odchylka proporcionálního ventilu vyhlásit poruchu [s] (takty 0,1 s + scan + rezerva). */
export declare function devDeadline(d: Device, dt: number): number;
/** Surová hodnota skutečné hodnoty daleko mimo toleranci kolem žádané `sp` (zásah „odchylka“). */
export declare function devFaultRaw(d: Device, sp: number): number;
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
/** Klíč „výstupu pohybu“ servoosy ve snímku simulace (osa jede — FB_Axis výstup moving). */
export declare function axisMoveKey(d: {
    id: number;
}): string;
