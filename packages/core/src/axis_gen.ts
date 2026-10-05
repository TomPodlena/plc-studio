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
import { tr, N_ } from "./i18n.js";
import { hwLayout } from "./hardware.js";
import { axisCfgOf, axisObjName } from "./axis.js";
import { cdsProfile } from "./codesys_profiles.js";

export type AxisDialect = "s15" | "s12" | "tc" | "sm3" | "sml" | "om" | "lx";

/** Zdroje (manuály výrobců) — dokumentace, README, emulátor. */
export const AXIS_SRC: Record<AxisDialect, string> = {
  s15: "https://media.automation24.com/manual/405310.pdf",
  s12: "https://support.industry.siemens.com/cs/attachments/109973965/s71200_motion_control_function_manual_en-US_en-US.pdf",
  tc: "https://download.beckhoff.com/download/document/automation/twincat3/TwinCAT_3_PLC_Lib_Tc2_MC2_EN.pdf",
  sm3: "https://content.helpme-codesys.com/en/libs/SM3_Basic/Current/SM3_Basic/fld-SM3_Basic.html",
  sml: "https://content.helpme-codesys.com/en/libs/SML_Basic/Current/index.html",
  om: "https://files.omron.eu/downloads/latest/manual/en/w508_nj_nx-series_motion_control_instructions_reference_manual_en.pdf",
  lx: "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/motion-rm002_-en-p.pdf",
};

/** Název knihovny / řady pro texty. */
export const AXIS_LIB: Record<AxisDialect, string> = {
  s15: "S7-1500 Motion Control (TO_PositioningAxis)", s12: "S7-1200 Motion Control (TO_PositioningAxis)",
  tc: "Tc2_MC2 (AXIS_REF, NC PTP)", sm3: "CODESYS SoftMotion SM3_Basic (AXIS_REF_SM3)",
  sml: "CODESYS SoftMotion Light SML_Basic (Axis_REF_SML)", om: "Sysmac Motion Control (_sAXIS_REF)",
  lx: "Logix Motion (AXIS_CIP_DRIVE, MOTION_INSTRUCTION)",
};

/** Typ objektu osy v kódu platformy. */
export const AXIS_TYPE: Record<AxisDialect, string> = {
  s15: "TO_PositioningAxis", s12: "TO_PositioningAxis", tc: "AXIS_REF", sm3: "AXIS_REF_SM3", sml: "Axis_REF_SML", om: "_sAXIS_REF", lx: "AXIS_CIP_DRIVE",
};

/** Síť pohonu podle platformy (sestava hardwaru, kusovník, EPLAN). */
export const AXIS_NET: Record<AxisDialect, string> = {
  s15: "PROFINET", s12: "PROFINET", tc: "EtherCAT", sm3: "EtherCAT", sml: "EtherCAT / CANopen (CiA 402)", om: "EtherCAT", lx: "EtherNet/IP (CIP Motion)",
};

export function hasAxis(prj: Project): boolean { return prj.devices.some(d => d.cls === "Axis"); }

/** Dialekt osy pro platformu; null = platforma servoosu nepodporuje. */
export function axisDialect(prj: Project, plat: PlatformKey): AxisDialect | null {
  switch (plat) {
    case "siemens": return hwLayout(prj, "siemens").stations[0]?.family === "S71500" ? "s15" : "s12";
    case "beckhoff": return "tc";
    case "codesys": case "delta": return "sm3";
    case "wago": return "sml";
    case "omron": return "om";
    case "rockwell": return "lx";
    /* profily CODESYS dalších výrobců: SoftMotion SM3 jen tam, kde ho výrobce dokládá (codesys_profiles.ts) */
    default: return cdsProfile(plat)?.axis ?? null;
  }
}

/** Proč platforma servoosu nepodporuje (text pro validaci a README); "" = podporuje. */
export function axisUnsupportedWhy(plat: PlatformKey): string {
  if (plat === "mitsubishi") return tr("FX5 bez modulu Simple Motion má jen pulzní instrukce (DRVA / DRVI / PLSV) a knihovna PLCopen pro FX5-SSC-S není ověřena (jen regionální distribuce Mitsubishi Europe) — použij polohovací pohon se záznamy přes I/O.");
  if (plat === "schneider") return tr("parametry knihovny GMC Independent PLCopen MC (GIPLC) se nepodařilo ověřit (EIO0000003592 nedostupný) — kód osy se negeneruje, aby nevznikl nepřeložitelný program.");
  if (plat === "unitronics") return tr("UniLogic má bloky MC jen v Ladderu a plochý ST (Machine.st) instance FB nemá — použij polohovací pohon se záznamy nebo měnič přes I/O.");
  const prof = cdsProfile(plat);
  if (prof && !prof.axis && prof.axisWhy) return tr(prof.axisWhy);
  return "";
}

/** Podpora servoosy na platformě: `ok`, dialekt, důvod nepodpory. */
export function axisSupport(prj: Project, plat: PlatformKey): { ok: boolean; dialect: AxisDialect | null; why: string } {
  const dialect = axisDialect(prj, plat);
  return { ok: !!dialect, dialect, why: dialect ? "" : axisUnsupportedWhy(plat) };
}

