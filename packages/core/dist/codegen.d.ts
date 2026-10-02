/**
 * PLC Studio — generování zdrojových souborů programu pro cílové platformy.
 * Siemens: SCL (external sources) + SimaticML XML + TSV tagů.
 * Ostatní: IEC 61131-3 ST + platformní soubor tagů (GVL / CSV / tab).
 */
import { Project, PlatformKey, Device, IoEntry, SeqStep } from "./model.js";
/** Analogové vstupy s mezemi — jejich alarm je součástí poruchy stroje. */
export declare function limitedAnalogs(prj: Project): Device[];
/** Digitální vstupy, na které čeká sekvence. */
export declare function waitedDis(prj: Project): Set<number>;
export declare const SCL_MOTOR = "FUNCTION_BLOCK \"FB_Motor\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.2\n// \u0160ablona: motor/\u010Derpadlo se zp\u011Btn\u00FDm hl\u00E1\u0161en\u00EDm b\u011Bhu\n// Porucha (timeout rozb\u011Bhu, ztr\u00E1ta hl\u00E1\u0161en\u00ED, vstup fault) dr\u017E\u00ED do kvitace (reset).\nVAR_INPUT\n    enable : Bool;\n    cmdStart : Bool;\n    cmdStop : Bool;\n    reset : Bool;        // kvitace poruchy (hrana)\n    fbkRunning : Bool;\n    fault : Bool;\nEND_VAR\nVAR_OUTPUT\n    outRun : Bool;\n    busy : Bool;\n    error : Bool;\n    status : Word;\nEND_VAR\nVAR\n    statStep : Int;\n    instTrigStart : R_TRIG;\n    instTrigStop : R_TRIG;\n    instTrigReset : R_TRIG;\n    instTonFbk : TON;\nEND_VAR\nVAR CONSTANT\n    STEP_IDLE : Int := 0;\n    STEP_STARTING : Int := 10;\n    STEP_RUNNING : Int := 20;\n    STEP_ERROR : Int := 90;\n    T_FBK : Time := T#3S;\nEND_VAR\n\nBEGIN\n    IF NOT #enable THEN\n        #outRun := FALSE; #busy := FALSE; #error := FALSE;\n        #status := 16#8001; #statStep := #STEP_IDLE;\n        RETURN;\n    END_IF;\n\n    #instTrigStart(CLK := #cmdStart);\n    #instTrigStop(CLK := #cmdStop);\n    #instTrigReset(CLK := #reset);\n\n    CASE #statStep OF\n        #STEP_IDLE:\n            #outRun := FALSE;\n            IF #instTrigStart.Q THEN #statStep := #STEP_STARTING; END_IF;\n        #STEP_STARTING:\n            #outRun := TRUE;\n            IF #fbkRunning THEN #statStep := #STEP_RUNNING; END_IF;\n            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;\n        #STEP_RUNNING:\n            #outRun := TRUE;\n            IF NOT #fbkRunning THEN #statStep := #STEP_ERROR; END_IF;\n            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;\n        #STEP_ERROR:\n            #outRun := FALSE;\n            IF #instTrigReset.Q AND NOT #fault THEN #statStep := #STEP_IDLE; END_IF;\n    END_CASE;\n\n    #instTonFbk(IN := (#statStep = #STEP_STARTING), PT := #T_FBK);\n    IF #instTonFbk.Q OR #fault THEN #statStep := #STEP_ERROR; END_IF;\n\n    #busy := (#statStep = #STEP_STARTING);\n    #error := (#statStep = #STEP_ERROR);\n    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const SCL_VENTIL = "FUNCTION_BLOCK \"FB_Ventil\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.2\n// \u0160ablona: dvoupolohov\u00FD ventil/v\u00E1lec s koncov\u00FDmi sn\u00EDma\u010Di\n// Porucha (timeout p\u0159estaven\u00ED, ztr\u00E1ta polohy otev\u0159eno) dr\u017E\u00ED do kvitace (reset).\nVAR_INPUT\n    enable : Bool;\n    cmdOpen : Bool;\n    cmdClose : Bool;\n    reset : Bool;        // kvitace poruchy (hrana)\n    fbkOpen : Bool;\n    fbkClosed : Bool;\nEND_VAR\nVAR_OUTPUT\n    outOpen : Bool;\n    busy : Bool;\n    error : Bool;\n    status : Word;\nEND_VAR\nVAR\n    statStep : Int;\n    instTrigOpen : R_TRIG;\n    instTrigClose : R_TRIG;\n    instTrigReset : R_TRIG;\n    instTonOpen : TON;\n    instTonClose : TON;\nEND_VAR\nVAR CONSTANT\n    STEP_CLOSED : Int := 0;\n    STEP_OPENING : Int := 10;\n    STEP_OPEN : Int := 20;\n    STEP_CLOSING : Int := 30;\n    STEP_ERROR : Int := 90;\n    T_TRAVEL : Time := T#5S;\nEND_VAR\n\nBEGIN\n    IF NOT #enable THEN\n        #outOpen := FALSE; #busy := FALSE; #error := FALSE;\n        #status := 16#8001; #statStep := #STEP_CLOSED;\n        RETURN;\n    END_IF;\n\n    #instTrigOpen(CLK := #cmdOpen);\n    #instTrigClose(CLK := #cmdClose);\n    #instTrigReset(CLK := #reset);\n\n    CASE #statStep OF\n        #STEP_CLOSED:\n            #outOpen := FALSE;\n            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;\n        #STEP_OPENING:\n            #outOpen := TRUE;\n            IF #fbkOpen THEN #statStep := #STEP_OPEN; END_IF;\n            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;\n        #STEP_OPEN:\n            #outOpen := TRUE;\n            IF NOT #fbkOpen THEN #statStep := #STEP_ERROR; END_IF;\n            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;\n        #STEP_CLOSING:\n            #outOpen := FALSE;\n            IF #fbkClosed THEN #statStep := #STEP_CLOSED; END_IF;\n            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;\n        #STEP_ERROR:\n            #outOpen := FALSE;\n            IF #instTrigReset.Q THEN #statStep := #STEP_CLOSED; END_IF;\n    END_CASE;\n\n    // ka\u017Ed\u00FD sm\u011Br m\u00E1 sv\u016Fj \u010Dasova\u010D \u2014 obrat uprost\u0159ed pohybu za\u010D\u00EDn\u00E1 m\u011B\u0159it znovu\n    #instTonOpen(IN := (#statStep = #STEP_OPENING), PT := #T_TRAVEL);\n    #instTonClose(IN := (#statStep = #STEP_CLOSING), PT := #T_TRAVEL);\n    IF #instTonOpen.Q OR #instTonClose.Q THEN #statStep := #STEP_ERROR; END_IF;\n\n    #busy := (#statStep = #STEP_OPENING) OR (#statStep = #STEP_CLOSING);\n    #error := (#statStep = #STEP_ERROR);\n    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const SCL_AI = "FUNCTION_BLOCK \"FB_AnalogIn\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\n// \u0160ablona: analogov\u00FD vstup se \u0161k\u00E1lov\u00E1n\u00EDm a mezemi (surov\u00E1 hodnota 0..27648)\nVAR_INPUT\n    rawValue : Int;\n    scaleMin : Real := 0.0;\n    scaleMax : Real := 100.0;\n    limitHi : Real := 1.0E+6;\n    limitLo : Real := -1.0E+6;\nEND_VAR\nVAR_OUTPUT\n    value : Real;\n    alarmHi : Bool;\n    alarmLo : Bool;\nEND_VAR\n\nBEGIN\n    #value := INT_TO_REAL(#rawValue) / 27648.0\n              * (#scaleMax - #scaleMin) + #scaleMin;\n    #alarmHi := #value > #limitHi;\n    #alarmLo := #value < #limitLo;\nEND_FUNCTION_BLOCK";
export declare const SCL_AO = "FUNCTION_BLOCK \"FB_AnalogOut\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\n// \u0160ablona: analogov\u00FD v\u00FDstup \u2014 in\u017Een\u00FDrsk\u00E9 jednotky -> surov\u00E1 hodnota 0..27648\nVAR_INPUT\n    value : Real;\n    scaleMin : Real := 0.0;\n    scaleMax : Real := 100.0;\nEND_VAR\nVAR_OUTPUT\n    rawValue : Int;\nEND_VAR\n\nBEGIN\n    #rawValue := REAL_TO_INT(\n        (#value - #scaleMin) / (#scaleMax - #scaleMin) * 27648.0);\nEND_FUNCTION_BLOCK";
export declare const ST_MOTOR = "FUNCTION_BLOCK FB_Motor\n(* Sablona: motor/cerpadlo se zpetnym hlasenim behu.\n   Porucha (timeout rozbehu, ztrata hlaseni, vstup fault) drzi do kvitace (reset). *)\nVAR_INPUT\n    enable : BOOL;\n    cmdStart : BOOL;\n    cmdStop : BOOL;\n    reset : BOOL;       (* kvitace poruchy (hrana) *)\n    fbkRunning : BOOL;\n    fault : BOOL;\nEND_VAR\nVAR_OUTPUT\n    outRun : BOOL;\n    busy : BOOL;\n    error : BOOL;\n    status : WORD;\nEND_VAR\nVAR\n    statStep : INT;\n    lastStart : BOOL;\n    lastStop : BOOL;\n    lastReset : BOOL;\n    trigStart : BOOL;\n    trigStop : BOOL;\n    trigReset : BOOL;\n    tonFbk : TON;\nEND_VAR\n\nIF NOT enable THEN\n    outRun := FALSE; busy := FALSE; error := FALSE;\n    status := 16#8001; statStep := 0;\n    RETURN;\nEND_IF;\n\n(* detekce hran *)\ntrigStart := cmdStart AND NOT lastStart;  lastStart := cmdStart;\ntrigStop  := cmdStop  AND NOT lastStop;   lastStop  := cmdStop;\ntrigReset := reset    AND NOT lastReset;  lastReset := reset;\n\nCASE statStep OF\n    0: (* IDLE *)\n        outRun := FALSE;\n        IF trigStart THEN statStep := 10; END_IF\n    10: (* STARTING *)\n        outRun := TRUE;\n        IF fbkRunning THEN statStep := 20; END_IF\n        IF trigStop THEN statStep := 0; END_IF\n    20: (* RUNNING *)\n        outRun := TRUE;\n        IF NOT fbkRunning THEN statStep := 90; END_IF\n        IF trigStop THEN statStep := 0; END_IF\n    90: (* ERROR *)\n        outRun := FALSE;\n        IF trigReset AND NOT fault THEN statStep := 0; END_IF\nEND_CASE;\n\ntonFbk(IN := (statStep = 10), PT := T#3S);\nIF tonFbk.Q OR fault THEN statStep := 90; END_IF;\n\nbusy := (statStep = 10);\nerror := (statStep = 90);\nIF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const ST_VENTIL = "FUNCTION_BLOCK FB_Ventil\n(* Sablona: dvoupolohovy ventil/valec s koncovymi snimaci.\n   Porucha (timeout prestaveni, ztrata polohy otevreno) drzi do kvitace (reset). *)\nVAR_INPUT\n    enable : BOOL;\n    cmdOpen : BOOL;\n    cmdClose : BOOL;\n    reset : BOOL;       (* kvitace poruchy (hrana) *)\n    fbkOpen : BOOL;\n    fbkClosed : BOOL;\nEND_VAR\nVAR_OUTPUT\n    outOpen : BOOL;\n    busy : BOOL;\n    error : BOOL;\n    status : WORD;\nEND_VAR\nVAR\n    statStep : INT;\n    lastOpen : BOOL;\n    lastClose : BOOL;\n    lastReset : BOOL;\n    trigOpen : BOOL;\n    trigClose : BOOL;\n    trigReset : BOOL;\n    tonOpen : TON;\n    tonClose : TON;\nEND_VAR\n\nIF NOT enable THEN\n    outOpen := FALSE; busy := FALSE; error := FALSE;\n    status := 16#8001; statStep := 0;\n    RETURN;\nEND_IF;\n\ntrigOpen  := cmdOpen  AND NOT lastOpen;   lastOpen  := cmdOpen;\ntrigClose := cmdClose AND NOT lastClose;  lastClose := cmdClose;\ntrigReset := reset    AND NOT lastReset;  lastReset := reset;\n\nCASE statStep OF\n    0: (* CLOSED *)\n        outOpen := FALSE;\n        IF trigOpen THEN statStep := 10; END_IF\n    10: (* OPENING *)\n        outOpen := TRUE;\n        IF fbkOpen THEN statStep := 20; END_IF\n        IF trigClose THEN statStep := 30; END_IF\n    20: (* OPEN *)\n        outOpen := TRUE;\n        IF NOT fbkOpen THEN statStep := 90; END_IF\n        IF trigClose THEN statStep := 30; END_IF\n    30: (* CLOSING *)\n        outOpen := FALSE;\n        IF fbkClosed THEN statStep := 0; END_IF\n        IF trigOpen THEN statStep := 10; END_IF\n    90: (* ERROR *)\n        outOpen := FALSE;\n        IF trigReset THEN statStep := 0; END_IF\nEND_CASE;\n\n(* kazdy smer ma svuj casovac - obrat uprostred pohybu zacina merit znovu *)\ntonOpen(IN := (statStep = 10), PT := T#5S);\ntonClose(IN := (statStep = 30), PT := T#5S);\nIF tonOpen.Q OR tonClose.Q THEN statStep := 90; END_IF;\n\nbusy := (statStep = 10) OR (statStep = 30);\nerror := (statStep = 90);\nIF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const ST_AI = "FUNCTION_BLOCK FB_AnalogIn\n(* Sablona: analogovy vstup se skalovanim a mezemi.\n   rawMax uprav dle platformy: Siemens 27648, Beckhoff 32767,\n   Mitsubishi FX5 16000, Rockwell dle modulu. *)\nVAR_INPUT\n    rawValue : INT;\n    rawMax : INT := 27648;\n    scaleMin : REAL := 0.0;\n    scaleMax : REAL := 100.0;\n    limitHi : REAL := 1.0E+6;\n    limitLo : REAL := -1.0E+6;\nEND_VAR\nVAR_OUTPUT\n    value : REAL;\n    alarmHi : BOOL;\n    alarmLo : BOOL;\nEND_VAR\n\nvalue := INT_TO_REAL(rawValue) / INT_TO_REAL(rawMax)\n         * (scaleMax - scaleMin) + scaleMin;\nalarmHi := value > limitHi;\nalarmLo := value < limitLo;\nEND_FUNCTION_BLOCK";
export declare const ST_AO = "FUNCTION_BLOCK FB_AnalogOut\n(* Sablona: analogovy vystup \u2014 inzenyrske jednotky -> surova hodnota *)\nVAR_INPUT\n    value : REAL;\n    rawMax : INT := 27648;\n    scaleMin : REAL := 0.0;\n    scaleMax : REAL := 100.0;\nEND_VAR\nVAR_OUTPUT\n    rawValue : INT;\nEND_VAR\n\nrawValue := REAL_TO_INT((value - scaleMin) / (scaleMax - scaleMin)\n            * INT_TO_REAL(rawMax));\nEND_FUNCTION_BLOCK";
/** České komentáře šablon bloků — klíče překladu. Úplnost seznamu hlídá `templateComments()`. */
export declare const TPL_COMMENTS: string[];
/**
 * Komentáře skutečně obsažené v šablonách bloků (jako klíče překladu, bez opakování).
 * Anglické popisky stavů (IDLE, RUNNING…) se nepřekládají, proto tu nejsou.
 * Každý vrácený text musí být v `TPL_COMMENTS`, jinak ho sběr klíčů nevidí.
 */
