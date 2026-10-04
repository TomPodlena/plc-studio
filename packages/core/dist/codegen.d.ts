/**
 * PLCdesk — generování zdrojových souborů programu pro cílové platformy.
 * Siemens: SCL (external sources) + SimaticML XML + TSV tagů.
 * Ostatní: IEC 61131-3 ST + platformní soubor tagů (GVL / CSV / tab).
 *
 * Hlavní program se skládá z mezivrstvy `buildIR()` (ir.ts): tady jsou renderery IR do ST
 * (Siemens SCL, IEC ST, plochý ST Unitronics); Logix ST píše logix.ts nad stejným IR.
 * Šablony bloků (SCL_* / ST_*) zůstávají zdrojem logiky bloků.
 */
import { Project, PlatformKey, Device, IoEntry } from "./model.js";
import { type IrProgram, type IrFb, type IrDecl, type IrNames, type IrType, type IrFbClass, type IrExpr } from "./ir.js";
export { limitedAnalogs, waitedDis, actuators, seqVarOf, manVarOf, seqVars, seqCond, seqTimedSteps, type SeqCondition, } from "./ir.js";
import { type LibraryIssue } from "./library.js";
export declare const SCL_MOTOR = "FUNCTION_BLOCK \"FB_Motor\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.2\n// \u0160ablona: motor/\u010Derpadlo se zp\u011Btn\u00FDm hl\u00E1\u0161en\u00EDm b\u011Bhu\n// Porucha (timeout rozb\u011Bhu, ztr\u00E1ta hl\u00E1\u0161en\u00ED, vstup fault) dr\u017E\u00ED do kvitace (reset).\nVAR_INPUT\n    enable : Bool;\n    cmdStart : Bool;\n    cmdStop : Bool;\n    reset : Bool;        // kvitace poruchy (hrana)\n    fbkRunning : Bool;\n    fault : Bool;\nEND_VAR\nVAR_OUTPUT\n    outRun : Bool;\n    busy : Bool;\n    error : Bool;\n    status : Word;\nEND_VAR\nVAR\n    statStep : Int;\n    instTrigStart : R_TRIG;\n    instTrigStop : R_TRIG;\n    instTrigReset : R_TRIG;\n    instTonFbk : TON_TIME;\nEND_VAR\nVAR CONSTANT\n    STEP_IDLE : Int := 0;\n    STEP_STARTING : Int := 10;\n    STEP_RUNNING : Int := 20;\n    STEP_ERROR : Int := 90;\n    T_FBK : Time := T#3S;\nEND_VAR\n\nBEGIN\n    IF NOT #enable THEN\n        #outRun := FALSE; #busy := FALSE; #error := FALSE;\n        #status := 16#8001; #statStep := #STEP_IDLE;\n        RETURN;\n    END_IF;\n\n    #instTrigStart(CLK := #cmdStart);\n    #instTrigStop(CLK := #cmdStop);\n    #instTrigReset(CLK := #reset);\n\n    CASE #statStep OF\n        #STEP_IDLE:\n            #outRun := FALSE;\n            IF #instTrigStart.Q THEN #statStep := #STEP_STARTING; END_IF;\n        #STEP_STARTING:\n            #outRun := TRUE;\n            IF #fbkRunning THEN #statStep := #STEP_RUNNING; END_IF;\n            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;\n        #STEP_RUNNING:\n            #outRun := TRUE;\n            IF NOT #fbkRunning THEN #statStep := #STEP_ERROR; END_IF;\n            IF #instTrigStop.Q THEN #statStep := #STEP_IDLE; END_IF;\n        #STEP_ERROR:\n            #outRun := FALSE;\n            IF #instTrigReset.Q AND NOT #fault THEN #statStep := #STEP_IDLE; END_IF;\n    END_CASE;\n\n    #instTonFbk(IN := (#statStep = #STEP_STARTING), PT := #T_FBK);\n    IF #instTonFbk.Q OR #fault THEN #statStep := #STEP_ERROR; END_IF;\n\n    #busy := (#statStep = #STEP_STARTING);\n    #error := (#statStep = #STEP_ERROR);\n    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const SCL_VENTIL = "FUNCTION_BLOCK \"FB_Ventil\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.2\n// \u0160ablona: dvoupolohov\u00FD ventil/v\u00E1lec s koncov\u00FDmi sn\u00EDma\u010Di\n// Porucha (timeout p\u0159estaven\u00ED, ztr\u00E1ta polohy otev\u0159eno) dr\u017E\u00ED do kvitace (reset).\nVAR_INPUT\n    enable : Bool;\n    cmdOpen : Bool;\n    cmdClose : Bool;\n    reset : Bool;        // kvitace poruchy (hrana)\n    fbkOpen : Bool;\n    fbkClosed : Bool;\nEND_VAR\nVAR_OUTPUT\n    outOpen : Bool;\n    busy : Bool;\n    error : Bool;\n    status : Word;\nEND_VAR\nVAR\n    statStep : Int;\n    instTrigOpen : R_TRIG;\n    instTrigClose : R_TRIG;\n    instTrigReset : R_TRIG;\n    instTonOpen : TON_TIME;\n    instTonClose : TON_TIME;\nEND_VAR\nVAR CONSTANT\n    STEP_CLOSED : Int := 0;\n    STEP_OPENING : Int := 10;\n    STEP_OPEN : Int := 20;\n    STEP_CLOSING : Int := 30;\n    STEP_ERROR : Int := 90;\n    T_TRAVEL : Time := T#5S;\nEND_VAR\n\nBEGIN\n    IF NOT #enable THEN\n        #outOpen := FALSE; #busy := FALSE; #error := FALSE;\n        #status := 16#8001; #statStep := #STEP_CLOSED;\n        RETURN;\n    END_IF;\n\n    #instTrigOpen(CLK := #cmdOpen);\n    #instTrigClose(CLK := #cmdClose);\n    #instTrigReset(CLK := #reset);\n\n    CASE #statStep OF\n        #STEP_CLOSED:\n            #outOpen := FALSE;\n            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;\n        #STEP_OPENING:\n            #outOpen := TRUE;\n            IF #fbkOpen THEN #statStep := #STEP_OPEN; END_IF;\n            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;\n        #STEP_OPEN:\n            #outOpen := TRUE;\n            IF NOT #fbkOpen THEN #statStep := #STEP_ERROR; END_IF;\n            IF #instTrigClose.Q THEN #statStep := #STEP_CLOSING; END_IF;\n        #STEP_CLOSING:\n            #outOpen := FALSE;\n            IF #fbkClosed THEN #statStep := #STEP_CLOSED; END_IF;\n            IF #instTrigOpen.Q THEN #statStep := #STEP_OPENING; END_IF;\n        #STEP_ERROR:\n            #outOpen := FALSE;\n            IF #instTrigReset.Q THEN #statStep := #STEP_CLOSED; END_IF;\n    END_CASE;\n\n    // ka\u017Ed\u00FD sm\u011Br m\u00E1 sv\u016Fj \u010Dasova\u010D \u2014 obrat uprost\u0159ed pohybu za\u010D\u00EDn\u00E1 m\u011B\u0159it znovu\n    #instTonOpen(IN := (#statStep = #STEP_OPENING), PT := #T_TRAVEL);\n    #instTonClose(IN := (#statStep = #STEP_CLOSING), PT := #T_TRAVEL);\n    IF #instTonOpen.Q OR #instTonClose.Q THEN #statStep := #STEP_ERROR; END_IF;\n\n    #busy := (#statStep = #STEP_OPENING) OR (#statStep = #STEP_CLOSING);\n    #error := (#statStep = #STEP_ERROR);\n    IF #error THEN #status := 16#8002; ELSE #status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const SCL_AI = "FUNCTION_BLOCK \"FB_AnalogIn\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\n// \u0160ablona: analogov\u00FD vstup se \u0161k\u00E1lov\u00E1n\u00EDm a mezemi (surov\u00E1 hodnota 0..27648)\nVAR_INPUT\n    rawValue : Int;\n    scaleMin : Real := 0.0;\n    scaleMax : Real := 100.0;\n    limitHi : Real := 1.0E+6;\n    limitLo : Real := -1.0E+6;\nEND_VAR\nVAR_OUTPUT\n    value : Real;\n    alarmHi : Bool;\n    alarmLo : Bool;\nEND_VAR\n\nBEGIN\n    #value := INT_TO_REAL(#rawValue) / 27648.0\n              * (#scaleMax - #scaleMin) + #scaleMin;\n    #alarmHi := #value > #limitHi;\n    #alarmLo := #value < #limitLo;\nEND_FUNCTION_BLOCK";
export declare const SCL_AO = "FUNCTION_BLOCK \"FB_AnalogOut\"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\n// \u0160ablona: analogov\u00FD v\u00FDstup \u2014 in\u017Een\u00FDrsk\u00E9 jednotky -> surov\u00E1 hodnota 0..27648\nVAR_INPUT\n    value : Real;\n    scaleMin : Real := 0.0;\n    scaleMax : Real := 100.0;\nEND_VAR\nVAR_OUTPUT\n    rawValue : Int;\nEND_VAR\n\nBEGIN\n    #rawValue := REAL_TO_INT(LIMIT(MN := 0.0, IN := (#value - #scaleMin) / (#scaleMax - #scaleMin) * 27648.0, MX := 27648.0));\nEND_FUNCTION_BLOCK";
export declare const ST_MOTOR = "FUNCTION_BLOCK FB_Motor\n(* Sablona: motor/cerpadlo se zpetnym hlasenim behu.\n   Porucha (timeout rozbehu, ztrata hlaseni, vstup fault) drzi do kvitace (reset). *)\nVAR_INPUT\n    enable : BOOL;\n    cmdStart : BOOL;\n    cmdStop : BOOL;\n    reset : BOOL;       (* kvitace poruchy (hrana) *)\n    fbkRunning : BOOL;\n    fault : BOOL;\nEND_VAR\nVAR_OUTPUT\n    outRun : BOOL;\n    busy : BOOL;\n    error : BOOL;\n    status : WORD;\nEND_VAR\nVAR\n    statStep : INT;\n    lastStart : BOOL;\n    lastStop : BOOL;\n    lastReset : BOOL;\n    trigStart : BOOL;\n    trigStop : BOOL;\n    trigReset : BOOL;\n    tonFbk : TON;\nEND_VAR\n\nIF NOT enable THEN\n    outRun := FALSE; busy := FALSE; error := FALSE;\n    status := 16#8001; statStep := 0;\n    RETURN;\nEND_IF;\n\n(* detekce hran *)\ntrigStart := cmdStart AND NOT lastStart;  lastStart := cmdStart;\ntrigStop  := cmdStop  AND NOT lastStop;   lastStop  := cmdStop;\ntrigReset := reset    AND NOT lastReset;  lastReset := reset;\n\nCASE statStep OF\n    0: (* IDLE *)\n        outRun := FALSE;\n        IF trigStart THEN statStep := 10; END_IF;\n    10: (* STARTING *)\n        outRun := TRUE;\n        IF fbkRunning THEN statStep := 20; END_IF;\n        IF trigStop THEN statStep := 0; END_IF;\n    20: (* RUNNING *)\n        outRun := TRUE;\n        IF NOT fbkRunning THEN statStep := 90; END_IF;\n        IF trigStop THEN statStep := 0; END_IF;\n    90: (* ERROR *)\n        outRun := FALSE;\n        IF trigReset AND NOT fault THEN statStep := 0; END_IF;\nEND_CASE;\n\ntonFbk(IN := (statStep = 10), PT := T#3S);\nIF tonFbk.Q OR fault THEN statStep := 90; END_IF;\n\nbusy := (statStep = 10);\nerror := (statStep = 90);\nIF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const ST_VENTIL = "FUNCTION_BLOCK FB_Ventil\n(* Sablona: dvoupolohovy ventil/valec s koncovymi snimaci.\n   Porucha (timeout prestaveni, ztrata polohy otevreno) drzi do kvitace (reset). *)\nVAR_INPUT\n    enable : BOOL;\n    cmdOpen : BOOL;\n    cmdClose : BOOL;\n    reset : BOOL;       (* kvitace poruchy (hrana) *)\n    fbkOpen : BOOL;\n    fbkClosed : BOOL;\nEND_VAR\nVAR_OUTPUT\n    outOpen : BOOL;\n    busy : BOOL;\n    error : BOOL;\n    status : WORD;\nEND_VAR\nVAR\n    statStep : INT;\n    lastOpen : BOOL;\n    lastClose : BOOL;\n    lastReset : BOOL;\n    trigOpen : BOOL;\n    trigClose : BOOL;\n    trigReset : BOOL;\n    tonOpen : TON;\n    tonClose : TON;\nEND_VAR\n\nIF NOT enable THEN\n    outOpen := FALSE; busy := FALSE; error := FALSE;\n    status := 16#8001; statStep := 0;\n    RETURN;\nEND_IF;\n\ntrigOpen  := cmdOpen  AND NOT lastOpen;   lastOpen  := cmdOpen;\ntrigClose := cmdClose AND NOT lastClose;  lastClose := cmdClose;\ntrigReset := reset    AND NOT lastReset;  lastReset := reset;\n\nCASE statStep OF\n    0: (* CLOSED *)\n        outOpen := FALSE;\n        IF trigOpen THEN statStep := 10; END_IF;\n    10: (* OPENING *)\n        outOpen := TRUE;\n        IF fbkOpen THEN statStep := 20; END_IF;\n        IF trigClose THEN statStep := 30; END_IF;\n    20: (* OPEN *)\n        outOpen := TRUE;\n        IF NOT fbkOpen THEN statStep := 90; END_IF;\n        IF trigClose THEN statStep := 30; END_IF;\n    30: (* CLOSING *)\n        outOpen := FALSE;\n        IF fbkClosed THEN statStep := 0; END_IF;\n        IF trigOpen THEN statStep := 10; END_IF;\n    90: (* ERROR *)\n        outOpen := FALSE;\n        IF trigReset THEN statStep := 0; END_IF;\nEND_CASE;\n\n(* kazdy smer ma svuj casovac - obrat uprostred pohybu zacina merit znovu *)\ntonOpen(IN := (statStep = 10), PT := T#5S);\ntonClose(IN := (statStep = 30), PT := T#5S);\nIF tonOpen.Q OR tonClose.Q THEN statStep := 90; END_IF;\n\nbusy := (statStep = 10) OR (statStep = 30);\nerror := (statStep = 90);\nIF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;\nEND_FUNCTION_BLOCK";
export declare const ST_AI = "FUNCTION_BLOCK FB_AnalogIn\n(* Sablona: analogovy vstup se skalovanim a mezemi.\n   rawMax uprav dle platformy: Siemens 27648, Beckhoff 32767,\n   Mitsubishi FX5 16000, Rockwell dle modulu. *)\nVAR_INPUT\n    rawValue : INT;\n    rawMax : INT := 27648;\n    scaleMin : REAL := 0.0;\n    scaleMax : REAL := 100.0;\n    limitHi : REAL := 1.0E+6;\n    limitLo : REAL := -1.0E+6;\nEND_VAR\nVAR_OUTPUT\n    value : REAL;\n    alarmHi : BOOL;\n    alarmLo : BOOL;\nEND_VAR\n\nvalue := INT_TO_REAL(rawValue) / INT_TO_REAL(rawMax)\n         * (scaleMax - scaleMin) + scaleMin;\nalarmHi := value > limitHi;\nalarmLo := value < limitLo;\nEND_FUNCTION_BLOCK";
export declare const ST_AO = "FUNCTION_BLOCK FB_AnalogOut\n(* Sablona: analogovy vystup \u2014 inzenyrske jednotky -> surova hodnota *)\nVAR_INPUT\n    value : REAL;\n    rawMax : INT := 27648;\n    scaleMin : REAL := 0.0;\n    scaleMax : REAL := 100.0;\nEND_VAR\nVAR_OUTPUT\n    rawValue : INT;\nEND_VAR\nVAR\n    rawReal : REAL;\nEND_VAR\n\nrawReal := (value - scaleMin) / (scaleMax - scaleMin) * INT_TO_REAL(rawMax);\nIF rawReal < 0.0 THEN\n    rawReal := 0.0;\nELSIF rawReal > INT_TO_REAL(rawMax) THEN\n    rawReal := INT_TO_REAL(rawMax);\nEND_IF;\nrawValue := REAL_TO_INT(rawReal);\nEND_FUNCTION_BLOCK";
/** Dialekt šablon bloků: SCL (Siemens) / IEC ST (ostatní platformy). */
export type FbDialectKey = "scl" | "st";
/**
 * Šablona bloku třídy — jediné místo, kde renderery (Gen_Library, AOI v L5X, plochá logika
 * Unitronics) berou zdroj logiky bloku. `lib` = vlastní šablony z firemní knihovny pro danou
 * platformu (`codeLibrary`, stejné rozhraní) — mají přednost; bez `lib` vestavěná šablona
 * (simulace, ověření, typy portů v IR a HMI zrcadlí vždy vestavěnou).
 */
