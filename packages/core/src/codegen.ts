/**
 * PLC Studio — generování zdrojových souborů programu pro cílové platformy.
 * Siemens: SCL (external sources) + SimaticML XML + TSV tagů.
 * Ostatní: IEC 61131-3 ST + platformní soubor tagů (GVL / CSV / tab).
 */
import {
  Project, PlatformKey, Device, IoEntry, PLAT, devById, ioOf, usedClasses,
  instName, dtFor, addrFor, xmlEsc, stripDia, modules,
} from "./model.js";

/* ------------------------------------------------------------ šablony SCL */

export const SCL_MOTOR = `FUNCTION_BLOCK "FB_Motor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
// Šablona: motor/čerpadlo se zpětným hlášením běhu
VAR_INPUT
    enable : Bool;
    cmdStart : Bool;
    cmdStop : Bool;
    fbkRunning : Bool;
    fault : Bool;
END_VAR
VAR_OUTPUT
    outRun : Bool;
    busy : Bool;
    error : Bool;
    status : Word;
END_VAR
VAR
    statStep : Int;
    instTrigStart : R_TRIG;
    instTrigStop : R_TRIG;
    instTonFbk : TON;
END_VAR
VAR CONSTANT
    STEP_IDLE : Int := 0;
    STEP_STARTING : Int := 10;
    STEP_RUNNING : Int := 20;
    STEP_ERROR : Int := 90;
    T_FBK : Time := T#3S;
END_VAR

BEGIN
    IF NOT #enable THEN
        #outRun := FALSE; #busy := FALSE; #error := FALSE;
        #status := 16#8001; #statStep := #STEP_IDLE;
        RETURN;
    END_IF;

    #instTrigStart(CLK := #cmdStart);
    #instTrigStop(CLK := #cmdStop);

    CASE #statStep OF
        #STEP_IDLE:
            #outRun := FALSE;
            IF #instTrigStart.Q THEN #statStep := #STEP_STARTING; END_IF;
        #STEP_STARTING:
            #outRun := TRUE;
            IF #fbkRunning THEN #statStep := #STEP_RUNNING; END_IF;
        #STEP_RUNNING:
            #outRun := TRUE;
            IF NOT #fbkRunning THEN #statStep := #STEP_ERROR; END_IF;
            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;
        #STEP_ERROR:
            #outRun := FALSE;
            IF #instTrigStop.Q AND NOT #fault THEN #statStep := #STEP_IDLE; END_IF;
    END_CASE;

    #instTonFbk(IN := (#statStep = #STEP_STARTING), PT := #T_FBK);
    IF #instTonFbk.Q OR #fault THEN #statStep := #STEP_ERROR; END_IF;

    #busy := (#statStep = #STEP_STARTING);
    #error := (#statStep = #STEP_ERROR);
    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;

export const SCL_VENTIL = `FUNCTION_BLOCK "FB_Ventil"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
// Šablona: dvoupolohový ventil/válec s koncovými snímači
VAR_INPUT
    enable : Bool;
    cmdOpen : Bool;
    cmdClose : Bool;
    fbkOpen : Bool;
    fbkClosed : Bool;
END_VAR
VAR_OUTPUT
    outOpen : Bool;
    busy : Bool;
    error : Bool;
    status : Word;
END_VAR
VAR
    statStep : Int;
    instTrigOpen : R_TRIG;
    instTrigClose : R_TRIG;
    instTonTravel : TON;
END_VAR
VAR CONSTANT
    STEP_CLOSED : Int := 0;
    STEP_OPENING : Int := 10;
    STEP_OPEN : Int := 20;
    STEP_CLOSING : Int := 30;
    STEP_ERROR : Int := 90;
    T_TRAVEL : Time := T#5S;
END_VAR

BEGIN
    IF NOT #enable THEN
        #outOpen := FALSE; #busy := FALSE; #error := FALSE;
        #status := 16#8001; #statStep := #STEP_CLOSED;
        RETURN;
    END_IF;

    #instTrigOpen(CLK := #cmdOpen);
    #instTrigClose(CLK := #cmdClose);

    CASE #statStep OF
        #STEP_CLOSED:
            #outOpen := FALSE;
            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;
        #STEP_OPENING:
            #outOpen := TRUE;
            IF #fbkOpen THEN #statStep := #STEP_OPEN; END_IF;
        #STEP_OPEN:
            #outOpen := TRUE;
            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;
        #STEP_CLOSING:
            #outOpen := FALSE;
            IF #fbkClosed THEN #statStep := #STEP_CLOSED; END_IF;
        #STEP_ERROR:
            #outOpen := FALSE;
            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSED; END_IF;
    END_CASE;

    #instTonTravel(IN := (#statStep = #STEP_OPENING) OR (#statStep = #STEP_CLOSING),
                   PT := #T_TRAVEL);
    IF #instTonTravel.Q THEN #statStep := #STEP_ERROR; END_IF;

    #busy := (#statStep = #STEP_OPENING) OR (#statStep = #STEP_CLOSING);
    #error := (#statStep = #STEP_ERROR);
    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;

