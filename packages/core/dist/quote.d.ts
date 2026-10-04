import { DeviceClass, Project } from "./model.js";
import { Bom, BomLine } from "./bom.js";
import { type DocFile } from "./docs.js";
export type Currency = string;
export interface PriceEntry {
    orderCode: string;
    type: string;
    brand: string;
    /** volitelně: kategorie kusovníku (klíč `motor`, `contactor`… nebo český název) */
    cat: string;
    /** jednotková cena bez DPH v měně `currency` */
    price: number;
    currency: Currency;
    supplier: string;
    leadTime: string;
    /** řádek zdrojového souboru (1 = první řádek) */
    row: number;
}
export interface PriceList {
    entries: PriceEntry[];
    /** řádky, které nešly načíst, a nejasnosti (lidsky čitelné) */
    warnings: string[];
    delimiter: string;
}
/** Měna z textu („Kč“, „CZK“, „€“, „EUR“, „USD“…); prázdné = neuvedeno. */
export declare function currencyOf(s: string): Currency;
/**
 * Číslo z ceny v zápisu českého / německého / anglického Excelu: „1 234,50 Kč“, „1.234,50“,
 * „1,234.50“, „12,5“, „€ 99“. Vrací NaN, když to číslo není. `ambiguous` = „1.234“ (bráno jako tisíce).
 */
export declare function parseMoney(s: string): {
    value: number;
    ambiguous: boolean;
};
/**
 * Načte ceník z CSV / TSV (středník, čárka nebo tabulátor; UTF-8 i s BOM; desetinná čárka).
 * Sloupce se poznají podle záhlaví v češtině, angličtině, němčině nebo španělštině; povinná je
 * cena a k ní objednací kód, typ nebo kategorie. `defaultCurrency` platí pro řádky bez měny.
 */
