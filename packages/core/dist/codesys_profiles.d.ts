import type { PlatformInfo } from "./model.js";
export type CdsProfileKey = "turck" | "festo" | "abb" | "rexroth" | "inovance" | "weidmueller" | "eaton" | "lenze" | "berghof" | "hitachi";
export interface CdsProfile {
    /** název výrobce (hlavička generovaného kódu „… - <name> *)“, nadpisy) */
    name: string;
    /** IDE a jeho báze */
    ide: string;
    /** řady CPU */
    cpu: string;
    /** verze CODESYS, na které IDE / runtime stojí (README, CLAUDE.md) */
    cdsVer: string;
    /** styl kódu OOP (ABSTRACT / PROPERTY / INTERFACE) — jen CODESYS V3.5 SP13 a novější */
    oop: boolean;
    /** I/O v GVL_IO s pevnou adresou AT (notace CODESYS); false = bez AT, kanály se přiřadí v I/O mapování */
    at: boolean;
    /** surový rozsah analogu (plný rozsah modulu z katalogu) */
    rawMax: number;
    /** modul, ke kterému `rawMax` patří (README); "" = neověřeno → výrazná poznámka TODO */
    rawMod: string;
    /** servoosa: "sm3" = CODESYS SoftMotion (AXIS_REF_SM3), null = nepodporováno (`axisWhy`) */
    axis: "sm3" | null;
    /** proč osa ne (klíč překladu) */
    axisWhy?: string;
    /** emulátor: popis dialektu */
    emu: string;
    /** export HMI: produkt (CODESYS Visualization) */
    hmi: string;
    /** README — nadpis (název produktu se nepřekládá) */
    title: string;
    /** README — příkaz importu PLCopen XML v IDE (technický text menu, nepřekládá se) */
    imp: string;
    /** README — založení projektu (klíč překladu) */
    setup: string;
    /** README — I/O (klíč překladu) */
    io: string;
    /** README — knihovny výrobce / poznámky (klíč překladu) */
    libs?: string;
    /** README — test (klíč překladu) */
    test: string;
    /** starší CODESYS než ověřený SP21 (PLCopen XML ověřit při prvním importu) */
    old?: boolean;
}
export declare const CDS_PROFILES: Record<CdsProfileKey, CdsProfile>;
export declare const CDS_PROFILE_KEYS: CdsProfileKey[];
/** Profil CODESYS platformy (jen nové profily z této tabulky; WAGO / Delta mají vlastní kód). */
export declare function cdsProfile(plat: string): CdsProfile | undefined;
/** Položky `PLAT` profilů (model.ts). */
export declare const CDS_PROFILE_PLAT: Record<CdsProfileKey, PlatformInfo>;
