/**
 * PLCdesk — plán a protokol oživení.
 *
 * `commissioningPlan(prj)` navrhne kroky oživení po fázích: rozvaděč a napájení, smyčkový test
 * každého I/O signálu, pohony, analogy, E-stop a blokování (jen jako signály standardního
 * programu), ruční režim, automatická sekvence krok po kroku, vybrané poruchové stavy z matice
 * stavů, takt a parametry a bezpečnostní validace (dodá bezpečnostní modul přes
 * `registerCommissioningProvider`; bez něj zůstane otevřený bod, který je potřeba doložit).
 *
 * Výsledky kroků jsou v `Project.commissioning` (ok / nok / na, kdo, kdy, poznámka, naměřeno).
 * Plán i uzavření oživení jsou položky ke schválení (provider „commission“ v approval.ts).
 * Simulace ani generátor se tu nemění — plán z nich jen čte (seqCond, ověření, matice stavů).
 */
import { Project } from "./model.js";
import { type ApprovalItem, type ApprovalOptions } from "./approval.js";
export type CommissionResult = "ok" | "nok" | "na";
/** Výsledek kroku oživení (`Project.commissioning[id]`). */
export interface CommissioningRecord {
    result: CommissionResult;
    /** Kdo krok provedl / zapsal. */
    by: string;
    /** Kdy (ISO 8601). */
    at: string;
    note?: string;
    /** Naměřená hodnota (doba rozběhu, hodnota analogu, doba cyklu…), volný text. */
    measured?: string;
}
export interface CommissioningStep {
    /** Stabilní identifikátor nezávislý na jazyku („io:M1.outRun“, „drv:Y1:travel“, „seq:3:M1:start“…). */
    id: string;
    /** Fáze 1–10 (viz `COMMISSION_PHASES`). */
    phase: number;
    title: string;
    /** Co udělat na stroji. */
    how: string;
    /** Co má PLC vidět / co se má stát. */
    expect: string;
    /** Signály a proměnné programu, kterých se krok týká (tagy I/O, modeAuto, cmdAck…). */
    signals: string[];
    devId?: number;
    /** Hodnoty, které krok kontroluje, bez textů — vstupují do otisku plánu. */
    data?: unknown;
}
/** Fáze oživení (klíče překladu). */
export declare const COMMISSION_PHASES: Record<number, string>;
export type CommissioningProvider = (prj: Project) => CommissioningStep[];
/**
 * Přihlásí zdroj dalších kroků oživení (bezpečnostní modul → fáze 10: validace bezpečnostních
 * funkcí). Kroky se zařadí do své fáze za vestavěné kroky. Dokud žádný zdroj nedodá krok fáze 10,
 * plán v ní má otevřený bod „Validace bezpečnostních funkcí“. Stejné `name` nahradí dřívější
 * zdroj; vrací funkci pro odhlášení.
 */
export declare function registerCommissioningProvider(fn: CommissioningProvider, name?: string): () => void;
export declare function commissioningProviders(): string[];
/**
 * Plán oživení: kroky po fázích 1–10 (vestavěné + ze zdrojů v registru). Fáze 7 (doby ze
 * simulace) a 8 (výběr z matice stavů) potřebují ověření simulací; `{ cheap: true }` ho
 * nespouští — bez spočítaného ověření pak fáze 8 chybí a doby jsou „—“ (jen náhled, ne pro otisk).
 */
export declare function commissioningPlan(prj: Project, opts?: ApprovalOptions): CommissioningStep[];
/** Otisk plánu: id, fáze, signály, zařízení a kontrolované hodnoty kroků — bez textů. */
export declare function commissioningHash(plan: CommissioningStep[], prj?: Project): string;
/** Zapíše výsledek kroku. Neznámý krok nebo chybějící jméno = výjimka. */
export declare function setCommissionResult(prj: Project, id: string, result: CommissionResult, by: string, opts?: {
    note?: string;
    measured?: string;
    at?: string;
}, plan?: CommissioningStep[]): void;
export declare function clearCommissionResult(prj: Project, id: string): void;
export interface CommissioningSummary {
    total: number;
    ok: number;
    nok: number;
    na: number;
    /** Bez výsledku. */
    open: number;
    /** Všechny kroky ok / na — oživení lze uzavřít. */
    done: boolean;
    /** Kroky NOK a kroky bez výsledku. */
    openSteps: CommissioningStep[];
}
export declare function commissioningSummary(prj: Project, plan?: CommissioningStep[]): CommissioningSummary;
/** Položky „plán oživení“ (povinná) a „uzavření oživení“ (jde schválit, až jsou všechny kroky ok / na). */
export declare function commissioningApprovalItems(prj: Project, opts?: ApprovalOptions): ApprovalItem[];
export declare const COMMISSION_FILE_MD = "12_protokol_ozivovani.md";
export declare const COMMISSION_FILE_CSV = "12_protokol_ozivovani.csv";
/** Protokol oživení (Markdown): plán po fázích s výsledky, otevřené body, podpisy. */
export declare function commissioningMd(prj: Project, plan?: CommissioningStep[]): string;
/** Protokol oživení jako CSV (oddělovač „;“) — k tisku a vyplnění. */
export declare function commissioningCsv(prj: Project, plan?: CommissioningStep[]): string;
