/**
 * PLCdesk — výstup pro Rockwell Studio 5000 Logix Designer (CompactLogix 5380 / ControlLogix 5580).
 *
 * Logix 5000 ST není IEC 61131-3: rutina obsahuje jen příkazy (tagy jsou v databázi tagů),
 * FUNCTION_BLOCK nahrazuje Add-On Instruction, TON v ST není (je TONR nad FBD_TIMER),
 * chybí WORD, převodní funkce INT_TO_REAL… a RETURN. Proto se generuje jeden L5X
 * (dílčí import programu: AOI + tagy + rutina ST) a k tomu tělo rutiny a Tags.csv.
 *
 * Logika se tu NEPÍŠE znovu: AOI vznikají z týchž šablon ST_MOTOR / ST_VENTIL / … přes
 * `parseFbTemplate()` a `lxDialect()`, hlavní rutina z mezivrstvy `buildIR()` (ir.ts) přes
 * společné ST renderery (`renderSeq` / `renderWiring` / `renderFault`, volání bloků jako členy
 * instance — `lxCallIr`), stejné pořadí jako IEC MAIN, tedy i jako simulátor:
 * enable → sekvence → časovače kroků za CASE → instance → porucha stroje.
 *
 * Zdroje: 1756-PM007 (ST), 1756-RM003 (TONR, FBD_TIMER), 1756-PM010 (AOI), 1756-RM014 (L5X, CSV),
 * 5000-UM004 / 5069-UM005 (tagy modulů 5069). Výstup není ověřen importem ve Studiu 5000.
 */
import { Project, IoEntry, Dir, stripDia } from "./model.js";
import {
  parseFbTemplate, trComments, fbTemplate, stCtx, renderSeq, renderWiring, renderFault, enableText,
  freeLine, declNote, cmtSafe, stCallNotes, codeLibrary, portText, type StCtx, type CodeLibrary,
} from "./codegen.js";
import { buildIR, irBlocks, irText, IR_CLASS_ORDER, type IrFb, type IrFbClass } from "./ir.js";
import { tr, trx } from "./i18n.js";

/** Název importovaného programu a jeho hlavní rutiny. */
export const LX_PROGRAM = "PLCdesk";
export const LX_ROUTINE = "MainRoutine";
/** Verze Logix Designeru uvedená v L5X (import do stejné nebo novější verze). */
export const LX_SOFTWARE_REVISION = "32.00";

/* Pozor: logix.ts a codegen.ts se importují navzájem — na úrovni modulu se proto
   nesmí sahat na konstanty z codegen.ts (šablony se berou až uvnitř funkcí). */
/* `lib` = vlastní šablony firemní knihovny, které `codeLibrary` pro Logix pustil (`lxTplProblems`) */
const tplOf = (cls: IrFbClass, lib?: CodeLibrary): string => fbTemplate(cls, "st", lib);
const AOI_OF: Record<string, string> = { Motor: "FB_Motor", Ventil: "FB_Ventil", AnalogIn: "FB_AnalogIn", AnalogOut: "FB_AnalogOut",
  Vfd: "FB_Vfd", PosDrive: "FB_PosDrive", PropValve: "FB_PropValve" };

/** Výchozí hodnoty, které se pro Logix liší od šablony: analogy 5069 dávají REAL 0–100 % (rozsah modulu). */
const LX_INIT: Record<string, string> = { rawMax: "100.0" };

/* ------------------------------------------------------------- pomocné */

/** Čisté ASCII — Studio 5000 je jednobajtové (PM007) a CSV neumí dvoubajtové znaky (RM014). */
export function lxAscii(s: string): string {
  return stripDia(String(s ?? ""))
    .replace(/[—–]/g, "-").replace(/°/g, "deg").replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'")
    .replace(/→/g, "->").replace(/←/g, "<-").replace(/×/g, "x").replace(/µ/g, "u").replace(/±/g, "+/-")
    .replace(/…/g, "...").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/·/g, "-").replace(/ /g, " ")
    .replace(/[^\x00-\x7F]/g, "?");
}

/** Escapování popisu v CSV Logix (RM014): $ → $$, ' → $', " → $Q, nový řádek → $N. */
export function lxCsvEsc(s: string): string {
  return lxAscii(s).replace(/\$/g, "$$$$").replace(/'/g, "$$'").replace(/"/g, "$$Q").replace(/\r?\n/g, "$$N");
}