/** Číselná pole konfigurace osy pro formuláře (web i desktop): klíč AxisCfg, popisek (klíč překladu), jednotka (u = jednotka osy). */
export const AXIS_FIELDS: Array<{ key: "vMax" | "aMax" | "dMax" | "vDef" | "limNeg" | "limPos" | "homePos" | "posTol" | "followMax" | "jogVel" | "startPos"; label: string; per: "" | "/s" | "/s²" }> = [
  { key: "vMax", label: N_("max. rychlost"), per: "/s" },
  { key: "aMax", label: N_("max. zrychlení"), per: "/s²" },
  { key: "dMax", label: N_("max. zpomalení"), per: "/s²" },
  { key: "vDef", label: N_("výchozí rychlost"), per: "/s" },
  { key: "limNeg", label: N_("SW limit −"), per: "" },
  { key: "limPos", label: N_("SW limit +"), per: "" },
  { key: "homePos", label: N_("poloha reference"), per: "" },
  { key: "posTol", label: N_("okno v poloze"), per: "" },
  { key: "followMax", label: N_("max. chyba sledování"), per: "" },
  { key: "jogVel", label: N_("rychlost ručního pojezdu"), per: "/s" },
  { key: "startPos", label: N_("poloha po zapnutí (model)"), per: "" },
];

/** Projekt s osou se na platformě negeneruje (README místo kódu). */
export function axisBlocked(prj: Project, plat: PlatformKey): boolean { return hasAxis(prj) && !axisDialect(prj, plat); }

/* ================================================================ šablony FB_Axis */

/** Komentáře šablon (klíče překladu, `TPL_COMMENTS` v codegen.ts je převezme). */
export const AXIS_TPL_COMMENTS: string[] = [
  N_("Sablona: servoosa - obalka nad bloky Motion Control platformy (zapnuti, referovani, polohovani, rychlost, zastaveni, rucni pojezd). Porucha osy, odmitnuty povel, bez referovani, regulace nezapnuta do 5 s drzi do kvitace (reset)."),
  N_("povel sekvence (cislo kroku); 0 = zadny povel - beh se zastavi"),
  N_("1 absolutne, 2 relativne, 3 rychlost, 4 zastavit, 5 referovat"),
  N_("0 = vychozi z konfigurace osy"),
  N_("kvitace poruchy (hrana)"),
  N_("stav osy a bloku MC z minuleho cyklu"),
  N_("povel sekvence behem pohybu: preruseni nebo zastaveni hned, jiny pohyb az po dokonceni"),
  N_("povely bloku MC - bloky se volaji na konci, jejich vystupy cte automat v dalsim cyklu"),
  N_("referovani sleduje blok (osa SoftMotion clen homed nema); ztrata komunikace ho rusi"),
  N_("Logix: instrukce pohybu jsou v hlavni rutine - AOI dava jednorazove pozadavky a cte bity MOTION_INSTRUCTION"),
];

const DECL_IN = `    enable : BOOL;
    power : BOOL;
    cmdId : INT;        (* povel sekvence (cislo kroku); 0 = zadny povel - beh se zastavi *)
    cmdMode : INT;      (* 1 absolutne, 2 relativne, 3 rychlost, 4 zastavit, 5 referovat *)
    cmdPos : REAL;
    cmdVel : REAL;         (* 0 = vychozi z konfigurace osy *)
    cmdAcc : REAL;
    cmdDec : REAL;
    manHome : BOOL;
    jogPos : BOOL;
    jogNeg : BOOL;
    reset : BOOL;       (* kvitace poruchy (hrana) *)
    cfgVel : REAL;
    cfgAcc : REAL;
    cfgDec : REAL;
    cfgJerk : REAL;
    jogVel : REAL;
    homePos : REAL;`;

const DECL_OUT = `    powered : BOOL;
    homed : BOOL;
    done : BOOL;
    doneId : INT;
    actPos : REAL;
    moving : BOOL;
    busy : BOOL;
    error : BOOL;
    status : WORD;
    errCode : INT;`;

const DECL_VAR = `    statStep : INT;
    curId : INT;
    curMode : INT;
    lastHome : BOOL;
    lastReset : BOOL;
    trigHome : BOOL;
    trigReset : BOOL;
    jogBlock : BOOL;
    velRun : BOOL;
    pwrOk : BOOL;
    axErr : BOOL;
    mvDone : BOOL;
    mvErr : BOOL;
    homeDone : BOOL;
    haltDone : BOOL;
    resetDone : BOOL;
    resetErr : BOOL;
    enPower : BOOL;
    exHome : BOOL;
    exAbs : BOOL;
    exRel : BOOL;
    exVelP : BOOL;
    exVelN : BOOL;
    exHalt : BOOL;
    exReset : BOOL;
    vUse : REAL;
    aUse : REAL;
    dUse : REAL;
    dHalt : REAL;
    velAbs : REAL;
    tonPower : TON;`;

/**
 * Stavový automat FB_Axis — společný všem platformám (zrcadlo: sim.ts `axisFbScan`).
 * 0 vypnuto, 10 zapínání, 20 připraveno, 30 referuje, 40 jede, 50 zastavuje, 60 / 61 ruční
 * pojezd +/−, 90 porucha, 95 kvitace. errCode: 1 porucha osy, 2 regulace nezapnuta,
 * 3 bez referování, 7 povel odmítnut (chyba bloku MC).
 */
