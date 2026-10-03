export declare const SAFETY_DATA_DATE = "2026-10-03";
/** Graf rizik ISO 13849-1 příl. A: „S2F2P2“ → PLr. */
export declare const SAFETY_PLR_TABLE: Record<string, "a" | "b" | "c" | "d" | "e">;
export declare const SAFETY_PLR_SOURCES: string[];
/** Parametry grafu rizik (popisky jsou klíče překladu). */
export declare const SAFETY_RISK_PARAMS: Record<string, string>;
export declare const SAFETY_F2_MIN_INTERVENTIONS_PER_HOUR = 4;
export declare const SAFETY_PL_PFH: Array<{
    pl: string;
    min: number;
    max: number;
}>;
/** Kategorie ISO 13849-1: struktura a nejvyšší PL (popisy = klíče překladu). */
export declare const SAFETY_CATEGORIES: Array<{
    cat: string;
    structure: string;
    maxPl: string;
    dcavg: string;
    ccf: string;
}>;
export declare const SAFETY_MTTFD_CLASSES: {
    cls: string;
    min: number;
    max: number;
}[];
export declare const SAFETY_MTTFD_CAP: {
    def: number;
    cat4: number;
};
export declare const SAFETY_DC_CLASSES: {
    cls: string;
    min: number;
    max: number;
}[];
/** Zjednodušené určení PL (sloupcový graf, ISO 13849-1:2015 tab. 6): null = nepřípustná kombinace. */
export declare const SAFETY_SIMPLE_PL: Array<{
    cat: string;
    dc: string;
    low: string | null;
    medium: string | null;
    high: string | null;
}>;
export declare const SAFETY_SIMPLE_PL_SOURCES: string[];
export declare const SAFETY_CCF_MIN = 65;
/** Opatření proti CCF (body); splnění potvrzuje uživatel. */
export declare const SAFETY_CCF_MEASURES: Array<{
    id: string;
    label: string;
    points: number;
}>;
export declare const SAFETY_CCF_SOURCES: string[];
export declare const SAFETY_NOP_DEFAULTS: {
    dop: number;
    hop: number;
    missionYears: number;
};
export declare const SAFETY_B10D_SOURCES: string[];
/** Typické hodnoty komponent (ISO 13849-1 tab. C.1) — použijí se, dokud uživatel nezadá hodnotu z datasheetu. */
export declare const SAFETY_GENERIC: Record<string, {
    label: string;
    b10d?: number;
    mttfd?: number;
}>;
export declare const SAFETY_GENERIC_SOURCES: string[];
/** Kategorie zastavení IEC 60204-1 (definice = klíče překladu) a funkce pohonu IEC 61800-5-2. */
export declare const SAFETY_STOP_CATEGORIES: Array<{
    cat: number;
    text: string;
    drive: string;
}>;
export declare const SAFETY_STOP_SOURCES: string[];
export interface SafetyCatalogTest {
    name: string;
    kind: string;
    procedure: string;
    expected: string;
    sources: string[];
}
export interface SafetyCatalogFn {
    name: string;
    category: string;
    hazards: string[];
    trigger: string;
    reaction: string;
    stopCats: number[];
    drive: string[];
    reset: string;
    typicalPlr: string;
    typicalArch: string;
    channels: string;
    edm: string;
    components: string[];
    tests: SafetyCatalogTest[];
    standards: string[];
    sources: string[];
}
/** Katalog typických bezpečnostních funkcí (functions.json) — klíč = id funkce v rešerši. */
export declare const SAFETY_FN_CATALOG: Record<string, SafetyCatalogFn>;
export declare const SAFETY_FN_SOURCES: string[];
/** ISO 13855: zdroje k jednotlivým případům (vzorce viz `safetyDistance`). */
export declare const SAFETY_ISO13855_SOURCES: Record<string, string[]>;
/** Lisy (EN 692/693): přídavek C podle rozlišení d (C-norma má přednost). */
export declare const SAFETY_PRESS_C: Array<{
    dMax: number;
    C: number;
    strokeByEspe: boolean;
}>;
export declare const SAFETY_MULTIBEAM_HEIGHTS: Record<string, number[]>;
/** Rozpory ve zdrojích (téma a řešení = klíče překladu) — do dokumentu 13. */
export declare const SAFETY_DISCREPANCIES: Array<{
    area: string;
    topic: string;
    resolution: string;
    sources: string[];
}>;
/** Mapování bezpečnostních funkcí na bloky platforem (safety_plc.json, „neověřeno“ = nedohledáno). */
export declare const SAFETY_BLOCK_MAP: Record<string, Record<string, string>>;
export declare const SAFETY_BLOCK_MAP_SOURCES: string[];
export interface SafetyBlockPin {
    name: string;
    type: string;
    meaning: string;
}
export interface SafetyBlockDef {
    name: string;
    purpose: string;
    inputs: SafetyBlockPin[];
    outputs: SafetyBlockPin[];
    notes: string;
    sources: string[];
}
/** Instrukce siemens (safety_plc.json); význam pinů a poznámky jen u Siemens (předpis volání). */
export declare const SAFETY_BLOCKS_SIEMENS: SafetyBlockDef[];
/** Instrukce rockwell (safety_plc.json); význam pinů a poznámky jen u Siemens (předpis volání). */
export declare const SAFETY_BLOCKS_ROCKWELL: SafetyBlockDef[];
/** PLCopen Safety FB (Part 1 v2.x): rozhraní. */
export declare const SAFETY_BLOCKS_PLCOPEN: SafetyBlockDef[];
/** Co jde reálně vygenerovat textově, po platformách (safety_plc.json → text_generation). */
export declare const SAFETY_TEXTGEN: Record<string, {
    feasible: string;
    how: string;
    limits: string;
    sources: string[];
}>;
export declare const SAFETY_PLC_SOURCES: Record<string, string[]>;
export interface SafetyComponentData {
    id: string;
    cat: string;
    brand: string;
    series: string;
    orderCode: string;
    type: string;
    plMax: string | null;
    plText: string;
    catMax: string;
    b10dText: string;
    pfhdText: string;
    mttfdText: string;
    sources: string[];
    verified: boolean;
}
/** Bezpečnostní komponenty (components.json): hodnoty B10d / PFHd je nutné potvrdit podle datasheetu varianty. */
export declare const SAFETY_COMPONENTS: SafetyComponentData[];
