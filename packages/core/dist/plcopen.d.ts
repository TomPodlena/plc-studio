/**
 * PLCopen XML (TC6) export — jeden importovatelný soubor pro CODESYS V3.5,
 * TwinCAT 3 a EcoStruxure Machine Expert: POU (FB knihovna + MAIN, ST)
 * + globální proměnné GVL_IO s adresami.
 *
 * Namespace tc6_0200 (nejširší kompatibilita; CODESYS/TwinCAT round-trip).
 * Import v IDE: Project/File → Import PLCopenXML. Import je aditivní —
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
/** Rozparsuje náš vlastní, dobře formovaný ST POU (šablony/generovaný MAIN) na interface + tělo. */
export declare function parseStPou(src: string): ParsedPou;
/**
 * Kompletní PLCopen TC6 XML projektu: knihovna FB (jen použité třídy),
 * MAIN a GVL_IO s adresami dle cílové platformy (%IX…).
 */
export declare function genPLCopenXML(prj: Project, plat?: PlatformKey): string;
