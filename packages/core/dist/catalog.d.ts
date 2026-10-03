import type { PlatformKey } from "./model.js";
export declare const CATALOG_DATE = "2026-10-02";
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
}
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
