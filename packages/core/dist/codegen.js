/**
 * PLCdesk — generování zdrojových souborů programu pro cílové platformy.
 * Siemens: SCL (external sources) + SimaticML XML + TSV tagů.
 * Ostatní: IEC 61131-3 ST + platformní soubor tagů (GVL / CSV / tab).
 *
 * Hlavní program se skládá z mezivrstvy `buildIR()` (ir.ts): tady jsou renderery IR do ST
 * (Siemens SCL, IEC ST, plochý ST Unitronics); Logix ST píše logix.ts nad stejným IR.
 * Šablony bloků (SCL_* / ST_*) zůstávají zdrojem logiky bloků.
 */
import { PLAT, usedClasses, dtFor, addrFor, xmlEsc, stripDia, isCodesysFamily, codeStyleFor, isMotionClass, ioOf, rampStepOf, selBitsOf, maxRecord, tolOf, tolTicksOf, } from "./model.js";
/* codegen_oop.ts a codegen.ts se importují navzájem: OOP renderer se volá až uvnitř genFor */
import { genForOop } from "./codegen_oop.js";
import { buildIR, irText, cmdIr, irBlocks, irPortTypes, irMember, IR_CTRL, IR_CLASS_ORDER, } from "./ir.js";
/* pomocné funkce sekvence a řízení žijí v ir.ts; odsud se dál exportují (veřejné API jádra) */
export { limitedAnalogs, waitedDis, actuators, seqVarOf, manVarOf, seqVars, seqCond, seqTimedSteps, motionSeqVars, seqMotionDevs, motionStepSets, } from "./ir.js";
/** Role výstupů — krátké popisky do komentářů generovaného kódu (trx). */
const DO_ROLE_TECH = {
    run: N_("chod"), fault: N_("porucha"), ready: N_("připraveno"), stopped: N_("stop"), lock: N_("zámek krytů"), auto: N_("AUTO"),
};
import { tr, trx, N_, getLang } from "./i18n.js";
import { genPLCopenXML } from "./plcopen.js";
import { genRockwellL5X, genLogixRoutine, genLogixTagsCsv, lxSlotText, lxTplProblems, LX_PROGRAM, LX_SOFTWARE_REVISION } from "./logix.js";
/* library.ts a codegen.ts se importují navzájem: knihovna se čte až uvnitř funkcí */
import { libraryOverrides, fbInterface } from "./library.js";
import { hwChannelText } from "./hardware.js";
import { axisTemplate, axisTemplates, axisDialect, axisBlocked, axisReadme, axisSupport, AXIS_TPL_COMMENTS } from "./axis_gen.js";
import { axisObjName } from "./axis.js";
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
/* ------------------------------------------------ šablony pohonů fáze 2a (ST) */
/* Pohony a proporcionální prvky přes běžné I/O — fungují na všech platformách včetně Unitronics
   (rozepsání inlineFb) a Logixu (AOI přes lxDialect), proto jen konstrukce, které tam projdou:
   TON jako `tonX(IN := …, PT := T#…);`, hrany ručně, žádné ABS / SEL / bitové operace nad INT.
   Rampa žádané hodnoty v PLC po taktech 0,1 s (časovač tonTick běží jen při rozběhu / odchylce),
   doba odchylky ventilu v taktech (vstup INT — TIME jako vstup Logix ani UniLogic nemá).
   errCode: 1 porucha pohonu, 2 nepřipraven, 3 bez referování, 4 ztráta hlášení,
   5 timeout, 6 odchylka skutečné hodnoty. Zrcadlo chování: sim.ts (MotionInst). */
export const ST_VFD = `FUNCTION_BLOCK FB_Vfd
(* Sablona: frekvencni menic pres I/O - chod, smer, analogova zadana otacek s rampou v PLC.
   Porucha (vstup fault, menic nepripraven, otacky nedosazeny, ztrata hlaseni) drzi do kvitace (reset). *)
VAR_INPUT
    enable : BOOL;
    cmdRun : BOOL;
    cmdStop : BOOL;
    cmdRev : BOOL;
    reset : BOOL;       (* kvitace poruchy (hrana) *)
    ready : BOOL;
    atSpeed : BOOL;
    fault : BOOL;
    speedSp : REAL;
    rampStep : REAL;    (* krok rampy za takt 0,1 s; 0 = bez rampy *)
    scaleMin : REAL;
    scaleMax : REAL;
    rawMax : INT;
    rawAct : INT;
END_VAR
VAR_OUTPUT
    outRun : BOOL;
    outRev : BOOL;
    outReset : BOOL;
    rawSpeed : INT;
    speedCmd : REAL;
    speedAct : REAL;
    inSpeed : BOOL;
    busy : BOOL;
    error : BOOL;
    status : WORD;
    errCode : INT;
END_VAR
VAR
    statStep : INT;
    lastRun : BOOL;
    lastStop : BOOL;
    lastReset : BOOL;
    trigRun : BOOL;
    trigStop : BOOL;
    trigReset : BOOL;
    spLast : REAL;
    revLast : BOOL;
    rawReal : REAL;
    tonFbk : TON;
    tonTick : TON;
END_VAR

IF NOT enable THEN
    outRun := FALSE; outRev := FALSE; outReset := FALSE; rawSpeed := 0;
    speedCmd := 0.0; inSpeed := FALSE; busy := FALSE; error := FALSE;
    status := 16#8001; statStep := 0; errCode := 0;
    RETURN;
END_IF;

(* detekce hran *)
trigRun   := cmdRun   AND NOT lastRun;    lastRun   := cmdRun;
trigStop  := cmdStop  AND NOT lastStop;   lastStop  := cmdStop;
trigReset := reset    AND NOT lastReset;  lastReset := reset;

CASE statStep OF
    0: (* IDLE *)
        outRun := FALSE;
        speedCmd := 0.0;
        IF trigRun THEN statStep := 10; END_IF;
    10: (* ACCELERATING *)
        outRun := TRUE;
        IF atSpeed AND (speedCmd = speedSp) THEN statStep := 20; spLast := speedSp; revLast := cmdRev; END_IF;
        IF trigStop THEN statStep := 0; END_IF;
    20: (* AT_SPEED *)
        outRun := TRUE;
        IF (speedSp <> spLast) OR (cmdRev AND NOT revLast) OR (revLast AND NOT cmdRev) THEN statStep := 10;
        ELSIF NOT atSpeed THEN statStep := 90; errCode := 4;
        END_IF;
        IF trigStop THEN statStep := 0; END_IF;
    90: (* ERROR *)
        outRun := FALSE;
        speedCmd := 0.0;
        IF trigReset AND NOT fault THEN statStep := 0; errCode := 0; END_IF;
END_CASE;

(* rampa zadane hodnoty po taktech 0,1 s *)
tonTick(IN := (statStep = 10) AND NOT tonTick.Q, PT := T#100MS);
IF statStep = 10 THEN
    IF rampStep <= 0.0 THEN
        speedCmd := speedSp;
    ELSIF tonTick.Q THEN
        IF speedCmd < speedSp THEN
            speedCmd := speedCmd + rampStep;
            IF speedCmd > speedSp THEN speedCmd := speedSp; END_IF;
        ELSIF speedCmd > speedSp THEN
            speedCmd := speedCmd - rampStep;
            IF speedCmd < speedSp THEN speedCmd := speedSp; END_IF;
        END_IF;
    END_IF;
END_IF;

(* otacky musi byt dosazeny do 5 s po dobehu rampy *)
tonFbk(IN := (statStep = 10) AND (speedCmd = speedSp), PT := T#5S);
IF tonFbk.Q THEN statStep := 90; errCode := 5; END_IF;
IF NOT ready AND (statStep = 10 OR statStep = 20) THEN statStep := 90; errCode := 2; END_IF;
IF fault THEN statStep := 90; errCode := 1; END_IF;

outRev := outRun AND cmdRev;
outReset := reset AND (statStep = 90);
rawReal := (speedCmd - scaleMin) / (scaleMax - scaleMin) * INT_TO_REAL(rawMax);
IF rawReal < 0.0 THEN
    rawReal := 0.0;
ELSIF rawReal > INT_TO_REAL(rawMax) THEN
    rawReal := INT_TO_REAL(rawMax);
END_IF;
rawSpeed := REAL_TO_INT(rawReal);
speedAct := INT_TO_REAL(rawAct) / INT_TO_REAL(rawMax) * (scaleMax - scaleMin) + scaleMin;
inSpeed := (statStep = 20);
busy := (statStep = 10);
error := (statStep = 90);
IF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;
export const ST_POSDRIVE = `FUNCTION_BLOCK FB_PosDrive
(* Sablona: polohovaci pohon se zaznamy pres I/O (Festo CMMO / CMMT, SMC JXC) - vyber zaznamu, start, v poloze.
   Porucha (vstup fault, pohon nepripraven, bez referovani, ztrata polohy, timeout) drzi do kvitace (reset). *)
VAR_INPUT
    enable : BOOL;
    cmdHome : BOOL;
    cmdMove : BOOL;
    recNo : INT;
    reset : BOOL;       (* kvitace poruchy (hrana) *)
    ready : BOOL;
    inPos : BOOL;
    homed : BOOL;
    fault : BOOL;
END_VAR
VAR_OUTPUT
    outEnable : BOOL;
    outStart : BOOL;
    outHome : BOOL;
    outHalt : BOOL;
    outSel0 : BOOL;
    outSel1 : BOOL;
    outSel2 : BOOL;
    outSel3 : BOOL;
    outSel4 : BOOL;
    outSel5 : BOOL;
    outReset : BOOL;
    actRec : INT;
    done : BOOL;
    busy : BOOL;
    error : BOOL;
    status : WORD;
    errCode : INT;
END_VAR
VAR
    statStep : INT;
    lastHome : BOOL;
    lastMove : BOOL;
    lastReset : BOOL;
    trigHome : BOOL;
    trigMove : BOOL;
    trigReset : BOOL;
    halted : BOOL;
    selRest : INT;
    tonSel : TON;
    tonAck : TON;
    tonMove : TON;
END_VAR

IF NOT enable THEN
    outEnable := FALSE; outStart := FALSE; outHome := FALSE; outHalt := FALSE; outReset := FALSE;
    outSel0 := FALSE; outSel1 := FALSE; outSel2 := FALSE; outSel3 := FALSE; outSel4 := FALSE; outSel5 := FALSE;
    done := FALSE; halted := FALSE; busy := FALSE; error := FALSE;
    status := 16#8001; statStep := 0; errCode := 0;
    RETURN;
END_IF;

(* detekce hran *)
trigHome  := cmdHome  AND NOT lastHome;   lastHome  := cmdHome;
trigMove  := cmdMove  AND NOT lastMove;   lastMove  := cmdMove;
trigReset := reset    AND NOT lastReset;  lastReset := reset;
outEnable := TRUE;

CASE statStep OF
    0: (* IDLE *)
        outStart := FALSE; outHome := FALSE;
        IF trigHome THEN
            statStep := 40; done := FALSE; halted := FALSE;
        ELSIF trigMove OR (cmdMove AND (recNo <> actRec)) THEN
            done := FALSE;
            IF homed THEN statStep := 10; halted := FALSE; ELSE statStep := 90; errCode := 3; END_IF;
        ELSIF done AND NOT inPos THEN
            statStep := 90; errCode := 4;
        END_IF;
    10: (* SELECT *)
        outStart := FALSE; outHome := FALSE;
        selRest := recNo;
        outSel5 := selRest >= 32; IF outSel5 THEN selRest := selRest - 32; END_IF;
        outSel4 := selRest >= 16; IF outSel4 THEN selRest := selRest - 16; END_IF;
        outSel3 := selRest >= 8; IF outSel3 THEN selRest := selRest - 8; END_IF;
        outSel2 := selRest >= 4; IF outSel2 THEN selRest := selRest - 4; END_IF;
        outSel1 := selRest >= 2; IF outSel1 THEN selRest := selRest - 2; END_IF;
        outSel0 := selRest >= 1;
        IF tonSel.Q THEN statStep := 20; END_IF;
        IF NOT cmdMove THEN statStep := 0; halted := TRUE; END_IF;
    20: (* START *)
        outStart := TRUE;
        IF NOT inPos THEN statStep := 30; END_IF;
        IF NOT cmdMove THEN statStep := 0; halted := TRUE; outStart := FALSE; END_IF;
    30: (* MOVING *)
        outStart := TRUE;
        IF inPos THEN statStep := 0; actRec := recNo; done := TRUE; outStart := FALSE; END_IF;
        IF NOT cmdMove THEN statStep := 0; halted := TRUE; outStart := FALSE; END_IF;
    40: (* HOME_START *)
        outHome := TRUE;
        IF NOT homed THEN statStep := 45; END_IF;
        IF NOT cmdHome THEN statStep := 0; halted := TRUE; outHome := FALSE; END_IF;
    45: (* HOMING *)
        outHome := TRUE;
        IF homed AND inPos THEN statStep := 0; actRec := 0; done := TRUE; outHome := FALSE; END_IF;
        IF NOT cmdHome THEN statStep := 0; halted := TRUE; outHome := FALSE; END_IF;
    90: (* ERROR *)
        outStart := FALSE; outHome := FALSE; done := FALSE;
        IF trigReset AND NOT fault THEN statStep := 0; errCode := 0; END_IF;
