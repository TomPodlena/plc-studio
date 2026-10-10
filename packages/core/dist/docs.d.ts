/**
 * PLCdesk — generování projektové dokumentace
 * (FDS, I/O list, svorkovnice, alarmy, FAT, návod, SW dokumentace, přehled).
 *
 * Texty jdou přes `tr()` po přirozených jednotkách (nadpis, odstavec, odrážka, řádek
 * hlavičky tabulky, věta v buňce); struktura Markdownu / CSV zůstává mimo klíče.
 */
import { Project } from "./model.js";
import { type ApprovalItem } from "./approval.js";
/**
 * FDS: servoosy (fáze 2b) — obálka FB_Axis, platformy, povely kroků, poruchy, ruční ovládání a co se
 * nastavuje v IDE. Bez os prázdné (dokumentace beze změny).
 */
export declare function axisFdsLines(prj: Project): string[];
/**
 * FDS: pohony a proporcionální prvky fáze 2a — co blok dělá, jaké hlášení čeká, kdy vyhlásí poruchu
 * (kódy errCode) a co se nastavuje v pohonu. Bez těchto zařízení prázdné (dokumentace beze změny).
 */
export declare function motionFdsLines(prj: Project): string[];
/** Názvy souborů se nepřekládají; záložka a popis jsou klíče překladu (překlad v `docFiles`). */
export declare const DOC_META: Array<[path: string, tab: string, title: string]>;
export declare function docIndexMd(prj: Project): string;
export declare function docFDSMd(prj: Project): string;
export declare function docIOcsv(prj: Project): string;
export declare function svorkyCSV(prj: Project): string;
/** Řádek seznamu alarmů (`04_seznam_alarmu.csv`); HMI z něj bere kódy a texty (hmi.ts `alarmRows`). */
export interface AlarmRow {
    code: string;
    dev: string;
    alarm: string;
    cause: string;
    reaction: string;
    ack: string;
}
/** Seznam alarmů jako CSV (středník) — buňky jednořádkově (`lineSafe`), jinak text beze změny. */
export declare function docAlarmCsv(prj: Project): string;
/**
 * Řádky seznamu alarmů (kód, zařízení, alarm, příčina, reakce, kvitace) — jediný zdroj pro CSV dokumentace
 * i alarmy HMI. HMI dřív četlo zpět text CSV a víceřádkový popis blokovacího vstupu ho rozbil
 * („HMI: alarm … nemá spouštěcí tag“, test odolnosti 2026-10-08) — teď na tvaru textů nezávisí.
 */
export declare function docAlarmRows(prj: Project): AlarmRow[];
export declare function docFATMd(prj: Project): string;
export declare function docManualMd(prj: Project): string;
export declare function docSWMd(prj: Project): string;
export interface DocFile {
    path: string;
    tab: string;
    title: string;
    body: string;
}
export declare function docFiles(prj0: Project, items?: ApprovalItem[]): DocFile[];
/**
 * Další moduly (bezpečnostní funkce…) přidávají dokumenty (`docs`) a soubory sady projektu
 * (`files`: schémata, programy) bez zásahu do tohoto souboru. Stejné `name` nahradí dřívější
 * zdroj; vrací funkci pro odhlášení.
 */
export interface DocProvider {
    docs?: (prj: Project, items: ApprovalItem[]) => DocFile[];
    files?: (prj: Project, items: ApprovalItem[]) => ProjectFile[];
    /** řádky Markdownu pod nadpis každého dokumentu .md (např. revize); prázdný text = nic */
    header?: (prj: Project) => string;
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
    /** Druh souboru pro projektovou složku (`projectFileFolder`, project_folder.ts): „kod/<platforma>“,
     *  „kod/safety“, „vykresy“, „hmi“, „hmi/<platforma>“, „bezpecnost“, „eplan“, „kusovnik“,
     *  „dokumentace“ (dokumenty se pak třídí podle jména); bez něj podle jména, jinak 01_Dokumentace. */
    dir?: string;
}
/** Úplná sada souborů projektu: dokumenty + schémata (SVG/DXF) + zdroje platforem. */
export declare function allProjectFiles(prj: Project): ProjectFile[];