export declare function fbTemplate(cls: IrFbClass, dialect: FbDialectKey, lib?: CodeLibrary): string;
/**
 * Co z firemní knihovny projektu (`libraryOverrides`, library.ts) generátor pro platformu
 * použije: šablony bloků po kontrole, že je jde pro platformu spolehlivě převést (Unitronics
 * bloky rozepisuje `inlineFb`, Logix z nich staví AOI `lxDialect`), a řádky firemní hlavičky.
 * Šablonu, kterou převést nejde, generátor nepoužije — zůstane vestavěná a důvod je v `issues`
 * (README platformy ho vypíše), nikdy tichý pád. Bez knihovny vše prázdné → výstup beze změny.
 */
export interface CodeLibrary {
    templates: Partial<Record<IrFbClass, string>>;
    /** identifikátor použité šablony knihovny podle třídy */
    ids: Partial<Record<IrFbClass, string>>;
    /** řádky hlavičky kódu (bez značek komentáře; u IEC už ASCII a bezpečné pro (* *)) */
    header: string[];
    issues: LibraryIssue[];
    library?: {
        name: string;
        version: string;
    };
}
export declare function codeLibrary(prj: Project, plat: PlatformKey): CodeLibrary;
/**
 * Proč šablonu IEC ST nejde rozepsat do ploché funkce UniLogic (`inlineFb`); prázdné = jde.
 * Rozepsání čte jen bloky VAR_INPUT / VAR_OUTPUT / VAR s jednou proměnnou na řádek, typy, které
 * má seznam tagů UniLogic, a předčasný návrat jen v úvodním `IF NOT enable … RETURN; END_IF;`.
 */
