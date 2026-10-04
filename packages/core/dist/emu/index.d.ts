/**
 * PLCdesk — EMULÁTORY PŘEKLADU A BĚHU pro 8 platforem.
 *
 * `emulateCompile` ověří SKUTEČNÝ vygenerovaný kód (výstup genFor: SCL, ST, L5X, plochý ST
 * UniLogic) parserem IEC 61131-3 a dialektovými pravidly platformy; `emulateRun` přeložený
 * kód spustí scan po scanu proti modelu stroje simulátoru a porovná jeho chování s návrhem
 * (Simulator) ve stejných scénářích jako verifyProject.
 *
 * Emulátor NENÍ překladač výrobce: pravidla jsou podle manuálů a zpráv ověření, reálný import
 * v IDE (TIA, CODESYS, Studio 5000, GX Works3, Sysmac, UniLogic, Machine Expert) je dál nutný.
 */
import type { Project, PlatformKey } from "../model.js";
import type { EmuFinding } from "./types.js";
import { Compiled } from "./compile.js";
import { EmuRunResult, EmuRunOptions } from "./run.js";
export type { EmuFinding } from "./types.js";
export type { EmuRunResult, EmuRunOptions, EmuDiff, EmuScenarioResult } from "./run.js";
export { DIALECTS as EMU_DIALECTS, RULES as EMU_RULES, SRC as EMU_SRC } from "./dialects.js";
export { emuScenarios } from "./run.js";
export interface EmuCompileResult {
    platform: PlatformKey;
    /** Soubory, které emulátor ověřoval (výstup genFor). */
    files: string[];
    findings: EmuFinding[];
    /** Žádný nález úrovně error. */
    ok: boolean;
}
/** Přeloží soubory jedné platformy (bez cache) — pro testy a vlastní soubory. */
export declare function emulateFiles(prj: Project, platform: PlatformKey, files: Record<string, string>): {
    res: EmuCompileResult;
    prog?: Compiled;
};
/** Emulace překladu vygenerovaného kódu jedné platformy. */
export declare function emulateCompile(prj: Project, platform: PlatformKey, lang?: string): EmuCompileResult;
/** Emulace běhu: přeložený kód scan po scanu proti modelu stroje, porovnání s návrhem. */
export declare function emulateRun(prj: Project, platform: PlatformKey, opts?: EmuRunOptions): EmuRunResult;
/** Běh více platforem v jednom průchodu (sdílený simulátor návrhu). */
export declare function emulateRunMany(prj: Project, platforms: PlatformKey[], opts?: EmuRunOptions): Partial<Record<PlatformKey, EmuRunResult>>;
/** Běh kódu ze zadaných souborů (testy, vlastní úpravy kódu) — bez cache. */
export declare function emulateRunFiles(prj: Project, platform: PlatformKey, files: Record<string, string>, opts?: EmuRunOptions): EmuRunResult;
export interface EmuAllResult {
    compile: Partial<Record<PlatformKey, EmuCompileResult>>;
    run: Partial<Record<PlatformKey, EmuRunResult>>;
    ok: boolean;
    ms: number;
}
/** Překlad i běh všech platforem projektu (výchozí: všech 8). */
export declare function emulateAll(prj: Project, opts?: EmuRunOptions & {
    platforms?: PlatformKey[];
}): EmuAllResult;
export { emuDocMd, EMU_DOC_FILE, registerEmuModule, unregisterEmuModule, emuModuleRegistered } from "./doc.js";
