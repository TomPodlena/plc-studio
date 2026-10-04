/**
 * Referenční (golden) výstupy generátoru — hlídač refaktoringu „beze změny výstupu".
 *
 * Pro každý projekt (příklady `samples/*.plcstudio.json` + `sampleSmall` + `sampleComplex`)
 * × 5 jazyků se vygenerují všechny soubory programu pro 8 platforem (`genFor`: zdroje, tagy,
 * L5X, Unitronics, PLCopen XML, README) a dokumentace (`docFiles`). Uloží se jen otisk
 * (SHA-256) a velikost každého souboru v `packages/core/test-data/golden/<projekt>.json`;
 * test `golden.test.ts` je porovná. Přegenerování (jen při VĚDOMÉ změně výstupu, se
 * zdůvodněním v commitu): `node scripts/golden.mjs --write`.
 *
 * Modul není součástí veřejného API (`index.ts` ho neexportuje) — používá ho skript a test.
 * Hash dodává volající (node:crypto), jádro tak zůstává bez závislostí na Node.
 */
import "./index.js";
import { Project, PlatformKey } from "./model.js";
import { type Lang } from "./i18n.js";
/** Otisk jednoho souboru. */
export interface GoldenEntry {
    sha256: string;
    size: number;
}
/** Otisky projektu: jazyk → cesta souboru (`code/<platforma>/<soubor>`, `docs/<soubor>`) → otisk. */
export type GoldenSet = Record<string, Record<string, GoldenEntry>>;
/** Pevný okamžik pro výstupy s datem (dokumentace, PLCopen XML): 2026-01-15 12:00 UTC. */
export declare const GOLDEN_TIME: number;
export declare const GOLDEN_PLATFORMS: PlatformKey[];
export declare const GOLDEN_LANGS: Lang[];
/** Vestavěné ukázky — vznikají v právě nastaveném jazyce, proto se tvoří pro každý jazyk znovu. */
export declare const GOLDEN_BUILTIN: Record<string, () => Project>;
/** Projekt z uloženého souboru (formát desktopu / exportu webu), se všemi platformami. */
export declare function goldenProject(raw: unknown): Project;
/**
 * Provede `fn` s pevným časem (`new Date()` / `Date.now()` = `GOLDEN_TIME`) a časovým pásmem UTC.
 * Výstup se tím nemění — jen se v testu odstraní závislost na dni a hodině běhu.
 */
export declare function withFixedClock<T>(fn: () => T): T;
/** Všechny sledované soubory projektu v jazyce `lang` (nastaví jazyk; volat uvnitř `withFixedClock`). */
export declare function goldenFiles(make: () => Project, lang: Lang, docs?: boolean): Record<string, string>;
export interface GoldenOptions {
    /** pro které jazyky generovat i dokumentaci (výchozí: všechny) */
    docs?: (lang: Lang) => boolean;
    /** plné výstupy (výpis pro diff) */
    onFiles?: (lang: Lang, files: Record<string, string>) => void;
}
/** Otisky souborů všech jazyků. `hash` = SHA-256 v hex (dodá volající). */
export declare function goldenSet(make: () => Project, hash: (s: string) => string, opts?: GoldenOptions): GoldenSet;
/**
 * Rozdíly dvou sad otisků (chybějící, přebývající a změněné soubory) jako čitelné řádky.
 * Když `got` v některém jazyce neobsahuje dokumentaci (vynechaná volbou `docs`), porovná
 * se v tom jazyce jen kód.
 */
export declare function goldenDiff(want: GoldenSet, got: GoldenSet): string[];