/* P1 oprava: škálování explicitní aritmetikou místo NORM_X (typové vrtochy). */
export const SCL_AI = `FUNCTION_BLOCK "FB_AnalogIn"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
// Šablona: analogový vstup se škálováním a mezemi (surová hodnota 0..27648)
VAR_INPUT
    rawValue : Int;
    scaleMin : Real := 0.0;
    scaleMax : Real := 100.0;
    limitHi : Real := 1.0E+6;
    limitLo : Real := -1.0E+6;
END_VAR
VAR_OUTPUT
    value : Real;
    alarmHi : Bool;
    alarmLo : Bool;
END_VAR

BEGIN
    #value := INT_TO_REAL(#rawValue) / 27648.0
              * (#scaleMax - #scaleMin) + #scaleMin;
    #alarmHi := #value > #limitHi;
    #alarmLo := #value < #limitLo;
END_FUNCTION_BLOCK`;

export const SCL_AO = `FUNCTION_BLOCK "FB_AnalogOut"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
// Šablona: analogový výstup — inženýrské jednotky -> surová hodnota 0..27648
VAR_INPUT
    value : Real;
    scaleMin : Real := 0.0;
    scaleMax : Real := 100.0;
END_VAR
VAR_OUTPUT
    rawValue : Int;
END_VAR

BEGIN
    #rawValue := REAL_TO_INT(
        (#value - #scaleMin) / (#scaleMax - #scaleMin) * 27648.0);
END_FUNCTION_BLOCK`;

/* ------------------------------------------------------------- šablony ST */

export const ST_MOTOR = `FUNCTION_BLOCK FB_Motor
(* Sablona: motor/cerpadlo se zpetnym hlasenim behu *)
VAR_INPUT
    enable : BOOL;
    cmdStart : BOOL;
    cmdStop : BOOL;
    fbkRunning : BOOL;
    fault : BOOL;
END_VAR
VAR_OUTPUT
    outRun : BOOL;
    busy : BOOL;
    error : BOOL;
    status : WORD;
END_VAR
VAR
    statStep : INT;
    lastStart : BOOL;
    lastStop : BOOL;
    trigStart : BOOL;
    trigStop : BOOL;
    tonFbk : TON;
END_VAR

IF NOT enable THEN
    outRun := FALSE; busy := FALSE; error := FALSE;
    status := 16#8001; statStep := 0;
    RETURN;
END_IF;

(* detekce hran *)
trigStart := cmdStart AND NOT lastStart;  lastStart := cmdStart;
trigStop  := cmdStop  AND NOT lastStop;   lastStop  := cmdStop;

CASE statStep OF
    0: (* IDLE *)
        outRun := FALSE;
        IF trigStart THEN statStep := 10; END_IF
    10: (* STARTING *)
        outRun := TRUE;
        IF fbkRunning THEN statStep := 20; END_IF
    20: (* RUNNING *)
        outRun := TRUE;
        IF NOT fbkRunning THEN statStep := 90; END_IF
        IF trigStop THEN statStep := 0; END_IF
    90: (* ERROR *)
        outRun := FALSE;
        IF trigStop AND NOT fault THEN statStep := 0; END_IF
END_CASE;

tonFbk(IN := (statStep = 10), PT := T#3S);
IF tonFbk.Q OR fault THEN statStep := 90; END_IF;

busy := (statStep = 10);
error := (statStep = 90);
IF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;

export const ST_VENTIL = `FUNCTION_BLOCK FB_Ventil
(* Sablona: dvoupolohovy ventil/valec s koncovymi snimaci *)
VAR_INPUT
    enable : BOOL;
    cmdOpen : BOOL;
    cmdClose : BOOL;
    fbkOpen : BOOL;
    fbkClosed : BOOL;
END_VAR
VAR_OUTPUT
    outOpen : BOOL;
    busy : BOOL;
    error : BOOL;
    status : WORD;
END_VAR
VAR
    statStep : INT;
    lastOpen : BOOL;
    lastClose : BOOL;
    trigOpen : BOOL;
    trigClose : BOOL;
    tonTravel : TON;
