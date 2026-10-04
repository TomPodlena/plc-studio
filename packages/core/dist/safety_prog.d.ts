/**
 * PLCdesk — bezpečnostní program z certifikovaných bloků (jen pro SCHVÁLENÉ bezpečnostní funkce).
 *
 * Bez schválení funkcí (safety:hazards, safety:SFn, safety:SFn:design) se program negeneruje —
 * místo něj vznikne dokument „čeká na schválení“. Po schválení funkcí vznikne návrh programu,
 * který nese výrazně NESCHVÁLENO, dokud odpovědná osoba neschválí položku safety:program.
 *
 * Co se generuje (viz safety_plc.json → text_generation):
 *   - Rockwell GuardLogix: L5X safety programu (RLL: DCS, DCSTL, THRSe, DCSRT, CROUT, TON) pro
 *     import do safety tasku — podpis safety tasku vzniká až v Logix Designeru,
 *   - Siemens: předpis volání F-bloků (ESTOP1, SFDOOR, EV1oo2DI, TWO_H_EN, FDBACK, ACK_GL) jako
 *     dokument — textový import F-LAD/F-FBD (Openness / Source Documents) není ověřený,
 *   - PLCopen Safety (CODESYS Safety, Omron NX-SL, Beckhoff TwinSAFE): dokument s bloky SF_*,
 *   - Pilz PNOZmulti, SICK Flexi Soft, Schmersal PSC1, bezpečnostní relé: konfigurační předpis.
 * Nic z toho není ověřeno překladem v cílovém IDE a nenahrazuje validaci na stroji.
 */
import { Project } from "./model.js";
import { type SafetyProposal, type SafetyFunction, type SafetyTarget, type OutGroup } from "./safety.js";
import { type LxSafetyRung, type LxSafetyTag } from "./logix.js";
/** Funkce, které mají blok v bezpečnostním programu (aktivní, ne mechanický princip). */
export declare function programFunctions(p: SafetyProposal): SafetyFunction[];
/** Skupina výstupů a funkce, které ji uvolňují (AND). */
export interface SpOutput {
    g: OutGroup;
    enables: string[];
    ss1Ms: number;
}
export declare function programOutputs(prj: Project, p: SafetyProposal): SpOutput[];
/** Struktura programu bez textů — otisk položky safety:program. */
export declare function programStructure(prj: Project, p: SafetyProposal): unknown;
export interface SafetyProgramFiles {
    /** „pending“ = funkce neschválené, program se negeneruje; „draft“ = NESCHVÁLENO; „approved“. */
    state: "pending" | "draft" | "approved";
    target: SafetyTarget;
    files: Record<string, string>;
}
/** Dokument „čeká na schválení“ (bez programu). */
export declare function pendingDoc(prj: Project, p?: SafetyProposal): string;
export declare function rockwellSafety(prj: Project, p: SafetyProposal, state: "draft" | "approved"): {
    l5x: string;
    rungs: LxSafetyRung[];
    tags: LxSafetyTag[];
};
/** Soubory bezpečnostního programu pro cíl (výchozí podle logiky / `Project.safety.target`). */
export declare function safetyProgramFiles(prj: Project, target?: SafetyTarget): SafetyProgramFiles;
