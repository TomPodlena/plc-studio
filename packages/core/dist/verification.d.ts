import type { PlatformKey } from "./model.js";
export type VerifState = "verified" | "lang" | "beta" | "unsupported";
/** Stav jednoho výstupního souboru: ide = import a překlad v IDE, compiler = překladač, xsd = schéma,
 *  structure = kontrola struktury (emulátor), emulator = jen emulátor PLCdesk. */
export type VerifFormatState = "ide" | "compiler" | "xsd" | "structure" | "emulator";
export type VerifScope = "classic" | "oop" | "motion" | "axis" | "plcopen" | "iec61131-10";
export interface VerifFormat {
    file: string;
    state: VerifFormatState;
    note?: string;
}
export interface PlatformVerification {
    state: VerifState;
    /** IDE / překladač a verze, ve které ověřeno (technický text); null = jen emulátor */
    ide: string | null;
    /** datum ověření RRRR-MM-DD */
    date: string;
    scope: VerifScope[];
    /** co a jak ověřeno (klíč překladu) */
    summary: string;
    /** co neověřeno (klíč překladu) */
    notVerified: string;
    /** protokoly v repozitáři (cesty od kořene) */
    evidence: string[];
    formats: VerifFormat[];
}
export declare const VERIFICATION: Record<PlatformKey, PlatformVerification>;
/** Krátký štítek stavu (čip v aplikaci, web). */
export declare const VERIF_STATE_LABEL: Record<VerifState, string>;
/** Význam stavu jednou větou (bublina). */
export declare const VERIF_STATE_HINT: Record<VerifState, string>;
export declare const VERIF_FORMAT_LABEL: Record<VerifFormatState, string>;
export declare const VERIF_SCOPE_LABEL: Record<VerifScope, string>;
/** Záznam ověření platformy (bez překladu). */
export declare function verificationOf(plat: PlatformKey): PlatformVerification;
/** Nejnovější datum ověření ze všech platforem (web: „Stav k“). */
export declare function verificationLatest(): string;
/** Ověření platformy s texty v nastaveném jazyce (UI: čip a bublina). */
export interface VerifInfo {
    state: VerifState;
    label: string;
    hint: string;
    ide: string | null;
    date: string;
    scope: string[];
    summary: string;
    notVerified: string;
    formats: {
        file: string;
        state: VerifFormatState;
        label: string;
        note: string;
    }[];
    /** text bubliny: význam stavu, co ověřeno, kde a kdy, co neověřeno */
    tip: string;
}
export declare function verificationInfo(plat: PlatformKey): VerifInfo;
/**
 * Štítek ověření do README platformy (`genFor`): stav, co ověřeno, kde a kdy, co neověřeno a stav
 * jednotlivých výstupů. Generuje se jednotně pro všechny platformy — ručně psané věty o ověření
 * v README nepatří.
 */
export declare function verificationReadme(plat: PlatformKey): string;
