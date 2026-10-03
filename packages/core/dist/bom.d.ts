import { PlatformKey, Project } from "./model.js";
import { CatalogBrand } from "./catalog.js";
export interface BomLine {
    /** stabilní klíč řádku: označení + kategorie (pro volby uživatele a pro CAD v PRO) */
    id: string;
    pos: number;
    /** označení dle IEC 81346, např. -M1, -Q1, -A1 */
    tag: string;
    cat: string;
    qty: number;
    unit: string;
    /** co položka je (přeložený název kategorie) */
    item: string;
    /** k čemu slouží (popis zařízení) */
    desc: string;
    devId?: number;
    brand: string;
    type: string;
    orderCode: string;
    supplier: string;
    note: string;
    /** položka podle posouzení rizik — jen HW, zapojení a volba k revizi */
    safety?: boolean;
    /** vybraná volba katalogu (`brandOptId`), prázdné = vlastní / bez katalogu */
    optId: string;
    /** URL, kde byl typ ověřen */
    src: string;
    /** uživatel nastavil množství 0 — řádek zůstává v přehledu, do CSV / dokumentu nejde */
    excluded?: boolean;
}
export interface Bom {
    plat: PlatformKey;
    lines: BomLine[];
}
/** Identifikace volby z katalogu (značka + kód / řada) — hodnota v `prj.bom.brand` / `lines[].brand`. */
export declare function brandOptId(b: CatalogBrand): string;
/** Nabídka katalogu pro řádek kusovníku (kategorie + platforma). */
export declare function bomOptions(cat: string, plat: PlatformKey): Array<{
    id: string;
    brand: CatalogBrand;
}>;
/** Výchozí platforma kusovníku: volba v `prj.bom`, jinak první zvolená platforma. */
export declare function bomPlatform(prj: Project): PlatformKey;
/** Sestaví kusovník. Výsledek je deterministický (stejný projekt → stejné řádky). */
export declare function buildBom(prj: Project): Bom;
/** CSV pro Excel (středník, UTF-8 s BOM — česká lokalizace Excelu). */
export declare function bomCsv(prj: Project): string;
/** Kusovník do dokumentace (Markdown). */
export declare function bomMd(prj: Project): string;
