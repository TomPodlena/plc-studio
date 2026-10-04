/**
 * PLCdesk — emulátor běhu: přeložený KÓD platformy (compile.ts) běží scan po scanu
 * v lockstepu se simulátorem návrhu (sim.ts). Model stroje je simulátorův — vstupy, které
 * v daném scanu čte program návrhu (vrstva `io` po zásazích `SimControls`), dostane i kód;
 * po scanu se porovnají výstupy, krok sekvence, porucha stroje a stavy bloků. První rozdíl
 * ve scénáři = nález „kód se chová jinak než návrh" (dál by vstupy už neodpovídaly kódu).
 *
 * Scénáře jsou tytéž jako ve verifyProject (běžný cyklus, výpadky hlášení, poruchy, E-stop,
 * blokování, kvitace, celá matice stavů) + druhý cyklus a ruční režim. Zásahy navazují
 * z kontrolního bodu běžného cyklu; úseky, kde se stav nemění (jen běží časovače), se
 * přeskočí najednou — výsledek je shodný s krokováním scan po scanu.
 */
import type { Project, PlatformKey } from "../model.js";
import { type SimOptions } from "../sim.js";
import { type Compiled } from "./compile.js";
import type { EmuFinding } from "./types.js";
export interface EmuRunOptions {
    /** full = všechny scénáře ověření vč. matice stavů (výchozí); quick = běžný cyklus, poruchy, E-stop, kvitace. */
    scope?: "full" | "quick";
    /** Perioda scanu (výchozí jako simulace, 10 ms). */
    dt?: number;
    /** Krokovat každý scan a provést kód vždy (bez přeskočení klidu a bez vynechání scanů beze změny) — referenční běh. */
    noSkip?: boolean;
    /** Ladění: hlášení přeskočení klidu. */
    trace?: (msg: string) => void;
}
export interface EmuDiff {
    platform: PlatformKey;
    scenario: string;
    label: string;
    /** Čas simulace [s]. */
    t: number;
    signal: string;
    design: number;
    code: number;
    msg: string;
}
export interface EmuScenarioResult {
    id: string;
    label: string;
    ok: boolean;
    /** Stav návrhu na konci scénáře (cykly, doba prvního cyklu, krok, porucha, čas) — kontrola přeskočení klidu. */
    end?: string;
}
export interface EmuRunResult {
    platform: PlatformKey;
    scenarios: EmuScenarioResult[];
    diffs: EmuDiff[];
    ok: boolean;
    /** Proč běh neproběhl (kód se nepřeložil). */
    skipped?: string;
    runtime?: EmuFinding[];
    ms: number;
    /** Počet scanů kódu (po přeskočení klidových úseků). */
    scans: number;
    /** Počet scanů, které pokrylo přeskočení klidu. */
    skippedScans?: number;
    /** Scany kódu vynechané, protože se vstupy ani stav kódu nezměnily (souhrn platforem). */
    lazyScans?: number;
}
export interface Sc {
    id: string;
    label: string;
    opts: SimOptions;
}
/**
 * Scénáře ověření — tytéž jako verifyProject: simScenarios (běžný cyklus, výpadky hlášení,
 * poruchy motorů, E-stop, blokování, kvitace), druhý cyklus a matice stavů (klid, ruční
 * režim, každý krok × E-stop / blokování / vypnutí AUTO ve třech okamžicích, zamrzlé
 * hlášení, porucha a ztráta hlášení pohonu, ztráta polohy ventilu, analog mimo mez).
 * Matice se tu jen SESTAVÍ (stejná pravidla jako stateMatrix v sim.ts, shodu hlídá test),
 * návrh se nevyhodnocuje — emulátor porovnává kód s návrhem přímo, scan po scanu.
 */
export declare function emuScenarios(prj: Project, scope: "full" | "quick", base?: SimOptions): Sc[];
export declare function runPlatforms(prj: Project, list: Array<{
    plat: PlatformKey;
    prog: Compiled;
    rawMax?: number;
}>, opts?: EmuRunOptions): Partial<Record<PlatformKey, EmuRunResult>>;
