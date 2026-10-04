/**
 * PLCdesk — revize projektu a změnové řízení.
 *
 * Revize (`Project.revisions`) je zmrazený stav návrhu: označení (A, B, C… nebo 01, 02…), datum,
 * kdo ji vydal, popis změny, kanonický obsah projektu (bez revizí, schválení, výsledků oživení
 * a stavu UI) a stav schválení v okamžiku vydání (`approvalsAt` — záznamy s otiskem a příznakem,
 * zda byly v tu chvíli platné).
 *
 * `diffProjects(a, b)` porovná dva stavy po položkách — zařízení, I/O, sekvence, program
 * (režimy, E-stop, blokování), takt a model stroje, platformy, bezpečnostní funkce (PLr,
 * architektura…), kusovník, koncept — a každou změnu:
 *   - popíše (tr) a naváže na klíče položek schvalování (approval.ts), jejichž otisk se mění,
 *   - zařadí: kosmetická (popis, komentář — schválení nezneplatní), funkční (logika, časy,
 *     signály) nebo bezpečnostní (mění položku „safety:*“ / bezpečnostní data).
 * Dotčené položky se počítají ze SKUTEČNÝCH otisků položek schvalování obou stavů — klasifikace
 * tak odpovídá tomu, co approval.ts označí jako „změněno po schválení“. Levný výpočet (výchozí)
 * nespouští ověření simulací: položky na něm závislé jsou v `maybe` (možná dotčené); `exact`
 * spustí ověření a výsledek je přesný.
 *
 * `retestScope()` z rozdílu odvodí doporučený rozsah opakovaných zkoušek: body FAT, kroky plánu
 * oživení (commission.ts) a validaci dotčených bezpečnostních funkcí (fáze 10). Je to NÁVRH —
 * rozsah potvrzuje odpovědná osoba. Zpráva `17_zmeny.md` (přes `registerDocProvider`) a sloupec
 * revize v popisovém poli výkresů (`setSheetRevision` v drawing.ts) se přihlašují samy.
 */
import { Project } from "./model.js";
import { type ApprovalItem, type ApprovalRecord, type ApprovalState } from "./approval.js";
import { type CommissioningStep } from "./commission.js";
/** Stav schválení položky v okamžiku vydání revize. */
export interface RevisionApproval {
    state: ApprovalState;
    by: string;
    at: string;
    hash: string;
    note?: string;
    /** true = schváleno a otisk sedí s obsahem revize; false = neplatné; chybí = nešlo ověřit (položka čekala na ověření simulací). */
    valid?: boolean;
}
/** Revize projektu (`Project.revisions[]`, nejstarší první). */
export interface RevisionRecord {
    /** Označení: A, B, C… nebo 01, 02… */
    id: string;
    /** Okamžik vydání (ISO 8601). */
    date: string;
    /** Kdo revizi vydal. */
    by: string;
    /** Popis změny (důvod revize). */
    note: string;
    /** Otisk obsahu (FNV-1a nad `snapshot`). */
    hash: string;
    /** Kanonický JSON obsahu projektu (`revisionContent`). */
    snapshot: string;
    /** Záznamy schválení v okamžiku vydání. */
    approvalsAt: Record<string, RevisionApproval>;
    /** Povinné položky: kolik bylo platně schválených z kolika. */
    approved?: {
        valid: number;
        required: number;
    };
}
export type RevisionScheme = "letter" | "number";
/** Kanonický obsah projektu pro revizi a porovnání (hluboká kopie, seřazené klíče, bez `undefined`). */
export declare function revisionContent(prj: Project): Partial<Project>;
/** Další označení revize: po písmenech A → B … Z → AA, po číslech 01 → 02 (schéma podle poslední revize). */
export declare function nextRevisionId(prj: Project, scheme?: RevisionScheme): string;
export interface CreateRevisionOptions {
    /** Okamžik vydání (ISO 8601), výchozí teď. */
    at?: string;
    /** Vlastní označení (jinak `nextRevisionId`). */
    id?: string;
    scheme?: RevisionScheme;
    /** Hotové položky schvalování (přesné, s ověřením) — jinak levný výpočet. */
    items?: ApprovalItem[];
}
/**
 * Vydá revizi: zmrazí obsah projektu a stav schválení a připojí ji na konec `prj.revisions`.
 * Jméno je povinné. Revize nic neschvaluje — jen zaznamenává, co v tu chvíli platilo.
 */