const AXIS_SM = `trigHome := manHome AND NOT lastHome;  lastHome := manHome;
trigReset := reset AND NOT lastReset;  lastReset := reset;
IF NOT jogPos AND NOT jogNeg THEN jogBlock := FALSE; END_IF;

IF NOT enable THEN
    statStep := 0; done := FALSE; velRun := FALSE; errCode := 0;
    IF jogPos OR jogNeg THEN jogBlock := TRUE; END_IF;
ELSE
    CASE statStep OF
        0: (* OFF *)
            IF power THEN statStep := 10; END_IF;
        10: (* POWERING *)
            IF pwrOk THEN statStep := 20; END_IF;
            IF NOT power THEN statStep := 0; END_IF;
        20: (* READY *)
            IF NOT power THEN
                statStep := 0; velRun := FALSE;
            ELSIF cmdId <> curId THEN
                curId := cmdId; curMode := cmdMode; done := FALSE;
                IF cmdId = 0 THEN
                    IF velRun THEN statStep := 50; END_IF;
                ELSIF cmdMode = 5 THEN
                    statStep := 30; velRun := FALSE;
                ELSIF cmdMode = 4 THEN
                    statStep := 50;
                ELSIF (cmdMode = 1) AND NOT homed THEN
                    statStep := 90; errCode := 3;
                ELSE
                    statStep := 40; velRun := FALSE;
                END_IF;
            ELSIF trigHome THEN
                curMode := 5; done := FALSE; statStep := 30; velRun := FALSE;
            ELSIF jogPos AND NOT jogBlock THEN
                statStep := 60;
            ELSIF jogNeg AND NOT jogBlock THEN
                statStep := 61;
            END_IF;
        30: (* HOMING *)
            IF homeDone THEN statStep := 20; done := TRUE; doneId := curId; END_IF;
        40: (* MOVING *)
            IF mvDone THEN statStep := 20; done := TRUE; doneId := curId; velRun := (curMode = 3); END_IF;
        50: (* STOPPING *)
            IF haltDone THEN
                statStep := 20; velRun := FALSE;
                IF curMode = 4 THEN done := TRUE; doneId := curId; END_IF;
            END_IF;
        60: (* JOG_POS *)
            IF NOT jogPos THEN statStep := 50; curMode := 0; END_IF;
        61: (* JOG_NEG *)
            IF NOT jogNeg THEN statStep := 50; curMode := 0; END_IF;
        90: (* ERROR *)
            velRun := FALSE;
            IF trigReset THEN statStep := 95; END_IF;
        95: (* RESETTING *)
            IF resetDone THEN statStep := 0; errCode := 0; ELSIF resetErr THEN statStep := 90; END_IF;
    END_CASE;

    (* povel sekvence behem pohybu: preruseni nebo zastaveni hned, jiny pohyb az po dokonceni *)
    IF ((statStep = 30) OR (statStep = 40)) AND (cmdId <> curId) AND ((cmdId = 0) OR (cmdMode = 4)) THEN
        curId := cmdId; curMode := cmdMode; done := FALSE; statStep := 50;
    END_IF;
    IF (statStep <> 0) AND (statStep < 90) AND axErr THEN
        statStep := 90; errCode := 1; velRun := FALSE;
    ELSIF (statStep >= 30) AND (statStep < 90) AND mvErr THEN
        statStep := 90; errCode := 7; velRun := FALSE;
    END_IF;
END_IF;
tonPower(IN := (statStep = 10), PT := T#5S);
IF tonPower.Q THEN statStep := 90; errCode := 2; END_IF;
`;

const AXIS_OUT = `powered := (statStep >= 20) AND (statStep < 90);
busy := (statStep = 10) OR ((statStep >= 30) AND (statStep < 90));
moving := (statStep = 30) OR (statStep = 40) OR (statStep = 60) OR (statStep = 61) OR ((statStep = 20) AND velRun);
error := (statStep >= 90);
IF NOT enable THEN status := 16#8001; ELSIF error THEN status := 16#8002; ELSE status := 16#0000; END_IF;`;

const EX_COMMON = `enPower := (statStep >= 10) AND (statStep < 90);
exHome := (statStep = 30);
exAbs := (statStep = 40) AND (curMode = 1);
exRel := (statStep = 40) AND (curMode = 2);
exVelP := ((statStep = 40) AND (curMode = 3) AND (cmdPos >= 0.0)) OR (statStep = 60);
exVelN := ((statStep = 40) AND (curMode = 3) AND (cmdPos < 0.0)) OR (statStep = 61);
exHalt := (statStep = 50);
exReset := (statStep = 95);
IF (statStep = 60) OR (statStep = 61) THEN velAbs := jogVel; ELSIF cmdPos < 0.0 THEN velAbs := -cmdPos; ELSE velAbs := cmdPos; END_IF;`;

/** Hlášení bloků (výběr podle stavu — viz stavový automat). */
const MV_SEL = (abs: string, rel: string, velP: string, velN: string, home: string, halt: string, errs: { abs: string; rel: string; velP: string; velN: string; home: string; halt: string }, reset: { done: string; err: string }) =>
  `mvDone := ((curMode = 1) AND ${abs}) OR ((curMode = 2) AND ${rel}) OR ((curMode = 3) AND (${velP} OR ${velN}));
mvErr := ((statStep = 30) AND ${errs.home}) OR ((statStep = 40) AND (${errs.abs} OR ${errs.rel} OR ${errs.velP} OR ${errs.velN})) OR ((statStep = 50) AND ${errs.halt}) OR (((statStep = 60) OR (statStep = 61)) AND (${errs.velP} OR ${errs.velN}));
homeDone := ${home};
haltDone := ${halt};
resetDone := ${reset.done};
resetErr := ${reset.err};`;

