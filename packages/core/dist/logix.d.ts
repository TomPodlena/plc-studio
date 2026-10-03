/**
 * PLC Studio — výstup pro Rockwell Studio 5000 Logix Designer (CompactLogix 5380 / ControlLogix 5580).
 *
 * Logix 5000 ST není IEC 61131-3: rutina obsahuje jen příkazy (tagy jsou v databázi tagů),
 * FUNCTION_BLOCK nahrazuje Add-On Instruction, TON v ST není (je TONR nad FBD_TIMER),
 * chybí WORD, převodní funkce INT_TO_REAL… a RETURN. Proto se generuje jeden L5X
 * (dílčí import programu: AOI + tagy + rutina ST) a k tomu tělo rutiny a Tags.csv.
 *
 * Logika se tu NEPÍŠE znovu: AOI vznikají z týchž šablon ST_MOTOR / ST_VENTIL / … přes
 * `parseFbTemplate()` a `lxDialect()`, hlavní rutina z výstupu `seqBody` / `wiring` /
 * `faultBlock` / `enableExpr` (stejné pořadí jako IEC MAIN, tedy i jako simulátor:
 * enable → sekvence → časovače kroků za CASE → instance → porucha stroje).
 *
 * Zdroje: 1756-PM007 (ST), 1756-RM003 (TONR, FBD_TIMER), 1756-PM010 (AOI), 1756-RM014 (L5X, CSV),
 * 5000-UM004 / 5069-UM005 (tagy modulů 5069). Výstup není ověřen importem ve Studiu 5000.
 */
import { Project, IoEntry, Dir } from "./model.js";
/** Název importovaného programu a jeho hlavní rutiny. */
export declare const LX_PROGRAM = "PLCStudio";
export declare const LX_ROUTINE = "MainRoutine";
/** Verze Logix Designeru uvedená v L5X (import do stejné nebo novější verze). */
export declare const LX_SOFTWARE_REVISION = "32.00";
/** Čisté ASCII — Studio 5000 je jednobajtové (PM007) a CSV neumí dvoubajtové znaky (RM014). */
export declare function lxAscii(s: string): string;
/** Escapování popisu v CSV Logix (RM014): $ → $$, ' → $', " → $Q, nový řádek → $N. */
export declare function lxCsvEsc(s: string): string;
/**
 * Dialekt Logix 5000 ST nad textem IEC ST z generátoru / šablon:
 * TON → TONR (PRE v ms a TimerEnable PŘED voláním, `.Q` → `.DN`), předčasný RETURN → ELSE,
 * INT_TO_REAL / REAL_TO_INT pryč (převody jsou implicitní), `END_IF;`, TRUE/FALSE → 1/0
 * (příklady PM007 používají 1/0), `IF TRUE THEN x END_IF;` → `x`.
 */
export declare function lxDialect(st: string): string;
/** Předpokládané osazení lokálních slotů (moduly Compact 5000 I/O). */
export interface LxSlot {
    slot: number;
    dir: Dir;
    module: string;
    first: number;
}
/**
 * Body modulů pro aliasy I/O: z kanonické adresy se odvodí kanál, z něj modul a bod
 * (DI/DO po 16, AI po 8, AO po 4). Sloty se číslují od 1: nejdřív moduly DI, pak DO, AI, AO.
 * Když adresu nejde převést nebo by modulů bylo víc než 31, alias se pro tag negeneruje.
 */
export declare function lxIoMap(prj: Project): {
    slots: LxSlot[];
    spec: Map<string, string>;
};
/** Osazení slotů jedním řádkem (ASCII, bez jazykových slov): „1: 5069-IB16 (DI 0-15), 2: …". */
export declare function lxSlotText(prj: Project): string;
/** Datový typ I/O tagu v Logix (analogy 5069 = REAL v jednotkách modulu). */
export declare function lxIoType(e: IoEntry): string;
export interface LxTag {
    name: string;
    type: string;
    desc: string;
}
/** Programové tagy: uvolnění, řízení stroje (ctrlDecls) a instance AOI. */
export declare function lxProgramTags(prj: Project): LxTag[];
/**
 * Tělo hlavní rutiny MainRoutine (Logix ST, jen příkazy) — k ručnímu vložení do ST rutiny;
 * totéž je v L5X. Tagy jsou v L5X (programové + I/O) a v Tags.csv.
 */
export declare function genLogixRoutine(prj: Project): string;
/**
 * PLCStudio_Program.L5X — dílčí import programu (MainTask → Add → Import Program):
 * Add-On Instructions použitých tříd, I/O tagy (controller scope, BOOL / REAL),
 * program PLCStudio s programovými tagy a rutinou MainRoutine (ST).
 * Struktura podle 1756-RM014 a reálných exportů; Rockwell nezveřejňuje XSD → neověřeno importem.
 */
export declare function genRockwellL5X(prj: Project): string;
/**
 * Tags.csv pro Tools → Import → Tags and Logic Comments (náhradní cesta k L5X):
 * I/O jako ALIAS na body modulů 5069 (předpoklad osazení slotů v remark), jinak TAG;
 * programové tagy se SCOPE = program PLCStudio. Popisy ASCII s escapováním `$`.
 */
export declare function genLogixTagsCsv(prj: Project): string;
/** Minimální kontrola well-formed XML (párování tagů, atributy, CDATA, entity); vrací chyby. */
export declare function xmlProblems(xml: string): string[];
/**
 * Statická kontrola výstupu pro Logix (testy + scripts/check_samples.mjs): well-formed L5X,
 * žádné konstrukce IEC, které Logix nemá, TONR s PRE před voláním, každý identifikátor
 * v rutinách deklarovaný (tag, parametr / lokální tag AOI, člen FBD_TIMER), čisté ASCII.
 */
export declare function logixProblems(files: Record<string, string>): string[];