export declare function flatTplProblems(tpl: string): string[];
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
export declare function stCtx(plat: PlatformKey): StCtx;
/**
 * Časový literál IEC: celé sekundy `T#5S`, jinak sekundy + milisekundy `T#1S500MS`
 * (desetinný tvar `T#1.5S` některá IDE nepřijmou).
 */
export declare function timeLit(seconds: number): string;
/**
 * Mitsubishi FX5 (GX Works3): TON bere PT jen 0–32 767 ms (FX5 Programming Manual
 * Instructions JY997D55801Z, kap. 32.2 TON(_E)). Delší čas kroku (výdrž / hlídací čas) proto
 * generátor zapisuje časovačem TIMER_100_FB_M (kap. 32.4: Coil, Preset INT 0–32 767 × 100 ms,
 * ValueIn, výstup Status) — do 3 276,7 s, čas zaokrouhlený nahoru na 100 ms. Ostatní platformy
 * a kratší časy beze změny (TON). Emulátor (emu/compile.ts) blok zná, simulace počítá týž čas.
 */
export declare const FX5_TON_MAX_MS = 32767;
/** Krok s tímto časem píše generátor pro platformu časovačem TIMER_100_FB_M (jen FX5 nad 32 767 ms). */
export declare function fx5Timer100(plat: PlatformKey, timeS: number): boolean;
/** Předvolba TIMER_100_FB_M (× 100 ms, nahoru — hlídací čas nesmí vypršet dřív). */
export declare function fx5Preset100(timeS: number): number;
/** Sekvence (CASE) a časovače kroků z IR. */
export declare function renderSeq(ir: IrProgram, c: StCtx): string;
export declare function seqBody(prj: Project, plat: PlatformKey): string;
/** Surový rozsah analogu platformy (bez = Siemens 27648 z výchozí hodnoty šablony). */
export declare function rawMaxFor(plat: PlatformKey): number | undefined;
/** Text do komentáře (* … *): bez diakritiky a pomlček, bez konce řádku; „(*“ a „*)“ z textu
    uživatele rozdělí mezerou (CODESYS/TwinCAT komentáře vnořují — jinak by rozbily zbytek souboru). */
