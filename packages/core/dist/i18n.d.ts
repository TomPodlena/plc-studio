export type Lang = "cs" | "en" | "de" | "es" | "zh";
/** Podporované jazyky a jejich názvy (v daném jazyce, pro přepínač). */
export declare const LANGS: Record<Lang, string>;
export declare function isLang(l: unknown): l is Lang;
/** Nastaví jazyk výstupů; neznámý kód = čeština. Vrací skutečně nastavený jazyk. */
export declare function setLang(l: unknown): Lang;
export declare function getLang(): Lang;
/** Jazyk technických výstupů (viz `trx`): čínština se nahrazuje angličtinou. */
export declare function techLang(): Lang;
/** Dosadí `{jméno}` z `p`; neznámé zástupné znaky nechá být. */
export declare function fill(s: string, p?: Record<string, unknown>): string;
/** Překlad českého textu `cs` do jazyka `l` (bez překladu vrací češtinu). */
export declare function trIn(l: Lang, cs: string, p?: Record<string, unknown>): string;
/** Překlad do nastaveného jazyka — texty UI, dokumentace, hlášení simulace, diagramy. */
export declare function tr(cs: string, p?: Record<string, unknown>): string;
/**
 * Překlad pro technické výstupy, které musí zůstat v latince: komentáře v generovaném
 * kódu PLC a texty výkresů (SVG sdílí geometrii s DXF R12). Při čínštině vrací angličtinu.
 */
export declare function trx(cs: string, p?: Record<string, unknown>): string;
/**
 * Značka pro sběr klíčů: text v tabulce / konstantě, který se překládá až při použití
 * (`tr(CLS[c].label)`). Sama nic nepřekládá.
 */
export declare function N_(cs: string): string;
/** Značka národního prostředí nastaveného jazyka (např. „cs-CZ“) — formáty data v klientech. */
export declare function dateLocale(tech?: boolean): string;
/** Dnešní datum ve zvyklosti nastaveného jazyka; `tech` = pro technické výstupy (viz `trx`). */
export declare function today(tech?: boolean): string;
/** Datum z ISO okamžiku ve zvyklosti nastaveného jazyka (neplatný vstup vrátí beze změny). */
export declare function formatDate(iso: string, tech?: boolean): string;
/** Datum a čas (hodiny:minuty, místní čas) z ISO okamžiku ve zvyklosti nastaveného jazyka. */
export declare function formatDateTime(iso: string, tech?: boolean): string;
/** Provede `fn` s dočasně přepnutým jazykem (např. dokumentace v jiném jazyce než UI). */
export declare function withLang<T>(l: unknown, fn: () => T): T;
/** Celý katalog jazyka (český text → překlad) — pro klienty s vlastním UI (desktop). */
export declare function catalog(l: unknown): Record<string, string>;
