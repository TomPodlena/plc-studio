/**
 * PLCdesk — zpětná vazba z CAD (`PLCdesk_CAD_feedback.json`, formát „plcdesk-cad-feedback“ verze 1).
 *
 * Pravidlo uživatele: neshody nalezené ve 3D (FreeCAD, `C:\CLAUDE\plcdesk_freecad`) se neopravují v modelu —
 * vrací se do PLCdesk, který je zdrojem pravdy kusovníku. Uživatel návrhy PŘIJME / ODMÍTNE po položkách,
 * nic se nemění automaticky. Formát je závazný (`FEEDBACK_SCHEMA.md`):
 *   - `parseCadFeedback(text)`   validace podle schématu, srozumitelné chyby s cestou (issues[2].severity…),
 *   - `cadFeedbackReview(prj, fb)` položky k rozhodnutí: dotčené řádky kusovníku, navržená změna převedená
 *     na volby uživatele (`prj.bom.lines[id]` — výběr položky katalogu = `brand` s `brandOptId`, jinak vlastní
 *     typ / kód / množství), alternativy (z CAD + u skříně větší skříně z katalogu podle `dims`), stav
 *     použitelné / zastaralé (otisk manifestu ≠ aktuální `cadManifestJson`) / neplatné (partId v kusovníku
 *     není, jiný projekt),
 *   - `applyCadFeedback(prj, fb, přijaté, kdo)` změní JEN `prj.bom.lines` (žádný paralelní stav) a zapíše
 *     historii `prj.bom.cadFeedback` — kusovník, `09_kusovnik.*` (oddíl změn z CAD) i další export manifestu
 *     se tím přepočítají samy. Opakované použití téže zpětné vazby nic nezdvojí (idempotence).
 * Bez zpětné vazby se výstupy nemění (golden).
 */
import type { Project, BomLineCfg } from "./model.js";
export declare const CAD_FEEDBACK_FORMAT = "plcdesk-cad-feedback";
export declare const CAD_FEEDBACK_VERSION = 1;
/** Obvyklé jméno souboru zpětné vazby (nástroje CAD ho tak ukládají). */
export declare const CAD_FEEDBACK_FILE = "PLCdesk_CAD_feedback.json";
export declare const CAD_FEEDBACK_KINDS: readonly ["cabinet_too_small", "part_not_fitting", "qty_mismatch", "ambiguous_type", "missing_order_code", "model_mismatch", "part_obsolete", "part_not_orderable", "other"];
/** Druhy o stavu dílu u výrobce (ukončená výroba / nelze objednat): musí nést doložený stav `vendorStatus`. */
export declare const CAD_FEEDBACK_VENDOR_KINDS: readonly CadFeedbackKind[];
export type CadFeedbackKind = typeof CAD_FEEDBACK_KINDS[number];
export type CadFeedbackSeverity = "error" | "warn" | "info";
export interface CadFeedbackMeasured {
    what: string;
    value: number;
    unit: string;
    source: string;
}
export interface CadFeedbackRequired {
    what: string;
    min?: number;
    max?: number;
    value?: number;
    unit: string;
    basis: string;
}
export interface CadFeedbackLine {
    type?: string;
    orderCode?: string;
    brand?: string;
    supplier?: string;
    qty?: number;
    note?: string;
}
export interface CadFeedbackAlt {
    type?: string;
    orderCode?: string;
    brand?: string;
    why?: string;
}
/** Stav dílu u výrobce (např. Siemens PM400 / PM500) se zdrojem — u `part_obsolete` / `part_not_orderable` povinný. */
export interface CadFeedbackVendorStatus {
    code: string;
    date?: string;
    source: string;
}
export interface CadFeedbackIssue {
    id: string;
    kind: CadFeedbackKind;
    severity: CadFeedbackSeverity;
    parts: string[];
    measured?: CadFeedbackMeasured;
    required?: CadFeedbackRequired;
    message: string;
    vendorStatus?: CadFeedbackVendorStatus;
    suggestion?: {
        partId: string;
        line?: CadFeedbackLine;
        alternatives?: CadFeedbackAlt[];
    };
}
export interface CadFeedback {
    format: string;
    version: number;
    project: {
        guid: string;
    };
    manifest: {
        sha256: string;
    };
    created: string;
    tool: string;
    issues: CadFeedbackIssue[];
}
/** SHA-256 textu v UTF-8 (hex, malá písmena) — otisk manifestu pro CAD, jak ho počítá nástroj CAD ze souboru. */
export declare function sha256Text(text: string): string;
/** Otisk manifestu pro CAD, jak ho klient uloží (`cadManifestJson`, aktuální jazyk). */
export declare function cadManifestSha256(prj: Project): string;
/**
 * Načte a ověří zpětnou vazbu podle schématu verze 1. Při chybě `fb` = null a `errors` (přeložené věty
 * s cestou k položce). Neznámé klíče se ignorují (dopředná kompatibilita v rámci verze).
 */
