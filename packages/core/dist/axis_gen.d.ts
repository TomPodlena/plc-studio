/**
 * PLCdesk — servoosa (fáze 2b): podpora platforem a šablony obálky FB_Axis.
 *
 * FB_Axis má na všech podporovaných platformách STEJNÉ rozhraní a stejný stavový automat
 * (`AXIS_SM` — zrcadlo v sim.ts `axisFbScan`); liší se jen čtení stavu osy a volání bloků
 * platformy. Bloky MC se volají vždy NA KONCI bloku a jejich výstupy čte automat až v dalším
 * cyklu — stejné časování jako Logix, kde instrukce MSO / MAM … stojí v hlavní rutině ZA voláním
 * AOI (motion instrukce v AOI manuál RM002 nedokládá) a bity MOTION_INSTRUCTION se kopírují
 * do AOI za instrukcemi. Simulace i emulátor tak dávají shodné chování na všech platformách.
 *
 * Podporované platformy (rešerše manuálů 2026-10-04, citace v `AXIS_SRC`):
 *  - Siemens S7-1500 (TO_PositioningAxis, MC V7: dynamika −1.0 = DynamicDefaults TO, StatusWord.%Xn)
 *    a S7-1200 (REAL, MoveAbsolute / Relative / Velocity / Halt BEZ zrychlení — jen z TO,
 *    bez MC_Stop, StatusBits); řada podle CPU v sestavě hardwaru (hardware.ts, rodina S71500);
 *  - Beckhoff Tc2_MC2 (AXIS_REF v GVL_IO, Axis.ReadStatus() každý cyklus, 0 = konfigurace osy,
 *    Velocity musí být > 0, MC_Halt ≤ 0 = zpomalení posledního pohybu → dosazuje se konfigurace);
 *  - CODESYS SoftMotion SM3_Basic (AXIS_REF_SM3, bRegulatorOn / bDriveStart, hodnoty vždy kladné,
 *    referování sleduje FB — člen „homed“ osa nemá) a profil Delta AX (DL_MotionControl odvozená
 *    ze SoftMotion, SM3_Basic);
 *  - WAGO jen CODESYS SoftMotion Light (SML_Basic, Axis_REF_SML, bloky *_SML; pohon CiA 402
 *    v profilových režimech počítá trajektorii sám; bez ryvu; poloha fActPosition neověřena);
 *  - Omron NJ/NX (_sAXIS_REF, MC_Stop místo MC_Halt — blokuje další povely, dokud je Execute TRUE,
 *    zrychlení 0 = BEZ rampy → dosazuje se konfigurace, stav z proměnné osy);
 *  - Rockwell Logix (MSO / MSF / MAFR / MAH / MAM / MAJ / MAS v hlavní rutině na jednorázové
 *    požadavky z AOI, osa AXIS_CIP_DRIVE se zakládá v Motion Group — L5X ji nenese; krok
 *    „rychlost“ nepodporován: MAJ nemá bit „rychlost dosažena“).
 * Nepodporované (kód osy se negeneruje — README vysvětlí): Mitsubishi FX5 (bez modulu jen pulzní
 * instrukce; knihovna PLCopen pro FX5-SSC-S je regionální a neověřená), Schneider (parametry GIPLC
 * nedostupné — EIO0000003592), Unitronics (bloky MC jen v Ladderu, plochý ST je nemá).
 */
import type { Project, PlatformKey, Device } from "./model.js";
export type AxisDialect = "s15" | "s12" | "tc" | "sm3" | "sml" | "om" | "lx";
/** Zdroje (manuály výrobců) — dokumentace, README, emulátor. */
export declare const AXIS_SRC: Record<AxisDialect, string>;
/** Název knihovny / řady pro texty. */
export declare const AXIS_LIB: Record<AxisDialect, string>;
/** Typ objektu osy v kódu platformy. */
export declare const AXIS_TYPE: Record<AxisDialect, string>;
/** Síť pohonu podle platformy (sestava hardwaru, kusovník, EPLAN). */
export declare const AXIS_NET: Record<AxisDialect, string>;
export declare function hasAxis(prj: Project): boolean;
/** Dialekt osy pro platformu; null = platforma servoosu nepodporuje. */
export declare function axisDialect(prj: Project, plat: PlatformKey): AxisDialect | null;
/** Proč platforma servoosu nepodporuje (text pro validaci a README); "" = podporuje. */
export declare function axisUnsupportedWhy(plat: PlatformKey): string;
/** Podpora servoosy na platformě: `ok`, dialekt, důvod nepodpory. */
export declare function axisSupport(prj: Project, plat: PlatformKey): {
    ok: boolean;
    dialect: AxisDialect | null;
    why: string;
};
/** Číselná pole konfigurace osy pro formuláře (web i desktop): klíč AxisCfg, popisek (klíč překladu), jednotka (u = jednotka osy). */
export declare const AXIS_FIELDS: Array<{
    key: "vMax" | "aMax" | "dMax" | "vDef" | "limNeg" | "limPos" | "homePos" | "posTol" | "followMax" | "jogVel" | "startPos";
    label: string;
    per: "" | "/s" | "/s²";
}>;
/** Projekt s osou se na platformě negeneruje (README místo kódu). */
export declare function axisBlocked(prj: Project, plat: PlatformKey): boolean;
/** Komentáře šablon (klíče překladu, `TPL_COMMENTS` v codegen.ts je převezme). */
export declare const AXIS_TPL_COMMENTS: string[];
/** Šablona FB_Axis (IEC ST) pro dialekt; Siemens SCL z ní dělá `stToScl`. */
export declare function axisTemplate(dia: AxisDialect): string;
/** Vstupy AOI FB_Axis v Logixu, které hlavní rutina plní ze stavu osy a bitů MOTION_INSTRUCTION. */
export declare const LX_AXIS_STATUS_IN: string[];
/** Požadavky AOI na instrukce (jednorázové) a parametry pohybu. */
export declare const LX_AXIS_REQ: string[];
/** Všechny šablony (kontrola komentářů a testy). */
export declare function axisTemplates(): Record<AxisDialect, string>;
/** Jména tagů MOTION_INSTRUCTION osy v Logixu. */
export declare function lxAxisMi(dev: Device): Record<string, string>;
/**
 * Logix: řádky hlavní rutiny kolem volání AOI osy — stav osy do AOI PŘED voláním, instrukce na
 * jednorázové požadavky a bity MOTION_INSTRUCTION do AOI ZA nimi (čtou se v dalším cyklu).
 * Členy tagu osy (ServoActionStatus, AxisHomedStatus, AxisFault, ActualPosition) podle MOTION-RM002
 * (kapitola Data types / atributy osy).
 */
export declare function lxAxisLines(dev: Device, inst: string): {
    before: string[];
    after: string[];
};
/**
 * Konfigurační list os pro README platformy: co založit v IDE (osu nejde přenést importem),
 * jednotky, mechanika, limity, dynamika, referování, chyba sledování, síť. "" bez os.
 */
export declare function axisReadme(prj: Project, plat: PlatformKey): string;
