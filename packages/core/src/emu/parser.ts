/**
 * PLCdesk — parser IEC 61131-3 ST / SCL / Logix ST (rekurzivní sestup) pro emulátor překladu.
 * Vrací AST s polohou, syntaktické chyby (soubor:řádek:sloupec) a místa, kde za END_IF /
 * END_CASE … chybí středník (pravidlo podle dialektu).
 */
import type { Token, Pos, Expr, Stmt, Unit, Pou, VarBlock, VarDecl, VarKind, TypeSpec, RefPart, Arg, TypeDecl, DataBlock, EmuFinding } from "./types.js";
import { tr } from "../i18n.js";

export interface ParseOptions { scl: boolean; statementsOnly: boolean; }
export interface ParseResult { unit: Unit; errors: EmuFinding[]; semi: Array<{ pos: Pos; what: string }>; }

class PErr extends Error { constructor(public pos: Pos, msg: string) { super(msg); } }

const VARKIND: Record<string, VarKind> = {
  VAR: "var", VAR_INPUT: "in", VAR_OUTPUT: "out", VAR_IN_OUT: "inout", VAR_TEMP: "temp", VAR_GLOBAL: "global",
  VAR_EXTERNAL: "external", VAR_STAT: "stat", VAR_INST: "var",
};
const END_OF: Record<string, string> = { fb: "END_FUNCTION_BLOCK", program: "END_PROGRAM", function: "END_FUNCTION", method: "END_METHOD", action: "END_ACTION" };
/** Slova, která ukončují seznam příkazů. */
const STOP = new Set(["END_IF", "ELSIF", "ELSE", "END_CASE", "END_FOR", "END_WHILE", "UNTIL", "END_REPEAT", "END_FUNCTION_BLOCK",
  "END_PROGRAM", "END_FUNCTION", "END_METHOD", "END_ACTION", "END_REGION", "METHOD", "PROPERTY", "ACTION", "END_ORGANIZATION_BLOCK",
  "END_PROPERTY", "END_GET", "END_SET", "END_DATA_BLOCK"]);

