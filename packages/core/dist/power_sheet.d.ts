/**
 * PLCdesk — silové schéma a schéma rozvodu napájení 24 V DC (návrh).
 * Stejná geometrie jako ostatní výkresy (ops → SVG + DXF R12, popisové pole `titleBlock`).
 * Nic se nevymýšlí: označení a typy přebírá z kusovníku (`buildBom`, IEC 81346), sestavu PLC ze
 * `hwLayout`; proudy, průřezy a nastavení jističů zadání neobsahuje → „doplní projektant“.
 * Texty výkresu jdou přes `trx` (latinka — totéž se píše do DXF).
 */
import { Project } from "./model.js";
import { BomLine } from "./bom.js";
import { SheetOps, SheetMeta } from "./drawing.js";
export interface PowerSheet {
    kind: "power" | "supply";
    /** základ jména souboru bez přípony: `silove_schema_1`, `rozvod_napajeni_1` */
    base: string;
    title: string;
    svg: string;
    dxf: string;
}
/** Kategorie kusovníku, které tvoří silový vývod zařízení (podle označení -Q / -K / -TA / -M). */
declare const FEED_ORDER: readonly ["Q", "K", "TA", "M"];
type FeedKind = typeof FEED_ORDER[number];
interface Feeder {
    devId: number;
    name: string;
    parts: Partial<Record<FeedKind, BomLine>>;
}
export declare function powerSheetOps(prj: Project, page: number, total: number, feeders: Feeder[], bom: BomLine[], first: boolean, meta?: SheetMeta): SheetOps;
interface Branch {
    title: string;
    sub: string;
    lines: string[];
    marker?: boolean;
}
export declare function supplySheetOps(prj: Project, page: number, total: number, branches: Branch[], bom: BomLine[], meta?: SheetMeta): SheetOps;
/** Listy silového schématu a rozvodu napájení (prázdné pole, když projekt nemá co kreslit). */
export declare function powerSheets(prj: Project, meta?: SheetMeta): PowerSheet[];
export {};
