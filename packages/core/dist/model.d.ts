/**
 * PLC Studio — datový model návrhu a odvozování I/O.
 * Čistý TypeScript bez závislostí; logika přenesená z prototypu (artifact v8).
 */
import type { SolutionConcept } from "./concept.js";
export type PlatformKey = "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron" | "unitronics";
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
}
export declare const PLAT: Record<PlatformKey, PlatformInfo>;
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
/** Doplní (force=true: přepíše) adresy v Siemens notaci. */
export declare function autoAddr(prj: Project, force: boolean): void;
export declare function dtFor(e: IoEntry): "BOOL" | "INT";
/** Převod kanonické (Siemens) adresy na notaci cílové platformy. */
export declare function addrFor(plat: PlatformKey, e: IoEntry): string;
export declare function addrOrd(e: IoEntry): number;
/** Rozdělení I/O do modulů (DI16 / DO16 / AI8 / AO4) pro schémata a FDS. */
export declare function modules(prj: Project): IoModule[];
export interface ValidationIssue {
    level: "error" | "warn";
    where: string;
    msg: string;
}
/** Tag bezpečný pro všechny platformy: ASCII, bez mezer, nezačíná číslicí. */
export declare function sanitizeTag(tag: string): string;
export declare function validateProject(prj: Project): ValidationIssue[];