export declare function parsePriceList(text: string, opts?: {
    defaultCurrency?: Currency;
}): PriceList;
export type PriceMatch = "code" | "type" | "cat";
/** Najde cenu pro řádek kusovníku: objednací kód → typ + značka → kategorie. */
export declare function matchPrice(line: BomLine, entries: PriceEntry[]): {
    entry: PriceEntry;
    match: PriceMatch;
} | null;
export interface QuoteParams {
    /** hodiny programování na jedno zařízení podle třídy */
    hoursPerDevice: Record<DeviceClass, number>;
    hoursPerIo: number;
    hoursPerStep: number;
    hoursPerSafetyFn: number;
    hoursPerDocPage: number;
    /** počet stran dokumentace; null = odhad z projektu (`docPagesEstimate`) */
    docPages: number | null;
    hoursBase: number;
    fatHours: number;
    /** dny oživení na místě; null = odhad z projektu */
    commissioningDays: number | null;
    hoursPerDay: number;
    /** jednosměrná vzdálenost k zákazníkovi [km]; 0 = bez cestovného */
    travelKm: number;
    /** počet cest (tam a zpět) */
    travelTrips: number;
    /** průměrná rychlost pro čas na cestě [km/h] */
    travelSpeed: number;
}
/** Výchozí parametry odhadu — hodiny, ne peníze. Uživatel je má upravit podle své praxe. */
export declare const QUOTE_DEFAULTS: QuoteParams;
/** Vysvětlení parametrů pro UI (české klíče překladu — přeložit přes `tr`). */
export declare const QUOTE_PARAM_INFO: Record<keyof QuoteParams, {
    label: string;
    unit: string;
    help: string;
}>;
export type RateKey = "prog" | "elec" | "comm" | "km";
/** Hodinové sazby (a sazba za km) v měně nabídky — zadává uživatel, výchozí nejsou. */
export type QuoteRates = Partial<Record<RateKey, number>>;
export declare const RATE_LABEL: Record<RateKey, string>;
/** Uložené volby nabídky v projektu (`prj.quote`). */
export interface QuoteCfg {
    currency?: Currency;
    params?: Partial<QuoteParams>;
    rates?: QuoteRates;
    /** kurz: kolik jednotek měny nabídky stojí 1 jednotka cizí měny (CZK nabídka: `{ EUR: 24.3 }`) */
    fx?: Record<string, number>;
    vatPct?: number;
    /** přirážka k nákupní ceně materiálu [%] */
    marginPct?: number;
    /** načtený ceník */
    prices?: PriceEntry[];
    /** přidat `18_nabidka.md` do dokumentace (výchozí ne — interní podklad) */
    inDocs?: boolean;
}
export interface QuoteOpts extends QuoteCfg {
    /** hotový kusovník (jinak `buildBom(prj)`) */
    bom?: Bom;
    /** počet bezpečnostních funkcí (jinak z návrhu `proposeSafety`) */
    safetyFns?: number;
}
export interface MaterialLine {
    bomId: string;
    pos: number;
    tag: string;
    item: string;
    desc: string;
    qty: number;
    unit: string;
    brand: string;
    type: string;
    orderCode: string;
    supplier: string;
    leadTime: string;
    /** jednotková cena v měně nabídky (po přepočtu), bez přirážky; undefined = bez ceny */
    unitPrice?: number;
    total?: number;
    /** cena v měně ceníku před přepočtem */
    srcPrice?: number;
    srcCurrency?: Currency;
    match: PriceMatch | null;
    /** řádek ceníku */
    priceRow?: number;
    safety?: boolean;
}
export interface LaborLine {
    key: string;
    label: string;
    /** výpočet čitelně („12 × 1,5 h“) */
    basis: string;
    qty: number;
    unit: "h" | "km";
    rateKey: RateKey;
    rate?: number;
    total?: number;
    help: string;
}
export interface UnpricedItem {
    kind: "material" | "labor";
    id: string;
    label: string;
    reason: string;
}
export interface QuoteTotals {
    /** nákupní cena oceněného materiálu */
    materialCost: number;
    margin: number;
    material: number;
    labor: number;
    hours: number;
    net: number;
    vatPct: number;
    vat: number;
    gross: number;
    /** všechny položky mají cenu */
    complete: boolean;
}
export interface Quote {
    currency: Currency;
    marginPct: number;
    material: MaterialLine[];
    labor: LaborLine[];
    totals: QuoteTotals;
    unpriced: UnpricedItem[];
    /** řádky ceníku, které nepasují na žádnou položku */
    unusedPrices: number[];
    params: QuoteParams;
}
/** Peníze na haléře / centy, zaokrouhlení half-up (bez chyb plovoucí čárky). */
export declare function round2(x: number): number;
/** Odhad stran dokumentace z rozsahu projektu. */
export declare function docPagesEstimate(prj: Project, safetyFns?: number): number;
/** Odhad dnů oživení: nejméně 1, pak 1 den na ~12 zařízení a kroků. */
export declare function commissioningDaysEstimate(prj: Project): number;
/** Číslo ve zvyklosti jazyka (do 2 desetinných míst). */
export declare function fmtNum(x: number, dec?: number, min?: number): string;
export declare function fmtMoney(x: number | undefined, cur: Currency): string;
/** Parametry nabídky: výchozí ← `prj.quote` ← `opts` (hodiny po třídách se slučují). */
export declare function quoteParams(prj: Project, opts?: QuoteOpts): QuoteParams;
/** Sestaví nabídku. Výsledek je deterministický; bez ceníku a sazeb nemá žádnou cenu. */
export declare function buildQuote(prj: Project, opts?: QuoteOpts): Quote;
/** Nabídka jako Markdown — interní podklad (ceny, hodiny, nepárované položky). */
export declare function quoteMd(prj: Project, opts?: QuoteOpts): string;
/** Nabídka jako CSV (středník, UTF-8 s BOM, desetinná čárka — český Excel). */
export declare function quoteCsv(prj: Project, opts?: QuoteOpts): string;
/** Dokument nabídky — číslo mimo pevnou sadu, jen na volbu. */
export declare const QUOTE_FILE = "18_nabidka.md";
/** Dokument nabídky pro samostatné uložení (UI: tlačítko v kroku Kusovník). */
export declare function quoteDoc(prj: Project, opts?: QuoteOpts): DocFile;
