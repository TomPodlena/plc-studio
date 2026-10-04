/**
 * PLCdesk — generování zdrojových souborů programu pro cílové platformy.
 * Siemens: SCL (external sources) + SimaticML XML + TSV tagů.
 * Ostatní: IEC 61131-3 ST + platformní soubor tagů (GVL / CSV / tab).
 *
 * Hlavní program se skládá z mezivrstvy `buildIR()` (ir.ts): tady jsou renderery IR do ST
 * (Siemens SCL, IEC ST, plochý ST Unitronics); Logix ST píše logix.ts nad stejným IR.
 * Šablony bloků (SCL_* / ST_*) zůstávají zdrojem logiky bloků.
 */
import {
  Project, PlatformKey, Device, IoEntry, PLAT, usedClasses,
  dtFor, addrFor, xmlEsc, stripDia,
} from "./model.js";
import {
  buildIR, irText, cmdIr, IR_CTRL, type IrProgram, type IrFb, type IrDeviceItem, type IrDecl, type IrNames,
  type IrType, type IrFbClass, type IrExpr,
} from "./ir.js";
/* pomocné funkce sekvence a řízení žijí v ir.ts; odsud se dál exportují (veřejné API jádra) */
export {
  limitedAnalogs, waitedDis, actuators, seqVarOf, manVarOf, seqVars, seqCond, seqTimedSteps,
  type SeqCondition,
} from "./ir.js";

/** Role výstupů — krátké popisky do komentářů generovaného kódu (trx). */
const DO_ROLE_TECH: Record<string, string> = {
  run: N_("chod"), fault: N_("porucha"), ready: N_("připraveno"), stopped: N_("stop"), lock: N_("zámek krytů"), auto: N_("AUTO"),
};
import { tr, trx, N_, getLang } from "./i18n.js";
import { genPLCopenXML } from "./plcopen.js";
import { genRockwellL5X, genLogixRoutine, genLogixTagsCsv, lxSlotText, LX_PROGRAM, LX_SOFTWARE_REVISION } from "./logix.js";

/* ------------------------------------------------------------ šablony SCL */

export const SCL_MOTOR = `FUNCTION_BLOCK "FB_Motor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.2
// Šablona: motor/čerpadlo se zpětným hlášením běhu
// Porucha (timeout rozběhu, ztráta hlášení, vstup fault) drží do kvitace (reset).
VAR_INPUT
    enable : Bool;
    cmdStart : Bool;
    cmdStop : Bool;
    reset : Bool;        // kvitace poruchy (hrana)
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
    instTrigReset : R_TRIG;
    instTonFbk : TON_TIME;
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
    #instTrigReset(CLK := #reset);

    CASE #statStep OF
        #STEP_IDLE:
            #outRun := FALSE;
            IF #instTrigStart.Q THEN #statStep := #STEP_STARTING; END_IF;
        #STEP_STARTING:
            #outRun := TRUE;
            IF #fbkRunning THEN #statStep := #STEP_RUNNING; END_IF;
            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;
        #STEP_RUNNING:
            #outRun := TRUE;
            IF NOT #fbkRunning THEN #statStep := #STEP_ERROR; END_IF;
            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;
        #STEP_ERROR:
            #outRun := FALSE;
            IF #instTrigReset.Q AND NOT #fault THEN #statStep := #STEP_IDLE; END_IF;
    END_CASE;

    #instTonFbk(IN := (#statStep = #STEP_STARTING), PT := #T_FBK);
    IF #instTonFbk.Q OR #fault THEN #statStep := #STEP_ERROR; END_IF;

    #busy := (#statStep = #STEP_STARTING);
    #error := (#statStep = #STEP_ERROR);
    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;

export const SCL_VENTIL = `FUNCTION_BLOCK "FB_Ventil"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.2
// Šablona: dvoupolohový ventil/válec s koncovými snímači
// Porucha (timeout přestavení, ztráta polohy otevřeno) drží do kvitace (reset).
VAR_INPUT
    enable : Bool;
    cmdOpen : Bool;
    cmdClose : Bool;
    reset : Bool;        // kvitace poruchy (hrana)
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
    instTrigReset : R_TRIG;
    instTonOpen : TON_TIME;
    instTonClose : TON_TIME;
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
    #instTrigReset(CLK := #reset);

    CASE #statStep OF
        #STEP_CLOSED:
            #outOpen := FALSE;
            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;
        #STEP_OPENING:
            #outOpen := TRUE;
            IF #fbkOpen THEN #statStep := #STEP_OPEN; END_IF;
            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;
        #STEP_OPEN:
            #outOpen := TRUE;
            IF NOT #fbkOpen THEN #statStep := #STEP_ERROR; END_IF;
            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;
        #STEP_CLOSING:
            #outOpen := FALSE;
            IF #fbkClosed THEN #statStep := #STEP_CLOSED; END_IF;
            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;
        #STEP_ERROR:
            #outOpen := FALSE;
            IF #instTrigReset.Q THEN #statStep := #STEP_CLOSED; END_IF;
    END_CASE;

    // každý směr má svůj časovač — obrat uprostřed pohybu začíná měřit znovu
    #instTonOpen(IN := (#statStep = #STEP_OPENING), PT := #T_TRAVEL);
    #instTonClose(IN := (#statStep = #STEP_CLOSING), PT := #T_TRAVEL);
    IF #instTonOpen.Q OR #instTonClose.Q THEN #statStep := #STEP_ERROR; END_IF;

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
    #rawValue := REAL_TO_INT(LIMIT(MN := 0.0, IN := (#value - #scaleMin) / (#scaleMax - #scaleMin) * 27648.0, MX := 27648.0));
END_FUNCTION_BLOCK`;

/* ------------------------------------------------------------- šablony ST */

export const ST_MOTOR = `FUNCTION_BLOCK FB_Motor
(* Sablona: motor/cerpadlo se zpetnym hlasenim behu.
   Porucha (timeout rozbehu, ztrata hlaseni, vstup fault) drzi do kvitace (reset). *)
VAR_INPUT
    enable : BOOL;
    cmdStart : BOOL;
    cmdStop : BOOL;
    reset : BOOL;       (* kvitace poruchy (hrana) *)
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
    lastReset : BOOL;
    trigStart : BOOL;
    trigStop : BOOL;
    trigReset : BOOL;
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
trigReset := reset    AND NOT lastReset;  lastReset := reset;

CASE statStep OF
    0: (* IDLE *)
        outRun := FALSE;
        IF trigStart THEN statStep := 10; END_IF;
    10: (* STARTING *)
        outRun := TRUE;
        IF fbkRunning THEN statStep := 20; END_IF;
        IF trigStop THEN statStep := 0; END_IF;
    20: (* RUNNING *)
        outRun := TRUE;
        IF NOT fbkRunning THEN statStep := 90; END_IF;
        IF trigStop THEN statStep := 0; END_IF;
    90: (* ERROR *)
        outRun := FALSE;
        IF trigReset AND NOT fault THEN statStep := 0; END_IF;
END_CASE;

