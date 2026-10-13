export type HelpClient = "web" | "desktop";
export type HelpGroup = "start" | "step" | "topic";
/** Text odstavce / bodu; `only` = jen pro jednoho klienta. */
export interface HelpText {
    text: string;
    only?: HelpClient;
}
/** Častá chyba nebo hláška: co se ukáže a jak to opravit. */
export interface HelpIssue {
    problem: string;
    fix: string;
    only?: HelpClient;
}
export interface HelpChapter {
    /** Stabilní ASCII id (kotva v aplikaci, adresa /napoveda/<id>/ na webu). */
    id: string;
    group: HelpGroup;
    /** Index kroku workflow (0 = Projekt … 12 = Oživení), u obecných kapitol chybí. */
    step?: number;
    title: string;
    summary: string;
    steps: HelpText[];
    tips: HelpText[];
    issues: HelpIssue[];
    /** Odkazy na jiné kapitoly (id). */
    see: string[];
    /** Klíčová slova pro hledání (přeložená; jeden klíč překladu, oddělená čárkou). */
    keywords: string[];
    only?: HelpClient;
}
/** Skupiny kapitol v pořadí obsahu. */
export declare const HELP_GROUPS: Record<HelpGroup, string>;
/** Index kroku workflow → id kapitoly (pořadí lišty kroků v obou klientech). */
export declare const HELP_STEP_IDS: string[];
/** Kapitola k aktuálnímu kroku (číslo kroku; krok Nápověda / neznámý = „start“). */
export declare function helpForStep(step: unknown): string;
/** Všechny kapitoly v jazyce `lang` (výchozí = nastavený); `client` vynechá položky jiného klienta. */
export declare function helpChapters(lang?: string, client?: HelpClient): HelpChapter[];
/** Jedna kapitola (nebo null). */
export declare function helpChapter(id: string, lang?: string, client?: HelpClient): HelpChapter | null;
/** Česká zdrojová data kapitol (klíče překladu) — pro testy a sběr textů. */
export declare function helpSourceTexts(): string[];
export interface HelpTourStop {
    id: string;
    /** Cíl zvýraznění: číslo kroku workflow, "samples" (výběr příkladů v kroku Projekt) nebo "help". */
    target: number | "samples" | "help";
    title: string;
    text: string;
}
/** Zastavení úvodního průvodce v jazyce `lang`. */
export declare function helpTour(lang?: string): HelpTourStop[];
/** Společné popisky UI nápovědy (panel, krok Nápověda, průvodce, web) — překlad přes `tr(HELP_UI.x)`. */
export declare const HELP_UI: {
    panelTitle: string;
    open: string;
    full: string;
    web: string;
    close: string;
    steps: string;
    tips: string;
    issues: string;
    faq: string;
    see: string;
    only_web: string;
    only_desktop: string;
    search: string;
    results: string;
    noResults: string;
    contents: string;
    tourStart: string;
    tourNext: string;
    tourPrev: string;
    tourSkip: string;
    tourDone: string;
    tourOf: string;
    school: string;
    goStep: string;
    video: string;
    webTitle: string;
    webIntro: string;
};
/** Text pro porovnání: malá písmena, bez diakritiky. */
export declare function helpFold(s: string): string;
export interface HelpHit {
    id: string;
    title: string;
    score: number;
    /** Úryvek s kontextem kolem první shody (bez zvýraznění; klient si shodu zvýrazní sám). */
    snippet: string;
    step?: number;
}
/**
 * Hledání v kapitolách: bez diakritiky a velikosti písmen, všechna slova dotazu musí být
 * v kapitole (AND). Váha: nadpis 10, klíčová slova 6, shrnutí 3, ostatní text 1 (na slovo).
 * Hledá v jazyce `lang`; mimo češtinu i v českých klíčových slovech (nižší váha).
 */
export declare function searchHelp(query: string, lang?: string, client?: HelpClient, limit?: number): HelpHit[];
/** Adresa kapitoly na webu PLCdesk (/napoveda/<id>/; bez id rozcestník) v jazyce UI (web má cs / en / de). */
export declare function helpSiteUrl(id?: string, lang?: string): string;
/** Jazyky, ve kterých existuje videoprůvodce (web /video/, přepínač jazyka videa `?v=`). */
export declare const HELP_VIDEO_LANGS: string[];
/**
 * Adresa videoprůvodce na webu PLCdesk s jazykem videa = jazyk UI: `/video/?v=cs`, `/en/video/?v=en`,
 * `/de/video/?v=de`; web nemá es / zh — ty vedou na anglickou stránku s videem `?v=es` / `?v=zh`.
 */
export declare function helpVideoUrl(lang?: string): string;
/** Id všech kapitol (pro web a testy). */
export declare const HELP_IDS: string[];
