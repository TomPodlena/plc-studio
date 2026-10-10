/**
 * PLCdesk — schvalování návrhu a návrhy ladění.
 *
 * Aplikace navrhuje, odpovědná osoba schvaluje: každá položka návrhu (zařízení, tabulka I/O,
 * sekvence, E-stop a blokování, takt a hlídací časy, výsledek ověření simulací, plán oživení…)
 * se schvaluje jménem, datem a poznámkou. Nic se neschvaluje automaticky.
 *
 * Schválení platí pro OBSAH v okamžiku schválení — ukládá se jeho otisk (`hash`). Otisk je
 * FNV-1a (64 bit) nad kanonickým JSON (seřazené klíče) jen toho, co položka schvaluje:
 *   - žádné popisy, komentáře ani přeložené texty (přejmenování popisu zařízení nebo přepnutí
 *     jazyka schválení nezneplatní),
 *   - ale vše, co mění chování stroje nebo programu (třída, volby, meze, časy, tagy, adresy…).
 * Liší-li se uložený otisk od aktuálního, je stav „stale“ (změněno po schválení).
 *
 * Další moduly (bezpečnostní modul, oživení) přidávají položky přes `registerApprovalProvider`
 * — bez zásahu do tohoto souboru. Bezpečnostní funkce tady nejsou: E-stop a blokování jsou
 * položkou jen jako signály standardního programu (jako v generátoru).
 */
import { Project, Device } from "./model.js";
import { type VerifyResult } from "./sim.js";
export type ApprovalState = "proposed" | "approved" | "rejected";
/** „unverified“ = otisk závisí na ověření simulací, které ještě neproběhlo (levný výpočet, `cheap`). */
export type ApprovalStatus = ApprovalState | "stale" | "missing" | "unverified";
export type ApprovalGroup = "design" | "program" | "verify" | "safety" | "commission" | "tuning";
/** Záznam schválení v projektu (`Project.approvals[key]`). */
export interface ApprovalRecord {
    state: ApprovalState;
    /** Jméno odpovědné osoby. */
    by: string;
    /** Okamžik rozhodnutí (ISO 8601). */
    at: string;
    note?: string;
    /** Otisk obsahu položky v okamžiku rozhodnutí. */
    hash: string;
}
export interface ApprovalItem {
    /** „dev:M1“, „io“, „seq“, „interlocks“, „limits“, „verify“, „safety:…“, „commission:…“, „tuning:…“ */
    key: string;
    group: ApprovalGroup;
    /** Přeložený název položky. */
    title: string;
    /** Co se schvaluje — stručně, pro tabulku a dokumentaci. */
    summary: string;
    /** Otisk obsahu (viz `contentHash`). */
    hash: string;
    /** Bez schválení nelze označit projekt za schválený (a navazující výstupy, např. bezpečnostní program). */
    required: boolean;
    /** false = položku zatím nelze schválit (důvod v `notReady`), např. oživení s otevřenými kroky. */
    ready?: boolean;
    notReady?: string;
    /** Všechny důvody zvlášť (`notReady` je jejich spojení). */
    blockers?: string[];
    /** true = otisk zatím neznámý — položka závisí na ověření simulací a to se v levném výpočtu nespouští. */
    unverified?: boolean;
}
/** Popisky skupin (klíče překladu) — pro tabulky a UI. */
export declare const APPROVAL_GROUPS: Record<ApprovalGroup, string>;
/** Přeložený popisek stavu položky. */
export declare function approvalStatusLabel(s: ApprovalStatus): string;
/** Filtry seznamu položek ke schválení (web i desktop): vše, k rozhodnutí, podle stavu. */
export declare const APPROVAL_FILTERS: readonly ["all", "open", "stale", "rejected", "approved"];
export type ApprovalFilter = typeof APPROVAL_FILTERS[number];
/** Přeložený popisek filtru. */
export declare function approvalFilterLabel(f: ApprovalFilter): string;
/** Projde položka se stavem `st` filtrem `f`? „k rozhodnutí“ = neschváleno, čeká, změněno po schválení. */
export declare function approvalFilterPass(st: ApprovalStatus, f: ApprovalFilter | string): boolean;
/** Kanonický JSON: klíče objektů seřazené, `undefined` vynechané, nekonečna a NaN jako null. */
export declare function canonicalJson(v: unknown): string;
/** FNV-1a 64 bit nad UTF-8 bajty textu → 16 hex znaků. */
export declare function fnv1a64(s: string): string;
/** Otisk obsahu položky: deterministický, nezávislý na pořadí klíčů objektů a na jazyku. */
export declare function contentHash(content: unknown): string;
/**
 * Návrh tak, jak ho čte ověření simulací: jen zařízení, I/O, program, model stroje, platformy
 * a takt. Bez názvu a popisu projektu, konceptu, kusovníku, schválení, výsledků oživení
 * a dat dalších modulů (bezpečnost) — jejich změna tak ověření (desítky sekund u velkého
 * stroje) znovu nespouští. Popisy zařízení a komentáře I/O zůstávají: jsou v textech nálezů
 * ověření a jejich změna má texty obnovit.
 */