const IEC_SEL = MV_SEL("instAbs.Done", "instRel.Done", "instVelP.InVelocity", "instVelN.InVelocity", "instHome.Done", "instHalt.Done",
  { abs: "instAbs.Error", rel: "instRel.Error", velP: "instVelP.Error", velN: "instVelN.Error", home: "instHome.Error", halt: "instHalt.Error" },
  { done: "instReset.Done", err: "instReset.Error" });

interface IecSpec {
  axisBlock: "VAR_INPUT" | "VAR_IN_OUT";
  types: { power: string; home: string; abs: string; rel: string; cmdVel: string; halt: string; reset: string };
  read: string;
  dyn: string;
  calls: string;
}

const DYN_CFG = `IF cmdVel > 0.0 THEN vUse := cmdVel; ELSE vUse := cfgVel; END_IF;
IF cmdAcc > 0.0 THEN aUse := cmdAcc; ELSE aUse := cfgAcc; END_IF;
IF cmdDec > 0.0 THEN dUse := cmdDec; ELSE dUse := cfgDec; END_IF;
dHalt := dUse;`;

const MC_STD = { power: "MC_Power", home: "MC_Home", abs: "MC_MoveAbsolute", rel: "MC_MoveRelative", cmdVel: "MC_MoveVelocity", halt: "MC_Halt", reset: "MC_Reset" };

