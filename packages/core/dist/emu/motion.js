/**
 * PLCdesk — emulátor: objekty os a bloky Motion Control jako standardní typy dialektu.
 *
 * Každá podporovaná platforma servoosy (axis_gen.ts) má tady svůj typ objektu osy (členy, které
 * generovaný kód čte, jsou jen jiná jména slotů modelu axis.ts — jen ke čtení) a své bloky MC_*
 * se jmény a typy parametrů podle manuálu výrobce (zdroje `AXIS_SRC`). Blok se při volání chová
 * podle společného modelu `mcCall` (PLCopen); výklad dynamiky (−1.0 / 0 / povinné) podle platformy.
 * Logix: instrukce MSO / MSF / MAFR / MAH / MAM / MAJ / MAS s tagem MOTION_INSTRUCTION (`lxExec`).
 *
 * Emulátor ≠ překladač výrobce: seznam parametrů je výběr, který FB_Axis používá (+ ty, které
 * manuál uvádí jako povinné / běžné); jiné parametry bloků emulátor nezná a nahlásí je jako chybu.
 */
import { AX, AX_SIZE, MI, MI_SIZE } from "../axis.js";
import { AXIS_TYPE } from "../axis_gen.js";
/** Členy objektu osy čitelné z programu: cesta, typ, slot modelu (axis.ts AX). */
export const AXIS_MEMBERS = {
    /* S7-1500 V7 (A5E37577655): StatusWord DWORD (bit 0 Enable, 1 Error, 5 HomingDone, 7 Standstill), ActualPosition LREAL */
    s15: [["ActualPosition", "LREAL", AX.POS], ["StatusWord", "DWORD", AX.SW], ["StatusPositioning.FollowingError", "LREAL", AX.FERR], ["StatusDrive.CommunicationOK", "BOOL", AX.COMMOK]],
    /* S7-1200 V6–V8 (A5E03790551): StatusBits (Enable, HomingDone, Error, Standstill), ActualPosition REAL */
    s12: [["ActualPosition", "REAL", AX.POS], ["StatusBits.Enable", "BOOL", AX.PWR], ["StatusBits.HomingDone", "BOOL", AX.HOMED], ["StatusBits.Error", "BOOL", AX.ERR],
        ["StatusBits.Standstill", "BOOL", AX.STILL], ["StatusPositioning.FollowingError", "REAL", AX.FERR], ["StatusDrive.CommunicationOK", "BOOL", AX.COMMOK]],
    /* Tc2_MC2: Axis.Status obnovuje jen ReadStatus / MC_ReadStatus; NcToPlc.ActPos živě */
    tc: [["NcToPlc.ActPos", "LREAL", AX.POS], ["NcToPlc.ActVelo", "LREAL", AX.VEL], ["Status.Error", "BOOL", AX.TC_ERR], ["Status.ErrorId", "UDINT", AX.TC_ERRID],
        ["Status.Homed", "BOOL", AX.TC_HOMED], ["Status.StandStill", "BOOL", AX.TC_STILL]],
    /* SM3_Basic AXIS_REF_SM3: fActPosition, bError, dwErrorID, bCommunication */
    sm3: [["fActPosition", "LREAL", AX.POS], ["fActVelocity", "LREAL", AX.VEL], ["bError", "BOOL", AX.ERR], ["dwErrorID", "DWORD", AX.ERRID], ["bCommunication", "BOOL", AX.COMMOK]],
    /* SML_Basic Axis_REF_SML: fActPosition, bError, bCommunication */
    sml: [["fActPosition", "LREAL", AX.POS], ["bError", "BOOL", AX.ERR], ["bCommunication", "BOOL", AX.COMMOK]],
    /* Sysmac _sAXIS_REF (W508): Status.*, Details.Homed, Act.Pos, MFaultLvl.Active, DrvStatus.ServoOn */
    om: [["Act.Pos", "LREAL", AX.POS], ["Act.Vel", "LREAL", AX.VEL], ["Details.Homed", "BOOL", AX.HOMED], ["Status.ErrorStop", "BOOL", AX.ERR], ["Status.Standstill", "BOOL", AX.STILL],
        ["MFaultLvl.Active", "BOOL", AX.ERR], ["DrvStatus.ServoOn", "BOOL", AX.PWR]],
    /* Logix AXIS_CIP_DRIVE (MOTION-RM002 atributy osy): ServoActionStatus, AxisHomedStatus, AxisFault, ActualPosition */
    lx: [["ActualPosition", "REAL", AX.POS], ["ServoActionStatus", "BOOL", AX.PWR], ["AxisHomedStatus", "BOOL", AX.HOMED], ["AxisFault", "DINT", AX.ERR]],
};
export { AX_SIZE };
/** MOTION_INSTRUCTION (Logix): bity a kódy chyby. */
export const MI_MEMBERS = [["EN", "BOOL", MI.EN], ["DN", "BOOL", MI.DN], ["ER", "BOOL", MI.ER], ["PC", "BOOL", MI.PC], ["IP", "BOOL", MI.IP],
    ["ERR", "DINT", MI.ERR], ["EXERR", "DINT", MI.EXERR]];