/** Kopie objektu bez pole `guid` (GUID není obsah návrhu — otisky, revize a ověření ho ignorují). */
export declare function noGuid<T extends {
    guid?: string;
}>(o: T): T;
export declare function designView(prj: Project): Project;
/** Ověření simulací nad návrhem (sdílená cache s dokumentací a s levným souhrnem). */
export declare function verifyDesign(prj: Project): VerifyResult;
/**
 * Převezme výsledek `verifyDesign(prj)` spočítaný jinde (web Worker klienta nad týmž jádrem, v aktuálním
 * jazyce) do cache ověření — kroky Schválení / Oživení / Dokumentace pak simulaci znovu nespouštějí.
 */
export declare function seedVerifyDesign(prj: Project, v: VerifyResult): void;
/** Ověření z cache, nebo null — nic nespouští. */
export declare function verifyDesignCached(prj: Project): VerifyResult | null;
/** Je ověření návrhu už spočítané (v aktuálním jazyce)? */
export declare function isVerified(prj: Project): boolean;
/** Volby výpočtu položek: `cheap` = nespouštět ověření simulací (položky závislé na něm jsou „čeká na ověření“). */
export interface ApprovalOptions {
    cheap?: boolean;
}
/** Parametry pohonu fáze 2a do otisku / porovnání revizí (rozsah, žádaná, rampa, tolerance, záznamy, model jízdy). */
export declare function motionContent(d: Device): Record<string, unknown>;
/**
 * Zdroj položek. Druhý argument jsou volby výpočtu: při `cheap` nemá zdroj spouštět ověření
 * simulací (`verifyDesignCached` místo `verifyDesign`); položky, jejichž otisk na něm závisí,
 * vrátí s `unverified: true` a prázdným otiskem. Zdroje s jedním parametrem fungují dál.
 */
export type ApprovalProvider = (prj: Project, opts?: ApprovalOptions) => ApprovalItem[];
/**
 * Přihlásí zdroj dalších položek ke schválení (bezpečnostní modul, oživení…). Stejné `name`
 * nahradí dříve přihlášený zdroj (opakované načtení modulu). Vrací funkci pro odhlášení.
 * Klíče položek musí být jedinečné — doporučená předpona podle skupiny („safety:…“).
 */
export declare function registerApprovalProvider(fn: ApprovalProvider, name?: string): () => void;
/** Názvy přihlášených zdrojů položek (diagnostika, testy). */
export declare function approvalProviders(): string[];
/**
 * Všechny položky projektu ke schválení: návrh, program, ověření, bezpečnost, zdroje z registru,
 * návrhy ladění. `{ cheap: true }` nespouští ověření simulací: bez něj spočítaného má položka
 * „verify“ (a položky zdrojů, které na něm závisí) `unverified: true` a návrhy ladění chybí.
 */
export declare function approvalItems(prj: Project, opts?: ApprovalOptions): ApprovalItem[];
/** Stav položky: schváleno / zamítnuto / čeká; „stale“ = schváleno, ale obsah se od té doby změnil. */
export declare function approvalStatus(prj: Project, item: ApprovalItem): ApprovalStatus;
/** Schválí položku (aktuální obsah). Jméno je povinné; položku s `ready === false` schválit nelze. */
export declare function approve(prj: Project, key: string, by: string, note?: string, at?: string): void;
/** Zamítne položku (důvod do poznámky). */
export declare function reject(prj: Project, key: string, by: string, note?: string, at?: string): void;
export interface ApproveManyResult {
    /** Schválené klíče (každý má vlastní záznam s aktuálním otiskem). */
    approved: string[];
    /** Přeskočené: neznámý klíč, položka zatím nejde schválit (`ready === false`). */
    skipped: Array<{
        key: string;
        reason: string;
    }>;
}
/**
 * Hromadné schválení vybraných položek — výslovná akce uživatele nad seznamem klíčů (např.
 * „schválit celou skupinu“ po potvrzení). Každá položka dostane vlastní záznam se svým otiskem,
 * jménem, okamžikem a poznámkou; nic dalšího se neschvaluje. Položky se počítají jednou.
 */
