import { PlatformKey } from "./model.js";
/** Verze PLCdesk (shodná s packages/core/package.json a apps/desktop/plc_studio/__init__.py — hlídá test). */
export declare const PLCDESK_VERSION = "0.2.0";
/** Formát manifestu balíku (zvýšit při nekompatibilní změně). */
export declare const VERIFY_PACK_SCHEMA = 1;
export interface VerifyPackOptions {
    /** verze aplikace (výchozí `PLCDESK_VERSION`) */
    version?: string;
    /** commit zdrojů, pokud je znám (desktop z gitu) */
    commit?: string | null;
    /** okamžik vytvoření (výchozí teď) */
    now?: Date | number;
}
export interface VerifyPackSample {
    /** složka v balíku (technické jméno, ASCII) */
    dir: string;
    /** odkud vzor je (vestavěná ukázka / soubor samples/) */
    source: string;
    devices: number;
    steps: number;
    /** styly kódu ve složce: classic (kořen složky), oop (podsložka oop/) */
    styles: Array<"classic" | "oop">;
    /** kód se negeneruje (servoosa na platformě bez podpory) — jen README s důvodem */
    blocked: boolean;
}
/** Název ZIP balíku. */
export declare function verifyPackName(plat: PlatformKey, version?: string): string;
/**
 * Soubory balíku k ověření platformy `plat`: NAVOD.md, PROTOKOL.md, složky vzorů s výstupy `genFor`
 * a MANIFEST.json (poslední; nese otisky SHA-256 všech ostatních souborů). Texty v nastaveném jazyce.
 */
export declare function verifyPackFiles(plat: PlatformKey, opts?: VerifyPackOptions): Promise<Record<string, string | Uint8Array>>;
/** ZIP balíku (bez komprese); soubory v kořenové složce pojmenované podle balíku. */
export declare function verifyPackZip(files: Record<string, string | Uint8Array>, root?: string): Uint8Array;
/** Celý balík jako ZIP: název souboru a bajty (web i desktop). */
export declare function verifyPackArchive(plat: PlatformKey, opts?: VerifyPackOptions): Promise<{
    name: string;
    bytes: Uint8Array;
    files: string[];
}>;
