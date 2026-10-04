/**
 * PLCdesk — styl kódu OOP pro rodinu CODESYS (CODESYS V3.5, TwinCAT 3, Schneider Machine Expert,
 * WAGO e!COCKPIT, Delta DIADesigner-AX): JEDNO CHOVÁNÍ, DRUHÁ PODOBA ZÁPISU.
 *
 * Renderer stojí nad stejnou mezivrstvou (`buildIR`, ir.ts) a stejnými šablonami bloků
 * (`fbTemplate`) jako klasický styl — logika stavových automatů se NEOPISUJE, ale převádí ze
 * šablony: proměnné šablony se přejmenují (stav do základní třídy, vnitřní proměnné maďarskou
 * notací), tělo šablony se stane metodou `Cycle`. Pořadí vyhodnocení je totožné s klasickým
 * MAIN (enable → sekvence → bloky → porucha stroje), takže chování (výstupy, kroky, porucha,
 * stav bloků) je scan po scanu stejné — hlídá to emulátor (emu.test.ts: OOP = klasika = návrh).
 *
 * Třídy:
 *  - INTERFACE I_Device — METHOD Execute (jeden cyklus), METHOD Reset (kvitace), PROPERTY Fault,
 *    Status, Busy (jen GET),
 *  - FUNCTION_BLOCK ABSTRACT FB_DeviceBase IMPLEMENTS I_Device — stav (krok, porucha, busy,
 *    status 16#0000 / 8001 / 8002), kvitace (Reset → úroveň pro nejbližší Execute), vlastnosti,
 *    šablonová metoda Execute → abstraktní Cycle,
 *  - FB_Motor / FB_Valve / FB_AnalogIn / FB_AnalogOut EXTENDS FB_DeviceBase IMPLEMENTS I_Device
 *    — Cycle = tělo šablony třídy,
 *  - FB_Sequence — sekvence jedním CASE (`renderSeq` nad IR), krok / porucha přes VAR_IN_OUT
 *    (proměnné řízení zůstávají v MAIN — jména jsou rozhraním k HMI),
 *  - MAIN — instance (jména instM1… beze změny, HMI), `aDevices : ARRAY[1..N_DEVICES] OF I_Device`
 *    pro kvitaci a souhrn poruch v cyklu FOR s kontrolou odkazu `<> 0`.
 * Robustnost: žádné ukazatele, __NEW ani dynamická paměť, meze polí konstantou, žádné WHILE.
 *
 * Výstupy: ST výpis (Gen_Library.st, FB_Sequence.st, MAIN.st), PLCopen XML s rozšířením CODESYS
 * (`addData`: pouinheritance, method, property, interface — podle exportu CODESYS V3.5 SP20 a
 * TwinCAT; NEOVĚŘENO importem) a u TwinCATu soubory .TcPOU / .TcIO / .TcGVL (podle reálných
 * souborů TcUnit / AixOCAT; NEOVĚŘENO importem). Všechny podoby se staví z jednoho modelu
 * (`OopPou`), emulátor z XML / TcPOU výpis zpětně sestaví a porovná s ST výpisem.
 */
import {
  Project, PlatformKey, PLAT, usedClasses, addrFor, dtFor, esc, stripDia, codeStyleFor,
} from "./model.js";
import { buildIR, irText, IR_CTRL, type IrProgram, type IrFb, type IrFbClass, type IrExpr } from "./ir.js";
import {
  stCtx, renderSeq, renderWiring, renderDecls, enableText, stCallNotes, trComments, cmtSafe,
  fbTemplate, parseFbTemplate, codeLibrary, genTagFile, genReadme, rawMaxFor, type StCtx,
} from "./codegen.js";
import { tr, trx, N_ } from "./i18n.js";
import { derivedGuid } from "./guid.js";

/* ================================================================ model */

export interface OopVar { name: string; type: string; init?: string; cmt?: string; }
export interface OopBlock { kind: "in" | "out" | "inout" | "var" | "const"; vars: OopVar[]; }
export interface OopMethod {
  name: string; access?: "PUBLIC" | "PROTECTED" | "PRIVATE"; abstract?: boolean; ret?: string;
  blocks: OopBlock[]; body: string; cmt?: string[];
}
export interface OopProp { name: string; type: string; access?: "PUBLIC" | "PROTECTED"; get: string; pragma?: string; }
export interface OopPou {
  kind: "fb" | "program" | "interface";
  name: string;
  abstract?: boolean;
  extends?: string;
  implements?: string[];
  /** komentář pod hlavičkou: JEDEN víceřádkový komentář (řádky bez značek, ASCII) — klíč překladu šablony */
  cmt: string[];
  /** samostatné komentáře před `cmt` (poznámka firemní knihovny) */
  notes?: string[];
  blocks: OopBlock[];
  body: string;
  methods: OopMethod[];
  props: OopProp[];
}

/** Rozhraní a jeho členové — jediný zdroj pro rozhraní, základní třídu i kontrolu emulátoru. */
export const OOP_ITF = "I_Device";
export const OOP_BASE = "FB_DeviceBase";
export const OOP_SEQ = "FB_Sequence";
/** Třída OOP podle třídy IR (Ventil → FB_Valve, ostatní jako klasika). */
export const OOP_CLASSES: Record<IrFbClass, string> = { Motor: "FB_Motor", Ventil: "FB_Valve", AnalogIn: "FB_AnalogIn", AnalogOut: "FB_AnalogOut" };
/** Pořadí tříd ve výpisu (= pořadí v Gen_Library klasického stylu). */
const CLASS_ORDER: IrFbClass[] = ["Motor", "Ventil", "AnalogIn", "AnalogOut"];
/** Proměnné šablony, které přebírá základní třída (stav, kvitace) → jméno v FB_DeviceBase. */
const BASE_VARS: Record<string, string> = { statStep: "iStep", busy: "bBusy", error: "bError", status: "wStatus", reset: "bReset" };
/** Členové I_Device / FB_DeviceBase — port šablony se stejným jménem dostane příponu In / Out (CODESYS nerozlišuje velikost). */
const RESERVED_MEMBERS = new Set(["EXECUTE", "RESET", "CYCLE", "FAULT", "STATUS", "BUSY", "ISTEP", "BBUSY", "BERROR", "WSTATUS", "BRESETREQ", "BRESET",
  "STATUS_OK", "STATUS_BLOCKED", "STATUS_FAULT"]);
