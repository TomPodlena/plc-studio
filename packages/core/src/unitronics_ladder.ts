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
import type { Project, PlatformKey, IoEntry, Dir, ValidationIssue } from "./model.js";
import { PLAT, registerValidationHook } from "./model.js";
import { axisBlocked } from "./axis_gen.js";
import { tr, trx } from "./i18n.js";
import { uniSections, uniTags, metaLine, type UniSection } from "./codegen.js";
import { hwLayout, type HwChannel, type HwLayout } from "./hardware.js";
import { lex } from "./emu/lexer.js";
import { parse } from "./emu/parser.js";
import type { Expr, Stmt } from "./emu/types.js";
import { verificationReadme } from "./verification.js";
import { stripDia } from "./model.js";

export type LadderPlat = "vision" | "jazz";
export const LADDER_PLATS: LadderPlat[] = ["vision", "jazz"];
export function isLadderPlat(p: PlatformKey): p is LadderPlat { return p === "vision" || p === "jazz"; }

/* ============================================================ operandy */

export type OpType = "I" | "O" | "MB" | "MI" | "MF" | "T" | "C";
export interface Operand {
  name: string; type: OpType; no: number;
  /** datový typ v programu (BIT / INT / REAL / TIMER) */
  dt: "BIT" | "INT" | "REAL" | "TIMER";
  desc: string;
  /** časovač: preset v ms a v jednotkách platformy */
  presetMs?: number; preset?: number; unit?: number;
  /** I/O: signál projektu a kanál sestavy */
  io?: IoEntry; ch?: HwChannel;
  /** U90: REAL bez MF → MI (celočíselně) */
  intReal?: boolean;
  aux?: boolean;
}

/** Limity operandů podle CPU (spec. PDF výrobce; viz README a data/catalog/plc.json). */
export interface LadderLimits { cpu: string; MB: number; MI: number; MF: number; T: number; C: number; app: string; src: string; }
const SPEC_TA24 = "https://www.unitronicsplc.com/wp-content/uploads/2016/08/Vxxx_J_TA24_SPEC_02_16.pdf";
function limitsFor(plat: LadderPlat, cpu: string): LadderLimits {
  if (plat === "jazz") return { cpu, MB: 256, MI: 256, MF: 0, T: 64, C: 0, app: "Jazz: Ladder 2K, download 24K; M91: download 32K",
    src: "https://www.unitronicsplc.com/Download/SoftwareHelp/U90LadderKnowledgebase/Compatibility__HW,_OS,_SW.htm" };
  if (/^V130/.test(cpu)) return { cpu, MB: 4096, MI: 2048, MF: 24, T: 192, C: 24, app: "512 KB", src: SPEC_TA24 };
  if (/^SM/.test(cpu)) return { cpu, MB: 512, MI: 256, MF: 24, T: 32, C: 16, app: "80K / 192K", src: "https://www.unitronicsplc.com/wp-content/uploads/2015/12/SMXX-J-TA22-SPEC-02-16.pdf" };
  return { cpu, MB: 8192, MI: 4096, MF: 64, T: 384, C: 32, app: "1 MB", src: SPEC_TA24 };
}

/** Preset časovače: Vision 10 ms (do 99 h); U90 14 bitů + jednotka 10 ms / 100 ms / 1 s / 10 s. */
export function timerPreset(plat: LadderPlat, ms: number): { preset: number; unit: number } {
  if (plat === "vision") return { preset: Math.ceil(ms / 10), unit: 10 };
  for (const unit of [10, 100, 1000, 10000]) if (Math.ceil(ms / unit) <= 16383) return { preset: Math.ceil(ms / unit), unit };
  return { preset: 16383, unit: 10000 };
}

/** Adresa I/O kanálu: vestavěné I/O CPU od 0, rozšiřovací modul x (0–7) = 32 + 16·x + kanál (EX-A2X). */
function ioNo(L: HwLayout, k: HwChannel): number {
  const m = k.mod;
  if (m.builtin || m.station !== 0) return k.no;
  const exp = L.modules.filter(x => x.kind === "io" && !x.builtin && x.station === 0);
  return 32 + 16 * exp.indexOf(m) + k.no;
}

/* ============================================================ síť větve */

type Net =
  | { t: "const"; v: boolean }
  | { t: "no" | "nc"; op: string }
  | { t: "cmp"; op: string; a: string; b: string }
  | { t: "and" | "or"; items: Net[] };

type Out =
  | { t: "coil" | "set" | "rst"; op: string }
  | { t: "fn"; fn: string; args: string[]; dst: string; fp?: boolean }
  | { t: "timer"; op: string; presetMs: number };

export interface Rung { no: number; comment: string; cond: Net; outs: Out[]; reads: Set<string>; }
export interface LadderSection { title: string; kind: UniSection["kind"]; rungs: Rung[]; }
export interface LadderProgram { plat: LadderPlat; ops: Map<string, Operand>; sections: LadderSection[]; limits: LadderLimits; problems: string[]; L: HwLayout; }

const TRUE_NET: Net = { t: "const", v: true };
const INV: Record<string, string> = { "=": "<>", "<>": "=", "<": ">=", ">=": "<", ">": "<=", "<=": ">" };

function neg(n: Net): Net {
  switch (n.t) {
    case "const": return { t: "const", v: !n.v };
    case "no": return { t: "nc", op: n.op };
    case "nc": return { t: "no", op: n.op };
    case "cmp": return { t: "cmp", op: INV[n.op], a: n.a, b: n.b };
    case "and": return or(n.items.map(neg));
    case "or": return and(n.items.map(neg));
  }
}
function and(items: Net[]): Net {
  const f = items.flatMap(i => i.t === "and" ? i.items : [i]).filter(i => !(i.t === "const" && i.v));
  if (f.some(i => i.t === "const" && !i.v)) return { t: "const", v: false };
  return f.length === 0 ? TRUE_NET : f.length === 1 ? f[0] : { t: "and", items: f };
}
function or(items: Net[]): Net {
  const f = items.flatMap(i => i.t === "or" ? i.items : [i]).filter(i => !(i.t === "const" && !i.v));
  if (f.some(i => i.t === "const" && i.v)) return TRUE_NET;
  return f.length === 0 ? { t: "const", v: false } : f.length === 1 ? f[0] : { t: "or", items: f };
}
function netKey(n: Net): string { return JSON.stringify(n); }
function netReads(n: Net, out: Set<string>): Set<string> {
  if (n.t === "no" || n.t === "nc") out.add(n.op);
  else if (n.t === "cmp") { for (const x of [n.a, n.b]) if (!x.startsWith("#")) out.add(x); }
  else if (n.t === "and" || n.t === "or") for (const i of n.items) netReads(i, out);
  return out;
}
function outWrites(o: Out): string { return o.t === "fn" ? o.dst : o.op; }

