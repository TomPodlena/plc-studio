import { type Project, type PlatformKey } from "./model.js";
import { type ProjectFile } from "./docs.js";
/** Web PLCdesk (licenční API, ceník, kontakt). Shodné s `PUBLIC_SITE` ve wrangler.toml. */
export declare const LICENSE_SITE = "https://plcdesk.podlena-t.workers.dev";
/** Limit I/O tarifu Free, když `/api/config` není dostupné. */
export declare const FREE_IO_LIMIT = 64;
/** Tolerance po konci platnosti licence (server ji vrací v `/api/license/check` jako grace_days). */
export declare const GRACE_DAYS = 30;
/** Jak často se aplikace ptá serveru na stav licence (nejvýš jednou denně). */
export declare const LICENSE_CHECK_EVERY_MS: number;
/**
 * Veřejné klíče Ed25519 pro ověření licencí — surových 32 B v base64 (výstup `apps/site/tools/keygen.js`,
 * „Veřejný klíč (raw 32 B base64) — do aplikace“). Víc klíčů = výměna klíče bez zneplatnění starých licencí.
 * Produkční klíč = pár k LICENSE_PRIVATE_KEY Workeru plcdesk (soukromý klíč je jen v secrets Workeru
 * a v záloze provozovatele, nikdy v repu). Bez platného klíče aplikace licenci neověří a běží jako Free.
 */
export declare const LICENSE_PUBLIC_KEYS: string[];
export type LicensePlan = "free" | "pro" | "firma";
export interface LicenseClaims {
    v: number;
    key: string;
    email: string;
    /** pro | firma | trial | free-unlock (server); neznámý tarif = Free */
    plan: string;
    seats: number;
    /** konec platnosti (ISO) */
    exp: string;
    iat?: string;
    /** odemčené projekty (GUID) — server je zatím neposílá, klient je jen čte */
    projects?: string[];
}
/** Výsledek ověření licenčního souboru. */
export interface LicenseCheck {
    ok: boolean;
    claims: LicenseClaims | null;
    error?: "format" | "signature" | "nokey" | "crypto";
}
/** Poslední odpověď `/api/license/check` (nepodepsaná — rozhoduje jen o zrušení). */
export interface LicenseRemote {
    status?: string;
    plan?: string;
    valid_until?: string;
    checkedAt?: string;
}
export interface Entitlements {
    plan: LicensePlan;
    /** null = bez limitu */
    ioLimit: number | null;
    /** patička PLCdesk v dokumentech a README */
    footer: boolean;
    dxf: boolean;
    /** firemní knihovna (vlastní šablony bloků, firemní hlavička) v generátoru a dokumentech */
    library: boolean;
    seats: number;
}
export interface LicenseState {
    state: "none" | "invalid" | "active" | "grace" | "expired" | "canceled";
    /** tarif, který právě platí (po vypršení / zrušení Free) */
    plan: LicensePlan;
    /** tarif ze souboru (pro / firma / trial / free-unlock), i když už neplatí */
    licPlan: string | null;
    planLabel: string;
    key: string | null;
    email: string | null;
    seats: number;
    exp: string | null;
    graceUntil: string | null;
    /** zbývající dny do konce platnosti (ve stavu grace do konce tolerance) */
    daysLeft: number | null;
    /** platba se nezdařila (server: past_due) — licence dál platí do konce tolerance */
    pastDue: boolean;
    ent: Entitlements;
    /** odemčené projekty z licence */
    projects: string[];
    /** přeložený popis stavu pro UI */
    message: string;
}
export interface ProjectGate {
    io: number;
    limit: number | null;
    unlocked: boolean;
    /** projekt je nad limitem I/O a není odemčený → náhled ano, stažení / uložení výstupů ne */
    over: boolean;
    canExport: boolean;
    canDxf: boolean;
    footer: boolean;
    library: boolean;
    plan: LicensePlan;
    /** přeložené vysvětlení omezení (prázdné, když nic neomezuje) */
    reason: string;
}
/** Licenční klíč z e-mailu / ceníku (PLCD-XXXX-XXXX-XXXX-XXXX, bez I, O, 0, 1). */
export declare function isLicenseKey(s: string): boolean;
export declare function normLicenseKey(s: string): string;
/** Licenční soubor (jeden řádek s tečkou uprostřed) — jen tvar, ne podpis. */
export declare function isLicenseFile(s: string): boolean;
/** Obsah licence BEZ ověření podpisu (jen pro zobrazení; o funkcích rozhoduje `verifyLicense`). */
export declare function readLicense(text: string): LicenseClaims | null;
/**
 * Ověří podpis licenčního souboru (WebCrypto Ed25519 — Node 20+, Chromium 137+, Firefox 129+, Safari 17+).
 * `keys` = veřejné klíče (raw 32 B base64); výchozí `LICENSE_PUBLIC_KEYS`.
 */
