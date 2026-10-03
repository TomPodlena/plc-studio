/**
 * AI nadstavba: generování KONCEPTŮ řešení.
 * Z hrubého zadání vzniknou 2–3 koncepční varianty (architektura řízení, pohony,
 * bezpečnostní a HMI koncept, odhad I/O, doporučené platformy, rizika, pracnost).
 * Vybraná varianta se ukládá do Project.concept, propisuje se do FDS a dokumentace
 * a slouží jako kontext pro následný AI návrh sestavy zařízení.
 *
 * Core definuje protokol (instrukce + normalizaci + render) — samotné volání AI
 * dělá aplikace (apps/web/src/ai.js, později backend).
 */
import { Project, PlatformKey } from "./model.js";
export interface ConceptIO {
    di: number;
    do: number;
    ai: number;
    ao: number;
}
export interface SolutionConcept {
    zadani: string;
    nazev: string;
    shrnuti: string;
    architektura: string;
    pohony: string;
    bezpecnost: string;
    hmi: string;
    odhadIO: ConceptIO;
    doporucenePlatformy: PlatformKey[];
    rizika: string[];
    pracnostMD: number;
}
export interface ConceptProposal {
    questions: string[];
    variants: SolutionConcept[];
    note: string;
}
/** Instrukce pro AI (vede konverzaci nad konceptem; app přikládá turns uživatele). */
export declare function conceptInstructions(prj: Project): string;
export declare function conceptNorm(r: unknown): ConceptProposal;
/** Markdown dokument „Koncept řešení“ (součást projektové dokumentace). Obsah polí je od AI
    v jazyce zadání (jako obsah projektu) — překládají se jen nadpisy a pevné věty. */
export declare function conceptMd(prj: Project): string;