/* ============================================================ převod ST → větve */

class Builder {
  rungs: Rung[] = [];
  auxN = 0;
  /** konstanty vstupů bloků (instX_scaleMin := 0.0 …) dosazené přímo — šetří MF / MI */
  folded = new Map<string, string>();
  constructor(public P: LadderProgram, public types: Map<string, Operand["dt"]>, public cmt: (line: number) => string, public problems: string[]) {}

  aux(base: string, dt: Operand["dt"]): string {
    let name = ("aux_" + base).replace(/[^A-Za-z0-9_]/g, "_");
    if (this.types.has(name)) { let k = 2; while (this.types.has(name + "_" + k)) k++; name = name + "_" + k; }
    this.types.set(name, dt);
    return name;
  }
  /** pomocné registry výrazu: znovu použitelné mezi příkazy (každý se použije hned) */
  tmpPool: Record<string, string[]> = { INT: [], REAL: [] };
  tmpUsed: Record<string, number> = { INT: 0, REAL: 0 };
  tmp(dt: "INT" | "REAL"): string {
    const i = this.tmpUsed[dt]++;
    if (!this.tmpPool[dt][i]) this.tmpPool[dt][i] = this.aux((dt === "INT" ? "i" : "f") + i, dt);
    return this.tmpPool[dt][i];
  }
  resetTmp() { this.tmpUsed = { INT: 0, REAL: 0 }; }

  emit(cond: Net, out: Out, comment: string) {
    if (cond.t === "const" && !cond.v) return;
    const last = this.rungs[this.rungs.length - 1];
    /* stejná podmínka a předchozí výstupy ji nemění → paralelní výstup v téže větvi */
    if (last && last.comment === comment && netKey(last.cond) === netKey(cond) && !last.outs.some(o => last.reads.has(outWrites(o)))) {
      last.outs.push(out);
      return;
    }
    this.rungs.push({ no: 0, comment, cond, outs: [out], reads: netReads(cond, new Set()) });
  }

  typeOf(e: Expr): Operand["dt"] {
    switch (e.k) {
      case "lit": return e.ty === "BOOL" ? "BIT" : e.ty === "REAL" ? "REAL" : "INT";
      case "ref": return e.path.length > 1 ? "BIT" : (this.types.get(e.path[0].name) || "BIT");
      case "un": return e.op === "NOT" ? "BIT" : this.typeOf(e.e);
      case "bin": return ["AND", "OR", "XOR", "=", "<>", "<", ">", "<=", ">="].includes(e.op.toUpperCase()) ? "BIT"
        : (this.typeOf(e.a) === "REAL" || this.typeOf(e.b) === "REAL" ? "REAL" : "INT");
      case "call": { const f = e.fn.map(p => p.name).join(".").toUpperCase(); return f === "TO_REAL" ? "REAL" : f === "TO_INT" ? "INT" : "INT"; }
    }
  }
  refName(e: Expr): string {
    if (e.k !== "ref") { this.problems.push("ref"); return "?"; }
    if (e.path.length === 2 && e.path[1].name.toUpperCase() === "Q") return e.path[0].name;
    if (e.path.length !== 1) this.problems.push(trx("nepodporovaný odkaz {ref}", { ref: e.path.map(p => p.name).join(".") }));
    return e.path[0].name;
  }
  /** konstanta; celé číslo nad 32767 (stavová slova 16#8001 / 16#8002) jako táž 16bitová hodnota se znaménkem — MI je INT16 */
  lit(v: number, real: boolean): string {
    if (!real && Number.isInteger(v) && v > 32767 && v <= 65535) v -= 65536;
    return "#" + (real && Number.isInteger(v) ? v.toFixed(1) : String(v));
  }

  /** číselný výraz → operand (registr / konstanta); mezivýsledky do pomocných registrů pod podmínkou `g` */
  num(e: Expr, g: Net, comment: string, dst?: string): string {
    const put = (fn: string, args: string[], dt: Operand["dt"]) => {
      const d = dst || this.tmp(dt === "REAL" ? "REAL" : "INT");
      this.emit(g, { t: "fn", fn, args, dst: d, fp: dt === "REAL" }, comment);
      return d;
    };
    switch (e.k) {
      case "lit": { const s = this.lit(e.v, e.ty === "REAL"); return dst ? put("MOV", [s], e.ty === "REAL" ? "REAL" : "INT") : s; }
      case "ref": { const r0 = this.refName(e), r = this.folded.get(r0) ?? r0; return dst ? put("MOV", [r], this.types.get(r0) || "INT") : r; }
      case "un": {
        if (e.op === "+") return this.num(e.e, g, comment, dst);
        if (e.op === "-") { const dt = this.typeOf(e.e); const a = this.num(e.e, g, comment); return put("SUB", [this.lit(0, dt === "REAL"), a], dt); }
        break;
      }
      case "bin": {
        const fn = ({ "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV" } as Record<string, string>)[e.op];
        if (!fn) break;
        const dt = this.typeOf(e);
        const a = this.num(e.a, g, comment), b = this.num(e.b, g, comment);
        return put(fn, [a, b], dt);
      }
      case "call": {
        const f = e.fn.map(p => p.name).join(".").toUpperCase();
        if ((f === "TO_REAL" || f === "TO_INT") && e.args.length === 1) {
          const a = this.num(e.args[0].e, g, comment);
          return put(f === "TO_REAL" ? "INT>FP" : "FP>INT", [a], f === "TO_REAL" ? "REAL" : "INT");
        }
        break;
      }
    }
    this.problems.push(trx("nepodporovaný číselný výraz na řádku {line}", { line: e.pos.line }));
    return "?";
  }

