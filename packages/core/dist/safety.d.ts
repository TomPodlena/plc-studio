/**
 * PLCdesk — bezpečnostní funkce (ISO 13849-1, ISO 13855, IEC 60204-1).
 *
 * „Navrhovat vše, platí jen schválené“: z návrhu stroje se odvodí nebezpečí a bezpečnostní
 * funkce (E-stop, kryty a blokování, zámky krytů, světelné závory, dvouruční ovládání u lisů,
 * ochrana proti neočekávanému rozběhu, STO měničů, bezpečné odvzdušnění pneumatiky, hydraulika,
 * svislá osa, ohřev, tlak…). U každé funkce: spouštěcí událost, reakce s kategorií zastavení,
 * návrh S/F/P se zdůvodněním a PLr z grafu rizik, architektura (kategorie, kanály, EDM, reset),
 * komponenty z katalogu, výpočet dosaženého PL (kategorie × MTTFd × DCavg × CCF, zjednodušená
 * tabulka), bezpečná vzdálenost (ISO 13855, volba vydání, jen ze ZMĚŘENÉ doby doběhu),
 * zkoušky pro validaci a zdroje (URL). Vše jsou NÁVRHY — položky ke schválení (approval.ts),
 * kroky validace jdou do plánu oživení (commission.ts, fáze 10).
 *
 * Standardní program se NEMĚNÍ: E-stop a blokování v něm zůstávají jen stavové signály
 * (enable, kvitace), simulace ani generátor standardního kódu odsud nic nečtou. Bezpečnostní
 * program (safety_prog.ts) vzniká až po schválení funkcí a nese NESCHVÁLENO, dokud ho
 * odpovědná osoba neschválí. Data z rešerše jsou v safety_data.ts (scripts/build_safety.py).
 */
