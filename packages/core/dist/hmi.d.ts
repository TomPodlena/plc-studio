/**
 * PLCdesk — HMI vrstva z projektu: tagy pro obsluhu, alarmy a obrazovky.
 *
 * Jeden model (`buildHmi`) → exporty pro HMI výrobců (hmi_export.ts), webové HMI a JSON popis
 * obrazovek, SVG náhledy obrazovek a dokument `16_hmi.md` (hmi_docs.ts).
 *
 * Zdroje — nic se neopisuje:
 *  - tagy řízení stroje = deklarace generátoru (`ctrlDecls`), proměnné bloků = šablony
 *    (`parseFbTemplate(ST_MOTOR…)`), I/O = tabulka I/O projektu;
 *  - alarmy = seznam alarmů z dokumentace (`docAlarmCsv`, tytéž texty a kódy), spouštěcí
 *    signál podle kódu alarmu (logika nestojí na přeloženém textu);
 *  - kroky sekvence = `stepTitle` / `stepCondText` / `stepWatchdog` (sim.ts).
 *
 * Každý tag HMI ukazuje na proměnnou, kterou generovaný program deklaruje (hlídá test
 * pro všechny příklady × platformy × jazyky). Program se kvůli HMI nemění: meze a žádané
 * hodnoty jsou v programu konstanty → v HMI jen ke čtení.
 */
import { Project, Device, PlatformKey } from "./model.js";
export type HmiType = "BOOL" | "INT" | "WORD" | "REAL";
/** ctrl = řízení stroje, dev = blok zařízení, seq = sekvence, ana = analogy, io = signál I/O, par = parametr. */
export type HmiGroup = "ctrl" | "dev" | "seq" | "ana" | "io" | "par";
export interface HmiState {
    value: number;
    text: string;
}
export interface HmiTag {
    /** Název tagu v HMI — identifikátor ASCII; u proměnných strojního bloku = tvar Unitronics (`instM1_status`). */
    name: string;
    /** machine = proměnná strojního bloku (FB_Machine / MAIN), io = globální tag I/O. */
    src: "machine" | "io";
    /** machine: cesta ve strojním bloku (`modeAuto`, `instM1.status`); io: tag I/O (`M1_fbkRunning`). */
    member: string;
    type: HmiType;
    /** RW jen u povelů z HMI (režim, start, kvitace, ruční povely). */
    access: "R" | "RW";
    /** momentary = tlačítko (TRUE po dobu stisku), toggle = přepínač. */
    cmd?: "momentary" | "toggle";
    group: HmiGroup;
    dev?: string;
    desc: string;
    unit?: string;
    min?: number;
    max?: number;
    /** Textový seznam hodnot (stav bloku, krok sekvence). */
    states?: HmiState[];
}
/** Názvy proměnných, které generátor deklaruje ve strojním bloku (řízení stroje). */
export declare function hmiCtrlNames(prj: Project): Set<string>;
/** Tagy HMI odvozené z projektu (pořadí: řízení, sekvence, zařízení, analogy, I/O, parametry). */
export declare function hmiTags(prj: Project): HmiTag[];
export type HmiAlarmClass = "fault" | "stop" | "warning";
export interface HmiAlarmTrigger {
    /** Název tagu HMI (vždy z `hmiTags`). */
    tag: string;
    /** bit = alarm při TRUE, bitOff = alarm při FALSE (blokování), value = alarm při tag = value. */
    kind: "bit" | "bitOff" | "value";
    value?: number;
}
export interface HmiAlarm {
    /** Pořadové číslo (1…) — číslo alarmu v HMI. */
    id: number;
    /** Identifikátor alarmu (ASCII): kód ze seznamu alarmů, u sdíleného signálu `A_<zař>_ERROR`. */
    name: string;
    /** Kódy ze seznamu alarmů (`04_seznam_alarmu.csv`), které alarm pokrývá. */
    codes: string[];
    dev: string;
    text: string;
    cause: string;
    reaction: string;
    ack: string;
    cls: HmiAlarmClass;
    /** 1 = nejvyšší. */
    priority: number;
    ackRequired: boolean;
    trigger: HmiAlarmTrigger;
}
export interface AlarmRow {
    code: string;
    dev: string;
    alarm: string;
    cause: string;
    reaction: string;
    ack: string;
}
/** Řádky seznamu alarmů z dokumentace (`docAlarmCsv`) — tytéž kódy a texty. */
export declare function alarmRows(prj: Project): AlarmRow[];
/**
 * Alarmy HMI: každý kód seznamu alarmů právě jednou. Blok zařízení nerozlišuje příčinu
 * poruchy (jediný výstup `error`) — kódy se společným signálem tvoří jeden alarm HMI
 * s texty všech příčin. Externí porucha motoru má vlastní vstup → vlastní alarm.
 */