  /** logický výraz → síť kontaktů; porovnání složitých výrazů přes pomocné registry (bez podmínky) */
  net(e: Expr, comment: string): Net {
    switch (e.k) {
      case "lit": return { t: "const", v: !!e.v };
      case "ref": return { t: "no", op: this.refName(e) };
      case "un": if (e.op === "NOT") return neg(this.net(e.e, comment)); break;
      case "bin": {
        const op = e.op.toUpperCase();
        if (op === "AND") return and([this.net(e.a, comment), this.net(e.b, comment)]);
        if (op === "OR") return or([this.net(e.a, comment), this.net(e.b, comment)]);
        if (INV[op]) {
          if (this.typeOf(e.a) === "BIT" || this.typeOf(e.b) === "BIT") break;
          return { t: "cmp", op, a: this.num(e.a, TRUE_NET, comment), b: this.num(e.b, TRUE_NET, comment) };
        }
        break;
      }
    }
    this.problems.push(trx("nepodporovaný logický výraz na řádku {line}", { line: e.pos.line }));
    return { t: "const", v: false };
  }

  reads(e: Expr | undefined, out: Set<string>): Set<string> {
    if (!e) return out;
    if (e.k === "ref") out.add(e.path[0].name);
    else if (e.k === "un") this.reads(e.e, out);
    else if (e.k === "bin") { this.reads(e.a, out); this.reads(e.b, out); }
    else if (e.k === "call") for (const a of e.args) this.reads(a.e, out);
    return out;
  }
  writes(ss: Stmt[] | undefined, out: Set<string>): Set<string> {
    for (const s of ss || []) {
      if (s.k === "assign" && s.lhs.k === "ref") out.add(s.lhs.path[0].name);
      else if (s.k === "call" && s.call.k === "call") out.add(s.call.fn[0].name);
      else if (s.k === "if") { for (const c of s.conds) this.writes(c.body, out); this.writes(s.els, out); }
      else if (s.k === "case") { for (const b of s.branches) this.writes(b.body, out); this.writes(s.els, out); }
    }
    return out;
  }

  stmts(ss: Stmt[], guard: Net, ctx: string) {
    for (const s of ss) { this.resetTmp(); this.stmt(s, guard, ctx); }
  }

  stmt(s: Stmt, guard: Net, ctx: string) {
    const comment = this.cmt(s.pos.line) || ctx;
    switch (s.k) {
      case "empty": return;
      case "region": return this.stmts(s.body, guard, ctx);
      case "assign": {
        const lhs = this.refName(s.lhs), dt = this.types.get(lhs) || "BIT";
        if (this.folded.has(lhs)) return;
        if (dt !== "BIT") { this.num(s.rhs, guard, comment, lhs); return; }
        const n = this.net(s.rhs, comment);
        const always = guard.t === "const" && guard.v;
        if (n.t === "const") { this.emit(guard, { t: n.v ? (always ? "coil" : "set") : "rst", op: lhs }, comment); return; }
        if (always) { this.emit(n, { t: "coil", op: lhs }, comment); return; }
        /* podmíněné přiřazení bitu: SET / RST; čte-li výraz cílový bit, nejdřív do pomocného bitu */
        let v = n;
        if (netReads(n, new Set()).has(lhs)) { const a = this.aux(lhs + "_new", "BIT"); this.emit(n, { t: "coil", op: a }, comment); v = { t: "no", op: a }; }
        this.emit(and([guard, v]), { t: "set", op: lhs }, comment);
        this.emit(and([guard, neg(v)]), { t: "rst", op: lhs }, comment);
        return;
      }
      case "call": {
        const c = s.call;
        if (c.k === "call" && c.fn.length === 1 && this.types.get(c.fn[0].name) === "TIMER") {
          const inA = c.args.find(a => a.name?.toUpperCase() === "IN"), pt = c.args.find(a => a.name?.toUpperCase() === "PT");
          if (inA && pt && pt.e.k === "lit" && pt.e.ty === "TIME") {
            const name = c.fn[0].name, op = this.P.ops.get(name);
            const ms = pt.e.v;
            if (op) { op.presetMs = ms; Object.assign(op, timerPreset(this.P.plat, ms)); }
            this.emit(and([guard, this.net(inA.e, comment)]), { t: "timer", op: name, presetMs: ms }, comment);
            return;
          }
        }
        this.problems.push(trx("nepodporované volání na řádku {line}", { line: s.pos.line }));
        return;
      }
      case "if": case "case": {
        /* větve IF / CASE jako seznam podmínek (CASE: selektor = návěští) */
        const branches: Array<{ c: Expr | null; label: string; body: Stmt[]; line: number }> = [];
        const condReads = new Set<string>();
        if (s.k === "if") {
          for (const b of s.conds) { branches.push({ c: b.c, label: "", body: b.body, line: b.c.pos.line }); this.reads(b.c, condReads); }
        } else {
          this.reads(s.sel, condReads);
          for (const b of s.branches) {
            const parts = b.labels.map(l => l.hi
              ? { k: "bin", op: "AND", a: { k: "bin", op: ">=", a: s.sel, b: l.lo, pos: l.lo.pos }, b: { k: "bin", op: "<=", a: s.sel, b: l.hi, pos: l.lo.pos }, pos: l.lo.pos } as Expr
              : { k: "bin", op: "=", a: s.sel, b: l.lo, pos: l.lo.pos } as Expr);
            const c = parts.reduce((x, y) => ({ k: "bin", op: "OR", a: x, b: y, pos: x.pos }) as Expr);
            const lbl = b.labels.map(l => (l.lo.k === "lit" ? l.lo.v : "?") + (l.hi && l.hi.k === "lit" ? ".." + l.hi.v : "")).join(",");
            branches.push({ c, label: lbl, body: b.body, line: b.labels[0].lo.pos.line });
          }
        }
        if (s.els) branches.push({ c: null, label: "ELSE", body: s.els, line: s.pos.line });
        const w = this.writes([s], new Set());
        const selName = s.k === "case" && s.sel.k === "ref" ? s.sel.path[0].name : "if";
        const ctxOf = (b: typeof branches[number]) => this.cmt(b.line) || (s.k === "case" ? selName + " = " + b.label : ctx);
        /* podmínky všech větví napřed (mezivýsledky v různých pomocných registrech) */
        const conds = branches.map(b => b.c ? this.net(b.c, ctxOf(b)) : TRUE_NET);
        const tmps = new Set([...this.tmpPool.INT, ...this.tmpPool.REAL]);
        const stable = ![...condReads].some(r => w.has(r)) && !conds.some(c => [...netReads(c, new Set())].some(r => tmps.has(r)));
        const exclusive = s.k === "case" && !s.els && s.branches.every(b => b.labels.every(l => l.lo.k === "lit" && !l.hi));
        const prev: Net[] = [];
        const guards: Net[] = [];
        branches.forEach((b, i) => {
          /* CASE nad konstantami: návěští se vylučují (bity se počítají hned za sebou bez zápisu) → bez negací předchozích */
          const raw = and([guard, ...(exclusive ? [] : prev.map(neg)), conds[i]]);
          if (stable) guards.push(raw);
          else {
            /* podmínka se ve větvi mění (nebo stojí na mezivýsledku) → vyhodnotit jednou do pomocného bitu (jako ST) */
            const a = this.aux(s.k === "case" ? selName + "_" + b.label.replace(/[^0-9A-Za-z]/g, "_") : "if" + (++this.auxN), "BIT");
            this.emit(raw, { t: "coil", op: a }, trx("podmínka větve: {c}", { c: ctxOf(b) }));
            guards.push({ t: "no", op: a });
          }
          if (b.c) prev.push(stable ? conds[i] : guards[i]);
        });
        branches.forEach((b, i) => this.stmts(b.body, guards[i], ctxOf(b)));
        return;
      }
      default:
        this.problems.push(trx("nepodporovaný příkaz na řádku {line}", { line: s.pos.line }));
    }
  }
}

