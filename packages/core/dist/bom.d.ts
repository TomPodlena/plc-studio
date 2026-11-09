import { Device, PlatformKey, Project } from "./model.js";
import { CatalogBrand, brandOptId } from "./catalog.js";
export { brandOptId };
export interface BomLine {
    /** stabilní klíč řádku: označení + kategorie (pro volby uživatele a pro CAD v PRO) */
    id: string;
    pos: number;
    /** označení dle IEC 81346, např. -M1, -Q1, -A1 */
    tag: string;
    cat: string;
    qty: number;
    unit: string;
    /** co položka je (přeložený název kategorie) */
    item: string;
    /** k čemu slouží (popis zařízení) */
    desc: string;
    devId?: number;
    brand: string;
    type: string;
    orderCode: string;
    supplier: string;
    note: string;
    /** položka podle posouzení rizik — jen HW, zapojení a volba k revizi */
    safety?: boolean;
    /** vybraná volba katalogu (`brandOptId`), prázdné = vlastní / bez katalogu */
    optId: string;
    /** URL, kde byl typ ověřen */
    src: string;
    /** uživatel nastavil množství 0 — řádek zůstává v přehledu, do CSV / dokumentu nejde */
    excluded?: boolean;
}
/** Kategorie kusovníku, které jsou bezpečnostními prvky samy o sobě (bez ohledu na zařízení). */
export declare const BOM_SAFETY_CATS: ReadonlySet<string>;
/**
 * Je řádek kusovníku bezpečnostní díl? Řádek podle posouzení rizik (`BomLine.safety`), bezpečnostní kategorie
 * (`BOM_SAFETY_CATS`) nebo díl zařízení E-stopu / blokování programu. Sdílí export pro CAD (`parts[].safety`)
 * a klasifikace změn revize (změna takového řádku = bezpečnostní změna).
 */
export declare function bomLineIsSafety(prj: Project, l: Pick<BomLine, "safety" | "cat" | "devId">): boolean;
export interface Bom {
    plat: PlatformKey;
    lines: BomLine[];
}
export type BeaconColor = "red" | "yellow" | "blue" | "green" | "white";
/** Pořadí pater shora podle IEC 60204-1 čl. 10.3.2 (sekundárně IDEC LD6A; skill modul-majak `data/veze.json`). */
export declare const BEACON_ORDER: BeaconColor[];
/** `roleDefault` = barva z role podle výchozí volby PLCdesk (ne z popisu ani z významu barvy). */
export interface BeaconTier {
    dev: Device;
    color: BeaconColor | null;
    roleDefault: boolean;
}
export interface BeaconTower {
    tag: string;
    tiers: BeaconTier[];
    stock: boolean;
}
/**
 * Signální věže projektu: DO s kategorií `beacon` seskupené do věží (jedna, pokud popisy nejmenují víc věží),
 * patra seřazená shora (R / Y / B / G / W, neurčená barva dole). `stock` = patra se vejdou do hotové věže
 * červená / žlutá / zelená z katalogu (barvy určené, různé, nejvýš 3). Sdílí kusovník i export pro CAD.
 */
export declare function bomBeaconTowers(prj: Project): BeaconTower[];
/** Je zařízení (DI / DO / Ventil) jen signál rozhraní k jinému stroji? */
export declare function bomIsInterface(d: Device): boolean;
/** Nabídka katalogu pro řádek kusovníku (kategorie + platforma). */
export declare function bomOptions(cat: string, plat: PlatformKey): Array<{
    id: string;
    brand: CatalogBrand;
}>;
/** Výchozí platforma kusovníku: volba v `prj.bom`, jinak první zvolená platforma. */
export declare function bomPlatform(prj: Project): PlatformKey;
/**
 * Položka kusovníku od dalšího modulu (bezpečnostní funkce…): `item` a `preset` (značka, typ,
 * kód, zdroj) nahradí katalog, pokud kategorie v katalogu není nebo modul zná konkrétní typ;
 * volby uživatele (`prj.bom.lines`) mají přednost.
 */
export interface BomExtra {
    tag: string;
    cat: string;
    qty: number;
    desc: string;
    item?: string;
    note?: string;
    safety?: boolean;
    devId?: number;
    preset?: {
        brand?: string;
        type?: string;
        orderCode?: string;
        src?: string;
    };
}
export type BomProvider = (prj: Project, plat: PlatformKey) => {
    add: BomExtra[];
    drop?: string[];
};
/** Přihlásí zdroj dalších řádků kusovníku (`drop` = id řádků, které nahrazuje). Vrací odhlášení. */
export declare function registerBomProvider(fn: BomProvider, name: string): () => void;
/** Sestaví kusovník. Výsledek je deterministický (stejný projekt → stejné řádky). */
export declare function buildBom(prj: Project): Bom;
/** CSV pro Excel (středník, UTF-8 s BOM — česká lokalizace Excelu). */
export declare function bomCsv(prj: Project): string;
/**
 * Text tabulky ke kopírování (tabulátory, řádky \n) — Excel / e-mail. Stejné sloupce a řádky
 * jako `bomCsv` (řádky s množstvím 0 vyřazené); web i desktop volají tuto funkci, nic neskládají sami.
 */
export declare function bomTableText(prj: Project): string;
/** Nejvyšší množství řádku kusovníku, které jde zadat ručně. */
export declare const BOM_QTY_MAX = 100000;
/**
 * Množství řádku kusovníku zadané uživatelem (text z pole nebo číslo): celé číslo 0…`BOM_QTY_MAX`
 * (0 = řádek vyřadit z CSV a dokumentu, zůstane v přehledu šedě). Prázdné pole = `reset` (zpět
 * na množství z návrhu). Jednotky kusovníku jsou kusy, proto jen celá čísla.
 */
export declare function bomQtyInput(v: unknown): {
    qty?: number;
    reset?: boolean;
    error?: string;
};
export interface BomSupplierRow {
    /** jméno, jak stojí v řádcích kusovníku */
    name: string;
    url: string;
    /** druh (přeložený), prázdné = neznámý */
    kind: string;
    /** dodavatele zadal uživatel a v katalogu není */
    custom: boolean;
    /** počet řádků kusovníku s tímto dodavatelem */
    rows: number;
}
/**
 * Přehled dodavatelů POUŽITÝCH v kusovníku (podklad k poptávce: koho oslovit a kolik položek).
 * Nabídku všech dodavatelů kategorie dává výběr u řádku. Dodavatelé u značek v katalogu jsou volný
 * text („Festo CZ (přímo)“) → shoda se seznamem dodavatelů i podle začátku jména.
 */
export declare function bomSuppliers(prj: Project): BomSupplierRow[];
/** Kusovník do dokumentace (Markdown). */
export declare function bomMd(prj: Project): string;
/**
 * Oddíl kusovníku (Markdown) s rozhodnutími o zpětné vazbě z CAD (`cad_feedback.ts`, historie
 * `prj.bom.cadFeedback`); bez historie prázdný — výstup beze změny (golden).
 */
export declare function cadFeedbackMd(prj: Project): string;
/**
 * Jediná vazba rozvaděč → válec / chapadlo téhož zařízení (kusovník `ls` = řádky jednoho zařízení).
 * Používá ji export pro CAD (`actuates`) i pneumatické schéma (`pneuCircuits`).
 */
export declare function valveCylinder(ls: BomLine[]): {
    valve?: BomLine;
    cyl?: BomLine;
};
