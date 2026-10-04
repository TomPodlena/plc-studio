/**
 * PLCdesk — emulátor překladu: sémantická kontrola (deklarace, typy, parametry bloků,
 * rezervovaná slova, identifikátory) a překlad normalizovaného AST do JavaScriptu pro běh
 * scan po scanu. Paměť programu je jedno pole Float64Array (BOOL 0/1, celá čísla, REAL,
 * TIME v ms) — stav jde levně kopírovat (kontrolní body ověření).
 */
import type { Expr, Stmt, Pos, Unit, Pou, VarKind, EmuFinding } from "./types.js";
import { Dialect, ElemInfo } from "./dialects.js";
export type Ty = {
    k: "elem";
    name: string;
    info: ElemInfo;
    lit?: boolean;
} | {
    k: "fb";
    def: FbDef;
} | {
    k: "struct";
    name: string;
    fields: VarSym[];
    map: Map<string, VarSym>;
    size: number;
} | {
    k: "array";
    of: Ty;
    dims: Array<[number, number]>;
    size: number;
} | {
    k: "enum";
    name: string;
    values: Map<string, number>;
} | {
    k: "ns";
    name: string;
    vars: Map<string, VarSym>;
    qualifiedOnly: boolean;
}
/** Odkaz na rozhraní (OOP): jeden slot = adresa instance + 1, 0 = neplatný odkaz. */
 | {
    k: "itf";
    def: ItfDef;
};
/** Parametr metody (pro kontrolu podpisu a předání argumentů). */
export interface ParamSym {
    name: string;
    key: string;
    kind: VarKind;
    ty: Ty;
}
/** Rozhraní (INTERFACE): metody a vlastnosti, které musí implementující blok mít. */
export interface ItfDef {
    name: string;
    key: string;
    pou: Pou;
    pos: Pos;
    methods: Map<string, {
        name: string;
        params: ParamSym[];
        retTy?: Ty;
        pos: Pos;
    }>;
    props: Map<string, {
        name: string;
        ty: Ty;
        get: boolean;
        set: boolean;
        pos: Pos;
    }>;
    laid: boolean;
}
/** Vlastnost bloku: přístupové metody GET / SET (leží v `methods` pod __GET_x / __SET_x). */
export interface PropSym {
    name: string;
    ty: Ty;
    getter?: FbDef;
    setter?: FbDef;
    owner: FbDef;
    pos: Pos;
    access?: Pou["access"];
}
export interface VarSym {
    name: string;
    key: string;
    kind: VarKind;
    ty: Ty;
    init?: Expr;
    pos: Pos;
    /** Offset v instanci (u globálních absolutní slot). */
    off: number;
    constVal?: number;
    /** Výchozí hodnota z tabulky (L5X DefaultData) — číslo. */
    initNum?: number;
}
export interface FbDef {
    name: string;
    key: string;
    /** Standardní blok (TON, R_TRIG, FBD_TIMER …). */
    std?: string;
    aoi?: boolean;
    vars: VarSym[];
    map: Map<string, VarSym>;
    size: number;
    body?: Stmt[];
    methods: Map<string, FbDef>;
    pou?: Pou;
    pos?: Pos;
    js: string;
    laid: boolean;
    /** Metoda: blok, jehož proměnné vidí. */
    owner?: FbDef;
    retTy?: Ty;
    /** Metoda: proměnná návratové hodnoty (u GET vlastnosti = jméno vlastnosti). */
    retSym?: VarSym;
    /** Metoda: parametry (počítá se při prvním volání). */
    params?: ParamSym[];
    /** Identifikátor třídy (slot __TID instance) pro dynamické volání metod. */
    tid?: number;
    parent?: FbDef;
    abstract?: boolean;
    final?: boolean;
    access?: Pou["access"];
    /** Rozhraní uvedená v IMPLEMENTS tohoto bloku (zděděná se hledají přes `parent`). */
    itfs?: ItfDef[];
    props?: Map<string, PropSym>;
}
export declare function tyName(t: Ty): string;
/** Jednotka předvolby časovačů TIMER_x_FB_M [ms]. */
export declare const TIMER_M_UNIT: Record<string, number>;
export interface TagDecl {
    name: string;
    type: string;
    pos: Pos;
    at?: string;
    init?: number;
}
export interface AoiDecl {
    name: string;
    pos: Pos;
    params: Array<{
        name: string;
        type: string;
        usage: "Input" | "Output" | "InOut";
        def?: number;
        pos: Pos;
    }>;
    locals: Array<{
        name: string;
        type: string;
        def?: number;
        pos: Pos;
    }>;
    body: Stmt[];
}
export interface CompileInput {
    d: Dialect;
    units: Unit[];
    /** Globální tagy z tabulek (Siemens tagy, GX návěští, Sysmac proměnné, Unitronics, Logix). */
    tags: TagDecl[];
    /** Druhá úroveň globálních tagů (Logix: programové tagy) — přednost před `tags`. */
    progTags?: TagDecl[];
    aois?: AoiDecl[];
    /** Vstupní bod: program (MAIN) nebo holé příkazy (OB1, rutina, funkce UniLogic). */
    entry: {
        program: string;
    } | {
        stmts: Stmt[];
        file: string;
    };
}
export interface TimerInfo {
    kind: string;
    base: number;
}
export interface Compiled {
    ok: boolean;
    findings: EmuFinding[];
    size: number;
    init: Float64Array;
    /** JS zdroj programu (pro ladění). */
    src: string;
    /** Vytvoří spustitelný program nad pamětí `m`. */
    make?: (m: Float64Array) => {
        scan: (nowMs: number) => void;
        rt: {
            err: string;
        };
    };
    /** Slot a typ podle cesty (["GVL_IO","M1_outRun"], ["MAIN","instM1","statStep"]). */
    addr: (path: string[]) => {
        slot: number;
        ty: Ty;
    } | undefined;
    timers: TimerInfo[];
    /** Sloty, které se mění jen během časování (ET / ACC) — maska pro detekci klidu. */
    etMask: Uint8Array;
    /** Program čte uplynulý čas časovače (ET / ACC) — stav pak závisí na čase i bez změny vstupů. */
    readsTime: boolean;
}
export declare function compile(inp: CompileInput): Compiled;