export { MI_SIZE };
/** Výčty knihoven (hodnoty z manuálů). */
export const MC_ENUMS = {
    tc: { MC_Direction: { MC_Positive_Direction: 1, MC_Shortest_Way: 2, MC_Negative_Direction: 3, MC_Current_Direction: 4, MC_Undefined_Direction: 128 },
        MC_HomingMode: { MC_DefaultHoming: 0, MC_Direct: 1, MC_ForceCalibration: 2, MC_ResetCalibration: 3 } },
    sm3: { MC_DIRECTION: { shortest: 0, positive: 1, current: 2, fastest: 3, negative: -1 }, SMC_ERROR: { SMC_NO_ERROR: 0 } },
    sml: { SML_ERROR: { SML_NO_ERROR: 0 } },
    om: { _eMC_DIRECTION: { _mcPositiveDirection: 0, _mcShortestWay: 1, _mcNegativeDirection: 2, _mcCurrentDirection: 3, _mcNoDirection: 4 },
        _eMC_BUFFER_MODE: { _mcAborting: 0, _mcBuffered: 1, _mcBlendingLow: 2, _mcBlendingPrevious: 3, _mcBlendingNext: 4, _mcBlendingHigh: 5 } },
};
const O = (errId = "WORD", extra = []) => [["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"], ["CommandAborted", "BOOL", "out", "abort"],
    ["Error", "BOOL", "out", "err"], ["ErrorID", errId, "out", "errId"], ...extra];
const OV = (errId = "WORD", extra = []) => [["InVelocity", "BOOL", "out", "inVel"], ["Busy", "BOOL", "out", "busy"], ["CommandAborted", "BOOL", "out", "abort"],
    ["Error", "BOOL", "out", "err"], ["ErrorID", errId, "out", "errId"], ...extra];
const OA = (errId, v = false) => [[v ? "InVelocity" : "Done", "BOOL", "out", v ? "inVel" : "done"], ["Busy", "BOOL", "out", "busy"], ["Active", "BOOL", "out"],
    ["CommandAborted", "BOOL", "out", "abort"], ["Error", "BOOL", "out", "err"], ["ErrorID", errId, "out", "errId"]];
