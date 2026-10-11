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
import { tr } from "./i18n.js";
import { IEC_KEYWORDS, DIALECTS } from "./emu/dialects.js";

/** Proměnné řízení stroje (jména jsou rozhraním k HMI — neměnit). */
export const IR_CTRL = {
  enable: "enable", modeAuto: "modeAuto", cmdAutoStart: "cmdAutoStart", cmdAck: "cmdAck",
  machineFault: "machineFault", faultStep: "faultStep", seqStep: "seqStep",
} as const;

/** Předpona časovače hlídacího času / výdrže kroku (`tonSeq10`…). */
export const SEQ_TIMER_PREFIX = "tonSeq";

/** Jména funkčních bloků tříd zařízení (klasika; OOP navíc FB_Valve, viz `POU_NAMES`). */
export const FB_NAMES = {
  Motor: "FB_Motor", Ventil: "FB_Ventil", AnalogIn: "FB_AnalogIn", AnalogOut: "FB_AnalogOut",
  Vfd: "FB_Vfd", PosDrive: "FB_PosDrive", PropValve: "FB_PropValve", Axis: "FB_Axis",
} as const;

/**
 * Programové celky a pevná jména výstupů všech platforem: program, GVL, knihovna, OOP (rozhraní,
 * základ, sekvence, pole odkazů), Logix (program, rutina), GX Works3 (ProgPou), Sysmac (Program0).
 */
export const POU_NAMES = ["MAIN", "GVL_IO", "Gen_Library", "Gen_Main", "Machine", "ProgPou", "Program0", "MainRoutine", "MainProgram",
  "MainTask", "PLCdesk", "I_Device", "FB_DeviceBase", "FB_Sequence", "FB_Valve", "aDevices", "iDev", "N_DEVICES", "bAnyFault", "fbSeq",
  ...Object.values(FB_NAMES)];

/** Instance bloku zařízení. */
export function instName(d: Pick<Device, "name">): string { return "inst" + d.name; }

/** Proměnná povelu ze sekvence (BOOL; osa INT číslo kroku). */
export function seqVarOf(d: Pick<Device, "name" | "cls">): string {
  if (d.cls === "Axis") return "seqCmd_" + d.name;
  return (d.cls === "Motor" || d.cls === "Vfd" ? "seqRun_" : d.cls === "PosDrive" ? "seqMove_" : d.cls === "PropValve" ? "seqOn_" : "seqOpen_") + d.name;
}
/** Ruční povel z HMI: motor / měnič chod, ventil otevřít, polohovací pohon referování, proporcionální ventil zapnout. */
export function manVarOf(d: Pick<Device, "name" | "cls">): string {
  if (d.cls === "Axis") return "manPower_" + d.name;
  return (d.cls === "Motor" || d.cls === "Vfd" ? "manRun_" : d.cls === "PosDrive" ? "manHome_" : d.cls === "PropValve" ? "manOn_" : "manOpen_") + d.name;
}
/**
 * Ruční povely z HMI pro zařízení: u servoosy regulace (úroveň), referování (hrana) a ruční pojezd
 * +/− (držet; po E-stopu / poruše až po puštění tlačítka), jinak jeden povel `manVarOf`.
 */
export function manVarsOf(d: Pick<Device, "name" | "cls">): string[] {
  if (d.cls === "Axis") return ["manPower_", "manHome_", "manJogP_", "manJogN_"].map(p => p + d.name);
  return [manVarOf(d)];
}
/** Předpony proměnných povelů sekvence pohonů a servoosy (pořadí = `motionSeqVars` v ir.ts). */
export const MOTION_SEQ_PREFIX = {
  Vfd: ["seqRun_", "seqSpd_", "seqRev_"],
  PosDrive: ["seqMove_", "seqHome_", "seqRec_"],
  PropValve: ["seqOn_", "seqSp_"],
  Axis: ["seqCmd_", "seqMode_", "seqTgt_", "seqVel_", "seqAcc_", "seqDec_"],
} as const;

/** Všechna jména, která program projektu deklaruje kvůli zařízení `d` (instance, povely, objekt osy). */
export function deviceGeneratedNames(d: Pick<Device, "name" | "cls">): string[] {
  const out = [instName(d), "Ax_" + d.name];
  if (d.cls === "Motor" || d.cls === "Ventil" || d.cls in MOTION_SEQ_PREFIX) {
    out.push(seqVarOf(d), ...manVarsOf(d));
    for (const p of (MOTION_SEQ_PREFIX as Record<string, readonly string[]>)[d.cls] || []) out.push(p + d.name);
  }
  return out;
}

