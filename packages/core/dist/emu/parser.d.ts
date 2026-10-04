/**
 * PLCdesk — parser IEC 61131-3 ST / SCL / Logix ST (rekurzivní sestup) pro emulátor překladu.
 * Vrací AST s polohou, syntaktické chyby (soubor:řádek:sloupec) a místa, kde za END_IF /
 * END_CASE … chybí středník (pravidlo podle dialektu).
 */
import type { Token, Pos, Unit, EmuFinding } from "./types.js";
export interface ParseOptions {
    scl: boolean;
    statementsOnly: boolean;
}
export interface ParseResult {
    unit: Unit;
    errors: EmuFinding[];
    semi: Array<{
        pos: Pos;
        what: string;
    }>;
}
export declare function parse(toks: Token[], file: string, o: ParseOptions): ParseResult;