export declare function cmtSafe(t: string): string;
/** Text komentáře deklarace řízení (přeložený, s „TODO:" u vstupů z HMI); bez komentáře "". */
export declare function declNote(d: IrDecl): string;
/**
 * Deklarace řízení stroje z IR: režimy, kvitace, ruční povely, porucha a sekvence.
 * `keep` = jen vybrané (u Mitsubishi / Omron jsou proměnné pro HMI globální — `hmiGlobalVars`).
 */
export declare function renderDecls(ir: IrProgram, c: StCtx, keep?: (d: IrDecl) => boolean): string;
/** Deklarace řízení stroje: režimy, kvitace, ruční povely, porucha a sekvence. */
export declare function ctrlDecls(prj: Project, plat: PlatformKey): string;
/** Výraz „povel zapnout": sekvence NEBO ruční povel (v ručním režimu). */
export declare function cmdExpr(prj: Project, plat: PlatformKey, d: Device): string;
/** Zachycení poruchy bloků a kvitace — volá se ZA instancemi (čerstvé výstupy error). */
export declare function renderFault(ir: IrProgram, c: StCtx): string;
export declare function faultBlock(prj: Project, plat: PlatformKey): string;
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
export declare function hmiGlobalPlat(plat: PlatformKey): boolean;
/** Globální proměnná pro HMI; `expr` = stav bloku, který MAIN do proměnné zapisuje. */
export interface HmiGlobalVar {
    name: string;
    type: IrType;
    note: string;
    expr?: IrExpr;
}
/** Proměnné, které jsou u Mitsubishi / Omron globální: řízení stroje + zrcadlo stavu bloků (tagy HMI). */
export declare function hmiGlobalVars(ir: IrProgram): HmiGlobalVar[];
/** Zrcadlo stavu bloků do globálních proměnných pro HMI (Mitsubishi / Omron; volá se za poruchou). */
export declare function renderHmiMirror(ir: IrProgram, c: StCtx): string;
interface Wiring {
    inst: Array<{
        n: string;
        t: string;
    }>;
    calls: string[];
    free: string[];
}
/** Pomocná proměnná pro nezapojený výstup bloku (jinak varování IDE). */
export declare function tempVarOf(t: IrType): string;
/**
 * Komentáře volání bloku (text bez značek komentáře): `port` = za vstupem (náhrada chybějícího
 * hlášení, žádaná hodnota), `after` = za celým voláním (AnalogIn: jednotky a mez). Společné
 * pro zápis IEC / SCL (`stCall`) i Logix (členy instance), aby komentáře seděly stejně.
 */
