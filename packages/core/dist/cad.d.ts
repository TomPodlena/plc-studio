/**
 * PLCdesk — export pro CAD (`PLCdesk_CAD.json`, formát „plcdesk-cad“ verze 1).
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
export declare const CAD_FORMAT = "plcdesk-cad";
export declare const CAD_VERSION = 1;
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
}
export interface CadModule {
    slot: number;
    partId: string;
    kind: string;
    channels: number;
}
export interface CadStation {
    index: number;
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
export interface CadManifest {
    format: string;
    version: number;
    generator: string;
    project: {
        guid: string;
        name: string;
        number: string;
        customer: string;
    };
    platform: PlatformKey;
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
 * Manifest pro CAD z projektu. `opts.generator` přepíše text generátoru (výchozí „PLCdesk <verze>“).
 * Popisy dílů (`label`) jsou v aktuálním jazyce (`setLang`), obsah projektu se nepřekládá.
 */
export declare function cadManifest(prj: Project, opts?: {
    generator?: string;
}): CadManifest;
/** Manifest jako text JSON (odsazení 2 mezery, konec řádku na konci). */
export declare function cadManifestJson(prj: Project, opts?: {
    generator?: string;
}): string;