const IEC: Record<Exclude<AxisDialect, "lx">, IecSpec> = {
  s15: {
    axisBlock: "VAR_INPUT", types: MC_STD,
    read: `pwrOk := instPower.Status;
axErr := Axis.StatusWord.%X1;
homed := Axis.StatusWord.%X5;
actPos := LREAL_TO_REAL(Axis.ActualPosition);`,
    dyn: `IF cmdVel > 0.0 THEN vUse := cmdVel; ELSE vUse := -1.0; END_IF;
IF cmdAcc > 0.0 THEN aUse := cmdAcc; ELSE aUse := -1.0; END_IF;
IF cmdDec > 0.0 THEN dUse := cmdDec; ELSE dUse := -1.0; END_IF;
dHalt := dUse;`,
    calls: `instPower(Axis := Axis, Enable := enPower, StartMode := 1, StopMode := 0);
instHome(Axis := Axis, Execute := exHome, Position := homePos, Mode := 3);
instAbs(Axis := Axis, Execute := exAbs, Position := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := -1.0);
instRel(Axis := Axis, Execute := exRel, Distance := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := -1.0);
instVelP(Axis := Axis, Execute := exVelP, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := -1.0, Direction := 1, Current := FALSE, PositionControlled := TRUE);
instVelN(Axis := Axis, Execute := exVelN, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := -1.0, Direction := 2, Current := FALSE, PositionControlled := TRUE);
instHalt(Axis := Axis, Execute := exHalt, Deceleration := dHalt, Jerk := -1.0);
instReset(Axis := Axis, Execute := exReset, Restart := FALSE);`,
  },
  s12: {
    axisBlock: "VAR_INPUT", types: MC_STD,
    read: `pwrOk := instPower.Status;
axErr := Axis.StatusBits.Error;
homed := Axis.StatusBits.HomingDone;
actPos := Axis.ActualPosition;`,
    dyn: `IF cmdVel > 0.0 THEN vUse := cmdVel; ELSE vUse := cfgVel; END_IF;`,
    calls: `instPower(Axis := Axis, Enable := enPower, StartMode := 1, StopMode := 0);
instHome(Axis := Axis, Execute := exHome, Position := homePos, Mode := 3);
instAbs(Axis := Axis, Execute := exAbs, Position := cmdPos, Velocity := vUse);
instRel(Axis := Axis, Execute := exRel, Distance := cmdPos, Velocity := vUse);
instVelP(Axis := Axis, Execute := exVelP, Velocity := velAbs, Direction := 1, Current := FALSE);
instVelN(Axis := Axis, Execute := exVelN, Velocity := velAbs, Direction := 2, Current := FALSE);
instHalt(Axis := Axis, Execute := exHalt);
instReset(Axis := Axis, Execute := exReset, Restart := FALSE);`,
  },
  tc: {
    axisBlock: "VAR_IN_OUT", types: MC_STD,
    read: `Axis.ReadStatus();
pwrOk := instPower.Status;
axErr := Axis.Status.Error;
homed := Axis.Status.Homed;
actPos := LREAL_TO_REAL(Axis.NcToPlc.ActPos);`,
    dyn: `IF cmdVel > 0.0 THEN vUse := cmdVel; ELSE vUse := cfgVel; END_IF;
IF cmdAcc > 0.0 THEN aUse := cmdAcc; ELSE aUse := 0.0; END_IF;
IF cmdDec > 0.0 THEN dUse := cmdDec; ELSE dUse := 0.0; END_IF;
IF cmdDec > 0.0 THEN dHalt := cmdDec; ELSE dHalt := cfgDec; END_IF;`,
    calls: `instPower(Axis := Axis, Enable := enPower, Enable_Positive := enPower, Enable_Negative := enPower, Override := 100.0);
instHome(Axis := Axis, Execute := exHome, Position := homePos, HomingMode := MC_HomingMode.MC_DefaultHoming);
instAbs(Axis := Axis, Execute := exAbs, Position := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := 0.0);
instRel(Axis := Axis, Execute := exRel, Distance := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := 0.0);
instVelP(Axis := Axis, Execute := exVelP, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := 0.0, Direction := MC_Direction.MC_Positive_Direction);
instVelN(Axis := Axis, Execute := exVelN, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := 0.0, Direction := MC_Direction.MC_Negative_Direction);
instHalt(Axis := Axis, Execute := exHalt, Deceleration := dHalt, Jerk := 0.0);
instReset(Axis := Axis, Execute := exReset);`,
  },
  sm3: {
    axisBlock: "VAR_IN_OUT", types: MC_STD,
    read: `pwrOk := instPower.Status;
axErr := Axis.bError;
(* referovani sleduje blok (osa SoftMotion clen homed nema); ztrata komunikace ho rusi *)
IF NOT Axis.bCommunication THEN homed := FALSE; END_IF;
IF instHome.Done THEN homed := TRUE; END_IF;
actPos := LREAL_TO_REAL(Axis.fActPosition);`,
    dyn: DYN_CFG,
    calls: `instPower(Axis := Axis, Enable := enPower, bRegulatorOn := enPower, bDriveStart := enPower);
instHome(Axis := Axis, Execute := exHome, Position := homePos);
instAbs(Axis := Axis, Execute := exAbs, Position := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk);
instRel(Axis := Axis, Execute := exRel, Distance := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk);
instVelP(Axis := Axis, Execute := exVelP, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk, Direction := MC_DIRECTION.positive);
instVelN(Axis := Axis, Execute := exVelN, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk, Direction := MC_DIRECTION.negative);
instHalt(Axis := Axis, Execute := exHalt, Deceleration := dHalt, Jerk := cfgJerk);
instReset(Axis := Axis, Execute := exReset);`,
  },
  sml: {
    axisBlock: "VAR_IN_OUT",
    types: { power: "MC_Power_SML", home: "MC_Home_SML", abs: "MC_MoveAbsolute_SML", rel: "MC_MoveRelative_SML", cmdVel: "MC_MoveVelocity_SML", halt: "MC_Halt_SML", reset: "MC_Reset_SML" },
    read: `pwrOk := instPower.Status;
axErr := Axis.bError;
(* referovani sleduje blok (osa SoftMotion clen homed nema); ztrata komunikace ho rusi *)
IF NOT Axis.bCommunication THEN homed := FALSE; END_IF;
IF instHome.Done THEN homed := TRUE; END_IF;
actPos := LREAL_TO_REAL(Axis.fActPosition);`,
    dyn: DYN_CFG,
    calls: `instPower(Axis := Axis, Enable := enPower, bRegulatorOn := enPower, bDriveStart := enPower);
instHome(Axis := Axis, Execute := exHome, Position := homePos);
instAbs(Axis := Axis, Execute := exAbs, Position := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse);
instRel(Axis := Axis, Execute := exRel, Distance := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse);
instVelP(Axis := Axis, Execute := exVelP, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse);
instVelN(Axis := Axis, Execute := exVelN, Velocity := -velAbs, Acceleration := aUse, Deceleration := dUse);
instHalt(Axis := Axis, Execute := exHalt, Deceleration := dHalt);
instReset(Axis := Axis, Execute := exReset);`,
  },
  om: {
    axisBlock: "VAR_IN_OUT", types: { ...MC_STD, halt: "MC_Stop" },
    read: `pwrOk := instPower.Status;
axErr := Axis.Status.ErrorStop;
homed := Axis.Details.Homed;
actPos := LREAL_TO_REAL(Axis.Act.Pos);`,
    dyn: DYN_CFG,
    calls: `instPower(Axis := Axis, Enable := enPower);
instHome(Axis := Axis, Execute := exHome);
instAbs(Axis := Axis, Execute := exAbs, Position := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk);
instRel(Axis := Axis, Execute := exRel, Distance := cmdPos, Velocity := vUse, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk);
instVelP(Axis := Axis, Execute := exVelP, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk, Direction := _eMC_DIRECTION#_mcPositiveDirection);
instVelN(Axis := Axis, Execute := exVelN, Velocity := velAbs, Acceleration := aUse, Deceleration := dUse, Jerk := cfgJerk, Direction := _eMC_DIRECTION#_mcNegativeDirection);
instHalt(Axis := Axis, Execute := exHalt, Deceleration := dHalt, Jerk := cfgJerk);
instReset(Axis := Axis, Execute := exReset);`,
  },
};

const ind = (s: string) => s.split("\n").map(l => l ? "    " + l : l).join("\n");

/** Šablona FB_Axis (IEC ST) pro dialekt; Siemens SCL z ní dělá `stToScl`. */
export function axisTemplate(dia: AxisDialect): string {
  if (dia === "lx") return axisTemplateLx();
  const s = IEC[dia], t = s.types;
  const inst = `    instPower : ${t.power};
    instHome : ${t.home};
    instAbs : ${t.abs};
    instRel : ${t.rel};
    instVelP : ${t.cmdVel};
    instVelN : ${t.cmdVel};
    instHalt : ${t.halt};
    instReset : ${t.reset};`;
  return `FUNCTION_BLOCK FB_Axis
(* Sablona: servoosa - obalka nad bloky Motion Control platformy (zapnuti, referovani, polohovani, rychlost, zastaveni, rucni pojezd).
   Porucha osy, odmitnuty povel, bez referovani, regulace nezapnuta do 5 s drzi do kvitace (reset). *)
VAR_INPUT
${DECL_IN}${s.axisBlock === "VAR_INPUT" ? "\n    Axis : " + AXIS_TYPE[dia] + ";" : ""}
END_VAR
${s.axisBlock === "VAR_IN_OUT" ? "VAR_IN_OUT\n    Axis : " + AXIS_TYPE[dia] + ";\nEND_VAR\n" : ""}VAR_OUTPUT
${DECL_OUT}
END_VAR
VAR
${DECL_VAR}
${inst}
END_VAR

(* stav osy a bloku MC z minuleho cyklu *)
${s.read}
${IEC_SEL}
${AXIS_SM}
(* povely bloku MC - bloky se volaji na konci, jejich vystupy cte automat v dalsim cyklu *)
${EX_COMMON}
${s.dyn}
${s.calls}

${AXIS_OUT}
END_FUNCTION_BLOCK`;
}

