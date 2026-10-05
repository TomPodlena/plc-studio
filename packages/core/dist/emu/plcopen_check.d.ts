/**
 * PLCdesk — emulátor: strukturní kontrola PLCopen_Import.xml pro import CODESYS (rodina CODESYS).
 *
 * Pravidla ze SKUTEČNÉHO importu a překladu v CODESYS V3.5 SP21 Patch 6 (3.5.21.60, Control Win V3 x64,
 * 2026-10-05) a z exportu téhož IDE (tvar, který import čte):
 *  1. GVL v `<instances><configurations><configuration …>` CODESYS odmítne („Object 'Default' is not
 *     accepted by parent object…“) a přeskočí celou konfiguraci → GVL_IO chybí (C46 a stovky následných
 *     chyb). GVL patří do `<addData><data name="…/plcopenxml/globalvars">` projektu; obsah musí být
 *     totožný s GVL_IO.st (jména, typy, adresy).
 *  2. Rozhraní POU v `<interface>` = deklarace v ST: sekce inputVars / outputVars / inOutVars / localVars
 *     ve stejném pořadí. VAR_IN_OUT jako localVars → C37 „'Axis' is no input of 'FB_AXIS'“ + C540.
 *  3. Styl OOP: textová deklarace (`InterfaceAsPlainText`, nese ABSTRACT / přístup / komentáře / atributy)
 *     u POU v addData ZA `</body>`, u Method / Property / Interface jako přímý potomek elementu. Jinde
 *     ji CODESYS ignoruje a deklaraci postaví ze strukturované části (bez modifikátorů).
 * Emulátor ≠ import výrobce: kontrola hlídá jen zjištěné odchylky, ne celé chování importu.
 */
import type { PlatformKey } from "../model.js";
import type { EmuFinding, Unit } from "./types.js";
export declare function checkPlcopenStructure(files: Record<string, string>, units: Unit[], plat: PlatformKey, out: EmuFinding[]): void;