tonFbk(IN := (statStep = 10), PT := T#3S);
IF tonFbk.Q OR fault THEN statStep := 90; END_IF;

busy := (statStep = 10);
error := (statStep = 90);
IF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;

export const ST_VENTIL = `FUNCTION_BLOCK FB_Ventil
(* Sablona: dvoupolohovy ventil/valec s koncovymi snimaci.
   Porucha (timeout prestaveni, ztrata polohy otevreno) drzi do kvitace (reset). *)
VAR_INPUT
    enable : BOOL;
    cmdOpen : BOOL;
    cmdClose : BOOL;
    reset : BOOL;       (* kvitace poruchy (hrana) *)
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
    lastReset : BOOL;
    trigOpen : BOOL;
    trigClose : BOOL;
    trigReset : BOOL;
    tonOpen : TON;
    tonClose : TON;
END_VAR

IF NOT enable THEN
    outOpen := FALSE; busy := FALSE; error := FALSE;
    status := 16#8001; statStep := 0;
    RETURN;
END_IF;

trigOpen  := cmdOpen  AND NOT lastOpen;   lastOpen  := cmdOpen;
trigClose := cmdClose AND NOT lastClose;  lastClose := cmdClose;
trigReset := reset    AND NOT lastReset;  lastReset := reset;

CASE statStep OF
    0: (* CLOSED *)
        outOpen := FALSE;
        IF trigOpen THEN statStep := 10; END_IF;
    10: (* OPENING *)
        outOpen := TRUE;
        IF fbkOpen THEN statStep := 20; END_IF;
        IF trigClose THEN statStep := 30; END_IF;
    20: (* OPEN *)
        outOpen := TRUE;
        IF NOT fbkOpen THEN statStep := 90; END_IF;
        IF trigClose THEN statStep := 30; END_IF;
    30: (* CLOSING *)
        outOpen := FALSE;
        IF fbkClosed THEN statStep := 0; END_IF;
        IF trigOpen THEN statStep := 10; END_IF;
    90: (* ERROR *)
        outOpen := FALSE;
        IF trigReset THEN statStep := 0; END_IF;
END_CASE;

(* kazdy smer ma svuj casovac - obrat uprostred pohybu zacina merit znovu *)
tonOpen(IN := (statStep = 10), PT := T#5S);
tonClose(IN := (statStep = 30), PT := T#5S);
IF tonOpen.Q OR tonClose.Q THEN statStep := 90; END_IF;

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
VAR
    rawReal : REAL;
END_VAR

rawReal := (value - scaleMin) / (scaleMax - scaleMin) * INT_TO_REAL(rawMax);
IF rawReal < 0.0 THEN
    rawReal := 0.0;
ELSIF rawReal > INT_TO_REAL(rawMax) THEN
    rawReal := INT_TO_REAL(rawMax);
END_IF;
rawValue := REAL_TO_INT(rawReal);
END_FUNCTION_BLOCK`;

/* ------------------------------------------------------- výběr šablony třídy */

/** Dialekt šablon bloků: SCL (Siemens) / IEC ST (ostatní platformy). */
export type FbDialectKey = "scl" | "st";
const FB_TEMPLATES: Record<FbDialectKey, Record<IrFbClass, string>> = {
  scl: { Motor: SCL_MOTOR, Ventil: SCL_VENTIL, AnalogIn: SCL_AI, AnalogOut: SCL_AO },
  st: { Motor: ST_MOTOR, Ventil: ST_VENTIL, AnalogIn: ST_AI, AnalogOut: ST_AO },
};
/**
 * Šablona bloku třídy — jediné místo, kde renderery (Gen_Library, AOI v L5X, plochá logika
 * Unitronics) berou zdroj logiky bloku. Sem se ve fázi 2c napojí vlastní šablony z firemní
 * knihovny (`libraryOverrides`, stejné rozhraní); simulace dál zrcadlí vestavěné šablony.
 */
export function fbTemplate(cls: IrFbClass, dialect: FbDialectKey): string {
  return FB_TEMPLATES[dialect][cls];
}

/* ------------------------------------------------ překlad komentářů šablon */
/* Šablony jsou konstanty modulu (čte je parseFbTemplate, simulátor i testy), proto se
   nepřekládají při sestavení, ale až ve výstupu: `trComments()` přeloží těla komentářů.
   Klíčem je text komentáře bez okolních mezer; zalomení řádku uvnitř komentáře = mezera. */

/** České komentáře šablon bloků — klíče překladu. Úplnost seznamu hlídá `templateComments()`. */
export const TPL_COMMENTS: string[] = [
  /* SCL */
  N_("Šablona: motor/čerpadlo se zpětným hlášením běhu"),
  N_("Porucha (timeout rozběhu, ztráta hlášení, vstup fault) drží do kvitace (reset)."),
  N_("kvitace poruchy (hrana)"),
  N_("Šablona: dvoupolohový ventil/válec s koncovými snímači"),
  N_("Porucha (timeout přestavení, ztráta polohy otevřeno) drží do kvitace (reset)."),
  N_("každý směr má svůj časovač — obrat uprostřed pohybu začíná měřit znovu"),
  N_("Šablona: analogový vstup se škálováním a mezemi (surová hodnota 0..27648)"),
  N_("Šablona: analogový výstup — inženýrské jednotky -> surová hodnota 0..27648"),
  /* ST (bez diakritiky) */
  N_("Sablona: motor/cerpadlo se zpetnym hlasenim behu. Porucha (timeout rozbehu, ztrata hlaseni, vstup fault) drzi do kvitace (reset)."),
  N_("detekce hran"),
  N_("Sablona: dvoupolohovy ventil/valec s koncovymi snimaci. Porucha (timeout prestaveni, ztrata polohy otevreno) drzi do kvitace (reset)."),
  N_("kazdy smer ma svuj casovac - obrat uprostred pohybu zacina merit znovu"),
  N_("Sablona: analogovy vstup se skalovanim a mezemi. rawMax uprav dle platformy: Siemens 27648, Beckhoff 32767, Mitsubishi FX5 16000, Rockwell dle modulu."),
  N_("Sablona: analogovy vystup — inzenyrske jednotky -> surova hodnota"),
];

const COMMENT_RE = /\(\*([\s\S]*?)\*\)|\/\/([^\n]*)/g;
/** Klíč komentáře: text bez okolních mezer, zalomení řádku nahrazeno mezerou. */
const commentKey = (body: string) => body.trim().replace(/\s*\n\s*/g, " ");

/**
 * Komentáře skutečně obsažené v šablonách bloků (jako klíče překladu, bez opakování).
 * Anglické popisky stavů (IDLE, RUNNING…) se nepřekládají, proto tu nejsou.
 * Každý vrácený text musí být v `TPL_COMMENTS`, jinak ho sběr klíčů nevidí.
 */
export function templateComments(): string[] {
  const out = new Set<string>();
  for (const tpl of [SCL_MOTOR, SCL_VENTIL, SCL_AI, SCL_AO, ST_MOTOR, ST_VENTIL, ST_AI, ST_AO]) {
    for (const m of tpl.matchAll(COMMENT_RE)) {
      const key = commentKey(m[1] ?? m[2] ?? "");
      if (key && !/^[A-Z_]+$/.test(key)) out.add(key);
    }
  }
  return [...out];
}

/**
 * Přeloží komentáře `(* … *)` a `// …` v hotovém textu kódu (technický výstup → `trx`).
 * Komentář, který není klíčem překladu (nebo čeština), zůstane znak po znaku beze změny.
 * `fix` upraví přeložený text pro cílový formát (např. `stripDia` u IEC ST); víceřádkový
 * komentář se po překladu znovu zalomí na šířku a odsazení originálu.
 */
export function trComments(code: string, fix: (s: string) => string = s => s): string {
  return code.replace(COMMENT_RE, (all: string, blk?: string, line?: string) => {
    const body = (blk ?? line ?? "").trim();
    const key = commentKey(body);
    const t = key ? trx(key) : key;
    if (t === key) return all;
    let out = fix(t);
    const rows = body.split("\n");
    if (rows.length > 1) {
      const indent = (rows[1].match(/^[ \t]*/) || [""])[0];
      const width = Math.max(60, ...rows.map(r => r.trim().length));
      const wrapped: string[] = [];
      let row = "";
      for (const w of out.split(" ")) {
        if (row && (row + " " + w).length > width) { wrapped.push(row); row = w; }
        else row = row ? row + " " + w : w;
      }
      if (row) wrapped.push(row);
      out = wrapped.join("\n" + indent);
    }
    return all.replace(body, () => out);
  });
}

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
  if (!Number.isFinite(n)) return "0.0";
  if (/e/i.test(String(n))) {                     // IEC REAL literál: mantisa s tečkou + E±n
    const [m, e] = n.toExponential().split("e");
    return (m.includes(".") ? m : m + ".0") + "E" + e;
  }
  return Number.isInteger(n) ? n + ".0" : String(n);
}

/* ------------------------------------------------- renderer IR → ST (SCL / IEC) */

/**
 * Kontext ST rendereru: zápis proměnné (`#x` v SCL), tagu (`"tag"`, `GVL_IO.tag`), členu
 * instance (Unitronics `inst_port`), REAL literálu a komentáře (`//` v SCL, jinak `(* *)`
 * přes `cmtSafe`). Společný pro Siemens, IEC platformy, Unitronics i Logix (před dialektem).
 */
export interface StCtx extends IrNames {
  plat: PlatformKey;
  sie: boolean;
  cm: (t: string) => string;
}
export function stCtx(plat: PlatformKey): StCtx {
  const sie = plat === "siemens";
  return {
    plat, sie, L: locFn(plat), R: refFn(plat), real: fmtR,
    cm: sie ? (t: string) => "// " + t : (t: string) => "(* " + cmtSafe(t) + " *)",
    /* plochá logika Unitronics: stav instance je v globálních tazích s předponou instance */
    ...(plat === "unitronics" ? { M: (inst: string, port: string) => inst + "_" + port } : {}),
  };
}

/**
 * Časový literál IEC: celé sekundy `T#5S`, jinak sekundy + milisekundy `T#1S500MS`
 * (desetinný tvar `T#1.5S` některá IDE nepřijmou).
 */
export function timeLit(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const s = Math.floor(ms / 1000), rest = ms % 1000;
  return rest ? "T#" + (s ? s + "S" : "") + rest + "MS" : "T#" + s + "S";
}