export declare function approveMany(prj: Project, keys: string[], by: string, note?: string, at?: string): ApproveManyResult;
/** Zruší rozhodnutí o položce (záznam se odstraní). */
export declare function resetApproval(prj: Project, key: string): void;
export interface ApprovalSummary {
    total: number;
    approved: number;
    stale: number;
    rejected: number;
    /** Položky „čeká na ověření“ (jen v levném výpočtu). */
    unverified: number;
    /** Levný výpočet bez ověření simulací: počty nemusí být úplné (chybí návrhy ladění, otisky čekají). */
    partial: boolean;
    /** Bez rozhodnutí (chybí, nebo se položka po zamítnutí změnila). */
    pending: number;
    /** Povinné položky, které nejsou platně schválené. */
    blocking: ApprovalItem[];
    /** Projekt je schválený: žádná povinná položka neblokuje. */
    ok: boolean;
}
/**
 * Souhrn stavů. Druhý argument: hotové položky (`approvalItems`), nebo volby — `{ cheap: true }`
 * nespouští ověření simulací (odznak v hlavičce); pak `partial` = true, pokud ověření chybí.
 */
export declare function approvalSummary(prj: Project, arg?: ApprovalItem[] | ApprovalOptions): ApprovalSummary;
/** Záznamy schválení, ke kterým už položka neexistuje (smazané zařízení, uplatněný návrh ladění). */
export declare function approvalOrphans(prj: Project, items?: ApprovalItem[]): string[];
export interface ApprovalStamp {
    state: "approved" | "stale" | "unapproved" | "none";
    /** Jeden řádek prostého textu (README). */
    text: string;
    /** Řádek Markdownu (citace) pod nadpis dokumentu. */
    md: string;
}
/**
 * Razítko stavu skupin položek: SCHVÁLENO (kdo, kdy) / ZMĚNĚNO PO SCHVÁLENÍ / NESCHVÁLENO.
 * `groups` = které skupiny dokument pokrývá (prázdné = všechny povinné položky).
 */
export declare function approvalStamp(prj: Project, groups?: ApprovalGroup[], items?: ApprovalItem[]): ApprovalStamp;
/** Dokument se schválením položek. */
export declare const APPROVAL_FILE = "11_schvaleni.md";
/** Dokument `11_schvaleni.md`: souhrn a tabulka položek po skupinách (stav, kdo, kdy, poznámka, otisk). */
export declare function approvalsMd(prj: Project, items?: ApprovalItem[]): string;
export interface TuningProposal {
    /** Stabilní identifikátor (nezávislý na jazyku), např. „wd-3“, „limits-B1“, „matrix-2-estop“. */
    id: string;
    kind: "watchdog" | "takt" | "limits" | "unused-in" | "unused-out" | "setpoint" | "idle-drive" | "matrix";
    title: string;
    why: string;
    /** Uplatnění návrhu — čistá funkce, vrací NOVÝ projekt. Chybí u návrhů, které jsou jen popisem. */
    apply?: (prj: Project) => Project;
    /** Klíč položky ke schválení („tuning:<id>“). */
    approvalKey: string;
    /** Otisk navržené změny (data bez textů). */
    hash: string;
    step?: number;
    dev?: number;
    /** Co `apply` změní (prázdné u návrhů, které jsou jen popisem). */
    changes: TuningChange[];
    /**
     * Položky ke schválení, jejichž otisk se uplatněním změní (budou „změněno po schválení“).
     * Patří sem i „commission:plan“: plán oživení obsahuje hodnoty, které kontroluje (meze analogu,
     * časy kroků), a po změně se musí schválit znovu — rozhodnutí: ano, mění otisk plánu.
     */
    affects: string[];
}
/** Jedna změna návrhu ladění: položka ke schválení, pole projektu, hodnota před a po, popis. */
export interface TuningChange {
    key: string;
    field: string;
    before: unknown;
    after: unknown;
    note: string;
}
/**
 * Návrhy úprav z ověření simulací a kontroly konceptu: malá rezerva hlídacího času, nesplněný takt,
 * analog bez mezí, nevyužité vstupy, výstupy bez povelu, pohony mimo cyklus, ✖ v matici stavů.
 * Každý návrh je položka ke schválení; uplatnění (`apply`) nic neschvaluje a vrací nový projekt.
 */
export declare function tuningProposals(prj: Project): TuningProposal[];
/** Najde návrh ladění podle id a uplatní ho (nový projekt). Bez `apply` vrací kopii beze změny. */
export declare function applyTuning(prj: Project, id: string): Project;
export interface TuningResult {
    prj: Project;
    id: string;
    title: string;
    changes: TuningChange[];
    affects: string[];
}
/** Jako `applyTuning`, navíc vrací seznam změn a dotčené položky ke schválení. Nic neschvaluje. */
export declare function applyTuningResult(prj: Project, id: string): TuningResult;