export declare function verifyLicense(text: string, keys?: string[]): Promise<LicenseCheck>;
export declare function planLabel(plan: string | null | undefined): string;
/** Co tarif odemyká. `ioLimit` = limit Free (z `/api/config`, jinak 64). */
export declare function entitlements(plan: string, ioLimit?: number): Entitlements;
/**
 * Stav licence k okamžiku `now`: ověřený soubor (`check` z `verifyLicense`) + poslední odpověď
 * serveru (`remote`, nepovinná). Platí do `exp`, pak ještě `GRACE_DAYS` dní (tolerance), pak Free.
 * Zrušené předplatné (`remote.status === "canceled"`) = Free hned. Bez sítě se nic nemění.
 */
export declare function licenseState(check: LicenseCheck | null, now?: Date | number, remote?: LicenseRemote | null, ioLimit?: number): LicenseState;
export declare function licenseErrorText(err: string): string;
/** Počet I/O projektu = signály všech zařízení (DI, DO, AI, AO; servoosa po síti žádné). */
export declare function projectIoCount(prj: Project): number;
/**
 * Co je pro projekt povolené. `unlocks` = GUID odemčených projektů (z licence nebo od klienta).
 * Nad limitem bez odemčení: náhled ano, stažení a uložení výstupů ne.
 */
export declare function projectGate(prj: Project, ent: Entitlements, unlocks?: Iterable<string>): ProjectGate;
/** Odkaz na stránku webu v jazyce UI (web má cs / en / de, ostatní anglicky). `page` = cenik | kontakt | stazeni. */
export declare function licenseSiteUrl(page: string, lang?: string, site?: string): string;
/** Druh souboru z pohledu licence: dokument (patička), DXF, projekt / knihovna (vždy volně), ostatní výstup. */
export declare function licenseFileKind(name: string): "doc" | "readme" | "dxf" | "own" | "out";
/** Patička Free pro soubor `name` (prázdná, když se soubor patičkou neoznačuje). */
export declare function licenseFooter(name: string, body?: string): string;
/** Patička do těla souboru (HTML před `</body>`, jinak na konec). */
export declare function addLicenseFooter(name: string, body: string): string;
/**
 * Soubor pro uložení / stažení podle brány projektu: `{ body }` (s patičkou u Free) nebo
 * `{ blocked }` s přeloženým důvodem. Projekt a firemní knihovna (.plcstudio.json, .plcdesk-library.json)
 * se ukládají vždy — jsou to data uživatele, ne výstupy.
 */
export declare function applyLicenseToFile(name: string, body: string, gate: ProjectGate | null): {
    body?: string;
    blocked?: string;
};
/** Projekt, ze kterého se generuje: bez tarifu Firma bez vlastních šablon bloků a firemní hlavičky knihovny. */
export declare function licensedProject(prj: Project, gate: Pick<ProjectGate, "library"> | null): {
    prj: Project;
    libraryBlocked: string | null;
};
/** Upozornění do README, že firemní knihovna nebyla použita (prázdné, když použita byla). */
export declare function libraryBlockedNote(libName: string | null, body?: string): string;
/** Výstupy platformy podle licence (`genFor` nad `licensedProject` + poznámka do README). Bez brány = `genFor`. */
export declare function licensedGen(prj: Project, plat: PlatformKey, gate: Pick<ProjectGate, "library"> | null): Record<string, string>;
/** Sada souborů projektu podle licence (`allProjectFiles` nad `licensedProject` + poznámka do README). */
export declare function licensedProjectFiles(prj: Project, gate: Pick<ProjectGate, "library"> | null): ProjectFile[];