/**
 * Vstupy bloků s konstantou (`instB1_scaleMin := 0.0;` jediné nepodmíněné přiřazení literálu, všechna čtení
 * až za ním) se dosadí přímo do funkcí — v žebříčku je to konstanta (#0.0), registr MF / MI se nespotřebuje.
 */
function foldConstants(units: Stmt[][], types: Map<string, Operand["dt"]>): Map<string, string> {
  const asg = new Map<string, { n: number; at: number; v?: string }>(), firstRead = new Map<string, number>();
  let idx = 0;
  const readE = (e: Expr | undefined) => {
    if (!e) return;
    if (e.k === "ref") { const n = e.path[0].name; if (!firstRead.has(n)) firstRead.set(n, idx); }
    else if (e.k === "un") readE(e.e);
    else if (e.k === "bin") { readE(e.a); readE(e.b); }
    else if (e.k === "call") for (const a of e.args) readE(a.e);
  };
  const walk = (ss: Stmt[] | undefined, top: boolean) => {
    for (const s of ss || []) {
      if (top) idx++;
      if (s.k === "assign" && s.lhs.k === "ref") {
        const n = s.lhs.path[0].name, a = asg.get(n) || { n: 0, at: idx };
        a.n++;
        a.v = top && a.n === 1 && s.rhs.k === "lit" && s.rhs.ty !== "BOOL" && s.rhs.ty !== "TIME" ? "#" + (s.rhs.ty === "REAL" && Number.isInteger(s.rhs.v) ? s.rhs.v.toFixed(1) : String(s.rhs.v)) : undefined;
        asg.set(n, a);
        readE(s.rhs);
      } else if (s.k === "call" && s.call.k === "call") for (const a of s.call.args) readE(a.e);
      else if (s.k === "if") { for (const c of s.conds) { readE(c.c); walk(c.body, false); } walk(s.els, false); }
      else if (s.k === "case") { readE(s.sel); for (const b of s.branches) walk(b.body, false); walk(s.els, false); }
    }
  };
  for (const u of units) walk(u, true);
  const out = new Map<string, string>();
  for (const [n, a] of asg) {
    const dt = types.get(n);
    if (a.n !== 1 || !a.v || !n.startsWith("inst") || (dt !== "REAL" && dt !== "INT")) continue;
    if ((firstRead.get(n) ?? Infinity) <= a.at) continue;
    out.set(n, a.v);
  }
  return out;
}

/* uložená pomocná síť: v nestabilním případě `prev` drží bity větví (guard je v nich už obsažen) */

