/**
 * PLCdesk — export pro CAD (`PLCdesk_CAD.json`, formát „plcdesk-cad“ verze 2).
 *
 * Verze 2 (2026-10-15) přidává k v1 (díly, sestava, svorky, vazby): GUID (řádky `parts[].guid` odvozené
 * z `Device.guid` / `Project.guid`, `deviceGuid`, kusy karet a hlav `instances` z `moduleGuids`, stanice),
 * `parts[].safety`, revizi PLCdesk se stavem schválení (`project.revision`) a ZADÁNÍ pro hrubý 3D koncept
 * (`brief` popis / takt / koncept, `devices` s parametry pro mechaniku, `sequence`, `safety` E-stop / blokování /
 * bezpečnostní funkce). Počítá se nad synchronizovanými I/O (`cadProject`), vstup se nemění.
 *
 * Datový most PLCdesk → FreeCAD (a FreeCAD PLM): co projekt ví o fyzických dílech — řádky kusovníku
 * (`buildBom`, stabilní `BomLine.id`), umístění (rozvaděč / stroj) a způsob montáže podle kategorie,
 * příslušnost k zařízení, sestava PLC (`hwLayout`: stanice, hlava, moduly v pořadí slotů), svorkovnice
 * (kanálové skupiny výkresů = `svorkyCSV`) a vazby mezi díly (jištění → spínání → motor, ventil → válec,
 * snímač → válec, výstupní modul PLC → akční člen). ŽÁDNÁ geometrie ani rozměry — patří k modelům dílů.
 *
 * Formát je závazný (C:\CLAUDE\plcdesk_freecad\MANIFEST_SCHEMA.md): každý klíč vždy (prázdné "" / null),
 * nové pole = verze 2. Výstup je deterministický (pořadí kusovníku, sestavy a zařízení). Manifest NENÍ
 * v `docFiles` ani `genFor` (golden beze změny) — klienti ho nabízejí tlačítkem v kroku Kusovník
 * a projektová složka ho ukládá do 09_Exporty/CAD (`projectBundle` s volbou `cad`).
 */
import type { Project, PlatformKey } from "./model.js";
import { type AxisCfg } from "./axis.js";
import type { SolutionConcept } from "./concept.js";
export declare const CAD_FORMAT = "plcdesk-cad";
export declare const CAD_VERSION = 2;
/** Jméno souboru manifestu (klienti přidají předponu čísla projektu jako u ostatních souborů). */
export declare const CAD_FILE = "PLCdesk_CAD.json";
export type CadLocation = "cabinet" | "field";
export type CadMount = "din" | "panel" | "rack" | "field" | "none";
/**
 * Kategorie kusovníku → umístění a montáž. JEDINÉ místo, kde se to určuje (test hlídá, že každá
 * kategorie katalogu `data/catalog/*.json`, `CAT_LABEL` i řádků od modulů bezpečnosti je zařazená).
 *   cabinet = v rozvaděči, field = na stroji;
 *   din = na DIN liště, panel = přišroubované na montážní desku / do výřezu dveří rozvaděče
 *   (měniče, servoměniče, hlavní vypínač, HMI), rack = PLC moduly v pořadí slotů (`plc.stations`),
 *   field = montáž na stroji, none = nemontuje se (skříň sama, kabely).
 * Ovládací prvky (tlačítka, signálky, E-stop) jsou na stroji / ovládacím pultu — dveře rozvaděče
 * formát verze 1 nerozlišuje.
 */