export declare function createRevision(prj: Project, by: string, note?: string, opts?: CreateRevisionOptions): RevisionRecord;
/** Přehled revize bez obsahu (pro tabulky a UI). */
export interface RevisionInfo {
    id: string;
    date: string;
    by: string;
    note: string;
    hash: string;
    approved?: {
        valid: number;
        required: number;
    };
    /** Klasifikace změn proti předchozí revizi (jen s `classify`); null = první vydání. */
    cls?: ChangeClass | "none" | null;
}
/** Revize projektu od nejstarší; `classify` = doplnit klasifikaci změn proti předchozí revizi (levný výpočet). */
export declare function listRevisions(prj: Project, opts?: {
    classify?: boolean;
}): RevisionInfo[];
/** Poslední revize, nebo null. */
export declare function latestRevision(prj: Project): RevisionRecord | null;
/**
 * Projekt ve stavu revize `id`: obsah revize a schválení, jak platila při vydání
 * (`approvals` = `approvalsAt` bez příznaku platnosti). Nový objekt — nic nesdílí s `prj`.
 */
export declare function revisionSnapshot(prj: Project, id: string): Project;
/** Změnil se obsah projektu od poslední revize? (Bez revize false.) */
export declare function modifiedSinceRevision(prj: Project): boolean;
/** Označení revize pro výkresy a hlavičky: „B“, rozpracovaný stav po revizi „B*“, bez revize "". */
export declare function revisionLabel(prj: Project): string;
export type ChangeClass = "cosmetic" | "functional" | "safety";
export type ChangeArea = "project" | "platform" | "device" | "io" | "seq" | "program" | "interlock" | "model" | "safety" | "bom" | "concept";
export type ChangeOp = "add" | "remove" | "change";
/** Popisky klasifikace (klíče překladu). */
export declare const CHANGE_CLASSES: Record<ChangeClass, string>;
export declare function changeClassLabel(c: ChangeClass): string;
/** Popisky oblastí (klíče překladu). */
export declare const CHANGE_AREAS: Record<ChangeArea, string>;
/** Jedna změna mezi stavem `a` (starší) a `b` (novější). */
export interface RevChange {
    area: ChangeArea;
    op: ChangeOp;
    /** Odkaz na položku („dev:M1“, „io:M1_outRun“, „seq:3“, „safety:guard:S2“…) — podle novějšího stavu. */
    ref: string;
    /** Změněné pole (u změny). */
    field?: string;
    before?: unknown;
    after?: unknown;
    cls: ChangeClass;
    /** Položky ke schválení, jejichž otisk se touto změnou mění (jistě). */
    affects: string[];
    /** Položky, které se změnit mohou (závisí na ověření simulací, které v levném výpočtu neproběhlo). */
    maybe: string[];
    /** Přeložený název položky („Zařízení M1“) a celý popis změny. */
    what: string;
    text: string;
    /** Označení zařízení a tagy, kterých se změna týká (rozsah zkoušek). */
    devs: string[];
    tags: string[];
    /** Index kroku sekvence ve stavu a / b. */
    stepA?: number;
    stepB?: number;
    /** Bezpečnostní funkce (stabilní `ref`, např. „guard:S2“). */
    sf?: string;
}
export interface ProjectDiff {
    changes: RevChange[];
    /** Nejvyšší klasifikace; null = beze změny. */
    cls: ChangeClass | null;
    counts: Record<ChangeClass, number>;
    /** Dotčené položky ke schválení (otisk se mění, nebo položka přibyla / zanikla). */
    affects: string[];
    /** Možná dotčené (levný výpočet bez ověření simulací). */
    maybe: string[];
    /** Dotčené položky, které byly ve stavu `a` platně schválené — změna je zneplatní. */
    invalidates: string[];
    /** Dotčené položky, které nejde přiřadit konkrétní změně (odvozené). */
    unattributed: string[];
    /** Nové povinné položky ke schválení (ve stavu `b` přibyly). */
    added: string[];
    /** Názvy položek ke schválení (klíč → přeložený název). */
    titles: Record<string, string>;
    empty: boolean;
    /** Byl výpočet přesný (s ověřením simulací)? */
    exact: boolean;
}
export interface DiffOptions {
    /** Spustit ověření simulací (přesné dotčené položky); výchozí levný výpočet. */
    exact?: boolean;
    /** Hotové položky schvalování stavu a / b (např. z `docFiles`). */
    itemsA?: ApprovalItem[];
    itemsB?: ApprovalItem[];
    /** Schválení, vůči kterým se počítá `invalidates` (výchozí `a.approvals`). */
    approvals?: Record<string, ApprovalRecord>;
}
/**
 * Položky ke schválení, které změna a → b dotkne: otisk se liší, nebo položka přibyla / zanikla.
 * Levně (bez ověření simulací) jsou položky čekající na ověření v `maybe`, pokud se změnil vstup
 * simulace; plán oživení se porovná i bez ověření (fáze bez simulace). Návrhy ladění se nepočítají.
 */
