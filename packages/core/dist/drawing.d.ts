/**
 * PLCdesk — výkresy: jedna geometrie (ops) renderovaná do SVG (náhled)
 * i DXF R12 (EPLAN / AutoCAD / LibreCAD).
 * Konvence: rámeček s mřížkovými referencemi, popisové pole, značení -M1
 * (IEC 81346), čísla vodičů -W<svorkovnice><svorka> (`wireNo`), NC/NO kontakty (IEC 60617).
 */
import { Project, IoModule } from "./model.js";
/** `io` = klíč signálu, ke kterému prvek patří (interaktivní náhledy; DXF ho ignoruje). */
type Ref = {
    io?: string;
};
export type Op = ({
    t: "l";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    k: string;
} & Ref) | ({
    t: "c";
    cx: number;
    cy: number;
    r: number;
} & Ref) | ({
    t: "r";
    x: number;
    y: number;
    w: number;
    h: number;
    k: string;
} & Ref) | ({
    t: "t";
    x: number;
    y: number;
    s: string;
    size: number;
    anchor: string;
    k: string;
} & Ref);
export interface SheetOps {
    W: number;
    H: number;
    O: Op[];
}
/** `rev` = označení revize do popisového pole (jinak z `setSheetRevision`, výchozí „0.1“). */
export interface SheetMeta {
    projectName: string;
    date: string;
    rev?: string;
}
export declare function setSheetRevision(fn: ((prj: Project) => string | undefined) | null): void;
export declare function sheetOps(prj: Project, mod: IoModule, xnum: number, page: number, total: number, meta?: SheetMeta): SheetOps;
/** Render ops do SVG; barvy přes CSS proměnné stránky (téma). */
export declare function opsToSVG(sh: SheetOps, label: string): string;
/** Render ops do DXF R12 (ENTITIES only; texty bez diakritiky kvůli kódovým stránkám CAD). */
export declare function opsToDXF(sh: SheetOps): string;
export declare function sheetSVG(prj: Project, mod: IoModule, xnum: number, page?: number, total?: number, meta?: SheetMeta): string;
export declare function sheetDXF(prj: Project, mod: IoModule, xnum: number, page?: number, total?: number, meta?: SheetMeta): string;
/**
 * Výkres bezpečnostního okruhu (návrh): vstupní prvky bezpečnostních funkcí vlevo, bezpečnostní
 * logika uprostřed, výstupní skupiny (stykače s EDM, STO, ventily) vpravo. Texty dodává volající
 * už přeložené přes `trx` (latinka — stejná geometrie jde do DXF). Odkazy `io` = tag signálu.
 */
export interface CircuitSheet {
    title: string;
    projectName: string;
    date?: string;
    logic: string;
    note: string;
    inputs: Array<{
        sf: string;
        dev: string;
        label: string;
        tags: string[];
        kind: "nc2" | "ossd" | "twohand" | "single";
    }>;
    outputs: Array<{
        id: string;
        label: string;
        tags: string[];
        fbk: string[];
        kind: "contactors" | "sto" | "valve" | "other";
    }>;
    reset: string | null;
    /** Označení revize do popisového pole (výchozí „0.1“). */
    rev?: string;
}
export declare function circuitSheetOps(s: CircuitSheet): SheetOps;
export declare function circuitSheetSVG(s: CircuitSheet): string;
export declare function circuitSheetDXF(s: CircuitSheet): string;
export declare function svgBlock(prj: Project, mods: IoModule[]): string;
export {};
