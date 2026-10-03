/**
 * PLCdesk — generování projektové dokumentace
 * (FDS, I/O list, svorkovnice, alarmy, FAT, návod, SW dokumentace, přehled).
 *
 * Texty jdou přes `tr()` po přirozených jednotkách (nadpis, odstavec, odrážka, řádek
 * hlavičky tabulky, věta v buňce); struktura Markdownu / CSV zůstává mimo klíče.
 */
import { Project } from "./model.js";
import { type ApprovalItem } from "./approval.js";
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
export declare function docFiles(prj: Project, items?: ApprovalItem[]): DocFile[];
/**
 * Další moduly (bezpečnostní funkce…) přidávají dokumenty (`docs`) a soubory sady projektu
 * (`files`: schémata, programy) bez zásahu do tohoto souboru. Stejné `name` nahradí dřívější
 * zdroj; vrací funkci pro odhlášení.
 */
export interface DocProvider {
    docs?: (prj: Project, items: ApprovalItem[]) => DocFile[];
    files?: (prj: Project, items: ApprovalItem[]) => ProjectFile[];
}
export declare function registerDocProvider(name: string, p: DocProvider): () => void;
/** Dokument konceptu řešení — číslo za pevnou sadou 00–09. */
export declare const CONCEPT_FILE = "10_koncept_reseni.md";
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
