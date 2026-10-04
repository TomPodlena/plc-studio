/**
 * PLCdesk — trvalé identifikátory objektů projektu (GUID).
 *
 * Proč: EPLAN (AutomationML AR APC) a další nástroje párují objekty při opakovaném importu podle
 * GUID. GUID proto musí být STABILNÍ napříč exporty téhož projektu — přiděluje se jednou při vzniku
 * objektu, ukládá se do JSON projektu a při exportu se NIKDY negeneruje (export jen čte).
 *
 *   Project.guid          náhodný (v4), při vzniku projektu (`blankProject`)
 *   Device.guid           náhodný (v4), při vzniku zařízení (`syncIO` / `ensureGuids` hned po přidání)
 *   Project.moduleGuids   náhodný (v4) pro každou I/O kartu; karta nemá v modelu vlastní objekt (vzniká
 *                         z I/O tabulky v `modules()`), její identita je klíč „<směr><pořadí>“ (DI1, DO2…)
 *                         — stejný klíč jako označení karty ve výkresech a dokumentaci
 *   IoEntry.guid          odvozený (UUIDv8, RFC 9562) z GUID zařízení + signálu: signál JE „zařízení ×
 *                         signál“, takže GUID přežije přejmenování tagu i přečíslování id zařízení a je
 *                         stabilní i u projektů, které I/O tabulku neukládají (příklady samples/)
 *
 * Odvozené GUID objektů exportu bez vlastního záznamu v modelu (stanice, rack, CPU, rozhraní PROFINET,
 * síť…) počítá exportér funkcí `derivedGuid(prj.guid, role)` — deterministicky z GUID projektu.
 *
 * Otisky schvalování (approval.ts) GUID neobsahují a revize (revision.ts) ho vyřazuje z porovnání —
 * doplnění GUID při migraci proto nemění stav schválení ani nehlásí změnu.
 * Bez závislostí: crypto.getRandomValues (prohlížeč i Node ≥ 19), jinak Math.random.
 */
import type { Project, IoModule } from "./model.js";
export declare const GUID_RE: RegExp;
export declare const isGuid: (s: unknown) => s is string;
/** Náhodný GUID (UUID v4). */
export declare function newGuid(): string;
/** Odvozený GUID (UUIDv8): deterministicky z rodičovského GUID a role/klíče. */
export declare function derivedGuid(parent: string, role: string): string;
/** Klíč identity I/O karty (DI1, DO2 …) — viz `modules()`. */
export declare const moduleKey: (m: Pick<IoModule, "dir" | "idx">) => string;
/** GUID signálu: odvozený z GUID zařízení a signálu. */
export declare const ioGuidFor: (devGuid: string, sig: string) => string;
/**
 * Doplní chybějící (a opraví neplatné či duplicitní) GUID projektu, zařízení, I/O karet a signálů.
 * Existující platné GUID nikdy nemění. Vrací true, když něco doplnila — volající pak projekt
 * označí jako změněný (uloží). Volá se při vzniku objektů (`syncIO`) a při načtení projektu.
 * `mods` = karty projektu (z `modules()`), jinak se karty neřeší.
 */
export declare function fillGuids(prj: Project, mods?: IoModule[]): boolean;