export declare function hmiAlarms(prj: Project, tags?: HmiTag[]): HmiAlarm[];
export declare function alarmClassLabel(c: HmiAlarmClass): string;
export type HmiScreenKind = "overview" | "manual" | "alarms" | "sequence" | "params";
export declare const HMI_SCREEN_KINDS: HmiScreenKind[];
export declare function screenTitle(k: HmiScreenKind): string;
export type HmiCell = {
    t: string;
} | {
    tag: string;
    unit?: string;
};
/** Prvek obrazovky — jedna geometrie pro SVG náhled, webové HMI i JSON popis. */
export interface HmiElem {
    k: "header" | "nav" | "motor" | "valve" | "analog" | "aout" | "di" | "do" | "button" | "lamp" | "value" | "text" | "steps" | "alarmview" | "table" | "manrow";
    x: number;
    y: number;
    w: number;
    h: number;
    label?: string;
    sub?: string;
    dev?: string;
    /** Vazby na tagy HMI podle role (run, busy, err, open, value, on, hi, lo, cmd, status…). */
    tags?: Record<string, string>;
    unit?: string;
    min?: number;
    max?: number;
    limHi?: number;
    limLo?: number;
    /** Tlačítko: momentary / toggle. */
    cmd?: "momentary" | "toggle";
    /** Signálka: barva aktivního stavu. */
    color?: "green" | "red" | "yellow" | "blue";
    /** Přechod na obrazovku (navigace). */
    screen?: string;
    /** steps: řádky [hodnota kroku, text]. */
    steps?: Array<{
        value: number;
        text: string;
        sub: string;
    }>;
    /** table: hlavička a řádky. */
    head?: string[];
    rows?: HmiCell[][];
    cols?: number[];
    /** alarmview: náhledové řádky. */
    alarms?: Array<{
        id: number;
        text: string;
        cls: HmiAlarmClass;
    }>;
    /** DI: role vstupu (E-stop / blokování) pro barvu. */
    role?: "estop" | "interlock";
}
export interface HmiScreen {
    id: string;
    kind: HmiScreenKind;
    title: string;
    page: number;
    pages: number;
    W: number;
    H: number;
    elems: HmiElem[];
}
export interface HmiModel {
    project: string;
    tags: HmiTag[];
    alarms: HmiAlarm[];
    screens: HmiScreen[];
}
export declare const HMI_W = 1024, HMI_H = 600;
/** Obrazovky HMI (stránkované): Přehled, Ruční režim, Sekvence, Alarmy, Parametry. */
export declare function hmiScreens(prj: Project, tags?: HmiTag[], alarms?: HmiAlarm[]): HmiScreen[];
/** Celý model HMI projektu. */
export declare function buildHmi(prj: Project): HmiModel;
/**
 * Symbolická cesta tagu HMI v programu cílové platformy:
 * Siemens `"InstMachine".instM1.status` / `"M1_outRun"`, CODESYS rodina `MAIN.x` / `GVL_IO.x`,
 * Rockwell `Program:PLCdesk.x` / `x`, Unitronics plochý tag `instM1_status`.
 */
export declare function hmiPlcPath(plat: PlatformKey, t: HmiTag): string;
/** ASCII pro formáty, které Unicode nesnesou (CSV pro starší HMI, identifikátory). */
export declare function hmiAscii(s: string): string;
/** Tag HMI podle názvu. */
export declare function hmiTag(m: HmiModel, name: string): HmiTag | undefined;
/** Zařízení elementu (pro odkazy v UI). */
export declare function hmiElemDevice(prj: Project, e: HmiElem): Device | undefined;