export declare function parseCadFeedback(text: string): {
    fb: CadFeedback | null;
    errors: string[];
};
export type CadFbState = "usable" | "stale" | "invalid";
/** Navržená změna řádku kusovníku — už převedená na volbu uživatele `cfg` (= `prj.bom.lines[partId]`). */
export interface CadFbProposal {
    /** „cad“ = návrh z CAD, „catalog“ = položka katalogu PLCdesk (např. větší skříň podle rozměrů) */
    source: "cad" | "catalog";
    brand: string;
    type: string;
    orderCode: string;
    qty: number;
    /** volba katalogu (`brandOptId`), prázdné = vlastní typ mimo katalog */
    optId: string;
    why: string;
    /** nová volba řádku (nahradí `prj.bom.lines[partId]`) */
    cfg: BomLineCfg;
}
export interface CadFbPart {
    id: string;
    known: boolean;
    tag: string;
    item: string;
    brand: string;
    type: string;
    orderCode: string;
    qty: number;
}
export interface CadFbItem {
    id: string;
    kind: CadFeedbackKind;
    severity: CadFeedbackSeverity;
    message: string;
    measured?: CadFeedbackMeasured;
    required?: CadFeedbackRequired;
    /** text „naměřeno“ / „požadováno“ k zobrazení (prázdné = neuvedeno) */
    measuredText: string;
    requiredText: string;
    parts: CadFbPart[];
    /** řádek kusovníku, kterého se změna týká ("" = bez návrhu) */
    partId: string;
    state: CadFbState;
    stateText: string;
    proposal?: CadFbProposal;
    alternatives: CadFbProposal[];
    /** návrh už je v kusovníku (stejná volba řádku), u skříně i „současná skříň požadavek splňuje“ */
    applied: boolean;
    /** doplňující informace PLCdesk k položce (přeložená), např. že současná skříň požadavek splňuje */
    info: string;
    /** poslední rozhodnutí o téže položce téhož souboru (historie `prj.bom.cadFeedback`) */
    decided?: "accepted" | "rejected";
}
export interface CadFbReview {
    /** zpětná vazba patří k projektu (GUID) */
    projectMatch: boolean;
    /** otisk manifestu ≠ aktuální export (kusovník se od exportu změnil) */
    stale: boolean;
    /** varování k celému souboru (přeložená) */
    warnings: string[];
    items: CadFbItem[];
    /** shrnutí: počet položek podle stavu */
    counts: Record<CadFbState, number>;
}
/**
 * Položky zpětné vazby k rozhodnutí. Pořadí = závažnost (chyby první), pak pořadí v souboru.
 * Stav: `invalid` = jiný projekt nebo partId, který v kusovníku není (nelze přijmout); `stale` = kusovník
 * se od exportu manifestu změnil (lze přijmout, s varováním); jinak `usable`.
 */
export declare function cadFeedbackReview(prj: Project, fb: CadFeedback): CadFbReview;
export interface CadFbApplyResult {
    /** přijaté položky, které změnily kusovník (id položky, případně #n alternativy) */
    applied: string[];
    /** přijaté bez změny kusovníku (bez návrhu nebo už použité) */
    acknowledged: string[];
    rejected: string[];
    /** nepoužitelné (neplatné partId, jiný projekt, neznámá alternativa) — s důvodem */
    skipped: Array<{
        id: string;
        why: string;
    }>;
    /** kusovník se změnil → exportuj znovu pro CAD */
    bomChanged: boolean;
}
/**
 * Použije rozhodnutí uživatele: `accepted` = id položek (hlavní návrh) nebo `id#n` (n-tá alternativa, od 0).
 * Ostatní použitelné položky se zapíšou jako odmítnuté (`opts.rejected` = jen tyto). Mění `prj` na místě:
 * `prj.bom.lines[partId]` (výběr katalogu / vlastní typ / množství) a historie `prj.bom.cadFeedback`.
 * Totéž rozhodnutí podruhé nic nezmění ani nepřidá (idempotence).
 */
export declare function applyCadFeedback(prj: Project, fb: CadFeedback, accepted: string[], by: string, opts?: {
    rejected?: string[];
    at?: string;
}): CadFbApplyResult;
/** Popisy druhů a závažností položek zpětné vazby (klíče překladu) — web i desktop. */
export declare const CAD_FEEDBACK_KIND_LABEL: Record<CadFeedbackKind, string>;
export declare const CAD_FEEDBACK_SEVERITY_LABEL: Record<CadFeedbackSeverity, string>;
/** Text návrhu pro zobrazení: značka, typ, kód (není-li v typu), množství. */
export declare function cadFbProposalText(p: CadFbProposal): string;