/** Vstupy AOI FB_Axis v Logixu, které hlavní rutina plní ze stavu osy a bitů MOTION_INSTRUCTION. */
export const LX_AXIS_STATUS_IN = ["axServo", "axHomed", "axFault", "axPos", "mamPC", "mamER", "mahPC", "mahER", "masPC", "masER", "majER", "mafrDN", "mafrER"];
/** Požadavky AOI na instrukce (jednorázové) a parametry pohybu. */
export const LX_AXIS_REQ = ["reqMso", "reqMsf", "reqMafr", "reqMah", "reqMam", "reqMajP", "reqMajN", "reqMas"];

/** Šablona AOI FB_Axis pro Logix (IEC ST, převod `lxDialect`): stejný automat, požadavky místo volání bloků. */
function axisTemplateLx(): string {
  const sel = MV_SEL("mamPC", "mamPC", "FALSE", "FALSE", "mahPC", "masPC",
    { abs: "mamER", rel: "mamER", velP: "majER", velN: "majER", home: "mahER", halt: "masER" }, { done: "mafrDN", err: "mafrER" });
  return `FUNCTION_BLOCK FB_Axis
(* Sablona: servoosa - obalka nad bloky Motion Control platformy (zapnuti, referovani, polohovani, rychlost, zastaveni, rucni pojezd).
   Porucha osy, odmitnuty povel, bez referovani, regulace nezapnuta do 5 s drzi do kvitace (reset). *)
VAR_INPUT
${DECL_IN}
    axServo : BOOL;
    axHomed : BOOL;
    axFault : BOOL;
    axPos : REAL;
    mamPC : BOOL;
    mamER : BOOL;
    mahPC : BOOL;
    mahER : BOOL;
    masPC : BOOL;
    masER : BOOL;
    majER : BOOL;
    mafrDN : BOOL;
    mafrER : BOOL;
END_VAR
VAR_OUTPUT
${DECL_OUT}
    reqMso : BOOL;
    reqMsf : BOOL;
    reqMafr : BOOL;
    reqMah : BOOL;
    reqMam : BOOL;
    reqMajP : BOOL;
    reqMajN : BOOL;
    reqMas : BOOL;
    mvType : INT;
    mvSpeed : REAL;
    mvAcc : REAL;
    mvAccU : INT;
    mvDec : REAL;
    mvDecU : INT;
END_VAR
VAR
${DECL_VAR}
    prevStep : INT;
    prevPower : BOOL;
END_VAR

(* Logix: instrukce pohybu jsou v hlavni rutine - AOI dava jednorazove pozadavky a cte bity MOTION_INSTRUCTION *)
(* stav osy a bloku MC z minuleho cyklu *)
pwrOk := axServo;
axErr := axFault;
homed := axHomed;
actPos := axPos;
${sel}
${AXIS_SM}
(* povely bloku MC - bloky se volaji na konci, jejich vystupy cte automat v dalsim cyklu *)
${EX_COMMON}
reqMso := enPower AND NOT prevPower;
reqMsf := prevPower AND NOT enPower;
prevPower := enPower;
reqMafr := exReset AND (prevStep <> 95);
reqMah := exHome AND (prevStep <> 30);
reqMam := (exAbs OR exRel) AND (prevStep <> 40);
reqMajP := (statStep = 60) AND (prevStep <> 60);
reqMajN := (statStep = 61) AND (prevStep <> 61);
reqMas := exHalt AND (prevStep <> 50);
prevStep := statStep;
IF curMode = 2 THEN mvType := 1; ELSE mvType := 0; END_IF;
IF cmdVel > 0.0 THEN mvSpeed := cmdVel; ELSE mvSpeed := cfgVel; END_IF;
IF cmdAcc > 0.0 THEN mvAcc := cmdAcc; mvAccU := 0; ELSE mvAcc := 100.0; mvAccU := 1; END_IF;
IF cmdDec > 0.0 THEN mvDec := cmdDec; mvDecU := 0; ELSE mvDec := 100.0; mvDecU := 1; END_IF;

${AXIS_OUT}
END_FUNCTION_BLOCK`;
}

/** Všechny šablony (kontrola komentářů a testy). */
export function axisTemplates(): Record<AxisDialect, string> {
  const out = {} as Record<AxisDialect, string>;
  for (const d of ["s15", "s12", "tc", "sm3", "sml", "om", "lx"] as AxisDialect[]) out[d] = axisTemplate(d);
  return out;
}