import { Project, Device, PlatformKey } from "./model.js";
import { type ApprovalItem, type ApprovalStatus } from "./approval.js";
import { type CommissioningStep } from "./commission.js";
export type PL = "a" | "b" | "c" | "d" | "e";
export type SafetyCat = "B" | "1" | "2" | "3" | "4";
export type SafetyTarget = "siemens" | "rockwell" | "plcopen" | "pilz" | "sick" | "schmersal" | "relay";
export type SafetyKind = "estop" | "guard" | "guard_lock" | "light_curtain" | "multibeam" | "scanner" | "mat" | "two_hand" | "enabling" | "mode" | "muting" | "restart" | "sto" | "pneumatic" | "hydraulic" | "vertical" | "temperature" | "pressure";
export type Iso13855Edition = "2010" | "2024";
export type DistanceMode = "orthogonal" | "multibeam" | "parallel" | "two_hand" | "mat" | "guard";
/** Uživatelské úpravy jedné funkce (`Project.safety.fn[ref]`); co chybí, navrhne aplikace. */
export interface SafetyFnCfg {
    /** Vyřadit navrženou funkci (důvod do `note`) — vyřazení se také schvaluje. */
    off?: boolean;
    S?: "S1" | "S2";
    F?: "F1" | "F2";
    P?: "P1" | "P2";
    /** Snížení PLr o 1 úroveň (nízká pravděpodobnost výskytu, ISO 13849-1:2023 příl. A) — povinné zdůvodnění. */
    reduce?: string;
    /** PLr převzaté z normy typu C (přebíjí graf rizik); zdroj do `plrSource`. */
    plr?: PL;
    plrSource?: string;
    stopCat?: 0 | 1 | 2;
    /** Vstupní zařízení (označení DI) a skupiny výstupů (id skupin, např. „KS“, „STO_M3“, „YS“). */
    inputs?: string[];
    acts?: string[];
    cat?: SafetyCat;
    /** DC vstupního a výstupního subsystému [%]. */
    dcIn?: number;
    dcOut?: number;
    /** Splněná opatření proti CCF (id z `SAFETY_CCF_MEASURES`). */
    ccf?: string[];
    /** Komponenty: id z `SAFETY_COMPONENTS` (vstup, logika se volí v `SafetyCfg.logic`, výstup). */
    compIn?: string;
    compOut?: string;
    /** B10d [cykly] nebo MTTFd [roky] z datasheetu (přebíjí typické hodnoty). */
    b10dIn?: number;
    b10dOut?: number;
    mttfdIn?: number;
    mttfdOut?: number;
    /** Průměrná doba mezi vyžádáními funkce [s] (→ nop). */
    demandS?: number;
    /** ISO 13855: ZMĚŘENÁ doba doběhu stroje [ms] (povinná), reakce zařízení a logiky [ms], rozlišení d [mm], výška pole H [mm], přídavek Z [mm], dosah skrz kryt D_GT [mm]. */
    tStopMs?: number;
    tDeviceMs?: number;
    tLogicMs?: number;
    d?: number;
    H?: number;
    Z?: number;
    DGT?: number;
    /** SS1-t: zpoždění STO [ms] (kategorie zastavení 1). */
    ss1DelayMs?: number;
    note?: string;
}
/** Bezpečnostní data projektu (`Project.safety`): parametry výpočtu, volby a úpravy funkcí. */
export interface SafetyCfg {
    /** Vydání ISO 13855 pro výpočet vzdáleností (výchozí 2010 — harmonizované). */
    iso13855?: Iso13855Edition;
    /** Provozní dny za rok, hodiny za den, doba mise [roky] — vstupy nop a MTTFd (ke schválení). */
    dop?: number;
    hop?: number;
    missionYears?: number;
    /** Bezpečnostní logika: id z `SAFETY_COMPONENTS` (relé / bezpečnostní PLC). */
    logic?: string;
    /** Cíl bezpečnostního programu (jinak podle logiky). */
    target?: SafetyTarget;
    fn?: Record<string, SafetyFnCfg>;
    /** Funkce doplněné uživatelem. */
    add?: Array<{
        ref: string;
        kind: SafetyKind;
        inputs?: string[];
        acts?: string[];
        title?: string;
    }>;
}
export interface SafetyHazard {
    id: string;
    text: string;
    devs: string[];
    fns: string[];
}
/** Skupina výstupů (výstupní subsystém): stykače, STO, odvzdušnění, hydraulika, brzda, ohřev. */
export type OutKind = "contactors" | "sto" | "exhaust" | "hydraulic" | "brake" | "heater";
export interface OutGroup {
    id: string;
    kind: OutKind;
    devs: string[];
    label: string;
    /** Bezpečné výstupy a zpětná hlášení (EDM). */
    outs: string[];
    fbk: string[];
    comp: SafetyComponent | null;
}
/** Komponenta subsystému: z katalogu, nebo typická hodnota (tab. C.1) / neznámá. */
export interface SafetyComponent {
    id: string;
    label: string;
    brand?: string;
    series?: string;
    orderCode?: string;
    plMax?: PL | null;
    b10d?: number;
    mttfd?: number;
    pfhdText?: string;
    sources: string[];
    /** Hodnota převzatá z typických hodnot normy nebo odvozená z rešerše — potvrdit podle datasheetu. */
    generic?: boolean;
}
export interface SafetySubsystem {
    role: "I" | "L" | "O";
    label: string;
    comp: SafetyComponent | null;
    cat: SafetyCat | null;
    channels: number;
    /** nop [cykly/rok], MTTFd kanálu [roky] (před omezením), DC [%], T10D [roky]. */
    nop: number | null;
    mttfd: number | null;
    dc: number;
    t10d: number | null;
    pl: PL | null;
    /** „calc“ = výpočet z kategorie / MTTFd / DC / CCF; „device“ = PL certifikovaného přístroje. */
    from: "calc" | "device" | "none";
    notes: string[];
}
export interface SafetyRisk {
    S: "S1" | "S2";
    F: "F1" | "F2";
    P: "P1" | "P2";
    why: {
        S: string;
        F: string;
        P: string;
    };
    graph: PL;
    /** Normová spodní mez (ISO 13850 pro E-stop, ISO 13851 pro dvouruční ovládání). */
    min?: {
        pl: PL;
        why: string;
    };
    reduced?: string;
    override?: {
        pl: PL;
        source: string;
    };
    plr: PL | null;
    /** PLr z grafu rizik podle návrhu aplikace (před úpravou S/F/P uživatelem). */
    proposed?: PL;
    sources: string[];
}
export interface SafetyDistance {
    edition: Iso13855Edition;
    mode: DistanceMode;
    S: number | null;
    T: number | null;
    K: number | null;
    C: number | null;
    formula: string;
    steps: string[];
    warnings: string[];
    missing: string[];
    sources: string[];
}
export interface SafetySignal {
    tag: string;
    dir: "in" | "out";
    kind: "ch" | "ossd" | "no" | "nc" | "reset" | "fbk" | "q" | "sto" | "lock" | "unlock" | "status";
    dev?: string;
    text: string;
}
export interface SafetyDesign {
    cat: SafetyCat | null;
    channels: number;
    edm: boolean;
    reset: "manual" | "auto";
    ccf: {
        ids: string[];
        points: number;
        ok: boolean;
    };
    subs: SafetySubsystem[];
    pl: PL | null;
    ok: boolean;
    problems: string[];
    signals: SafetySignal[];
    wiring: string[];
}
export interface SafetyTest {
    id: string;
    name: string;
    kind: string;
    procedure: string;
    expected: string;
    sources: string[];
}
export interface SafetyFunction {
    /** SF1, SF2… (pořadí návrhu; vyřazené funkce číslo drží). */
    id: string;
    no: number;
    /** Stabilní odkaz nezávislý na číslování: „estop“, „guard:S2“, „light_curtain:S4“… */
    ref: string;
    kind: SafetyKind;
    catalog: string;
    off: boolean;
    user: boolean;
    title: string;
    name: string;
    hazards: string[];
    inputs: string[];
    acts: string[];
    /** Chybějící zařízení (návrh doplnit), např. „tlačítko nouzového zastavení“. */
    missing: string[];
    trigger: string;
    reaction: string;
    safeState: string;
    modes: string;
    resetText: string;
    energyLoss: string;
    stopCat: 0 | 1 | 2;
    stopWhy: string;
    demandS: number;
    risk: SafetyRisk;
    design: SafetyDesign | null;
    distance: SafetyDistance | null;
    tests: SafetyTest[];
    typical: {
        plr: string;
        arch: string;
        channels: string;
        edm: string;
        components: string[];
    };
    standards: string[];
    sources: string[];
    note: string;
    /** Vstupní funkce (E-stop, kryt…) vs. výstupní (STO, odvzdušnění…) a bez programu (tlak). */
    role: "input" | "output" | "passive";
}
export interface SafetyProposal {
    fns: SafetyFunction[];
    hazards: SafetyHazard[];
    groups: OutGroup[];
    logic: SafetyComponent;
    target: SafetyTarget;
    edition: Iso13855Edition;
    params: {
        dop: number;
        hop: number;
        missionYears: number;
    };
    warnings: string[];
}
export declare const plRank: (p: PL | null | undefined) => number;
/** PLr z grafu rizik ISO 13849-1 příl. A. */
export declare function plrFromGraph(S: "S1" | "S2", F: "F1" | "F2", P: "P1" | "P2"): PL;
/** Třída MTTFd kanálu. */
export declare function mttfdClass(years: number): "not_suitable" | "low" | "medium" | "high";
/** Třída DCavg. */
export declare function dcClass(pct: number): "none" | "low" | "medium" | "high";
/** nop = dop · hop · 3600 / tcycle [cykly/rok]. */
export declare function nopFrom(dop: number, hop: number, tcycleS: number): number;
/** MTTFd = B10d / (0,1 · nop) [roky]. */
export declare function mttfdFromB10d(b10d: number, nop: number): number;
/** Symetrizace dvou kanálů: 2/3 · [a + b − 1/(1/a + 1/b)]. */
export declare function symmetrizeMttfd(a: number, b: number): number;
/** MTTFd kanálu z komponent v sérii: 1/MTTFd = Σ 1/MTTFd,i. */
export declare function seriesMttfd(xs: number[]): number;
export interface PlCalc {
    pl: PL | null;
    mttfdCapped: number;
    mttfdCls: string;
    dcCls: string;
    why: string[];
}
/**
 * Dosažené PL zjednodušenou metodou (sloupcový graf ISO 13849-1, tab. 6 vydání 2015):
 * kategorie × třída MTTFd kanálu × třída DCavg, u kategorií 2–4 CCF ≥ 65 bodů. MTTFd kanálu se
 * omezí na 100 let (kat. 4: 2 500 let). Kombinace, které tabulka nepřipouští, vrací `pl: null`.
 */
