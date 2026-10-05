/**
 * PLCdesk — emulátor: strukturní kontrola IEC61131-10_Import.xml (IEC 61131-10 Ed. 1.0).
 *
 * XSD normy se nedistribuuje (licence IEC Code Components, viz `IEC10_XSD` v iec61131_10.ts) — tahle
 * kontrola hlídá to, na čem import závisí, a shodu XML s ručně vkládanými soubory:
 *  1. well-formed, kořen `<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10" schemaVersion="1.0">`,
 *     pořadí FileHeader → ContentHeader → Types/GlobalNamespace → Instances (XSD);
 *  2. jména POU a typů jedinečná bez ohledu na velikost písmen, globální proměnné jedinečné a bez
 *     kolize s POU (GX Works3 při duplicitě importuje jen první — SH-081215ENG 3.3);
 *  3. každý POU z ST je v XML a naopak; rozhraní (Parameters / Vars / TempVars, jména, typy, pořadí,
 *     `orderWithinParamSet` 1…n) = deklarace ST; tělo `BodyContent xsi:type="ST"` = tělo ST (GX Works3
 *     importuje jen ST);
 *  4. globální proměnné = tabulka návěští (jméno, typ, operand);
 *  5. cíl Mitsubishi FX5: bez počátečních hodnot, operand bez `%`, jedna sada GlobalVars (seznam
 *     „Global“), program registrovaný v programovém souboru (Resource / ProgramInstance).
 * Emulátor ≠ import výrobce: import v GX Works3 / PLCnext Engineer neověřen.
 */
import type { PlatformKey } from "../model.js";
import type { EmuFinding } from "./types.js";
import { type Iec10Source, type Iec10Target } from "../iec61131_10.js";
/**
 * Problémy XML proti finálním textům platformy (prázdné pole = v pořádku).
 * `src` = Gen_Library / MAIN / globální návěští, ze kterých XML vzniklo (ruční cesta importu).
 */
export declare function iec10Problems(xml: string, src: Iec10Source, target: Iec10Target): string[];
/** Emulátor (Mitsubishi): IEC61131-10_Import.xml × Gen_Library.st / MAIN.st / GlobalLabels.csv. */
export declare function checkIec10Files(files: Record<string, string>, plat: PlatformKey, out: EmuFinding[]): void;