export declare function affectedApprovals(a: Project, b: Project, opts?: DiffOptions): {
    affects: string[];
    maybe: string[];
    titles: Record<string, string>;
    itemsA: ApprovalItem[];
    itemsB: ApprovalItem[];
};
/**
 * Strukturovaný rozdíl stavů `a` (starší) → `b` (novější). Výsledek je symetrický:
 * `diffProjects(b, a)` má tytéž změny s prohozeným přidáno / odebráno a před / po,
 * tytéž dotčené položky a klasifikaci (výpočet běží vždy v jednom kanonickém pořadí).
 */
export declare function diffProjects(a: Project, b: Project, opts?: DiffOptions): ProjectDiff;
/** Rozdíl mezi dvěma revizemi; `to` = "current" (výchozí) porovná s aktuálním stavem projektu. */
export declare function diffRevisions(prj: Project, from: string, to?: string, opts?: DiffOptions): ProjectDiff;
/** Změny od revize `id` (výchozí poslední) do aktuálního stavu; bez revize null. */
export declare function changesSinceRevision(prj: Project, id?: string, opts?: DiffOptions): ProjectDiff | null;
export interface RetestScope {
    /** Nejvyšší klasifikace změn; null = beze změny. */
    cls: ChangeClass | null;
    /** Body FAT k opakování (sekce protokolu 05, odkaz, text). */
    fat: Array<{
        section: string;
        ref: string;
        text: string;
    }>;
    /** Kroky plánu oživení (aktuální plán) k opakování. */
    commissioning: CommissioningStep[];
    /** Bezpečnostní funkce k nové validaci: označení, odkaz, název, kroky fáze 10. */
    safety: Array<{
        sf: string;
        ref: string;
        title: string;
        steps: string[];
        removed?: boolean;
    }>;
    /** Položky ke schválení znovu: zneplatněná schválení a nové povinné položky. */
    approvals: string[];
    /** Doporučení podle klasifikace (přeložené věty). */
    notes: string[];
}
/**
 * Doporučený rozsah opakovaných zkoušek po změně (`diff` = rozdíl předchozí → `prj`):
 * kosmetická změna → bez zkoušek; funkční → dotčené body FAT, kroky oživení (smyčky dotčených
 * signálů, pohony, analogy, E-stop a blokování, kroky sekvence, poruchové stavy, takt), znovu
 * ověření simulací; bezpečnostní → navíc validace dotčených bezpečnostních funkcí (fáze 10).
 */
export declare function retestScope(prj: Project, diff: ProjectDiff, opts?: {
    exact?: boolean;
    plan?: CommissioningStep[];
}): RetestScope;
/** Zpráva o změnách. */
export declare const CHANGES_FILE = "17_zmeny.md";
/** Tabulka revizí (Markdown): označení, datum, kdo, popis, klasifikace proti předchozí, schválení. */
export declare function revisionTableMd(prj: Project): string;
/** Řádek revize pod nadpis dokumentu (citace Markdownu); bez revize "". */
export declare function revisionHeaderMd(prj: Project): string;
export interface ChangesMdOptions extends DiffOptions {
    /** Od revize (výchozí: poslední; když je stav beze změny, předposlední). */
    from?: string;
    /** Do revize nebo "current". */
    to?: string;
    /** Položky schvalování aktuálního stavu (z `docFiles`). */
    items?: ApprovalItem[];
}
/**
 * `17_zmeny.md`: tabulka revizí, porovnávané stavy, souhrn klasifikace, tabulka změn s dotčenými
 * položkami schvalování, zneplatněná schválení a doporučený rozsah opakovaných zkoušek.
 * Výchozí porovnání: poslední revize → aktuální stav; je-li stav beze změny, předchozí → poslední revize.
 */
export declare function changesMd(prj: Project, opts?: ChangesMdOptions): string;