/** Sekvence (CASE) a časovače kroků z IR. */
export function renderSeq(ir: IrProgram, c: StCtx): string {
  const seq = ir.seq;
  if (!seq) return "";
  const L = c.L, C = IR_CTRL, x = (e: IrExpr) => irText(e, c);
  const semi = ";";                               // GX Works3, Sysmac a Logix vyžadují END_IF;
  let b = "    " + c.cm("--- " + trx("Automatická sekvence (režim AUTO)") + " ---") + "\n";
  b += "    " + c.cm(trx("Vypnutí AUTO, ztráta uvolnění nebo porucha stroje: sekvence do kroku 0, povely vypnout")) + "\n";
  b += "    IF " + x(seq.abort) + " THEN\n";
  b += "        " + L(C.seqStep) + " := 0;\n";
  for (const v of seq.outputs) b += "        " + L(v) + " := FALSE;\n";
  b += "    END_IF;\n\n";
  b += "    CASE " + L(C.seqStep) + " OF\n";
  b += "        0: " + c.cm(trx("čekání na start")) + "\n";
  b += "            IF " + x(seq.start) + " THEN " + L(C.seqStep) + " := 10; END_IF" + semi + "\n";
  for (const s of seq.steps) {
    const dev = s.dev ? s.dev.name : "?";
    const title =
      s.op === "dwell" ? trx("výdrž {t} s", { t: s.timeS }) :
      s.op === "waitOn" ? trx("čekat na {dev}", { dev }) :
      s.op === "waitOff" ? trx("čekat na {dev} = FALSE", { dev }) :
      s.op === "run" ? trx("{dev} start", { dev }) :
      s.op === "stop" ? trx("{dev} stop", { dev }) :
      s.op === "open" ? trx("{dev} otevřít", { dev }) :
      s.op === "close" ? trx("{dev} zavřít", { dev }) : trx("krok");
    b += "        " + s.n + ": " + c.cm(trx("Krok {n}: {title}", { n: s.index + 1, title })) + "\n";
    if (s.set) b += "            " + L(s.set.var) + " := " + (s.set.value ? "TRUE" : "FALSE") + ";\n";
    const go = L(C.seqStep) + " := " + s.next + ";";
    if (s.cond.kind === "time") {
      b += "            IF " + L(s.timer!) + ".Q THEN " + go + " END_IF" + semi + "\n";
    } else if (s.cond.kind === "fbk") {
      b += "            IF " + (s.cond.neg ? "NOT " : "") + c.R(s.cond.io!.tag) + " THEN " + go + "\n";
      b += "            ELSIF " + L(s.timer!) + ".Q THEN " + L(C.machineFault) + " := TRUE; " + L(C.faultStep) + " := " + s.n + "; " + c.cm(trx("timeout kroku {t} s", { t: s.timeS })) + "\n";
      b += "            END_IF" + semi + "\n";
    } else {
      const cls = s.dev && s.dev.cls;
      const why = cls === "Ventil" ? trx("bez koncového snímače") : cls === "Motor" ? trx("bez zpětného hlášení") : trx("bez podmínky");
      b += "            IF TRUE THEN " + go + " END_IF" + semi + " " + c.cm(why) + "\n";
    }
  }
  b += "    END_CASE;\n\n";
  for (const s of seq.steps) {
    if (s.timer) b += "    " + L(s.timer) + "(IN := (" + L(C.seqStep) + " = " + s.n + "), PT := " + timeLit(s.timeS) + ");\n";
  }
  return b + "\n";
}

export function seqBody(prj: Project, plat: PlatformKey): string {
  return renderSeq(buildIR(prj), stCtx(plat));
}

/* Surový rozsah analogu dle platformy (typický modul; TODO ověřit podle skutečného modulu).
   Předává se vždy — FX5 nezná počáteční hodnoty a výchozí 27648 je rozsah Siemens. */
const RAW_MAX: Partial<Record<PlatformKey, number>> = { beckhoff: 32767, codesys: 32767, mitsubishi: 16000, schneider: 10000, omron: 32000 };
function rawMaxArg(plat: PlatformKey): string {
  const v = RAW_MAX[plat];
  return v ? ", rawMax := " + v + " (* TODO: " + stripDia(trx("rozsah dle modulu")) + " *)" : "";
}

/** Text do komentáře (* … *): bez diakritiky a pomlček, bez konce řádku; „(*“ a „*)“ z textu
    uživatele rozdělí mezerou (CODESYS/TwinCAT komentáře vnořují — jinak by rozbily zbytek souboru). */
export function cmtSafe(t: string): string {
  return stripDia(t).replace(/[–—]/g, "-").replace(/[\r\n]+/g, " ").replace(/\(\*/g, "( *").replace(/\*\)/g, "* )");
}

/** Text komentáře deklarace řízení (přeložený, s „TODO:" u vstupů z HMI); bez komentáře "". */
export function declNote(d: IrDecl): string {
  return d.note ? (d.todo ? "TODO: " : "") + trx(d.note) : "";
}
/** Typ deklarace v ST platformy (časovač kroku v SCL = TON_TIME). */
function declType(t: IrType, sie: boolean): string {
  return t === "TON" ? (sie ? "TON_TIME" : "TON") : t;
}

/** Deklarace řízení stroje z IR: režimy, kvitace, ruční povely, porucha a sekvence. */
export function renderDecls(ir: IrProgram, c: StCtx): string {
  return ir.decls.map(d => {
    const head = d.name + " : " + declType(d.type, c.sie) + ";";
    if (!d.note) return "    " + head;
    /* pevné proměnné řízení zarovnané do sloupce, ruční povely (proměnná délka) ne */
    return "    " + (d.group === "man" ? head : head.padEnd(20)) + "  " + c.cm(declNote(d));
  }).join("\n");
}

/** Deklarace řízení stroje: režimy, kvitace, ruční povely, porucha a sekvence. */
export function ctrlDecls(prj: Project, plat: PlatformKey): string {
  return renderDecls(buildIR(prj), stCtx(plat));
}

/** Výraz „povel zapnout": sekvence NEBO ruční povel (v ručním režimu). */
export function cmdExpr(prj: Project, plat: PlatformKey, d: Device): string {
  return irText(cmdIr(prj, d), stCtx(plat));
}

/** Zachycení poruchy bloků a kvitace — volá se ZA instancemi (čerstvé výstupy error). */
export function renderFault(ir: IrProgram, c: StCtx): string {
  const f = ir.fault;
  if (!f) return "";
  const L = c.L, C = IR_CTRL;
  const anyErr = f.errors.map(e => irText(e, c)).join(" OR ");
  let b = "    " + c.cm("--- " + trx("Porucha stroje a kvitace") + " ---") + "\n";
  if (anyErr) b += "    IF " + anyErr + " THEN " + L(C.machineFault) + " := TRUE; END_IF;\n";
  b += "    IF " + L(C.cmdAck) + (anyErr ? " AND NOT (" + anyErr + ")" : "") + " THEN " + L(C.machineFault) + " := FALSE;" +
    (f.resetFaultStep ? " " + L(C.faultStep) + " := 0;" : "") + " END_IF;\n";
  return b;
}

export function faultBlock(prj: Project, plat: PlatformKey): string {
  return renderFault(buildIR(prj), stCtx(plat));
}

/* ------------------------------------------------------- zapojení instancí */

interface Wiring { inst: Array<{ n: string; t: string }>; calls: string[]; free: string[]; }

/** Pomocná proměnná pro nezapojený výstup bloku (jinak varování IDE). */
export function tempVarOf(t: IrType): string { return t === "INT" ? "tempUnused2" : "tempUnused"; }

/** Meze AnalogIn v argumentech volání; FX5 nezná počáteční hodnoty → předat vždy (jinak 0 = trvalá porucha). */
function limArgs(b: IrFb, c: StCtx): string {
  const allLim = c.plat === "mitsubishi", x = (n: string) => irText(b.inputs.find(p => p.name === n)!.expr, c);
  const has = (n: string) => b.inputs.some(p => p.name === n);
  return (has("limitHi") ? ", limitHi := " + x("limitHi") : allLim ? ", limitHi := 1.0E+6" : "")
    + (has("limitLo") ? ", limitLo := " + x("limitLo") : allLim ? ", limitLo := -1.0E+6" : "");
}

/**
 * Komentáře volání bloku (text bez značek komentáře): `port` = za vstupem (náhrada chybějícího
 * hlášení, žádaná hodnota), `after` = za celým voláním (AnalogIn: jednotky a mez). Společné
 * pro zápis IEC / SCL (`stCall`) i Logix (členy instance), aby komentáře seděly stejně.
 */