export declare function stCallNotes(b: IrFb, c: StCtx): {
    port: Record<string, string>;
    after?: string;
};
/** Volání instance bloku v IEC ST / SCL (`instM1(enable := …, outRun => …);`). */
export declare function stCall(b: IrFb, c: StCtx): string;
/** Řádek volného signálu (komentář s adresou platformy) v IEC ST / SCL. */
export declare function freeLine(c: StCtx, e: IoEntry): string;
/**
 * Instance, volání bloků / rolí a volné signály z IR (pořadí zařízení; bez vstupů uvolnění).
 * `o.call` / `o.free` = jiný zápis volání bloku / řádku volného signálu (Logix).
 */
export declare function renderWiring(ir: IrProgram, c: StCtx, o?: {
    call?: (b: IrFb) => string;
    free?: (e: IoEntry) => string;
}): Wiring;
export declare function wiring(prj: Project, plat: PlatformKey): Wiring;
/** Nezapojené výstupy bloků → potřebné pomocné proměnné (BOOL / INT). */
export declare function irUnused(ir: IrProgram): {
    bool: boolean;
    int: boolean;
};
/**
 * Výraz centrálního uvolnění: E-stop AND blokovací vstupy (kryty, závory…) + poznámka.
 * FALSE kteréhokoli vstupu = enable FALSE → bloky vypnou výstupy, sekvence do kroku 0.
 */
export declare function renderEnable(ir: IrProgram, c: StCtx): {
    expr: string;
    note: string;
};
/** Uvolnění jako text pro přiřazení `enable := …` (výraz + komentář). */
export declare function enableText(ir: IrProgram, c: StCtx): string;
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