export declare function plFromCategory(o: {
    cat: SafetyCat;
    mttfd: number;
    dc: number;
    ccf: number;
}): PlCalc;
export interface DistanceInput {
    edition: Iso13855Edition;
    mode: DistanceMode;
    /** ZMĚŘENÁ doba doběhu stroje [ms] — bez ní se vzdálenost nepočítá. */
    tStopMs?: number;
    tDeviceMs?: number;
    tLogicMs?: number;
    d?: number;
    H?: number;
    Z?: number;
    covered?: boolean;
    DGT?: number;
    beams?: number;
    press?: boolean;
}
/**
 * Bezpečná (oddělovací) vzdálenost podle ISO 13855:2010 (S = K·T + C) nebo 2024
 * (S = K·T + D_DS + Z; hodnoty 2024 podle volných výkladů — ověřit v normě). T = změřená doba
 * doběhu + reakce ochranného zařízení + reakce logiky. Bez změřené doby doběhu S = null.
 */
export declare function safetyDistance(i: DistanceInput): SafetyDistance;
/** Lisy (EN 692/693): přídavek C podle rozlišení (C-norma má přednost před ISO 13855). */
export declare function pressSupplement(d: number): {
    C: number;
    strokeByEspe: boolean;
};
export declare function isPressProject(prj: Project): boolean;
/** Druh ochranného DI podle popisu (nebo null). */
export declare function guardKindOf(d: Device): SafetyKind | null;
export declare function safetyComponent(id: string | undefined): SafetyComponent | null;
/** Komponenty kategorie, značka podle platformy PLC napřed. */
export declare function safetyComponents(cat: string, plat?: PlatformKey): SafetyComponent[];
/** Cíl bezpečnostního programu podle logiky. */
export declare function targetForLogic(id: string): SafetyTarget;
export declare function testKindLabel(k: string): string;
/** Normalizované parametry `Project.safety`. */
export declare function safetyParams(prj: Project): {
    dop: number;
    hop: number;
    missionYears: number;
    edition: Iso13855Edition;
};
/** Úplný návrh bezpečnostních funkcí projektu (deterministický, bez vedlejších účinků). */
export declare function proposeSafety(prj: Project): SafetyProposal;
/**
 * Proč funkci (riziko, PLr) zatím nejde schválit: vyřazení bez zdůvodnění, PLr převzaté z normy
 * typu C bez zdroje, PLr snížené úpravou parametrů rizika (S/F/P) bez zdůvodnění v poznámce.
 * Snížení přes `reduce` nese zdůvodnění v sobě (prázdný text = bez snížení).
 */