export function stCallNotes(b: IrFb, c: StCtx): { port: Record<string, string>; after?: string } {
  const port: Record<string, string> = {};
  if (b.cls === "Motor" && b.inputs.some(p => p.name === "fbkRunning" && p.src === "default")) port.fbkRunning = trx("bez zpětného hlášení");
  if (b.cls === "AnalogOut") port.value = b.setpoint !== undefined ? trx("žádaná hodnota") + " " + (b.dev.unit || "") : "TODO: " + trx("žádaná hodnota");
  if (b.cls === "AnalogIn") {
    const lim = limArgs(b, c);
    return { port, after: (b.dev.unit || trx("jednotky dle snímače")) + (lim ? "; " + trx("překročení meze = porucha stroje") : "") };
  }
  return { port };
}

/** Volání instance bloku v IEC ST / SCL (`instM1(enable := …, outRun => …);`). */
export function stCall(b: IrFb, c: StCtx): string {
  const L = c.L, x = (n: string) => irText(b.inputs.find(p => p.name === n)!.expr, c);
  const outOf = (n: string) => { const o = b.outputs.find(p => p.name === n)!; return o.tag ? c.R(o.tag) : L(tempVarOf(o.type)); };
  const notes = stCallNotes(b, c);
  /* analogy: zhuštěné rozložení (škálování na jednom řádku), rawMax dle platformy */
  if (b.cls === "AnalogIn") {
    return L(b.inst) + "(rawValue := " + x("rawValue") + ",\n" +
      "        scaleMin := " + x("scaleMin") + ", scaleMax := " + x("scaleMax") + rawMaxArg(c.plat) + limArgs(b, c) + "); " + c.cm(notes.after!);
  }
  if (b.cls === "AnalogOut") {
    return L(b.inst) + "(value := " + x("value") + ", " + c.cm(notes.port.value) + "\n" +
      "        scaleMin := " + x("scaleMin") + ", scaleMax := " + x("scaleMax") + rawMaxArg(c.plat) + ",\n" +
      "        rawValue => " + outOf("rawValue") + ");";
  }
  /* obecné rozložení (i pro nové třídy): port na řádek, komentář za čárkou */
  const parts = [
    ...b.inputs.map(p => ({ text: p.name + " := " + irText(p.expr, c), note: notes.port[p.name] as string | undefined })),
    ...b.outputs.map(o => ({ text: o.name + " => " + outOf(o.name), note: undefined as string | undefined })),
  ];
  return L(b.inst) + "(" + parts.map((p, i) => i < parts.length - 1
    ? p.text + "," + (p.note ? " " + c.cm(p.note) : "") + "\n        "
    : p.text + ");").join("") + (notes.after !== undefined ? " " + c.cm(notes.after) : "");
}

/** Titulek zařízení v komentáři nad voláním (IEC / SCL). */
function devTitle(d: Device): string {
  return (d.name + (d.desc ? " – " + d.desc : "")).replace(/[\r\n]+/g, " ");
}
/** Přiřazení výstupu s rolí (stav stroje). */
function roleLine(c: StCtx, tag: string, role: string, expr: string): string {
  return c.R(tag) + " := " + expr + "; " + c.cm(trx("vazba na stav stroje: {role}", { role: trx(DO_ROLE_TECH[role]) }));
}
/** Řádek volného signálu (komentář s adresou platformy) v IEC ST / SCL. */
export function freeLine(c: StCtx, e: IoEntry): string {
  const sie = c.sie;
  return "    " + (sie ? "//" : "(*") + "   " + ((sie ? e.addr : addrFor(c.plat, e)) || "").padEnd(8) + " " + c.R(e.tag) + "  " + (sie ? e.cmt : cmtSafe(e.cmt) + " *)");
}

/**
 * Instance, volání bloků / rolí a volné signály z IR (pořadí zařízení; bez vstupů uvolnění).
 * `o.call` / `o.free` = jiný zápis volání bloku / řádku volného signálu (Logix).
 */
export function renderWiring(ir: IrProgram, c: StCtx, o: { call?: (b: IrFb) => string; free?: (e: IoEntry) => string } = {}): Wiring {
  const call = o.call || ((b: IrFb) => stCall(b, c)), freeOf = o.free || ((e: IoEntry) => freeLine(c, e));
  const inst: Array<{ n: string; t: string }> = [], calls: string[] = [], free: string[] = [];
  for (const it of ir.devices) {
    const title = "    " + c.cm(devTitle(it.dev));
    if (it.kind === "fb") {
      inst.push({ n: it.inst, t: it.fb });
      calls.push(title + "\n    " + call(it));
    } else if (it.kind === "role") {
      const expr = irText(it.expr, c);
      for (const e of it.outs) calls.push(title + "\n    " + roleLine(c, e.tag, it.role, expr));
    } else if (it.kind === "free") {
      for (const e of it.io) free.push(freeOf(e));
    }
    /* enableInput: čte enable; seqInput: čte krok čekání */
  }
  return { inst, calls, free };
}

export function wiring(prj: Project, plat: PlatformKey): Wiring {
  return renderWiring(buildIR(prj), stCtx(plat));
}

/** Nezapojené výstupy bloků → potřebné pomocné proměnné (BOOL / INT). */
export function irUnused(ir: IrProgram): { bool: boolean; int: boolean } {
  const outs = ir.devices.flatMap(it => it.kind === "fb" ? it.outputs.filter(o => !o.tag) : []);
  return { bool: outs.some(o => tempVarOf(o.type) === "tempUnused"), int: outs.some(o => tempVarOf(o.type) === "tempUnused2") };
}

/**
 * Výraz centrálního uvolnění: E-stop AND blokovací vstupy (kryty, závory…) + poznámka.
 * FALSE kteréhokoli vstupu = enable FALSE → bloky vypnou výstupy, sekvence do kroku 0.
 */
export function renderEnable(ir: IrProgram, c: StCtx): { expr: string; note: string } {
  const sie = c.sie;
  const ins = ir.enable.inputs;
  if (!ins.length) return { expr: "TRUE", note: "TODO: " + (sie ? trx("napojit bezpečnostní okruh!") : stripDia(trx("napojit bezpečnostní okruh!"))) };
  const notes: string[] = [];
  if (ins.some(x => x.estop)) notes.push(sie ? trx("E-stop NC: TRUE = OK — doplň celý bezpečnostní okruh!")
    : stripDia(trx("E-stop NC: TRUE = OK - doplnit cely bezpecnostni okruh!")));
  else notes.push("TODO: " + (sie ? trx("napojit bezpečnostní okruh!") : stripDia(trx("napojit bezpečnostní okruh!"))));
  const il = ins.filter(x => !x.estop);
  if (il.length) {
    const t = trx("blokování {list}: FALSE = stroj stojí", { list: il.map(x => x.dev.name).join(", ") });
    notes.push(sie ? t : stripDia(t));
  }
  return { expr: ins.map(x => c.R(x.tag)).join(" AND "), note: notes.join("; ") };
}
/** Uvolnění jako text pro přiřazení `enable := …` (výraz + komentář). */
export function enableText(ir: IrProgram, c: StCtx): string {
  const e = renderEnable(ir, c);
  return e.expr + " " + (c.sie ? "// " + e.note : "(* " + e.note + " *)");
}
export function enableExpr(prj: Project, plat: PlatformKey): string {
  return enableText(buildIR(prj), stCtx(plat));
}

/* ------------------------------------------------------- soubory: Siemens */

/** Kultura komentáře tagu v SimaticML — musí být mezi jazyky projektu TIA (Project languages). */
const TIA_CULTURE: Record<string, string> = { cs: "cs-CZ", en: "en-US", de: "de-DE", es: "es-ES", zh: "zh-CN" };