/** Obsah CDATA: `]]>` uvnitř textu rozdělí na dvě sekce. */
function cdata(s: string): string {
  return "<![CDATA[" + s.replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";
}
const attr = (s: string) => lxAscii(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Číslo jako REAL literál bez exponentu (100 → 100.0). */
function lxReal(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.0";
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}
/** REAL ve tvaru L5K (0.00000000e+000). */
function realL5K(v: unknown): string {
  const n = Number(v) || 0;
  return n.toExponential(8).replace(/e([+-])(\d+)$/, (_m, s: string, d: string) => "e" + s + d.padStart(3, "0"));
}

/** Datový typ Logix pro proměnnou šablony bloku. */
function lxType(cls: string, type: string, name = ""): string {
  if (type === "TON") return "FBD_TIMER";
  if (type === "WORD") return "DINT";                  // 16#8001 se do INT nevejde
  /* 5069: Chxx.Data = REAL — u pohonů fáze 2a jen surové analogy (rawSpeed, rawSp, rawAct, rawMax) */
  if (type === "INT") return cls === "AnalogIn" || cls === "AnalogOut" || (/^raw[A-Z]/.test(name) && (cls === "Vfd" || cls === "PosDrive" || cls === "PropValve")) ? "REAL" : "DINT";
  return type;
}
const BASE = new Set(["BOOL", "SINT", "INT", "DINT", "REAL"]);

/** Výchozí hodnota proměnné šablony (číslo jako text). */
function lxInitOf(name: string, type: string, init: string): string {
  const v = LX_INIT[name] ?? init;
  if (type === "REAL") return lxReal(v || 0);
  if (type === "BOOL") return /^(TRUE|1)$/i.test(v) ? "1" : "0";
  return String(Math.trunc(Number(v) || 0));
}

/** `<DefaultData>` / `<Data>` pro základní typ (L5K + Decorated, jako reálné exporty). */
function dataXml(tag: "Data" | "DefaultData", type: string, value: string, ind: string): string {
  if (!BASE.has(type)) return "";
  const real = type === "REAL";
  const l5k = real ? realL5K(value) : value;
  return ind + "<" + tag + ' Format="L5K">' + cdata(l5k) + "</" + tag + ">\n" +
    ind + "<" + tag + ' Format="Decorated">\n' +
    ind + ' <DataValue DataType="' + type + '" Radix="' + (real ? "Float" : "Decimal") + '" Value="' + value + '"/>\n' +
    ind + "</" + tag + ">\n";
}
const radix = (type: string) => BASE.has(type) ? ' Radix="' + (type === "REAL" ? "Float" : "Decimal") + '"' : "";

/** Části textu mimo komentáře `(* … *)` projde funkcí `fn`; komentáře nechá beze změny. */
function onCode(st: string, fn: (code: string) => string): string {
  return st.split(/(\(\*[\s\S]*?\*\))/).map((part, i) => i % 2 ? part : fn(part)).join("");
}

/** Milisekundy z časového literálu IEC (`T#5S`, `T#1S500MS`, `T#500MS`). */
function litMs(lit: string): number {
  const m = lit.match(/^T#(?:(\d+)S)?(?:(\d+)MS)?$/i);
  return m ? (+(m[1] || 0)) * 1000 + (+(m[2] || 0)) : 0;
}

/**
 * Dialekt Logix 5000 ST nad textem IEC ST z generátoru / šablon:
 * TON → TONR (PRE v ms a TimerEnable PŘED voláním, `.Q` → `.DN`), předčasný RETURN → ELSE,
 * INT_TO_REAL / REAL_TO_INT pryč (převody jsou implicitní), `END_IF;`, TRUE/FALSE → 1/0
 * (příklady PM007 používají 1/0), `IF TRUE THEN x END_IF;` → `x`.
 */
export function lxDialect(st: string): string {
  let b = st;
  const ret = /\n[ \t]*RETURN;[ \t]*\n[ \t]*END_IF;?/;
  const m = b.match(ret);
  if (m && m.index !== undefined) {
    const head = b.slice(0, m.index), rest = b.slice(m.index + m[0].length).trim();
    b = head + "\nELSE\n" + rest.split("\n").map(l => l ? "    " + l : l).join("\n") + "\nEND_IF;";
  }
  return onCode(b, code => code
    .replace(/(\w+)\(IN := ([^\n]*?), PT := (T#\w+)\);/g, (_a, t: string, cond: string, lit: string) =>
      t + ".PRE := " + litMs(lit) + "; " + t + ".TimerEnable := " + cond + "; TONR(" + t + ");")
    .replace(/\b(ton\w*)\.Q\b/g, "$1.DN")
    .replace(/\b(INT_TO_REAL|REAL_TO_INT)\(/g, "(")
    .replace(/END_IF(?!;)/g, "END_IF;")
    .replace(/\bIF TRUE THEN ([^\n]*?) END_IF;/g, "$1")
    .replace(/\bTRUE\b/g, "1").replace(/\bFALSE\b/g, "0"));
}

/* --------------------------------------------------------------- I/O moduly */

/** Předpokládané osazení lokálních slotů (moduly Compact 5000 I/O). */
export interface LxSlot { slot: number; dir: Dir; module: string; first: number; }
const PER: Record<Dir, number> = { DI: 16, DO: 16, AI: 8, AO: 4 };
const CAT: Record<Dir, string> = { DI: "5069-IB16", DO: "5069-OB16", AI: "5069-IF8", AO: "5069-OF4" };

/** Pořadové číslo kanálu z kanonické adresy (%I0.4 → 4, %IW66 → 1); nelze-li odvodit, −1. */
function chanOf(e: IoEntry): number {
  const a = e.addr || "";
  let m: RegExpMatchArray | null;
  if (e.dir === "DI" && (m = a.match(/^%I(\d+)\.([0-7])$/))) return +m[1] * 8 + +m[2];
  if (e.dir === "DO" && (m = a.match(/^%Q(\d+)\.([0-7])$/))) return +m[1] * 8 + +m[2];
  if ((e.dir === "AI" && (m = a.match(/^%IW(\d+)$/))) || (e.dir === "AO" && (m = a.match(/^%QW(\d+)$/)))) {
    const w = +m[1];
    return w >= 64 && w % 2 === 0 ? (w - 64) / 2 : -1;
  }
  return -1;
}

/**
 * Body modulů pro aliasy I/O: z kanonické adresy se odvodí kanál, z něj modul a bod
 * (DI/DO po 16, AI po 8, AO po 4). Sloty se číslují od 1: nejdřív moduly DI, pak DO, AI, AO.
 * Když adresu nejde převést nebo by modulů bylo víc než 31, alias se pro tag negeneruje.
 */
export function lxIoMap(prj: Project): { slots: LxSlot[]; spec: Map<string, string> } {
  const need: Record<Dir, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const e of prj.io) { const c = chanOf(e); if (c >= 0) need[e.dir] = Math.max(need[e.dir], Math.floor(c / PER[e.dir]) + 1); }
  const slots: LxSlot[] = [], base: Record<Dir, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  let next = 1;
  for (const dir of ["DI", "DO", "AI", "AO"] as Dir[]) {
    base[dir] = next;
    for (let i = 0; i < need[dir]; i++) slots.push({ slot: next++, dir, module: CAT[dir], first: i * PER[dir] });
  }
  const spec = new Map<string, string>();
  if (slots.length > 31) return { slots: [], spec };
  for (const e of prj.io) {
    const c = chanOf(e);
    if (c < 0) continue;
    const slot = base[e.dir] + Math.floor(c / PER[e.dir]), pt = String(c % PER[e.dir]).padStart(2, "0");
    const io = e.dir === "DI" || e.dir === "AI" ? "I" : "O";
    spec.set(e.key, "Local:" + slot + ":" + io + "." + (e.dir === "DI" || e.dir === "DO" ? "Pt" : "Ch") + pt + ".Data");
  }
  return { slots, spec };
}

/** Osazení slotů jedním řádkem (ASCII, bez jazykových slov): „1: 5069-IB16 (DI 0-15), 2: …". */
export function lxSlotText(prj: Project): string {
  return lxIoMap(prj).slots.map(s => s.slot + ": " + s.module + " (" + s.dir + " " + s.first + "-" + (s.first + PER[s.dir] - 1) + ")").join(", ");
}

/** Datový typ I/O tagu v Logix (analogy 5069 = REAL v jednotkách modulu). */
export function lxIoType(e: IoEntry): string {
  return e.dir === "AI" || e.dir === "AO" ? "REAL" : "BOOL";
}

/* ------------------------------------------------------------- tagy programu */

export interface LxTag { name: string; type: string; desc: string; }

/** Programové tagy: uvolnění, řízení stroje (deklarace IR) a instance AOI. */
export function lxProgramTags(prj: Project): LxTag[] {
  const ir = buildIR(prj);
  const out: LxTag[] = [{ name: "enable", type: "BOOL", desc: trx("centrální uvolnění (E-stop TRUE = v pořádku)") }];
  for (const d of ir.decls) out.push({ name: d.name, type: d.type === "TON" ? "FBD_TIMER" : d.type === "INT" ? "DINT" : d.type, desc: cmtSafe(declNote(d)).trim() });
  for (const b of irBlocks(ir)) out.push({ name: b.inst, type: b.fb, desc: "" });
  return out;
}

/* ---------------------------------------------------------- hlavní rutina */

/**
 * Volání instance bloku v Logixu: AOI se volá s instancí a parametry jsou její členy —
 * `instM1.enable := …; FB_Motor(instM1); M1_outRun := instM1.outRun;` (IEC `instM1(… => …)`
 * Logix nemá). Komentáře zůstávají u vstupu, ke kterému patří (náhrada chybějícího hlášení,
 * žádaná hodnota), komentář celého volání za voláním. Nezapojené vstupy s výchozí hodnotou se
 * přiřadí výslovně (nezávisí na datech tagu po importu); nezapojené výstupy se nečtou.
 */
function lxCallIr(b: IrFb, c: StCtx, lib?: CodeLibrary): string {
  const ind = "    ";
  const notes = stCallNotes(b, c);
  const ins: string[] = [], outs: string[] = [], wired = new Set<string>();
  for (const p of b.inputs) {
    wired.add(p.name);
    const n = notes.port[p.name];
    ins.push(ind + b.inst + "." + p.name + " := " + portText(p, c) + ";" + (n !== undefined ? " " + c.cm(n) : ""));
  }
  for (const o of b.outputs) if (o.tag) outs.push(ind + c.R(o.tag) + " := " + b.inst + "." + o.name + ";");
  for (const v of parseFbTemplate(tplOf(b.cls, lib)).vars) {
    if (v.kind === "in" && !wired.has(v.name) && (v.init || LX_INIT[v.name]))
      ins.push(ind + b.inst + "." + v.name + " := " + lxInitOf(v.name, lxType(b.cls, v.type, v.name), v.init) + ";");
  }
  const callLine = ind + b.fb + "(" + b.inst + ");" + (notes.after !== undefined ? " " + c.cm(notes.after) : "");
  /* renderWiring odsadí první řádek volání sám (jako `instM1(…` u IEC) */
  return [...ins, callLine, ...outs].join("\n").slice(ind.length);
}

/**
 * Tělo hlavní rutiny MainRoutine (Logix ST, jen příkazy) — k ručnímu vložení do ST rutiny;
 * totéž je v L5X. Tagy jsou v L5X (programové + I/O) a v Tags.csv.
 */
export function genLogixRoutine(prj: Project): string {
  const ir = buildIR(prj), c = stCtx("rockwell"), lib = codeLibrary(prj, "rockwell");
  const { spec } = lxIoMap(prj);
  const { calls, free } = renderWiring(ir, c, {
    call: b => lxCallIr(b, c, lib),
    /* volné signály: místo adres Siemens bod modulu (alias), pokud jde odvodit */
    free: e => {
      const s = spec.get(e.key);
      return freeLine(c, e).replace(/\(\*\s+%[IQ]W?\d+(?:\.\d+)?\s*/, "(*   ").replace(/\s*\*\)$/, (s ? "  [" + s + "]" : "") + " *)");
    },
  });
  const fault = renderFault(ir, c);
  const head = lib.header.map(l => "(* " + cmtSafe(l) + " *)\n").join("");
  const body = `${head}(* ${trx("MainRoutine - logika stroje pro Rockwell Logix 5000 (ST), generováno PLCdesk.")}
   ${trx("Jen příkazy: tagy a Add-On Instructions jsou v PLCdesk_Program.L5X (nebo Tags.csv).")}
   ${trx("Návrh k revizi — E-stop je jen informativní signál, bezpečnostní funkce patří do safety obvodu.")} *)

    enable := ${enableText(ir, c)};

${renderSeq(ir, c)}${calls.join("\n\n")}${fault ? "\n\n" + fault.trimEnd() : ""}

    (* ${trx("Volné signály (DI/DO) pro vlastní logiku:")} *)
${free.join("\n") || "    (*   " + trx("žádné") + " *)"}
`;
  return lxAscii(lxDialect(body));
}

/* ------------------------------------------------------------------ AOI */

function aoiXml(cls: IrFbClass, lib?: CodeLibrary): string {
  const tpl = tplOf(cls, lib)!, name = AOI_OF[cls];
  const { vars, body } = parseFbTemplate(tpl);
  const head = (tpl.match(/\(\*([\s\S]*?)\*\)/) || ["", ""])[0];
  const desc = trComments(head, stripDia).replace(/^\(\*\s*|\s*\*\)$/g, "").replace(/\s*\n\s*/g, " ");
  const I = "      ";
  let x = '    <AddOnInstructionDefinition Use="Context" Name="' + name + '" Revision="1.0" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" SoftwareRevision="v' + LX_SOFTWARE_REVISION + '">\n';
  x += I + "<Description>" + cdata(lxAscii(desc) + " (PLCdesk)") + "</Description>\n";
  x += I + "<Parameters>\n";
  x += I + ' <Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">\n' +
    I + "  <Description>" + cdata("Enable Input - System Defined Parameter") + "</Description>\n" + I + " </Parameter>\n";
  x += I + ' <Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">\n' +
    I + "  <Description>" + cdata("Enable Output - System Defined Parameter") + "</Description>\n" + I + " </Parameter>\n";
  for (const v of vars.filter(v => v.kind !== "var")) {
    const t = lxType(cls, v.type, v.name), out = v.kind === "out";
    x += I + ' <Parameter Name="' + v.name + '" TagType="Base" DataType="' + t + '" Usage="' + (out ? "Output" : "Input") + '"' + radix(t) +
      ' Required="false" Visible="true" ExternalAccess="' + (out ? "Read Only" : "Read/Write") + '">\n' +
      dataXml("DefaultData", t, lxInitOf(v.name, t, v.init), I + "  ") + I + " </Parameter>\n";
  }
  x += I + "</Parameters>\n" + I + "<LocalTags>\n";
  for (const v of vars.filter(v => v.kind === "var")) {
    const t = lxType(cls, v.type, v.name);
    x += I + ' <LocalTag Name="' + v.name + '" DataType="' + t + '"' + radix(t) + ' ExternalAccess="None">\n' +
      dataXml("DefaultData", t, lxInitOf(v.name, t, v.init), I + "  ") + I + " </LocalTag>\n";
  }
  x += I + "</LocalTags>\n" + I + "<Routines>\n" + I + ' <Routine Name="Logic" Type="ST">\n';
  const st = lxAscii(lxDialect(trComments(body, stripDia)));
  x += stXml(st, I + "  ");
  x += I + " </Routine>\n" + I + "</Routines>\n    </AddOnInstructionDefinition>\n";
  return x;
}

function stXml(st: string, ind: string): string {
  const lines = st.replace(/\s+$/, "").split("\n");
  return ind + "<STContent>\n" + lines.map((l, n) => ind + ' <Line Number="' + n + '">' + cdata(l) + "</Line>\n").join("") + ind + "</STContent>\n";
}

function tagXml(t: LxTag, ind: string): string {
  const base = BASE.has(t.type);
  return ind + '<Tag Name="' + t.name + '" TagType="Base" DataType="' + t.type + '"' + radix(t.type) + (base ? ' Constant="false"' : "") + ' ExternalAccess="Read/Write">\n' +
    (t.desc ? ind + " <Description>" + cdata(lxAscii(t.desc)) + "</Description>\n" : "") +
    dataXml("Data", t.type, t.type === "REAL" ? "0.0" : "0", ind + " ") + ind + "</Tag>\n";
}

/**
 * PLCdesk_Program.L5X — dílčí import programu (MainTask → Add → Import Program):
 * Add-On Instructions použitých tříd, I/O tagy (controller scope, BOOL / REAL),
 * program PLCdesk s programovými tagy a rutinou MainRoutine (ST).
 * Struktura podle 1756-RM014 a reálných exportů; Rockwell nezveřejňuje XSD → neověřeno importem.
 */
export function genRockwellL5X(prj: Project): string {
  const classes = new Set(prj.devices.map(d => d.cls));
  const { spec } = lxIoMap(prj);
  const lib = codeLibrary(prj, "rockwell");
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  x += "<!-- " + attr(trx("PLCdesk: návrh k revizi, neověřeno importem ve Studiu 5000.")).replace(/--/g, "- -") + " -->\n";
  x += '<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="' + LX_SOFTWARE_REVISION + '" TargetName="' + LX_PROGRAM +
    '" TargetType="Program" TargetClass="Standard" ContainsContext="true" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">\n';
  x += '<Controller Use="Context" Name="' + LX_PROGRAM + '">\n';
  x += '  <DataTypes Use="Context">\n  </DataTypes>\n';
  x += '  <AddOnInstructionDefinitions Use="Context">\n';
  for (const c of IR_CLASS_ORDER) if (classes.has(c)) x += aoiXml(c, lib);
  x += "  </AddOnInstructionDefinitions>\n";
  x += '  <Tags Use="Context">\n';
  for (const e of prj.io) {
    const s = spec.get(e.key);
    x += tagXml({ name: e.tag, type: lxIoType(e), desc: (e.cmt || "") + (s ? " [" + s + "]" : "") }, "    ");
  }
  x += "  </Tags>\n";
  x += '  <Programs Use="Context">\n';
  x += '    <Program Use="Target" Name="' + LX_PROGRAM + '" TestEdits="false" MainRoutineName="' + LX_ROUTINE + '" Disabled="false" UseAsFolder="false">\n';
  x += "      <Description>" + cdata(lxAscii(prj.meta.name || "PLCdesk") + " - PLCdesk") + "</Description>\n";
  x += "      <Tags>\n";
  for (const t of lxProgramTags(prj)) x += tagXml(t, "        ");
  x += "      </Tags>\n      <Routines>\n";
  x += '        <Routine Name="' + LX_ROUTINE + '" Type="ST">\n';
  x += stXml(genLogixRoutine(prj), "          ");
  x += "        </Routine>\n      </Routines>\n    </Program>\n  </Programs>\n</Controller>\n</RSLogix5000Content>\n";
  return x;
}

/* ---------------------------------------------------- safety program (GuardLogix) */

/** Příčka (rung) safety rutiny: komentář a neutrální text RLL (`XIC(a)OTE(b);`). */
export interface LxSafetyRung { comment: string; text: string }
/** Tag safety programu; `io` = zástupce kanálu bezpečnostního modulu (controller scope). */
export interface LxSafetyTag { name: string; type: string; desc: string; io?: boolean }

/**
 * PLCdesk_Safety.L5X — dílčí import SAFETY programu (Safety Task → Add → Import Program):
 * program s `Class="Safety"`, safety tagy a rutina SafetyRoutine v ladderu (v safety tasku je jen
 * RLL; FBD a ST bezpečnostní instrukce nemají). Obsah (DCS, DCSTL, THRSe, CROUT…) skládá
 * safety_prog.ts jen pro schválené bezpečnostní funkce. Podpis safety tasku a safety-lock se
 * v L5X jen exportují, při importu se ignorují — vznikají až v Logix Designeru (1756-RM084).
 * Struktura podle RM014 / RM084; neověřeno importem ve Studiu 5000. Výstup je čisté ASCII.
 */
export function genRockwellSafetyL5X(o: { name: string; description: string; banner: string; tags: LxSafetyTag[]; rungs: LxSafetyRung[] }): string {
  const nm = o.name.replace(/[^A-Za-z0-9_]/g, "_");
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  x += "<!-- " + attr(o.banner).replace(/--/g, "- -") + " -->\n";
  x += '<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="' + LX_SOFTWARE_REVISION + '" TargetName="' + nm +
    '" TargetType="Program" TargetClass="Safety" ContainsContext="true" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">\n';
  x += '<Controller Use="Context" Name="' + nm + '">\n';
  x += '  <DataTypes Use="Context">\n  </DataTypes>\n';
  x += '  <Tags Use="Context">\n';
  for (const t of o.tags.filter(t => t.io)) x += safetyTagXml(t, "    ");
  x += "  </Tags>\n";
  x += '  <Programs Use="Context">\n';
  x += '    <Program Use="Target" Name="' + nm + '" TestEdits="false" MainRoutineName="SafetyRoutine" Disabled="false" Class="Safety" UseAsFolder="false">\n';
  x += "      <Description>" + cdata(lxAscii(o.description)) + "</Description>\n";
  x += "      <Tags>\n";
  for (const t of o.tags.filter(t => !t.io)) x += safetyTagXml(t, "        ");
  x += "      </Tags>\n      <Routines>\n";
  x += '        <Routine Name="SafetyRoutine" Type="RLL">\n          <RLLContent>\n';
  o.rungs.forEach((r, i) => {
    x += '            <Rung Number="' + i + '" Type="N">\n';
    if (r.comment) x += "              <Comment>" + cdata(lxAscii(r.comment)) + "</Comment>\n";
    x += "              <Text>" + cdata(lxAscii(r.text)) + "</Text>\n            </Rung>\n";
  });
  x += "          </RLLContent>\n        </Routine>\n      </Routines>\n    </Program>\n  </Programs>\n</Controller>\n</RSLogix5000Content>\n";
  return x;
}

function safetyTagXml(t: LxSafetyTag, ind: string): string {
  const base = BASE.has(t.type);
  return ind + '<Tag Name="' + t.name + '" Class="Safety" TagType="Base" DataType="' + t.type + '"' + radix(t.type) + (base ? ' Constant="false"' : "") + ' ExternalAccess="Read/Write">\n' +
    (t.desc ? ind + " <Description>" + cdata(lxAscii(t.desc)) + "</Description>\n" : "") +
    dataXml("Data", t.type, t.type === "REAL" ? "0.0" : "0", ind + " ") + ind + "</Tag>\n";
}

/** Statická kontrola safety L5X (testy): well-formed, ASCII, každý operand příček deklarovaný. */
export function logixSafetyProblems(x: string): string[] {
  const errs = xmlProblems(x).map(e => "L5X: " + e);
  if (/[^\x00-\x7F]/.test(x)) errs.push("safety L5X: není ASCII");
  if (!/Class="Safety"/.test(x)) errs.push("safety L5X: program není Class=Safety");
  const tags = new Set([...x.matchAll(/<Tag Name="(\w+)"/g)].map(m => m[1].toLowerCase()));
  const KW = new Set(["XIC", "XIO", "OTE", "OTL", "OTU", "NOP", "TON", "DCS", "DCST", "DCSTL", "DCSRT", "DCM", "CROUT", "THRSE"]);
  const ENUM = new Set(["EMERGENCY_STOP", "SAFETY_GATE", "LIGHT_CURTAIN", "AREA_SCANNER", "SAFETY_MAT", "USER_DEFINED"]);
  for (const m of x.matchAll(/<Text><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/g)) {
    const t = m[1];
    if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length || (t.match(/\[/g) || []).length !== (t.match(/\]/g) || []).length) errs.push("příčka: nespárované závorky: " + t);
    if (!t.trim().endsWith(";")) errs.push("příčka bez středníku: " + t);
    for (const id of t.match(/\b[A-Za-z_]\w*(?:\.\w+)?\b/g) || []) {
      const baseId = id.split(".")[0];
      if (KW.has(baseId.toUpperCase()) || ENUM.has(baseId)) continue;
      if (!tags.has(baseId.toLowerCase())) errs.push("příčka: nedeklarovaný tag " + baseId);
    }
  }
  return [...new Set(errs)];
}

/* -------------------------------------------------------------- Tags.csv */

/**
 * Tags.csv pro Tools → Import → Tags and Logic Comments (náhradní cesta k L5X):
 * I/O jako ALIAS na body modulů 5069 (předpoklad osazení slotů v remark), jinak TAG;
 * programové tagy se SCOPE = program PLCdesk. Popisy ASCII s escapováním `$`.
 */
export function genLogixTagsCsv(prj: Project): string {
  const { spec } = lxIoMap(prj);
  const slots = lxSlotText(prj);
  const q = (s: string) => '"' + lxCsvEsc(s) + '"';
  const A = (t: string) => BASE.has(t)
    ? "(RADIX := " + (t === "REAL" ? "Float" : "Decimal") + ", Constant := false, ExternalAccess := Read/Write)"
    : "(Constant := false, ExternalAccess := Read/Write)";
  const l = [
    'remark,"CSV-Import-Export"',
    'remark,"Version = PLCdesk (Logix Designer v' + LX_SOFTWARE_REVISION + '+)"',
    "remark," + q("Project = " + (prj.meta.name || "PLCdesk")),
    "remark," + q(slots ? trx("I/O aliasy předpokládají osazení lokálních slotů (ověř!): {slots}", { slots })
      : trx("I/O aliasy nejde odvodit z adres - I/O tagy jsou běžné tagy, alias doplň ručně.")),
    "remark," + q(trx("Programové tagy patří do programu {prog}; instance FB_* vyžadují AOI z PLCdesk_Program.L5X.", { prog: LX_PROGRAM })),
    "0.3",
    "TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES",
  ];
  for (const e of prj.io) {
    const s = spec.get(e.key), t = lxIoType(e);
    if (s) l.push(["ALIAS", "", e.tag, q(e.cmt || ""), '""', q(s), '"(RADIX := ' + (t === "REAL" ? "Float" : "Decimal") + ', ExternalAccess := Read/Write)"'].join(","));
    else l.push(["TAG", "", e.tag, q(e.cmt || ""), q(t), '""', '"' + A(t) + '"'].join(","));
  }
  for (const t of lxProgramTags(prj)) l.push(["TAG", LX_PROGRAM, t.name, q(t.desc), q(t.type), '""', '"' + A(t.type) + '"'].join(","));
  return l.join("\n");
}

/* ----------------------------------------------------- kontrola výstupu */

/** Minimální kontrola well-formed XML (párování tagů, atributy, CDATA, entity); vrací chyby. */
export function xmlProblems(xml: string): string[] {
  const errs: string[] = [];
  const stack: string[] = [];
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"<]*")*)\s*(\/?)>|<|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m: RegExpExecArray | null, roots = 0;
  while ((m = re.exec(xml))) {
    const t = m[0];
    if (t === "<") { errs.push("neplatná značka u pozice " + m.index); continue; }
    if (t.startsWith("&")) { errs.push("neescapované & u pozice " + m.index); continue; }
    if (t.startsWith("<![CDATA[") || t.startsWith("<!--") || t.startsWith("<?")) {
      if (t.startsWith("<![CDATA[") && !stack.length) errs.push("CDATA mimo kořen");
      continue;
    }
    const name = m[1];
    if (t.startsWith("</")) {
      const top = stack.pop();
      if (top !== name) errs.push("</" + name + "> neodpovídá <" + top + ">");
    } else if (m[3] === "/") {
      if (!stack.length) roots++;
    } else {
      if (!stack.length) roots++;
      stack.push(name);
    }
  }
  if (stack.length) errs.push("neuzavřené značky: " + stack.join(", "));
  if (roots !== 1) errs.push("počet kořenových elementů " + roots);
  return errs;
}

const ST_KW = new Set(["IF", "THEN", "ELSIF", "ELSE", "END_IF", "CASE", "OF", "END_CASE", "AND", "OR", "NOT", "XOR", "MOD", "TONR"]);
const TIMER_MEMBERS = new Set(["PRE", "TimerEnable", "DN", "TT", "ACC", "Reset", "EnableIn", "EnableOut"]);

/**
 * Statická kontrola výstupu pro Logix (testy + scripts/check_samples.mjs): well-formed L5X,
 * žádné konstrukce IEC, které Logix nemá, TONR s PRE před voláním, každý identifikátor
 * v rutinách deklarovaný (tag, parametr / lokální tag AOI, člen FBD_TIMER), čisté ASCII.
 */
export function logixProblems(files: Record<string, string>): string[] {
  const errs: string[] = [];
  const x = files["PLCdesk_Program.L5X"];
  if (!x) return ["chybí PLCdesk_Program.L5X"];
  errs.push(...xmlProblems(x).map(e => "L5X: " + e));
  for (const [n, b] of Object.entries(files)) if (n !== "README.txt" && /[^\x00-\x7F]/.test(b)) errs.push(n + ": není ASCII");
  /* deklarace */
  const ctrl = (x.match(/<Tags Use="Context">([\s\S]*?)<\/Tags>/) || ["", ""])[1];
  const prog = (x.match(/<Program [^>]*>[\s\S]*?<Tags>([\s\S]*?)<\/Tags>/) || ["", ""])[1];
  const tagType = new Map<string, string>();
  for (const part of [ctrl, prog]) for (const m of part.matchAll(/<Tag Name="(\w+)"[^>]*DataType="(\w+)"/g)) {
    if (tagType.has(m[1].toLowerCase())) errs.push("L5X: duplicitní tag " + m[1]);
    tagType.set(m[1].toLowerCase(), m[2]);
  }
  const aoi = new Map<string, Map<string, string>>();
  for (const m of x.matchAll(/<AddOnInstructionDefinition [^>]*Name="(\w+)"[\s\S]*?<\/AddOnInstructionDefinition>/g)) {
    const mem = new Map<string, string>();
    for (const p of m[0].matchAll(/<(?:Parameter|LocalTag) Name="(\w+)"[^>]*DataType="(\w+)"/g)) mem.set(p[1].toLowerCase(), p[2]);
    aoi.set(m[1], mem);
  }
  const routines: Array<{ where: string; st: string; scope: (id: string) => string | undefined }> = [];
  for (const m of x.matchAll(/<AddOnInstructionDefinition [^>]*Name="(\w+)"[\s\S]*?<\/AddOnInstructionDefinition>/g)) {
    const mem = aoi.get(m[1])!;
    routines.push({ where: m[1], st: lines(m[0]), scope: id => mem.get(id.toLowerCase()) });
  }
  const main = (x.match(/<Routine Name="MainRoutine"[\s\S]*?<\/Routine>/) || [""])[0];
  if (!main) errs.push("L5X: chybí MainRoutine");
  routines.push({ where: "MainRoutine", st: lines(main), scope: id => tagType.get(id.toLowerCase()) });
  if (files["MainRoutine.st"] !== undefined && files["MainRoutine.st"].replace(/\s+$/, "") !== lines(main).replace(/\s+$/, ""))
    errs.push("MainRoutine.st se liší od rutiny v L5X");
  for (const r of routines) for (const f of lxRoutineFindings(r.st, r.scope, aoi)) errs.push(r.where + ": " + f.text);
  return [...new Set(errs)];
}

/** Nález kontroly rutiny Logix: `text` = popis pro testy (česky), `code` + `arg` = jazykově neutrální. */
interface LxFinding { code: string; arg: string; text: string; }

/** Kontrola jedné rutiny ST (MainRoutine nebo logika AOI): konstrukce IEC, párování, TONR, identifikátory. */
function lxRoutineFindings(st: string, scope: (id: string) => string | undefined, aoi: Map<string, Map<string, string>>): LxFinding[] {
  const out: LxFinding[] = [];
  const F = (code: string, arg: string, text: string) => out.push({ code, arg, text });
  const code = st.replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/.*$/gm, " ");
  const bad: Array<[RegExp, string]> = [[/\b(END_)?VAR\b|\bVAR_(INPUT|OUTPUT)\b/, "VAR"], [/\b(END_)?PROGRAM\b/, "PROGRAM"],
    [/\b(END_)?FUNCTION_BLOCK\b/, "FUNCTION_BLOCK"], [/T#/, "T#"], [/=>/, "=>"], [/\bWORD\b/, "WORD"], [/\bRETURN\b/, "RETURN"],
    [/\b(INT_TO_REAL|REAL_TO_INT)\b/, "INT_TO_REAL"], [/END_IF(?!;)/, "END_IF bez ;"], [/END_CASE(?!;)/, "END_CASE bez ;"],
    [/\bTON\s*\(/, "TON("], [/\.Q\b/, ".Q"], [/\bTRUE\b|\bFALSE\b/, "TRUE/FALSE"]];
  for (const [re, what] of bad) if (re.test(code)) F("construct", what, "obsahuje " + what);
  const cnt = (re: RegExp) => (code.match(re) || []).length;
  if (cnt(/(?<!END_)\bIF\b/g) !== cnt(/\bEND_IF\b/g)) F("pair", "IF", "nespárované IF/END_IF");
  if (cnt(/(?<!END_)\bCASE\b/g) !== cnt(/\bEND_CASE\b/g)) F("pair", "CASE", "nespárované CASE/END_CASE");
  if (cnt(/\(/g) !== cnt(/\)/g)) F("pair", "()", "nespárované závorky");
  /* TONR: PRE a TimerEnable nastavené před voláním (jinak zpoždění o scan) */
  for (const m of code.matchAll(/TONR\((\w+)\);/g)) {
    const before = code.slice(0, m.index);
    const pre = before.lastIndexOf(m[1] + ".PRE :="), en = before.lastIndexOf(m[1] + ".TimerEnable :=");
    const prev = before.lastIndexOf("TONR(" + m[1] + ")");
    if (pre < 0 || en < 0 || pre < prev || en < prev) F("tonr", m[1], "TONR(" + m[1] + ") bez PRE/TimerEnable před voláním");
  }
  /* AOI volané s instancí správného typu */
  for (const m of code.matchAll(/\b(FB_\w+)\((\w+)\);/g)) {
    if (!aoi.has(m[1])) F("aoi", m[1], "AOI " + m[1] + " není v L5X");
    else if (scope(m[2]) !== m[1]) F("aoi-instance", m[2], m[2] + " není instance " + m[1]);
  }
  /* identifikátory */
  for (const m of code.matchAll(/(\.)?\b([A-Za-z_][A-Za-z0-9_]*)\b(\.[A-Za-z_]\w*)?/g)) {
    if (m[1]) continue;                            // člen řeší výraz před tečkou
    const id = m[2];
    if (ST_KW.has(id.toUpperCase()) || aoi.has(id)) continue;
    if (/^\d/.test(id)) continue;
    const t = scope(id);
    if (!t) { F("undeclared", id, "nedeklarovaný identifikátor " + id); continue; }
    if (m[3]) {
      const member = m[3].slice(1);
      const ok = t === "FBD_TIMER" ? TIMER_MEMBERS.has(member) : aoi.has(t) ? aoi.get(t)!.has(member.toLowerCase()) : false;
      if (!ok) F("member", id + "." + member, id + " (" + t + ") nemá člen " + member);
    }
  }
  for (const id of new Set(code.match(/\b[A-Za-z_]\w*\b/g) || [])) {
    if (id.length > 40 || /__/.test(id) || /_$/.test(id)) F("name", id, "jméno " + id + " porušuje pravidla Logix (40 znaků, __, _ na konci)");
  }
  return out;
}

/** Typy proměnných šablony, které převod na AOI zná (`lxType`). */
const LX_TPL_TYPES = new Set(["BOOL", "SINT", "INT", "DINT", "REAL", "WORD", "TON"]);

/**
 * Proč vlastní šablonu IEC ST (firemní knihovna) nejde spolehlivě převést na Add-On Instruction;
 * prázdné = jde. Převod (`lxDialect`) zná jen konstrukce vestavěných šablon (TON jako
 * `tonX(IN := …, PT := T#…);`, předčasný RETURN v úvodním IF NOT enable, INT_TO_REAL…) — výsledek
 * se proto zkontroluje stejnou kontrolou jako výstup (`lxRoutineFindings`): co v AOI zbude
 * z IEC (T#, TON(, RETURN, .Q, volání s parametry, nedeklarované jméno…), převést nešlo.
 */
export function lxTplProblems(cls: IrFbClass, tpl: string): string[] {
  const why: string[] = [];
  const { vars, body } = parseFbTemplate(tpl);
  if (/\b(END_VAR|VAR_\w+|VAR)\b/.test(body.replace(/\(\*[\s\S]*?\*\)/g, " "))) why.push(tr("deklarační blok, který převod nečte (např. VAR CONSTANT)"));
  const bad = [...new Set(vars.filter(v => !LX_TPL_TYPES.has(v.type)).map(v => v.type))];
  if (bad.length) why.push(tr("datový typ {list} nemá v Logixu převod", { list: bad.join(", ") }));
  if (why.length) return why;
  const x = aoiXml(cls, { templates: { [cls]: tpl }, ids: {}, header: [], issues: [] });
  const mem = new Map<string, string>();
  for (const p of x.matchAll(/<(?:Parameter|LocalTag) Name="(\w+)"[^>]*DataType="(\w+)"/g)) mem.set(p[1].toLowerCase(), p[2]);
  const found = lxRoutineFindings(lines(x), id => mem.get(id.toLowerCase()), new Map([[AOI_OF[cls], mem]]));
  if (found.length) why.push(tr("po převodu na AOI zbývá, co Logix ST nemá ({list})", {
    list: [...new Set(found.map(f => f.code + " " + f.arg))].slice(0, 5).join(", "),
  }));
  return why;
}

/** Text rutiny z L5X (řádky z CDATA). */
function lines(xml: string): string {
  return [...xml.matchAll(/<Line Number="\d+">((?:<!\[CDATA\[[\s\S]*?\]\]>)+)<\/Line>/g)]
    .map(m => [...m[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(c => c[1]).join("")).join("\n");
}
