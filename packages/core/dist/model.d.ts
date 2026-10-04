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
export type PlatformKey = "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron" | "unitronics" | "wago" | "delta";
/** Styl generovaného kódu: klasické FB (výchozí) nebo OOP (rozhraní, dědičnost) — viz codegen_oop.ts. */
export type CodeStyle = "classic" | "oop";
export type DeviceClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "DI" | "DO";
export type Dir = "DI" | "DO" | "AI" | "AO";
/** Akce kroku: povel motoru / ventilu, výdrž, nebo čekání na digitální vstup (DI = TRUE / FALSE). */
export type SeqAct = "start" | "stop" | "open" | "close" | "wait" | "waitOn" | "waitOff";
/** Vazba digitálního výstupu na stav stroje (generuje se do programu i do simulace). */
export type DoRole = "run" | "fault" | "ready" | "stopped" | "lock" | "auto";
export type SeqCond = "fbk" | "time";
export interface PlatformInfo {
    name: string;
    ide: string;
    cpu: string;
    lang: string;
    imp: string;
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
    addr: string;
    cmt: string;
    nc?: boolean;
    /** Trvalý identifikátor (viz guid.ts): odvozený z GUID zařízení a signálu při vzniku řádku. */
    guid?: string;
}
export interface SeqStep {
    dev: number;
    act: SeqAct;
    cond: SeqCond;
    timeS: number;
}
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
    meta: {
        name: string;
        desc: string;
        takt?: number;
    };
    platforms: PlatformKey[];
    devices: Device[];
    io: IoEntry[];
    program: ProgramCfg;
    nextId: number;
    /** Model stroje pro simulaci: doba rozběhu motoru a přestavení ventilu [s]. */
    sim?: {
        motorDelay?: number;
        valveTravel?: number;
    };
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
    /** GUID I/O karet podle klíče karty „<směr><pořadí>“ (DI1, DO2…; viz `modules()` a guid.ts). */
    moduleGuids?: Record<string, string>;
    /**
     * Styl kódu (výchozí classic). OOP platí jen pro platformy s `PLAT[…].oop` (CODESYS, TwinCAT,
     * Schneider, WAGO, Delta AX); ostatní platformy ho ignorují. Chování programu je v obou
     * stylech stejné (stejný IR, stejné šablony bloků) — liší se jen zápis.
     */
    codeStyle?: CodeStyle;
}
export interface BomLineCfg {
    brand?: string;
    type?: string;
    orderCode?: string;
    supplier?: string;
    qty?: number;
    note?: string;
}
export interface BomCfg {
    plat?: PlatformKey;
    brand?: Record<string, string>;
    lines?: Record<string, BomLineCfg>;
}
export interface IoModule {
    dir: Dir;
    idx: number;
    ch: IoEntry[];
    /** GUID karty z `Project.moduleGuids` (karta nemá v modelu vlastní objekt — identita = DI1, DO2…). */
    guid?: string;
}
export declare const PLAT: Record<PlatformKey, PlatformInfo>;
/** Základ platformy: profil (WAGO, Delta AX) → „codesys“, jinak platforma sama. */
export declare function platBase(plat: PlatformKey): PlatformKey;
/** Rodina CODESYS (GVL_IO, PLCopen XML, adresy %IX / %IW): CODESYS a jeho profily, TwinCAT, Schneider. */
export declare function isCodesysFamily(plat: PlatformKey): boolean;
/** Platforma umí styl kódu OOP. */
export declare function supportsOop(plat: PlatformKey): boolean;
/** Styl kódu, který pro platformu skutečně platí (OOP jen kde ho platforma umí). */
export declare function codeStyleFor(prj: Project, plat: PlatformKey): CodeStyle;
/** Tabulka platforem s texty v nastaveném jazyce (`PLAT` drží české klíče překladu). */
export declare function platInfo(): Record<PlatformKey, PlatformInfo>;
export declare const IECPLATS: PlatformKey[];
export declare const CLS: Record<DeviceClass, {
    prefix: string;
    label: string;
    opts: Record<string, string>;
}>;
/** Třídy zařízení s texty v nastaveném jazyce (`CLS` drží české klíče překladu). */
export declare function clsInfo(): Record<DeviceClass, {
    prefix: string;
    label: string;
    opts: Record<string, string>;
}>;
/** Vazby výstupů na stav stroje — popisky (klíče překladu) pro výběr v UI. */
export declare const DO_ROLES: Record<DoRole, string>;
/** Čeká krok na digitální vstup? */
export declare function isDiWait(s: SeqStep): boolean;
export declare function stripDia(s: string): string;
export declare function esc(s: unknown): string;
export declare const xmlEsc: typeof esc;
export declare function blankProject(): Project;
export declare function devById(prj: Project, id: number | ""): Device | undefined;
export declare function nextName(prj: Project, cls: DeviceClass): string;
export declare function instName(d: Device): string;
/** Výraz role výstupu (proměnné strojního bloku přes `L`); `hasSeq` = projekt má sekvenci. */
export declare function roleExpr(role: DoRole, hasSeq: boolean, L: (v: string) => string): string;
/** Blokovací zařízení programu: existující DI, bez E-stopu, bez duplicit, v pořadí projektu. */
export declare function interlockDevs(prj: Project): Device[];
/**
 * Vstupy, ze kterých se skládá `enable` (AND): E-stop a blokovací vstupy.
 * TRUE = v pořádku; FALSE kteréhokoli zastaví stroj. Generátor i simulátor berou odsud.
 */