export function genSiemensTagsXml(prj: Project): string {
  let id = 0; const nid = () => (id++).toString();
  let x = '<?xml version="1.0" encoding="utf-8"?>\n<Document>\n  <Engineering version="V21" />\n  <SW.Tags.PlcTagTable ID="' + nid() + '">\n    <AttributeList>\n      <Name>Gen_IO</Name>\n    </AttributeList>\n    <ObjectList>\n';
  for (const e of prj.io) {
    x += '      <SW.Tags.PlcTag ID="' + nid() + '" CompositionName="Tags">\n        <AttributeList>\n          <DataTypeName>' + (dtFor(e) === "INT" ? "Int" : "Bool") + '</DataTypeName>\n          <LogicalAddress>' + xmlEsc(e.addr) + '</LogicalAddress>\n          <Name>' + xmlEsc(e.tag) + '</Name>\n        </AttributeList>\n';
    if (e.cmt) x += '        <ObjectList>\n          <MultilingualText ID="' + nid() + '" CompositionName="Comment">\n            <ObjectList>\n              <MultilingualTextItem ID="' + nid() + '" CompositionName="Items">\n                <AttributeList>\n                  <Culture>' + TIA_CULTURE[getLang()] + '</Culture>\n                  <Text>' + xmlEsc(e.cmt) + '</Text>\n                </AttributeList>\n              </MultilingualTextItem>\n            </ObjectList>\n          </MultilingualText>\n        </ObjectList>\n';
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
    ? "// Gen_Library.scl – " + trx("knihovna šablon (generováno PLCdesk)") + "\n// " + trx("Import: External source files → Generate blocks from source (PŘED Gen_Main)")
    : "(* Gen_Library.st - " + stripDia(trx("knihovna šablon (generováno PLCdesk)")) + " - " + PLAT[plat].name + " *)";
  parts.push(hdr, "");
  const dia: FbDialectKey = plat === "siemens" ? "scl" : "st";
  /* komentáře šablon se překládají až tady; IEC ST zůstává bez diakritiky */
  const fix = plat === "siemens" ? undefined : stripDia;
  for (const c of ["Motor", "Ventil", "AnalogIn", "AnalogOut"] as const) if (u.has(c)) parts.push(trComments(fbTemplate(c, dia), fix), "");
  if (parts.length <= 2) parts.push(plat === "siemens" ? "// (" + trx("žádné instancované třídy zařízení") + ")" : "(* " + cmtSafe(trx("žádné instancované třídy zařízení")) + " *)");
  return parts.join("\n");
}

export function genMainSiemens(prj: Project): string {
  const ir = buildIR(prj), c = stCtx("siemens");
  const { inst, calls, free } = renderWiring(ir, c);
  const decl = renderDecls(ir, c), fault = renderFault(ir, c), en = renderEnable(ir, c);
  let v = inst.map(i => '    ' + i.n + ' : "' + i.t + '";').join("\n");
  if (decl) v += (v ? "\n" : "") + decl;
  const tmp = tmpDecl(ir, "Bool", "Int");
  return `// ${trx("Gen_Main.scl – strojní blok (multi-instance). Import PO Gen_Library.scl.")}

FUNCTION_BLOCK "FB_Machine"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.2
VAR_INPUT
    enableIn : Bool;   // ${trx("centrální uvolnění zvenku (OB1)")}
END_VAR
VAR
    enable : Bool;
${v || "    // " + trx("žádné instance")}
END_VAR
${tmp ? "VAR_TEMP" + tmp + "\nEND_VAR\n" : ""}
BEGIN
    #enable := #enableIn;

${renderSeq(ir, c)}${calls.join("\n\n") || "    ;"}${fault ? "\n\n" + fault.trimEnd() : ""}

    // ${trx("Volné signály (DI/DO) pro vlastní logiku:")}
${free.join("\n") || "    //   (" + trx("žádné") + ")"}
END_FUNCTION_BLOCK

DATA_BLOCK "InstMachine"
{ S7_Optimized_Access := 'TRUE' }
"FB_Machine"
BEGIN
END_DATA_BLOCK

(* --- ${trx("Vložit do OB1 (Main)")} ---------------------------------
   "InstMachine"(enableIn := ${en.expr});
   // ${en.note.trim()}
   ----------------------------------------------------------- *)`;
}

/* ----------------------------------------------------------- soubory: IEC */

export function genGVL(prj: Project, plat: PlatformKey): string {
  const lines = ["(* GVL_IO - " + stripDia(trx("globální proměnné / fyzické I/O - generováno PLCdesk")) + " *)", "{attribute 'qualified_only'}", "VAR_GLOBAL"];
  for (const e of prj.io) {
    const at = addrFor(plat, e);
    lines.push("    " + e.tag + (at ? " AT " + at : "") + " : " + dtFor(e) + ";" + (e.cmt ? " (* " + cmtSafe(e.cmt) + " *)" : ""));
  }
  lines.push("END_VAR");
  return lines.join("\n");
}

/** Deklarace pomocných proměnných jen pro výstupy, které se nečtou (jinak varování IDE). */
function tmpDecl(ir: IrProgram, b: string, i: string): string {
  const u = irUnused(ir);
  return (u.bool ? "\n    " + tempVarOf("BOOL") + " : " + b + ";" : "") + (u.int ? "\n    " + tempVarOf("INT") + " : " + i + ";" : "");
}

export function genMainIEC(prj: Project, plat: PlatformKey): string {
  const ir = buildIR(prj), c = stCtx(plat);
  const { inst, calls, free } = renderWiring(ir, c);
  const decl = renderDecls(ir, c), fault = renderFault(ir, c);
  let v = inst.map(i => "    " + i.n + " : " + i.t + ";").join("\n");
  if (decl) v += (v ? "\n" : "") + decl;
  return `(* MAIN - ${stripDia(trx("hlavní program (generováno PLCdesk)"))} - ${PLAT[plat].name} *)
PROGRAM MAIN
VAR
    enable : BOOL;
${v || "    (* " + stripDia(trx("žádné instance")) + " *)"}${tmpDecl(ir, "BOOL", "INT")}
END_VAR

enable := ${enableText(ir, c)};

${renderSeq(ir, c)}${calls.join("\n\n") || ";"}${fault ? "\n\n" + fault.trimEnd() : ""}

(* ${stripDia(trx("Volné signály (DI/DO) pro vlastní logiku:"))} *)
${free.join("\n") || "(*   " + stripDia(trx("žádné")) + " *)"}
END_PROGRAM`;
}

/* P1: Rockwell CSV s povinnou hlavičkou (remark + verze 0.3), INT místo WORD. */
export function genTagFile(prj: Project, plat: PlatformKey): { name: string; body: string } {
  const q = (s: string) => '"' + stripDia(s).replace(/"/g, "'") + '"';
  if (plat === "rockwell") return { name: "Tags.csv", body: genLogixTagsCsv(prj) };   // logix.ts
  if (plat === "mitsubishi") {
    const l = ['"Label Name","Data Type","Class","Comment","Assign (Device/Label)"'];
    for (const e of prj.io) l.push(['"' + e.tag + '"', '"' + (dtFor(e) === "INT" ? "Word [Signed]" : "Bit") + '"', '"VAR_GLOBAL"', '"' + uniAscii(e.cmt || "").replace(/"/g, "'") + '"', '"' + addrFor(plat, e) + '"'].join(","));
    return { name: "GlobalLabels.csv", body: l.join("\n") };
  }
  if (plat === "omron") {
    /* sloupce jako tabulka Global Variables v Sysmac Studiu: Name, Data Type, Initial Value, AT,
       Retain, Constant, Network Publish, Comment — bez hlavičky (vložila by se jako proměnná) */
    const l: string[] = [];
    for (const e of prj.io) l.push([e.tag, dtFor(e), "", "", "", "", "", uniAscii(e.cmt || "")].join("\t"));
    return { name: "Variables.txt", body: l.join("\n") };
  }
  return { name: "GVL_IO.st", body: genGVL(prj, plat) };
}

/**
 * README.txt k platformě — dokument pro člověka (→ `tr`). Klíč překladu = odstavec, odrážka
 * nebo číslovaný krok; u zalomených odstavců je zalomení a odsazení pokračovacích řádků
 * součástí klíče (prostý text s pevnou šířkou řádku). Číslo kroku a odrážka zůstávají mimo.
 */
export function genReadme(prj: Project, plat: PlatformKey): string {
  const steps = [
    tr("Vytvoř projekt v IDE a nakonfiguruj HW (CPU + I/O moduly) — HW konfigurace se negeneruje."),
    plat === "unitronics"
      ? tr("Založ tagy podle seznamu Tags.csv (postup níže).")
      : plat === "rockwell"
      ? tr("Naimportuj program PLCdesk_Program.L5X — obsahuje tagy, Add-On Instructions i rutinu (postup níže).")
      : tr("Naimportuj tagy/proměnné (soubor s tagy níže)."),
    plat === "unitronics"
      ? tr("Vlož logiku stroje (Machine.st) do ST funkce — knihovna šablon se u této platformy negeneruje.")
      : plat === "rockwell"
      ? tr("Připoj I/O tagy na body modulů (aliasy, postup níže).")
      : tr("Vlož knihovnu šablon (Gen_Library), poté hlavní program (MAIN)."),
    tr(`Napoj HMI na proměnné strojního bloku (TODO komentáře): modeAuto (přepínač AUTO / ruční),
   cmdAutoStart (start cyklu), cmdAck (kvitace poruchy), manRun_* / manOpen_* (ruční povely
   zařízení — platí při vypnutém AUTO). Stav poruchy: machineFault, krok s timeoutem: faultStep.
   Chování: chyba kteréhokoli bloku nebo timeout kroku zastaví sekvenci a vypne její povely;
   nový start je možný až po odstranění příčiny a kvitaci. Zkontroluj rozsahy analogů.`),
    tr(`BEZPEČNOST: E-stop v kódu je jen informativní signál. Skutečné bezpečnostní
   funkce patří do safety relé / F-PLC dle normy (ISO 13849 / IEC 62061) — NIKDY
   je neřeš jen v běžném programu.`),
    tr("Otestuj v simulátoru platformy před nasazením na stroj."),
  ];
  const common = tr("PROJEKT: {name} · {tags} tagů · {devs} zařízení · generováno PLCdesk",
    { name: prj.meta.name || tr("(bez názvu)"), tags: prj.io.length, devs: prj.devices.length }) + "\n\n" +
    tr("SPOLEČNÉ KROKY") + "\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n") + "\n";
  /* nadpis (název produktu se nepřekládá) + odrážky */
  const list = (title: string, ...items: string[]) => title + "\n" + items.map(s => "- " + s).join("\n");
  const spec: Record<PlatformKey, () => string> = {
    siemens: () => list("SIEMENS TIA PORTAL (V17–V21, S7-1200/1500)",
      tr("Gen_Tags.tsv: otevři v Excelu (UTF-8, oddělovač tabulátor), list přejmenuj na „PLC Tags“, ulož jako .xlsx a v tabulce tagů dej Import (sloupce Name / Data Type / Logical Address / Comment odpovídají formátu TIA)."),
      tr("Gen_IO.xml: import přes Openness. Pro V17–V20 přepiš v hlavičce Engineering version V21 na svou verzi; jazyk komentářů (Culture) musí být mezi jazyky projektu."),
      tr("Adresy jsou návrh (analogy od %IW64 = integrované AI S7-1200) — srovnej je se start address modulů v Device configuration."),
      tr("cmdAutoStart je úrovňový povel — napoj ho na tlačítko (puls), ne na přepínač, jinak se po skončení cyklu hned spustí další."),
      tr(`Gen_Library.scl a Gen_Main.scl: Program blocks → External source files →
  Add new external file → pravý klik → Generate blocks from source (NEJDŘÍV knihovnu).`),
      tr("Vznikne FB_Machine + InstMachine; volání vlož do OB1 (komentář na konci Gen_Main)."),
      tr("Doplň diagnostické OB 82/86/121/122, ať CPU nejde do STOP při poruše periferie."),
      tr("Test: PLCSIM / PLCSIM Advanced.")),
    rockwell: () => list(
      tr("ROCKWELL STUDIO 5000 LOGIX DESIGNER (CompactLogix 5380 / ControlLogix 5580) — soubory PLCdesk_Program.L5X, MainRoutine.st a Tags.csv") + "\n" +
      tr(`POZOR — NEOVĚŘENO PŘEKLADEM: výstup pro Logix nebyl zkoušen ve Studiu 5000. Struktura L5X
vychází z příručky 1756-RM014 a reálných exportů. Při prvním importu zkontroluj hlášení importu
a Verify Controller (hlavně FBD_TIMER v AOI, výchozí hodnoty parametrů a verzi souboru).`) + "\n",
      tr(`PLCdesk_Program.L5X (hlavní cesta): v Controller Organizer pravý klik na MainTask →
  Add → Import Program… a vyber soubor. Vznikne program {prog} s rutinou MainRoutine (ST)
  a programovými tagy, Add-On Instructions FB_Motor / FB_Ventil / FB_AnalogIn / FB_AnalogOut
  a I/O tagy (controller scope). Pak Verify Controller. Soubor nese verzi {rev} — pro starší
  verzi Logix Designeru uprav atribut SoftwareRevision.`, { prog: LX_PROGRAM, rev: LX_SOFTWARE_REVISION }),
      tr(`Bloky zařízení jsou Add-On Instructions (ST) ze stejných šablon jako u ostatních platforem:
  TON → TONR (FBD_TIMER, PRE v ms se nastaví před voláním), WORD → DINT, RETURN → ELSE.
  Instance se volají přes členy: instM1.enable := …; FB_Motor(instM1); M1_outRun := instM1.outRun;`),
      tr(`I/O tagy jsou po importu běžné tagy (BOOL / REAL) bez vazby na hardware. Připoj je na body
  modulů: vlastnosti tagu → Type: Alias → Alias For (např. M1_fbkRunning → Local:1:I.Pt00.Data
  u modulů 5069 / CompactLogix 5380; u starších modulů 1769 je to Local:1:I.Data.0), nebo
  importem Tags.csv (níže). Navržený bod modulu je v popisu každého I/O tagu.`),
      tr(`Tags.csv (náhradní cesta): Tools → Import → Tags and Logic Comments. I/O jsou v něm ALIAS
  na Local:<slot>:I.Pt<nn>.Data (DI/DO) a Ch<nn>.Data (AI/AO) podle předpokládaného osazení
  lokálních slotů: {slots}. Moduly musí v I/O Configuration existovat dřív než import; když se
  osazení liší, uprav sloupec SPECIFIER. Programové tagy mají SCOPE {prog}, instance bloků
  (FB_*) projdou jen tehdy, když jsou AOI už v projektu (z L5X). Soubor needituj v Excelu.`,
        { slots: lxSlotText(prj) || tr("(nejde odvodit z adres — aliasy doplň ručně)"), prog: LX_PROGRAM }),
      tr("MainRoutine.st: totéž tělo rutiny jako v L5X, bez deklarací — pro ruční vložení do ST rutiny."),
      tr(`Analogy: moduly 5069-IF8 / 5069-OF4 dávají a berou Chxx.Data jako REAL. V konfiguraci modulu
  nastav Low/High Engineering 0–100 (procenta rozsahu); bloky přepočítají 0–100 % na
  scaleMin…scaleMax (rawMax = 100.0).`),
      tr("Stavová slova status jsou DINT: 16#8001 blokováno, 16#8002 porucha (do INT se 16#8001 nevejde)."),
      tr(`Nejkratší test: nový projekt CompactLogix 5380 (např. 5069-L306ER) s moduly podle osazení
  výše → Import Program (L5X) → Verify Controller bez chyb → Logix Echo nebo emulátor: modeAuto := 1,
  puls cmdAutoStart a sleduj seqStep a výstupy.`)),
    beckhoff: () => list("BECKHOFF TWINCAT 3",
      tr("NEJRYCHLEJI: PLCopen_Import.xml — PLC projekt → pravý klik → Import PLCopenXML (knihovna bloků, MAIN i GVL_IO najednou; import je aditivní, duplicitní POU předem smaž). Ruční cesta je níže."),
      tr(`GVL_IO.st: PLC projekt → Add → Global Variable List, vlož obsah.
  Adresy %IX/%QX můžeš nechat a nalinkovat v I/O mapování, nebo použít AT %I*.`),
      tr("Gen_Library.st: každý FUNCTION_BLOCK vlož jako nový POU (ST)."),
      tr("MAIN.st: obsah do MAIN (PRG) a zavolej v PlcTask."),
      tr("Test: lokální runtime na PC (TwinCAT XAR).")),
    codesys: () => list("CODESYS V3.5 (WAGO, Festo, Eaton…)",
      tr("NEJRYCHLEJI: PLCopen_Import.xml — Project → Import PLCopenXML (knihovna bloků, MAIN i GVL_IO najednou; import je aditivní, duplicitní POU hlásí chybu). Ruční cesta je níže."),
      tr("GVL_IO.st: Application → Add Object → Global Variable List s názvem přesně GVL_IO (MAIN píše GVL_IO.<tag>), obsah nahraď."),
      tr("Gen_Library.st / MAIN.st: editor POU má dvě části — do HORNÍ (deklarace) vlož řádky od FUNCTION_BLOCK / PROGRAM po poslední END_VAR, do DOLNÍ (implementace) zbytek BEZ END_FUNCTION_BLOCK / END_PROGRAM. Každý blok jako nový POU (Function Block, ST)."),
      tr("MAIN: vytvoř POU „MAIN“ (Program, ST) a přidej ho do MainTask místo PLC_PRG."),
      tr("Adresy jsou návrh (analogy jako index slova: %IW32 = bajty 64–65) — porovnej s I/O mapováním zařízení (WAGO: analogové moduly jsou v obrazu procesu první), nebo AT smaž a namapuj GVL_IO v I/O Mapping."),
      tr("Test: CODESYS Control Win (soft PLC).")),
    mitsubishi: () => list("MITSUBISHI GX WORKS3 (iQ-F/iQ-R)",
      tr(`GlobalLabels.csv: Navigation → Label → Global Label → import CSV
  (sloupec Assign obsahuje návrh X/Y — ověř dle skutečných modulů; formát CSV
  se liší podle verze GX Works3, srovnej s exportem ze své instalace).`),
      tr("Gen_Library.st: Function Block do knihovny projektu (jazyk ST)."),
      tr("MAIN.st: GX Works3 edituje tělo programu odděleně od návěští — do ProgPou (ST) vlož jen tělo (od řádku za END_VAR po END_PROGRAM) a lokální návěští založ podle bloku VAR."),
      tr("Adresy X/Y jsou pro FX5 osmičkové (X0–X7, X10…); analogy přiřaď na SD6020 / SD6060 (vestavěné AI) nebo vyrovnávací paměť modulu U…\\G…; rawMax je v kódu 16000 (TODO podle modulu)."),
      tr("TON na FX5 bere nejvýš 32767 ms — kroky s delším časem kontrola návrhu hlásí; uprav je (např. TIMER_100_FB_M nebo rozdělení kroku)."),
      tr("Test: GX Simulator3.")),
    schneider: () => list("SCHNEIDER ECOSTRUXURE MACHINE EXPERT (M241/M262)",
      tr("NEJRYCHLEJI: PLCopen_Import.xml — Project → Import PLCopenXML (báze CODESYS: knihovna bloků, MAIN i GVL_IO najednou). Ruční cesta je níže."),
      tr("Platforma je postavená na CODESYS — postup shodný: GVL, POU (ST), MAIN do tasku."),
      tr("Adresy %IX/%QX namapuj na embedded I/O / TM3 moduly v konfiguraci."),
      tr("Pro Control Expert (M580) je nutné bloky přenést jako DFB — struktura sedí."),
      tr("Test: simulátor v Machine Expert.")),
    omron: () => list("OMRON SYSMAC STUDIO (NX/NJ)",
      tr("Variables.txt: v Global Variables vyber první prázdnou buňku sloupce Name a vlož (Ctrl+V) — sloupce Name, Data Type, Initial Value, AT, Retain, Constant, Network Publish, Comment."),
      tr("AT sloupec nech prázdný a namapuj na I/O porty zařízení (EtherCAT) v projektu."),
      tr("Gen_Library.st: každý blok jako Function Block (ST) do POUs → Function Blocks; vstup kvitace se jmenuje resetIn (Reset je instrukce Sysmac)."),
      tr("MAIN.st: Sysmac edituje tělo programu odděleně od proměnných — do Program0 (ST) vlož jen tělo (od řádku za END_VAR po END_PROGRAM) a proměnné z bloku VAR založ v tabulce lokálních proměnných."),
      tr("rawMax analogů je v kódu 32000 s poznámkou TODO — uprav podle rozsahu svého modulu NX."),
      tr("Test: Simulace přímo v Sysmac Studiu.")),
    unitronics: () => list(
      tr("UNITRONICS UNILOGIC (řada UniStream) — soubory Tags.csv a Machine.st") + "\n" +
      tr(`POZOR — NEOVĚŘENO PŘEKLADEM: výstup pro Unitronics nebyl zkoušen v UniLogic. Při prvním
vložení zkontroluj syntaxi proti své verzi (CASE, volání TON, převody TO_REAL / TO_INT).`) + "\n",
      tr(`UniLogic programuje UniStream v Ladderu, C a Structured Textu. ST se píše jako FUNKCE,
  která nemá vlastní paměť (lokální tagy mezi voláními hodnotu nedrží). Logika bloků je
  proto rozepsaná „naplocho" do jedné funkce a veškerý stav je v globálních tazích
  s předponou instance (instM1_statStep, instY1_tonOpen…). Knihovna Gen_Library se
  u této platformy negeneruje.`),
      /* názvy skupin jsou v Tags.csv technický výstup (trx) — sem se dosazují stejné */
      tr(`Tags.csv: seznam tagů k založení jako GLOBÁLNÍ (skupiny I/O = fyzické signály,
  {prog} a {block} = stav logiky, {timer} = instance TON). UniLogic importuje jen
  soubor, který sám exportoval: buď tagy založ ručně, nebo vyexportuj prázdnou šablonu
  (PLC → Import/Export), doplň ji podle Tags.csv a naimportuj zpět. I/O tagy pak přiřaď
  vstupům a výstupům v konfiguraci hardwaru (sloupec „I/O address hint" je jen vodítko).`,
        { prog: trx("Program"), block: trx("Blok"), timer: trx("Program – časovač") }),
      tr(`Machine.st: pravý klik na modul → Add Structured Text Function, vlož obsah a funkci
  volej každý scan z hlavní ladder rutiny.`),
      tr("Globální tagy vidí ST funkce jen přes seznam Used Globals (vlastnosti funkce) — přidej do něj všechny tagy z Tags.csv."),
      tr(`Časovače: kód používá IEC bloky TON s literály T#…S — v ST editoru UniLogic jsou až od
  verze z května 2026. Ve starší verzi je nahraď ladder časovači (bit „hotovo" místo .Q).`),
      tr("Stavová slova jsou desítkově: 32769 = 16#8001 blokováno, 32770 = 16#8002 porucha."),
      tr(`Vision / Samba (VisiLogic) Structured Text nemá — tam Machine.st slouží jako předloha
  pro přepis do Ladderu a Tags.csv jako seznam operandů.`),
      tr("Test: nejdřív na PLC s odpojenými akčními členy.")),
  };
  return common + "\n" + spec[plat]();
}

/* ---------------------------------------------------- soubory: Unitronics */
/* UniLogic (UniStream) píše ST jako FUNKCE bez vlastní paměti — lokální tagy
   mezi voláními hodnotu nedrží. Bloky zařízení se proto nevolají jako instance,
   ale ROZEPÍŠÍ přímo do kódu: každá proměnná šablony dostane předponu instance
   a stane se globálním tagem. Zdroj je táž šablona ST_MOTOR / ST_VENTIL… jako
   u ostatních platforem, takže chování (i simulace) zůstává shodné. */

interface FbVar { name: string; type: string; init: string; kind: "in" | "out" | "var"; }

/** Proměnné a tělo šablony FB zapsané v IEC ST. */
export function parseFbTemplate(tpl: string): { vars: FbVar[]; body: string } {
  const vars: FbVar[] = [];
  const re = /(?<![A-Z_])VAR(_INPUT|_OUTPUT)?[ \t]*\n([\s\S]*?)END_VAR/g;
  let m: RegExpExecArray | null, last = 0;
  while ((m = re.exec(tpl))) {
    const kind = m[1] === "_INPUT" ? "in" : m[1] === "_OUTPUT" ? "out" : "var";
    for (const line of m[2].split("\n")) {
      const v = line.match(/^\s*(\w+)\s*:\s*(\w+)\s*(?::=\s*([^;]+))?;/);
      if (v) vars.push({ name: v[1], type: v[2], init: (v[3] || "").trim(), kind });
    }
    last = re.lastIndex;
  }
  return { vars, body: tpl.slice(last, tpl.lastIndexOf("END_FUNCTION_BLOCK")).trim() };
}

/** Čisté ASCII pro soubory Unitronics (názvy a komentáře bez diakritiky a typografie). */
function uniAscii(s: string): string {
  return stripDia(s).replace(/[—–]/g, "-").replace(/°/g, "deg").replace(/[„“”]/g, '"').replace(/[^\x00-\x7F]/g, "?");
}

/** Dialekt UniLogic: středníky za END_IF, desítkové konstanty, převodní funkce TO_*. */
function uniDialect(st: string): string {
  return st.replace(/END_IF(?!;)/g, "END_IF;")
    .replace(/16#8001/g, "32769").replace(/16#8002/g, "32770").replace(/16#0000/g, "0")
    .replace(/INT_TO_REAL\(/g, "TO_REAL(").replace(/REAL_TO_INT\(/g, "TO_INT(");
}

/**
 * Rozepíše blok šablony pro jednu instanci: vstupy se přiřadí (zapojení, jinak
 * výchozí hodnota šablony), tělo se přepíše na proměnné s předponou instance
 * a výstupy se zkopírují do tagů. Předčasný návrat (RETURN při enable = FALSE)
 * se převede na větev ELSE — v ploché funkci by RETURN ukončil celý program.
 */
export function inlineFb(tpl: string, inst: string, wired: Record<string, string>, outs: Record<string, string>): string {
  const { vars, body } = parseFbTemplate(tpl);
  const P = (n: string) => inst + "_" + n;
  const lines: string[] = [];
  for (const v of vars) {
    if (v.kind !== "in") continue;
    const src = wired[v.name] ?? v.init;
    if (src) lines.push(P(v.name) + " := " + src + ";");
  }
  let b = body;
  const ret = /\n[ \t]*RETURN;[ \t]*\nEND_IF;/;
  if (ret.test(b)) {
    const [head, rest] = b.split(ret);
    b = head + "\nELSE\n" + rest.trim().split("\n").map(l => l ? "    " + l : l).join("\n") + "\nEND_IF;";
  }
  for (const v of vars) b = b.replace(new RegExp("\\b" + v.name + "\\b", "g"), P(v.name));
  lines.push(...b.split("\n"));
  for (const [name, tag] of Object.entries(outs)) lines.push(tag + " := " + P(name) + ";");
  return uniDialect(lines.map(l => l ? "    " + l : l).join("\n"));
}

const UNI_TYPE: Record<string, string> = { BOOL: "BIT", INT: "INT16", WORD: "UINT16", REAL: "REAL", TON: "TON" };

/**
 * Zařazení zařízení v ploché logice Unitronics: vstupy uvolnění se nerozepisují, jen E-stop
 * se počítá podle svého zařazení bez uvolnění (vypisuje se i mezi volnými signály).
 */
function uniItems(ir: IrProgram): IrDeviceItem[] {
  return ir.devices.flatMap(it => it.kind !== "enableInput" ? [it] : it.estop ? [it.alt] : []);
}

/** Tagy k založení v UniLogic: fyzické I/O + stav programu (řízení, instance, časovače). */
export function uniTags(prj: Project): Array<{ name: string; type: string; group: string; hint: string; cmt: string }> {
  const ir = buildIR(prj);
  const out: Array<{ name: string; type: string; group: string; hint: string; cmt: string }> = [];
  for (const e of prj.io) out.push({ name: e.tag, type: dtFor(e) === "INT" ? "INT16" : "BIT", group: "I/O " + e.dir, hint: e.addr, cmt: (e.cmt || "").replace(/\s*[–—-]\s*$/, "") });
  /* názvy skupin: stejné klíče dosazuje do svého textu README (genReadme) */
  const gProg = trx("Program"), gTimer = trx("Program – časovač"), gBlock = trx("Blok");
  out.push({ name: "enable", type: "BIT", group: gProg, hint: "", cmt: trx("centrální uvolnění (E-stop TRUE = v pořádku)") });
  for (const d of ir.decls) out.push({ name: d.name, type: UNI_TYPE[d.type] || d.type, group: d.type === "TON" ? gTimer : gProg, hint: "", cmt: cmtSafe(declNote(d)).trim() });
  for (const b of uniItems(ir)) {
    if (b.kind !== "fb") continue;
    for (const v of parseFbTemplate(fbTemplate(b.cls, "st")).vars) {
      out.push({ name: b.inst + "_" + v.name, type: UNI_TYPE[v.type] || v.type, group: v.type === "TON" ? gTimer : gBlock + " " + b.dev.name, hint: "", cmt: b.dev.name + ": " + v.name });
    }
  }
  return out;
}

export function genUnitronicsTags(prj: Project): string {
  const q = (s: string) => '"' + uniAscii(String(s)).replace(/"/g, "'") + '"';
  const l = ["Name,Data Type,Group,I/O address hint,Comment"];
  for (const t of uniTags(prj)) l.push([q(t.name), q(t.type), q(t.group), q(t.hint), q(t.cmt)].join(","));
  return l.join("\n");
}

/** Logika stroje jako tělo jedné ST funkce pro UniLogic (stav v globálních tazích). */
export function genMainUnitronics(prj: Project): string {
  const ir = buildIR(prj), c = stCtx("unitronics");
  const x = (b: IrFb, n: string) => irText(b.inputs.find(p => p.name === n)!.expr, c);
  const parts: string[] = [], free: string[] = [];
  /* komentáře šablony se překládají až PO rozepsání — inlineFb přepisuje názvy proměnných
     i uvnitř komentářů a přeložený text by mohl některý z nich obsahovat (reset, error…) */
  const fb = (b: IrFb, skip: string[] = []) => {
    const wired: Record<string, string> = {}, outs: Record<string, string> = {};
    for (const p of b.inputs) if (!skip.includes(p.name)) wired[p.name] = irText(p.expr, c);
    for (const o of b.outputs) if (o.tag) outs[o.name] = o.tag;
    return trComments(inlineFb(fbTemplate(b.cls, "st"), b.inst, wired, outs), stripDia);
  };
  for (const it of uniItems(ir)) {
    const d = it.dev;
    const title = "    (* " + cmtSafe(d.name + (d.desc ? " - " + d.desc : "")) + " *)";
    if (it.kind === "fb" && (it.cls === "Motor" || it.cls === "Ventil")) {
      parts.push(title + "\n" + fb(it));
    } else if (it.kind === "fb" && it.cls === "AnalogIn") {
      const tag = it.inst + "_value";
      parts.push(title + "  (* " + (d.unit ? trx("hodnota v {unit}: {tag}", { unit: d.unit, tag }) : trx("hodnota v jednotkách snímače: {tag}", { tag })) + " *)\n" + fb(it));
    } else if (it.kind === "fb" && it.cls === "AnalogOut") {
      /* žádaná hodnota se zapisuje přímo do tagu value (bez ní ji zapisuje uživatel) */
      const sp = it.setpoint !== undefined;
      parts.push(title + "  (* " + (sp ? trx("žádaná hodnota") + " " + (d.unit || "") : "TODO: " + trx("žádanou hodnotu zapisuj do {tag}", { tag: it.inst + "_value" })) + " *)\n"
        + (sp ? "    " + it.inst + "_value := " + x(it, "value") + ";\n" : "") + fb(it, ["value"]));
    } else if (it.kind === "role") {
      const expr = irText(it.expr, c);
      for (const e of it.outs) parts.push(title + "  (* " + trx("vazba na stav stroje: {role}", { role: trx(DO_ROLE_TECH[it.role]) }) + " *)\n    "
        + e.tag + " := " + expr + ";");
    } else if (it.kind === "free") {
      for (const e of it.io) free.push("    (*   " + e.tag + "  " + (e.cmt || "") + " *)");
    }
  }
  const fault = renderFault(ir, c);
  /* texty jsou tu s diakritikou — čisté ASCII z nich (i z překladu) dělá až uniAscii() na konci */
  const st = `(* ${trx(`Machine.st - logika stroje pro Unitronics UniLogic (UniStream), jazyk ST.
   Generováno PLCdesk. Obsah vlož do JEDNÉ ST funkce volané každý scan.
   ST funkce v UniLogic nemá vlastní paměť: všechny tagy z Tags.csv založ jako
   GLOBÁLNÍ. Bloky zařízení jsou proto rozepsané přímo zde (předpona instX_).`)} *)

    enable := ${enableText(ir, c)};

${renderSeq(ir, c)}${parts.join("\n\n") || "    ;"}${fault ? "\n\n" + fault.trimEnd() : ""}

    (* ${trx("Volné signály (DI/DO) pro vlastní logiku:")} *)
${free.join("\n") || "    (*   " + trx("žádné") + " *)"}
`;
  return uniAscii(uniDialect(st));
}

/** Všechny generované soubory programu pro jednu platformu. */
export function genFor(prj: Project, plat: PlatformKey): Record<string, string> {
  const files: Record<string, string> = {};
  if (plat === "unitronics") {
    files["Tags.csv"] = genUnitronicsTags(prj);
    files["Machine.st"] = genMainUnitronics(prj);
  } else if (plat === "siemens") {
    /* UTF-8 s BOM: TIA (externí zdroj) i Excel jinak čtou soubor jako ANSI a čeština se rozpadne */
    files["Gen_Tags.tsv"] = "\uFEFF" + genSiemensTagsTSV(prj);
    files["Gen_IO.xml"] = genSiemensTagsXml(prj);
    if (prj.devices.some(d => d.cls !== "DI" && d.cls !== "DO")) files["Gen_Library.scl"] = "\uFEFF" + genLibrary(prj, "siemens");
    files["Gen_Main.scl"] = "\uFEFF" + genMainSiemens(prj);
  } else if (plat === "rockwell") {
    /* Logix 5000 ST nen\u00ED IEC (bez VAR, FB, TON\u2026) \u2192 L5X s AOI + tagy + rutinou; viz logix.ts */
    files["PLCdesk_Program.L5X"] = genRockwellL5X(prj);
    files["MainRoutine.st"] = genLogixRoutine(prj);
    files["Tags.csv"] = genLogixTagsCsv(prj);
  } else {
    const tf = genTagFile(prj, plat);
    files[tf.name] = tf.body;
    files["Gen_Library.st"] = genLibrary(prj, plat);
    files["MAIN.st"] = genMainIEC(prj, plat);
    /* CODESYS rodina: celý program jedním importovatelným souborem (z téhož finálního textu) */
    if (plat === "codesys" || plat === "beckhoff" || plat === "schneider") files["PLCopen_Import.xml"] = genPLCopenXML(prj, plat);
    if (plat === "omron") for (const f of ["Gen_Library.st", "MAIN.st"]) files[f] = files[f].replace(/\breset\b/g, "resetIn");
  }
  files["README.txt"] = genReadme(prj, plat);
  return files;
}