export declare const CAD_PLACEMENT: Record<string, {
    location: CadLocation;
    mount: CadMount;
}>;
export declare const cadPlacement: (cat: string) => {
    location: CadLocation;
    mount: CadMount;
};
export interface CadInstance {
    guid: string | null;
    station: number;
    slot: number;
}
export interface CadPart {
    id: string;
    tag: string;
    category: string;
    label: string;
    brand: string;
    type: string;
    orderCode: string;
    supplier: string;
    qty: number;
    location: CadLocation;
    mount: CadMount;
    device: string | null;
    station: number | null;
    slot: number | null;
    sourceUrl: string;
    /** stabilní identita řádku (odvozená, přežije přejmenování zařízení); null = projekt / zařízení bez GUID */
    guid: string | null;
    /** `Device.guid` zařízení řádku, jinak null */
    deviceGuid: string | null;
    /** bezpečnostní díl (`bomLineIsSafety`) */
    safety: boolean;
    /** fyzické kusy karet / hlav PLC (GUID z `moduleGuids`, stanice, slot); ostatní řádky [] */
    instances: CadInstance[];
}
export interface CadModule {
    slot: number;
    partId: string;
    guid: string | null;
    kind: string;
    channels: number;
}
export interface CadStation {
    index: number;
    guid: string | null;
    kind: "local" | "remote";
    head: string;
    modules: CadModule[];
}
export type CadRelationKind = "feeds" | "controls" | "actuates" | "senses";
export interface CadRelation {
    from: string;
    to: string;
    kind: CadRelationKind;
}
export interface CadRevision {
    id: string;
    date: string;
    by: string;
    hash: string;
    /** povinné položky schvalování platně schválené v okamžiku revize (null = revize bez záznamu) */
    approved: {
        valid: number;
        required: number;
    } | null;
    /** obsah projektu při exportu = obsah revize (false = rozpracováno po revizi) */
    current: boolean;
}
/** Zařízení projektu s parametry, které potřebuje konstrukce (zadání pro hrubý 3D koncept). */
export interface CadDevice {
    name: string;
    guid: string | null;
    cls: string;
    desc: string;
    role: string | null;
    unit: string;
    range: {
        min: number;
        max: number;
    } | null;
    limits: {
        lo: number | null;
        hi: number | null;
    } | null;
    setpoint: number | null;
    options: string[];
    rampS: number | null;
    tol: number | null;
    tolTimeS: number | null;
    selBits: number | null;
    records: Array<{
        no: number;
        name: string;
        pos: number | null;
        vel: number | null;
    }>;
    travelS: number | null;
    axis: (Omit<AxisCfg, "limNeg" | "limPos" | "drive"> & {
        limNeg: number | null;
        limPos: number | null;
        drive: string;
    }) | null;
    libType: string | null;
    signals: Array<{
        sig: string;
        dir: string;
        tag: string;
    }>;
    parts: string[];
}
export interface CadStep {
    no: number;
    device: string | null;
    deviceGuid: string | null;
    act: string;
    cond: string;
    timeS: number;
    sp: number | null;
    rev: boolean | null;
    rec: number | null;
    pos: number | null;
    posRef: string | null;
    vel: number | null;
    acc: number | null;
    dec: number | null;
    title: string;
}
export interface CadDevRef {
    device: string;
    guid: string | null;
}
export interface CadSafetyFunction {
    id: string;
    ref: string;
    kind: string;
    title: string;
    off: boolean;
    plr: string | null;
    pl: string | null;
    category: string | null;
    stopCategory: number;
    inputs: string[];
    actuators: string[];
    safeState: string;
    missing: string[];
}
export interface CadManifest {
    format: string;
    version: number;
    generator: string;
    project: {
        guid: string;
        name: string;
        number: string;
        customer: string;
        revision: CadRevision | null;
    };
    platform: PlatformKey;
    brief: {
        desc: string;
        takt: number | null;
        startDate: string;
        modes: boolean;
        platforms: PlatformKey[];
        concept: SolutionConcept | null;
    };
    devices: CadDevice[];
    sequence: CadStep[];
    safety: {
        estop: CadDevRef | null;
        interlocks: CadDevRef[];
        functions: CadSafetyFunction[] | null;
    };
    parts: CadPart[];
    plc: {
        stations: CadStation[];
    };
    terminals: Array<{
        strip: string;
        count: number;
    }>;
    relations: CadRelation[];
}
/**
 * Pracovní kopie projektu pro export: I/O synchronizované se zařízeními (`syncIO` — příklady a starší
 * projekty ukládají `io: []`, bez nich by manifest neměl I/O karty, svorky ani vazby „controls“).
 * Vstupní projekt se NEMĚNÍ (kopie zařízení, I/O, GUID modulů a značky adres; ostatní se jen čte).
 * GUID, které kopie při synchronizaci případně vytvoří, export nepoužije — čte jen GUID vstupu.
 */
export declare function cadProject(prj: Project): Project;
/**
 * Manifest pro CAD z projektu. `opts.generator` přepíše text generátoru (výchozí „PLCdesk <verze>“).
 * Popisy dílů (`label`) a titulky kroků jsou v aktuálním jazyce (`setLang`), obsah projektu se nepřekládá.
 * Počítá se nad `cadProject(prj)` (synchronizovaná I/O); vstupní projekt se nemění.
 */
export declare function cadManifest(prj0: Project, opts?: {
    generator?: string;
}): CadManifest;
/** Manifest jako text JSON (odsazení 2 mezery, konec řádku na konci). */
export declare function cadManifestJson(prj: Project, opts?: {
    generator?: string;
}): string;