export declare function enableInputs(prj: Project): Array<{
    dev: Device;
    io: IoEntry;
    estop: boolean;
}>;
export declare function usedClasses(prj: Project): Set<DeviceClass>;
export declare function ioOf(prj: Project, dev: Device): Record<string, IoEntry>;
export declare function devSignals(d: Device): Array<[sig: string, dir: Dir, label: string]>;
/**
 * Synchronizuje I/O tabulku se zařízeními; existující řádky (edity) zachová.
 * Komentář nového signálu vzniká v jazyce nastaveném v okamžiku vytvoření — je to obsah
 * projektu, při přepnutí jazyka se nepřekládá.
 */
export declare function syncIO(prj: Project): void;
/**
 * Doplní chybějící GUID projektu, zařízení, I/O karet a signálů (viz guid.ts); platné nemění.
 * Vrací true, když něco doplnila — při načtení starého projektu ho volající označí jako změněný.
 * Export GUID nikdy negeneruje (jen čte); volá se při vzniku objektů (`syncIO`) a při načtení.
 */
export declare function ensureGuids(prj: Project): boolean;
/** Doplní (force=true: přepíše) adresy v Siemens notaci. */
export declare function autoAddr(prj: Project, force: boolean): void;
export declare function dtFor(e: IoEntry): "BOOL" | "INT";
/** Převod kanonické (Siemens) adresy na notaci cílové platformy. */
export declare function addrFor(plat: PlatformKey, e: IoEntry): string;
export declare function addrOrd(e: IoEntry): number;
/**
 * Číslo vodiče kanálu: stovky = svorkovnice X<n> (pořadí modulu z `modules()`), zbytek = svorka
 * X<n>:<k> — X1:1 → -W101, X2:3 → -W203, X10:1 → -W1001. Unikátní v celém projektu (modul má
 * nejvýš 16 kanálů) a stabilní: změna jednoho modulu nepřečísluje vodiče ostatních.
 * Jediný zdroj pro výkresy (SVG/DXF), seznam svorek dokumentace a export EPLAN.
 */
export declare function wireNo(xnum: number, ch: number): string;
/** Rozdělení I/O do modulů (DI16 / DO16 / AI8 / AO4) pro schémata a FDS. */
export declare function modules(prj: Project): IoModule[];
export interface ValidationIssue {
    /** info = jen upozornění na způsob řešení (nic není potřeba opravit) */
    level: "error" | "warn" | "info";
    where: string;
    msg: string;
}
/** Tag bezpečný pro všechny platformy: ASCII, bez mezer, nezačíná číslicí. */
export declare function sanitizeTag(tag: string): string;
export declare function validateProject(prj: Project): ValidationIssue[];
