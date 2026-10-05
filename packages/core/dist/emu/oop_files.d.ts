/**
 * PLCdesk — emulátor: kontrola souborů stylu OOP, které se importují místo ST výpisu.
 *
 * TwinCAT (.TcPOU / .TcIO / .TcGVL) a PLCopen XML s rozšířením CODESYS (addData: method,
 * property, interface, pouinheritance, interfaceasplaintext) se rozeberou zpět na deklarace
 * a těla objektů, z nich se sestaví výpis (`oopListing`, stejný zápis jako generátor) a ten se
 * porovná s ST výpisem, který emulátor překládá a spouští. Shoda = importovaný kód je TENTÝŽ
 * program, jaký emulátor ověřil. U PLCopen se navíc porovnají proměnné strukturované části
 * (`<interface>`, kterou čte import CODESYS) s textovou deklarací.
 *
 * Kontrola sama import v IDE nenahrazuje. Tvar PLCopen XML je ověřen skutečným importem a překladem
 * v CODESYS V3.5 SP21 Patch 6 (2026-10-05); TwinCAT (TcPOU i PLCopen) importem ověřen není.
 */
import type { PlatformKey } from "../model.js";
import type { EmuFinding } from "./types.js";
import { type OopListingObj } from "../codegen_oop.js";
/** Objekty ST výpisu (INTERFACE / FUNCTION_BLOCK / PROGRAM … END_*) podle jména. */
export declare function stObjects(text: string): Map<string, string>;
/** Objekt z .TcPOU / .TcIO (Declaration, Implementation, Method, Property/Get). */
export declare function tcObject(xml: string): {
    name: string;
    obj: OopListingObj;
} | undefined;
export declare function plcopenObjects(xml: string): Array<{
    name: string;
    obj: OopListingObj;
    varsXml: string[];
    methodsVars: Array<{
        name: string;
        xml: string[];
        decl: string[];
    }>;
}>;
/**
 * Porovná objekty souborů pro import (TcPOU / PLCopen XML) s ST výpisem. `stFiles` = jméno →
 * text ST souborů (Gen_Library.st, FB_Sequence.st, MAIN.st).
 */
export declare function checkOopFiles(files: Record<string, string>, plat: PlatformKey, out: EmuFinding[]): void;