export declare function templateComments(): string[];
/**
 * Přeloží komentáře `(* … *)` a `// …` v hotovém textu kódu (technický výstup → `trx`).
 * Komentář, který není klíčem překladu (nebo čeština), zůstane znak po znaku beze změny.
 * `fix` upraví přeložený text pro cílový formát (např. `stripDia` u IEC ST); víceřádkový
 * komentář se po překladu znovu zalomí na šířku a odsazení originálu.
 */
export declare function trComments(code: string, fix?: (s: string) => string): string;
type RefFn = (tag: string) => string;
type LocFn = (v: string) => string;
export declare function refFn(plat: PlatformKey): RefFn;
export declare function locFn(plat: PlatformKey): LocFn;
/** Zařízení s funkčním blokem a povelem (motory, ventily). */
export declare function actuators(prj: Project): Device[];
/** Proměnná povelu ze sekvence / ručního povelu z HMI pro dané zařízení. */
export declare function seqVarOf(d: Device): string;
export declare function manVarOf(d: Device): string;
export declare function seqVars(prj: Project): string[];
/**
 * Podmínka přechodu kroku — jediný zdroj pro generátor i simulátor:
 *  time = po čase kroku, fbk = na vstup `io` (neg = čeká se na FALSE),
 *  none = ihned (zařízení pro tuto akci nemá zpětné hlášení).
 * U přechodu fbk je čas kroku (`timeS`) hlídací čas: po jeho uplynutí porucha.
 */
