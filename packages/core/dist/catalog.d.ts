import type { PlatformKey } from "./model.js";
export declare const CATALOG_DATE = "2026-10-02";
/**
 * Hardwarová data položky PLC (sestava hardware.ts) — z rešerše se zdrojem (`src` položky, `hwSrc`).
 *   I/O modul:  ch (kanály podle směru), bus (rack / sběrnice, do které se zasouvá), pts (body FX5), sig
 *   CPU:        builtin (vestavěné I/O), builtinSig, slots (sběrnice → max. modulů v lokálním racku),
 *               maxPts (FX5: body I/O celkem), remote (sběrnice vzdálených stanic), family (AML)
 *   hlava:      head (sběrnice modulů stanice), slots, net (síť ke CPU), family, acc (příslušenství stanice)
 */
export interface CatalogHw {
    ch?: Partial<Record<"DI" | "DO" | "AI" | "AO", number>>;
    bus?: string;
    /** modul zabírá místo i v dalším limitu racku (FX5: inteligentní modul i mezi 12 moduly vpravo; Delta: analog i mezi 32) */
    also?: string;
    pts?: number;
    sig?: Partial<Record<"DI" | "DO" | "AI" | "AO", string>>;
    builtin?: Partial<Record<"DI" | "DO" | "AI" | "AO", number>>;
    builtinSig?: Partial<Record<"DI" | "DO" | "AI" | "AO", string>>;
    slots?: Record<string, number>;
    maxPts?: number;
    remote?: string;
    head?: string;
    net?: string;
    family?: string;
    acc?: string[];
    /** URL zdroje hardwarových údajů (manuál výrobce), pokud je jiný než `src` */
    hwSrc?: string;
}
export interface CatalogBrand {
    brand: string;
    series: string[];
    /** typický konkrétní typ pro malý stroj */
    typical?: string;
    orderCode?: string;
    /** URL, kde byl typ / kód ověřen */
    src?: string;
    priceLevel?: "nízká" | "střední" | "vysoká";
    suppliers: string[];
    note?: string;
    /** hardwarová data pro sestavu (moduly, CPU, hlavy vzdálených I/O) */
    hw?: CatalogHw;
}
/** Identifikace volby z katalogu (značka + kód / řada) — hodnota v `prj.bom.brand` / `lines[].brand`. */
export declare function brandOptId(b: CatalogBrand): string;
export interface CatalogCategory {
    /** český klíč překladu */
    label: string;
    unit: string;
    brands: CatalogBrand[];
}
export interface Supplier {
    name: string;
    url?: string;
    country?: string;
    kind?: string;
    cats: string[];
    note?: string;
}
/** Kategorie kusovníku (pořadí = pořadí skupin v kusovníku). PLC moduly mají klíč `<kat>@<platforma>`. */
export declare const CAT_LABEL: Record<string, string>;
/** Značky po kategoriích — z rešerše `data/catalog/*.json` (`scripts/build_catalog.py`), viz `CATALOG_DATE`. */
export declare const CATALOG: Record<string, CatalogBrand[]>;
export declare const SUPPLIERS: Supplier[];
/** Kategorie modulu PLC pro platformu (`plc_di@siemens`), jinak obecná kategorie. */
export declare function catKey(cat: string, plat?: PlatformKey): string;
export declare function brandsFor(cat: string, plat?: PlatformKey): CatalogBrand[];
export declare function suppliersFor(cat: string): Supplier[];
