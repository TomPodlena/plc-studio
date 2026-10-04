/**
 * PLCdesk — emulátor: objekty os a bloky Motion Control jako standardní typy dialektu.
 *
 * Každá podporovaná platforma servoosy (axis_gen.ts) má tady svůj typ objektu osy (členy, které
 * generovaný kód čte, jsou jen jiná jména slotů modelu axis.ts — jen ke čtení) a své bloky MC_*
 * se jmény a typy parametrů podle manuálu výrobce (zdroje `AXIS_SRC`). Blok se při volání chová
 * podle společného modelu `mcCall` (PLCopen); výklad dynamiky (−1.0 / 0 / povinné) podle platformy.
 * Logix: instrukce MSO / MSF / MAFR / MAH / MAM / MAJ / MAS s tagem MOTION_INSTRUCTION (`lxExec`).
 *
 * Emulátor ≠ překladač výrobce: seznam parametrů je výběr, který FB_Axis používá (+ ty, které
 * manuál uvádí jako povinné / běžné); jiné parametry bloků emulátor nezná a nahlásí je jako chybu.
 */
import { AX_SIZE, MI_SIZE, type McKind, type McMap, type McPlat } from "../axis.js";
import type { AxisDialect } from "../axis_gen.js";
/** Členy objektu osy čitelné z programu: cesta, typ, slot modelu (axis.ts AX). */
export declare const AXIS_MEMBERS: Record<AxisDialect, Array<[string, string, number]>>;
export { AX_SIZE };
/** MOTION_INSTRUCTION (Logix): bity a kódy chyby. */
export declare const MI_MEMBERS: Array<[string, string, number]>;
export { MI_SIZE };
/** Výčty knihoven (hodnoty z manuálů). */
export declare const MC_ENUMS: Partial<Record<AxisDialect, Record<string, Record<string, number>>>>;
/** Člen bloku: jméno, typ, směr, význam pro model (`McMap`). */
export type MSpec = [string, string, "in" | "out" | "inout", (keyof McMap)?];
export interface McFbSpec {
    kind: McKind | "vel";
    members: MSpec[];
    dir?: {
        pos: number[];
        neg: number[];
    };
}
/** Bloky MC podle dialektu (jména a typy parametrů podle manuálů — výběr). */
export declare function mcBlocks(dia: AxisDialect): Record<string, McFbSpec>;
/** Výklad dynamiky pro model (axis.ts `McPlat`). */
export declare function mcPlatOf(dia: AxisDialect): McPlat;
/** Instrukce pohybu Logix a počet operandů v ST (MOTION-RM002). */
export declare const LX_MOTION_INSTR: Record<string, number>;