export interface SeqCondition {
    kind: "time" | "fbk" | "none";
    io?: IoEntry;
    neg?: boolean;
}
export declare function seqCond(prj: Project, s: SeqStep): SeqCondition;
/** Kroky s časovačem: výdrž / přechod časem, nebo hlídání kroku se zpětným hlášením. */
export declare function seqTimedSteps(prj: Project): number[];
/**
 * Časový literál IEC: celé sekundy `T#5S`, jinak sekundy + milisekundy `T#1S500MS`
 * (desetinný tvar `T#1.5S` některá IDE nepřijmou).
 */
export declare function timeLit(seconds: number): string;
export declare function seqBody(prj: Project, plat: PlatformKey): string;
/** Deklarace řízení stroje: režimy, kvitace, ruční povely, porucha a sekvence. */
export declare function ctrlDecls(prj: Project, plat: PlatformKey): string;
/** Výraz „povel zapnout": sekvence NEBO ruční povel (v ručním režimu). */
export declare function cmdExpr(prj: Project, plat: PlatformKey, d: Device): string;
/** Zachycení poruchy bloků a kvitace — volá se ZA instancemi (čerstvé výstupy error). */
export declare function faultBlock(prj: Project, plat: PlatformKey): string;
interface Wiring {
    inst: Array<{
        n: string;
        t: string;
    }>;
    calls: string[];
    free: string[];
}
export declare function wiring(prj: Project, plat: PlatformKey): Wiring;
/**
 * Výraz centrálního uvolnění: E-stop AND blokovací vstupy (kryty, závory…) + komentář.
 * FALSE kteréhokoli vstupu = enable FALSE → bloky vypnou výstupy, sekvence do kroku 0.
 */