function axisArg(dia) { return ["Axis", AXIS_TYPE[dia], dia === "s15" || dia === "s12" ? "in" : "inout", "axis"]; }
/** Bloky MC podle dialektu (jména a typy parametrů podle manuálů — výběr). */
export function mcBlocks(dia) {
    const A = axisArg(dia);
    if (dia === "s15") {
        const L = "LREAL";
        return {
            MC_POWER: { kind: "power", members: [A, ["Enable", "BOOL", "in", "en"], ["StartMode", "DINT", "in"], ["StopMode", "INT", "in"],
                    ["Status", "BOOL", "out", "status"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", "WORD", "out", "errId"]] },
            MC_HOME: { kind: "home", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["Mode", "INT", "in"], ...O("WORD", [["ReferenceMarkPosition", L, "out"]])] },
            MC_MOVEABSOLUTE: { kind: "abs", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", "INT", "in"], ...O()] },
            MC_MOVERELATIVE: { kind: "rel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Distance", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...O()] },
            MC_MOVEVELOCITY: { kind: "vel", dir: { pos: [1], neg: [2] }, members: [A, ["Execute", "BOOL", "in", "exe"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", "INT", "in"], ["Current", "BOOL", "in"], ["PositionControlled", "BOOL", "in"], ...OV()] },
            MC_HALT: { kind: "halt", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["AbortAcceleration", "BOOL", "in"], ...O()] },
            MC_STOP: { kind: "stop", members: [A, ["Execute", "BOOL", "in", "exe"], ["Mode", "DINT", "in"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...O()] },
            MC_RESET: { kind: "reset", members: [A, ["Execute", "BOOL", "in", "exe"], ["Restart", "BOOL", "in"], ...O()] },
        };
    }
    if (dia === "s12") {
        const R = "REAL", EI = ["ErrorInfo", "WORD", "out"];
        return {
            MC_POWER: { kind: "power", members: [A, ["Enable", "BOOL", "in", "en"], ["StartMode", "INT", "in"], ["StopMode", "INT", "in"],
                    ["Status", "BOOL", "out", "status"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", "WORD", "out", "errId"], EI] },
            MC_HOME: { kind: "home", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", R, "in", "pos"], ["Mode", "INT", "in"], ...O("WORD", [EI, ["ReferenceMarkPosition", R, "out"]])] },
            MC_MOVEABSOLUTE: { kind: "abs", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", R, "in", "pos"], ["Velocity", R, "in", "vel"], ["Direction", "INT", "in"], ...O("WORD", [EI])] },
            MC_MOVERELATIVE: { kind: "rel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Distance", R, "in", "pos"], ["Velocity", R, "in", "vel"], ...O("WORD", [EI])] },
            MC_MOVEVELOCITY: { kind: "vel", dir: { pos: [1], neg: [2] }, members: [A, ["Execute", "BOOL", "in", "exe"], ["Velocity", R, "in", "vel"], ["Direction", "INT", "in"],
                    ["Current", "BOOL", "in"], ["PositionControlled", "BOOL", "in"], ...OV("WORD", [EI])] },
            MC_HALT: { kind: "halt", members: [A, ["Execute", "BOOL", "in", "exe"], ...O("WORD", [EI])] },
            MC_RESET: { kind: "reset", members: [A, ["Execute", "BOOL", "in", "exe"], ["Restart", "BOOL", "in"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"],
                    ["Error", "BOOL", "out", "err"], ["ErrorID", "WORD", "out", "errId"], EI] },
        };
    }
    if (dia === "tc") {
        const L = "LREAL", E = "UDINT";
        return {
            MC_POWER: { kind: "power", members: [A, ["Enable", "BOOL", "in", "en"], ["Enable_Positive", "BOOL", "in", "epos"], ["Enable_Negative", "BOOL", "in", "eneg"], ["Override", L, "in"],
                    ["Status", "BOOL", "out", "status"], ["Busy", "BOOL", "out", "busy"], ["Active", "BOOL", "out"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out", "errId"]] },
            MC_HOME: { kind: "home", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["HomingMode", "MC_HomingMode", "in"], ["bCalibrationCam", "BOOL", "in"], ...OA(E)] },
            MC_MOVEABSOLUTE: { kind: "abs", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...OA(E)] },
            MC_MOVERELATIVE: { kind: "rel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Distance", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...OA(E)] },
            MC_MOVEVELOCITY: { kind: "vel", dir: { pos: [1], neg: [3] }, members: [A, ["Execute", "BOOL", "in", "exe"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", "MC_Direction", "in"], ...OA(E, true)] },
            MC_HALT: { kind: "halt", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...OA(E)] },
            MC_STOP: { kind: "stop", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...OA(E)] },
            MC_RESET: { kind: "reset", members: [A, ["Execute", "BOOL", "in", "exe"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out", "errId"]] },
        };
    }
    if (dia === "sm3") {
        const L = "LREAL", E = "SMC_ERROR";
        return {
            MC_POWER: { kind: "power", members: [A, ["Enable", "BOOL", "in", "en"], ["bRegulatorOn", "BOOL", "in", "reg"], ["bDriveStart", "BOOL", "in", "drv"],
                    ["Status", "BOOL", "out", "status"], ["bRegulatorRealState", "BOOL", "out"], ["bDriveStartRealState", "BOOL", "out"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out"]] },
            MC_HOME: { kind: "home", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ...O(E).map(x => x[0] === "ErrorID" ? [x[0], x[1], x[2]] : x)] },
            MC_MOVEABSOLUTE: { kind: "abs", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", "MC_DIRECTION", "in"], ...noId(OA(E))] },
            MC_MOVERELATIVE: { kind: "rel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Distance", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...noId(OA(E))] },
            MC_MOVEVELOCITY: { kind: "vel", dir: { pos: [1], neg: [-1] }, members: [A, ["Execute", "BOOL", "in", "exe"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", "MC_DIRECTION", "in"], ...noId(OA(E, true))] },
            MC_HALT: { kind: "halt", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ...noId(O(E))] },
            MC_STOP: { kind: "stop", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"],
                    ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out"]] },
            MC_RESET: { kind: "reset", members: [A, ["Execute", "BOOL", "in", "exe"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out"]] },
        };
    }
    if (dia === "sml") {
        const L = "LREAL", E = "SML_ERROR";
        return {
            MC_POWER_SML: { kind: "power", members: [A, ["Enable", "BOOL", "in", "en"], ["bRegulatorOn", "BOOL", "in", "reg"], ["bDriveStart", "BOOL", "in", "drv"],
                    ["Status", "BOOL", "out", "status"], ["bRegulatorRealState", "BOOL", "out"], ["bDriveStartRealState", "BOOL", "out"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out"]] },
            MC_HOME_SML: { kind: "home", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ...noId(O(E))] },
            MC_MOVEABSOLUTE_SML: { kind: "abs", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"], ["Deceleration", L, "in", "dec"], ...noId(O(E))] },
            MC_MOVERELATIVE_SML: { kind: "rel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Distance", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"], ["Deceleration", L, "in", "dec"], ...noId(O(E))] },
            MC_MOVEVELOCITY_SML: { kind: "vel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"], ["Deceleration", L, "in", "dec"], ...noId(OV(E))] },
            MC_HALT_SML: { kind: "halt", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ...noId(O(E))] },
            MC_STOP_SML: { kind: "stop", members: [A, ["Execute", "BOOL", "in", "exe"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out"]] },
            MC_RESET_SML: { kind: "reset", members: [A, ["Execute", "BOOL", "in", "exe"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", E, "out"]] },
        };
    }
    if (dia === "om") {
        const L = "LREAL", D = "_eMC_DIRECTION", BM = "_eMC_BUFFER_MODE";
        return {
            MC_POWER: { kind: "power", members: [A, ["Enable", "BOOL", "in", "en"], ["Status", "BOOL", "out", "status"], ["Busy", "BOOL", "out", "busy"], ["Error", "BOOL", "out", "err"], ["ErrorID", "WORD", "out", "errId"]] },
            MC_HOME: { kind: "home", members: [A, ["Execute", "BOOL", "in", "exe"], ...O()] },
            MC_MOVEABSOLUTE: { kind: "abs", members: [A, ["Execute", "BOOL", "in", "exe"], ["Position", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", D, "in"], ["BufferMode", BM, "in"], ...OA("WORD")] },
            MC_MOVERELATIVE: { kind: "rel", members: [A, ["Execute", "BOOL", "in", "exe"], ["Distance", L, "in", "pos"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["BufferMode", BM, "in"], ...OA("WORD")] },
            MC_MOVEVELOCITY: { kind: "vel", dir: { pos: [0], neg: [2] }, members: [A, ["Execute", "BOOL", "in", "exe"], ["Velocity", L, "in", "vel"], ["Acceleration", L, "in", "acc"],
                    ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["Direction", D, "in"], ["Continuous", "BOOL", "in"], ["BufferMode", BM, "in"], ...OA("WORD", true)] },
            MC_STOP: { kind: "stop", members: [A, ["Execute", "BOOL", "in", "exe"], ["Deceleration", L, "in", "dec"], ["Jerk", L, "in"], ["BufferMode", BM, "in"], ...OA("WORD")] },
            MC_RESET: { kind: "reset", members: [A, ["Execute", "BOOL", "in", "exe"], ["Done", "BOOL", "out", "done"], ["Busy", "BOOL", "out", "busy"], ["Failure", "BOOL", "out"],
                    ["Error", "BOOL", "out", "err"], ["ErrorID", "WORD", "out", "errId"]] },
        };
    }
    return {};
}
/** ErrorID typu výčet (SMC_ERROR / SML_ERROR) — model do něj číslo nepíše. */
function noId(list) { return list.map(x => x[0] === "ErrorID" ? [x[0], x[1], x[2]] : x); }
/** Výklad dynamiky pro model (axis.ts `McPlat`). */
export function mcPlatOf(dia) {
    return dia === "lx" ? "sm3" : dia;
}
/** Instrukce pohybu Logix a počet operandů v ST (MOTION-RM002). */
export const LX_MOTION_INSTR = { MSO: 2, MSF: 2, MAFR: 2, MAH: 2, MAM: 20, MAJ: 17, MAS: 9 };
