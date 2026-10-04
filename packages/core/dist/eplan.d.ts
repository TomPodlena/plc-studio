/**
 * PLCdesk — export do EPLAN Electric P8 (bez licence EPLAN, přes dokumentované importní cesty).
 *
 *   eplanAml(prj)          PLC, I/O karty, kanály a symbolické adresy ve formátu AutomationML
 *                          AR APC 1.4.0 (CAEX 2.15) — EPLAN: Import PLC dat („AutomationML AR APC“);
 *                          karty nesou označení dle IEC 81346 („ProductDesignation IEC“) a objednací
 *                          číslo z kusovníku („TypeIdentifier“ = „OrderNumber:…“)
 *   eplanDevicesCsv(prj)   seznam zařízení z kusovníku (označení, výrobce, typ, objednací číslo) —
 *                          EPLAN: Projektová data → Zařízení → Import (textový soubor, CSV Unicode)
 *   eplanTerminalsCsv(prj) svorky -X<n>:<k> s kartou, kanálem, adresou, tagem a vodičem
 *   eplanWiresCsv(prj)     vodiče -W<n><k> (zdroj → svorka) — podklad, EPLAN pro spoje nemá textový import
 *   eplanReadme(prj)       postup importu a stav ověření
 *   eplanFiles(prj)        všechny soubory (název → obsah)
 *
 * Označení se berou ze sestavy hardwaru (hardware.ts) jako výkresy (drawing.ts: svorkovnice X<skupina>,
 * vodiče `wireNo` z model.ts: X1:1 → -W101, X2:1 → -W201 …) a kusovník (bom.ts: -A1 CPU s vestavěnými
 * I/O, -A2 DI, -A3 DO, -A4 AI, -A5 AO; víc karet téže řady = -A2.1, -A2.2 …; vzdálená stanice s = hlava
 * -A(10s), karty -A(10s+2) …). Stav ověření: `EPLAN_VERIFIED`.
 */
import { Project, IoModule, Dir } from "./model.js";
import { type BomLine } from "./bom.js";
import { type EplanAmlOptions } from "./eplan_aml.js";
export declare const EPLAN_VERIFIED: string;
export declare const EPLAN_SOURCES: string[];
/** Konvertor EPLAN pro import (plcservice CONVERTERID): Siemens → TIA Portal 19 (AR APC 1.4.0), jinak obecný AML EPLAN. */
export declare function eplanConverterId(prj: Project): string;
/** Kanálová skupina modulu sestavy (hardware.ts) s označením a řádkem kusovníku — jedna svorkovnice. */
export interface EplanCard {
    /** Označení modulu dle IEC 81346 (-A1 vestavěné I/O, -A2 / -A2.1, -A12 …) a skupina řádku kusovníku. */
    dt: string;
    bomTag: string;
    mod: IoModule;
    /** Číslo svorkovnice X<n> (pořadí kanálové skupiny jako ve výkresech). */
    xnum: number;
    /** pozice modulu v racku (slot) */
    position: number;
    line: BomLine | undefined;
}
export interface EplanTerminal {
    strip: string;
    no: number;
    dt: string;
    card: string;
    channel: number;
    dir: Dir;
    addr: string;
    tag: string;
    device: string;
    desc: string;
    wire: string;
}
/** I/O karty s označením (stejné pořadí jako výkresy a seznam svorek dokumentace). */
export declare function eplanCards(prj: Project): EplanCard[];
/** Svorky a vodiče podle výkresů: svorka X<n>:<k>, vodič `wireNo(n, k − 1)` (X1:1 → -W101, X2:1 → -W201 …). */
export declare function eplanTerminals(prj: Project, cards?: EplanCard[]): EplanTerminal[];
/**
 * AutomationML AR APC (CAEX 2.15): stanice, rack, CPU s rozhraním PROFINET, karty, kanály
 * a symbolické adresy — generátor a kontrola jsou v eplan_aml.ts (`genEplanAml`, `validateEplan`).
 */
export declare function eplanAml(prj: Project, cards?: EplanCard[], opts?: EplanAmlOptions): string;
/** Název skriptu EPLAN (C#) v sadě souborů a v repozitáři (apps/eplan/). */
export declare const EPLAN_SCRIPT_NAME = "PLCdesk_ImportAML.cs";
/**
 * Skript EPLAN (C#, skriptovací stroj EPLAN — bez licence API): import PLC dat přes akci
 * `plcservice /TYPE:BUSDATAIMPORT` (konvertor podle obsahu: Siemens → PlcDcExchangerSiemensTIA19AML,
 * jinak PlcDcAMLExchangerGeneral; IMPORTMATCH 0 = podle ID) a volitelně `GENERATEPLCSCHEMATIC`
 * s uloženým nastavením zákazníka. Text je shodný se souborem apps/eplan/PLCdesk_ImportAML.cs (hlídá test);
 * technický výstup → anglicky a ASCII v každém jazyce. Neověřeno v EPLAN.
 */
export declare function eplanImportScript(): string;
/** Seznam zařízení z kusovníku: karty rozepsané na -A2.1 …, svorky a kabely v samostatných seznamech. */
export declare function eplanDevicesCsv(prj: Project, cards?: EplanCard[]): string;
/** Svorky (-X<n>:<k>) s kartou, kanálem, adresou, symbolickou adresou, cílem a vodičem. */
export declare function eplanTerminalsCsv(prj: Project, cards?: EplanCard[]): string;
/** Vodiče: zařízení → svorka, potenciál a karta PLC (podklad — průřez a barvu doplní projektant). */
export declare function eplanWiresCsv(prj: Project, cards?: EplanCard[]): string;
export declare function eplanAmlName(prj: Project): string;
/** README: postup importu do EPLAN a stav ověření. */
export declare function eplanReadme(prj: Project, cards?: EplanCard[]): string;
/** Všechny soubory exportu do EPLAN (název → obsah). */
export declare function eplanFiles(prj: Project): Array<{
    name: string;
    body: string;
}>;
/** Přihlásí soubory pro EPLAN do sady projektu (skupina „EPLAN“). Vrací odhlášení. */
export declare function registerEplanExport(): () => void;