export function parse(toks: Token[], file: string, o: ParseOptions): ParseResult {
  let p = 0;
  const errors: EmuFinding[] = [];
  const semi: Array<{ pos: Pos; what: string }> = [];
  const pos = (t: Token = toks[p]): Pos => ({ file, line: t.line, col: t.col });
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const up = (t: Token) => (t.k === "kw" || t.k === "id") ? t.t.toUpperCase() : "";
  const isKw = (w: string, k = 0) => { const t = peek(k); return (t.k === "kw" || t.k === "id") && t.t.toUpperCase() === w; };
  const isOp = (s: string, k = 0) => { const t = peek(k); return t.k === "op" && t.t === s; };
  const next = () => toks[p < toks.length - 1 ? p++ : p];
  const fail = (msg: string, t = peek()): never => { throw new PErr(pos(t), msg); };
  const desc = (t: Token) => t.k === "eof" ? tr("konec souboru") : JSON.stringify(t.k === "qid" ? '"' + t.t + '"' : t.k === "hid" ? "#" + t.t : t.t);
  const expectOp = (s: string) => { if (!isOp(s)) fail(tr("Očekáváno {exp}, nalezeno {got}", { exp: JSON.stringify(s), got: desc(peek()) })); return next(); };
  const expectKw = (w: string) => { if (!isKw(w)) fail(tr("Očekáváno {exp}, nalezeno {got}", { exp: w, got: desc(peek()) })); return next(); };
  /** Ukončení bloku; chybí-li, hlásí se se vztahem k řádku začátku (IF z řádku 12). */
  const expectEnd = (w: string, start: Token) => {
    if (!isKw(w)) fail(tr("Chybí {end} k {kw} z řádku {line} (nalezeno {got})", { end: w, kw: start.t.toUpperCase(), line: start.line, got: desc(peek()) }));
    return next();
  };
  const ident = (): Token => {
    const t = peek();
    if (t.k === "id" || (o.scl && t.k === "qid")) return next();
    return fail(tr("Očekáván identifikátor, nalezeno {got}", { got: desc(t) }));
  };
  const record = (e: PErr) => errors.push({ level: "error", rule: "syntax", file, line: e.pos.line, col: e.pos.col, msg: e.message });
  /** Zotavení: přeskočí do konce příkazu (`;`) nebo k ukončovacímu slovu. */
  const sync = () => {
    while (peek().k !== "eof") {
      if (isOp(";")) { next(); return; }
      if (STOP.has(up(peek())) || ["CASE", "IF", "FOR", "WHILE", "REPEAT"].includes(up(peek()))) return;
      next();
    }
  };
  /** Středník za END_* — volitelný; chybí-li, zaznamená se (dialekt rozhodne o úrovni). */
  const endSemi = (endTok: Token) => {
    if (isOp(";")) { next(); return; }
    semi.push({ pos: pos(endTok), what: endTok.t.toUpperCase() });
  };

  /* --------------------------------------------------------- výrazy */
  const PREC: Record<string, number> = { OR: 1, XOR: 2, AND: 3, "&": 3, "=": 4, "<>": 4, "<": 5, ">": 5, "<=": 5, ">=": 5, "+": 6, "-": 6, "*": 7, "/": 7, MOD: 7, "**": 8 };
  const binOp = (): string | null => {
    const t = peek();
    if (t.k === "op" && PREC[t.t] !== undefined) return t.t;
    if (t.k === "kw" && ["OR", "XOR", "AND", "MOD"].includes(t.t.toUpperCase())) return t.t.toUpperCase();
    return null;
  };
  function expr(min = 1): Expr {
    let a = unary();
    for (;;) {
      const op = binOp();
      if (!op || PREC[op] < min) return a;
      const t = next();
      const b = expr(op === "**" ? PREC[op] : PREC[op] + 1);
      a = { k: "bin", op: op === "&" ? "AND" : op, a, b, pos: pos(t) };
    }
  }
  function unary(): Expr {
    const t = peek();
    if (isKw("NOT")) { next(); return { k: "un", op: "NOT", e: unary(), pos: pos(t) }; }
    if (isOp("-") || isOp("+")) {
      next();
      const e = unary();
      if (t.t === "-" && e.k === "lit" && (e.ty === "INT" || e.ty === "REAL" || e.ty === "TIME")) return { ...e, v: -e.v, s: "-" + (e.s ?? ""), pos: pos(t) };
      return t.t === "+" ? e : { k: "un", op: "-", e, pos: pos(t) };
    }
    return primary();
  }
  function primary(): Expr {
    const t = peek();
    if (t.k === "int") { next(); return { k: "lit", ty: t.ty === "BOOL" ? "BOOL" : t.ty && /REAL/.test(t.ty) ? "REAL" : "INT", v: t.v!, s: t.t, typed: t.ty, bits: !!t.base && t.base !== 10, pos: pos(t) }; }
    if (t.k === "real") { next(); return { k: "lit", ty: "REAL", v: t.v!, s: t.t, typed: t.ty, pos: pos(t) }; }
    if (t.k === "time") { next(); return { k: "lit", ty: "TIME", v: t.v!, s: t.t, pos: pos(t) }; }
    if (t.k === "str") { next(); return { k: "lit", ty: "STR", v: 0, s: t.t, pos: pos(t) }; }
    if (isKw("TRUE") || isKw("FALSE")) { next(); return { k: "lit", ty: "BOOL", v: up(t) === "TRUE" ? 1 : 0, s: t.t, pos: pos(t) }; }
    if (isOp("(")) { next(); const e = expr(); expectOp(")"); return e; }
    if (t.k === "id" || t.k === "qid" || t.k === "hid") return refOrCall();
    return fail(tr("Očekáván výraz, nalezeno {got}", { got: desc(t) }));
  }
  function refPart(): RefPart {
    const t = next();
    return { name: t.t, loc: t.k === "hid" || undefined, q: t.k === "qid" || undefined, pos: pos(t) };
  }
  function refOrCall(): Expr {
    const start = peek();
    const path: RefPart[] = [refPart()];
    for (;;) {
      if (isOp(".")) {
        next();
        const t = peek();
        if (t.k === "id" || t.k === "kw" || t.k === "qid" || t.k === "int") { next(); path.push({ name: t.t, pos: pos(t) }); continue; }
        fail(tr("Za tečkou chybí jméno členu"));
      }
      if (isOp("[")) {
        next();
        const idx = [expr()];
        while (isOp(",")) { next(); idx.push(expr()); }
        expectOp("]");
        path[path.length - 1].idx = idx;
        continue;
      }
      if (isOp("^")) { next(); continue; }
      break;
    }
    if (isOp("(")) {
      next();
      const args: Arg[] = [];
      if (!isOp(")")) {
        for (;;) {
          const a0 = peek();
          let neg = false;
          if (isKw("NOT") && peek(1).k === "id" && (isOp("=>", 2))) { next(); neg = true; }
          if ((peek().k === "id" || peek().k === "kw") && (isOp(":=", 1) || isOp("=>", 1))) {
            const nm = next().t, out = next().t === "=>";
            args.push({ name: nm, out, neg: neg || undefined, e: expr(), pos: pos(a0) });
          } else args.push({ e: expr(), pos: pos(a0) });
          if (isOp(",")) { next(); continue; }
          break;
        }
      }
      expectOp(")");
      return { k: "call", fn: path, args, pos: pos(start) };
    }
    return { k: "ref", path, pos: pos(start) };
  }

  /* ------------------------------------------------------ příkazy */
  /** Následuje návěští větve CASE (`10:`, `#STEP_IDLE:`, `1..5, 7:`)? */
  function atCaseLabel(): boolean {
    let k = 0;
    for (;;) {
      const t = peek(k);
      if (t.k === "int" || t.k === "id" || t.k === "hid" || t.k === "qid" || (t.k === "op" && ["-", "+", "..", ",", "."].includes(t.t))) { k++; continue; }
      return t.k === "op" && t.t === ":" && k > 0;
    }
  }
  function stmtList(inCase = false): Stmt[] {
    const out: Stmt[] = [];
    while (peek().k !== "eof" && !STOP.has(up(peek()))) {
      if (inCase && atCaseLabel()) break;
      const at = p;
      try { out.push(stmt()); }
      catch (e) { if (!(e instanceof PErr)) throw e; record(e); sync(); if (p === at) next(); }
    }
    return out;
  }
  function stmt(): Stmt {
    const t = peek(), w = up(t), P = pos(t);
    if (t.k === "op" && t.t === ";") { next(); return { k: "empty", pos: P }; }
    if (t.k === "kw" || (o.scl && w === "REGION" && t.k !== "op")) {
      if (w === "IF") {
        next();
        const conds: Array<{ c: Expr; body: Stmt[] }> = [];
        const c = expr(); expectKw("THEN");
        conds.push({ c, body: stmtList() });
        let els: Stmt[] | undefined;
        for (;;) {
          if (isKw("ELSIF")) { next(); const c2 = expr(); expectKw("THEN"); conds.push({ c: c2, body: stmtList() }); continue; }
          if (isKw("ELSE")) { next(); els = stmtList(); }
          break;
        }
        const end = expectEnd("END_IF", t);
        endSemi(end);
        return { k: "if", conds, els, pos: P };
      }
      if (w === "CASE") {
        next();
        const sel = expr(); expectKw("OF");
        const branches: Array<{ labels: Array<{ lo: Expr; hi?: Expr }>; body: Stmt[] }> = [];
        let els: Stmt[] | undefined;
        while (!isKw("END_CASE") && peek().k !== "eof") {
          if (isKw("ELSE")) { next(); if (isOp(":")) next(); els = stmtList(true); continue; }
          if (!atCaseLabel()) { fail(tr("Očekáváno návěští větve CASE, nalezeno {got}", { got: desc(peek()) })); }
          const labels: Array<{ lo: Expr; hi?: Expr }> = [];
          for (;;) {
            const lo = expr();
            let hi: Expr | undefined;
            if (isOp("..")) { next(); hi = expr(); }
            labels.push({ lo, hi });
            if (isOp(",")) { next(); continue; }
            break;
          }
          expectOp(":");
          branches.push({ labels, body: stmtList(true) });
        }
        const end = expectEnd("END_CASE", t);
        endSemi(end);
        return { k: "case", sel, branches, els, pos: P };
      }
      if (w === "FOR") {
        next();
        const v = refOrCall();
        expectOp(":=");
        const from = expr(); expectKw("TO"); const to = expr();
        let by: Expr | undefined;
        if (isKw("BY")) { next(); by = expr(); }
        expectKw("DO");
        const body = stmtList();
        endSemi(expectEnd("END_FOR", t));
        return { k: "for", v, from, to, by, body, pos: P };
      }
      if (w === "WHILE") {
        next();
        const c = expr(); expectKw("DO");
        const body = stmtList();
        endSemi(expectEnd("END_WHILE", t));
        return { k: "while", c, body, pos: P };
      }
      if (w === "REPEAT") {
        next();
        const body = stmtList();
        expectEnd("UNTIL", t);
        const c = expr();
        endSemi(expectEnd("END_REPEAT", t));
        return { k: "repeat", body, c, pos: P };
      }
      if (w === "EXIT" || w === "RETURN" || w === "CONTINUE") {
        next();
        expectOp(";");
        return { k: w === "EXIT" ? "exit" : w === "RETURN" ? "return" : "continue", pos: P };
      }
      if (w === "REGION") {
        next();
        let name = "";
        while (!peek().nl && peek().k !== "eof") name += next().t + " ";
        const body = stmtList();
        expectKw("END_REGION");
        if (isOp(";")) next();
        return { k: "region", name: name.trim(), body, pos: P };
      }
      if (w !== "TRUE" && w !== "FALSE") fail(tr("Neočekávané klíčové slovo {kw}", { kw: t.t }));
    }
    if (t.k !== "id" && t.k !== "qid" && t.k !== "hid") fail(tr("Očekáván příkaz, nalezeno {got}", { got: desc(t) }));
    const lhs = refOrCall();
    if (isOp(":=")) {
      if (lhs.k === "call") fail(tr("Volání nelze přiřadit"));
      next();
      const rhs = expr();
      expectOp(";");
      return { k: "assign", lhs, rhs, pos: P };
    }
    if (lhs.k === "call") { expectOp(";"); return { k: "call", call: lhs, pos: P }; }
    return fail(tr("Očekáváno := nebo volání, nalezeno {got}", { got: desc(peek()) }));
  }

  /* ---------------------------------------------------- deklarace */
  function typeSpec(): TypeSpec {
    const t = peek(), P = pos(t);
    if (isKw("ARRAY")) {
      next(); expectOp("[");
      const dims: Array<[Expr, Expr]> = [];
      for (;;) { const lo = expr(); expectOp(".."); const hi = expr(); dims.push([lo, hi]); if (isOp(",")) { next(); continue; } break; }
      expectOp("]"); expectKw("OF");
      return { k: "array", dims, of: typeSpec(), pos: P };
    }
    if (isKw("STRUCT")) {
      next();
      const fields: VarDecl[] = [];
      while (!isKw("END_STRUCT") && peek().k !== "eof") fields.push(...decl());
      expectKw("END_STRUCT");
      return { k: "struct", fields, pos: P };
    }
    if (isOp("(")) {
      next();
      const values: Array<{ name: string; value?: Expr }> = [];
      for (;;) {
        const n = ident();
        let value: Expr | undefined;
        if (isOp(":=")) { next(); value = expr(); }
        values.push({ name: n.t, value });
        if (isOp(",")) { next(); continue; }
        break;
      }
      expectOp(")");
      let baseT: string | undefined;
      if (peek().k === "id") baseT = next().t;
      return { k: "enum", values, base: baseT, pos: P };
    }
    if ((isKw("POINTER") || isKw("REFERENCE")) && isKw("TO", 1)) { next(); next(); return typeSpec(); }
    if (t.k === "qid" || t.k === "id" || t.k === "kw") {
      next();
      const spec: TypeSpec = { k: "name", name: t.t, pos: P, quoted: t.k === "qid" || undefined };
      if (/^W?STRING$/i.test(t.t) && (isOp("[") || isOp("("))) {
        const close = isOp("[") ? "]" : ")";
        next(); const len = expr(); expectOp(close);
        if (spec.k === "name") spec.len = len.k === "lit" ? len.v : undefined;
      }
      return spec;
    }
    return fail(tr("Očekáván datový typ, nalezeno {got}", { got: desc(t) }));
  }
  function decl(): VarDecl[] {
    while (peek().k === "pragma") next();
    const names: Token[] = [ident()];
    while (peek().k === "pragma") next();                 // SCL: jméno { S7_SetPoint := 'True' } : typ
    while (isOp(",")) { next(); names.push(ident()); }
    let at: string | undefined, atPos: Pos | undefined;
    if (isKw("AT")) {
      next();
      atPos = pos();
      let s = "";
      /* %IX0.0, %IW64, %I*, %Q* — lexer je rozdělí; poskládat do mezery / dvojtečky */
      while (!isOp(":") && peek().k !== "eof" && !peek().nl) s += next().t;
      if (!s && peek().nl) { while (!isOp(":") && peek().k !== "eof") s += next().t; }
      at = s;
    }
    expectOp(":");
    const type = typeSpec();
    let init: Expr | undefined;
    if (isOp(":=")) { next(); init = initExpr(); }
    expectOp(";");
    return names.map(n => ({ name: n.t, pos: pos(n), type, init, at, atPos }));
  }
  /** Počáteční hodnota: výraz, pole [1, 2, 3(0)] nebo struktura (a := 1, b := 2). */
  function initExpr(): Expr {
    if (isOp("[")) {
      const t = next();
      let depth = 1;
      while (depth > 0 && peek().k !== "eof") { if (isOp("[")) depth++; if (isOp("]")) depth--; next(); }
      return { k: "lit", ty: "INT", v: 0, s: "[...]", pos: pos(t) };
    }
    if (isOp("(") && (peek(1).k === "id") && isOp(":=", 2)) {
      const t = next();
      let depth = 1;
      while (depth > 0 && peek().k !== "eof") { if (isOp("(")) depth++; if (isOp(")")) depth--; next(); }
      return { k: "lit", ty: "INT", v: 0, s: "(...)", pos: pos(t) };
    }
    return expr();
  }
  function varBlocks(): VarBlock[] {
    const out: VarBlock[] = [];
    for (;;) {
      const pragmas: string[] = [];
      while (peek().k === "pragma") pragmas.push(next().t);
      const w = up(peek());
      if (!(w in VARKIND)) { if (pragmas.length) p -= pragmas.length; return out; }
      const t = next();
      let kind = VARKIND[w], constant = false;
      while (["CONSTANT", "RETAIN", "NON_RETAIN", "PERSISTENT", "DB_SPECIFIC"].includes(up(peek()))) {
        if (up(next()) === "CONSTANT") constant = true;
      }
      if (constant && kind === "var") kind = "const";
      const decls: VarDecl[] = [];
      while (!isKw("END_VAR") && peek().k !== "eof") {
        const at = p;
        try { decls.push(...decl()); }
        catch (e) { if (!(e instanceof PErr)) throw e; record(e); while (!isOp(";") && !isKw("END_VAR") && peek().k !== "eof") next(); if (isOp(";")) next(); if (p === at) next(); }
      }
      expectKw("END_VAR");
      if (isOp(";")) next();
      out.push({ kind, constant, decls, pos: pos(t), pragmas });
    }
  }
  /** Hlavička bloku SCL: { atributy }, VERSION : 0.1, TITLE = …, AUTHOR : … */
  function sclHeader(pragmas: string[]) {
    for (;;) {
      if (peek().k === "pragma") { pragmas.push(next().t); continue; }
      const w = up(peek());
      if (w === "VERSION" || w === "AUTHOR" || w === "FAMILY" || w === "NAME") { next(); expectOp(":"); next(); if (isOp(".")) { next(); next(); } continue; }
      if (w === "TITLE") { next(); const l = peek().line; while (peek().line === l && peek().k !== "eof") next(); continue; }
      if (w === "KNOW_HOW_PROTECT") { next(); continue; }
      return;
    }
  }
  function pou(kind: Pou["kind"]): Pou {
    const kwTok = next();
    const pragmas: string[] = [];
    if (kind === "method") while (["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "ABSTRACT", "FINAL"].includes(up(peek()))) next();
    const nameTok = ident();
    const P: Pou = { kind, name: nameTok.t, pos: pos(nameTok), quoted: nameTok.k === "qid" || undefined, vars: [], body: [], methods: [], pragmas };
    if (isKw("EXTENDS")) { next(); P.extendsName = ident().t; }
    if (isKw("IMPLEMENTS")) { next(); P.implementsNames = [ident().t]; while (isOp(",")) { next(); P.implementsNames.push(ident().t); } }
    if ((kind === "function" || kind === "method" || kind === "property") && isOp(":")) { next(); P.retType = typeSpec(); }
    if (o.scl) sclHeader(pragmas);
    P.vars = varBlocks();
    if (o.scl) sclHeader(pragmas);
    if (kind === "interface") {
      while (!isKw("END_INTERFACE") && peek().k !== "eof") {
        if (isKw("METHOD")) { const m = pou("method"); P.methods.push(m); continue; }
        if (isKw("PROPERTY")) { P.methods.push(property()); continue; }
        fail(tr("Očekáváno METHOD nebo PROPERTY, nalezeno {got}", { got: desc(peek()) }));
      }
      endSemi(expectKw("END_INTERFACE"));
      return P;
    }
    if (isKw("BEGIN")) next();
    else if (o.scl && kind !== "method") errors.push({ level: "error", rule: "syntax", file, line: peek().line, col: peek().col, msg: tr("Blok SCL musí mít BEGIN před příkazy") });
    P.body = stmtList();
    while (isKw("METHOD") || isKw("PROPERTY") || isKw("ACTION")) {
      if (isKw("METHOD")) P.methods.push(pou("method"));
      else if (isKw("ACTION")) P.methods.push(pou("action"));
      else P.methods.push(property());
    }
    const endW = up(kwTok) === "ORGANIZATION_BLOCK" ? "END_ORGANIZATION_BLOCK" : END_OF[kind];
    P.endPos = pos();
    if (!isKw(endW)) fail(tr("Chybí {end} (blok {name} začíná na řádku {line})", { end: endW, name: P.name, line: kwTok.line }));
    next();
    if (isOp(";")) next();
    return P;
  }
  function property(): Pou {
    next();
    const nameTok = ident();
    const P: Pou = { kind: "property", name: nameTok.t, pos: pos(nameTok), vars: [], body: [], methods: [], pragmas: [] };
    if (isOp(":")) { next(); P.retType = typeSpec(); }
    for (;;) {
      if (isKw("GET") || isKw("SET")) {
        const which = up(next());
        const acc: Pou = { kind: "method", name: (which === "GET" ? "__get_" : "__set_") + P.name, pos: pos(), vars: varBlocks(), body: [], methods: [], pragmas: [], retType: P.retType };
        acc.body = stmtList();
        expectKw(which === "GET" ? "END_GET" : "END_SET");
        if (which === "GET") P.getter = acc; else P.setter = acc;
        continue;
      }
      break;
    }
    endSemi(expectKw("END_PROPERTY"));
    return P;
  }
  function typeBlock(): TypeDecl[] {
    next();
    const out: TypeDecl[] = [];
    while (!isKw("END_TYPE") && peek().k !== "eof") {
      const n = ident();
      expectOp(":");
      const spec = typeSpec();
      let init: Expr | undefined;
      if (isOp(":=")) { next(); init = initExpr(); }
      if (isKw("END_STRUCT")) next();
      if (isOp(";")) next(); else if (!isKw("END_TYPE")) expectOp(";");
      out.push({ name: n.t, pos: pos(n), spec, init });
    }
    expectKw("END_TYPE");
    if (isOp(";")) next();
    return out;
  }
  function dataBlock(): DataBlock {
    next();
    const n = ident();
    const db: DataBlock = { name: n.t, pos: pos(n), vars: [] };
    sclHeader([]);
    if (peek().k === "qid" || (peek().k === "id" && !(up(peek()) in VARKIND))) { db.ofTypePos = pos(); db.ofType = next().t; }
    else if (isKw("STRUCT")) { const s = typeSpec(); if (s.k === "struct") db.vars.push({ kind: "var", constant: false, decls: s.fields, pos: s.pos, pragmas: [] }); }
    db.vars.push(...varBlocks());
    if (isKw("BEGIN")) { next(); while (!isKw("END_DATA_BLOCK") && peek().k !== "eof") { try { stmt(); } catch (e) { if (!(e instanceof PErr)) throw e; record(e); sync(); } } }
    expectKw("END_DATA_BLOCK");
    return db;
  }

  /* ----------------------------------------------------- jednotka */
  const unit: Unit = { file, pous: [], types: [], globals: [], dbs: [], pragmas: [] };
  if (o.statementsOnly) {
    unit.stmts = stmtList();
    while (peek().k !== "eof") {
      try { fail(tr("Neočekávané {got} mimo blok", { got: desc(peek()) })); }
      catch (e) { if (!(e instanceof PErr)) throw e; record(e); next(); unit.stmts.push(...stmtList()); }
    }
    return { unit, errors, semi };
  }
  while (peek().k !== "eof") {
    const at = p;
    try {
      if (peek().k === "pragma") { unit.pragmas.push(next().t); continue; }
      const w = up(peek());
      if (w === "FUNCTION_BLOCK") { unit.pous.push(pou("fb")); continue; }
      if (w === "PROGRAM" || w === "ORGANIZATION_BLOCK") {
        const P = pou("program");
        unit.pous.push(P);
        continue;
      }
      if (w === "FUNCTION") { unit.pous.push(pou("function")); continue; }
      if (w === "INTERFACE") { unit.pous.push(pou("interface")); continue; }
      if (w === "TYPE") { unit.types.push(...typeBlock()); continue; }
      if (w === "DATA_BLOCK" && o.scl) { unit.dbs.push(dataBlock()); continue; }
      if (w in VARKIND) {
        const vb = varBlocks();
        for (const b of vb) b.pragmas.unshift(...unit.pragmas.splice(0));
        unit.globals.push(...vb);
        continue;
      }
      fail(tr("Neočekávané {got} mimo blok", { got: desc(peek()) }));
    } catch (e) {
      if (!(e instanceof PErr)) throw e;
      record(e);
      /* přeskočit na další blok */
      while (peek().k !== "eof" && !["FUNCTION_BLOCK", "PROGRAM", "FUNCTION", "TYPE", "VAR_GLOBAL", "DATA_BLOCK", "INTERFACE"].includes(up(peek()))) next();
      if (p === at) next();
    }
  }
  return { unit, errors, semi };
}