/** Program v žebříčku pro VisiLogic / U90 (operandy + větve po částech). */
export function buildLadder(prj: Project, plat: LadderPlat): LadderProgram {
  const L = hwLayout(prj, plat);
  const cpu = L.stations[0]?.head?.opt?.orderCode || (plat === "jazz" ? "JZ20-R31" : "V350-35-TA24");
  const P: LadderProgram = { plat, ops: new Map(), sections: [], limits: limitsFor(plat, cpu), problems: [], L };
  const types = new Map<string, Operand["dt"]>();
  /* operandy programu: I/O sestavy, pak stav programu (uniTags = tytéž jména jako Machine.st UniLogic) */
  const tags = uniTags(prj);
  const ioByTag = new Map(prj.io.map(e => [e.tag, e]));
  for (const t of tags) {
    const io = ioByTag.get(t.name);
    types.set(t.name, io ? (io.dir === "DI" || io.dir === "DO" ? "BIT" : "INT") : t.type === "BIT" ? "BIT" : t.type === "REAL" ? "REAL" : t.type === "TON" ? "TIMER" : "INT");
  }
  const { sections } = uniSections(prj, plat);
  const problems: string[] = [];
  const parsed: Array<{ s: UniSection; stmts: Stmt[]; cmt: (line: number) => string }> = [];
  for (const s of sections) {
    const lines = s.st.split("\n");
    const cmt = (line: number) => {
      const m = (lines[line - 1] || "").match(/\(\*\s*(.*?)\s*\*\)/g);
      return m ? m.map(x => x.replace(/^\(\*\s*|\s*\*\)$/g, "")).filter(x => x && x !== s.title && !x.startsWith("---")).join("; ") : "";
    };
    const lx = lex(s.st, s.title, { nestedComments: true, scl: false });
    const pr = parse(lx.toks, s.title, { scl: false, statementsOnly: true });
    for (const e of [...lx.errors, ...pr.errors]) problems.push(s.title + ": " + e.msg);
    parsed.push({ s, stmts: pr.unit.stmts || [], cmt });
  }
  const folded = foldConstants(parsed.map(x => x.stmts), types);
  const b = new Builder(P, types, () => "", problems);
  b.folded = folded;
  const secs: Array<{ s: UniSection; rungs: Rung[] }> = [];
  for (const x of parsed) {
    b.rungs = []; b.cmt = x.cmt;
    b.stmts(x.stmts, TRUE_NET, x.s.title);
    secs.push({ s: x.s, rungs: b.rungs });
  }
  /* přidělení adres: I/O podle sestavy, MI nejdřív analogy (propojení v konfiguraci hardwaru), pak program */
  const next: Record<OpType, number> = { I: 0, O: 0, MB: 0, MI: 0, MF: 0, T: 0, C: 0 };
  const add = (o: Operand) => { P.ops.set(o.name, o); };
  const analog = prj.io.filter(e => e.dir === "AI" || e.dir === "AO");
  for (const e of prj.io) {
    const k = L.ch.get(e);
    const desc = stripDia(e.cmt || "");
    if (e.dir === "DI" || e.dir === "DO") add({ name: e.tag, type: e.dir === "DI" ? "I" : "O", no: k ? ioNo(L, k) : -1, dt: "BIT", desc, io: e, ch: k });
  }
  for (const e of analog) add({ name: e.tag, type: "MI", no: next.MI++, dt: "INT", desc: stripDia(e.cmt || ""), io: e, ch: L.ch.get(e) });
  const descOf = new Map(tags.map(t => [t.name, t.cmt]));
  for (const [name, dt] of types) {
    if (P.ops.has(name) || folded.has(name)) continue;
    const type: OpType = dt === "BIT" ? "MB" : dt === "TIMER" ? "T" : dt === "REAL" ? (plat === "jazz" ? "MI" : "MF") : "MI";
    add({ name, type, no: next[type]++, dt, desc: stripDia(descOf.get(name) || (name.startsWith("aux_") ? trx("pomocný operand žebříčku") : "")), aux: name.startsWith("aux_"), intReal: plat === "jazz" && dt === "REAL" });
  }
  /* presety časovačů (z volání) — operand vznikl až po převodu, doplnit */
  for (const { rungs } of secs) for (const r of rungs) for (const o of r.outs) if (o.t === "timer") {
    const op = P.ops.get(o.op)!; op.presetMs = o.presetMs; Object.assign(op, timerPreset(plat, o.presetMs));
  }
  let no = 0;
  for (const { s, rungs } of secs) {
    for (const r of rungs) r.no = ++no;
    P.sections.push({ title: s.title, kind: s.kind, rungs });
  }
  P.problems = problems;
  return P;
}

/* ============================================================ výstupy */

const A = (s: string) => stripDia(String(s)).replace(/[—–]/g, "-").replace(/°/g, "deg").replace(/[„“”]/g, '"').replace(/[^\x00-\x7F]/g, "?");

export function opAddr(o: Operand | undefined): string {
  if (!o) return "?";
  return o.no < 0 ? o.type + " ?" : o.type + " " + o.no;
}
function opLabel(P: LadderProgram, name: string): string {
  if (name.startsWith("#")) return name;
  const o = P.ops.get(name);
  return o ? (o.type + (o.no < 0 ? "?" : o.no)) + " " + A(name) : A(name);
}

/** Textový zápis podmínky (pro popis větve). */
function netText(P: LadderProgram, n: Net, top = true): string {
  switch (n.t) {
    case "const": return n.v ? "1" : "0";
    case "no": return opLabel(P, n.op);
    case "nc": return "NOT " + opLabel(P, n.op);
    case "cmp": return opLabel(P, n.a) + " " + n.op + " " + opLabel(P, n.b);
    case "and": return n.items.map(i => netText(P, i, false)).join(" AND ");
    case "or": { const s = n.items.map(i => netText(P, i, false)).join(" OR "); return top ? s : "(" + s + ")"; }
  }
}

