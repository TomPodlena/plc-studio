/**
 * PLCdesk — emulátor překladu: načtení vygenerovaných souborů jedné platformy
 * (kód, tabulky tagů, L5X) do vstupu překladače + kontroly na úrovni souborů
 * (ASCII, formát adres, shoda tabulek tagů, well-formed XML).
 */
import type { Project, PlatformKey } from "../model.js";
import type { EmuFinding } from "./types.js";
import type { CompileInput } from "./compile.js";
export interface Loaded {
    input?: CompileInput;
    findings: EmuFinding[];
}
/** Rozdělí řádek CSV (uvozovky, zdvojené uvozovky uvnitř). */
export declare function csvRow(line: string, sep?: string): string[];
/** Načte soubory platformy (výstup genFor) do vstupu překladače. */
export declare function loadPlatform(prj: Project, plat: PlatformKey, files: Record<string, string>): Loaded;
