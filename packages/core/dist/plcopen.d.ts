/**
 * PLCopen XML (TC6) export — jeden importovatelný soubor pro CODESYS V3.5,
 * TwinCAT 3 a EcoStruxure Machine Expert: POU (FB knihovna + MAIN, ST)
 * + globální proměnné GVL_IO s adresami.
 *
 * Zdrojem je FINÁLNÍ text, který jde do Gen_Library.st a MAIN.st pro danou platformu
 * (přeložené komentáře, ruční povely, porucha stroje, meze, rawMax, cmtSafe…) — žádné
 * surové šablony, aby se import nikdy nelišil od ručně vložených souborů.
 *
 * Namespace tc6_0200 (nejširší kompatibilita; CODESYS/TwinCAT round-trip).
 * Import v IDE: Project / PLC projekt → Import PLCopenXML. Import je aditivní —
 * duplicitní názvy POU hlásí chybu (smazat staré, nebo importovat do prázdné aplikace).
 *
 * Struktura ověřená skutečným importem a překladem v CODESYS V3.5 SP21 Patch 6 (2026-10-05):
 * GVL_IO v `addData …/plcopenxml/globalvars` projektu (ne v `<configurations>` — tu CODESYS
 * odmítne celou), `<configurations />` prázdné, VAR_IN_OUT jako `<inOutVars>`. Úlohu import
 * objektů nevytváří — README: v MainTask nahradit volání PLC_PRG voláním MAIN.
 * Emulátor kontroluje strukturu (`emu/plcopen_check.ts`).
 */
import { Project, PlatformKey } from "./model.js";
export interface ParsedVar {
    name: string;
    type: string;
    init?: string;
    comment?: string;
    address?: string;
}
export interface ParsedPou {
    name: string;
    kind: "functionBlock" | "program";
    inputs: ParsedVar[];
    outputs: ParsedVar[];
    inouts: ParsedVar[];
    locals: ParsedVar[];
    body: string;
}
/** Rozparsuje náš vlastní, dobře formovaný ST POU (generovaný FB / MAIN) na interface + tělo. */
export declare function parseStPou(src: string): ParsedPou;
/** Všechny FUNCTION_BLOCK z textu knihovny (Gen_Library.st obsahuje víc bloků za sebou). */
export declare function splitLibrary(lib: string): string[];
/**
 * Kompletní PLCopen TC6 XML projektu: knihovna FB (jen použité třídy — přesně bloky
 * z Gen_Library.st), MAIN (= MAIN.st) a GVL_IO s adresami dle cílové platformy
 * (v addData projektu, viz `plcopenGvlAddData`).
 */
export declare function genPLCopenXML(prj: Project, plat?: PlatformKey): string;
/**
 * Proměnné GVL_IO jako `<variable>` (odsazení 8) — tytéž, které deklaruje GVL_IO.st (`genGVL`):
 * I/O s adresou platformy a u TwinCATu proměnné os AXIS_REF (bez nich by MAIN po importu neznal Ax_…).
 */
export declare function gvlVarsXml(prj: Project, plat: PlatformKey): string;
/**
 * GVL_IO pro import CODESYS: rozšíření `addData …/plcopenxml/globalvars` na úrovni projektu
 * (tvar exportu CODESYS V3.5 SP21 Patch 6). `<configurations>` zůstává prázdné — CODESYS
 * 3.5.21.60 konfiguraci „Default“ při importu odmítne („Object 'Default' is not accepted…“)
 * a GVL i úlohu z ní přeskočí. Úlohu PLCopen import objektů nevytvoří → krok v README.
 * `vars` = řádky `<variable>` odsazené 8 mezerami; `extra` = další `<data>` v addData projektu.
 */
export declare function plcopenGvlAddData(vars: string, extra?: string): string;
