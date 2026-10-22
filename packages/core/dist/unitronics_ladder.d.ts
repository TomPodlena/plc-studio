/**
 * Unitronics Vision / Samba (VisiLogic) a Jazz / M91 (U90 Ladder) — RUČNÍ PŘENOS.
 *
 * Obě IDE programují jen Ladder a neumí import programu ani názvů operandů z textu (formát .vlp / .U90
 * není dokumentovaný, API není). Výstup je proto žebříček k ručnímu zadání, celý odvozený KÓDEM:
 * plochá logika Unitronics (`uniSections` v codegen.ts = buildIR + šablony bloků rozepsané `inlineFb`,
 * tentýž text, který překladač UniLogic přijal) se přeloží parserem emulátoru na příkazy a ty se
 * mechanicky převedou na větve: kontakty (NO / NC), porovnání, cívky, SET / RST, funkce (MOV, ADD…)
 * a časovače. Sémantika ST se zachová:
 *  - podmínka IF / CASE, jejíž operandy větev sama mění, se nejdřív uloží do pomocného bitu (aux_*) —
 *    jinak by se v dalších větvích téže větve vyhodnotila znovu se změněnou hodnotou,
 *  - podmíněné přiřazení bitu = SET / RST, nepodmíněné = cívka,
 *  - aritmetika po elementárních funkcích přes pomocné registry (aux_i / aux_f).
 * Výhrada (README): TON uvnitř IF — při nesplněné podmínce větve se časovač v žebříčku nuluje
 * (ST ho jen nevolá); šablony PLCdesk ho po návratu podmínky stejně nulují (stav bloku se vynuluje).
 */
import type { Project, PlatformKey, IoEntry, Dir } from "./model.js";
import { type UniSection } from "./codegen.js";
import { type HwChannel, type HwLayout } from "./hardware.js";
export type LadderPlat = "vision" | "jazz";
export declare const LADDER_PLATS: LadderPlat[];
export declare function isLadderPlat(p: PlatformKey): p is LadderPlat;
export type OpType = "I" | "O" | "MB" | "MI" | "MF" | "T" | "C";
export interface Operand {
    name: string;
    type: OpType;
    no: number;
    /** datový typ v programu (BIT / INT / REAL / TIMER) */
    dt: "BIT" | "INT" | "REAL" | "TIMER";
    desc: string;
    /** časovač: preset v ms a v jednotkách platformy */
    presetMs?: number;
    preset?: number;
    unit?: number;
    /** I/O: signál projektu a kanál sestavy */
    io?: IoEntry;
    ch?: HwChannel;
    /** U90: REAL bez MF → MI (celočíselně) */
    intReal?: boolean;
    aux?: boolean;
}
/** Limity operandů podle CPU (spec. PDF výrobce; viz README a data/catalog/plc.json). */
export interface LadderLimits {
    cpu: string;
    MB: number;
    MI: number;
    MF: number;
    T: number;
    C: number;
    app: string;
    src: string;
}
/** Preset časovače: Vision 10 ms (do 99 h); U90 14 bitů + jednotka 10 ms / 100 ms / 1 s / 10 s. */
export declare function timerPreset(plat: LadderPlat, ms: number): {
    preset: number;
    unit: number;
};
type Net = {
    t: "const";
    v: boolean;
} | {
    t: "no" | "nc";
    op: string;
} | {
    t: "cmp";
    op: string;
    a: string;
    b: string;
} | {
    t: "and" | "or";
    items: Net[];
};
type Out = {
    t: "coil" | "set" | "rst";
    op: string;
} | {
    t: "fn";
    fn: string;
    args: string[];
    dst: string;
    fp?: boolean;
} | {
    t: "timer";
    op: string;
    presetMs: number;
};
export interface Rung {
    no: number;
    comment: string;
    cond: Net;
    outs: Out[];
    reads: Set<string>;
}
export interface LadderSection {
    title: string;
    kind: UniSection["kind"];
    rungs: Rung[];
}
export interface LadderProgram {
    plat: LadderPlat;
    ops: Map<string, Operand>;
    sections: LadderSection[];
    limits: LadderLimits;
    problems: string[];
    L: HwLayout;
}
/** Program v žebříčku pro VisiLogic / U90 (operandy + větve po částech). */
export declare function buildLadder(prj: Project, plat: LadderPlat): LadderProgram;
export declare function opAddr(o: Operand | undefined): string;
/** ASCII kresba větve: levá lišta, kontakty (sériově = AND, paralelně = OR), výstupy vpravo pod sebou. */
export declare function rungAscii(P: LadderProgram, r: Rung): string;
/** Překročení limitů operandů CPU (README, validace). */
export declare function ladderLimitProblems(P: LadderProgram): string[];
/** Operandy.csv: název (= tag), typ, adresa, preset časovače, popis. */
export declare function ladderOperandsCsv(P: LadderProgram): string;
/** IO_mapa.csv: signál → operand → modul a kanál sestavy. */
export declare function ladderIoMapCsv(P: LadderProgram, prj: Project): string;
/** Ladder.md: program větev po větvi (popis + ASCII kresba). */
export declare function ladderMd(P: LadderProgram, prj: Project): string;
/** Ladder.html: tisknutelná podoba téhož (větev nepřeteče přes stránku). */
export declare function ladderHtml(P: LadderProgram, prj: Project): string;
/** README.txt: štítek ověření, postup ručního zadání, omezení a neověřené volby. */
export declare function ladderReadme(P: LadderProgram, prj: Project): string;
/** Všechny soubory platformy s ručním přenosem. */
export declare function genForLadder(prj: Project, plat: LadderPlat): Record<string, string>;
/** Pro testy a validaci: počty operandů a limity. */
export declare function ladderStats(prj: Project, plat: LadderPlat): {
    counts: Record<OpType, number>;
    limits: LadderLimits;
    problems: string[];
    limitProblems: string[];
};
export type { Dir };