/* ------------------------------------------------------------------ rezervovaná jména */

let reservedCache: Map<string, string> | null = null;
/** Klíčová slova IEC 61131-3 a standardní bloky / funkce všech dialektů (velkými písmeny → původ). */
function reservedWords(): Map<string, string> {
  if (reservedCache) return reservedCache;
  const m = new Map<string, string>();
  for (const k of IEC_KEYWORDS) m.set(k, "iec");
  for (const d of Object.values(DIALECTS)) {
    for (const k of d.stdFbs) if (!m.has(k.toUpperCase())) m.set(k.toUpperCase(), "fb");
    for (const k of d.fns) if (!m.has(k.toUpperCase())) m.set(k.toUpperCase(), "fb");
  }
  /* převodní funkce X_TO_Y a TO_<typ> (UniLogic) se v emulátoru ověřují vzorem, ne seznamem */
  return (reservedCache = m);
}

/** Jména deklarovaná generovaným programem projektu (velkými písmeny → popis původu). */
export function generatedNames(prj: Project): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of Object.values(IR_CTRL)) m.set(n.toUpperCase(), n);
  for (const n of POU_NAMES) m.set(n.toUpperCase(), n);
  for (const d of prj.devices || []) for (const n of deviceGeneratedNames(d)) m.set(n.toUpperCase(), n);
  return m;
}

/**
 * Proč tag (nebo jiné globální jméno) nejde použít kvůli kolizi s rezervovaným slovem nebo jménem,
 * které generovaný program deklaruje sám (`null` = v pořádku). `gen` = `generatedNames(prj)`
 * (předává se kvůli rychlosti při kontrole všech tagů).
 */
export function reservedNameProblem(prj: Project, name: string, gen = generatedNames(prj)): string | null {
  const K = String(name || "").toUpperCase();
  if (!K) return null;
  const r = reservedWords().get(K);
  if (r === "iec") return tr("Jméno {name} je klíčové slovo nebo datový typ IEC 61131-3 — kód by nešel přeložit.", { name });
  if (r === "fb") return tr("Jméno {name} je jméno standardního bloku nebo funkce PLC — kód by nešel přeložit.", { name });
  /* vyhrazená slova, tvar operandu a předpony jen pro platformy projektu: „S1“, „B1“ jsou běžné tagy (import TIA),
     na Mitsubishi jsou to operandy — validace je ohlásí, jakmile se Mitsubishi přidá mezi platformy */
  for (const p of prj.platforms || []) {
    const d = (DIALECTS as Record<string, (typeof DIALECTS)[keyof typeof DIALECTS]>)[p];
    if (!d) continue;
    if (d.reserved.has(K)) return tr("Jméno {name} je rezervované slovo platformy {plat} — kód by nešel přeložit.", { name, plat: d.label });
    if (d.deviceName && d.deviceName.test(name))
      return tr("Jméno {name} má tvar operandu PLC ({plat}: X0, M1, D100…) — kód by nešel přeložit.", { name, plat: d.label });
    if (d.reservedPrefix && d.reservedPrefix.test(name))
      return tr("Jméno {name} začíná předponou vyhrazenou platformou {plat} — kód by nešel přeložit.", { name, plat: d.label });
  }
  const g = gen.get(K);
  if (g) return tr("Jméno {name} používá generovaný program ({gen}) — tag ani jiné jméno se nesmí shodovat (velikost písmen se nerozlišuje).", { name, gen: g });
  if (new RegExp("^" + SEQ_TIMER_PREFIX + "\\d+$", "i").test(name))
    return tr("Jméno {name} používá generovaný program (časovač kroku) — zvol jiné.", { name });
  /* Unitronics (plochý ST) a zrcadlo pro HMI (Mitsubishi / Omron) skládají jména instM1_<port> */
  for (const d of prj.devices || []) {
    const p = instName(d).toUpperCase() + "_";
    if (K.startsWith(p)) return tr("Jméno {name} koliduje s proměnnými bloku {dev} (instance {inst}_…) — zvol jiné.", { name, dev: d.name, inst: instName(d) });
  }
  return null;
}