interface Box { lines: string[]; w: number; }
function leaf(s: string): Box { return { lines: [s], w: s.length }; }
function pad(b: Box, w: number): string[] { return b.lines.map((l, i) => l + (i === 0 ? "-" : " ").repeat(w - l.length)); }
function draw(P: LadderProgram, n: Net): Box {
  switch (n.t) {
    case "const": return leaf("-------");
    case "no": return leaf("--[ " + opLabel(P, n.op) + " ]--");
    case "nc": return leaf("--[/ " + opLabel(P, n.op) + " ]--");
    case "cmp": return leaf("--[ " + opLabel(P, n.a) + " " + n.op + " " + opLabel(P, n.b) + " ]--");
    case "and": {
      const bs = n.items.map(i => draw(P, i));
      const h = Math.max(...bs.map(b => b.lines.length));
      const lines: string[] = [];
      for (let r = 0; r < h; r++) lines.push(bs.map(b => (b.lines[r] ?? "").padEnd(b.w, " ")).join(""));
      return { lines, w: bs.reduce((s, b) => s + b.w, 0) };
    }
    case "or": {
      const bs = n.items.map(i => draw(P, i));
      const w = Math.max(...bs.map(b => b.w));
      const lines: string[] = [];
      bs.forEach((b, i) => {
        const last = i === bs.length - 1;
        pad(b, w).forEach((l, r) => {
          if (r === 0) lines.push("+" + l + "+");
          else lines.push((last ? " " : "|") + l + (last ? " " : "|"));
        });
      });
      return { lines, w: w + 2 };
    }
  }
}
function outText(P: LadderProgram, o: Out): string {
  switch (o.t) {
    case "coil": return "( " + opLabel(P, o.op) + " )";
    case "set": return "(S " + opLabel(P, o.op) + " )";
    case "rst": return "(R " + opLabel(P, o.op) + " )";
    case "timer": {
      const op = P.ops.get(o.op), tp = timerPreset(P.plat, o.presetMs);
      return "( TD " + opLabel(P, o.op) + "  " + (o.presetMs / 1000).toFixed(2) + " s = " + tp.preset + " x " + tp.unit + " ms )" + (op ? "" : "");
    }
    case "fn": {
      const f = (o.fp && P.plat === "vision" && o.fn !== "INT>FP" && o.fn !== "FP>INT" ? "FP " : "") + o.fn;
      return "[ " + f + " " + o.args.map(a => opLabel(P, a)).join(", ") + " -> " + opLabel(P, o.dst) + " ]" + (o.fp && P.plat === "jazz" ? "  !REAL" : "");
    }
  }
}
/** ASCII kresba větve: levá lišta, kontakty (sériově = AND, paralelně = OR), výstupy vpravo pod sebou. */
export function rungAscii(P: LadderProgram, r: Rung): string {
  const b = r.cond.t === "const" ? leaf("") : draw(P, r.cond);
  const outs = r.outs.map(o => outText(P, o));
  const lines: string[] = [];
  const h = Math.max(b.lines.length, outs.length);
  for (let i = 0; i < h; i++) {
    const net = (b.lines[i] ?? "").padEnd(b.w, i === 0 ? "-" : " ");
    const o = i >= outs.length ? "" : outs.length === 1 ? "----" + outs[i] : (i === 0 ? "-+--" : " +--") + outs[i];
    lines.push(("|" + net + o).replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

function sectionTitle(s: LadderSection): string {
  return s.title;
}

function opsCount(P: LadderProgram): Record<OpType, number> {
  const c: Record<OpType, number> = { I: 0, O: 0, MB: 0, MI: 0, MF: 0, T: 0, C: 0 };
  for (const o of P.ops.values()) c[o.type]++;
  return c;
}
/** Překročení limitů operandů CPU (README, validace). */
export function ladderLimitProblems(P: LadderProgram): string[] {
  const c = opsCount(P), out: string[] = [];
  for (const t of ["MB", "MI", "MF", "T"] as const) {
    const lim = P.limits[t];
    if (c[t] > lim && !(t === "MF" && P.plat === "jazz")) out.push(tr("{type}: {n} operandů, {cpu} jich má {lim}", { type: t, n: c[t], cpu: P.limits.cpu, lim }));
  }
  if (P.plat === "jazz" && [...P.ops.values()].some(o => o.intReal)) out.push(tr("U90 Ladder nemá čísla REAL (MF): hodnoty REAL jsou v MI celočíselně — větve označené !REAL (škálování analogů, rampy) přepiš ručně (násob před dělením)."));
  return out;
}

const csvQ = (s: string) => '"' + A(s).replace(/"/g, "'") + '"';

/** Operandy.csv: název (= tag), typ, adresa, preset časovače, popis. */
export function ladderOperandsCsv(P: LadderProgram): string {
  const l = ["Name,Type,Address,Data type,Timer preset,Timer unit ms,Description"];
  const order: OpType[] = ["I", "O", "MB", "MI", "MF", "T", "C"];
  const list = [...P.ops.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.no - b.no);
  for (const o of list) l.push([csvQ(o.name), csvQ(o.type), csvQ(o.no < 0 ? "" : String(o.no)), csvQ(o.dt + (o.intReal ? " (U90: INT)" : "")),
    csvQ(o.preset !== undefined ? String(o.preset) : ""), csvQ(o.unit !== undefined ? String(o.unit) : ""), csvQ(o.desc)].join(","));
  return l.join("\n");
}

/** IO_mapa.csv: signál → operand → modul a kanál sestavy. */
export function ladderIoMapCsv(P: LadderProgram, prj: Project): string {
  const l = ["Tag,Dir,Operand,Module,Module type,Channel,Comment"];
  for (const e of prj.io) {
    const o = P.ops.get(e.tag), k = P.L.ch.get(e);
    const mod = k ? k.mod.dt : "", typ = k ? (k.mod.opt?.orderCode || k.mod.custom || "") : "";
    const opT = o ? opAddr(o) + (e.dir === "AI" || e.dir === "AO" ? " (" + trx("propojit v konfiguraci HW") + ")" : "") : "";
    l.push([csvQ(e.tag), csvQ(e.dir), csvQ(opT), csvQ(mod), csvQ(typ), csvQ(k ? String(k.no) : trx("nevejde se")), csvQ(e.cmt || "")].join(","));
  }
  return l.join("\n");
}

function legend(P: LadderProgram): string[] {
  return [
    tr("--[ X ]--  kontakt NO (sepnutý při 1) · --[/ X ]--  kontakt NC (sepnutý při 0) · --[ A = B ]--  porovnání (Compare)"),
    tr("( X )  cívka (výsledek větve) · (S X ) / (R X )  Set / Reset bitu · ( TD T n )  časovač se zpožděným sepnutím, kontakt T n = hotovo"),
    tr("[ MOV a -> b ]  uložení (Store) · ADD / SUB / MUL / DIV  celočíselné funkce · FP …  funkce v plovoucí čárce (MF) · INT>FP / FP>INT  převod"),
    tr("#n = konstanta · sériově = AND, paralelní větve (+ … +) = OR · aux_* = pomocné operandy žebříčku (podmínka větve vyhodnocená jednou, mezivýsledky)"),
  ];
}

function head(P: LadderProgram, prj: Project): string[] {
  const c = opsCount(P);
  return [
    tr("Projekt: {name}", { name: prj.meta.name || tr("(bez názvu)") }) + " · " + PLAT[P.plat].name + " (" + PLAT[P.plat].ide + ") · " + tr("generováno PLCdesk"),
    tr("RUČNÍ PŘENOS: {ide} neumí import programu z textu — větve zadej ručně v pořadí čísel. Program je odvozen z téhož modelu jako kód ostatních platforem; v IDE NEOVĚŘENO.", { ide: PLAT[P.plat].ide }),
    tr("CPU: {cpu} · operandy: I {i}, O {o}, MB {mb}/{lmb}, MI {mi}/{lmi}, MF {mf}/{lmf}, T {t}/{lt} · větví: {n}", {
      cpu: P.limits.cpu, i: c.I, o: c.O, mb: c.MB, lmb: P.limits.MB, mi: c.MI, lmi: P.limits.MI, mf: c.MF, lmf: P.limits.MF, t: c.T, lt: P.limits.T,
      n: P.sections.reduce((s, x) => s + x.rungs.length, 0) }),
  ];
}

/** Ladder.md: program větev po větvi (popis + ASCII kresba). */
export function ladderMd(P: LadderProgram, prj: Project): string {
  const L: string[] = ["# " + tr("Žebříček (Ladder) — {plat}", { plat: PLAT[P.plat].name }), ""];
  for (const h of head(P, prj)) L.push(h + "  ");
  L.push("");
  const lim = ladderLimitProblems(P);
  if (lim.length || P.problems.length) { L.push("> **" + tr("POZOR") + "**  "); for (const x of [...lim, ...P.problems]) L.push("> " + x + "  "); L.push(""); }
  L.push("## " + tr("Legenda"), "");
  for (const x of legend(P)) L.push("- " + x);
  L.push("");
  P.sections.forEach((s, i) => {
    L.push("## " + (i + 1) + ". " + sectionTitle(s), "");
    for (const r of s.rungs) {
      L.push("### " + tr("Větev {n}", { n: r.no }) + (r.comment ? " — " + r.comment : ""), "");
      L.push(tr("Podmínka: {c}", { c: r.cond.t === "const" ? tr("vždy (bez kontaktů)") : netText(P, r.cond) }) + "  ");
      L.push(tr("Výstup: {o}", { o: r.outs.map(o => outText(P, o)).join(" · ") }), "");
      L.push("```", rungAscii(P, r), "```", "");
    }
  });
  return L.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Ladder.html: tisknutelná podoba téhož (větev nepřeteče přes stránku). */
export function ladderHtml(P: LadderProgram, prj: Project): string {
  const L: string[] = [];
  L.push("<!doctype html>", '<html lang="en"><head><meta charset="utf-8">', "<title>" + esc(A(prj.meta.name || "PLCdesk")) + " - Ladder " + esc(PLAT[P.plat].ide) + "</title>",
    "<style>body{font:13px/1.4 system-ui,sans-serif;margin:16px;color:#111;background:#fff}h1{font-size:20px}h2{font-size:16px;border-bottom:1px solid #999;margin-top:24px}"
    + ".r{border:1px solid #ccc;margin:8px 0;padding:6px 8px;break-inside:avoid;page-break-inside:avoid}.r b{font-size:13px}"
    + "pre{font:12px/1.25 Consolas,monospace;margin:4px 0 0;white-space:pre;overflow-x:auto}.w{background:#fff3cd;border:1px solid #e0b000;padding:6px}"
    + "@media print{body{margin:0}h2{page-break-after:avoid}}</style></head><body>");
  L.push("<h1>" + esc(tr("Žebříček (Ladder) — {plat}", { plat: PLAT[P.plat].name })) + "</h1>");
  for (const h of head(P, prj)) L.push("<p>" + esc(h) + "</p>");
  const lim = [...ladderLimitProblems(P), ...P.problems];
  if (lim.length) L.push('<p class="w"><b>' + esc(tr("POZOR")) + "</b><br>" + lim.map(esc).join("<br>") + "</p>");
  L.push("<h2>" + esc(tr("Legenda")) + "</h2><ul>" + legend(P).map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>");
  P.sections.forEach((s, i) => {
    L.push("<h2>" + (i + 1) + ". " + esc(sectionTitle(s)) + "</h2>");
    for (const r of s.rungs) {
      L.push('<div class="r"><b>' + esc(tr("Větev {n}", { n: r.no })) + "</b>" + (r.comment ? " — " + esc(r.comment) : "")
        + "<pre>" + esc(rungAscii(P, r)) + "</pre></div>");
    }
  });
  L.push("</body></html>");
  return L.join("\n");
}

/** README.txt: štítek ověření, postup ručního zadání, omezení a neověřené volby. */
export function ladderReadme(P: LadderProgram, prj: Project): string {
  const vis = P.plat === "vision";
  const lim = ladderLimitProblems(P);
  const L: string[] = [
    tr("PROJEKT: {name} · generováno PLCdesk", { name: prj.meta.name || tr("(bez názvu)") }) + metaLine(prj),
    "",
    PLAT[P.plat].name.toUpperCase() + " — " + PLAT[P.plat].ide + " — " + tr("RUČNÍ PŘENOS"),
    verificationReadme(P.plat),
    "",
    tr("{ide} programuje jen v Ladderu a neumí import programu ani názvů operandů z textu (formát projektu není dokumentovaný, API není). PLCdesk proto dává žebříček k ručnímu zadání — odvozený z téhož modelu stroje a šablon bloků jako kód ostatních platforem (plochá logika jako UniLogic, kterou ověřil překladač UniLogic). Simulace návrhu platí beze změny; emulace kódu se této platformy netýká.", { ide: PLAT[P.plat].ide }),
    "",
    tr("SOUBORY"),
    "- Operandy.csv — " + tr("operand ke každému názvu (I / O / MB / MI / MF / T), adresa, preset časovačů a popis — popisy (Description / Symbol) zadej v IDE ručně"),
    "- IO_mapa.csv — " + tr("signál → operand → modul a kanál sestavy (kusovník, výkresy)"),
    "- Ladder.md / Ladder.html — " + tr("program větev po větvi: podmínka, výstup a ASCII kresba; HTML je pro tisk"),
    "",
    tr("POSTUP"),
    "1. " + (vis ? tr("VisiLogic: nový projekt, zvol CPU a v Hardware Configuration rozšiřovací moduly (adaptér EX-A2X) podle IO_mapa.csv; analogové kanály propoj s registry MI podle Operandy.csv.")
      : tr("U90 Ladder: nový projekt, zvol model (Jazz / M91) a v Hardware Configuration propoj analogové vstupy s registry MI podle Operandy.csv.")),
    "2. " + tr("Operandům dej popisy podle Operandy.csv (stejná jména jako v kódu ostatních platforem a v HMI)."),
    "3. " + tr("Časovačům nastav preset ze sloupce Timer preset (jednotka ve sloupci Timer unit ms)."),
    "4. " + tr("Zadej větve z Ladder.md v pořadí čísel — pořadí je podstatné (jako v ST: vyhodnocení shora dolů), pomocné bity aux_* nevynechávej."),
    "5. " + tr("Napoj HMI / displej na modeAuto, cmdAutoStart, cmdAck a ruční povely manRun_* / manOpen_*; stav poruchy machineFault, krok s timeoutem faultStep."),
    "6. " + tr("Test: nejdřív s odpojenými akčními členy, krok po kroku podle FAT."),
    "",
    tr("ČASOVAČE"),
    vis ? tr("Vision: preset v jednotkách 10 ms (VisiLogic Knowledgebase, Store Timer Counter Preset: „broken down into units of 10 milliseconds“), rozlišení 10 ms, max. 99:59:59.99.")
      : tr("U90: 64 časovačů, hodnota 14 bitů a jednotka 10 ms (do 2:43,83 min) / 100 ms / 1 s / 10 s — PLCdesk volí nejjemnější, do které se preset vejde (U90 Ladder Knowledgebase, Timers). Na M90 / M91 je preset v RAM (po výpadku napájení se ztratí), Jazz ho ukládá do Flash."),
    "",
    tr("OMEZENÍ A LIMITY"),
    vis ? tr("Vision V350: MB 8192, MI 4096, MF 64, T 384, C 32; V130: MB 4096, MI 2048, MF 24, T 192; Samba: MB 512, MI 256, MF 24, T 32 (specifikace výrobce).")
      : tr("Jazz: Ladder max. 2K, download 24K, 64 proměnných displeje; M91: download 32K; Jazz: MB 256, MI 256, T 64 (U90 Ladder Knowledgebase, Compatibility HW / OS / SW; specifikace Jazz). U90 nemá MF — REAL se tu zapisuje do MI celočíselně."),
    tr("Zdroj limitů: {src}", { src: P.limits.src }),
    ...(lim.length ? ["", tr("POZOR — překročeno / k ruční úpravě:"), ...lim.map(x => "- " + x)] : []),
    "",
    tr("NEOVĚŘENO — DOPLNÍ TESTER"),
    "- " + tr("Model CPU ({cpu}) a rozšiřovací moduly: výchozí volba PLCdesk podle počtu I/O (kusovník) — ověř skutečné osazení.", { cpu: P.limits.cpu }),
    "- " + (vis ? tr("Adresy rozšiřovacích modulů: I/O modulu x (0–7) = 32 + 16·x + kanál (návod EX-A2X); vestavěné I/O od 0.") : tr("Adresy I/O: vestavěné vstupy I a výstupy O od 0; analogy AN0 / AN1 a I16 / I17 propojit s MI.")),
    "- " + tr("Rozsah analogů: rawMax {raw} (výchozí odhad PLCdesk) — uprav podle nastavení analogového kanálu (rozlišení, 0–10 V / 4–20 mA).", { raw: vis ? 16383 : 4095 }),
    "- " + tr("Čísla registrů MB / MI / MF / T od 0 — posuň, pokud projekt už operandy používá; jména zůstávají."),
    "- " + tr("Názvy funkcí (Store, Compare, FP) a jejich umístění v nabídce IDE se mohou podle verze lišit."),
    "",
    tr("NEPODPORUJE: servoosa (PLCopen Motion) a pohony po síti — jen pohony a proporcionální prvky přes běžné I/O; styl kódu OOP; export HMI ({hmi}).", { hmi: vis ? tr("displej Vision navrhni ve VisiLogic ručně podle 16_hmi.md") : tr("displej Jazz / M91 navrhni v U90 ručně") }),
    "",
    tr("BEZPEČNOST: E-stop v kódu je jen informativní signál. Skutečné bezpečnostní funkce patří do safety relé / bezpečnostního PLC dle ISO 13849 / IEC 62061."),
    "",
  ];
  return L.join("\n");
}

/** Všechny soubory platformy s ručním přenosem. */
export function genForLadder(prj: Project, plat: LadderPlat): Record<string, string> {
  const P = buildLadder(prj, plat);
  return {
    "Operandy.csv": ladderOperandsCsv(P),
    "IO_mapa.csv": ladderIoMapCsv(P, prj),
    "Ladder.md": ladderMd(P, prj),
    "Ladder.html": ladderHtml(P, prj),
    "README.txt": ladderReadme(P, prj),
  };
}

/** Pro testy a validaci: počty operandů a limity. */
export function ladderStats(prj: Project, plat: LadderPlat): { counts: Record<OpType, number>; limits: LadderLimits; problems: string[]; limitProblems: string[] } {
  const P = buildLadder(prj, plat);
  return { counts: opsCount(P), limits: P.limits, problems: P.problems, limitProblems: ladderLimitProblems(P) };
}
export type { Dir };

/* validace: překročené limity operandů CPU a U90 bez REAL (jen platformy projektu); cache podle obsahu projektu */
const valCache = new Map<string, ValidationIssue[]>();
registerValidationHook((prj: Project): ValidationIssue[] => {
  const plats = (prj.platforms || []).filter((p): p is LadderPlat => isLadderPlat(p) && !axisBlocked(prj, p));
  if (!plats.length) return [];
  const key = JSON.stringify(prj) + "|" + plats.join();
  const hit = valCache.get(key);
  if (hit) return hit;
  const out: ValidationIssue[] = [];
  for (const plat of plats) for (const m of ladderStats(prj, plat).limitProblems) out.push({ level: "warn", where: PLAT[plat].name, msg: m });
  if (valCache.size > 8) valCache.clear();
  valCache.set(key, out);
  return out;
});
