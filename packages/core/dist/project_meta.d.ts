/**
 * PLCdesk — identifikace projektu: číslo projektu (zakázky) a zákazník, víceřádkový popis,
 * názvy ukládaných souborů. Jediné místo, kde se tyto údaje převádějí na text výstupů:
 * popisové pole výkresů (drawing.ts), hlavička dokumentů (docs.ts `docFiles`), README platforem
 * (codegen.ts), titulky klientů a prefix názvů souborů.
 *
 * Datum zahájení projektu `meta.startDate` (ISO YYYY-MM-DD) se zobrazuje podle jazyka (LOCALE v i18n).
 *
 * Pravidla: číslo a zákazník jsou obsah projektu — nepřekládají se a do kódu PLC se nepíšou.
 * Prázdné / chybějící pole = výstup přesně jako dřív (golden). Jen jednořádkový text (nové řádky
 * a tabulátory z ručně upraveného JSON se slijí do mezery).
 */
import type { Project } from "./model.js";
/** Platné datum ISO „YYYY-MM-DD“ (skutečný den v kalendáři)? */
export declare function isIsoDate(s: unknown): s is string;
/** Datum ISO „YYYY-MM-DD“ ve zvyklosti jazyka (`tech` = technické výstupy, výkresy); neplatné "". */
export declare function formatIsoDate(s: unknown, tech?: boolean): string;
/**
 * Datum zadané člověkem → ISO „YYYY-MM-DD“ ("" = nerozpoznáno). Bere ISO i zápis podle jazyka
 * (pořadí den / měsíc / rok z `formatIsoDate`, oddělovač libovolný: 8. 10. 2026, 08/10/2026, 2026/10/8).
 */
export declare function parseUserDate(text: unknown): string;
/** Popisky kalendáře podle jazyka (výběr data v desktopu): názvy měsíců a dnů v týdnu od pondělí. */
export declare function calendarLabels(): {
    months: string[];
    weekdays: string[];
    locale: string;
};
/** Číslo projektu, zákazník (jednořádkově) a datum zahájení (ISO, jen platné); prázdné = "". */
export declare function projectRef(prj: Project): {
    number: string;
    customer: string;
    startDate: string;
};
/** Řádek Markdownu pod nadpis dokumentu („**Číslo projektu:** … · **Zákazník:** …“); bez údajů "". */
export declare function projectMetaMd(prj: Project): string;
/** Řádek README (prostý text) pod řádek PROJEKT; bez údajů "". */
export declare function projectMetaText(prj: Project): string;
/** Titulek pro okno / záhlaví: „číslo · název · zákazník“ (jen vyplněné části). */
export declare function projectTitle(prj: Project): string;
/**
 * Víceřádkový popis do Markdownu: prázdný řádek = nový odstavec (zůstává), jednotlivé zalomení
 * = tvrdé zalomení řádku (dvě mezery). Jednořádkový text vrací beze změny (golden).
 */
export declare function mdMultiline(s: string): string;
/** První neprázdný řádek textu (pro místa na jeden řádek: popisová pole, komentáře), volitelně zkrácený. */
export declare function firstLine(s: unknown, max?: number): string;
/** Část názvu souboru: bez diakritiky, jen [A-Za-z0-9._-], bez teček / podtržítek na krajích. */
export declare function fileSafe(s: string, max?: number): string;
/** Prefix názvů ukládaných souborů „<číslo>_“ (bez čísla ""). Nepřidá se dvakrát (`withFilePrefix`). */
export declare function projectFilePrefix(prj: Project): string;
/** Název souboru s prefixem čísla projektu (jen když ho ještě nemá). */
export declare function withFilePrefix(prj: Project, name: string): string;
/**
 * Výchozí název souboru projektu: „<číslo>_<název>.plcstudio.json“. Název jen bez znaků, které
 * Windows v názvu souboru nedovolí (diakritika zůstává); bez názvu „plc-projekt“.
 */
export declare function projectFileName(prj: Project, ext?: string): string;
/**
 * Číslo projektu ve tvaru „RRNNNN“ (6 číslic: RR = rok, NNNN = pořadí v roce, např. 260705 = 2026,
 * projekt 705)? Prázdné = false. Jiné řady (např. 76NNNN) zadává uživatel ručně — platné jsou,
 * pokud mají 6 číslic.
 */
export declare function isProjectNumber(s: unknown): boolean;
/** Upozornění ke tvaru čísla (prázdné nebo 6 číslic = ""). Jen varuje — číslo se použije, jak je. */
export declare function projectNumberProblem(s: unknown): string;
/**
 * Návrh dalšího volného čísla projektu letošní řady. `existing` = dřív použitá čísla nebo názvy
 * projektových složek („260705_Lis…“ — bere se úvodních 6 číslic před „_“ nebo koncem).
 *
 * Řada roku RR = RR0001…RR9999; po vyčerpání (RR9999) pokračuje přetoková řada RR+50
 * (2026: 260001 … 269999 → 760001 …; 2027: 27xxxx → 77xxxx). Jakmile v přetokové řadě něco je,
 * navrhne se její další číslo. Bez čísel letošní řady RR0001. Vyčerpaná i přetoková řada
 * (nebo rok s RR ≥ 50, kdy RR+50 nemá dvě číslice) → "" (bez návrhu, uživatel zadá ručně).
 */
export declare function nextProjectNumber(existing: Iterable<unknown>, year?: number): string;
/** Část názvu složky / souboru: bez diakritiky, mezery a ostatní znaky → „_“, jen [A-Za-z0-9_-]. */
export declare function folderSafe(s: unknown, max?: number): string;
/** Rezervovaná jména zařízení Windows (CON, NUL, COM1…) jako název složky / souboru → s „_“ na konci
    (složka „NUL“ by tiše nevznikla — test odolnosti 2026-10-08). */
export declare function notReserved(name: string): string;
/**
 * Název projektové složky „<číslo>_<Název>“ (název bez diakritiky, mezery → _, jen [A-Za-z0-9_-],
 * nejvýš 60 znaků); bez čísla jen „<Název>“, bez názvu jen číslo, bez obojího „plc-projekt“.
 * Soubor projektu ve složce se jmenuje stejně (+ `.plcstudio.json`).
 */
export declare function projectFolderName(prj: Project): string;
