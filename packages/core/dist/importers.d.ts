/**
 * PLCdesk — reverse engineering: import existujících projektů.
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
/** Uzel minimálního XML stromu (bez DOMParseru — jádro běží i v Node bez závislostí). */
export interface XmlNode {
    name: string;
    attrs: Record<string, string>;
    children: XmlNode[];
    text: string;
    pos: number;
}
export declare function xmlDecode(s: string): string;
/**
 * Tolerantní XML parser: elementy, atributy, text a CDATA (text = přímý obsah uzlu).
 * Neuzavřené / přebývající značky nevadí. Vrací umělý kořen `#document`.
 */
export declare function parseXml(src: string): XmlNode;
/** Všichni potomci se jménem `name` (bez ohledu na předponu jmenného prostoru). */
export declare function xmlAll(n: XmlNode, name: string, out?: XmlNode[]): XmlNode[];
/** První přímý potomek se jménem `name`. */
export declare function xmlChild(n: XmlNode | undefined, name: string): XmlNode | undefined;
/** Text uzlu včetně potomků. */
export declare function xmlText(n: XmlNode | undefined): string;
/** Rozdělí řádek CSV/TSV (uvozovky, zdvojené uvozovky uvnitř). */
export declare function splitDelimited(line: string, delim: string): string[];
/** Nejpravděpodobnější oddělovač tabulky (tabulátor, středník, čárka). */
export declare function guessDelimiter(text: string): string;
/**
 * Adresa I/O v notaci platformy → kanonická adresa v Siemens notaci (inverze `addrFor`).
 * Siemens %I/%Q/%IW (i německé %E/%A, bez %, PIW), CODESYS %IX/%QX a %IW = index slova,
 * Mitsubishi X/Y (osmičkově jako FX5, hexadecimálně, když jsou v čísle číslice 8–F).
 * Nepřevoditelné (symbolické, %I*, Rockwell Local:…) = "".
 */
export declare function canonAddr(raw: string, plat?: string): string;
/** Je to adresa vnitřní paměti / DB (ne fyzické I/O)? */
export declare function isMemAddr(raw: string): boolean;
export declare function parseSimaticML(t: string): ParseResult;
export declare function parseL5X(t: string): ParseResult;
export declare function parseSTSource(t: string): ParseResult;
export declare function parseRockwellCSV(t: string): ParseResult;
export declare function parseLabelTable(t: string): ParseResult;
export declare function parsePlainIO(t: string): ParseResult;
/** Seskupí importované tagy do zařízení a namapuje role signálů. */
export declare function buildDevicesFromTags(tags: ImportedTag[]): BuiltDesign;
export {};
