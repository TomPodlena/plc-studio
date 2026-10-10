/**
 * PLCdesk — export bezpečnostních funkcí do SISTEMA (IFA / DGUV).
 *
 * Výpočet PL v jádře (safety.ts) je zjednodušený (sloupcový graf ISO 13849-1, bez PFHd) —
 * export proto slouží ke KONTROLE v SISTEMA, kde se PL a PFHd spočítá Markovovým modelem IFA.
 *
 *   sistemaModel(prj)   mezivrstva: funkce → subsystémy → kanály → bloky se všemi hodnotami
 *                       (B10d, nop, MTTFd, DC, CCF, kategorie, PLr) a označením dle IEC 81346
 *                       shodným s kusovníkem a výkresem bezpečnostního okruhu
 *   sistemaSsm(prj)     projektový soubor SISTEMA (*.ssm) — XML vrstvy tiOPF 2.1, tabulky
 *                       projectops / sfops / componentops / channelops / blocops / elementops /
 *                       dcmeasureops / ccfmeasureops / libmetadata ve struktuře SISTEMA 2.0.8
 *                       (ISO 13849-1:2015); SISTEMA 3.x má čtečku formátu 2.x (VisitorsXML_SSM2) a nabízí převod
 *                       na ISO 13849-1:2023 — otevření v SISTEMA zatím neověřeno
 *   sistemaCsv(prj)     předpis pro ruční zadání (řádek = blok / subsystém), kdyby import selhal
 *   sistemaMd(prj)      dokument 19_sistema.md: postup, předpis krok za krokem, porovnání PL
 *                       PLCdesk × SISTEMA (sloupce k vyplnění z protokolu SISTEMA)
 *
 * Struktura .ssm je převzatá z veřejných příkladů IFA (IFA Report 2/2017e, příklady SISTEMA)
 * a ověřená proti schématu `ssm_21.xsd`, které SISTEMA instaluje (validace XML = jen hrubá
 * kontrola struktury). Kategorie, podmínky kategorie a PL (CATReq / PLReq) se v SISTEMA
 * potvrzují ručně — export je záměrně nevyplňuje. Stav: viz `SISTEMA_VERIFIED`.
 */
import { Project } from "./model.js";
import { type ApprovalItem } from "./approval.js";
import { type SafetyProposal, type OutGroup, type PL, type SafetyCat } from "./safety.js";
export declare const SISTEMA_FILE = "19_sistema.md";
/** Formát projektu, který export píše (SISTEMA 2.x; SISTEMA 3.x převádí při otevření). */
export declare const SISTEMA_SSM_VERSION = "2.0.8";
export declare const SISTEMA_NORM = "ISO 13849-1:2015, ISO 13849-2:2012";
/**
 * Stav ověření importem. Aktualizovat po zkoušce v SISTEMA (verze, datum, výsledek) —
 * text jde do dokumentu i README.
 */
export declare const SISTEMA_VERIFIED: string;
export declare const SISTEMA_SOURCES: string[];
export type SistemaTech = "tecElectromechanic" | "tecElectronic" | "tecHydraulic" | "tecMechanic" | "tecPneumatic" | "tecOther" | "tecUnknown";
export type SistemaFnType = "fncInput" | "fncLogic" | "fncOutput";
export interface SistemaBlock {
    name: string;
    /** Označení dle IEC 81346 (shodné s kusovníkem / výkresem). */
    dt: string;
    tech: SistemaTech;
    /** „b10d“ = MTTFd z B10d a nop (SISTEMA počítá sama), „mttfd“ = zadaná MTTFd, „missing“ = chybí data. */
    mode: "b10d" | "mttfd" | "missing";
    b10d: number | null;
    nop: number | null;
    mttfd: number | null;
    /** DC bloku [%]. */
    dc: number;
    note: string;
}
export interface SistemaChannel {
    type: "ch1" | "ch2" | "chTest";
    blocks: SistemaBlock[];
}
export interface SistemaSubsystem {
    role: "I" | "L" | "O";
    fnType: SistemaFnType;
    name: string;
    dt: string;
    /** Kategorie subsystému (u přístroje s PL kategorie návrhu funkce). */
    cat: SafetyCat | null;
    /** „blocks“ = výpočet z bloků v SISTEMA, „device“ = PL a PFHd přístroje (údaj výrobce), „missing“ = bez dat. */
    mode: "blocks" | "device" | "missing";
    /** PL podle PLCdesk (zjednodušený výpočet / údaj přístroje). */
    pl: PL | null;
    /** PFHd přístroje [1/h]; `pfhAssumed` = zástupná hodnota (horní mez pásma PL), doplnit z datasheetu. */
    pfh: number | null;
    pfhAssumed: boolean;
    /** MTTFd kanálu a DC podle PLCdesk (pro porovnání). */
    mttfd: number | null;
    dc: number;
    ccf: {
        ids: string[];
        points: number;
    } | null;
    channels: SistemaChannel[];
    notes: string[];
}
export interface SistemaFunction {
    id: string;
    ref: string;
    name: string;
    title: string;
    plr: PL | null;
    pl: PL | null;
    ok: boolean;
    S: "S1" | "S2";
    F: "F1" | "F2";
    P: "P1" | "P2";
    plrDoc: string;
    reaction: string;
    safeState: string;
    trigger: string;
    subs: SistemaSubsystem[];
}
export interface SistemaModel {
    project: string;
    date: string;
    missionYears: number;
    dop: number;
    hop: number;
    fns: SistemaFunction[];
    /** Funkce bez výpočtu PL (pojistný ventil apod.) — do SISTEMA nejdou. */
    skipped: Array<{
        id: string;
        title: string;
        why: string;
    }>;
    approved: boolean;
    logic: string;
}
/** Označení výstupní skupiny (kusovník: -KS1/-KS2, -YS1, -YH1/-YH2, měnič a brzda = označení pohonu). */
export declare function sistemaGroupDts(g: OutGroup): string[];
/** PFHd z textu katalogu („2,31E-09 1/h“). */
export declare function sistemaParsePfh(t: string | undefined): number | null;
/** Model exportu do SISTEMA z návrhu bezpečnostních funkcí. */
export declare function sistemaModel(prj0: Project, p?: SafetyProposal, items?: ApprovalItem[]): SistemaModel;
/** Číslo ve zvyklosti SISTEMA: desetinná čárka, malé hodnoty exponentem („1,5E-8“). */
export declare function sistemaNum(x: number): string;
export declare function sistemaCcfMid(id: string): string;
/** Projektový soubor SISTEMA (*.ssm). */
export declare function sistemaSsm(prj: Project, m?: SistemaModel): string;
/** Předpis pro ruční zadání v SISTEMA: řádek = subsystém nebo blok (středník, UTF-8 s BOM). */
export declare function sistemaCsv(prj: Project, m?: SistemaModel): string;
/** Bezpečný název souboru projektu (ASCII). */
export declare function sistemaFileName(prj: Project): string;
/** Dokument 19_sistema.md: postup importu, předpis krok za krokem a porovnání PL. */
export declare function sistemaMd(prj: Project, items?: ApprovalItem[], m?: SistemaModel): string;
/** Úplný export: soubory pro SISTEMA (název → obsah). */
export declare function sistemaExport(prj: Project): {
    files: Record<string, string>;
    model: SistemaModel;
    verified: string;
};
/** Přihlásí export do sady projektu (dokument 19 + soubory) — samostatně, bez celého modulu. */
export declare function registerSistemaExport(): () => void;