END_VAR

IF NOT enable THEN
    outOpen := FALSE; busy := FALSE; error := FALSE;
    status := 16#8001; statStep := 0;
    RETURN;
END_IF;

trigOpen  := cmdOpen  AND NOT lastOpen;   lastOpen  := cmdOpen;
trigClose := cmdClose AND NOT lastClose;  lastClose := cmdClose;

CASE statStep OF
    0: (* CLOSED *)
        outOpen := FALSE;
        IF trigOpen THEN statStep := 10; END_IF
    10: (* OPENING *)
        outOpen := TRUE;
        IF fbkOpen THEN statStep := 20; END_IF
    20: (* OPEN *)
        outOpen := TRUE;
        IF trigClose THEN statStep := 30; END_IF
    30: (* CLOSING *)
        outOpen := FALSE;
        IF fbkClosed THEN statStep := 0; END_IF
    90: (* ERROR *)
        outOpen := FALSE;
        IF trigClose THEN statStep := 0; END_IF
END_CASE;

tonTravel(IN := (statStep = 10) OR (statStep = 30), PT := T#5S);
IF tonTravel.Q THEN statStep := 90; END_IF;

busy := (statStep = 10) OR (statStep = 30);
error := (statStep = 90);
IF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;

export const ST_AI = `FUNCTION_BLOCK FB_AnalogIn
(* Sablona: analogovy vstup se skalovanim a mezemi.
   rawMax uprav dle platformy: Siemens 27648, Beckhoff 32767,
   Mitsubishi FX5 16000, Rockwell dle modulu. *)
VAR_INPUT
    rawValue : INT;
    rawMax : INT := 27648;
    scaleMin : REAL := 0.0;
    scaleMax : REAL := 100.0;
    limitHi : REAL := 1.0E+6;
    limitLo : REAL := -1.0E+6;
END_VAR
VAR_OUTPUT
    value : REAL;
    alarmHi : BOOL;
    alarmLo : BOOL;
END_VAR

value := INT_TO_REAL(rawValue) / INT_TO_REAL(rawMax)
         * (scaleMax - scaleMin) + scaleMin;
alarmHi := value > limitHi;
alarmLo := value < limitLo;
END_FUNCTION_BLOCK`;

export const ST_AO = `FUNCTION_BLOCK FB_AnalogOut
(* Sablona: analogovy vystup — inzenyrske jednotky -> surova hodnota *)
VAR_INPUT
    value : REAL;
    rawMax : INT := 27648;
    scaleMin : REAL := 0.0;
    scaleMax : REAL := 100.0;
END_VAR
VAR_OUTPUT
    rawValue : INT;
END_VAR

rawValue := REAL_TO_INT((value - scaleMin) / (scaleMax - scaleMin)
            * INT_TO_REAL(rawMax));
END_FUNCTION_BLOCK`;

/* ------------------------------------------------------- pomocné funkce */

type RefFn = (tag: string) => string;
type LocFn = (v: string) => string;

export function refFn(plat: PlatformKey): RefFn {
  if (plat === "siemens") return t => '"' + t + '"';
  if (plat === "beckhoff" || plat === "codesys" || plat === "schneider") return t => "GVL_IO." + t;
  return t => t;
}
export function locFn(plat: PlatformKey): LocFn {
  return plat === "siemens" ? v => "#" + v : v => v;
}
function fmtR(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? (Number.isInteger(n) ? n + ".0" : String(n)) : "0.0";
}

/* --------------------------------------------------------------- sekvence */

export function seqVars(prj: Project): string[] {
  const vars = new Set<string>();
  for (const s of prj.program.seq) {
    const d = devById(prj, s.dev);
    if (!d) continue;
    if (d.cls === "Motor") vars.add("seqRun_" + d.name);
    if (d.cls === "Ventil") vars.add("seqOpen_" + d.name);
  }
  return [...vars];
}
export function seqTimedSteps(prj: Project): number[] {
  const list: number[] = [];
  prj.program.seq.forEach((s, i) => { if (s.act === "wait" || s.cond === "time") list.push(10 + i * 10); });
  return list;
}

export function seqBody(prj: Project, plat: PlatformKey): string {
  const L = locFn(plat), R = refFn(plat);
  const steps = prj.program.seq;
  if (!steps.length) return "";
  const cmt = plat === "siemens" ? (t: string) => "// " + t : (t: string) => "(* " + t + " *)";
  let b = "    " + cmt("--- Automatická sekvence (režim AUTO) ---") + "\n";
  b += "    IF NOT " + L("modeAuto") + " OR NOT " + L("enable") + " THEN\n";
  b += "        " + L("seqStep") + " := 0;\n";
  for (const v of seqVars(prj)) b += "        " + L(v) + " := FALSE;\n";
  b += "    END_IF;\n\n";
  b += "    CASE " + L("seqStep") + " OF\n";
  b += "        0: " + cmt("čekání na start") + "\n";
  b += "            IF " + L("modeAuto") + " AND " + L("cmdAutoStart") + " THEN " + L("seqStep") + " := 10; END_IF" + (plat === "siemens" ? ";" : "") + "\n";
  steps.forEach((s, i) => {
    const n = 10 + i * 10, next = (i === steps.length - 1) ? 0 : 10 + (i + 1) * 10;
    const d = devById(prj, s.dev);
    let title = "", action = "", cond = "";
    if (s.act === "wait") {
      title = "výdrž " + (s.timeS || 1) + " s";
      cond = L("tonSeq" + n) + ".Q";
    } else if (d && d.cls === "Motor") {
      title = d.name + " " + (s.act === "start" ? "start" : "stop");
      action = "            " + L("seqRun_" + d.name) + " := " + (s.act === "start" ? "TRUE" : "FALSE") + ";\n";
      const io = ioOf(prj, d);
      if (s.cond === "time") cond = L("tonSeq" + n) + ".Q";
      else if (io.fbkRunning) cond = (s.act === "start" ? "" : "NOT ") + R(io.fbkRunning.tag);
      else cond = "TRUE " + cmt("bez zpětného hlášení");
    } else if (d && d.cls === "Ventil") {
      title = d.name + " " + (s.act === "open" ? "otevřít" : "zavřít");
      action = "            " + L("seqOpen_" + d.name) + " := " + (s.act === "open" ? "TRUE" : "FALSE") + ";\n";
      const io = ioOf(prj, d);
      if (s.cond === "time") cond = L("tonSeq" + n) + ".Q";
      else if (s.act === "open" && io.fbkOpen) cond = R(io.fbkOpen.tag);
      else if (s.act === "close" && io.fbkClosed) cond = R(io.fbkClosed.tag);
      else cond = "TRUE " + cmt("bez koncového snímače");
    } else { title = "krok"; cond = "TRUE"; }
    b += "        " + n + ": " + cmt("Krok " + (i + 1) + ": " + title) + "\n";
    b += action;
    b += "            IF " + cond + " THEN " + L("seqStep") + " := " + next + "; END_IF" + (plat === "siemens" ? ";" : "") + "\n";
  });
  b += "    END_CASE;\n\n";
  for (const n of seqTimedSteps(prj)) {
    const s = prj.program.seq[(n - 10) / 10];
    b += "    " + L("tonSeq" + n) + "(IN := (" + L("seqStep") + " = " + n + "), PT := T#" + (s.timeS || 1) + "S);\n";
  }
  return b;
}

export function seqDecls(prj: Project, plat: PlatformKey): string {
  const out: string[] = [];
  const c = (t: string) => plat === "siemens" ? "// " + t : "(* " + stripDia(t) + " *)";
  out.push("    modeAuto : BOOL;      " + c("TODO: přepínač režimu (HMI)"));
  out.push("    cmdAutoStart : BOOL;  " + c("TODO: tlačítko start auto"));
  out.push("    seqStep : INT;");
  for (const v of seqVars(prj)) out.push("    " + v + " : BOOL;");
  for (const n of seqTimedSteps(prj)) out.push("    tonSeq" + n + " : TON;");
  return out.join("\n");
}

/* ------------------------------------------------------- zapojení instancí */

interface Wiring { inst: Array<{ n: string; t: string }>; calls: string[]; free: string[]; }

export function wiring(prj: Project, plat: PlatformKey): Wiring {
  const R = refFn(plat), L = locFn(plat);
  const inst: Array<{ n: string; t: string }> = [], calls: string[] = [], free: string[] = [];
  const hasSeq = prj.program.seq.length > 0;
  const sv = seqVars(prj);
  for (const d of prj.devices) {
    const io = ioOf(prj, d);
    const title = d.name + (d.desc ? " – " + d.desc : "");
    const c = plat === "siemens" ? "    // " + title : "    (* " + stripDia(title) + " *)";
    if (d.cls === "Motor") {
      inst.push({ n: instName(d), t: "FB_Motor" });
      const auto = hasSeq && sv.includes("seqRun_" + d.name);
      calls.push(c + "\n    " + L(instName(d)) + "(enable := " + L("enable") + ",\n" +
        "        cmdStart := " + (auto ? L("seqRun_" + d.name) : "FALSE") + ", " + (plat === "siemens" ? "// TODO: + ruční povel z HMI" : "(* TODO: + rucni povel z HMI *)") + "\n" +
        "        cmdStop := " + (auto ? "NOT " + L("seqRun_" + d.name) : "FALSE") + ",\n" +
        "        fbkRunning := " + (io.fbkRunning ? R(io.fbkRunning.tag) : "TRUE") + "," + (io.fbkRunning ? "" : " " + (plat === "siemens" ? "// bez zpětného hlášení" : "(* bez zpetneho hlaseni *)")) + "\n" +
        "        fault := " + (io.fault ? R(io.fault.tag) : "FALSE") + ",\n" +
        "        outRun => " + (io.outRun ? R(io.outRun.tag) : L("tempUnused")) + ");");
    } else if (d.cls === "Ventil") {
      inst.push({ n: instName(d), t: "FB_Ventil" });
      const auto = hasSeq && sv.includes("seqOpen_" + d.name);
      calls.push(c + "\n    " + L(instName(d)) + "(enable := " + L("enable") + ",\n" +
        "        cmdOpen := " + (auto ? L("seqOpen_" + d.name) : "FALSE") + ", " + (plat === "siemens" ? "// TODO: + ruční povel" : "(* TODO: + rucni povel *)") + "\n" +
        "        cmdClose := " + (auto ? "NOT " + L("seqOpen_" + d.name) : "FALSE") + ",\n" +
        "        fbkOpen := " + (io.fbkOpen ? R(io.fbkOpen.tag) : "TRUE") + ",\n" +
        "        fbkClosed := " + (io.fbkClosed ? R(io.fbkClosed.tag) : "TRUE") + ",\n" +
        "        outOpen => " + (io.outOpen ? R(io.outOpen.tag) : L("tempUnused")) + ");");
    } else if (d.cls === "AnalogIn") {
      inst.push({ n: instName(d), t: "FB_AnalogIn" });
      calls.push(c + "\n    " + L(instName(d)) + "(rawValue := " + (io.raw ? R(io.raw.tag) : "0") + ",\n" +
        "        scaleMin := " + fmtR(d.rmin) + ", scaleMax := " + fmtR(d.rmax) + "); " +
        (plat === "siemens" ? "// " + (d.unit || "jednotky dle snímače") : "(* " + stripDia(d.unit || "jednotky dle snimace") + " *)"));
    } else if (d.cls === "AnalogOut") {
      inst.push({ n: instName(d), t: "FB_AnalogOut" });
      calls.push(c + "\n    " + L(instName(d)) + "(value := 0.0, " + (plat === "siemens" ? "// TODO: žádaná hodnota" : "(* TODO: zadana hodnota *)") + "\n" +
        "        scaleMin := " + fmtR(d.rmin) + ", scaleMax := " + fmtR(d.rmax) + ",\n" +
        "        rawValue => " + (io.raw ? R(io.raw.tag) : L("tempUnused2")) + ");");
    } else {
      for (const e of Object.values(io)) {
        free.push("    " + (plat === "siemens" ? "//" : "(*") + "   " + (e.addr || "").padEnd(8) + " " + R(e.tag) + "  " + (plat === "siemens" ? e.cmt : stripDia(e.cmt) + " *)"));
      }
    }
  }
  return { inst, calls, free };
}

export function enableExpr(prj: Project, plat: PlatformKey): string {
  const R = refFn(plat);
  const es = devById(prj, prj.program.estop);
  if (es) {
    const io = ioOf(prj, es);
    const e = io.in || Object.values(io)[0];
    if (e) return R(e.tag) + " " + (plat === "siemens"
      ? "// E-stop NC: TRUE = OK — doplň celý bezpečnostní okruh!"
      : "(* E-stop NC: TRUE = OK - doplnit cely bezpecnostni okruh! *)");
  }
  return "TRUE " + (plat === "siemens" ? "// TODO: napojit bezpečnostní okruh!" : "(* TODO: napojit bezpecnostni okruh! *)");
}

/* ------------------------------------------------------- soubory: Siemens */

export function genSiemensTagsXml(prj: Project): string {
  let id = 0; const nid = () => (id++).toString();
  let x = '<?xml version="1.0" encoding="utf-8"?>\n<Document>\n  <Engineering version="V21" />\n  <SW.Tags.PlcTagTable ID="' + nid() + '">\n    <AttributeList>\n      <Name>Gen_IO</Name>\n    </AttributeList>\n    <ObjectList>\n';
  for (const e of prj.io) {
    x += '      <SW.Tags.PlcTag ID="' + nid() + '" CompositionName="Tags">\n        <AttributeList>\n          <DataTypeName>' + (dtFor(e) === "INT" ? "Int" : "Bool") + '</DataTypeName>\n          <LogicalAddress>' + xmlEsc(e.addr) + '</LogicalAddress>\n          <Name>' + xmlEsc(e.tag) + '</Name>\n        </AttributeList>\n';
    if (e.cmt) x += '        <ObjectList>\n          <MultilingualText ID="' + nid() + '" CompositionName="Comment">\n            <ObjectList>\n              <MultilingualTextItem ID="' + nid() + '" CompositionName="Items">\n                <AttributeList>\n                  <Culture>cs-CZ</Culture>\n                  <Text>' + xmlEsc(e.cmt) + '</Text>\n                </AttributeList>\n              </MultilingualTextItem>\n            </ObjectList>\n          </MultilingualText>\n        </ObjectList>\n';
    x += '      </SW.Tags.PlcTag>\n';
  }
  return x + '    </ObjectList>\n  </SW.Tags.PlcTagTable>\n</Document>\n';
}

/** P1: robustní ruční cesta — sloupce k vložení přímo do tabulky tagů TIA / Excelu. */
export function genSiemensTagsTSV(prj: Project): string {
  const l = ["Name\tData Type\tLogical Address\tComment"];
  for (const e of prj.io) l.push([e.tag, dtFor(e) === "INT" ? "Int" : "Bool", e.addr, e.cmt || ""].join("\t"));
  return l.join("\n");
}

export function genLibrary(prj: Project, plat: PlatformKey): string {
  const u = usedClasses(prj);
  const parts: string[] = [];
  const hdr = plat === "siemens"
    ? "// Gen_Library.scl – knihovna šablon (generováno PLC Studio)\n// Import: External source files → Generate blocks from source (PŘED Gen_Main)"
    : "(* Gen_Library.st - knihovna sablon (generovano PLC Studio) - " + PLAT[plat].name + " *)";
  parts.push(hdr, "");
  const T = plat === "siemens"
    ? { Motor: SCL_MOTOR, Ventil: SCL_VENTIL, AnalogIn: SCL_AI, AnalogOut: SCL_AO }
    : { Motor: ST_MOTOR, Ventil: ST_VENTIL, AnalogIn: ST_AI, AnalogOut: ST_AO };
  for (const c of ["Motor", "Ventil", "AnalogIn", "AnalogOut"] as const) if (u.has(c)) parts.push(T[c], "");
  if (parts.length <= 2) parts.push(plat === "siemens" ? "// (žádné instancované třídy zařízení)" : "(* zadne instancovane tridy zarizeni *)");
  return parts.join("\n");
}

export function genMainSiemens(prj: Project): string {
  const { inst, calls, free } = wiring(prj, "siemens");
  const hasSeq = prj.program.seq.length > 0;
  let v = inst.map(i => '    ' + i.n + ' : "' + i.t + '";').join("\n");
  if (hasSeq) v += (v ? "\n" : "") + seqDecls(prj, "siemens");
  return `// Gen_Main.scl – strojní blok (multi-instance). Import PO Gen_Library.scl.

FUNCTION_BLOCK "FB_Machine"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR_INPUT
    enableIn : Bool;   // centrální uvolnění zvenku (OB1)
END_VAR
VAR
    enable : Bool;
${v || "    // žádné instance"}
END_VAR
VAR_TEMP
    tempUnused : Bool;
    tempUnused2 : Int;
END_VAR

BEGIN
    #enable := #enableIn;

${seqBody(prj, "siemens")}${calls.join("\n\n") || "    ;"}

    // Volné signály (DI/DO) pro vlastní logiku:
${free.join("\n") || "    //   (žádné)"}
END_FUNCTION_BLOCK

DATA_BLOCK "InstMachine"
{ S7_Optimized_Access := 'TRUE' }
"FB_Machine"
BEGIN
END_DATA_BLOCK

(* --- Vložit do OB1 (Main) ---------------------------------
   "InstMachine"(enableIn := ${enableExpr(prj, "siemens").split("//")[0].trim()});
   ----------------------------------------------------------- *)`;
}

/* ----------------------------------------------------------- soubory: IEC */

export function genGVL(prj: Project, plat: PlatformKey): string {
  const lines = ["(* GVL_IO - globalni promenne / fyzicke I/O - generovano PLC Studio *)", "VAR_GLOBAL"];
  for (const e of prj.io) {
    const at = addrFor(plat, e);
    lines.push("    " + e.tag + (at ? " AT " + at : "") + " : " + dtFor(e) + ";" + (e.cmt ? " (* " + stripDia(e.cmt) + " *)" : ""));
  }
  lines.push("END_VAR");
  return lines.join("\n");
}

export function genMainIEC(prj: Project, plat: PlatformKey): string {
  const { inst, calls, free } = wiring(prj, plat);
  const hasSeq = prj.program.seq.length > 0;
  let v = inst.map(i => "    " + i.n + " : " + i.t + ";").join("\n");
  if (hasSeq) v += (v ? "\n" : "") + seqDecls(prj, plat);
  return `(* MAIN - hlavni program (generovano PLC Studio) - ${PLAT[plat].name} *)
PROGRAM MAIN
VAR
    enable : BOOL;
${v || "    (* zadne instance *)"}
    tempUnused : BOOL;
    tempUnused2 : INT;
END_VAR

enable := ${enableExpr(prj, plat)};

${seqBody(prj, plat)}${calls.join("\n\n") || ";"}

(* Volne signaly (DI/DO) pro vlastni logiku: *)
${free.join("\n") || "(*   zadne *)"}
END_PROGRAM`;
}

/* P1: Rockwell CSV s povinnou hlavičkou (remark + verze 0.3), INT místo WORD. */
export function genTagFile(prj: Project, plat: PlatformKey): { name: string; body: string } {
  const q = (s: string) => '"' + stripDia(s).replace(/"/g, "'") + '"';
  if (plat === "rockwell") {
    const l = [
      'remark,"CSV-Import-Export"',
      'remark,"Project = ' + stripDia(prj.meta.name || "PLC Studio").replace(/"/g, "'") + '"',
      'remark,"Generated = PLC Studio"',
      "0.3",
      "TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES",
    ];
    for (const e of prj.io) l.push(["TAG", "", q(e.tag), q(e.cmt || ""), q(dtFor(e) === "INT" ? "INT" : "BOOL"), '""', '""'].join(","));
    return { name: "Tags.csv", body: l.join("\n") };
  }
  if (plat === "mitsubishi") {
    const l = ['"Label Name","Data Type","Class","Comment","Assign (Device/Label)"'];
    for (const e of prj.io) l.push(['"' + e.tag + '"', '"' + (dtFor(e) === "INT" ? "Word [Signed]" : "Bit") + '"', '"VAR_GLOBAL"', q(e.cmt || ""), '"' + addrFor(plat, e) + '"'].join(","));
    return { name: "GlobalLabels.csv", body: l.join("\n") };
  }
  if (plat === "omron") {
    const l = ["Name\tData Type\tAT\tRetain\tComment"];
    for (const e of prj.io) l.push(e.tag + "\t" + dtFor(e) + "\t\tFALSE\t" + stripDia(e.cmt || ""));
    return { name: "Variables.txt", body: l.join("\n") };
  }
  return { name: "GVL_IO.st", body: genGVL(prj, plat) };
}

export function genReadme(prj: Project, plat: PlatformKey): string {
  const n = prj.devices.length, t = prj.io.length;
  const common = `PROJEKT: ${prj.meta.name || "(bez názvu)"} · ${t} tagů · ${n} zařízení · generováno PLC Studio

SPOLEČNÉ KROKY
1. Vytvoř projekt v IDE a nakonfiguruj HW (CPU + I/O moduly) — HW konfigurace se negeneruje.
2. Naimportuj tagy/proměnné (soubor s tagy níže).
3. Vlož knihovnu šablon (Gen_Library), poté hlavní program (MAIN).
4. Projdi TODO komentáře: ruční povely z HMI, režim AUTO, rozsahy analogů.
5. BEZPEČNOST: E-stop v kódu je jen informativní signál. Skutečné bezpečnostní
   funkce patří do safety relé / F-PLC dle normy (ISO 13849 / IEC 62061) — NIKDY
   je neřeš jen v běžném programu.
6. Otestuj v simulátoru platformy před nasazením na stroj.
`;
  const spec: Record<PlatformKey, string> = {
    siemens: `SIEMENS TIA PORTAL (V17–V21, S7-1200/1500)
- Gen_Tags.tsv: nejjednodušší cesta — otevři prázdnou tabulku tagů a vlož sloupce.
- Gen_IO.xml: import přes Openness (hlavička <Engineering version> musí odpovídat verzi Portalu).
- Gen_Library.scl a Gen_Main.scl: Program blocks → External source files →
  Add new external file → pravý klik → Generate blocks from source (NEJDŘÍV knihovnu).
- Vznikne FB_Machine + InstMachine; volání vlož do OB1 (komentář na konci Gen_Main).
- Doplň diagnostické OB 82/86/121/122, ať CPU nejde do STOP při poruše periferie.
- Test: PLCSIM / PLCSIM Advanced.`,
    rockwell: `ROCKWELL STUDIO 5000 (CompactLogix/ControlLogix)
- Tags.csv: Tools → Import → Tags and Logic Comments. Hlavička (remark + 0.3) je povinná
  a je už v souboru; needituj ho v Excelu (rozbíjí formát).
- Fyzické I/O: v Logix nejsou %I/%Q adresy — vytvoř ALIAS tagy na moduly
  (např. M1_fbkRunning = alias na Local:1:I.Data.0).
- Gen_Library.st: vlož FB jako Add-On Instruction (ST) nebo přepiš na AOI.
- MAIN.st: vlož do ST rutiny v MainProgram.
- POZOR: TON nahraď instrukcí TONR (struktura FBD_TIMER) a WORD → INT/DINT
  (status je generován jako WORD v IEC šabloně — v Logix změň na INT).
  Detekce hran je v kódu ruční, funguje beze změny.
- Test: Logix Echo / emulátor.`,
    beckhoff: `BECKHOFF TWINCAT 3
- NEJRYCHLEJI: PLCopen_Import.xml — PLC projekt → pravý klik → Import PLCopenXML
  (naimportuje FB knihovnu, MAIN i GVL_IO najednou; import je aditivní,
  duplicitní názvy POU smaž předem).
- Ruční cesta: GVL_IO.st: PLC projekt → Add → Global Variable List, vlož obsah.
  Adresy %IX/%QX můžeš nechat a nalinkovat v I/O mapování, nebo použít AT %I*.
- Gen_Library.st: každý FUNCTION_BLOCK vlož jako nový POU (ST).
- MAIN.st: obsah do MAIN (PRG) a zavolej v PlcTask.
- Test: lokální runtime na PC (TwinCAT XAR).`,
    codesys: `CODESYS V3.5 (WAGO, Festo, Eaton…)
- NEJRYCHLEJI: PLCopen_Import.xml — Project → Import PLCopenXML
  (FB knihovna, MAIN i GVL_IO jedním souborem; import je aditivní,
  duplicitní názvy POU hlásí chybu).
- Ruční cesta: GVL_IO.st: Application → Add Object → Global Variable List.
- Gen_Library.st: POU pro každý FB (jazyk ST). Lze i PLCopen XML export/import.
- MAIN.st: do PLC_PRG a přiřaď do tasku.
- Adresy %IX/%QX namapuj v konfiguraci sběrnice (EtherCAT/Profinet…).
- Test: CODESYS Control Win (soft PLC).`,
    mitsubishi: `MITSUBISHI GX WORKS3 (iQ-F/iQ-R)
- GlobalLabels.csv: Navigation → Label → Global Label → import CSV
  (sloupec Assign obsahuje návrh X/Y — ověř dle skutečných modulů; formát CSV
  se liší podle verze GX Works3, srovnej s exportem ze své instalace).
- Gen_Library.st: Function Block do knihovny projektu (jazyk ST).
- MAIN.st: do programu ProgPou (ST).
- Analogy: surová hodnota dle modulu (např. 0–16000 u FX5) → uprav rawMax.
- Test: GX Simulator3.`,
    schneider: `SCHNEIDER ECOSTRUXURE MACHINE EXPERT (M241/M262)
- NEJRYCHLEJI: PLCopen_Import.xml — Import PLCopenXML (báze CODESYS, viz výše).
- Platforma je postavená na CODESYS — ruční postup shodný: GVL, POU (ST), MAIN do tasku.
- Adresy %IX/%QX namapuj na embedded I/O / TM3 moduly v konfiguraci.
- Pro Control Expert (M580) je nutné bloky přenést jako DFB — struktura sedí.
- Test: simulátor v Machine Expert.`,
    omron: `OMRON SYSMAC STUDIO (NX/NJ)
- Variables.txt: zkopíruj do Global Variables (tab-separated sloupce sedí na editor).
- AT sloupec nech prázdný a namapuj na I/O porty zařízení (EtherCAT) v projektu.
- Gen_Library.st: Function Block (ST) do POUs → Functions.
- MAIN.st: do Program0 (ST) a přiřaď do tasku.
- Test: Simulace přímo v Sysmac Studiu.`,
  };
  return common + "\n" + spec[plat];
}

/* genFor žije v generate.ts (skládá codegen + plcopen bez kruhových importů). */