const STATUS_CONST: Array<[RegExp, string]> = [[/16#8001\b/g, "STATUS_BLOCKED"], [/16#8002\b/g, "STATUS_FAULT"], [/16#0000\b/g, "STATUS_OK"]];
/** Pole odkazů na zařízení, index cyklu, počet, souhrn poruch, instance sekvence (maďarská notace). */
export const OOP_MAIN = { devices: "aDevices", index: "iDev", count: "N_DEVICES", anyFault: "bAnyFault", seq: "fbSeq" } as const;

/** Platí pro platformu styl OOP? (volba projektu × schopnost platformy) */
export function oopActive(prj: Project, plat: PlatformKey): boolean { return codeStyleFor(prj, plat) === "oop"; }

/* ================================================================ šablona → třída */

const cm = (t: string) => cmtSafe(trx(t));
/** Prefix maďarské notace podle typu (b BOOL, i INT, w WORD, r REAL, t TIME, fb instance bloku). */
function hungarian(name: string, type: string): string {
  const T = type.toUpperCase();
  const pre = T === "BOOL" ? "b" : T === "INT" || T === "DINT" || T === "SINT" || T === "UINT" ? "i" : T === "WORD" || T === "DWORD" ? "w"
    : T === "REAL" || T === "LREAL" ? "r" : T === "TIME" ? "t" : "fb";
  return pre + name.charAt(0).toUpperCase() + name.slice(1);
}
/** Přejmenování identifikátorů v kódu ST (mimo komentáře a mimo členy za tečkou). */
function renameCode(code: string, map: Record<string, string>): string {
  const names = Object.keys(map);
  if (!names.length) return code;
  const re = new RegExp("(?<![\\w.])(" + names.join("|") + ")\\b", "g");
  return code.split(/(\(\*[\s\S]*?\*\))/).map((part, i) => i % 2 ? part : part.replace(re, (m: string) => map[m])).join("");
}
function statusConsts(code: string): string {
  return code.split(/(\(\*[\s\S]*?\*\))/).map((part, i) => i % 2 ? part : STATUS_CONST.reduce((s, [re, c]) => s.replace(re, c), part)).join("");
}
/** Komentář hlavičky šablony (mezi FUNCTION_BLOCK a první deklarací) — řádky bez značek. */
function templateHeader(tpl: string): string[] {
  const head = tpl.slice(tpl.indexOf("\n") + 1, tpl.search(/^\s*VAR/m));
  const m = head.match(/\(\*([\s\S]*?)\*\)/);
  return m ? m[1].split("\n").map(s => s.trim()).filter(Boolean) : [];
}

/** Třída zařízení ze šablony (vstupy / výstupy beze změny jmen, stav v základní třídě, tělo = Cycle). */
export function oopDeviceClass(cls: IrFbClass, tpl: string): OopPou {
  const { vars, body } = parseFbTemplate(tpl);
  const map: Record<string, string> = {};
  const ins: OopVar[] = [], outs: OopVar[] = [], locs: OopVar[] = [];
  for (const v of vars) {
    if (BASE_VARS[v.name]) { map[v.name] = BASE_VARS[v.name]; continue; }
    if (v.kind === "var") { map[v.name] = hungarian(v.name, v.type); locs.push({ name: map[v.name], type: v.type, init: v.init || undefined }); continue; }
    let n = v.name;
    if (RESERVED_MEMBERS.has(n.toUpperCase())) { n = v.name + (v.kind === "in" ? "In" : "Out"); map[v.name] = n; }
    (v.kind === "in" ? ins : outs).push({ name: n, type: v.type, init: v.init || undefined });
  }
  let cycle = statusConsts(renameCode(body, map));
  if (cls === "AnalogIn") {
    cycle += "\n\n(* " + cm(N_("porucha zařízení = překročení meze (souhrn poruch stroje)")) + " *)\n"
      + "bError := alarmHi OR alarmLo;\nIF bError THEN wStatus := STATUS_FAULT; ELSE wStatus := STATUS_OK; END_IF;";
  }
  const blocks: OopBlock[] = [];
  if (ins.length) blocks.push({ kind: "in", vars: ins });
  if (outs.length) blocks.push({ kind: "out", vars: outs });
  if (locs.length) blocks.push({ kind: "var", vars: locs });
  return {
    kind: "fb", name: OOP_CLASSES[cls], extends: OOP_BASE, implements: [OOP_ITF],
    cmt: templateHeader(tpl), blocks, body: "",
    methods: [{ name: "Cycle", access: "PROTECTED", blocks: [], body: cycle,
      cmt: [cm(N_("stavový automat zařízení (z téže šablony jako klasický blok)"))] }],
    props: [],
  };
}

const PROP_PRAGMA = "{attribute 'monitoring' := 'call'}";
/** Vlastnosti rozhraní: jméno, typ, proměnná základní třídy. */
const ITF_PROPS: Array<[string, string, string]> = [["Fault", "BOOL", "bError"], ["Status", "WORD", "wStatus"], ["Busy", "BOOL", "bBusy"]];

export function oopInterface(): OopPou {
  return {
    kind: "interface", name: OOP_ITF, cmt: [], blocks: [], body: "",
    methods: [{ name: "Execute", blocks: [], body: "" }, { name: "Reset", blocks: [], body: "" }],
    props: ITF_PROPS.map(([name, type]) => ({ name, type, get: "" })),
  };
}

export function oopBase(): OopPou {
  return {
    kind: "fb", name: OOP_BASE, abstract: true, implements: [OOP_ITF],
    cmt: [cm(N_("Společný základ bloků zařízení: krok, porucha, stav 16#0000 / 16#8001 / 16#8002 a kvitace."))],
    blocks: [
      { kind: "var", vars: [
        { name: "iStep", type: "INT", cmt: cm(N_("krok stavového automatu")) },
        { name: "bBusy", type: "BOOL", cmt: cm(N_("rozbíhá se / přestavuje se")) },
        { name: "bError", type: "BOOL", cmt: cm(N_("porucha (drží do kvitace)")) },
        { name: "wStatus", type: "WORD", cmt: cm(N_("16#0000 v pořádku, 16#8001 blokováno, 16#8002 porucha")) },
        { name: "bResetReq", type: "BOOL", cmt: cm(N_("kvitace vyžádaná metodou Reset")) },
        { name: "bReset", type: "BOOL", cmt: cm(N_("kvitace v tomto cyklu (hranu vyhodnocuje Cycle)")) },
      ] },
      { kind: "const", vars: [
        { name: "STATUS_OK", type: "WORD", init: "16#0000" },
        { name: "STATUS_BLOCKED", type: "WORD", init: "16#8001" },
        { name: "STATUS_FAULT", type: "WORD", init: "16#8002" },
      ] },
    ],
    body: "",
    methods: [
      { name: "Execute", access: "PUBLIC", blocks: [], cmt: [cm(N_("jeden cyklus zařízení: převzít kvitaci, provést stavový automat"))],
        body: "bReset := bResetReq;\nbResetReq := FALSE;\nTHIS^.Cycle();" },
      { name: "Reset", access: "PUBLIC", blocks: [], cmt: [cm(N_("kvitace poruchy — platí pro nejbližší Execute"))], body: "bResetReq := TRUE;" },
      { name: "Cycle", access: "PROTECTED", abstract: true, blocks: [], cmt: [cm(N_("stavový automat — implementuje odvozený blok"))], body: "" },
    ],
    props: ITF_PROPS.map(([name, type, v]) => ({ name, type, access: "PUBLIC" as const, pragma: PROP_PRAGMA, get: name + " := " + v + ";" })),
  };
}

/* ================================================================ program stroje */

interface OopProgram { pous: OopPou[]; library: OopPou[]; seq?: OopPou; main: OopPou; }

/** Instance zařízení v aDevices: akční členy a analogy s mezemi (= poruchy stroje v IR, pořadí IR). */
function faultInsts(ir: IrProgram): string[] {
  const out: string[] = [];
  for (const e of ir.fault ? ir.fault.errors : []) if (e.k === "member" && !out.includes(e.inst)) out.push(e.inst);
  return out;
}

export function oopProgram(prj: Project, plat: PlatformKey): OopProgram {
  const ir = buildIR(prj);
  const lib = codeLibrary(prj, plat);
  const used = usedClasses(prj);
  const classes = CLASS_ORDER.filter(c => used.has(c));
  const library: OopPou[] = classes.length ? [oopInterface(), oopBase(), ...classes.map(c => {
    const p = oopDeviceClass(c, fbTemplate(c, "st", lib));
    if (lib.ids[c]) p.notes = [cmtSafe(trx("Vlastní blok firemní knihovny {lib}: šablona {id} (neověřeno simulací)", { lib: ((lib.library?.name || "") + " " + (lib.library?.version || "")).trim(), id: lib.ids[c]! }))];
    return p;
  })] : [];
  /* jména: časovače kroků jsou vnitřní proměnné FB_Sequence, povely sekvence jeho výstupy */
  const seqOuts = new Set(ir.seq ? ir.seq.outputs : []);
  const base = stCtx(plat);
  const cSeq: StCtx = { ...base, L: (n: string) => /^tonSeq\d+$/.test(n) ? "fb" + n.charAt(0).toUpperCase() + n.slice(1) : n };
  const cMain: StCtx = { ...base, L: (n: string) => seqOuts.has(n) ? OOP_MAIN.seq + "." + n : n };
  let seq: OopPou | undefined;
  if (ir.seq) {
    const C = IR_CTRL;
    seq = {
      kind: "fb", name: OOP_SEQ, cmt: [cm(N_("Automatická sekvence stroje: jeden CASE (kroky 10, 20, …), povely sekvence jako výstupy."))],
      blocks: [
        { kind: "in", vars: [{ name: C.modeAuto, type: "BOOL" }, { name: C.enable, type: "BOOL" }, { name: C.cmdAutoStart, type: "BOOL" }] },
        { kind: "out", vars: ir.seq.outputs.map(n => ({ name: n, type: "BOOL" })) },
        { kind: "inout", vars: [
          { name: C.seqStep, type: "INT", cmt: cm(N_("krok sekvence (proměnná MAIN — HMI)")) },
          { name: C.faultStep, type: "INT" },
          { name: C.machineFault, type: "BOOL" },
        ] },
        { kind: "var", vars: ir.seq.steps.filter(s => s.timer).map(s => ({ name: cSeq.L(s.timer!), type: "TON" })) },
      ].filter(b => b.vars.length) as OopBlock[],
      body: unindent(renderSeq(ir, cSeq)), methods: [], props: [],
    };
  }
  const main = oopMain(prj, plat, ir, cMain);
  const pous = [...library, ...(seq ? [seq] : []), main];
  return { pous, library, seq, main };
}

/** Odsazení o 4 mezery dolů (renderSeq píše tělo MAIN s odsazením). */
function unindent(s: string): string {
  return s.replace(/\s+$/, "").split("\n").map(l => l.startsWith("    ") ? l.slice(4) : l.trimStart()).join("\n");
}

function oopMain(prj: Project, plat: PlatformKey, ir: IrProgram, c: StCtx): OopPou {
  const M = OOP_MAIN, C = IR_CTRL;
  const devs = faultInsts(ir);
  const n = devs.length;
  const rawMax = rawMaxFor(plat);
  /* volání bloku: vstupy jako přiřazení členů, Execute, výstupy do I/O (kvitace = Reset v cyklu FOR) */
  const call = (b: IrFb): string => {
    const x = (e: IrExpr) => irText(e, c);
    const notes = stCallNotes(b, c);
    const lines: string[] = [];
    const port = (name: string) => RESERVED_MEMBERS.has(name.toUpperCase()) ? name + "In" : name;
    for (const p of b.inputs) {
      if (p.name === "reset") continue;
      lines.push(b.inst + "." + port(p.name) + " := " + x(p.expr) + ";" + (notes.port[p.name] ? " " + c.cm(notes.port[p.name]) : ""));
      if ((p.name === "rawValue" || p.name === "value") && rawMax && (b.cls === "AnalogIn" || b.cls === "AnalogOut"))
        lines.push(b.inst + ".rawMax := " + rawMax + "; (* TODO: " + stripDia(trx("rozsah dle modulu")) + " *)");
    }
    lines.push(b.inst + ".Execute();" + (notes.after !== undefined ? " " + c.cm(notes.after) : ""));
    for (const o of b.outputs) if (o.tag) lines.push(c.R(o.tag) + " := " + b.inst + "." + o.name + ";");
    return lines.join("\n    ");
  };
  const { inst, calls, free } = renderWiring(ir, c, { call });
  const decl = renderDecls(ir, c, d => d.group !== "seqOut" && d.group !== "timer");
  const vars: OopVar[] = [{ name: C.enable, type: "BOOL" }];
  const clsOf = new Map(ir.devices.flatMap(d => d.kind === "fb" ? [[d.inst, d.cls] as [string, IrFbClass]] : []));
  for (const i of inst) vars.push({ name: i.n, type: OOP_CLASSES[clsOf.get(i.n)!] });
  if (ir.seq) vars.push({ name: M.seq, type: OOP_SEQ });
  if (n) {
    vars.push({ name: M.devices, type: "ARRAY[1.." + M.count + "] OF " + OOP_ITF, cmt: cm(N_("odkazy na zařízení: kvitace a souhrn poruch")) });
    vars.push({ name: M.index, type: "INT" }, { name: M.anyFault, type: "BOOL" });
  }
  /* deklarace řízení (renderDecls) → proměnné s komentářem */
  for (const line of decl.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*:\s*(\w+);\s*(?:\(\*\s*(.*?)\s*\*\))?/);
    if (m) vars.push({ name: m[1], type: m[2], ...(m[3] ? { cmt: m[3] } : {}) });
  }
  const blocks: OopBlock[] = [];
  if (n) blocks.push({ kind: "const", vars: [{ name: M.count, type: "INT", init: String(n), cmt: cm(N_("počet zařízení v poli odkazů")) }] });
  blocks.push({ kind: "var", vars });
  const b: string[] = [];
  b.push(C.enable + " := " + enableText(ir, c) + ";", "");
  if (n) {
    b.push("(* --- " + cm(N_("Odkazy na zařízení (každý cyklus — platné i po online změně)")) + " --- *)");
    devs.forEach((d, i) => b.push(M.devices + "[" + (i + 1) + "] := " + d + ";"));
    b.push("");
  }
  if (ir.seq) {
    b.push("(* --- " + cm(N_("Automatická sekvence (režim AUTO)")) + " --- *)");
    b.push(M.seq + "(" + C.modeAuto + " := " + C.modeAuto + ", " + C.enable + " := " + C.enable + ", " + C.cmdAutoStart + " := " + C.cmdAutoStart + ",");
    b.push("      " + C.seqStep + " := " + C.seqStep + ", " + C.faultStep + " := " + C.faultStep + ", " + C.machineFault + " := " + C.machineFault + ");", "");
  }
  const loop = (inner: string[]) => [
    "FOR " + M.index + " := 1 TO " + M.count + " DO",
    "    IF " + M.devices + "[" + M.index + "] <> 0 THEN",
    ...inner.map(l => "        " + l),
    "    END_IF;",
    "END_FOR;",
  ];
  if (n && ir.decls.some(d => d.name === C.cmdAck)) {
    b.push("(* --- " + cm(N_("Kvitace: Reset všem zařízením (platí pro jejich Execute v tomto cyklu)")) + " --- *)");
    b.push("IF " + C.cmdAck + " THEN", ...loop([M.devices + "[" + M.index + "].Reset();"]).map(l => "    " + l), "END_IF;", "");
  }
  b.push(...(calls.length ? calls.join("\n\n").split("\n").map(l => l.startsWith("    ") ? l.slice(4) : l) : [";"]));
  if (ir.fault) {
    b.push("", "(* --- " + cm(N_("Porucha stroje a kvitace")) + " --- *)");
    if (n) {
      b.push(M.anyFault + " := FALSE;");
      b.push(...loop(["IF " + M.devices + "[" + M.index + "].Fault THEN " + M.anyFault + " := TRUE; END_IF;"]));
      b.push("IF " + M.anyFault + " THEN " + C.machineFault + " := TRUE; END_IF;");
    }
    b.push("IF " + C.cmdAck + (n ? " AND NOT " + M.anyFault : "") + " THEN " + C.machineFault + " := FALSE;" + (ir.fault.resetFaultStep ? " " + C.faultStep + " := 0;" : "") + " END_IF;");
  }
  b.push("", "(* " + stripDia(trx("Volné signály (DI/DO) pro vlastní logiku:")) + " *)");
  b.push(...(free.length ? free.map(l => l.startsWith("    ") ? l.slice(4) : l) : ["(*   " + stripDia(trx("žádné")) + " *)"]));
  return {
    kind: "program", name: "MAIN",
    cmt: [stripDia(trx("hlavní program (generováno PLCdesk)")) + " - " + cm(N_("styl OOP")) + " - " + PLAT[plat].name],
    blocks, body: b.join("\n"), methods: [], props: [],
  };
}

/* ================================================================ zápis: ST výpis */

const KW: Record<OopBlock["kind"], string> = { in: "VAR_INPUT", out: "VAR_OUTPUT", inout: "VAR_IN_OUT", var: "VAR", const: "VAR CONSTANT" };
function varLine(v: OopVar): string {
  const head = v.name + " : " + v.type + (v.init !== undefined ? " := " + v.init : "") + ";";
  return "    " + (v.cmt ? head.padEnd(24) + "  (* " + v.cmt + " *)" : head);
}
function blocksText(bs: OopBlock[]): string[] {
  return bs.flatMap(b => [KW[b.kind], ...b.vars.map(varLine), "END_VAR"]);
}
const indent = (s: string, n = 4) => s.split("\n").map(l => l ? " ".repeat(n) + l : l).join("\n");

/** Deklarační část objektu (hlavička, komentář, proměnné) — totéž v ST výpisu, TcPOU i PLCopen. */
export function pouDecl(p: OopPou): string {
  const head = p.kind === "interface" ? "INTERFACE " + p.name
    : (p.kind === "program" ? "PROGRAM " : "FUNCTION_BLOCK " + (p.abstract ? "ABSTRACT " : "")) + p.name
      + (p.extends ? " EXTENDS " + p.extends : "") + (p.implements && p.implements.length ? " IMPLEMENTS " + p.implements.join(", ") : "");
  return [head, ...(p.notes || []).map(c => "(* " + c + " *)"), ...cmtBlock(p.cmt), ...blocksText(p.blocks)].join("\n");
}
/** Víceřádkový komentář (* … *) z řádků (zalomení + 3 mezery, jako šablony). */
function cmtBlock(lines: string[] | undefined): string[] { return lines && lines.length ? ["(* " + lines.join("\n   ") + " *)"] : []; }
export function methodDecl(m: OopMethod, inItf = false): string {
  const head = "METHOD " + (inItf ? "" : (m.access || "PUBLIC") + " " + (m.abstract ? "ABSTRACT " : "")) + m.name + (m.ret ? " : " + m.ret : "");
  return [head, ...cmtBlock(m.cmt), ...blocksText(m.blocks)].join("\n");
}
export function propDecl(pr: OopProp, inItf = false): string {
  return (pr.pragma && !inItf ? pr.pragma + "\n" : "") + "PROPERTY " + (inItf ? "" : (pr.access || "PUBLIC") + " ") + pr.name + " : " + pr.type;
}
/**
 * Objekt výpisu jako deklarační texty a těla — společná podoba ST výpisu, TcPOU (Declaration /
 * Implementation) a PLCopen XML (InterfaceAsPlainText / body). Emulátor ji sestaví z TcPOU / XML
 * a výpis porovná s ST souborem (`oopListing`).
 */
export interface OopListingObj {
  kind: OopPou["kind"];
  decl: string;
  body: string;
  methods: Array<{ decl: string; body: string }>;
  props: Array<{ decl: string; get: string }>;
}
export function listingObj(p: OopPou): OopListingObj {
  const itf = p.kind === "interface";
  return {
    kind: p.kind, decl: pouDecl(p), body: itf ? "" : p.body,
    methods: p.methods.map(m => ({ decl: methodDecl(m, itf), body: itf ? "" : m.body })),
    props: p.props.map(pr => ({ decl: propDecl(pr, itf), get: itf ? "" : pr.get })),
  };
}
/** Výpis objektu v ST (tělo bloku bez odsazení, těla metod a GET odsazená o 4). */
export function oopListing(o: OopListingObj): string {
  const parts: string[] = [o.decl];
  if (o.body) parts.push("", o.body);
  for (const m of o.methods) parts.push("", m.decl + (m.body ? "\n" + indent(m.body) : "") + "\nEND_METHOD");
  for (const pr of o.props) parts.push("", pr.decl + "\nGET" + (pr.get ? "\n" + indent(pr.get) : "") + "\nEND_GET\nEND_PROPERTY");
  parts.push((o.methods.length || o.props.length ? "\n" : "") + (o.kind === "interface" ? "END_INTERFACE" : o.kind === "program" ? "END_PROGRAM" : "END_FUNCTION_BLOCK"));
  return parts.join("\n");
}
export function pouText(p: OopPou): string { return oopListing(listingObj(p)); }

/* ================================================================ zápis: TwinCAT */

/** Trvalé Id objektu TwinCAT (deterministické — stejný výstup pro stejný projekt). */
const tcId = (path: string) => "{" + derivedGuid("4c9f1e2a-plcdesk-oop", path) + "}";
const cdata = (s: string) => "<![CDATA[" + s.replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";

/** Soubor .TcPOU (FB / PROGRAM) nebo .TcIO (INTERFACE) — struktura podle reálných souborů (TcUnit, AixOCAT). */
export function tcFile(p: OopPou): string {
  const itf = p.kind === "interface";
  const tag = itf ? "Itf" : "POU";
  let x = '<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n';
  x += "  <" + tag + ' Name="' + esc(p.name) + '" Id="' + tcId(p.name) + '"' + (itf ? "" : ' SpecialFunc="None"') + ">\n";
  x += "    <Declaration>" + cdata(pouDecl(p)) + "</Declaration>\n";
  if (!itf) x += "    <Implementation>\n      <ST>" + cdata(p.body) + "</ST>\n    </Implementation>\n";
  for (const m of p.methods) {
    x += '    <Method Name="' + esc(m.name) + '" Id="' + tcId(p.name + "." + m.name) + '">\n';
    x += "      <Declaration>" + cdata(methodDecl(m, itf)) + "</Declaration>\n";
    if (!itf) x += "      <Implementation>\n        <ST>" + cdata(m.body) + "</ST>\n      </Implementation>\n";
    x += "    </Method>\n";
  }
  for (const pr of p.props) {
    x += '    <Property Name="' + esc(pr.name) + '" Id="' + tcId(p.name + "." + pr.name) + '">\n';
    x += "      <Declaration>" + cdata(propDecl(pr, itf)) + "</Declaration>\n";
    x += '      <Get Name="Get" Id="' + tcId(p.name + "." + pr.name + ".Get") + '">\n        <Declaration>' + cdata("") + "</Declaration>\n";
    if (!itf) x += "        <Implementation>\n          <ST>" + cdata(pr.get) + "</ST>\n        </Implementation>\n";
    x += "      </Get>\n    </Property>\n";
  }
  return x + "  </" + tag + ">\n</TcPlcObject>\n";
}
/** Soubor .TcGVL (globální proměnné I/O). */
export function tcGvl(name: string, decl: string): string {
  return '<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <GVL Name="' + esc(name) + '" Id="' + tcId(name) + '">\n    <Declaration>'
    + cdata(decl) + "</Declaration>\n  </GVL>\n</TcPlcObject>\n";
}

/* ================================================================ zápis: PLCopen XML */

const ELEMENTARY = new Set(["BOOL", "BYTE", "WORD", "DWORD", "SINT", "INT", "DINT", "LINT", "UINT", "UDINT", "REAL", "LREAL", "TIME", "STRING"]);
function typeXml(t: string, consts: Record<string, number>): string {
  const a = t.match(/^ARRAY\[(\w+)\.\.(\w+)\] OF (\w+)$/);
  if (a) {
    const num = (s: string) => /^\d+$/.test(s) ? s : String(consts[s] ?? 0);
    return '<array><dimension lower="' + num(a[1]) + '" upper="' + num(a[2]) + '" /><baseType>' + typeXml(a[3], consts) + "</baseType></array>";
  }
  const u = t.toUpperCase();
  return ELEMENTARY.has(u) ? "<" + u + " />" : '<derived name="' + esc(t) + '" />';
}
const PO_TAG: Record<OopBlock["kind"], string> = { in: "inputVars", out: "outputVars", inout: "inOutVars", var: "localVars", const: "localVars" };
function varsXml(bs: OopBlock[], ind: string, consts: Record<string, number>): string {
  return bs.map(b => ind + "<" + PO_TAG[b.kind] + (b.kind === "const" ? ' constant="true"' : "") + ">\n" + b.vars.map(v =>
    ind + '  <variable name="' + esc(v.name) + '">\n' + ind + "    <type>" + typeXml(v.type, consts) + "</type>\n"
    + (v.init !== undefined ? ind + '    <initialValue><simpleValue value="' + esc(v.init) + '" /></initialValue>\n' : "")
    + (v.cmt ? ind + '    <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">' + esc(v.cmt) + "</xhtml></documentation>\n" : "")
    + ind + "  </variable>\n").join("") + ind + "</" + PO_TAG[b.kind] + ">\n").join("");
}
const NS = "http://www.3s-software.com/plcopenxml/";
const xhtml = (s: string) => '<xhtml xmlns="http://www.w3.org/1999/xhtml">' + esc(s) + "</xhtml>";
const objId = (path: string) => derivedGuid("4c9f1e2a-plcdesk-oop", "plcopen:" + path);
const plain = (ind: string, decl: string) => ind + '<data name="' + NS + 'interfaceasplaintext" handleUnknown="implementation"><InterfaceAsPlainText>' + xhtml(decl) + "</InterfaceAsPlainText></data>\n";

function pouXml(p: OopPou, consts: Record<string, number>): string {
  const I = "      ";
  let x = '    <pou name="' + esc(p.name) + '" pouType="' + (p.kind === "program" ? "program" : "functionBlock") + '">\n';
  x += "      <interface>\n" + varsXml(p.blocks, I + "  ", consts);
  const inh = (p.extends ? "<Extends>" + esc(p.extends) + "</Extends>" : "") + (p.implements || []).map(i => "<Implements>" + esc(i) + "</Implements>").join("");
  x += I + "  <addData>\n";
  if (inh) x += I + '    <data name="' + NS + 'pouinheritance" handleUnknown="implementation"><Inheritance>' + inh + "</Inheritance></data>\n";
  x += plain(I + "    ", pouDecl(p));
  x += I + "  </addData>\n" + I + "</interface>\n";
  x += I + "<body>\n" + I + "  <ST>\n" + I + "    " + xhtml(p.body) + "\n" + I + "  </ST>\n" + I + "</body>\n";
  x += I + "<addData>\n";
  for (const m of p.methods) {
    x += I + '  <data name="' + NS + 'method" handleUnknown="implementation">\n';
    x += I + '    <Method name="' + esc(m.name) + '" ObjectId="' + objId(p.name + "." + m.name) + '">\n';
    x += I + "      <interface>\n" + (m.ret ? I + "        <returnType>" + typeXml(m.ret, consts) + "</returnType>\n" : "") + varsXml(m.blocks, I + "        ", consts) + I + "      </interface>\n";
    x += I + "      <body>\n" + I + "        <ST>" + xhtml(m.body) + "</ST>\n" + I + "      </body>\n";
    x += I + "      <addData>\n" + plain(I + "        ", methodDecl(m)) + I + "      </addData>\n";
    x += I + "    </Method>\n" + I + "  </data>\n";
  }
  for (const pr of p.props) {
    x += I + '  <data name="' + NS + 'property" handleUnknown="implementation">\n';
    x += I + '    <Property name="' + esc(pr.name) + '" ObjectId="' + objId(p.name + "." + pr.name) + '">\n';
    x += I + "      <interface>\n" + I + "        <returnType>" + typeXml(pr.type, consts) + "</returnType>\n" + I + "      </interface>\n";
    x += I + "      <GetAccessor>\n" + I + "        <interface />\n" + I + "        <body>\n" + I + "          <ST>" + xhtml(pr.get) + "</ST>\n" + I + "        </body>\n" + I + "        <addData />\n" + I + "      </GetAccessor>\n";
    x += I + "      <addData>\n" + plain(I + "        ", propDecl(pr)) + I + "      </addData>\n";
    x += I + "    </Property>\n" + I + "  </data>\n";
  }
  x += I + '  <data name="' + NS + 'objectid" handleUnknown="discard"><ObjectId>' + objId(p.name) + "</ObjectId></data>\n";
  return x + I + "</addData>\n    </pou>\n";
}
function itfXml(p: OopPou): string {
  const I = "      ";
  let x = I + '<data name="' + NS + 'interface" handleUnknown="implementation">\n';
  x += I + '  <Interface name="' + esc(p.name) + '" ObjectId="' + objId(p.name) + '">\n';
  if (p.methods.length) {
    x += I + "    <Methods>\n";
    for (const m of p.methods) x += I + '      <Method name="' + esc(m.name) + '" ObjectId="' + objId(p.name + "." + m.name) + '">\n' + I + "        <interface />\n"
      + I + "        <addData>\n" + plain(I + "          ", methodDecl(m, true)) + I + "        </addData>\n" + I + "      </Method>\n";
    x += I + "    </Methods>\n";
  }
  if (p.props.length) {
    x += I + "    <Properties>\n";
    for (const pr of p.props) x += I + '      <Property name="' + esc(pr.name) + '" ObjectId="' + objId(p.name + "." + pr.name) + '">\n'
      + I + "        <interface><returnType>" + typeXml(pr.type, {}) + "</returnType></interface>\n" + I + "        <GetAccessor />\n"
      + I + "        <addData>\n" + plain(I + "          ", propDecl(pr, true)) + I + "        </addData>\n" + I + "      </Property>\n";
    x += I + "    </Properties>\n";
  }
  x += I + "    <addData>\n" + plain(I + "      ", pouDecl(p)) + I + "    </addData>\n";
  return x + I + "  </Interface>\n" + I + "</data>\n";
}

/**
 * PLCopen XML (TC6 v2.01, namespace tc6_0200) s rozšířením CODESYS pro OOP: dědičnost
 * (`pouinheritance`), metody (`method`), vlastnosti (`property`), rozhraní (`interface`,
 * v addData projektu) a textové deklarace (`interfaceasplaintext` — nese ABSTRACT / přístup,
 * pro které schéma strukturu nemá). NEOVĚŘENO importem v CODESYS / TwinCAT.
 */
export function genPLCopenOopXML(prj: Project, plat: PlatformKey, prog: OopProgram = oopProgram(prj, plat)): string {
  const now = new Date().toISOString().slice(0, 19);
  const consts: Record<string, number> = {};
  for (const p of prog.pous) for (const b of p.blocks) if (b.kind === "const") for (const v of b.vars) if (/^\d+$/.test(v.init || "")) consts[v.name] = +v.init!;
  let gvl = "";
  for (const e of prj.io) {
    const at = addrFor(plat, e);
    gvl += '            <variable name="' + esc(e.tag) + '"' + (at ? ' address="' + esc(at) + '"' : "") + ">\n              <type>" + typeXml(dtFor(e), {}) + "</type>\n"
      + (e.cmt ? '              <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">' + esc(e.cmt) + "</xhtml></documentation>\n" : "") + "            </variable>\n";
  }
  const itfs = prog.pous.filter(p => p.kind === "interface");
  return `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0200">
  <fileHeader companyName="PLCdesk" productName="PLCdesk" productVersion="0.1" creationDateTime="${now}" />
  <contentHeader name="${esc(prj.meta.name || "PLCdesk-Project")}" modificationDateTime="${now}">
    <coordinateInfo>
      <fbd><scaling x="1" y="1" /></fbd>
      <ld><scaling x="1" y="1" /></ld>
      <sfc><scaling x="1" y="1" /></sfc>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes />
    <pous>
${prog.pous.filter(p => p.kind !== "interface").map(p => pouXml(p, consts)).join("")}    </pous>
  </types>
  <instances>
    <configurations>
      <configuration name="Default">
        <resource name="Application">
          <task name="MainTask" interval="PT0.010S" priority="1">
            <pouInstance name="MAIN" typeName="MAIN" />
          </task>
          <globalVars name="GVL_IO">
${gvl}          </globalVars>
        </resource>
      </configuration>
    </configurations>
  </instances>
  <addData>
${itfs.map(itfXml).join("")}  </addData>
</project>
`;
}

/* ================================================================ README a soubory */

/** README — oddíl o stylu OOP (dokument pro člověka → `tr`). */
export function oopReadme(prj: Project, plat: PlatformKey): string {
  const tc = plat === "beckhoff";
  const list = (title: string, ...items: string[]) => title + "\n" + items.map(s => "- " + s).join("\n");
  return list(tr("STYL KÓDU OOP (rozhraní, dědičnost, vlastnosti)"),
    tr(`Chování je stejné jako v klasickém stylu: třídy stojí na stejných šablonách bloků a stejné
  mezivrstvě programu, mění se jen zápis. Emulátor PLCdesk přeloží OOP kód a spustí ho ve stejných
  scénářích jako klasický kód a simulaci (shoda scan po scanu). Emulátor není překladač výrobce.`),
    tr(`Třídy: INTERFACE I_Device (METHOD Execute, METHOD Reset, PROPERTY Fault / Status / Busy jen GET),
  FUNCTION_BLOCK ABSTRACT FB_DeviceBase IMPLEMENTS I_Device (krok, porucha, stav 16#0000 / 16#8001 /
  16#8002, kvitace; Execute volá abstraktní Cycle), FB_Motor / FB_Valve / FB_AnalogIn / FB_AnalogOut
  EXTENDS FB_DeviceBase IMPLEMENTS I_Device (Cycle = stavový automat ze šablony), FB_Sequence (sekvence
  jedním CASE) a MAIN (instance, pole odkazů aDevices pro kvitaci a souhrn poruch v cyklu FOR).`),
    tr(`Zařazení: MAIN do cyklického tasku 10 ms (Task Configuration → MainTask: Cyclic, T#10MS) a zapni
  watchdog tasku (čas např. 3× interval). Časovače TON v blocích měří systémový čas — každý blok musí
  dostat Execute v každém cyklu; rozlišení hlídacích časů je interval tasku.`),
    tr(`ABSTRACT vyžaduje CODESYS V3.5 SP13 a novější, resp. TwinCAT 3.1 Build 4024 a novější. Ve starší
  verzi smaž slovo ABSTRACT u FB_DeviceBase a u metody Cycle (Cycle pak zůstane s prázdnou implementací).`),
    tr(`Vlastnosti nesou {attribute 'monitoring' := 'call'} — jdou sledovat online i z HMI (instM1.Fault,
  instM1.Status, instM1.Busy místo výstupů error / status / busy klasického stylu). Vstup poruchy
  motoru se jmenuje faultIn (Fault je vlastnost rozhraní; CODESYS nerozlišuje velikost písmen).`),
    tr(`Robustnost: žádné ukazatele, __NEW ani dynamická paměť; pole aDevices má mez N_DEVICES (konstanta)
  a FOR jde jen v jejích mezích; žádné WHILE; před každým voláním přes odkaz na rozhraní se ověří
  odkaz <> 0. Jména instancí (instM1…) a proměnných řízení (modeAuto, cmdAck…) zůstávají — jsou
  rozhraním k HMI; maďarská notace (fb, b, i, r, t, a, w) je jen u vnitřních proměnných.`),
    tc
      ? tr(`Import do TwinCAT 3: soubory I_Device.TcIO, FB_*.TcPOU, MAIN.TcPOU a GVL_IO.TcGVL — v PLC projektu
  pravý klik na složku POUs → Add → Existing Item… (NEOVĚŘENO importem, struktura podle reálných
  souborů TwinCAT). Druhá cesta: PLCopen_Import.xml (Import PLCopenXML). Ruční cesta: ST soubory
  jsou výpis — každou METHOD / PROPERTY přidej jako objekt pod blok.`)
      : tr(`Import: PLCopen_Import.xml — Project → Import PLCopenXML. OOP části (metody, vlastnosti,
  rozhraní, EXTENDS / IMPLEMENTS) jsou v rozšíření addData podle exportu CODESYS V3.5 SP20 —
  NEOVĚŘENO importem. Ruční cesta: ST soubory jsou výpis — rozhraní založ jako objekt Interface,
  každou METHOD / PROPERTY přidej jako objekt pod blok (Add Object → Method / Property).`));
}

/** Soubory programu ve stylu OOP (rodina CODESYS). */
export function genForOop(prj: Project, plat: PlatformKey): Record<string, string> {
  const prog = oopProgram(prj, plat);
  const files: Record<string, string> = {};
  const tf = genTagFile(prj, plat);
  files[tf.name] = tf.body;
  const hdr = (name: string, what: string) => "(* " + name + " - " + cmtSafe(trx(what)) + " - " + PLAT[plat].name + " *)\n";
  const libTxt = prog.library.length ? prog.library.map(p => trComments(pouText(p), stripDia)).join("\n\n")
    : "(* " + cmtSafe(trx("žádné instancované třídy zařízení")) + " *)";
  const libHead = codeLibrary(prj, plat).header.map(l => "(* " + cmtSafe(l) + " *)").join("\n");
  files["Gen_Library.st"] = (libHead ? libHead + "\n" : "") + hdr("Gen_Library.st", N_("knihovna tříd OOP (generováno PLCdesk)")) + "\n" + libTxt + "\n";
  if (prog.seq) files[OOP_SEQ + ".st"] = hdr(OOP_SEQ + ".st", N_("sekvence stroje, styl OOP (generováno PLCdesk)")) + "\n" + pouText(prog.seq) + "\n";
  files["MAIN.st"] = (libHead ? libHead + "\n" : "") + pouText(prog.main);
  files["PLCopen_Import.xml"] = genPLCopenOopXML(prj, plat, translated(prog));
  if (plat === "beckhoff") {
    for (const p of translated(prog).pous) files[p.name + (p.kind === "interface" ? ".TcIO" : ".TcPOU")] = tcFile(p);
    files["GVL_IO.TcGVL"] = tcGvl("GVL_IO", tf.body);
  }
  files["README.txt"] = genReadme(prj, plat) + "\n\n" + oopReadme(prj, plat);
  return files;
}

/** Model s přeloženými komentáři šablon (tělo Cycle) — XML a TcPOU nesou totéž co ST výpis. */
function translated(prog: OopProgram): OopProgram {
  const tx = (s: string) => trComments(s, stripDia);
  const txc = (lines: string[] | undefined) => lines && lines.length ? tx("(* " + lines.join("\n   ") + " *)").replace(/^\(\* | \*\)$/g, "").split("\n   ") : lines;
  const pous = prog.pous.map(p => !prog.library.includes(p) ? p : {
    ...p, cmt: txc(p.cmt)!,
    methods: p.methods.map(m => ({ ...m, body: tx(m.body), cmt: txc(m.cmt) })),
  });
  return { ...prog, pous };
}

/* ================================================================ diagram tříd (SVG) */

/**
 * Diagram tříd programu (zjednodušené UML) pro softwarovou dokumentaci: rozhraní, abstraktní
 * základ, třídy zařízení (realizace / dědičnost), MAIN s polem odkazů (agregace) a FB_Sequence
 * (kompozice). Atributy: + vstup / výstup, - vnitřní proměnná; operace: + PUBLIC, # PROTECTED.
 */
export function oopClassSvg(prj: Project, plat: PlatformKey = "codesys"): string {
  const prog = oopProgram(prj, plat);
  const W = 240, LH = 15, GAP = 24, M = 44, MAXF = 9;
  type Box = { p: OopPou; x: number; y: number; w: number; h: number; head: number; fields: string[]; ops: string[]; stereo?: string };
  const boxes: Box[] = [];
  const vis = (k: OopBlock["kind"]) => k === "var" ? "- " : "+ ";
  const short = (t: string) => t.replace(/^ARRAY\[1\.\.(\w+)\] OF /, "ARRAY OF ");
  const mk = (p: OopPou, x: number, y: number): Box => {
    let fields: string[];
    if (p.kind === "program") {
      /* MAIN: instance zařízení souhrnně, pak pole odkazů a pomocné proměnné */
      const vars = p.blocks.flatMap(b => b.kind === "var" ? b.vars : []);
      const inst = vars.filter(v => /^FB_(Motor|Valve|AnalogIn|AnalogOut)$/.test(v.type));
      const byType = new Map<string, number>();
      for (const v of inst) byType.set(v.type, (byType.get(v.type) || 0) + 1);
      fields = [...[...byType].map(([t, n]) => "- inst… : " + t + " (" + n + "×)"),
        ...vars.filter(v => !inst.includes(v) && /^(aDevices|fbSeq|iDev|bAnyFault|enable)$/.test(v.name)).map(v => "- " + v.name + " : " + short(v.type))];
    } else {
      const all = p.blocks.filter(b => b.kind !== "const").flatMap(b => b.vars.map(v => vis(b.kind) + v.name + " : " + v.type));
      fields = all.length > MAXF ? [...all.slice(0, MAXF - 1), "  … (" + (all.length - MAXF + 1) + ")"] : all;
    }
    const ops = [...p.methods.map(m => (m.access === "PROTECTED" ? "# " : "+ ") + m.name + "()" + (m.abstract ? " {abstract}" : "")),
      ...p.props.map(pr => "+ «property» " + pr.name + " : " + pr.type)];
    const stereo = p.kind === "interface" ? "«interface»" : p.abstract ? "«abstract»" : undefined;
    const head = stereo ? 34 : 22;
    const h = head + 6 + Math.max(1, fields.length) * LH + 6 + Math.max(1, ops.length) * LH + 4;
    const b: Box = { p, x, y, w: W, h, head, fields, ops, stereo };
    boxes.push(b);
    return b;
  };
  const lib = prog.library;
  const itf = lib.find(p => p.kind === "interface"), base = lib.find(p => p.name === OOP_BASE);
  const derived = lib.filter(p => p.extends === OOP_BASE);
  const cols = Math.max(derived.length, 2);
  const centerX = M + ((cols - 1) * (W + GAP)) / 2;
  let y = 20;
  const bi = itf ? mk(itf, centerX, y) : undefined;
  if (bi) y += bi.h + 46;
  const bb = base ? mk(base, centerX, y) : undefined;
  if (bb) y += bb.h + 46;
  const bd = derived.map((p, i) => mk(p, M + i * (W + GAP), y));
  if (bd.length) y += Math.max(...bd.map(b => b.h)) + 56;
  const bm = mk(prog.main, M, y);
  const bs = prog.seq ? mk(prog.seq, M + W + GAP + 40, y) : undefined;
  const width = Math.max(...boxes.map(b => b.x + b.w)) + 20, height = Math.max(...boxes.map(b => b.y + b.h)) + 20;
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '" font-family="Consolas, \'DejaVu Sans Mono\', monospace" font-size="11">\n';
  s += "<title>" + esc(tr("Diagram tříd programu (styl OOP)")) + "</title>\n";
  s += "<defs>"
    + '<marker id="tri" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="#fff" stroke="#333"/></marker>'
    + '<marker id="dia" viewBox="0 0 14 8" refX="0" refY="4" markerWidth="14" markerHeight="8" orient="auto"><path d="M0,4 L7,0 L14,4 L7,8 z" fill="#333"/></marker>'
    + '<marker id="odia" viewBox="0 0 14 8" refX="0" refY="4" markerWidth="14" markerHeight="8" orient="auto"><path d="M0,4 L7,0 L14,4 L7,8 z" fill="#fff" stroke="#333"/></marker>'
    + "</defs>\n";
  s += '<rect width="100%" height="100%" fill="#fff"/>\n';
  const path = (pts: Array<[number, number]>, dash: boolean, end: string, start = "") =>
    '<polyline points="' + pts.map(p => p.join(",")).join(" ") + '" fill="none" stroke="#333"' + (dash ? ' stroke-dasharray="5,4"' : "")
    + (end ? ' marker-end="url(#' + end + ')"' : "") + (start ? ' marker-start="url(#' + start + ')"' : "") + "/>\n";
  const label = (x: number, y2: number, t: string, anchor = "start") => '<text x="' + x + '" y="' + y2 + '" fill="#333" text-anchor="' + anchor + '">' + esc(t) + "</text>\n";
  /* realizace rozhraní (čárkovaně) a dědičnost (plně); ze sběrnice nad odvozenými třídami */
  if (bi && bb) s += path([[bb.x + W / 2, bb.y], [bi.x + W / 2, bi.y + bi.h]], true, "tri");
  if (bb && bd.length) {
    const busY = bb.y + bb.h + 22;
    s += path([[bb.x + W / 2, busY], [bb.x + W / 2, bb.y + bb.h]], false, "tri");
    s += path([[bd[0].x + W / 2, busY], [bd[bd.length - 1].x + W / 2, busY]], false, "");
    for (const d of bd) s += path([[d.x + W / 2, d.y], [d.x + W / 2, busY]], false, "");
  }
  /* MAIN → I_Device: pole odkazů (agregace), vedené levým okrajem */
  if (bi) {
    const lx = 18;
    s += path([[bm.x, bm.y + 16], [lx, bm.y + 16], [lx, bi.y + 24], [bi.x, bi.y + 24]], false, "", "");
    s += '<path d="M' + bm.x + "," + (bm.y + 16) + " l-7,-4 l-7,4 l7,4 z" + '" fill="#fff" stroke="#333"/>\n';
    s += label(bi.x - 6, bi.y + 20, "aDevices [1..N_DEVICES]", "end");
    s += '<polyline points="' + (bi.x - 9) + "," + (bi.y + 19) + " " + bi.x + "," + (bi.y + 24) + " " + (bi.x - 9) + "," + (bi.y + 29) + '" fill="none" stroke="#333"/>\n';
  }
  /* MAIN ◆— FB_Sequence (kompozice: instance fbSeq) */
  if (bs) {
    s += path([[bs.x, bs.y + 16], [bm.x + W, bm.y + 16]], false, "", "");
    s += '<path d="M' + (bm.x + W) + "," + (bm.y + 16) + " l7,-4 l7,4 l-7,4 z" + '" fill="#333"/>\n';
    s += label(bm.x + W + 18, bm.y + 11, "fbSeq");
  }
  for (const b of boxes) {
    const fill = b.p.kind === "interface" ? "#eef5ff" : b.p.abstract ? "#f3f3f3" : b.p.kind === "program" ? "#fff7e3" : "#ffffff";
    const cx = b.x + b.w / 2;
    s += '<g data-class="' + esc(b.p.name) + '"><title>' + esc(b.p.name) + "</title>\n";
    s += '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" fill="' + fill + '" stroke="#333"/>\n';
    if (b.stereo) s += '<text x="' + cx + '" y="' + (b.y + 14) + '" text-anchor="middle" fill="#555">' + esc(b.stereo) + "</text>\n";
    s += '<text x="' + cx + '" y="' + (b.y + (b.stereo ? 28 : 16)) + '" text-anchor="middle" font-weight="bold"' + (b.p.abstract ? ' font-style="italic"' : "") + ">" + esc(b.p.name) + "</text>\n";
    let ly = b.y + b.head;
    s += '<line x1="' + b.x + '" y1="' + ly + '" x2="' + (b.x + b.w) + '" y2="' + ly + '" stroke="#333"/>\n';
    ly += 6;
    const text = (t: string) => {
      const cut = t.length > 36 ? t.slice(0, 35) + "…" : t;
      s += '<text x="' + (b.x + 7) + '" y="' + (ly + 10) + '" fill="#222"' + (/\{abstract\}/.test(t) ? ' font-style="italic"' : "") + ">" + esc(cut) + "</text>\n";
      ly += LH;
    };
    if (b.fields.length) b.fields.forEach(text); else ly += LH;
    ly += 3;
    s += '<line x1="' + b.x + '" y1="' + ly + '" x2="' + (b.x + b.w) + '" y2="' + ly + '" stroke="#333"/>\n';
    ly += 3;
    if (b.ops.length) b.ops.forEach(text);
    s += "</g>\n";
  }
  return s + "</svg>\n";
}

/** Projekt má OOP aspoň na jedné své platformě. */
export function oopInProject(prj: Project): PlatformKey | undefined {
  return (prj.platforms || []).find(p => oopActive(prj, p));
}

/** Soubor diagramu tříd v sadě projektu. */
export const OOP_CLASS_SVG = "00_diagram_trid.svg";
