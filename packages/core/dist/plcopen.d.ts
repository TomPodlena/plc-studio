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
    locals: ParsedVar[];
    body: string;
}
/** Rozparsuje náš vlastní, dobře formovaný ST POU (generovaný FB / MAIN) na interface + tělo. */
export declare function parseStPou(src: string): ParsedPou;
/** Všechny FUNCTION_BLOCK z textu knihovny (Gen_Library.st obsahuje víc bloků za sebou). */
export declare function splitLibrary(lib: string): string[];
/**
 * Kompletní PLCopen TC6 XML projektu: knihovna FB (jen použité třídy — přesně bloky
 * z Gen_Library.st), MAIN (= MAIN.st) a GVL_IO s adresami dle cílové platformy.
 */
export declare function genPLCopenXML(prj: Project, plat?: PlatformKey): string;
