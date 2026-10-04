/**
 * PLCdesk — lexer IEC 61131-3 ST / Siemens SCL / Logix ST (emulátor překladu).
 * Tokeny nesou polohu (řádek:sloupec); komentáře se přeskakují (vnořené dle dialektu).
 */
import type { Token, EmuFinding } from "./types.js";
export interface LexOptions {
    nestedComments: boolean;
    scl: boolean;
}
export interface LexResult {
    toks: Token[];
    errors: EmuFinding[];
}
/** Milisekundy z těla časového literálu (`5S`, `1s500ms`, `1h_2m`, `1.5s`); NaN = neplatné. */
export declare function timeMs(body: string): number;
export declare function lex(src: string, file: string, o: LexOptions): LexResult;