export declare function enableExpr(prj: Project, plat: PlatformKey): string;
export declare function genSiemensTagsXml(prj: Project): string;
/** P1: robustní ruční cesta — sloupce k vložení přímo do tabulky tagů TIA / Excelu. */
export declare function genSiemensTagsTSV(prj: Project): string;
export declare function genLibrary(prj: Project, plat: PlatformKey): string;
export declare function genMainSiemens(prj: Project): string;
export declare function genGVL(prj: Project, plat: PlatformKey): string;
export declare function genMainIEC(prj: Project, plat: PlatformKey): string;
export declare function genTagFile(prj: Project, plat: PlatformKey): {
    name: string;
    body: string;
};
/**
 * README.txt k platformě — dokument pro člověka (→ `tr`). Klíč překladu = odstavec, odrážka
 * nebo číslovaný krok; u zalomených odstavců je zalomení a odsazení pokračovacích řádků
 * součástí klíče (prostý text s pevnou šířkou řádku). Číslo kroku a odrážka zůstávají mimo.
 */
export declare function genReadme(prj: Project, plat: PlatformKey): string;
interface FbVar {
    name: string;
    type: string;
    init: string;
    kind: "in" | "out" | "var";
}
/** Proměnné a tělo šablony FB zapsané v IEC ST. */
export declare function parseFbTemplate(tpl: string): {
    vars: FbVar[];
    body: string;
};
/**
 * Rozepíše blok šablony pro jednu instanci: vstupy se přiřadí (zapojení, jinak
 * výchozí hodnota šablony), tělo se přepíše na proměnné s předponou instance
 * a výstupy se zkopírují do tagů. Předčasný návrat (RETURN při enable = FALSE)
 * se převede na větev ELSE — v ploché funkci by RETURN ukončil celý program.
 */
export declare function inlineFb(tpl: string, inst: string, wired: Record<string, string>, outs: Record<string, string>): string;
/** Tagy k založení v UniLogic: fyzické I/O + stav programu (řízení, instance, časovače). */
export declare function uniTags(prj: Project): Array<{
    name: string;
    type: string;
    group: string;
    hint: string;
    cmt: string;
}>;
export declare function genUnitronicsTags(prj: Project): string;
/** Logika stroje jako tělo jedné ST funkce pro UniLogic (stav v globálních tazích). */
export declare function genMainUnitronics(prj: Project): string;
/** Všechny generované soubory programu pro jednu platformu. */
export declare function genFor(prj: Project, plat: PlatformKey): Record<string, string>;
export {};