/** Jména tagů MOTION_INSTRUCTION osy v Logixu. */
export function lxAxisMi(dev: Device): Record<string, string> {
  const n = dev.name;
  return { Mso: "mc" + n + "_Mso", Msf: "mc" + n + "_Msf", Mafr: "mc" + n + "_Mafr", Mah: "mc" + n + "_Mah", Mam: "mc" + n + "_Mam",
    JogP: "mc" + n + "_JogP", JogN: "mc" + n + "_JogN", Mas: "mc" + n + "_Mas" };
}

/**
 * Logix: řádky hlavní rutiny kolem volání AOI osy — stav osy do AOI PŘED voláním, instrukce na
 * jednorázové požadavky a bity MOTION_INSTRUCTION do AOI ZA nimi (čtou se v dalším cyklu).
 * Členy tagu osy (ServoActionStatus, AxisHomedStatus, AxisFault, ActualPosition) podle MOTION-RM002
 * (kapitola Data types / atributy osy).
 */
export function lxAxisLines(dev: Device, inst: string): { before: string[]; after: string[] } {
  const ax = axisObjName(dev), mi = lxAxisMi(dev);
  const before = [
    inst + ".axServo := " + ax + ".ServoActionStatus;",
    inst + ".axHomed := " + ax + ".AxisHomedStatus;",
    inst + ".axFault := " + ax + ".AxisFault <> 0;",
    inst + ".axPos := " + ax + ".ActualPosition;",
  ];
  const after = [
    "IF " + inst + ".reqMsf THEN MSF(" + ax + ", " + mi.Msf + "); END_IF;",
    "IF " + inst + ".reqMso THEN MSO(" + ax + ", " + mi.Mso + "); END_IF;",
    "IF " + inst + ".reqMafr THEN MAFR(" + ax + ", " + mi.Mafr + "); END_IF;",
    "IF " + inst + ".reqMah THEN MAH(" + ax + ", " + mi.Mah + "); END_IF;",
    "IF " + inst + ".reqMam THEN MAM(" + ax + ", " + mi.Mam + ", " + inst + ".mvType, " + inst + ".cmdPos, " + inst + ".mvSpeed, 0, " + inst + ".mvAcc, " + inst + ".mvAccU, " + inst + ".mvDec, " + inst + ".mvDecU, 0, 100.0, 100.0, 2, 0, 0, 0, 0, 0, 0); END_IF;",
    "IF " + inst + ".reqMajP THEN MAJ(" + ax + ", " + mi.JogP + ", 0, " + inst + ".jogVel, 0, 100.0, 1, 100.0, 1, 0, 100.0, 100.0, 2, 0, 0, 0, 0); END_IF;",
    "IF " + inst + ".reqMajN THEN MAJ(" + ax + ", " + mi.JogN + ", 1, " + inst + ".jogVel, 0, 100.0, 1, 100.0, 1, 0, 100.0, 100.0, 2, 0, 0, 0, 0); END_IF;",
    "IF " + inst + ".reqMas THEN MAS(" + ax + ", " + mi.Mas + ", 0, 1, " + inst + ".mvDec, " + inst + ".mvDecU, 0, 100.0, 2); END_IF;",
    inst + ".mamPC := " + mi.Mam + ".PC; " + inst + ".mamER := " + mi.Mam + ".ER;",
    inst + ".mahPC := " + mi.Mah + ".PC; " + inst + ".mahER := " + mi.Mah + ".ER;",
    inst + ".masPC := " + mi.Mas + ".PC; " + inst + ".masER := " + mi.Mas + ".ER;",
    inst + ".majER := " + mi.JogP + ".ER OR " + mi.JogN + ".ER;",
    inst + ".mafrDN := " + mi.Mafr + ".DN; " + inst + ".mafrER := " + mi.Mafr + ".ER;",
  ];
  return { before, after };
}

/* ================================================================ konfigurační list (README) */

/**
 * Konfigurační list os pro README platformy: co založit v IDE (osu nejde přenést importem),
 * jednotky, mechanika, limity, dynamika, referování, chyba sledování, síť. "" bez os.
 */
