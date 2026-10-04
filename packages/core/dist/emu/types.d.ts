/**
 * PLCdesk — emulátor překladu a běhu: společné typy (tokeny, AST, nálezy).
 *
 * Emulátor NENÍ překladač výrobce. Pravidla vycházejí z manuálů výrobců a ze zpráv ověření
 * dialektů; reálný import v IDE je dál potřeba ověřit (viz dokument 15_emulace_prekladu.md).
 */
import type { PlatformKey } from "../model.js";
/** Poloha v souboru (řádek a sloupec od 1). */
export interface Pos {
    file: string;
    line: number;
    col: number;
}
/** Nález emulátoru překladu nebo běhu. */
export interface EmuFinding {
    level: "error" | "warn" | "info";
    /** Identifikátor pravidla (např. `undeclared`, `end-semicolon`). */
    rule: string;
    file: string;
    line: number;
    col: number;
    msg: string;
    /** Zdroj pravidla (manuál výrobce / zpráva ověření). */
    source?: string;
    platform?: PlatformKey;
}
export type TokKind = "id" | "qid" | "hid" | "int" | "real" | "time" | "str" | "op" | "pragma" | "kw" | "addr" | "eof";
export interface Token {
    k: TokKind;
    /** Text tokenu (u `id`/`kw` v původním zápisu, u `qid`/`hid` bez `"`/`#`). */
    t: string;
    /** Hodnota literálu (int, real, time v ms). */
    v?: number;
    /** Typová předpona literálu (`INT#5` → INT) nebo „bitový" literál (16#…). */
    ty?: string;
    base?: number;
    line: number;
    col: number;
    /** Před tokenem byl konec řádku (pro pravidla středníku). */
    nl?: boolean;
}
export type TypeSpec = {
    k: "name";
    name: string;
    pos: Pos;
    quoted?: boolean;
    len?: number;
} | {
    k: "array";
    dims: Array<[Expr, Expr]>;
    of: TypeSpec;
    pos: Pos;
} | {
    k: "struct";
    fields: VarDecl[];
    pos: Pos;
} | {
    k: "enum";
    values: Array<{
        name: string;
        value?: Expr;
    }>;
    base?: string;
    pos: Pos;
};
export interface VarDecl {
    name: string;
    pos: Pos;
    type: TypeSpec;
    init?: Expr;
    at?: string;
    atPos?: Pos;
}
export type VarKind = "in" | "out" | "inout" | "var" | "temp" | "const" | "global" | "external" | "stat";
export interface VarBlock {
    kind: VarKind;
    constant: boolean;
    decls: VarDecl[];
    pos: Pos;
    pragmas: string[];
}
export interface Pou {
    kind: "fb" | "program" | "function" | "method" | "interface" | "property" | "action";
    name: string;
    pos: Pos;
    quoted?: boolean;
    retType?: TypeSpec;
    vars: VarBlock[];
    body: Stmt[];
    methods: Pou[];
    extendsName?: string;
    implementsNames?: string[];
    pragmas: string[];
    /** Vlastnost: GET a SET jako metody. */
    getter?: Pou;
    setter?: Pou;
    endPos?: Pos;
    /** OOP: ABSTRACT (blok bez instancí / metoda bez implementace), FINAL. */
    abstract?: boolean;
    final?: boolean;
    /** OOP: přístup metody / vlastnosti (PUBLIC výchozí, PROTECTED, PRIVATE, INTERNAL). */
    access?: "PUBLIC" | "PROTECTED" | "PRIVATE" | "INTERNAL";
}
export interface TypeDecl {
    name: string;
    pos: Pos;
    spec: TypeSpec;
    init?: Expr;
}
export interface DataBlock {
    name: string;
    pos: Pos;
    ofType?: string;
    ofTypePos?: Pos;
    vars: VarBlock[];
}
export interface Unit {
    file: string;
    pous: Pou[];
    types: TypeDecl[];
    globals: VarBlock[];
    dbs: DataBlock[];
    /** Pragmy na úrovni souboru (např. `{attribute 'qualified_only'}` před VAR_GLOBAL). */
    pragmas: string[];
    /** Holý seznam příkazů (rutina Logix, funkce UniLogic, volání v OB1). */
    stmts?: Stmt[];
}
export type Expr = {
    k: "lit";
    ty: "BOOL" | "INT" | "REAL" | "TIME" | "STR";
    v: number;
    s?: string;
    typed?: string;
    bits?: boolean;
    pos: Pos;
} | {
    k: "ref";
    path: RefPart[];
    pos: Pos;
} | {
    k: "un";
    op: "-" | "NOT" | "+";
    e: Expr;
    pos: Pos;
} | {
    k: "bin";
    op: string;
    a: Expr;
    b: Expr;
    pos: Pos;
} | {
    k: "call";
    fn: RefPart[];
    args: Arg[];
    pos: Pos;
};
/** Část odkazu: jméno (s příznakem `#` / `"`), případně index pole. */
export interface RefPart {
    name: string;
    loc?: boolean;
    q?: boolean;
    idx?: Expr[];
    pos: Pos;
}
export interface Arg {
    name?: string;
    out?: boolean;
    neg?: boolean;
    e: Expr;
    pos: Pos;
}
export type Stmt = {
    k: "assign";
    lhs: Expr;
    rhs: Expr;
    pos: Pos;
} | {
    k: "call";
    call: Expr;
    pos: Pos;
} | {
    k: "if";
    conds: Array<{
        c: Expr;
        body: Stmt[];
    }>;
    els?: Stmt[];
    pos: Pos;
} | {
    k: "case";
    sel: Expr;
    branches: Array<{
        labels: Array<{
            lo: Expr;
            hi?: Expr;
        }>;
        body: Stmt[];
    }>;
    els?: Stmt[];
    pos: Pos;
} | {
    k: "for";
    v: Expr;
    from: Expr;
    to: Expr;
    by?: Expr;
    body: Stmt[];
    pos: Pos;
} | {
    k: "while";
    c: Expr;
    body: Stmt[];
    pos: Pos;
} | {
    k: "repeat";
    body: Stmt[];
    c: Expr;
    pos: Pos;
} | {
    k: "exit";
    pos: Pos;
} | {
    k: "continue";
    pos: Pos;
} | {
    k: "return";
    pos: Pos;
} | {
    k: "region";
    name: string;
    body: Stmt[];
    pos: Pos;
} | {
    k: "empty";
    pos: Pos;
};
/** Vstup emulátoru: zdrojové soubory jedné platformy rozdělené na kód a tabulky tagů. */
export interface EmuSource {
    name: string;
    text: string;
}
