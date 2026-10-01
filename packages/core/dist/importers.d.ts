/**
 * PLC Studio — reverse engineering: import existujících projektů.
 * Parsery exportů (SimaticML, L5X, GVL/ST, CSV/tab tabulky, prostý I/O list)
 * a rekonstrukce zařízení + I/O z tagů.
 *
 * Pozn.: XML parsery potřebují DOMParser (prohlížeč). V Node je lze použít
 * s polyfillem (např. linkedom) předaným přes setDOMParser().
 */
import { Device, IoEntry, Dir } from "./model.js";
export interface ImportedTag {
    tag: string;
    dt: string;
    addr: string;
    cmt: string;
    dev?: string;
    cls?: string;
    _dir?: Dir;
}
export interface ParseResult {
    fmt: string;
    tags: ImportedTag[];
    blocks: string[];
}
export interface BuiltDesign {
    devices: Device[];
    io: IoEntry[];
    nextId: number;
}
type DomParserCtor = new () => {
    parseFromString(s: string, t: string): any;
};
export declare function setDOMParser(ctor: DomParserCtor): void;
export declare function detectAndParse(text: string): ParseResult;
export declare function normAddr(a: string): string;
export declare function guessDir(name: string, dt: string, addr: string): Dir;
export declare function parseSimaticML(t: string): ParseResult;
export declare function parseL5X(t: string): ParseResult;
export declare function parseSTSource(t: string): ParseResult;
export declare function parseRockwellCSV(t: string): ParseResult;
export declare function parseLabelTable(t: string): ParseResult;
export declare function parsePlainIO(t: string): ParseResult;
/** Seskupí importované tagy do zařízení a namapuje role signálů. */
export declare function buildDevicesFromTags(tags: ImportedTag[]): BuiltDesign;
export {};