export function axisReadme(prj: Project, plat: PlatformKey): string {
  const axes = prj.devices.filter(d => d.cls === "Axis");
  if (!axes.length) return "";
  const sup = axisSupport(prj, plat);
  const L = ["", "", tr("SERVOOSY — KONFIGURAČNÍ LIST (osu nejde přenést importem, založ ji v IDE)")];
  if (!sup.ok) {
    L.push("- " + tr("PLATFORMA SERVOOSU NEPODPORUJE — kód programu se pro ni negeneruje: {why}", { why: sup.why }));
    return L.join("\n");
  }
  const dia = sup.dialect!;
  const how: Record<AxisDialect, string> = {
    s15: tr("Technologické objekty → Přidat objekt → TO_PositioningAxis se jménem níže; pohon PROFIdrive (telegram dle pohonu), mechanika, limity, dynamika (DynamicDefaults = výchozí rychlost, zrychlení, zpomalení), referování (aktivní), hlídání polohy (okno, MinDwellTime) a chyby sledování. Bloky MC voláme s −1.0 = hodnoty z konfigurace TO."),
    s12: tr("Technologické objekty → Přidat objekt → TO_PositioningAxis se jménem níže (PROFIdrive / PTO / analog); dynamika se u S7-1200 bere VŽDY z konfigurace TO (MC_MoveAbsolute / Relative / Velocity / Halt nemají vstup zrychlení) — výchozí rychlost předává blok, zrychlení a zpomalení nastav v TO."),
    tc: tr("Motion → NC-Task → přidej osu (Axis 1) a nalinkuj ji na pohon v EtherCAT stromu; v PLC je proměnná osy GVL_IO.<jméno> typu AXIS_REF — nalinkuj ji na osu NC (Link To NC). Knihovna Tc2_MC2 musí být v referencích. Nastav měřítko snímače, limity, dynamiku (výchozí zrychlení / zpomalení — blok posílá 0 = konfigurace), Reference Mode a hlídání chyby sledování."),
    sm3: tr("Device tree → EtherCAT master → pohon CiA 402 → SoftMotion osa (SM_Drive_*) se jménem níže (Ax_… je globální jméno osy, kód na ni odkazuje přímo). Knihovna SM3_Basic. Jednotky (převod inkrementů / jednotka), limity, referování v parametrech pohonu; bloky dostávají rychlost, zrychlení, zpomalení a ryv z konfigurace níže (SM3 je chce vždy kladné)."),
    sml: tr("WAGO = jen CODESYS SoftMotion Light: pohon CiA 402 (EtherCAT / CANopen) v profilových režimech (polohování, rychlost, referování) počítá trajektorii sám, PLC zadává a hlídá; bez synchronizace a bez ryvu. Osu (Axis_REF_SML) založ pod pohonem s jménem níže, knihovna SML_Basic. Polohu pro HMI čte blok z fActPosition — dokumentace ji uvádí jen pro modulo osy (neověřeno, případně MC_ReadParameter_SML)."),
    om: tr("Configurations and Setup → Motion Control Setup → Axis Settings: přidej osu, přiřaď uzel EtherCAT a proměnnou osy přejmenuj na jméno níže (_sAXIS_REF). Unit Conversion, limity, Homing (blok MC_Home bere parametry z Axis Settings), Following Error Over Value. MC_Halt Sysmac nemá — zastavení je MC_Stop (do uvolnění Execute blokuje další povely)."),
    lx: tr("I/O Configuration → modul pohonu (Kinetix, CIP Motion) → osa AXIS_CIP_DRIVE se jménem níže, přiřazená do Motion Group (bez skupiny instrukce hlásí chybu 11); L5X osu ani skupinu nenese (konfigurace pohonu je v AOP). Axis Properties: Scaling, Homing (aktivní), Limits, Dynamics (Maximum Speed / Acceleration — MAM se zrychlením „100 % maxima“ = konfigurace). Instrukce MSO / MSF / MAFR / MAH / MAM / MAJ / MAS jsou v MainRoutine na jednorázové požadavky z AOI FB_Axis (motion instrukce uvnitř AOI manuál RM002 nedokládá); tagy MOTION_INSTRUCTION jsou v L5X. Krok „rychlost“ Logix nepodporuje (MAJ nemá bit „rychlost dosažena“)."),
  };
  L.push("- " + tr("Knihovna / objekt: {lib}; zdroj: {src}", { lib: AXIS_LIB[dia], src: AXIS_SRC[dia] }));
  L.push("- " + how[dia]);
  for (const d of axes) {
    const c = axisCfgOf(d), u = d.unit || "mm";
    L.push("- " + tr("{obj} (osa {dev}{desc}): jednotky {u}; max. rychlost {v} {u}/s, zrychlení {a} {u}/s², zpomalení {d} {u}/s², ryv {j}; výchozí rychlost {vd} {u}/s; SW limity {lim}; referenční poloha {home} {u}; okno v poloze ± {tol} {u}; max. chyba sledování {fe} {u}; ruční pojezd {jog} {u}/s; síť {net}{drv}.", {
      obj: axisObjName(d), dev: d.name, desc: d.desc ? " – " + d.desc : "", u, v: c.vMax, a: c.aMax, d: c.dMax, j: c.jerk ? c.jerk + " " + u + "/s³" : tr("bez omezení (lichoběžník)"),
      vd: c.vDef, lim: c.limNeg !== undefined || c.limPos !== undefined ? (c.limNeg ?? "—") + " … " + (c.limPos ?? "—") + " " + u : tr("nenastaveny"),
      home: c.homePos, tol: c.posTol, fe: c.followMax, jog: c.jogVel, net: AXIS_NET[dia], drv: c.drive ? ", " + c.drive : "" }));
    if (c.positions.length) L.push("  " + tr("Pojmenované polohy: {list}.", { list: c.positions.map(p => p.name + " = " + p.pos + " " + u).join(", ") }));
  }
  L.push("- " + tr("Rozhraní FB_Axis: power (regulace), cmdId / cmdMode / cmdPos / cmdVel / cmdAcc / cmdDec (povel sekvence; 0 = výchozí z konfigurace), manHome, jogPos / jogNeg (ruční, jen mimo AUTO), reset; výstupy powered, homed, done + doneId (číslo dokončeného kroku), actPos, moving, busy, error, status, errCode (1 porucha osy — pohon, chyba sledování, komunikace, limit: příčina v diagnostice osy; 2 regulace nezapnuta do 5 s; 3 bez referování; 7 povel odmítnut blokem MC)."));
  L.push("- " + tr("Bezpečnost: STO / SS1 / SLS řeší pohon s integrovanou bezpečností nebo bezpečnostní PLC (návrh v modulu bezpečnosti) — standardní program je neřídí, jen čte stav."));
  L.push("- " + tr("NEOVĚŘENO PŘEKLADEM ani na ose: kód obálky vychází z manuálů výrobce a prošel emulátorem PLCdesk (model bloků MC), reálný překlad a oživení osy v IDE jsou nutné."));
  return L.join("\n");
}
