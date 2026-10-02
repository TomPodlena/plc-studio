/**
 * PLC Studio — generování projektové dokumentace
 * (FDS, I/O list, svorkovnice, alarmy, FAT, návod, SW dokumentace, přehled).
 *
 * Texty jdou přes `tr()` po přirozených jednotkách (nadpis, odstavec, odrážka, řádek
 * hlavičky tabulky, věta v buňce); struktura Markdownu / CSV zůstává mimo klíče.
 */
import { Project } from "./model.js";
/** Názvy souborů se nepřekládají; záložka a popis jsou klíče překladu (překlad v `docFiles`). */
export declare const DOC_META: Array<[path: string, tab: string, title: string]>;
export declare function docIndexMd(prj: Project): string;
export declare function docFDSMd(prj: Project): string;
export declare function docIOcsv(prj: Project): string;
export declare function svorkyCSV(prj: Project): string;
export declare function docAlarmCsv(prj: Project): string;
export declare function docFATMd(prj: Project): string;
export declare function docManualMd(prj: Project): string;
export declare function docSWMd(prj: Project): string;
export interface DocFile {
    path: string;
    tab: string;
    title: string;
    body: string;
}
export declare function docFiles(prj: Project): DocFile[];
export interface ProjectFile {
    group: string;
    name: string;
    save: string;
    body: string;
    kind: "text" | "svg" | "dxf";
    prev?: string;
}
/** Úplná sada souborů projektu: dokumenty + schémata (SVG/DXF) + zdroje platforem. */
export declare function allProjectFiles(prj: Project): ProjectFile[];
