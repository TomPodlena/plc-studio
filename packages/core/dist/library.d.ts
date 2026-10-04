import { Device, DeviceClass, DoRole, PlatformKey, Project } from "./model.js";
export declare const LIBRARY_FORMAT = "plcdesk-library";
/** Verze formátu souboru; novější soubor starší aplikace odmítne (error), starší se převede. */
export declare const LIBRARY_SCHEMA = 1;
export type FbClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut";
export declare const FB_CLASSES: FbClass[];
/** Dialekt šablony: SCL (Siemens TIA) nebo IEC ST (ostatní platformy). */
export type FbDialect = "scl" | "st";
export interface LibBomPart {
    /** kategorie kusovníku (`CAT_LABEL`), např. `motor`, `contactor` */
    cat: string;
    qty?: number;
    brand?: string;
    type?: string;
    orderCode?: string;
    note?: string;
    /** předpona označení dílu (např. `-Q`); prázdné = označení zařízení (`-M1`) */
    tagPrefix?: string;
}
export interface LibDeviceType {
    /** identifikátor typu (ASCII, unikátní bez ohledu na velikost písmen) */
    id: string;
    label: string;
    cls: DeviceClass;
    /** předpona označení nových zařízení (jinak podle třídy: M, Y, B…) */
    prefix?: string;
    desc?: string;
    /** volby třídy (`CLS[cls].opts`): fbk, fault, fbkOpen, fbkClosed */
    opt?: Record<string, boolean>;
    unit?: string;
    rmin?: number;
    rmax?: number;
    limHi?: number;
    limLo?: number;
    setpoint?: number;
    role?: DoRole;
    /** výchozí hlídací čas kroku s tímto zařízením [s] */
    stepTimeS?: number;
    bom?: LibBomPart[];
}
export interface LibFbTemplate {
    id: string;
    cls: FbClass;
    dialect: FbDialect;
    /** jen pro tyto platformy (prázdné = všechny platformy dialektu) */
    platforms?: PlatformKey[];
    /** zdrojový text bloku; jméno bloku musí být vestavěné (FB_Motor…) */
    source: string;
    note?: string;
}
export interface LibCompany {
    name: string;
    /** textové logo do hlavičky (výkresy DXF bez diakritiky) */
    logoText?: string;
    address?: string;
    /** schvalovatelé — nabídka jmen pro schvalování (approval.ts) */
    approvers?: Array<{
        name: string;
        role?: string;
    }>;
    /** další řádky hlavičky generovaného kódu (copyright, kontakt) */
    codeHeader?: string[];
}
export interface LibPlatformDefaults {
    platforms?: PlatformKey[];
    bomPlat?: PlatformKey;
    /** výchozí značka po kategoriích kusovníku (jako `prj.bom.brand`) */
    brand?: Record<string, string>;
    sim?: {
        motorDelay?: number;
        valveTravel?: number;
    };
}
export interface CompanyLibrary {
    format: typeof LIBRARY_FORMAT;
    schema: number;
    name: string;
    /** verze obsahu knihovny (semver, zvyšuje firma) */
    version: string;
    updated?: string;
    company?: LibCompany;
    deviceTypes?: LibDeviceType[];
    fbTemplates?: LibFbTemplate[];
    platformDefaults?: LibPlatformDefaults;
}
export interface LibraryIssue {
    level: "error" | "warn";
    where: string;
    msg: string;
}
export declare function blankLibrary(name?: string): CompanyLibrary;
export interface FbPort {
    name: string;
    type: string;
}
export interface FbInterface {
    name: string;
    inputs: FbPort[];
    outputs: FbPort[];
    inouts: FbPort[];
}
/** Jméno a rozhraní bloku z textu SCL / ST (komentáře se ignorují). */
export declare function fbInterface(src: string): FbInterface;
/** Vestavěná šablona třídy v dialektu (vzor pro vlastní blok). */
export declare function builtinTemplate(cls: FbClass, dialect: FbDialect): string;
/** Dialekt šablon pro platformu. */
export declare function dialectFor(plat: PlatformKey): FbDialect;
/** Kontrola jedné šablony FB proti vestavěné (rozhraní, jméno, párování bloků, ASCII). */
export declare function validateFbTemplate(t: LibFbTemplate): LibraryIssue[];
/** Kontrola celé knihovny; `error` = knihovnu (nebo položku) nelze použít. */
export declare function validateLibrary(lib: CompanyLibrary): LibraryIssue[];
/** Knihovna jako JSON k uložení (stabilní pořadí klíčů, razítko formátu a data). */
export declare function exportLibrary(lib: CompanyLibrary, updated?: string): string;
/** Načte knihovnu ze souboru; `lib` je null, když nejde použít (viz `issues`). */
export declare function importLibrary(text: string): {
    lib: CompanyLibrary | null;
    issues: LibraryIssue[];
};
/** Knihovna projektu (kopie v `prj.library`). */
export declare function projectLibrary(prj: Project): CompanyLibrary | null;
/**
 * Připojí knihovnu k projektu (kopie). `defaults` = převzít výchozí platformy, značky
 * kusovníku a časy modelu stroje — jen tam, kde projekt ještě nic nezvolil.
 */
export declare function attachLibrary(prj: Project, lib: CompanyLibrary, defaults?: boolean): void;
export declare function libDeviceType(prj: Project, id: string | undefined): LibDeviceType | undefined;
/**
 * Přidá do projektu zařízení podle typu z knihovny: třída, popis, volby, rozsah, meze, role;
 * synchronizuje I/O a zapíše značku / typ / kód dílů do voleb kusovníku (bez přepsání voleb
 * uživatele). Vrací nové zařízení; `name` = vlastní označení (jinak předpona + číslo).
 */
export declare function addLibraryDevice(prj: Project, typeId: string, name?: string): Device;
/** Výchozí hlídací čas kroku pro zařízení (z typu knihovny), jinak `fallback`. */
export declare function libStepTime(prj: Project, devId: number, fallback: number): number;
export interface LibraryOverrides {
    /** text šablony místo vestavěné (`SCL_MOTOR` / `ST_MOTOR`…), jen bez chyb validace */
    templates: Partial<Record<FbClass, string>>;
    /** řádky firemní hlavičky (bez značek komentáře; ASCII a bezpečné pro (* *) u ST) */
    header: string[];
    /** šablony vynechané pro chyby a upozornění */
    issues: LibraryIssue[];
}
/**
 * Co má generátor pro platformu převzít z knihovny projektu. Šablona přesně pro platformu má
 * přednost před šablonou dialektu pro všechny platformy; šablona s chybou se nepoužije.
 * Napojení v `genFor` / `genLibrary` viz README úkolu (codegen.ts se zde nemění).
 */
export declare function libraryOverrides(prj: Project, plat: PlatformKey): LibraryOverrides;
/** Firemní hlavička do dokumentů (Markdown) — název firmy, adresa, schvalovatelé. */
export declare function libraryDocHeader(prj: Project): string;
/** Jména schvalovatelů z knihovny (nabídka v dialogu schválení). */
export declare function libraryApprovers(prj: Project): string[];
/** Popisky pro UI (české klíče). */
export declare const LIBRARY_LABEL: {
    deviceTypes: string;
    fbTemplates: string;
    company: string;
    platformDefaults: string;
};
