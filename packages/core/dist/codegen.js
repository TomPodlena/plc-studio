/**
 * PLC Studio — generování zdrojových souborů programu pro cílové platformy.
 * Siemens: SCL (external sources) + SimaticML XML + TSV tagů.
 * Ostatní: IEC 61131-3 ST + platformní soubor tagů (GVL / CSV / tab).
 */
import { PLAT, devById, ioOf, usedClasses, instName, dtFor, addrFor, xmlEsc, stripDia, enableInputs, interlockDevs, isDiWait, roleExpr, } from "./model.js";
/** Role výstupů — krátké popisky do komentářů generovaného kódu (trx). */
const DO_ROLE_TECH = {
    run: N_("chod"), fault: N_("porucha"), ready: N_("připraveno"), stopped: N_("stop"), lock: N_("zámek krytů"), auto: N_("AUTO"),
};
/** Analogové vstupy s mezemi — jejich alarm je součástí poruchy stroje. */
export function limitedAnalogs(prj) {
    return prj.devices.filter(d => d.cls === "AnalogIn" && (Number.isFinite(d.limHi) || Number.isFinite(d.limLo)));
}
/** Alarmové výstupy bloků analogů s mezemi (`instB1.alarmHi`…). */
function alarmRefs(prj, L) {
    const out = [];
    for (const d of limitedAnalogs(prj)) {
        if (Number.isFinite(d.limHi))
            out.push(L(instName(d)) + ".alarmHi");
        if (Number.isFinite(d.limLo))
            out.push(L(instName(d)) + ".alarmLo");
    }
    return out;
}
/** Digitální vstupy, na které čeká sekvence. */
export function waitedDis(prj) {
    return new Set(prj.program.seq.filter(isDiWait).map(s => s.dev));
}
import { tr, trx, N_, getLang } from "./i18n.js";
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
    for (const tpl of [SCL_MOTOR, SCL_VENTIL, SCL_AI, SCL_AO, ST_MOTOR, ST_VENTIL, ST_AI, ST_AO]) {
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
    if (plat === "beckhoff" || plat === "codesys" || plat === "schneider")
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
/* --------------------------------------------------------------- sekvence */
/** Zařízení s funkčním blokem a povelem (motory, ventily). */
export function actuators(prj) {
    return prj.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil");
}
/** Proměnná povelu ze sekvence / ručního povelu z HMI pro dané zařízení. */
export function seqVarOf(d) { return (d.cls === "Motor" ? "seqRun_" : "seqOpen_") + d.name; }
export function manVarOf(d) { return (d.cls === "Motor" ? "manRun_" : "manOpen_") + d.name; }
export function seqVars(prj) {
    const vars = new Set();
    for (const s of prj.program.seq) {
        const d = devById(prj, s.dev);
        if (d && (d.cls === "Motor" || d.cls === "Ventil"))
            vars.add(seqVarOf(d));
    }
    return [...vars];
}
export function seqCond(prj, s) {
    if (s.act === "wait" || (s.cond === "time" && !isDiWait(s)))
        return { kind: "time" };
    const d = devById(prj, s.dev);
    if (!d)
        return { kind: "none" };
    const io = ioOf(prj, d);
    if (isDiWait(s)) { // čekání na snímač / tlačítko (hlídací čas = timeS)
        const e = d.cls === "DI" ? (io.in || Object.values(io)[0]) : undefined;
        return e ? { kind: "fbk", io: e, neg: s.act === "waitOff" } : { kind: "none" };
    }
    if (d.cls === "Motor")
        return io.fbkRunning ? { kind: "fbk", io: io.fbkRunning, neg: s.act !== "start" } : { kind: "none" };
    if (d.cls === "Ventil") {
        if (s.act === "open" && io.fbkOpen)
            return { kind: "fbk", io: io.fbkOpen };
        if (s.act === "close" && io.fbkClosed)
            return { kind: "fbk", io: io.fbkClosed };
    }
    return { kind: "none" };
}
/** Kroky s časovačem: výdrž / přechod časem, nebo hlídání kroku se zpětným hlášením. */
export function seqTimedSteps(prj) {
    const list = [];
    prj.program.seq.forEach((s, i) => { if (seqCond(prj, s).kind !== "none")
        list.push(10 + i * 10); });
    return list;
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
export function seqBody(prj, plat) {
    const L = locFn(plat), R = refFn(plat);
    const steps = prj.program.seq;
    if (!steps.length)
        return "";
    const semi = ";"; // GX Works3, Sysmac a Logix vyžadují END_IF;
    const cmt = plat === "siemens" ? (t) => "// " + t : (t) => "(* " + cmtSafe(t) + " *)";
    let b = "    " + cmt("--- " + trx("Automatická sekvence (režim AUTO)") + " ---") + "\n";
    b += "    " + cmt(trx("Vypnutí AUTO, ztráta uvolnění nebo porucha stroje: sekvence do kroku 0, povely vypnout")) + "\n";
    b += "    IF NOT " + L("modeAuto") + " OR NOT " + L("enable") + " OR " + L("machineFault") + " THEN\n";
    b += "        " + L("seqStep") + " := 0;\n";
    for (const v of seqVars(prj))
        b += "        " + L(v) + " := FALSE;\n";
    b += "    END_IF;\n\n";
    b += "    CASE " + L("seqStep") + " OF\n";
    b += "        0: " + cmt(trx("čekání na start")) + "\n";
    b += "            IF " + L("modeAuto") + " AND " + L("enable") + " AND NOT " + L("machineFault") + " AND " + L("cmdAutoStart") + " THEN " + L("seqStep") + " := 10; END_IF" + semi + "\n";
    steps.forEach((s, i) => {
        const n = 10 + i * 10, next = (i === steps.length - 1) ? 0 : 10 + (i + 1) * 10;
        const d = devById(prj, s.dev);
        const c = seqCond(prj, s);
        let title = trx("krok"), action = "";
        if (s.act === "wait")
            title = trx("výdrž {t} s", { t: s.timeS || 1 });
        else if (isDiWait(s))
            title = s.act === "waitOn" ? trx("čekat na {dev}", { dev: d ? d.name : "?" }) : trx("čekat na {dev} = FALSE", { dev: d ? d.name : "?" });
        else if (d && d.cls === "Motor") {
            title = s.act === "start" ? trx("{dev} start", { dev: d.name }) : trx("{dev} stop", { dev: d.name });
            action = "            " + L(seqVarOf(d)) + " := " + (s.act === "start" ? "TRUE" : "FALSE") + ";\n";
        }
        else if (d && d.cls === "Ventil") {
            title = s.act === "open" ? trx("{dev} otevřít", { dev: d.name }) : trx("{dev} zavřít", { dev: d.name });
            action = "            " + L(seqVarOf(d)) + " := " + (s.act === "open" ? "TRUE" : "FALSE") + ";\n";
        }
        b += "        " + n + ": " + cmt(trx("Krok {n}: {title}", { n: i + 1, title })) + "\n" + action;
        const go = L("seqStep") + " := " + next + ";";
        if (c.kind === "time") {
            b += "            IF " + L("tonSeq" + n) + ".Q THEN " + go + " END_IF" + semi + "\n";
        }
        else if (c.kind === "fbk") {
            b += "            IF " + (c.neg ? "NOT " : "") + R(c.io.tag) + " THEN " + go + "\n";
            b += "            ELSIF " + L("tonSeq" + n) + ".Q THEN " + L("machineFault") + " := TRUE; " + L("faultStep") + " := " + n + "; " + cmt(trx("timeout kroku {t} s", { t: s.timeS || 1 })) + "\n";
            b += "            END_IF" + semi + "\n";
        }
        else {
            const why = d && d.cls === "Ventil" ? trx("bez koncového snímače") : d && d.cls === "Motor" ? trx("bez zpětného hlášení") : trx("bez podmínky");
            b += "            IF TRUE THEN " + go + " END_IF" + semi + " " + cmt(why) + "\n";
        }
    });
    b += "    END_CASE;\n\n";
    for (const n of seqTimedSteps(prj)) {
        const s = prj.program.seq[(n - 10) / 10];
        b += "    " + L("tonSeq" + n) + "(IN := (" + L("seqStep") + " = " + n + "), PT := " + timeLit(s.timeS || 1) + ");\n";
    }
    return b + "\n";
}
/* Surový rozsah analogu dle platformy (typický modul; TODO ověřit podle skutečného modulu).
   Předává se vždy — FX5 nezná počáteční hodnoty a výchozí 27648 je rozsah Siemens. */
const RAW_MAX = { beckhoff: 32767, codesys: 32767, mitsubishi: 16000, schneider: 10000, omron: 32000 };
function rawMaxArg(plat) {
    const v = RAW_MAX[plat];
    return v ? ", rawMax := " + v + " (* TODO: " + stripDia(trx("rozsah dle modulu")) + " *)" : "";
}
/** Text do komentáře (* … *): bez diakritiky a pomlček, bez konce řádku; „(*“ a „*)“ z textu
    uživatele rozdělí mezerou (CODESYS/TwinCAT komentáře vnořují — jinak by rozbily zbytek souboru). */
export function cmtSafe(t) {
    return stripDia(t).replace(/[–—]/g, "-").replace(/[\r\n]+/g, " ").replace(/\(\*/g, "( *").replace(/\*\)/g, "* )");
}
/** Deklarace řízení stroje: režimy, kvitace, ruční povely, porucha a sekvence. */
export function ctrlDecls(prj, plat) {
    const out = [];
    const hasSeq = prj.program.seq.length > 0, acts = actuators(prj);
    const c = (t) => plat === "siemens" ? "// " + t : "(* " + cmtSafe(t) + " *)";
    if (hasSeq) {
        out.push("    modeAuto : BOOL;      " + c("TODO: " + trx("přepínač režimu (HMI); FALSE = ruční režim")));
        out.push("    cmdAutoStart : BOOL;  " + c("TODO: " + trx("tlačítko start auto")));
    }
    /* stejná podmínka jako u faultBlock / roleExpr: meze analogů a DO s vazbou na stav stroje */
    if (hasSeq || acts.length || limitedAnalogs(prj).length || prj.devices.some(d => d.cls === "DO" && d.role)) {
        out.push("    cmdAck : BOOL;        " + c("TODO: " + trx("tlačítko kvitace poruchy (HMI)")));
        out.push("    machineFault : BOOL;  " + c(trx("porucha stroje (chyba bloku / timeout kroku); drží do kvitace")));
    }
    for (const d of acts)
        out.push("    " + manVarOf(d) + " : BOOL;  " + c("TODO: " + (hasSeq ? trx("ruční povel z HMI (platí při vypnutém AUTO)") : trx("ruční povel z HMI"))));
    if (hasSeq) {
        out.push("    faultStep : INT;      " + c(trx("krok sekvence, ve kterém vypršel čas (diagnostika)")));
        out.push("    seqStep : INT;");
        for (const v of seqVars(prj))
            out.push("    " + v + " : BOOL;");
        for (const n of seqTimedSteps(prj))
            out.push("    tonSeq" + n + " : " + (plat === "siemens" ? "TON_TIME" : "TON") + ";");
    }
    return out.join("\n");
}
/** Výraz „povel zapnout": sekvence NEBO ruční povel (v ručním režimu). */
export function cmdExpr(prj, plat, d) {
    const L = locFn(plat);
    if (!prj.program.seq.length)
        return L(manVarOf(d));
    const man = "(" + L(manVarOf(d)) + " AND NOT " + L("modeAuto") + ")";
    return seqVars(prj).includes(seqVarOf(d)) ? L(seqVarOf(d)) + " OR " + man : man;
}
/** Zachycení poruchy bloků a kvitace — volá se ZA instancemi (čerstvé výstupy error). */
export function faultBlock(prj, plat) {
    const L = locFn(plat), acts = actuators(prj);
    const alarms = alarmRefs(prj, L);
    if (!acts.length && !prj.program.seq.length && !alarms.length)
        return "";
    const cmt = plat === "siemens" ? (t) => "// " + t : (t) => "(* " + cmtSafe(t) + " *)";
    const anyErr = [...acts.map(d => L(instName(d)) + ".error"), ...alarms].join(" OR ");
    let b = "    " + cmt("--- " + trx("Porucha stroje a kvitace") + " ---") + "\n";
    if (anyErr)
        b += "    IF " + anyErr + " THEN " + L("machineFault") + " := TRUE; END_IF;\n";
    b += "    IF " + L("cmdAck") + (anyErr ? " AND NOT (" + anyErr + ")" : "") + " THEN " + L("machineFault") + " := FALSE;" +
        (prj.program.seq.length ? " " + L("faultStep") + " := 0;" : "") + " END_IF;\n";
    return b;
}
export function wiring(prj, plat) {
    const R = refFn(plat), L = locFn(plat);
    const inst = [], calls = [], free = [];
    const cm = (t) => plat === "siemens" ? "// " + t : "(* " + cmtSafe(t) + " *)";
    const locked = new Set([...interlockDevs(prj).map(d => d.id), prj.program.estop]); // E-stop a blokování jsou v enable, ne volné
    const waited = waitedDis(prj);
    for (const d of prj.devices) {
        if (locked.has(d.id))
            continue;
        const io = ioOf(prj, d);
        const title = (d.name + (d.desc ? " – " + d.desc : "")).replace(/[\r\n]+/g, " ");
        const c = plat === "siemens" ? "    // " + title : "    (* " + cmtSafe(title) + " *)";
        if (d.cls === "Motor") {
            inst.push({ n: instName(d), t: "FB_Motor" });
            const cmd = cmdExpr(prj, plat, d);
            calls.push(c + "\n    " + L(instName(d)) + "(enable := " + L("enable") + ",\n" +
                "        cmdStart := " + cmd + ",\n" +
                "        cmdStop := NOT (" + cmd + "),\n" +
                "        reset := " + L("cmdAck") + ",\n" +
                "        fbkRunning := " + (io.fbkRunning ? R(io.fbkRunning.tag) : "TRUE") + "," + (io.fbkRunning ? "" : " " + cm(trx("bez zpětného hlášení"))) + "\n" +
                "        fault := " + (io.fault ? R(io.fault.tag) : "FALSE") + ",\n" +
                "        outRun => " + (io.outRun ? R(io.outRun.tag) : L("tempUnused")) + ");");
        }
        else if (d.cls === "Ventil") {
            inst.push({ n: instName(d), t: "FB_Ventil" });
            const cmd = cmdExpr(prj, plat, d);
            calls.push(c + "\n    " + L(instName(d)) + "(enable := " + L("enable") + ",\n" +
                "        cmdOpen := " + cmd + ",\n" +
                "        cmdClose := NOT (" + cmd + "),\n" +
                "        reset := " + L("cmdAck") + ",\n" +
                "        fbkOpen := " + (io.fbkOpen ? R(io.fbkOpen.tag) : "TRUE") + ",\n" +
                "        fbkClosed := " + (io.fbkClosed ? R(io.fbkClosed.tag) : "TRUE") + ",\n" +
                "        outOpen => " + (io.outOpen ? R(io.outOpen.tag) : L("tempUnused")) + ");");
        }
        else if (d.cls === "AnalogIn") {
            inst.push({ n: instName(d), t: "FB_AnalogIn" });
            /* FX5 nepodporuje počáteční hodnoty proměnných → meze předat vždy (jinak 0 = trvalá porucha) */
            const allLim = plat === "mitsubishi";
            const lim = (Number.isFinite(d.limHi) ? ", limitHi := " + fmtR(d.limHi) : allLim ? ", limitHi := 1.0E+6" : "")
                + (Number.isFinite(d.limLo) ? ", limitLo := " + fmtR(d.limLo) : allLim ? ", limitLo := -1.0E+6" : "");
            calls.push(c + "\n    " + L(instName(d)) + "(rawValue := " + (io.raw ? R(io.raw.tag) : "0") + ",\n" +
                "        scaleMin := " + fmtR(d.rmin) + ", scaleMax := " + fmtR(d.rmax) + rawMaxArg(plat) + lim + "); " +
                cm((d.unit || trx("jednotky dle snímače")) + (lim ? "; " + trx("překročení meze = porucha stroje") : "")));
        }
        else if (d.cls === "AnalogOut") {
            inst.push({ n: instName(d), t: "FB_AnalogOut" });
            const sp = Number.isFinite(d.setpoint);
            calls.push(c + "\n    " + L(instName(d)) + "(value := " + (sp ? fmtR(d.setpoint) : "0.0") + ", " + cm(sp ? trx("žádaná hodnota") + " " + (d.unit || "") : "TODO: " + trx("žádaná hodnota")) + "\n" +
                "        scaleMin := " + fmtR(d.rmin) + ", scaleMax := " + fmtR(d.rmax) + rawMaxArg(plat) + ",\n" +
                "        rawValue => " + (io.raw ? R(io.raw.tag) : L("tempUnused2")) + ");");
        }
        else if (d.cls === "DO" && d.role) {
            for (const e of Object.values(io)) {
                calls.push(c + "\n    " + R(e.tag) + " := " + roleExpr(d.role, prj.program.seq.length > 0, L) + "; " + cm(trx("vazba na stav stroje: {role}", { role: trx(DO_ROLE_TECH[d.role]) })));
            }
        }
        else if (d.cls === "DI" && waited.has(d.id)) {
            continue; // vstup čte sekvence (krok čekání)
        }
        else {
            for (const e of Object.values(io)) {
                free.push("    " + (plat === "siemens" ? "//" : "(*") + "   " + ((plat === "siemens" ? e.addr : addrFor(plat, e)) || "").padEnd(8) + " " + R(e.tag) + "  " + (plat === "siemens" ? e.cmt : cmtSafe(e.cmt) + " *)"));
            }
        }
    }
    return { inst, calls, free };
}
/**
 * Výraz centrálního uvolnění: E-stop AND blokovací vstupy (kryty, závory…) + komentář.
 * FALSE kteréhokoli vstupu = enable FALSE → bloky vypnou výstupy, sekvence do kroku 0.
 */
export function enableExpr(prj, plat) {
    const R = refFn(plat), sie = plat === "siemens";
    const ins = enableInputs(prj);
    if (!ins.length)
        return "TRUE " + (sie ? "// TODO: " + trx("napojit bezpečnostní okruh!") : "(* TODO: " + stripDia(trx("napojit bezpečnostní okruh!")) + " *)");
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
    return ins.map(x => R(x.io.tag)).join(" AND ") + " " + (sie ? "// " + notes.join("; ") : "(* " + notes.join("; ") + " *)");
}
/* ------------------------------------------------------- soubory: Siemens */
/** Kultura komentáře tagu v SimaticML — musí být mezi jazyky projektu TIA (Project languages). */
const TIA_CULTURE = { cs: "cs-CZ", en: "en-US", de: "de-DE", es: "es-ES", zh: "zh-CN" };
export function genSiemensTagsXml(prj) {
    let id = 0;
    const nid = () => (id++).toString();
    let x = '<?xml version="1.0" encoding="utf-8"?>\n<Document>\n  <Engineering version="V21" />\n  <SW.Tags.PlcTagTable ID="' + nid() + '">\n    <AttributeList>\n      <Name>Gen_IO</Name>\n    </AttributeList>\n    <ObjectList>\n';
    for (const e of prj.io) {
        x += '      <SW.Tags.PlcTag ID="' + nid() + '" CompositionName="Tags">\n        <AttributeList>\n          <DataTypeName>' + (dtFor(e) === "INT" ? "Int" : "Bool") + '</DataTypeName>\n          <LogicalAddress>' + xmlEsc(e.addr) + '</LogicalAddress>\n          <Name>' + xmlEsc(e.tag) + '</Name>\n        </AttributeList>\n';
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
        l.push([e.tag, dtFor(e) === "INT" ? "Int" : "Bool", e.addr, e.cmt || ""].join("\t"));
    return l.join("\n");
}
export function genLibrary(prj, plat) {
    const u = usedClasses(prj);
    const parts = [];
    const hdr = plat === "siemens"
        ? "// Gen_Library.scl – " + trx("knihovna šablon (generováno PLC Studio)") + "\n// " + trx("Import: External source files → Generate blocks from source (PŘED Gen_Main)")
        : "(* Gen_Library.st - " + stripDia(trx("knihovna šablon (generováno PLC Studio)")) + " - " + PLAT[plat].name + " *)";
    parts.push(hdr, "");
    const T = plat === "siemens"
        ? { Motor: SCL_MOTOR, Ventil: SCL_VENTIL, AnalogIn: SCL_AI, AnalogOut: SCL_AO }
        : { Motor: ST_MOTOR, Ventil: ST_VENTIL, AnalogIn: ST_AI, AnalogOut: ST_AO };
    /* komentáře šablon se překládají až tady; IEC ST zůstává bez diakritiky */
    const fix = plat === "siemens" ? undefined : stripDia;
    for (const c of ["Motor", "Ventil", "AnalogIn", "AnalogOut"])
        if (u.has(c))
            parts.push(trComments(T[c], fix), "");
    if (parts.length <= 2)
        parts.push(plat === "siemens" ? "// (" + trx("žádné instancované třídy zařízení") + ")" : "(* " + cmtSafe(trx("žádné instancované třídy zařízení")) + " *)");
    return parts.join("\n");
}
export function genMainSiemens(prj) {
    const { inst, calls, free } = wiring(prj, "siemens");
    const decl = ctrlDecls(prj, "siemens"), fault = faultBlock(prj, "siemens");
    let v = inst.map(i => '    ' + i.n + ' : "' + i.t + '";').join("\n");
    if (decl)
        v += (v ? "\n" : "") + decl;
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
${tmpDecl(calls, "Bool", "Int") ? "VAR_TEMP" + tmpDecl(calls, "Bool", "Int") + "\nEND_VAR\n" : ""}
BEGIN
    #enable := #enableIn;

${seqBody(prj, "siemens")}${calls.join("\n\n") || "    ;"}${fault ? "\n\n" + fault.trimEnd() : ""}

    // ${trx("Volné signály (DI/DO) pro vlastní logiku:")}
${free.join("\n") || "    //   (" + trx("žádné") + ")"}
END_FUNCTION_BLOCK

DATA_BLOCK "InstMachine"
{ S7_Optimized_Access := 'TRUE' }
"FB_Machine"
BEGIN
END_DATA_BLOCK

(* --- ${trx("Vložit do OB1 (Main)")} ---------------------------------
   "InstMachine"(enableIn := ${enableExpr(prj, "siemens").split("//")[0].trim()});
   ----------------------------------------------------------- *)`;
}
/* ----------------------------------------------------------- soubory: IEC */
export function genGVL(prj, plat) {
    const lines = ["(* GVL_IO - " + stripDia(trx("globální proměnné / fyzické I/O - generováno PLC Studio")) + " *)", "{attribute 'qualified_only'}", "VAR_GLOBAL"];
    for (const e of prj.io) {
        const at = addrFor(plat, e);
        lines.push("    " + e.tag + (at ? " AT " + at : "") + " : " + dtFor(e) + ";" + (e.cmt ? " (* " + cmtSafe(e.cmt) + " *)" : ""));
    }
    lines.push("END_VAR");
    return lines.join("\n");
}
/** Deklarace pomocných proměnných jen pro výstupy, které se nečtou (jinak varování IDE). */
function tmpDecl(calls, b, i) {
    const all = calls.join("\n");
    return (/\btempUnused\b/.test(all) ? "\n    tempUnused : " + b + ";" : "") + (/\btempUnused2\b/.test(all) ? "\n    tempUnused2 : " + i + ";" : "");
}
export function genMainIEC(prj, plat) {
    const { inst, calls, free } = wiring(prj, plat);
    const decl = ctrlDecls(prj, plat), fault = faultBlock(prj, plat);
    let v = inst.map(i => "    " + i.n + " : " + i.t + ";").join("\n");
    if (decl)
        v += (v ? "\n" : "") + decl;
    return `(* MAIN - ${stripDia(trx("hlavní program (generováno PLC Studio)"))} - ${PLAT[plat].name} *)
PROGRAM MAIN
VAR
    enable : BOOL;
${v || "    (* " + stripDia(trx("žádné instance")) + " *)"}${tmpDecl(calls, "BOOL", "INT")}
END_VAR

enable := ${enableExpr(prj, plat)};

${seqBody(prj, plat)}${calls.join("\n\n") || ";"}${fault ? "\n\n" + fault.trimEnd() : ""}

(* ${stripDia(trx("Volné signály (DI/DO) pro vlastní logiku:"))} *)
${free.join("\n") || "(*   " + stripDia(trx("žádné")) + " *)"}
END_PROGRAM`;
}
/* P1: Rockwell CSV s povinnou hlavičkou (remark + verze 0.3), INT místo WORD. */
export function genTagFile(prj, plat) {
    const q = (s) => '"' + stripDia(s).replace(/"/g, "'") + '"';
    if (plat === "rockwell")
        return { name: "Tags.csv", body: genLogixTagsCsv(prj) }; // logix.ts
    if (plat === "mitsubishi") {
        const l = ['"Label Name","Data Type","Class","Comment","Assign (Device/Label)"'];
        for (const e of prj.io)
            l.push(['"' + e.tag + '"', '"' + (dtFor(e) === "INT" ? "Word [Signed]" : "Bit") + '"', '"VAR_GLOBAL"', '"' + uniAscii(e.cmt || "").replace(/"/g, "'") + '"', '"' + addrFor(plat, e) + '"'].join(","));
        return { name: "GlobalLabels.csv", body: l.join("\n") };
    }
    if (plat === "omron") {
        /* sloupce jako tabulka Global Variables v Sysmac Studiu: Name, Data Type, Initial Value, AT,
           Retain, Constant, Network Publish, Comment — bez hlavičky (vložila by se jako proměnná) */
        const l = [];
        for (const e of prj.io)
            l.push([e.tag, dtFor(e), "", "", "", "", "", uniAscii(e.cmt || "")].join("\t"));
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
                ? tr("Naimportuj program PLCStudio_Program.L5X — obsahuje tagy, Add-On Instructions i rutinu (postup níže).")
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
    const common = tr("PROJEKT: {name} · {tags} tagů · {devs} zařízení · generováno PLC Studio", { name: prj.meta.name || tr("(bez názvu)"), tags: prj.io.length, devs: prj.devices.length }) + "\n\n" +
        tr("SPOLEČNÉ KROKY") + "\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n") + "\n";
    /* nadpis (název produktu se nepřekládá) + odrážky */
    const list = (title, ...items) => title + "\n" + items.map(s => "- " + s).join("\n");
    const spec = {
        siemens: () => list("SIEMENS TIA PORTAL (V17–V21, S7-1200/1500)", tr("Gen_Tags.tsv: otevři v Excelu (UTF-8, oddělovač tabulátor), list přejmenuj na „PLC Tags“, ulož jako .xlsx a v tabulce tagů dej Import (sloupce Name / Data Type / Logical Address / Comment odpovídají formátu TIA)."), tr("Gen_IO.xml: import přes Openness. Pro V17–V20 přepiš v hlavičce Engineering version V21 na svou verzi; jazyk komentářů (Culture) musí být mezi jazyky projektu."), tr("Adresy jsou návrh (analogy od %IW64 = integrované AI S7-1200) — srovnej je se start address modulů v Device configuration."), tr("cmdAutoStart je úrovňový povel — napoj ho na tlačítko (puls), ne na přepínač, jinak se po skončení cyklu hned spustí další."), tr(`Gen_Library.scl a Gen_Main.scl: Program blocks → External source files →
  Add new external file → pravý klik → Generate blocks from source (NEJDŘÍV knihovnu).`), tr("Vznikne FB_Machine + InstMachine; volání vlož do OB1 (komentář na konci Gen_Main)."), tr("Doplň diagnostické OB 82/86/121/122, ať CPU nejde do STOP při poruše periferie."), tr("Test: PLCSIM / PLCSIM Advanced.")),
        rockwell: () => list(tr("ROCKWELL STUDIO 5000 LOGIX DESIGNER (CompactLogix 5380 / ControlLogix 5580) — soubory PLCStudio_Program.L5X, MainRoutine.st a Tags.csv") + "\n" +
            tr(`POZOR — NEOVĚŘENO PŘEKLADEM: výstup pro Logix nebyl zkoušen ve Studiu 5000. Struktura L5X
vychází z příručky 1756-RM014 a reálných exportů. Při prvním importu zkontroluj hlášení importu
a Verify Controller (hlavně FBD_TIMER v AOI, výchozí hodnoty parametrů a verzi souboru).`) + "\n", tr(`PLCStudio_Program.L5X (hlavní cesta): v Controller Organizer pravý klik na MainTask →
  Add → Import Program… a vyber soubor. Vznikne program {prog} s rutinou MainRoutine (ST)
  a programovými tagy, Add-On Instructions FB_Motor / FB_Ventil / FB_AnalogIn / FB_AnalogOut
  a I/O tagy (controller scope). Pak Verify Controller. Soubor nese verzi {rev} — pro starší
  verzi Logix Designeru uprav atribut SoftwareRevision.`, { prog: LX_PROGRAM, rev: LX_SOFTWARE_REVISION }), tr(`Bloky zařízení jsou Add-On Instructions (ST) ze stejných šablon jako u ostatních platforem:
  TON → TONR (FBD_TIMER, PRE v ms se nastaví před voláním), WORD → DINT, RETURN → ELSE.
  Instance se volají přes členy: instM1.enable := …; FB_Motor(instM1); M1_outRun := instM1.outRun;`), tr(`I/O tagy jsou po importu běžné tagy (BOOL / REAL) bez vazby na hardware. Připoj je na body
  modulů: vlastnosti tagu → Type: Alias → Alias For (např. M1_fbkRunning → Local:1:I.Pt00.Data
  u modulů 5069 / CompactLogix 5380; u starších modulů 1769 je to Local:1:I.Data.0), nebo
  importem Tags.csv (níže). Navržený bod modulu je v popisu každého I/O tagu.`), tr(`Tags.csv (náhradní cesta): Tools → Import → Tags and Logic Comments. I/O jsou v něm ALIAS
  na Local:<slot>:I.Pt<nn>.Data (DI/DO) a Ch<nn>.Data (AI/AO) podle předpokládaného osazení
  lokálních slotů: {slots}. Moduly musí v I/O Configuration existovat dřív než import; když se
  osazení liší, uprav sloupec SPECIFIER. Programové tagy mají SCOPE {prog}, instance bloků
  (FB_*) projdou jen tehdy, když jsou AOI už v projektu (z L5X). Soubor needituj v Excelu.`, { slots: lxSlotText(prj) || tr("(nejde odvodit z adres — aliasy doplň ručně)"), prog: LX_PROGRAM }), tr("MainRoutine.st: totéž tělo rutiny jako v L5X, bez deklarací — pro ruční vložení do ST rutiny."), tr(`Analogy: moduly 5069-IF8 / 5069-OF4 dávají a berou Chxx.Data jako REAL. V konfiguraci modulu
  nastav Low/High Engineering 0–100 (procenta rozsahu); bloky přepočítají 0–100 % na
  scaleMin…scaleMax (rawMax = 100.0).`), tr("Stavová slova status jsou DINT: 16#8001 blokováno, 16#8002 porucha (do INT se 16#8001 nevejde)."), tr(`Nejkratší test: nový projekt CompactLogix 5380 (např. 5069-L306ER) s moduly podle osazení
  výše → Import Program (L5X) → Verify Controller bez chyb → Logix Echo nebo emulátor: modeAuto := 1,
  puls cmdAutoStart a sleduj seqStep a výstupy.`)),
        beckhoff: () => list("BECKHOFF TWINCAT 3", tr(`GVL_IO.st: PLC projekt → Add → Global Variable List, vlož obsah.
  Adresy %IX/%QX můžeš nechat a nalinkovat v I/O mapování, nebo použít AT %I*.`), tr("Gen_Library.st: každý FUNCTION_BLOCK vlož jako nový POU (ST)."), tr("MAIN.st: obsah do MAIN (PRG) a zavolej v PlcTask."), tr("Test: lokální runtime na PC (TwinCAT XAR).")),
        codesys: () => list("CODESYS V3.5 (WAGO, Festo, Eaton…)", tr("GVL_IO.st: Application → Add Object → Global Variable List s názvem přesně GVL_IO (MAIN píše GVL_IO.<tag>), obsah nahraď."), tr("Gen_Library.st / MAIN.st: editor POU má dvě části — do HORNÍ (deklarace) vlož řádky od FUNCTION_BLOCK / PROGRAM po poslední END_VAR, do DOLNÍ (implementace) zbytek BEZ END_FUNCTION_BLOCK / END_PROGRAM. Každý blok jako nový POU (Function Block, ST)."), tr("MAIN: vytvoř POU „MAIN“ (Program, ST) a přidej ho do MainTask místo PLC_PRG."), tr("Adresy jsou návrh (analogy jako index slova: %IW32 = bajty 64–65) — porovnej s I/O mapováním zařízení (WAGO: analogové moduly jsou v obrazu procesu první), nebo AT smaž a namapuj GVL_IO v I/O Mapping."), tr("Test: CODESYS Control Win (soft PLC).")),
        mitsubishi: () => list("MITSUBISHI GX WORKS3 (iQ-F/iQ-R)", tr(`GlobalLabels.csv: Navigation → Label → Global Label → import CSV
  (sloupec Assign obsahuje návrh X/Y — ověř dle skutečných modulů; formát CSV
  se liší podle verze GX Works3, srovnej s exportem ze své instalace).`), tr("Gen_Library.st: Function Block do knihovny projektu (jazyk ST)."), tr("MAIN.st: GX Works3 edituje tělo programu odděleně od návěští — do ProgPou (ST) vlož jen tělo (od řádku za END_VAR po END_PROGRAM) a lokální návěští založ podle bloku VAR."), tr("Adresy X/Y jsou pro FX5 osmičkové (X0–X7, X10…); analogy přiřaď na SD6020 / SD6060 (vestavěné AI) nebo vyrovnávací paměť modulu U…\\G…; rawMax je v kódu 16000 (TODO podle modulu)."), tr("TON na FX5 bere nejvýš 32767 ms — kroky s delším časem kontrola návrhu hlásí; uprav je (např. TIMER_100_FB_M nebo rozdělení kroku)."), tr("Test: GX Simulator3.")),
        schneider: () => list("SCHNEIDER ECOSTRUXURE MACHINE EXPERT (M241/M262)", tr("Platforma je postavená na CODESYS — postup shodný: GVL, POU (ST), MAIN do tasku."), tr("Adresy %IX/%QX namapuj na embedded I/O / TM3 moduly v konfiguraci."), tr("Pro Control Expert (M580) je nutné bloky přenést jako DFB — struktura sedí."), tr("Test: simulátor v Machine Expert.")),
        omron: () => list("OMRON SYSMAC STUDIO (NX/NJ)", tr("Variables.txt: v Global Variables vyber první prázdnou buňku sloupce Name a vlož (Ctrl+V) — sloupce Name, Data Type, Initial Value, AT, Retain, Constant, Network Publish, Comment."), tr("AT sloupec nech prázdný a namapuj na I/O porty zařízení (EtherCAT) v projektu."), tr("Gen_Library.st: každý blok jako Function Block (ST) do POUs → Function Blocks; vstup kvitace se jmenuje resetIn (Reset je instrukce Sysmac)."), tr("MAIN.st: Sysmac edituje tělo programu odděleně od proměnných — do Program0 (ST) vlož jen tělo (od řádku za END_VAR po END_PROGRAM) a proměnné z bloku VAR založ v tabulce lokálních proměnných."), tr("rawMax analogů je v kódu 32000 s poznámkou TODO — uprav podle rozsahu svého modulu NX."), tr("Test: Simulace přímo v Sysmac Studiu.")),
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
    return common + "\n" + spec[plat]();
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
const FB_TPL = { Motor: ST_MOTOR, Ventil: ST_VENTIL, AnalogIn: ST_AI, AnalogOut: ST_AO };
/** Tagy k založení v UniLogic: fyzické I/O + stav programu (řízení, instance, časovače). */
export function uniTags(prj) {
    const out = [];
    for (const e of prj.io)
        out.push({ name: e.tag, type: dtFor(e) === "INT" ? "INT16" : "BIT", group: "I/O " + e.dir, hint: e.addr, cmt: (e.cmt || "").replace(/\s*[–—-]\s*$/, "") });
    /* názvy skupin: stejné klíče dosazuje do svého textu README (genReadme) */
    const gProg = trx("Program"), gTimer = trx("Program – časovač"), gBlock = trx("Blok");
    out.push({ name: "enable", type: "BIT", group: gProg, hint: "", cmt: trx("centrální uvolnění (E-stop TRUE = v pořádku)") });
    for (const line of ctrlDecls(prj, "unitronics").split("\n")) {
        const m = line.match(/^\s*(\w+)\s*:\s*(\w+);\s*(?:\(\*\s*(.*?)\s*\*\))?/);
        if (m)
            out.push({ name: m[1], type: UNI_TYPE[m[2]] || m[2], group: m[2] === "TON" ? gTimer : gProg, hint: "", cmt: m[3] || "" });
    }
    for (const d of prj.devices) {
        const tpl = FB_TPL[d.cls];
        if (!tpl)
            continue;
        for (const v of parseFbTemplate(tpl).vars) {
            out.push({ name: instName(d) + "_" + v.name, type: UNI_TYPE[v.type] || v.type, group: v.type === "TON" ? gTimer : gBlock + " " + d.name, hint: "", cmt: d.name + ": " + v.name });
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
    const plat = "unitronics";
    const parts = [];
    /* komentáře šablony se překládají až PO rozepsání — inlineFb přepisuje názvy proměnných
       i uvnitř komentářů a přeložený text by mohl některý z nich obsahovat (reset, error…) */
    const fb = (tpl, inst, wired, outs) => trComments(inlineFb(tpl, inst, wired, outs), stripDia);
    for (const d of prj.devices) {
        const io = ioOf(prj, d), inst = instName(d);
        const title = "    (* " + cmtSafe(d.name + (d.desc ? " - " + d.desc : "")) + " *)";
        if (d.cls === "Motor") {
            const cmd = cmdExpr(prj, plat, d);
            parts.push(title + "\n" + fb(ST_MOTOR, inst, {
                enable: "enable", cmdStart: cmd, cmdStop: "NOT (" + cmd + ")", reset: "cmdAck",
                fbkRunning: io.fbkRunning ? io.fbkRunning.tag : "TRUE", fault: io.fault ? io.fault.tag : "FALSE",
            }, io.outRun ? { outRun: io.outRun.tag } : {}));
        }
        else if (d.cls === "Ventil") {
            const cmd = cmdExpr(prj, plat, d);
            parts.push(title + "\n" + fb(ST_VENTIL, inst, {
                enable: "enable", cmdOpen: cmd, cmdClose: "NOT (" + cmd + ")", reset: "cmdAck",
                fbkOpen: io.fbkOpen ? io.fbkOpen.tag : "TRUE", fbkClosed: io.fbkClosed ? io.fbkClosed.tag : "TRUE",
            }, io.outOpen ? { outOpen: io.outOpen.tag } : {}));
        }
        else if (d.cls === "AnalogIn") {
            const tag = inst + "_value";
            parts.push(title + "  (* " + (d.unit ? trx("hodnota v {unit}: {tag}", { unit: d.unit, tag }) : trx("hodnota v jednotkách snímače: {tag}", { tag })) + " *)\n" + fb(ST_AI, inst, {
                rawValue: io.raw ? io.raw.tag : "0", scaleMin: fmtR(d.rmin), scaleMax: fmtR(d.rmax),
                ...(Number.isFinite(d.limHi) ? { limitHi: fmtR(d.limHi) } : {}), ...(Number.isFinite(d.limLo) ? { limitLo: fmtR(d.limLo) } : {}),
            }, {}));
        }
        else if (d.cls === "AnalogOut") {
            const sp = Number.isFinite(d.setpoint);
            parts.push(title + "  (* " + (sp ? trx("žádaná hodnota") + " " + (d.unit || "") : "TODO: " + trx("žádanou hodnotu zapisuj do {tag}", { tag: inst + "_value" })) + " *)\n"
                + (sp ? "    " + inst + "_value := " + fmtR(d.setpoint) + ";\n" : "") + fb(ST_AO, inst, {
                scaleMin: fmtR(d.rmin), scaleMax: fmtR(d.rmax),
            }, io.raw ? { rawValue: io.raw.tag } : {}));
        }
        else if (d.cls === "DO" && d.role) {
            for (const e of Object.values(io))
                parts.push(title + "  (* " + trx("vazba na stav stroje: {role}", { role: trx(DO_ROLE_TECH[d.role]) }) + " *)\n    "
                    + e.tag + " := " + roleExpr(d.role, prj.program.seq.length > 0, v => v) + ";");
        }
    }
    const locked = new Set(interlockDevs(prj).map(d => d.id));
    const waited = waitedDis(prj);
    const free = prj.devices.filter(d => (d.cls === "DI" || d.cls === "DO") && !locked.has(d.id) && !waited.has(d.id) && !(d.cls === "DO" && d.role))
        .flatMap(d => Object.values(ioOf(prj, d)).map(e => "    (*   " + e.tag + "  " + (e.cmt || "") + " *)"));
    const fault = faultBlock(prj, plat).replace(/\b(inst\w+)\.(error|alarmHi|alarmLo)\b/g, "$1_$2");
    /* texty jsou tu s diakritikou — čisté ASCII z nich (i z překladu) dělá až uniAscii() na konci */
    const st = `(* ${trx(`Machine.st - logika stroje pro Unitronics UniLogic (UniStream), jazyk ST.
   Generováno PLC Studio. Obsah vlož do JEDNÉ ST funkce volané každý scan.
   ST funkce v UniLogic nemá vlastní paměť: všechny tagy z Tags.csv založ jako
   GLOBÁLNÍ. Bloky zařízení jsou proto rozepsané přímo zde (předpona instX_).`)} *)

    enable := ${enableExpr(prj, plat)};

${seqBody(prj, plat)}${parts.join("\n\n") || "    ;"}${fault ? "\n\n" + fault.trimEnd() : ""}

    (* ${trx("Volné signály (DI/DO) pro vlastní logiku:")} *)
${free.join("\n") || "    (*   " + trx("žádné") + " *)"}
`;
    return uniAscii(uniDialect(st));
}
/** Všechny generované soubory programu pro jednu platformu. */
export function genFor(prj, plat) {
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
        files["PLCStudio_Program.L5X"] = genRockwellL5X(prj);
        files["MainRoutine.st"] = genLogixRoutine(prj);
        files["Tags.csv"] = genLogixTagsCsv(prj);
    }
    else {
        const tf = genTagFile(prj, plat);
        files[tf.name] = tf.body;
        files["Gen_Library.st"] = genLibrary(prj, plat);
        files["MAIN.st"] = genMainIEC(prj, plat);
        if (plat === "omron")
            for (const f of ["Gen_Library.st", "MAIN.st"])
                files[f] = files[f].replace(/\breset\b/g, "resetIn");
    }
    files["README.txt"] = genReadme(prj, plat);
    return files;
}