END_CASE;

(* vyber zaznamu ustaleny 0,1 s pred startem; potvrzeni startu do 1 s; jizda do 30 s *)
tonSel(IN := (statStep = 10), PT := T#100MS);
tonAck(IN := (statStep = 20) OR (statStep = 40), PT := T#1S);
tonMove(IN := (statStep = 30) OR (statStep = 45), PT := T#30S);
IF tonAck.Q OR tonMove.Q THEN statStep := 90; errCode := 5; END_IF;
IF NOT ready AND (statStep <> 0) AND (statStep <> 90) THEN statStep := 90; errCode := 2; END_IF;
IF fault THEN statStep := 90; errCode := 1; END_IF;

outHalt := halted OR (statStep = 90);
outReset := reset AND (statStep = 90);
busy := (statStep > 0) AND (statStep < 90);
error := (statStep = 90);
IF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;
export const ST_PROPVALVE = `FUNCTION_BLOCK FB_PropValve
(* Sablona: proporcionalni ventil tlaku / prutoku - analogova zadana s rampou v PLC, volitelne hlidani skutecne hodnoty.
   Porucha (odchylka nad toleranci po nastavenou dobu, zadana nedosazena do 5 s) drzi do kvitace (reset). *)
VAR_INPUT
    enable : BOOL;
    cmdOn : BOOL;
    spTarget : REAL;
    reset : BOOL;       (* kvitace poruchy (hrana) *)
    rampStep : REAL;    (* krok rampy za takt 0,1 s; 0 = bez rampy *)
    tol : REAL;
    tolTicks : INT;     (* doba odchylky v taktech 0,1 s *)
    useFbk : BOOL;
    scaleMin : REAL;
    scaleMax : REAL;
    rawMax : INT;
    rawAct : INT;
END_VAR
VAR_OUTPUT
    rawSp : INT;
    spAct : REAL;
    value : REAL;
    inTol : BOOL;
    busy : BOOL;
    error : BOOL;
    status : WORD;
    errCode : INT;
END_VAR
VAR
    statStep : INT;
    lastOn : BOOL;
    lastReset : BOOL;
    trigOn : BOOL;
    trigReset : BOOL;
    target : REAL;
    spLast : REAL;
    deviated : BOOL;
    devCnt : INT;
    rawReal : REAL;
    tonTick : TON;
    tonSettle : TON;
END_VAR

IF NOT enable THEN
    rawSp := 0; spAct := scaleMin; inTol := FALSE; busy := FALSE; error := FALSE;
    status := 16#8001; statStep := 0; devCnt := 0; errCode := 0;
    RETURN;
END_IF;

trigOn    := cmdOn AND NOT lastOn;       lastOn    := cmdOn;
trigReset := reset AND NOT lastReset;  lastReset := reset;
IF cmdOn THEN target := spTarget; ELSE target := scaleMin; END_IF;
value := INT_TO_REAL(rawAct) / INT_TO_REAL(rawMax) * (scaleMax - scaleMin) + scaleMin;
deviated := useFbk AND ((value > target + tol) OR (value < target - tol));

CASE statStep OF
    0: (* OFF *)
        spAct := scaleMin;
        IF trigOn THEN statStep := 10; END_IF;
    10: (* RAMP *)
        IF (spAct = target) AND NOT deviated THEN statStep := 20; spLast := target; END_IF;
        IF NOT cmdOn THEN statStep := 0; END_IF;
    20: (* IN_TOLERANCE *)
        IF NOT cmdOn THEN statStep := 0;
        ELSIF target <> spLast THEN statStep := 10;
        END_IF;
    90: (* ERROR *)
        spAct := scaleMin;
        IF trigReset THEN statStep := 0; errCode := 0; END_IF;
END_CASE;

(* rampa zadane hodnoty a pocitani odchylky po taktech 0,1 s *)
tonTick(IN := ((statStep = 10) OR ((statStep = 20) AND deviated)) AND NOT tonTick.Q, PT := T#100MS);
IF statStep = 10 THEN
    IF rampStep <= 0.0 THEN
        spAct := target;
    ELSIF tonTick.Q THEN
        IF spAct < target THEN
            spAct := spAct + rampStep;
            IF spAct > target THEN spAct := target; END_IF;
        ELSIF spAct > target THEN
            spAct := spAct - rampStep;
            IF spAct < target THEN spAct := target; END_IF;
        END_IF;
    END_IF;
END_IF;
IF (statStep = 20) AND deviated THEN
    IF tonTick.Q THEN devCnt := devCnt + 1; END_IF;
ELSE
    devCnt := 0;
END_IF;
IF devCnt >= tolTicks THEN statStep := 90; errCode := 6; devCnt := 0; END_IF;
tonSettle(IN := (statStep = 10) AND (spAct = target), PT := T#5S);
IF tonSettle.Q THEN statStep := 90; errCode := 5; END_IF;

rawReal := (spAct - scaleMin) / (scaleMax - scaleMin) * INT_TO_REAL(rawMax);
IF rawReal < 0.0 THEN
    rawReal := 0.0;
ELSIF rawReal > INT_TO_REAL(rawMax) THEN
    rawReal := INT_TO_REAL(rawMax);
END_IF;
rawSp := REAL_TO_INT(rawReal);
inTol := (statStep = 20);
busy := (statStep = 10);
error := (statStep = 90);
IF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;
END_FUNCTION_BLOCK`;
/**
 * SCL (TIA Portal) z šablony IEC ST — u bloků fáze 2a se SCL nepíše zvlášť, aby obě podoby
 * nemohly rozejít: hlavička s `{ S7_Optimized_Access }`, typy Siemens (TON → TON_TIME),
 * `BEGIN` za deklaracemi, lokální proměnné s `#`. Komentáře (* … *) SCL umí beze změny.
 */
export function stToScl(st) {
    const { vars } = parseFbTemplate(st);
    const TY = { BOOL: "Bool", INT: "Int", REAL: "Real", WORD: "Word", TON: "TON_TIME", DINT: "DInt", TIME: "Time" };
    const names = new Set(vars.map(v => v.name));
    const lastDecl = st.lastIndexOf("END_VAR") + "END_VAR".length;
    const head = st.slice(0, lastDecl)
        .replace(/^FUNCTION_BLOCK (\w+)/, (_m, n) => 'FUNCTION_BLOCK "' + n + '"\n{ S7_Optimized_Access := \'TRUE\' }\nVERSION : 0.1')
        .replace(/^(\s*\w+\s*:\s*)(\w+)(\s*(?::=[^;]*)?;)/gm, (_m, a, t, b) => a + (TY[t] || t) + b);
    const body = st.slice(lastDecl).replace(/\s*END_FUNCTION_BLOCK\s*$/, "");
    const code = body.split(/(\(\*[\s\S]*?\*\))/).map((part, i) => i % 2 ? part
        /* formální parametr ve volání (`instPower(Axis := #Axis, …)`) se neprefixuje, i když se jmenuje jako proměnná */
        : part.replace(/(?<![\w.#])([A-Za-z_]\w*)\b/g, (m, _g, off, str) => /[(,]\s*$/.test(str.slice(Math.max(0, off - 40), off)) && /^\s*(?::=|=>)/.test(str.slice(off + m.length, off + m.length + 4)) ? m
            : names.has(m) ? "#" + m : m)).join("");
    return head + "\n\nBEGIN" + code.replace(/^\n+/, "\n") + "\nEND_FUNCTION_BLOCK";
}
export const SCL_VFD = stToScl(ST_VFD);
export const SCL_POSDRIVE = stToScl(ST_POSDRIVE);
export const SCL_PROPVALVE = stToScl(ST_PROPVALVE);
/* servoosa: šablona podle platformy (axis_gen.ts); tady jen kanonická podoba pro typy portů a HMI */
export const ST_AXIS = axisTemplate("sm3");
export const SCL_AXIS = stToScl(axisTemplate("s15"));
const FB_TEMPLATES = {
    scl: { Motor: SCL_MOTOR, Ventil: SCL_VENTIL, AnalogIn: SCL_AI, AnalogOut: SCL_AO, Vfd: SCL_VFD, PosDrive: SCL_POSDRIVE, PropValve: SCL_PROPVALVE, Axis: SCL_AXIS },
    st: { Motor: ST_MOTOR, Ventil: ST_VENTIL, AnalogIn: ST_AI, AnalogOut: ST_AO, Vfd: ST_VFD, PosDrive: ST_POSDRIVE, PropValve: ST_PROPVALVE, Axis: ST_AXIS },
};
/**
 * Text bloku FB_Axis pro platformu: šablona dialektu osy (S7-1500 / S7-1200 / Tc2_MC2 / SM3 /
 * SoftMotion Light / Sysmac / Logix AOI), u Siemens převedená na SCL. Platforma bez podpory osy ""
 * (kód se pro ni negeneruje — `axisBlocked`).
 */
export function axisFbText(prj, plat) {
    const dia = axisDialect(prj, plat);
    if (!dia)
        return "";
    const st = axisTemplate(dia);
    return plat === "siemens" ? stToScl(st) : st;
}
/**
 * Šablona bloku třídy — jediné místo, kde renderery (Gen_Library, AOI v L5X, plochá logika
 * Unitronics) berou zdroj logiky bloku. `lib` = vlastní šablony z firemní knihovny pro danou
 * platformu (`codeLibrary`, stejné rozhraní) — mají přednost; bez `lib` vestavěná šablona
 * (simulace, ověření, typy portů v IR a HMI zrcadlí vždy vestavěnou).
 */
export function fbTemplate(cls, dialect, lib) {
    return lib?.templates[cls] ?? FB_TEMPLATES[dialect][cls];
}
export function codeLibrary(prj, plat) {
    const ov = libraryOverrides(prj, plat);
    const out = { templates: {}, ids: {}, header: ov.header, issues: [...ov.issues], ...(ov.library ? { library: ov.library } : {}) };
    for (const cls of ["Motor", "Ventil", "AnalogIn", "AnalogOut"]) {
        const tpl = ov.templates[cls];
        if (tpl === undefined)
            continue;
        const id = ov.ids[cls] || "?";
        const why = plat === "unitronics" ? flatTplProblems(tpl) : plat === "rockwell" ? lxTplProblems(cls, tpl) : [];
        if (why.length) {
            out.issues.push({ level: "error", where: tr("šablona {id}", { id }),
                msg: tr("Šablonu nejde spolehlivě převést pro {plat}: {why} — použita vestavěná šablona {fb}.", { plat: PLAT[plat].name, why: why.join("; "), fb: "FB_" + cls }) });
            continue;
        }
        out.templates[cls] = tpl;
        out.ids[cls] = id;
    }
    return out;
}
/**
 * Proč šablonu IEC ST nejde rozepsat do ploché funkce UniLogic (`inlineFb`); prázdné = jde.
 * Rozepsání čte jen bloky VAR_INPUT / VAR_OUTPUT / VAR s jednou proměnnou na řádek, typy, které
 * má seznam tagů UniLogic, a předčasný návrat jen v úvodním `IF NOT enable … RETURN; END_IF;`.
 */
export function flatTplProblems(tpl) {
    const why = [];
    const { vars, body } = parseFbTemplate(tpl);
    if (/\b(END_VAR|VAR_\w+|VAR)\b/.test(body.replace(/\(\*[\s\S]*?\*\)/g, " ")))
        why.push(tr("deklarační blok, který rozepsání nečte (např. VAR CONSTANT)"));
    const ports = fbInterface(tpl);
    const missing = [...ports.inputs.map(p => ({ p, k: "in" })), ...ports.outputs.map(p => ({ p, k: "out" }))]
        .filter(x => !vars.some(v => v.name === x.p.name && v.kind === x.k)).map(x => x.p.name);
    const declPart = body ? tpl.slice(0, tpl.lastIndexOf(body)) : tpl;
    if (missing.length || /^\s*\w+\s*,\s*\w+[^:\n]*:/m.test(declPart))
        why.push(tr("deklarace víc proměnných na jednom řádku ({list})", { list: missing.join(", ") || "…" }));
    const bad = [...new Set(vars.filter(v => !UNI_TYPE[v.type]).map(v => v.type))];
    if (bad.length)
        why.push(tr("datový typ {list} seznam tagů UniLogic nemá", { list: bad.join(", ") }));
    if (/\bRETURN\b/.test(inlineFb(tpl, "inst", {}, {}).replace(/\(\*[\s\S]*?\*\)/g, " ")))
        why.push(tr("RETURN mimo úvodní IF NOT enable"));
    return why;
}
/** Řádky firemní hlavičky jako komentář (Siemens `//`, ostatní `(* *)`); bez hlavičky "". */
function libHeader(lib, sie) {
    return lib.header.map(l => sie ? "// " + l : "(* " + cmtSafe(l) + " *)").join("\n") + (lib.header.length ? "\n" : "");
}
/* ------------------------------------------------ překlad komentářů šablon */
/* Šablony jsou konstanty modulu (čte je parseFbTemplate, simulátor i testy), proto se
   nepřekládají při sestavení, ale až ve výstupu: `trComments()` přeloží těla komentářů.
   Klíčem je text komentáře bez okolních mezer; zalomení řádku uvnitř komentáře = mezera. */
/** České komentáře šablon bloků — klíče překladu. Úplnost seznamu hlídá `templateComments()`. */
export const TPL_COMMENTS = [
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
    /* pohony fáze 2a (ST; SCL vzniká z téže šablony) */
    N_("Sablona: frekvencni menic pres I/O - chod, smer, analogova zadana otacek s rampou v PLC. Porucha (vstup fault, menic nepripraven, otacky nedosazeny, ztrata hlaseni) drzi do kvitace (reset)."),
    N_("krok rampy za takt 0,1 s; 0 = bez rampy"),
    N_("rampa zadane hodnoty po taktech 0,1 s"),
    N_("otacky musi byt dosazeny do 5 s po dobehu rampy"),
    N_("Sablona: polohovaci pohon se zaznamy pres I/O (Festo CMMO / CMMT, SMC JXC) - vyber zaznamu, start, v poloze. Porucha (vstup fault, pohon nepripraven, bez referovani, ztrata polohy, timeout) drzi do kvitace (reset)."),
    N_("vyber zaznamu ustaleny 0,1 s pred startem; potvrzeni startu do 1 s; jizda do 30 s"),
    N_("Sablona: proporcionalni ventil tlaku / prutoku - analogova zadana s rampou v PLC, volitelne hlidani skutecne hodnoty. Porucha (odchylka nad toleranci po nastavenou dobu, zadana nedosazena do 5 s) drzi do kvitace (reset)."),
    N_("doba odchylky v taktech 0,1 s"),
    N_("rampa zadane hodnoty a pocitani odchylky po taktech 0,1 s"),
    /* servoosa (fáze 2b) — axis_gen.ts */
    ...AXIS_TPL_COMMENTS,
];
const COMMENT_RE = /\(\*([\s\S]*?)\*\)|\/\/([^\n]*)/g;
/** Klíč komentáře: text bez okolních mezer, zalomení řádku nahrazeno mezerou. */
const commentKey = (body) => body.trim().replace(/\s*\n\s*/g, " ");
/**
 * Komentáře skutečně obsažené v šablonách bloků (jako klíče překladu, bez opakování).
 * Anglické popisky stavů (IDLE, RUNNING…) se nepřekládají, proto tu nejsou.
 * Každý vrácený text musí být v `TPL_COMMENTS`, jinak ho sběr klíčů nevidí.
 */
export function templateComments() {
    const out = new Set();
    for (const tpl of [SCL_MOTOR, SCL_VENTIL, SCL_AI, SCL_AO, ST_MOTOR, ST_VENTIL, ST_AI, ST_AO, ST_VFD, ST_POSDRIVE, ST_PROPVALVE, SCL_VFD, SCL_POSDRIVE, SCL_PROPVALVE,
        ...Object.values(axisTemplates())]) {
        for (const m of tpl.matchAll(COMMENT_RE)) {
            const key = commentKey(m[1] ?? m[2] ?? "");
            if (key && !/^[A-Z_]+$/.test(key))
                out.add(key);
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
export function trComments(code, fix = s => s) {
    return code.replace(COMMENT_RE, (all, blk, line) => {
        const body = (blk ?? line ?? "").trim();
        const key = commentKey(body);
        const t = key ? trx(key) : key;
        if (t === key)
            return all;
        let out = fix(t);
        const rows = body.split("\n");
        if (rows.length > 1) {
            const indent = (rows[1].match(/^[ \t]*/) || [""])[0];
            const width = Math.max(60, ...rows.map(r => r.trim().length));
            const wrapped = [];
            let row = "";
            for (const w of out.split(" ")) {
                if (row && (row + " " + w).length > width) {
                    wrapped.push(row);
                    row = w;
                }
                else
                    row = row ? row + " " + w : w;
            }
            if (row)
                wrapped.push(row);
            out = wrapped.join("\n" + indent);
        }
        return all.replace(body, () => out);
    });
}
export function refFn(plat) {
    if (plat === "siemens")
        return t => '"' + t + '"';
    if (isCodesysFamily(plat))
        return t => "GVL_IO." + t;
    return t => t;
}
export function locFn(plat) {
    return plat === "siemens" ? v => "#" + v : v => v;
}
function fmtR(v) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return "0.0";
    if (/e/i.test(String(n))) { // IEC REAL literál: mantisa s tečkou + E±n
        const [m, e] = n.toExponential().split("e");
        return (m.includes(".") ? m : m + ".0") + "E" + e;
    }
    return Number.isInteger(n) ? n + ".0" : String(n);
}
export function stCtx(plat) {
    const sie = plat === "siemens";
    return {
        plat, sie, L: locFn(plat), R: refFn(plat), real: fmtR,
        cm: sie ? (t) => "// " + t : (t) => "(* " + cmtSafe(t) + " *)",
        /* objekt osy: TIA technologický objekt (globální DB), TwinCAT AXIS_REF v GVL_IO, jinak globální jméno osy */
        A: sie ? (n) => '"' + n + '"' : plat === "beckhoff" ? (n) => "GVL_IO." + n : (n) => n,
        /* plochá logika Unitronics: stav instance je v globálních tazích s předponou instance */
        ...(plat === "unitronics" ? { M: (inst, port) => inst + "_" + port } : {}),
    };
}
/**
 * Časový literál IEC: celé sekundy `T#5S`, jinak sekundy + milisekundy `T#1S500MS`
 * (desetinný tvar `T#1.5S` některá IDE nepřijmou).
 */
export function timeLit(seconds) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const s = Math.floor(ms / 1000), rest = ms % 1000;
    return rest ? "T#" + (s ? s + "S" : "") + rest + "MS" : "T#" + s + "S";
}
/**
 * Mitsubishi FX5 (GX Works3): TON bere PT jen 0–32 767 ms (FX5 Programming Manual
 * Instructions JY997D55801Z, kap. 32.2 TON(_E)). Delší čas kroku (výdrž / hlídací čas) proto
 * generátor zapisuje časovačem TIMER_100_FB_M (kap. 32.4: Coil, Preset INT 0–32 767 × 100 ms,
 * ValueIn, výstup Status) — do 3 276,7 s, čas zaokrouhlený nahoru na 100 ms. Ostatní platformy
 * a kratší časy beze změny (TON). Emulátor (emu/compile.ts) blok zná, simulace počítá týž čas.
 */
export const FX5_TON_MAX_MS = 32767;
/** Krok s tímto časem píše generátor pro platformu časovačem TIMER_100_FB_M (jen FX5 nad 32 767 ms). */
export function fx5Timer100(plat, timeS) {
    return plat === "mitsubishi" && Math.round(timeS * 1000) > FX5_TON_MAX_MS;
}
/** Předvolba TIMER_100_FB_M (× 100 ms, nahoru — hlídací čas nesmí vypršet dřív). */
export function fx5Preset100(timeS) {
    return Math.ceil(Math.round(timeS * 1000) / 100);
}
/** Časovače kroků, které renderer píše jako TIMER_100_FB_M. */
function timer100Set(ir, c) {
    return new Set((ir.seq?.steps || []).filter(s => s.timer && fx5Timer100(c.plat, s.timeS)).map(s => s.timer));
}
/** Název kroku do komentáře kódu (technický výstup → trx; pohony fáze 2a s žádanou / záznamem). */
export function irStepTitle(s) {
    const dev = s.dev ? s.dev.name : "?";
    const unit = s.dev?.unit || "";
    const sp = (s.sets || []).find(x => x.type === "REAL"), rec = (s.sets || []).find(x => x.type === "INT");
    const num = (st) => st && (st.value.k === "real" || st.value.k === "int") ? st.value.v : 0;
    if (s.dev?.cls === "Axis") {
        const tgt = (s.sets || []).find(x => x.var.startsWith("seqTgt_")), u = s.dev.unit || "";
        const v = tgt && tgt.value.k === "real" ? tgt.value.v : 0;
        return (s.op === "home" ? trx("{dev} referování osy", { dev }) :
            s.op === "moveAbs" ? trx("{dev} najet na {pos} {unit}", { dev, pos: v, unit: u }) :
                s.op === "moveRel" ? trx("{dev} posun o {pos} {unit}", { dev, pos: v, unit: u }) :
                    s.op === "velocity" ? trx("{dev} rychlost {v} {unit}/s", { dev, v, unit: u }) :
                        s.op === "halt" ? trx("{dev} zastavit osu", { dev }) : trx("{dev} čekat na dokončení pohybu", { dev })).replace(/\s+/g, " ").trim();
    }
    if (s.dev?.cls === "Vfd" && s.op === "run") {
        const rev = (s.sets || []).some(x => x.var.startsWith("seqRev_") && x.value.k === "bool" && x.value.v);
        return (rev ? trx("{dev} start vzad {sp} {unit}", { dev, sp: num(sp), unit }) : trx("{dev} start {sp} {unit}", { dev, sp: num(sp), unit })).trim();
    }
    return s.op === "dwell" ? trx("výdrž {t} s", { t: s.timeS }) :
        s.op === "waitOn" ? trx("čekat na {dev}", { dev }) :
            s.op === "waitOff" ? trx("čekat na {dev} = FALSE", { dev }) :
                s.op === "run" ? trx("{dev} start", { dev }) :
                    s.op === "stop" ? trx("{dev} stop", { dev }) :
                        s.op === "open" ? trx("{dev} otevřít", { dev }) :
                            s.op === "close" ? trx("{dev} zavřít", { dev }) :
                                s.op === "home" ? trx("{dev} referenční jízda", { dev }) :
                                    s.op === "posRecord" ? trx("{dev} jízda na záznam {rec}", { dev, rec: num(rec) }) :
                                        s.op === "setPressure" ? trx("{dev} žádaná {sp} {unit}", { dev, sp: num(sp), unit }).trim() : trx("krok");
}
/** Sekvence (CASE) a časovače kroků z IR. */
export function renderSeq(ir, c) {
    const seq = ir.seq;
    if (!seq)
        return "";
    const L = c.L, C = IR_CTRL, x = (e) => irText(e, c);
    const t100 = timer100Set(ir, c);
    const done = (t) => L(t) + (t100.has(t) ? ".Status" : ".Q");
    const semi = ";"; // GX Works3, Sysmac a Logix vyžadují END_IF;
    let b = "    " + c.cm("--- " + trx("Automatická sekvence (režim AUTO)") + " ---") + "\n";
    b += "    " + c.cm(trx("Vypnutí AUTO, ztráta uvolnění nebo porucha stroje: sekvence do kroku 0, povely vypnout")) + "\n";
    b += "    IF " + x(seq.abort) + " THEN\n";
    b += "        " + L(C.seqStep) + " := 0;\n";
    for (const v of seq.outputs)
        b += "        " + L(v) + " := FALSE;\n";
    for (const r of seq.resets)
        b += "        " + L(r.var) + " := " + x(r.value) + ";\n";
    b += "    END_IF;\n\n";
    /* povely pohonů fáze 2a se zapisují už při přechodu do kroku (viz IrStep.sets) */
    const byN = new Map(seq.steps.map(s => [s.n, s]));
    const entry = (n) => (byN.get(n)?.sets || []).map(st => L(st.var) + " := " + x(st.value) + "; ").join("");
    b += "    CASE " + L(C.seqStep) + " OF\n";
    b += "        0: " + c.cm(trx("čekání na start")) + "\n";
    b += "            IF " + x(seq.start) + " THEN " + entry(10) + L(C.seqStep) + " := 10; END_IF" + semi + "\n";
    for (const s of seq.steps) {
        b += "        " + s.n + ": " + c.cm(trx("Krok {n}: {title}", { n: s.index + 1, title: irStepTitle(s) })) + "\n";
        if (s.set)
            b += "            " + L(s.set.var) + " := " + (s.set.value ? "TRUE" : "FALSE") + ";\n";
        for (const st of s.sets || [])
            b += "            " + L(st.var) + " := " + x(st.value) + ";\n";
        const go = entry(s.next) + L(C.seqStep) + " := " + s.next + ";";
        if (s.cond.kind === "time") {
            b += "            IF " + done(s.timer) + " THEN " + go + " END_IF" + semi + "\n";
        }
        else if (s.cond.kind === "fbk") {
            b += "            IF " + (s.cond.expr ? x(s.cond.expr) : (s.cond.neg ? "NOT " : "") + c.R(s.cond.io.tag)) + " THEN " + go + "\n";
            b += "            ELSIF " + done(s.timer) + " THEN " + L(C.machineFault) + " := TRUE; " + L(C.faultStep) + " := " + s.n + "; " + c.cm(trx("timeout kroku {t} s", { t: s.timeS })) + "\n";
            b += "            END_IF" + semi + "\n";
        }
        else {
            const cls = s.dev && s.dev.cls;
            const why = cls === "Ventil" ? trx("bez koncového snímače") : cls === "Motor" || cls === "Vfd" ? trx("bez zpětného hlášení") : trx("bez podmínky");
            b += "            IF TRUE THEN " + go + " END_IF" + semi + " " + c.cm(why) + "\n";
        }
    }
    b += "    END_CASE;\n\n";
    for (const s of seq.steps) {
        if (!s.timer)
            continue;
        if (t100.has(s.timer)) {
            const p = fx5Preset100(s.timeS);
            b += "    " + L(s.timer) + "(Coil := (" + L(C.seqStep) + " = " + s.n + "), Preset := " + p + ", ValueIn := 0); " +
                c.cm(trx("TIMER_100_FB_M: {p} x 100 ms = {t} s (TON na FX5 nejvýš 32 767 ms)", { p, t: p / 10 })) + "\n";
        }
        else
            b += "    " + L(s.timer) + "(IN := (" + L(C.seqStep) + " = " + s.n + "), PT := " + timeLit(s.timeS) + ");\n";
    }
    return b + "\n";
}
export function seqBody(prj, plat) {
    return renderSeq(buildIR(prj), stCtx(plat));
}
/* Surový rozsah analogu dle platformy (typický modul; TODO ověřit podle skutečného modulu).
   Předává se vždy — FX5 nezná počáteční hodnoty a výchozí 27648 je rozsah Siemens. */
const RAW_MAX = { beckhoff: 32767, codesys: 32767, mitsubishi: 16000, schneider: 10000, omron: 32000,
    /* WAGO 750-455 (4–20 mA): 0…32767; Delta AS04AD-A: ±32000 — obojí TODO podle modulu */
    wago: 32767, delta: 32000 };
/** Surový rozsah analogu platformy (bez = Siemens 27648 z výchozí hodnoty šablony). */
export function rawMaxFor(plat) { return RAW_MAX[plat]; }
function rawMaxArg(plat) {
    const v = RAW_MAX[plat];
    return v ? ", rawMax := " + v + " (* TODO: " + stripDia(trx("rozsah dle modulu")) + " *)" : "";
}
/** Text do komentáře (* … *): bez diakritiky a pomlček, bez konce řádku; „(*“ a „*)“ z textu
    uživatele rozdělí mezerou (CODESYS/TwinCAT komentáře vnořují — jinak by rozbily zbytek souboru). */
export function cmtSafe(t) {
    return stripDia(t).replace(/[–—]/g, "-").replace(/[\r\n]+/g, " ").replace(/\(\*/g, "( *").replace(/\*\)/g, "* )");
}
/** Text komentáře deklarace řízení (přeložený, s „TODO:" u vstupů z HMI); bez komentáře "". */
export function declNote(d) {
    return d.note ? (d.todo ? "TODO: " : "") + trx(d.note) : "";
}
/** Typ deklarace v ST platformy (časovač kroku v SCL = TON_TIME). */
function declType(t, sie) {
    return t === "TON" ? (sie ? "TON_TIME" : "TON") : t;
}
/**
 * Deklarace řízení stroje z IR: režimy, kvitace, ruční povely, porucha a sekvence.
 * `keep` = jen vybrané (u Mitsubishi / Omron jsou proměnné pro HMI globální — `hmiGlobalVars`).
 */
export function renderDecls(ir, c, keep = () => true) {
    const t100 = timer100Set(ir, c);
    return ir.decls.filter(keep).map(d => {
        const head = d.name + " : " + (t100.has(d.name) ? "TIMER_100_FB_M" : declType(d.type, c.sie)) + ";";
        if (!d.note)
            return "    " + head;
        /* pevné proměnné řízení zarovnané do sloupce, ruční povely (proměnná délka) ne */
        return "    " + (d.group === "man" ? head : head.padEnd(20)) + "  " + c.cm(declNote(d));
    }).join("\n");
}
/** Deklarace řízení stroje: režimy, kvitace, ruční povely, porucha a sekvence. */
export function ctrlDecls(prj, plat) {
    return renderDecls(buildIR(prj), stCtx(plat));
}
/** Výraz „povel zapnout": sekvence NEBO ruční povel (v ručním režimu). */
export function cmdExpr(prj, plat, d) {
    return irText(cmdIr(prj, d), stCtx(plat));
}
/** Zachycení poruchy bloků a kvitace — volá se ZA instancemi (čerstvé výstupy error). */
export function renderFault(ir, c) {
    const f = ir.fault;
    if (!f)
        return "";
    const L = c.L, C = IR_CTRL;
    const anyErr = f.errors.map(e => irText(e, c)).join(" OR ");
    let b = "    " + c.cm("--- " + trx("Porucha stroje a kvitace") + " ---") + "\n";
    if (anyErr)
        b += "    IF " + anyErr + " THEN " + L(C.machineFault) + " := TRUE; END_IF;\n";
    b += "    IF " + L(C.cmdAck) + (anyErr ? " AND NOT (" + anyErr + ")" : "") + " THEN " + L(C.machineFault) + " := FALSE;" +
        (f.resetFaultStep ? " " + L(C.faultStep) + " := 0;" : "") + " END_IF;\n";
    return b;
}
export function faultBlock(prj, plat) {
    return renderFault(buildIR(prj), stCtx(plat));
}
/* ------------------------------------------- globální proměnné pro HMI (GOT, NA) */
/**
 * Mitsubishi GOT čte návěští GX Works3 jen globální (Access from External Device — GX Works3
 * Operating Manual SH-081215ENG, Registering Labels; FX5 tuto volbu nemá, GOT tam čte operandy
 * přiřazené globálním návěštím) a Omron NA jen globální proměnné s Network Publish (NJ/NX
 * Software User's Manual W501, 6-3-8). U těchto platforem jsou proto proměnné řízení stroje
 * (enable, modeAuto, cmdAutoStart, cmdAck, machineFault, faultStep, seqStep, manRun_* /
 * manOpen_*) globální a stav bloků se na konci MAIN zrcadlí do globálních proměnných
 * `instX_port` (stejná jména jako tagy HMI a plochý výstup Unitronics). Povely sekvence
 * (seqRun_*), časovače kroků a instance bloků zůstávají lokální. Ostatní platformy beze změny.
 */
export function hmiGlobalPlat(plat) { return plat === "mitsubishi" || plat === "omron"; }
/** Deklarace řízení stroje, které jsou u HMI platforem globální (ne povely sekvence, ne časovače). */
function isHmiCtrlDecl(d) { return d.group === "ctrl" || d.group === "man" || d.group === "seq"; }
/** Proměnné, které jsou u Mitsubishi / Omron globální: řízení stroje + zrcadlo stavu bloků (tagy HMI). */
export function hmiGlobalVars(ir) {
    const out = [{ name: IR_CTRL.enable, type: "BOOL", note: trx("centrální uvolnění (E-stop TRUE = v pořádku)") }];
    for (const d of ir.decls)
        if (isHmiCtrlDecl(d))
            out.push({ name: d.name, type: d.type, note: declNote(d) });
    for (const b of irBlocks(ir)) {
        const T = irPortTypes(b.cls);
        const state = (port, expr = irMember(b.inst, port)) => out.push({ name: b.inst + "_" + port, type: T[port], note: b.dev.name + ": " + port, expr });
        const param = (port) => state(port, b.inputs.find(p => p.name === port).expr);
        if (b.cls === "Motor" || b.cls === "Ventil")
            for (const p of [b.cls === "Motor" ? "outRun" : "outOpen", "busy", "error", "status"])
                state(p);
        else if (b.cls === "AnalogIn") {
            for (const p of ["value", "alarmHi", "alarmLo"])
                state(p);
            if (b.limits?.hi !== undefined)
                param("limitHi");
            if (b.limits?.lo !== undefined)
                param("limitLo");
        }
        else if (b.cls === "AnalogOut")
            param("value");
        else
            for (const p of motionHmiPorts(b))
                state(p);
    }
    return out;
}
/**
 * Stav bloku pohonu fáze 2a pro HMI (zrcadlo do globálních proměnných u Mitsubishi / Omron, tagy
 * HMI): povel / v poloze / v toleranci, žádaná po rampě, skutečná hodnota (jen se zapojeným AI),
 * busy, error, status a errCode (1 porucha, 2 nepřipraven, 3 bez referování, 4 ztráta hlášení,
 * 5 timeout, 6 odchylka).
 */
export function motionHmiPorts(b) {
    const wired = (n) => b.inputs.some(p => p.name === n && p.src === "io");
    if (b.cls === "Vfd")
        return ["outRun", "inSpeed", "speedCmd", ...(wired("rawAct") ? ["speedAct"] : []), "busy", "error", "status", "errCode"];
    if (b.cls === "PosDrive")
        return ["done", "actRec", "busy", "error", "status", "errCode"];
    if (b.cls === "PropValve")
        return ["spAct", ...(wired("rawAct") ? ["value"] : []), "inTol", "busy", "error", "status", "errCode"];
    if (b.cls === "Axis")
        return ["powered", "homed", "done", "doneId", "actPos", "moving", "busy", "error", "status", "errCode"];
    return [];
}
/** Zrcadlo stavu bloků do globálních proměnných pro HMI (Mitsubishi / Omron; volá se za poruchou). */
export function renderHmiMirror(ir, c) {
    const st = hmiGlobalVars(ir).filter(v => v.expr);
    if (!st.length)
        return "";
    return "    " + c.cm("--- " + trx("Stav bloků pro HMI (globální proměnné)") + " ---") + "\n" +
        st.map(v => "    " + v.name + " := " + irText(v.expr, c) + ";").join("\n") + "\n";
}
/** Pomocná proměnná pro nezapojený výstup bloku (jinak varování IDE). */
export function tempVarOf(t) { return t === "INT" ? "tempUnused2" : "tempUnused"; }
/** Meze AnalogIn v argumentech volání; FX5 nezná počáteční hodnoty → předat vždy (jinak 0 = trvalá porucha). */
function limArgs(b, c) {
    const allLim = c.plat === "mitsubishi", x = (n) => irText(b.inputs.find(p => p.name === n).expr, c);
    const has = (n) => b.inputs.some(p => p.name === n);
    return (has("limitHi") ? ", limitHi := " + x("limitHi") : allLim ? ", limitHi := 1.0E+6" : "")
        + (has("limitLo") ? ", limitLo := " + x("limitLo") : allLim ? ", limitLo := -1.0E+6" : "");
}
/**
 * Komentáře volání bloku (text bez značek komentáře): `port` = za vstupem (náhrada chybějícího
 * hlášení, žádaná hodnota), `after` = za celým voláním (AnalogIn: jednotky a mez). Společné
 * pro zápis IEC / SCL (`stCall`) i Logix (členy instance), aby komentáře seděly stejně.
 */
export function stCallNotes(b, c) {
    const port = {};
    if (b.cls === "Motor" && b.inputs.some(p => p.name === "fbkRunning" && p.src === "default"))
        port.fbkRunning = trx("bez zpětného hlášení");
    /* pohony fáze 2a: surový rozsah analogu dle platformy, náhrady chybějících hlášení, rampa */
    if (b.inputs.some(p => p.src === "rawMax") && RAW_MAX[c.plat] && c.plat !== "rockwell")
        port.rawMax = "TODO: " + trx("rozsah dle modulu");
    if (b.cls === "Vfd" || b.cls === "PosDrive")
        for (const p of b.inputs) {
            if (p.src === "default" && (p.name === "ready" || p.name === "atSpeed" || p.name === "inPos" || p.name === "homed"))
                port[p.name] = trx("bez hlášení");
        }
    if ((b.cls === "Vfd" || b.cls === "PropValve") && b.inputs.some(p => p.name === "rampStep" && p.expr.k === "real" && p.expr.v === 0))
        port.rampStep = trx("bez rampy v PLC");
    if (b.cls === "AnalogOut")
        port.value = b.setpoint !== undefined ? trx("žádaná hodnota") + " " + (b.dev.unit || "") : "TODO: " + trx("žádaná hodnota");
    if (b.cls === "AnalogIn") {
        const lim = limArgs(b, c);
        return { port, after: (b.dev.unit || trx("jednotky dle snímače")) + (lim ? "; " + trx("překročení meze = porucha stroje") : "") };
    }
    return { port };
}
/**
 * Text hodnoty vstupu bloku pro platformu: surový rozsah analogu (`src: "rawMax"`) dosadí
 * podle platformy (Logix 100.0 = analogy 5069 v %, ostatní `RAW_MAX`, jinak Siemens 27648).
 */
export function portText(p, c) {
    if (p.src === "rawMax")
        return c.plat === "rockwell" ? "100.0" : String(RAW_MAX[c.plat] ?? 27648);
    return irText(p.expr, c);
}
/** Volání instance bloku v IEC ST / SCL (`instM1(enable := …, outRun => …);`). */
export function stCall(b, c) {
    const L = c.L, x = (n) => irText(b.inputs.find(p => p.name === n).expr, c);
    const outOf = (n) => { const o = b.outputs.find(p => p.name === n); return o.tag ? c.R(o.tag) : L(tempVarOf(o.type)); };
    const notes = stCallNotes(b, c);
    /* analogy: zhuštěné rozložení (škálování na jednom řádku), rawMax dle platformy */
    if (b.cls === "AnalogIn") {
        return L(b.inst) + "(rawValue := " + x("rawValue") + ",\n" +
            "        scaleMin := " + x("scaleMin") + ", scaleMax := " + x("scaleMax") + rawMaxArg(c.plat) + limArgs(b, c) + "); " + c.cm(notes.after);
    }
    if (b.cls === "AnalogOut") {
        return L(b.inst) + "(value := " + x("value") + ", " + c.cm(notes.port.value) + "\n" +
            "        scaleMin := " + x("scaleMin") + ", scaleMax := " + x("scaleMax") + rawMaxArg(c.plat) + ",\n" +
            "        rawValue => " + outOf("rawValue") + ");";
    }
    /* obecné rozložení (i pro nové třídy): port na řádek, komentář za čárkou */
    const parts = [
        ...b.inputs.map(p => ({ text: p.name + " := " + portText(p, c), note: notes.port[p.name] })),
        ...b.outputs.map(o => ({ text: o.name + " => " + outOf(o.name), note: undefined })),
    ];
    return L(b.inst) + "(" + parts.map((p, i) => i < parts.length - 1
        ? p.text + "," + (p.note ? " " + c.cm(p.note) : "") + "\n        "
        : p.text + ");").join("") + (notes.after !== undefined ? " " + c.cm(notes.after) : "");
}
/** Titulek zařízení v komentáři nad voláním (IEC / SCL). */
function devTitle(d) {
    return (d.name + (d.desc ? " – " + d.desc : "")).replace(/[\r\n]+/g, " ");
}
/** Přiřazení výstupu s rolí (stav stroje). */
function roleLine(c, tag, role, expr) {
    return c.R(tag) + " := " + expr + "; " + c.cm(trx("vazba na stav stroje: {role}", { role: trx(DO_ROLE_TECH[role]) }));
}
/** Řádek volného signálu (komentář s adresou platformy) v IEC ST / SCL. */
export function freeLine(c, e, prj) {
    const sie = c.sie;
    return "    " + (sie ? "//" : "(*") + "   " + (addrFor(c.plat, e, prj) || "").padEnd(8) + " " + c.R(e.tag) + "  " + (sie ? e.cmt : cmtSafe(e.cmt) + " *)");
}
/**
 * Instance, volání bloků / rolí a volné signály z IR (pořadí zařízení; bez vstupů uvolnění).
 * `o.call` / `o.free` = jiný zápis volání bloku / řádku volného signálu (Logix).
 */
export function renderWiring(ir, c, o = {}) {
    const call = o.call || ((b) => stCall(b, c)), freeOf = o.free || ((e) => freeLine(c, e, ir.prj));
    const inst = [], calls = [], free = [];
    for (const it of ir.devices) {
        const title = "    " + c.cm(devTitle(it.dev));
        if (it.kind === "fb") {
            inst.push({ n: it.inst, t: it.fb });
            calls.push(title + "\n    " + call(it));
        }
        else if (it.kind === "role") {
            const expr = irText(it.expr, c);
            for (const e of it.outs)
                calls.push(title + "\n    " + roleLine(c, e.tag, it.role, expr));
        }
        else if (it.kind === "free") {
            for (const e of it.io)
                free.push(freeOf(e));
        }
        /* enableInput: čte enable; seqInput: čte krok čekání */
    }
    return { inst, calls, free };
}
export function wiring(prj, plat) {
    return renderWiring(buildIR(prj), stCtx(plat));
}
/** Nezapojené výstupy bloků → potřebné pomocné proměnné (BOOL / INT). */
export function irUnused(ir) {
    const outs = ir.devices.flatMap(it => it.kind === "fb" ? it.outputs.filter(o => !o.tag) : []);
    return { bool: outs.some(o => tempVarOf(o.type) === "tempUnused"), int: outs.some(o => tempVarOf(o.type) === "tempUnused2") };
}
/**
 * Výraz centrálního uvolnění: E-stop AND blokovací vstupy (kryty, závory…) + poznámka.
 * FALSE kteréhokoli vstupu = enable FALSE → bloky vypnou výstupy, sekvence do kroku 0.
 */
export function renderEnable(ir, c) {
    const sie = c.sie;
    const ins = ir.enable.inputs;
    if (!ins.length)
        return { expr: "TRUE", note: "TODO: " + (sie ? trx("napojit bezpečnostní okruh!") : stripDia(trx("napojit bezpečnostní okruh!"))) };
    const notes = [];
    if (ins.some(x => x.estop))
        notes.push(sie ? trx("E-stop NC: TRUE = OK — doplň celý bezpečnostní okruh!")
            : stripDia(trx("E-stop NC: TRUE = OK - doplnit cely bezpecnostni okruh!")));
    else
        notes.push("TODO: " + (sie ? trx("napojit bezpečnostní okruh!") : stripDia(trx("napojit bezpečnostní okruh!"))));
    const il = ins.filter(x => !x.estop);
    if (il.length) {
        const t = trx("blokování {list}: FALSE = stroj stojí", { list: il.map(x => x.dev.name).join(", ") });
        notes.push(sie ? t : stripDia(t));
    }
    return { expr: ins.map(x => c.R(x.tag)).join(" AND "), note: notes.join("; ") };
}
/** Uvolnění jako text pro přiřazení `enable := …` (výraz + komentář). */
export function enableText(ir, c) {
    const e = renderEnable(ir, c);
    return e.expr + " " + (c.sie ? "// " + e.note : "(* " + e.note + " *)");
}
export function enableExpr(prj, plat) {
    return enableText(buildIR(prj), stCtx(plat));
}
/* ------------------------------------------------------- soubory: Siemens */
/** Kultura komentáře tagu v SimaticML — musí být mezi jazyky projektu TIA (Project languages). */
const TIA_CULTURE = { cs: "cs-CZ", en: "en-US", de: "de-DE", es: "es-ES", zh: "zh-CN" };
export function genSiemensTagsXml(prj) {
    let id = 0;
    const nid = () => (id++).toString();
    let x = '<?xml version="1.0" encoding="utf-8"?>\n<Document>\n  <Engineering version="V21" />\n  <SW.Tags.PlcTagTable ID="' + nid() + '">\n    <AttributeList>\n      <Name>Gen_IO</Name>\n    </AttributeList>\n    <ObjectList>\n';
    for (const e of prj.io) {
        x += '      <SW.Tags.PlcTag ID="' + nid() + '" CompositionName="Tags">\n        <AttributeList>\n          <DataTypeName>' + (dtFor(e) === "INT" ? "Int" : "Bool") + '</DataTypeName>\n          <LogicalAddress>' + xmlEsc(addrFor("siemens", e, prj)) + '</LogicalAddress>\n          <Name>' + xmlEsc(e.tag) + '</Name>\n        </AttributeList>\n';
        if (e.cmt)
            x += '        <ObjectList>\n          <MultilingualText ID="' + nid() + '" CompositionName="Comment">\n            <ObjectList>\n              <MultilingualTextItem ID="' + nid() + '" CompositionName="Items">\n                <AttributeList>\n                  <Culture>' + TIA_CULTURE[getLang()] + '</Culture>\n                  <Text>' + xmlEsc(e.cmt) + '</Text>\n                </AttributeList>\n              </MultilingualTextItem>\n            </ObjectList>\n          </MultilingualText>\n        </ObjectList>\n';
        x += '      </SW.Tags.PlcTag>\n';
    }
    return x + '    </ObjectList>\n  </SW.Tags.PlcTagTable>\n</Document>\n';
}
/** P1: robustní ruční cesta — sloupce k vložení přímo do tabulky tagů TIA / Excelu. */
export function genSiemensTagsTSV(prj) {
    const l = ["Name\tData Type\tLogical Address\tComment"];
    for (const e of prj.io)
        l.push([e.tag, dtFor(e) === "INT" ? "Int" : "Bool", addrFor("siemens", e, prj), e.cmt || ""].join("\t"));
    return l.join("\n");
}
export function genLibrary(prj, plat) {
    const u = usedClasses(prj);
    const parts = [];
    const hdr = plat === "siemens"
        ? "// Gen_Library.scl – " + trx("knihovna šablon (generováno PLCdesk)") + "\n// " + trx("Import: External source files → Generate blocks from source (PŘED Gen_Main)")
        : "(* Gen_Library.st - " + stripDia(trx("knihovna šablon (generováno PLCdesk)")) + " - " + PLAT[plat].name + " *)";
    parts.push(hdr, "");
    const dia = plat === "siemens" ? "scl" : "st";
    /* komentáře šablon se překládají až tady; IEC ST zůstává bez diakritiky */
    const fix = plat === "siemens" ? undefined : stripDia;
    const lib = codeLibrary(prj, plat);
    for (const c of IR_CLASS_ORDER) {
        if (!u.has(c))
            continue;
        if (c === "Axis") {
            parts.push(trComments(axisFbText(prj, plat), fix), "");
            continue;
        }
        const own = lib.ids[c];
        if (own) {
            const t = trx("Vlastní blok firemní knihovny {lib}: šablona {id} (neověřeno simulací)", { lib: ((lib.library?.name || "") + " " + (lib.library?.version || "")).trim(), id: own });
            parts.push(plat === "siemens" ? "// " + t : "(* " + cmtSafe(t) + " *)");
        }
        parts.push(trComments(fbTemplate(c, dia, lib), fix), "");
    }
    if (parts.length <= 2)
        parts.push(plat === "siemens" ? "// (" + trx("žádné instancované třídy zařízení") + ")" : "(* " + cmtSafe(trx("žádné instancované třídy zařízení")) + " *)");
    return parts.join("\n");
}
export function genMainSiemens(prj) {
    const ir = buildIR(prj), c = stCtx("siemens");
    const { inst, calls, free } = renderWiring(ir, c);
    const decl = renderDecls(ir, c), fault = renderFault(ir, c), en = renderEnable(ir, c);
    let v = inst.map(i => '    ' + i.n + ' : "' + i.t + '";').join("\n");
    if (decl)
        v += (v ? "\n" : "") + decl;
    const tmp = tmpDecl(ir, "Bool", "Int");
    return `${libHeader(codeLibrary(prj, "siemens"), true)}// ${trx("Gen_Main.scl – strojní blok (multi-instance). Import PO Gen_Library.scl.")}

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
export function genGVL(prj, plat) {
    const lines = ["(* GVL_IO - " + stripDia(trx("globální proměnné / fyzické I/O - generováno PLCdesk")) + " *)", "{attribute 'qualified_only'}", "VAR_GLOBAL"];
    for (const e of prj.io) {
        const at = addrFor(plat, e, prj);
        lines.push("    " + e.tag + (at ? " AT " + at : "") + " : " + dtFor(e) + ";" + (e.cmt ? " (* " + cmtSafe(e.cmt) + " *)" : ""));
    }
    /* TwinCAT: proměnná osy AXIS_REF (Tc2_MC2) — nalinkuje se na osu NC; ostatní platformy mají objekt osy v konfiguraci IDE */
    if (plat === "beckhoff")
        for (const d of prj.devices.filter(x => x.cls === "Axis"))
            lines.push("    " + axisObjName(d) + " : AXIS_REF; (* " + cmtSafe(trx("osa {dev} - nalinkovat na osu NC (Link To NC)", { dev: d.name }) + (d.desc ? " - " + d.desc : "")) + " *)");
    lines.push("END_VAR");
    return lines.join("\n");
}
/** Deklarace pomocných proměnných jen pro výstupy, které se nečtou (jinak varování IDE). */
function tmpDecl(ir, b, i) {
    const u = irUnused(ir);
    return (u.bool ? "\n    " + tempVarOf("BOOL") + " : " + b + ";" : "") + (u.int ? "\n    " + tempVarOf("INT") + " : " + i + ";" : "");
}
export function genMainIEC(prj, plat) {
    const ir = buildIR(prj), c = stCtx(plat);
    const { inst, calls, free } = renderWiring(ir, c);
    /* Mitsubishi / Omron: řízení stroje je globální (HMI), stav bloků se zrcadlí za poruchou */
    const hg = hmiGlobalPlat(plat);
    const decl = renderDecls(ir, c, hg ? d => !isHmiCtrlDecl(d) : undefined), fault = renderFault(ir, c);
    const mirror = hg ? renderHmiMirror(ir, c) : "";
    let v = inst.map(i => "    " + i.n + " : " + i.t + ";").join("\n");
    if (decl)
        v += (v ? "\n" : "") + decl;
    return `${libHeader(codeLibrary(prj, plat), false)}(* MAIN - ${stripDia(trx("hlavní program (generováno PLCdesk)"))} - ${PLAT[plat].name} *)
PROGRAM MAIN
VAR
${hg ? "" : "    enable : BOOL;\n"}${v || "    (* " + stripDia(trx("žádné instance")) + " *)"}${tmpDecl(ir, "BOOL", "INT")}
END_VAR

enable := ${enableText(ir, c)};

${renderSeq(ir, c)}${calls.join("\n\n") || ";"}${fault ? "\n\n" + fault.trimEnd() : ""}${mirror ? "\n\n" + mirror.trimEnd() : ""}

(* ${stripDia(trx("Volné signály (DI/DO) pro vlastní logiku:"))} *)
${free.join("\n") || "(*   " + stripDia(trx("žádné")) + " *)"}
END_PROGRAM`;
}
/* P1: Rockwell CSV s povinnou hlavičkou (remark + verze 0.3), INT místo WORD. */
export function genTagFile(prj, plat) {
    const q = (s) => '"' + stripDia(s).replace(/"/g, "'") + '"';
    if (plat === "rockwell")
        return { name: "Tags.csv", body: genLogixTagsCsv(prj) }; // logix.ts
    /* globální proměnné pro HMI (řízení stroje + zrcadlo stavu bloků) — viz hmiGlobalVars */
    const hmiVars = hmiGlobalPlat(plat) ? hmiGlobalVars(buildIR(prj)) : [];
    if (plat === "mitsubishi") {
        /* sloupce podle editoru globálních návěští GX Works3; „Access from External Device“ = 1/0
           (GX Works3 Operating Manual SH-081215ENG, Exporting/importing a label: hlavičky CSV se párují
           s nadpisy sloupců, sloupec, který editor nemá — FX5 —, se při importu vynechá) */
        const MT = { BOOL: "Bit", INT: "Word [Signed]", WORD: "Word [Unsigned]/Bit String [16-bit]", REAL: "FLOAT [Single Precision]" };
        const row = (name, type, cmt, assign) => ['"' + name + '"', '"' + type + '"', '"VAR_GLOBAL"', '"' + uniAscii(cmt).replace(/"/g, "'") + '"', '"' + assign + '"', '"1"'].join(",");
        const l = ['"Label Name","Data Type","Class","Comment","Assign (Device/Label)","Access from External Device"'];
        for (const e of prj.io)
            l.push(row(e.tag, dtFor(e) === "INT" ? "Word [Signed]" : "Bit", e.cmt || "", addrFor(plat, e, prj)));
        for (const v of hmiVars)
            l.push(row(v.name, MT[v.type] || v.type, v.note, ""));
        return { name: "GlobalLabels.csv", body: l.join("\n") };
    }
    if (plat === "omron") {
        /* sloupce jako tabulka Global Variables v Sysmac Studiu: Name, Data Type, Initial Value, AT,
           Retain, Constant, Network Publish, Comment — bez hlavičky (vložila by se jako proměnná).
           Network Publish = Publish Only: HMI NA čte a zapisuje přes CIP; Input / Output jsou volby
           pro tag data links (W501 6-3-8 Network Publish), pro HMI nejsou potřeba */
        const l = [];
        for (const e of prj.io)
            l.push([e.tag, dtFor(e), "", "", "", "", "Publish Only", uniAscii(e.cmt || "")].join("\t"));
        for (const v of hmiVars)
            l.push([v.name, v.type, "", "", "", "", "Publish Only", uniAscii(v.note)].join("\t"));
        return { name: "Variables.txt", body: l.join("\n") };
    }
    return { name: "GVL_IO.st", body: genGVL(prj, plat) };
}
/**
 * README.txt k platformě — dokument pro člověka (→ `tr`). Klíč překladu = odstavec, odrážka
 * nebo číslovaný krok; u zalomených odstavců je zalomení a odsazení pokračovacích řádků
 * součástí klíče (prostý text s pevnou šířkou řádku). Číslo kroku a odrážka zůstávají mimo.
 */
export function genReadme(prj, plat) {
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
    const common = tr("PROJEKT: {name} · {tags} tagů · {devs} zařízení · generováno PLCdesk", { name: prj.meta.name || tr("(bez názvu)"), tags: prj.io.length, devs: prj.devices.length }) + "\n\n" +
        tr("SPOLEČNÉ KROKY") + "\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n") + "\n";
    /* nadpis (název produktu se nepřekládá) + odrážky */
    const list = (title, ...items) => title + "\n" + items.map(s => "- " + s).join("\n");
    const spec = {
        siemens: () => list("SIEMENS TIA PORTAL (V17–V21, S7-1200/1500)", tr("Gen_Tags.tsv: otevři v Excelu (UTF-8, oddělovač tabulátor), list přejmenuj na „PLC Tags“, ulož jako .xlsx a v tabulce tagů dej Import (sloupce Name / Data Type / Logical Address / Comment odpovídají formátu TIA)."), tr("Gen_IO.xml: import přes Openness. Pro V17–V20 přepiš v hlavičce Engineering version V21 na svou verzi; jazyk komentářů (Culture) musí být mezi jazyky projektu."), tr("Adresy jsou návrh (analogy od %IW64 = integrované AI S7-1200) — srovnej je se start address modulů v Device configuration."), tr("cmdAutoStart je úrovňový povel — napoj ho na tlačítko (puls), ne na přepínač, jinak se po skončení cyklu hned spustí další."), tr(`Gen_Library.scl a Gen_Main.scl: Program blocks → External source files →
  Add new external file → pravý klik → Generate blocks from source (NEJDŘÍV knihovnu).`), tr("Vznikne FB_Machine + InstMachine; volání vlož do OB1 (komentář na konci Gen_Main)."), tr("Doplň diagnostické OB 82/86/121/122, ať CPU nejde do STOP při poruše periferie."), tr("Test: PLCSIM / PLCSIM Advanced.")),
        rockwell: () => list(tr("ROCKWELL STUDIO 5000 LOGIX DESIGNER (CompactLogix 5380 / ControlLogix 5580) — soubory PLCdesk_Program.L5X, MainRoutine.st a Tags.csv") + "\n" +
            tr(`POZOR — NEOVĚŘENO PŘEKLADEM: výstup pro Logix nebyl zkoušen ve Studiu 5000. Struktura L5X
vychází z příručky 1756-RM014 a reálných exportů. Při prvním importu zkontroluj hlášení importu
a Verify Controller (hlavně FBD_TIMER v AOI, výchozí hodnoty parametrů a verzi souboru).`) + "\n", tr(`PLCdesk_Program.L5X (hlavní cesta): v Controller Organizer pravý klik na MainTask →
  Add → Import Program… a vyber soubor. Vznikne program {prog} s rutinou MainRoutine (ST)
  a programovými tagy, Add-On Instructions FB_Motor / FB_Ventil / FB_AnalogIn / FB_AnalogOut
  a I/O tagy (controller scope). Pak Verify Controller. Soubor nese verzi {rev} — pro starší
  verzi Logix Designeru uprav atribut SoftwareRevision.`, { prog: LX_PROGRAM, rev: LX_SOFTWARE_REVISION }), tr(`Bloky zařízení jsou Add-On Instructions (ST) ze stejných šablon jako u ostatních platforem:
  TON → TONR (FBD_TIMER, PRE v ms se nastaví před voláním), WORD → DINT, RETURN → ELSE.
  Instance se volají přes členy: instM1.enable := …; FB_Motor(instM1); M1_outRun := instM1.outRun;`), tr(`I/O tagy jsou po importu běžné tagy (BOOL / REAL) bez vazby na hardware. Připoj je na body
  modulů: vlastnosti tagu → Type: Alias → Alias For (např. M1_fbkRunning → Local:1:I.Pt00.Data
  u modulů 5069 / CompactLogix 5380; u starších modulů 1769 je to Local:1:I.Data.0), nebo
  importem Tags.csv (níže). Navržený bod modulu je v popisu každého I/O tagu.`), tr(`Tags.csv (náhradní cesta): Tools → Import → Tags and Logic Comments. I/O jsou v něm ALIAS
  na Local:<slot>:I.Pt<nn>.Data (DI/DO) a Ch<nn>.Data (AI/AO), u vzdálených stanic na
  RIO<n>:<slot>:… (adaptér EtherNet/IP pojmenuj v I/O Configuration RIO<n>), podle osazení
  ze sestavy hardwaru PLCdesk: {slots}. Moduly musí v I/O Configuration existovat dřív než
  import; když se osazení liší, uprav sloupec SPECIFIER. Programové tagy mají SCOPE {prog},
  instance bloků (FB_*) projdou jen tehdy, když jsou AOI už v projektu (z L5X). Soubor
  needituj v Excelu.`, { slots: lxSlotText(prj) || tr("(bez I/O modulů)"), prog: LX_PROGRAM }), tr("MainRoutine.st: totéž tělo rutiny jako v L5X, bez deklarací — pro ruční vložení do ST rutiny."), tr(`Analogy: moduly 5069-IF8 / 5069-OF4 dávají a berou Chxx.Data jako REAL. V konfiguraci modulu
  nastav Low/High Engineering 0–100 (procenta rozsahu); bloky přepočítají 0–100 % na
  scaleMin…scaleMax (rawMax = 100.0).`), tr("Stavová slova status jsou DINT: 16#8001 blokováno, 16#8002 porucha (do INT se 16#8001 nevejde)."), tr(`Nejkratší test: nový projekt CompactLogix 5380 (např. 5069-L306ER) s moduly podle osazení
  výše → Import Program (L5X) → Verify Controller bez chyb → Logix Echo nebo emulátor: modeAuto := 1,
  puls cmdAutoStart a sleduj seqStep a výstupy.`)),
        beckhoff: () => list("BECKHOFF TWINCAT 3", tr("NEJRYCHLEJI: PLCopen_Import.xml — PLC projekt → pravý klik → Import PLCopenXML (knihovna bloků, MAIN i GVL_IO najednou; import je aditivní, duplicitní POU předem smaž). Ruční cesta je níže."), tr(`GVL_IO.st: PLC projekt → Add → Global Variable List, vlož obsah.
  Adresy %IX/%QX můžeš nechat a nalinkovat v I/O mapování, nebo použít AT %I*.`), tr("Gen_Library.st: každý FUNCTION_BLOCK vlož jako nový POU (ST)."), tr("MAIN.st: obsah do MAIN (PRG) a zavolej v PlcTask."), tr("Test: lokální runtime na PC (TwinCAT XAR).")),
        codesys: () => list("CODESYS V3.5 (WAGO, Festo, Eaton…)", tr("NEJRYCHLEJI: PLCopen_Import.xml — Project → Import PLCopenXML (knihovna bloků, MAIN i GVL_IO najednou; import je aditivní, duplicitní POU hlásí chybu). Ruční cesta je níže."), tr("GVL_IO.st: Application → Add Object → Global Variable List s názvem přesně GVL_IO (MAIN píše GVL_IO.<tag>), obsah nahraď."), tr("Gen_Library.st / MAIN.st: editor POU má dvě části — do HORNÍ (deklarace) vlož řádky od FUNCTION_BLOCK / PROGRAM po poslední END_VAR, do DOLNÍ (implementace) zbytek BEZ END_FUNCTION_BLOCK / END_PROGRAM. Každý blok jako nový POU (Function Block, ST)."), tr("MAIN: vytvoř POU „MAIN“ (Program, ST) a přidej ho do MainTask místo PLC_PRG."), tr("Adresy jsou návrh (analogy jako index slova: %IW32 = bajty 64–65) — porovnej s I/O mapováním zařízení (WAGO: analogové moduly jsou v obrazu procesu první), nebo AT smaž a namapuj GVL_IO v I/O Mapping."), tr("Test: CODESYS Control Win (soft PLC).")),
        mitsubishi: () => list("MITSUBISHI GX WORKS3 (iQ-F/iQ-R)", tr(`GlobalLabels.csv: Navigation → Label → Global Label → import CSV
  (sloupec Assign obsahuje návrh X/Y — ověř dle skutečných modulů; formát CSV
  se liší podle verze GX Works3, srovnej s exportem ze své instalace).`), tr("Gen_Library.st: Function Block do knihovny projektu (jazyk ST)."), tr("MAIN.st: GX Works3 edituje tělo programu odděleně od návěští — do ProgPou (ST) vlož jen tělo (od řádku za END_VAR po END_PROGRAM) a lokální návěští založ podle bloku VAR."), tr(`Řízení stroje pro HMI (enable, modeAuto, cmdAutoStart, cmdAck, machineFault, faultStep, seqStep,
  manRun_* / manOpen_*) a stav bloků (instX_outRun, instX_status, instX_value…, MAIN je zapisuje
  na konci) jsou globální návěští v GlobalLabels.csv se sloupcem Access from External Device = 1 —
  GOT je u iQ-R čte přímo. FX5 tuto volbu nemá (při importu se sloupec vynechá): pro GOT přiřaď
  návěštím pro HMI operandy (sloupec Assign, např. M / D) a v GT Designer3 použij tyto operandy.`), tr("Adresy X/Y jsou pro FX5 osmičkové (X0–X7, X10…); analogy přiřaď na SD6020 / SD6060 (vestavěné AI) nebo vyrovnávací paměť modulu U…\\G…; rawMax je v kódu 16000 (TODO podle modulu)."), tr("TON na FX5 bere nejvýš 32 767 ms — kroky s delším časem (výdrž, hlídací čas) jsou v kódu časovačem TIMER_100_FB_M (předvolba × 100 ms, nejvýš 3 276,7 s; čas zaokrouhlený nahoru na 100 ms)."), tr("Test: GX Simulator3.")),
        schneider: () => list("SCHNEIDER ECOSTRUXURE MACHINE EXPERT (M241/M262)", tr("NEJRYCHLEJI: PLCopen_Import.xml — Project → Import PLCopenXML (báze CODESYS: knihovna bloků, MAIN i GVL_IO najednou). Ruční cesta je níže."), tr("Platforma je postavená na CODESYS — postup shodný: GVL, POU (ST), MAIN do tasku."), tr("Adresy %IX/%QX namapuj na embedded I/O / TM3 moduly v konfiguraci."), tr("Pro Control Expert (M580) je nutné bloky přenést jako DFB — struktura sedí."), tr("Test: simulátor v Machine Expert.")),
        /* profily CODESYS: stejný kód jako platforma CODESYS, jiné IDE, mapování I/O a kusovník */
        wago: () => list("WAGO e!COCKPIT / WAGO CODESYS V3.5 (PFC100 / PFC200, I/O 750)", tr("NEJRYCHLEJI: PLCopen_Import.xml — v e!COCKPIT záložka PROGRAM → Import PLCopenXML, ve WAGO CODESYS V3.5 Project → Import PLCopenXML (báze CODESYS: knihovna bloků, MAIN i GVL_IO najednou). Ruční cesta je níže."), tr("GVL_IO.st: globální seznam proměnných s názvem přesně GVL_IO (MAIN píše GVL_IO.<tag>), obsah nahraď."), tr(`I/O: proměnné GVL_IO jsou BEZ pevné adresy. Kanály modulů 750 na lokální sběrnici (K-Bus) přiřaď
  v I/O mapování zařízení (e!COCKPIT: detail kontroléru / modulu → kanál → vybrat GVL_IO.<tag>;
  WAGO CODESYS V3.5: uzel Kbus → K-Bus I/O Mapping). Obraz procesu řadí nejdřív analogové kanály
  po slovech a za ně digitální bity; adresy se mění s osazením — proto mapování, ne AT.`), tr("Gen_Library.st / MAIN.st: každý blok jako nový POU (ST), MAIN přidej do cyklického tasku. Knihovna Standard (TON) je v projektu CODESYS V3 výchozí."), tr("rawMax analogů je v kódu 32767 (TODO) — uprav podle modulu (např. 750-455 4–20 mA)."), tr("Test: simulace v e!COCKPIT / CODESYS (bez kontroléru), pak kontrolér s odpojenými akčními členy.")),
        delta: () => list("DELTA DIADESIGNER-AX (AX-3 / AX-5 / AX-8, CODESYS V3.5)", tr(`POZOR — ADRESY NEOVĚŘENY: AT adresy v GVL_IO jsou v notaci CODESYS (%IX bajt.bit, %IW index slova)
odvozené z návrhu. Počáteční adresy vestavěných I/O (BuiltIn_IO) a modulů AS na Delta LocalBus
manuál Delta neuvádí — porovnej je s mapováním zařízení v projektu, nebo AT smaž a proměnné
GVL_IO přiřaď kanálům v Edit IO Mapping.`) + "\n", tr("NEJRYCHLEJI: PLCopen_Import.xml — Project → Import PLCopenXML (standardní příkaz CODESYS V3.5; v dokumentaci Delta neověřeno). Ruční cesta je níže."), tr("Projekt založ v DIADesigner-AX se šablonou svého CPU (AX-308E…), moduly AS přidej pod Delta_LocalBus_Master (Product List nebo scan sběrnice)."), tr("GVL_IO.st: globální seznam proměnných s názvem přesně GVL_IO, obsah nahraď; Gen_Library.st / MAIN.st jako POU (ST), MAIN do cyklického tasku."), tr("rawMax analogů je v kódu 32000 (TODO) — uprav podle rozsahu modulu (AS04AD-A / AS04DA-A)."), tr("Test: simulace SoftPLC v DIADesigner-AX, pak CPU s odpojenými akčními členy.")),
        omron: () => list("OMRON SYSMAC STUDIO (NX/NJ)", tr("Variables.txt: v Global Variables vyber první prázdnou buňku sloupce Name a vlož (Ctrl+V) — sloupce Name, Data Type, Initial Value, AT, Retain, Constant, Network Publish, Comment."), tr(`Globální jsou i řízení stroje pro HMI (enable, modeAuto, cmdAutoStart, cmdAck, machineFault, faultStep,
  seqStep, manRun_* / manOpen_*) a stav bloků (instX_outRun, instX_status, instX_value…, MAIN je zapisuje
  na konci); Network Publish = Publish Only — HMI NA je čte a zapisuje přes CIP (Input / Output jsou
  jen pro tag data links). Globální proměnné, které Program0 používá, v něm zaregistruj jako externí.`), tr("AT sloupec nech prázdný a namapuj na I/O porty zařízení (EtherCAT) v projektu."), tr("Gen_Library.st: každý blok jako Function Block (ST) do POUs → Function Blocks; vstup kvitace se jmenuje resetIn (Reset je instrukce Sysmac)."), tr("MAIN.st: Sysmac edituje tělo programu odděleně od proměnných — do Program0 (ST) vlož jen tělo (od řádku za END_VAR po END_PROGRAM) a proměnné z bloku VAR založ v tabulce lokálních proměnných."), tr("rawMax analogů je v kódu 32000 s poznámkou TODO — uprav podle rozsahu svého modulu NX."), tr("Test: Simulace přímo v Sysmac Studiu.")),
        unitronics: () => list(tr("UNITRONICS UNILOGIC (řada UniStream) — soubory Tags.csv a Machine.st") + "\n" +
            tr(`POZOR — NEOVĚŘENO PŘEKLADEM: výstup pro Unitronics nebyl zkoušen v UniLogic. Při prvním
vložení zkontroluj syntaxi proti své verzi (CASE, volání TON, převody TO_REAL / TO_INT).`) + "\n", tr(`UniLogic programuje UniStream v Ladderu, C a Structured Textu. ST se píše jako FUNKCE,
  která nemá vlastní paměť (lokální tagy mezi voláními hodnotu nedrží). Logika bloků je
  proto rozepsaná „naplocho" do jedné funkce a veškerý stav je v globálních tazích
  s předponou instance (instM1_statStep, instY1_tonOpen…). Knihovna Gen_Library se
  u této platformy negeneruje.`), 
        /* názvy skupin jsou v Tags.csv technický výstup (trx) — sem se dosazují stejné */
        tr(`Tags.csv: seznam tagů k založení jako GLOBÁLNÍ (skupiny I/O = fyzické signály,
  {prog} a {block} = stav logiky, {timer} = instance TON). UniLogic importuje jen
  soubor, který sám exportoval: buď tagy založ ručně, nebo vyexportuj prázdnou šablonu
  (PLC → Import/Export), doplň ji podle Tags.csv a naimportuj zpět. I/O tagy pak přiřaď
  vstupům a výstupům v konfiguraci hardwaru (sloupec „I/O address hint" je jen vodítko).`, { prog: trx("Program"), block: trx("Blok"), timer: trx("Program – časovač") }), tr(`Machine.st: pravý klik na modul → Add Structured Text Function, vlož obsah a funkci
  volej každý scan z hlavní ladder rutiny.`), tr("Globální tagy vidí ST funkce jen přes seznam Used Globals (vlastnosti funkce) — přidej do něj všechny tagy z Tags.csv."), tr(`Časovače: kód používá IEC bloky TON s literály T#…S — v ST editoru UniLogic jsou až od
  verze z května 2026. Ve starší verzi je nahraď ladder časovači (bit „hotovo" místo .Q).`), tr("Stavová slova jsou desítkově: 32769 = 16#8001 blokováno, 32770 = 16#8002 porucha."), tr(`Vision / Samba (VisiLogic) Structured Text nemá — tam Machine.st slouží jako předloha
  pro přepis do Ladderu a Tags.csv jako seznam operandů.`), tr("Test: nejdřív na PLC s odpojenými akčními členy.")),
    };
    return libReadmeHead(prj, plat) + common + "\n" + spec[plat]() + motionReadme(prj, plat) + axisReadme(prj, plat) + libReadmeTail(prj, plat);
}
/**
 * Odstavec README k pohonům a proporcionálním prvkům fáze 2a (bez nich ""): co nastavit v měniči /
 * pohonu, tabulka záznamů, rozsahy žádaných, kódy chyb. Parametry pohonu se generátorem nepřenesou.
 */
export function motionReadme(prj, plat) {
    const devs = prj.devices.filter(d => isMotionClass(d.cls));
    if (!devs.length)
        return "";
    const raw = plat === "rockwell" ? "0–100 %" : "0–" + (RAW_MAX[plat] ?? 27648);
    const L = ["", "", tr("POHONY A PROPORCIONÁLNÍ PRVKY (přes běžné I/O)")];
    for (const d of devs) {
        const io = ioOf(prj, d), tag = (s) => io[s] ? io[s].tag : "—";
        if (d.cls === "Vfd") {
            const r = rampStepOf(d);
            L.push("- " + tr("{dev} — frekvenční měnič: chod {run}, žádaná {sp} ({min}–{max} {unit} = surově {raw}), {ramp}.", {
                dev: d.name, run: tag("outRun"), sp: tag("rawSpeed"), min: d.rmin, max: d.rmax, unit: d.unit || "", raw,
                ramp: r ? tr("rampa v PLC {t} s na celý rozsah (po taktech 0,1 s)", { t: d.rampS }) : tr("bez rampy v PLC")
            }));
            L.push("  " + tr("V měniči nastav: povel chod (a směr) ze svorek, žádanou z analogového vstupu se stejným rozsahem, reléové výstupy „připraven“, „porucha“ a „otáčky dosaženy“ (frequency reached). S rampou v PLC nastav rampy měniče krátké; bez ní rampu dělá měnič. Otáčky musí být dosaženy do 5 s po doběhu rampy, jinak porucha."));
        }
        else if (d.cls === "PosDrive") {
            const recs = (d.records || []).filter(x => Number.isFinite(x.no)).map(x => x.no + " = " + (x.name || "?") + (Number.isFinite(x.pos) ? " (" + x.pos + ")" : "")).join(", ");
            L.push("- " + tr("{dev} — polohovací pohon se záznamy: výběr záznamu {bits} bity (záznamy 1–{max}), start, referenční jízda, HALT, hlášení „v poloze“ a „referováno“.", { dev: d.name, bits: selBitsOf(d), max: maxRecord(d) }));
            L.push("  " + tr("Záznamy (poloha a rychlost se nastavují v pohonu — Festo Automation Suite, SMC ACT Controller): {list}.", { list: recs || "—" }));
            L.push("  " + tr("Festo CMMO-ST / CMMT: vstup HALT je aktivní v 0 — výstup outHalt invertuj (relé nebo nastavení pohonu); SMC JXC: HOLD je aktivní v 1. Start musí pohon potvrdit poklesem „v poloze“ do 1 s, jízda do 30 s."));
        }
        else {
            L.push("- " + tr("{dev} — proporcionální ventil: žádaná {sp} ({min}–{max} {unit} = surově {raw}), {fbk}, {ramp}.", {
                dev: d.name, sp: tag("rawSp"), min: d.rmin, max: d.rmax, unit: d.unit || "", raw,
                fbk: io.rawAct ? tr("skutečná {act}, odchylka nad ± {tol} {unit} déle než {t} s = porucha", { act: tag("rawAct"), tol: tolOf(d), unit: d.unit || "", t: tolTicksOf(d) / 10 }) : tr("bez zpětné vazby"),
                ramp: rampStepOf(d) ? tr("rampa v PLC {t} s na celý rozsah (po taktech 0,1 s)", { t: d.rampS }) : tr("bez rampy v PLC")
            }));
        }
    }
    L.push("- " + tr("Kód chyby bloku errCode: 1 porucha pohonu, 2 nepřipraven, 3 bez referování, 4 ztráta hlášení, 5 timeout, 6 odchylka skutečné hodnoty."));
    return L.join("\n");
}
/** Firemní hlavička na začátku README (bez knihovny ""). */
function libReadmeHead(prj, plat) {
    const lib = codeLibrary(prj, plat);
    return lib.header.length ? lib.header.join("\n") + "\n\n" : "";
}
/** Odstavec README o firemní knihovně: použité vlastní šablony a šablony, které použít nešlo. */
function libReadmeTail(prj, plat) {
    const lib = codeLibrary(prj, plat);
    const used = Object.keys(lib.ids).map(c => "FB_" + c + " = " + lib.ids[c]);
    if (!used.length && !lib.issues.length)
        return "";
    const L = ["", "", tr("FIREMNÍ KNIHOVNA {name} {v}", { name: lib.library?.name || "", v: lib.library?.version || "" }).trim()];
    if (used.length)
        L.push("- " + tr("Vlastní šablony bloků (stejné rozhraní jako vestavěné): {list}. Simulace a ověření návrhu počítají s vestavěnými bloky — vlastní blok simulací ověřen není, odlaď ho v cílovém IDE.", { list: used.join(", ") }));
    for (const i of lib.issues.filter(i => i.level === "error"))
        L.push("- " + tr("NEPOUŽITO") + " — " + i.where + ": " + i.msg);
    return L.join("\n");
}
/** Proměnné a tělo šablony FB zapsané v IEC ST. */
export function parseFbTemplate(tpl) {
    const vars = [];
    const re = /(?<![A-Z_])VAR(_INPUT|_OUTPUT)?[ \t]*\n([\s\S]*?)END_VAR/g;
    let m, last = 0;
    while ((m = re.exec(tpl))) {
        const kind = m[1] === "_INPUT" ? "in" : m[1] === "_OUTPUT" ? "out" : "var";
        for (const line of m[2].split("\n")) {
            const v = line.match(/^\s*(\w+)\s*:\s*(\w+)\s*(?::=\s*([^;]+))?;/);
            if (v)
                vars.push({ name: v[1], type: v[2], init: (v[3] || "").trim(), kind });
        }
        last = re.lastIndex;
    }
    return { vars, body: tpl.slice(last, tpl.lastIndexOf("END_FUNCTION_BLOCK")).trim() };
}
/** Čisté ASCII pro soubory Unitronics (názvy a komentáře bez diakritiky a typografie). */
function uniAscii(s) {
    return stripDia(s).replace(/[—–]/g, "-").replace(/°/g, "deg").replace(/[„“”]/g, '"').replace(/[^\x00-\x7F]/g, "?");
}
/** Dialekt UniLogic: středníky za END_IF, desítkové konstanty, převodní funkce TO_*. */
function uniDialect(st) {
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
export function inlineFb(tpl, inst, wired, outs) {
    const { vars, body } = parseFbTemplate(tpl);
    const P = (n) => inst + "_" + n;
    const lines = [];
    for (const v of vars) {
        if (v.kind !== "in")
            continue;
        const src = wired[v.name] ?? v.init;
        if (src)
            lines.push(P(v.name) + " := " + src + ";");
    }
    let b = body;
    const ret = /\n[ \t]*RETURN;[ \t]*\nEND_IF;/;
    if (ret.test(b)) {
        const [head, rest] = b.split(ret);
        b = head + "\nELSE\n" + rest.trim().split("\n").map(l => l ? "    " + l : l).join("\n") + "\nEND_IF;";
    }
    for (const v of vars)
        b = b.replace(new RegExp("\\b" + v.name + "\\b", "g"), P(v.name));
    lines.push(...b.split("\n"));
    for (const [name, tag] of Object.entries(outs))
        lines.push(tag + " := " + P(name) + ";");
    return uniDialect(lines.map(l => l ? "    " + l : l).join("\n"));
}
const UNI_TYPE = { BOOL: "BIT", INT: "INT16", WORD: "UINT16", REAL: "REAL", TON: "TON" };
/**
 * Zařazení zařízení v ploché logice Unitronics: vstupy uvolnění se nerozepisují, jen E-stop
 * se počítá podle svého zařazení bez uvolnění (vypisuje se i mezi volnými signály).
 */
function uniItems(ir) {
    return ir.devices.flatMap(it => it.kind !== "enableInput" ? [it] : it.estop ? [it.alt] : []);
}
/** Tagy k založení v UniLogic: fyzické I/O + stav programu (řízení, instance, časovače). */
export function uniTags(prj) {
    const ir = buildIR(prj), lib = codeLibrary(prj, "unitronics");
    const out = [];
    for (const e of prj.io)
        out.push({ name: e.tag, type: dtFor(e) === "INT" ? "INT16" : "BIT", group: "I/O " + e.dir, hint: hwChannelText(prj, "unitronics", e), cmt: (e.cmt || "").replace(/\s*[–—-]\s*$/, "") });
    /* názvy skupin: stejné klíče dosazuje do svého textu README (genReadme) */
    const gProg = trx("Program"), gTimer = trx("Program – časovač"), gBlock = trx("Blok");
    out.push({ name: "enable", type: "BIT", group: gProg, hint: "", cmt: trx("centrální uvolnění (E-stop TRUE = v pořádku)") });
    for (const d of ir.decls)
        out.push({ name: d.name, type: UNI_TYPE[d.type] || d.type, group: d.type === "TON" ? gTimer : gProg, hint: "", cmt: cmtSafe(declNote(d)).trim() });
    for (const b of uniItems(ir)) {
        if (b.kind !== "fb")
            continue;
        for (const v of parseFbTemplate(fbTemplate(b.cls, "st", lib)).vars) {
            out.push({ name: b.inst + "_" + v.name, type: UNI_TYPE[v.type] || v.type, group: v.type === "TON" ? gTimer : gBlock + " " + b.dev.name, hint: "", cmt: b.dev.name + ": " + v.name });
        }
    }
    return out;
}
export function genUnitronicsTags(prj) {
    const q = (s) => '"' + uniAscii(String(s)).replace(/"/g, "'") + '"';
    const l = ["Name,Data Type,Group,I/O address hint,Comment"];
    for (const t of uniTags(prj))
        l.push([q(t.name), q(t.type), q(t.group), q(t.hint), q(t.cmt)].join(","));
    return l.join("\n");
}
/** Logika stroje jako tělo jedné ST funkce pro UniLogic (stav v globálních tazích). */
export function genMainUnitronics(prj) {
    const ir = buildIR(prj), c = stCtx("unitronics"), lib = codeLibrary(prj, "unitronics");
    const x = (b, n) => irText(b.inputs.find(p => p.name === n).expr, c);
    const parts = [], free = [];
    /* komentáře šablony se překládají až PO rozepsání — inlineFb přepisuje názvy proměnných
       i uvnitř komentářů a přeložený text by mohl některý z nich obsahovat (reset, error…) */
    const fb = (b, skip = []) => {
        const wired = {}, outs = {};
        for (const p of b.inputs)
            if (!skip.includes(p.name))
                wired[p.name] = portText(p, c);
        for (const o of b.outputs)
            if (o.tag)
                outs[o.name] = o.tag;
        return trComments(inlineFb(fbTemplate(b.cls, "st", lib), b.inst, wired, outs), stripDia);
    };
    for (const it of uniItems(ir)) {
        const d = it.dev;
        const title = "    (* " + cmtSafe(d.name + (d.desc ? " - " + d.desc : "")) + " *)";
        if (it.kind === "fb" && (it.cls === "Motor" || it.cls === "Ventil" || it.cls === "Vfd" || it.cls === "PosDrive" || it.cls === "PropValve")) {
            parts.push(title + "\n" + fb(it));
        }
        else if (it.kind === "fb" && it.cls === "AnalogIn") {
            const tag = it.inst + "_value";
            parts.push(title + "  (* " + (d.unit ? trx("hodnota v {unit}: {tag}", { unit: d.unit, tag }) : trx("hodnota v jednotkách snímače: {tag}", { tag })) + " *)\n" + fb(it));
        }
        else if (it.kind === "fb" && it.cls === "AnalogOut") {
            /* žádaná hodnota se zapisuje přímo do tagu value (bez ní ji zapisuje uživatel) */
            const sp = it.setpoint !== undefined;
            parts.push(title + "  (* " + (sp ? trx("žádaná hodnota") + " " + (d.unit || "") : "TODO: " + trx("žádanou hodnotu zapisuj do {tag}", { tag: it.inst + "_value" })) + " *)\n"
                + (sp ? "    " + it.inst + "_value := " + x(it, "value") + ";\n" : "") + fb(it, ["value"]));
        }
        else if (it.kind === "role") {
            const expr = irText(it.expr, c);
            for (const e of it.outs)
                parts.push(title + "  (* " + trx("vazba na stav stroje: {role}", { role: trx(DO_ROLE_TECH[it.role]) }) + " *)\n    "
                    + e.tag + " := " + expr + ";");
        }
        else if (it.kind === "free") {
            for (const e of it.io)
                free.push("    (*   " + e.tag + "  " + (e.cmt || "") + " *)");
        }
    }
    const fault = renderFault(ir, c);
    /* texty jsou tu s diakritikou — čisté ASCII z nich (i z překladu) dělá až uniAscii() na konci */
    const st = `${libHeader(lib, false)}(* ${trx(`Machine.st - logika stroje pro Unitronics UniLogic (UniStream), jazyk ST.
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
export function genFor(prj, plat) {
    /* servoosa na platformě bez podpory: žádný kód (nepřeložitelný program by klamal), jen README s důvodem */
    if (axisBlocked(prj, plat))
        return { "README.txt": axisBlockedReadme(prj, plat) };
    /* styl OOP (jen rodina CODESYS, volba projektu) — stejný IR a šablony, jiný zápis; viz codegen_oop.ts */
    if (codeStyleFor(prj, plat) === "oop")
        return genForOop(prj, plat);
    const files = {};
    if (plat === "unitronics") {
        files["Tags.csv"] = genUnitronicsTags(prj);
        files["Machine.st"] = genMainUnitronics(prj);
    }
    else if (plat === "siemens") {
        /* UTF-8 s BOM: TIA (externí zdroj) i Excel jinak čtou soubor jako ANSI a čeština se rozpadne */
        files["Gen_Tags.tsv"] = "\uFEFF" + genSiemensTagsTSV(prj);
        files["Gen_IO.xml"] = genSiemensTagsXml(prj);
        if (prj.devices.some(d => d.cls !== "DI" && d.cls !== "DO"))
            files["Gen_Library.scl"] = "\uFEFF" + genLibrary(prj, "siemens");
        files["Gen_Main.scl"] = "\uFEFF" + genMainSiemens(prj);
    }
    else if (plat === "rockwell") {
        /* Logix 5000 ST nen\u00ED IEC (bez VAR, FB, TON\u2026) \u2192 L5X s AOI + tagy + rutinou; viz logix.ts */
        files["PLCdesk_Program.L5X"] = genRockwellL5X(prj);
        files["MainRoutine.st"] = genLogixRoutine(prj);
        files["Tags.csv"] = genLogixTagsCsv(prj);
    }
    else {
        const tf = genTagFile(prj, plat);
        files[tf.name] = tf.body;
        files["Gen_Library.st"] = genLibrary(prj, plat);
        files["MAIN.st"] = genMainIEC(prj, plat);
        /* CODESYS rodina: celý program jedním importovatelným souborem (z téhož finálního textu) */
        if (isCodesysFamily(plat))
            files["PLCopen_Import.xml"] = genPLCopenXML(prj, plat);
        if (plat === "omron")
            for (const f of ["Gen_Library.st", "MAIN.st"])
                files[f] = files[f].replace(/\breset\b/g, "resetIn");
    }
    files["README.txt"] = genReadme(prj, plat);
    return files;
}
/** README platformy, která servoosu nepodporuje: proč se kód negeneruje a čím osu nahradit. */
export function axisBlockedReadme(prj, plat) {
    const why = axisSupport(prj, plat).why;
    return tr("PROJEKT: {name} · generováno PLCdesk", { name: prj.meta.name || tr("(bez názvu)") }) + "\n\n" +
        tr("KÓD PRO {plat} SE NEGENERUJE: projekt obsahuje servoosu a platforma ji nepodporuje — {why}", { plat: PLAT[plat].name, why }) + "\n\n" +
        tr("Možnosti: zvol platformu se servoosou (Siemens S7-1200 / S7-1500, Beckhoff TwinCAT, CODESYS SoftMotion, Delta AX, WAGO SoftMotion Light, Omron NJ/NX, Rockwell Logix), nebo osu nahraď polohovacím pohonem se záznamy přes I/O (třída „Polohovací pohon se záznamy“), který podporují všechny platformy.") + "\n" +
        axisReadme(prj, plat) + "\n";
}
