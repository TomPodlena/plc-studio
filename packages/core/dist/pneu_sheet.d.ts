/**
 * PLCdesk — pneumatické schéma (ISO 1219-1, návrh). Stejná geometrie jako ostatní výkresy (ops → SVG + DXF R12).
 * Nic se nevymýšlí: úprava vzduchu, lištu, rozváděče, válce a snímače přebírá z kusovníku (`buildBom`);
 * typ funkce ventilu, tlak, světlost hadic a přiřazení portů 2 / 4 zadání neobsahuje → „doplní projektant“.
 * Rozváděč se kreslí jako 5/2 monostabilní jen tehdy, když to nese typ / popis / poznámka řádku kusovníku.
 * Vazba rozváděč → válec = tatáž jako `actuates` v cad.ts (díly téhož zařízení: `valve_solenoid` → `cylinder`).
 */
import { Project } from "./model.js";
import { BomLine } from "./bom.js";
import { SheetOps, SheetMeta } from "./drawing.js";
export interface PneuSheet {
    kind: "pneu";
    base: string;
    title: string;
    svg: string;
    dxf: string;
}
interface Circuit {
    devId: number;
    name: string;
    valve: BomLine;
    cyl?: BomLine;
    sw: BomLine[];
}
/** Rozváděč nese údaj 5/2 monostabilní (cívka + pružina)? Jinak se funkce nedomýšlí. */
export declare function valveIs52Mono(l: BomLine): boolean;
export declare function pneuCircuits(prj: Project, lines: BomLine[]): Circuit[];
export declare function pneuSheetOps(prj: Project, page: number, total: number, cs: Circuit[], lines: BomLine[], first: boolean, meta?: SheetMeta): SheetOps;
/** Listy pneumatického schématu (prázdné pole, když kusovník nemá žádný rozváděč `valve_solenoid`). */
export declare function pneuSheets(prj: Project, meta?: SheetMeta): PneuSheet[];
export {};
