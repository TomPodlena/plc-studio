/**
 * PLCdesk — jména, která generovaný program deklaruje sám, a rezervovaná jména platforem.
 *
 * Jediný zdroj jmen řízení stroje (`IR_CTRL`), povelů sekvence a ručních povelů, časovačů kroků
 * a programových celků (MAIN, GVL_IO, FB_*…) — generátor (`ir.ts`, renderery) je bere odsud, takže
 * kontrola kolizí tagů (`tagNameProblem`, `validateProject`, `setIoTag`, `renameDevice`) zná
 * přesně tatáž jména. Rezervovaná slova a jména instrukcí platforem jsou data dialektů emulátoru
 * (`emu/dialects.ts`: klíčová slova IEC 61131-3, SCL, instrukce Sysmac, standardní bloky a funkce,
 * tvar operandů GX Works3, předpona Sysmac `P_`) — nový dialekt se tu projeví sám.
 *
 * Tagy I/O a proměnné řízení sdílejí na Mitsubishi, Omron a Unitronics jeden globální prostor jmen
 * (forenzní test 2026-10-10, N2); kontrola je záměrně stejná pro všechny platformy — platformy
 * projektu se dají kdykoli změnit a kód se musí přeložit na každé.
 */
import type { Device, Project } from "./model.js";
/** Proměnné řízení stroje (jména jsou rozhraním k HMI — neměnit). */
export declare const IR_CTRL: {
    readonly enable: "enable";
    readonly modeAuto: "modeAuto";
    readonly cmdAutoStart: "cmdAutoStart";
    readonly cmdAck: "cmdAck";
    readonly machineFault: "machineFault";
    readonly faultStep: "faultStep";
    readonly seqStep: "seqStep";
};
/** Předpona časovače hlídacího času / výdrže kroku (`tonSeq10`…). */
export declare const SEQ_TIMER_PREFIX = "tonSeq";
/** Jména funkčních bloků tříd zařízení (klasika; OOP navíc FB_Valve, viz `POU_NAMES`). */
export declare const FB_NAMES: {
    readonly Motor: "FB_Motor";
    readonly Ventil: "FB_Ventil";
    readonly AnalogIn: "FB_AnalogIn";
    readonly AnalogOut: "FB_AnalogOut";
    readonly Vfd: "FB_Vfd";
    readonly PosDrive: "FB_PosDrive";
    readonly PropValve: "FB_PropValve";
    readonly Axis: "FB_Axis";
};
/**
 * Programové celky a pevná jména výstupů všech platforem: program, GVL, knihovna, OOP (rozhraní,
 * základ, sekvence, pole odkazů), Logix (program, rutina), GX Works3 (ProgPou), Sysmac (Program0).
 */
export declare const POU_NAMES: string[];
/** Instance bloku zařízení. */
export declare function instName(d: Pick<Device, "name">): string;
/** Proměnná povelu ze sekvence (BOOL; osa INT číslo kroku). */
export declare function seqVarOf(d: Pick<Device, "name" | "cls">): string;
/** Ruční povel z HMI: motor / měnič chod, ventil otevřít, polohovací pohon referování, proporcionální ventil zapnout. */
export declare function manVarOf(d: Pick<Device, "name" | "cls">): string;
/**
 * Ruční povely z HMI pro zařízení: u servoosy regulace (úroveň), referování (hrana) a ruční pojezd
 * +/− (držet; po E-stopu / poruše až po puštění tlačítka), jinak jeden povel `manVarOf`.
 */
export declare function manVarsOf(d: Pick<Device, "name" | "cls">): string[];
/** Předpony proměnných povelů sekvence pohonů a servoosy (pořadí = `motionSeqVars` v ir.ts). */
export declare const MOTION_SEQ_PREFIX: {
    readonly Vfd: readonly ["seqRun_", "seqSpd_", "seqRev_"];
    readonly PosDrive: readonly ["seqMove_", "seqHome_", "seqRec_"];
    readonly PropValve: readonly ["seqOn_", "seqSp_"];
    readonly Axis: readonly ["seqCmd_", "seqMode_", "seqTgt_", "seqVel_", "seqAcc_", "seqDec_"];
};
/** Všechna jména, která program projektu deklaruje kvůli zařízení `d` (instance, povely, objekt osy). */
export declare function deviceGeneratedNames(d: Pick<Device, "name" | "cls">): string[];
/** Jména deklarovaná generovaným programem projektu (velkými písmeny → popis původu). */
export declare function generatedNames(prj: Project): Map<string, string>;
/**
 * Proč tag (nebo jiné globální jméno) nejde použít kvůli kolizi s rezervovaným slovem nebo jménem,
 * které generovaný program deklaruje sám (`null` = v pořádku). `gen` = `generatedNames(prj)`
 * (předává se kvůli rychlosti při kontrole všech tagů).
 */
export declare function reservedNameProblem(prj: Project, name: string, gen?: Map<string, string>): string | null;
