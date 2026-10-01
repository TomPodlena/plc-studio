/**
 * PLC Studio — simulace procesu a ověření programu.
 *
 * Simulátor provádí scan po scanu STEJNOU logiku, jakou generuje codegen.ts
 * (šablony FB_Motor / FB_Ventil, sekvence CASE, pořadí: enable → sekvence →
 * časovače sekvence → instance zařízení), proti jednoduchému modelu stroje
 * (rozběh motoru, přestavení ventilu). Slouží k ověření NÁVRHU: že cyklus
 * doběhne, jak dlouho trvá a co program udělá při poruše nebo E-stopu.
 *
 * Co neověřuje: kód přeložený v cílovém IDE, HW konfiguraci, bezpečnostní
 * funkce. Nenahrazuje test v simulátoru platformy ani FAT.
 */
import { Project, SeqStep } from "./model.js";
/** Timeouty šablon — musí odpovídat T#3S / T#5S v Gen_Library (hlídá test). */
export declare const T_MOTOR_FBK = 3;
export declare const T_VALVE_TRAVEL = 5;
export type SimFault = 
/** Od času `at` zamrznou zpětná hlášení zařízení (vadný snímač, zaseknutý pohon, slepený stykač). */
{
    kind: "frozen";
    dev: number;
    at: number;
}
/** Od času `at` je aktivní vstup poruchy motoru (vybavený jistič). */
 | {
    kind: "fault";
    dev: number;
    at: number;
}
/** Stisk nouzového zastavení v čase `at`, uvolnění v `release` (jinak zůstane stisknuté). */
 | {
    kind: "estop";
    at: number;
    release?: number;
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
}
export interface SimFrame {
    t: number;
    /** Index kroku sekvence; -1 = klid (čekání na start). */
    step: number;
    enable: boolean;
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
    /** Cyklus doběhl do konce a žádný blok neskončil v poruše. */
    ok: boolean;
    finished: boolean;
    /** Doba cyklu od startu po návrat do klidu [s]. */
    cycleTime: number | null;
    /** Index kroku, ve kterém sekvence zůstala stát (null = nestojí). */
    stalledStep: number | null;
    steps: SimStepRun[];
    events: SimEvent[];
    /** Snímky stavu — jen v okamžicích změny. */
    frames: SimFrame[];
    /** Zařízení, která během běhu přešla do poruchy. */
    errors: Array<{
        dev: number;
        t: number;
    }>;
    /** Klíče výstupů (DO) sepnutých na konci simulace. */
    outputsOn: string[];
    tEnd: number;
    opts: Required<Omit<SimOptions, "maxTime" | "faults">> & {
        maxTime: number;
        faults: SimFault[];
    };
}
export declare function stepTitle(prj: Project, s: SeqStep): string;
/** Podmínka přechodu kroku tak, jak ji generuje seqBody (text pro diagramy). */
export declare function stepCondText(prj: Project, s: SeqStep): string;
export declare function simulate(prj: Project, options?: SimOptions): SimResult;
export interface SimScenario {
    id: string;
    label: string;
    /** Co scénář zkouší (pro protokol). */
    purpose: string;
    opts: SimOptions;
    step?: number;
    dev?: number;
}
/** Sada scénářů k ověření: běžný cyklus + poruchy v jednotlivých krocích + E-stop. */
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
}
export declare function verifyProject(prj: Project, base?: SimOptions): VerifyResult;
/** Protokol o ověření simulací (Markdown do dokumentace projektu). */
export declare function docVerifyMd(prj: Project): string;
