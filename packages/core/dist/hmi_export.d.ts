/**
 * PLCdesk — HMI: exporty tagů a alarmů pro HMI výrobců.
 *
 * Formáty ověřené proti veřejné dokumentaci / reálným exportům (zdroje v `HMI_SPECS`), ale
 * žádný nebyl naimportován do cílového nástroje → všechny nesou stav „neověřeno importem“.
 * Kde výrobce formát nezveřejňuje, je výstup referenční seznam / kostra a README to říká.
 *
 *  Siemens WinCC Comfort/Advanced  HMI_Tags_Openness.xml (Openness, Hmi.Tag.TagTable), listy
 *                                  pro Excel import (Hmi Tags / DiscreteAlarms / AnalogAlarms)
 *                                  jako TSV + `hmiSiemensWorkbook()` = přímo .xlsx (bajty)
 *  Rockwell FactoryTalk View ME/SE FTView_Tags.csv (formát 6.x), FTView_Alarms.xml (ME Alarm Setup)
 *  CODESYS / Schneider             Symbolconfiguration (referenční), tabulka alarmů skupiny (CSV)
 *  Beckhoff TwinCAT HMI            seznam symbolů ADS s vazbou TcHmi, tabulka alarmů
 *  Mitsubishi GT Designer3         seznam tagů a komentáře alarmů (CSV, ASCII)
 *  Omron NA (Sysmac)               proměnné k vložení (TSV), uživatelské alarmy (TSV)
 *  Unitronics                      bez exportu (HMI je součástí UniLogic, tagy jsou globální)
 */
import { Project, PlatformKey } from "./model.js";
import { type HmiModel, type HmiTag } from "./hmi.js";
export type HmiExportStatus = "unverified" | "reference" | "stub";
export interface HmiExportFileSpec {
    name: string;
    /** Popis formátu (klíč překladu). */
    format: string;
    status: HmiExportStatus;
    sources: string[];
    /** Soubor musí být čisté ASCII (hlídá test). */
    ascii?: boolean;
    /** Jak se v souboru zapisuje cesta proměnné strojního bloku (test: každý tag je v souboru). */
    paths?: (t: HmiTag, plat: PlatformKey) => string;
}
export interface HmiExportSpec {
    product: string;
    files: HmiExportFileSpec[];
}
export declare function hmiStatusLabel(s: HmiExportStatus): string;
/** Odkaz na proměnnou PLC v HMI Siemens (bez uvozovek, jak ho zapisuje export TIA). */
export declare function tiaControllerTag(t: HmiTag): string;
/** Adresa tagu zařízení FactoryTalk View (zkratka „PLC“, `::` kvůli dvojtečce v cestě programu). */
export declare function ftvAddress(t: HmiTag): string;
export declare function hmiExportSpec(plat: PlatformKey): HmiExportSpec | null;
/** Listy importu Excel TIA (WinCC Comfort/Advanced): Hmi Tags, DiscreteAlarms, AnalogAlarms. */
export declare function tiaSheets(m: HmiModel): Array<{
    name: string;
    rows: Array<Array<string | number>>;
}>;
/** Sešit .xlsx pro import tagů a alarmů v TIA Portal (WinCC Comfort/Advanced) — bajty, ukládat binárně. */
export declare function hmiSiemensWorkbook(prj: Project, m?: HmiModel): Uint8Array;
/**
 * Soubory exportu HMI pro platformu (název → obsah). Napojení: přes `registerHmiModule()`
 * (hmi_docs.ts) se přidají do sady projektu jako skupina „HMI — <platforma>“; `genFor` se nemění.
 */
export declare function hmiFiles(prj: Project, plat: PlatformKey, m?: HmiModel): Record<string, string>;