export declare function fnBlockers(f: SafetyFunction): string[];
/**
 * Proč návrh funkce (architektura, PL) zatím nejde schválit: dosažené PL nižší než PLr nebo
 * neurčitelné, chybějící údaje pro bezpečnou vzdálenost. Chybějící zařízení (pojistný ventil,
 * zpětné ventily…) schválení neblokuje — zůstává otevřeným bodem v `design.problems`.
 */
export declare function designBlockers(f: SafetyFunction): string[];
/** Stav schválení bezpečnostních funkcí (bez programu). */
export interface SafetyApprovalState {
    /** Všechny položky nebezpečí, funkcí a návrhu jsou platně schválené. */
    fnsApproved: boolean;
    /** Bezpečnostní program schválen (a funkce také). */
    programApproved: boolean;
    /** Položky funkcí, které nejsou platně schválené. */
    open: Array<{
        item: ApprovalItem;
        status: ApprovalStatus;
    }>;
}
/** Položky ke schválení bezpečnostního modulu (provider „safety“ v approval.ts). */
export declare function safetyApprovalItems(prj: Project): ApprovalItem[];
export declare function setSafetyProgramHash(fn: (prj: Project, p: SafetyProposal) => string): void;
export declare function safetyApprovalState(prj: Project, items?: ApprovalItem[]): SafetyApprovalState;
export declare function targetLabel(t: SafetyTarget): string;
/** Kroky validace bezpečnostních funkcí do plánu oživení. */
export declare function safetyCommissioningSteps(prj: Project): CommissioningStep[];
export declare function addSafetyRegistration(fn: () => () => void): void;
/** Přihlásí bezpečnostní modul (položky ke schválení, kroky oživení, dokumenty, kusovník). Vrací odhlášení. */
export declare function registerSafetyModule(): () => void;
/** Odhlásí bezpečnostní modul (testy, klient bez modulu). */
export declare function unregisterSafetyModule(): void;
export declare function safetyModuleRegistered(): boolean;
/** Popis stavu položky (pro dokumenty). */
export declare function safetyItemStatus(prj: Project, items: ApprovalItem[], key: string): string;
