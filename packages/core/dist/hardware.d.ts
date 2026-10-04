/**
 * PLCdesk — sestava hardwaru: JEDINÝ zdroj pravdy o tom, z čeho je řídicí systém fyzicky složen.
 *
 *   hwLayout(prj, plat)   stanice (CPU s lokálním rackem, případně vzdálené stanice s hlavou), moduly
 *                         z katalogu (objednací kód, počet kanálů z `hw` položky katalogu), vestavěné I/O
 *                         CPU jako modul „BuiltIn“ a přiřazení KAŽDÉHO signálu právě jednomu kanálu
 *                         (stanice, slot, kanál) s adresou podle platformy
 *   hwAddr / hwNative     kanonická adresa (Siemens notace, %I0.0 / %IW64) a adresa v notaci platformy
 *   hwAssign              přidělení adres (autoAddr): e.addr = kanál sestavy platformy hardwaru
 *   hwGroups              kanálové skupiny modulů (modul × směr) — výkresy, svorkovnice, FDS (`modules()`)
 *
 * Kdo z toho čte (nic nesmí počítat moduly po svém): modules()/autoAddr/addrFor (model.ts), kusovník
 * (bom.ts — řádky PLC = moduly sestavy), výkresy a svorkovnice (drawing.ts, docs.ts), EPLAN (eplan.ts,
 * eplan_aml.ts — stanice / rack / sloty / BuiltIn / ET 200SP s IM a sítí PROFINET), Rockwell aliasy
 * (logix.ts), generátor (adresy v kódu přes addrFor), validace (`hwIssues` → validateProject).
 *
 * Pravidla (podrobně v CLAUDE.md „Sestava hardwaru“): CPU = volba uživatele v kusovníku, jinak první CPU
 * katalogu, do kterého se I/O vejdou lokálně (jinak to s největší lokální kapacitou + vzdálené stanice);
 * nejdřív vestavěné I/O CPU, pak moduly v lokálním racku podle limitu CPU (počet modulů, u FX5 i body),
 * přebytek do vzdálených stanic s hlavou z katalogu (`plc_coupler`, `hw.head` = sběrnice modulů);
 * platforma bez vzdálených I/O v katalogu = signály „nevejdou se“ (validateProject: chyba).
 *
 * Adresy: e.addr je uložené přiřazení kanálu (kanonicky, v sestavě platformy hardwaru `hwPlatform`).
 * Značka `prj.hw` = {plat, ver} říká, že adresy patří této platformě a verzi pravidel — jen pak se
 * berou jako připnutí (ruční volba uživatele / import); bez značky (starší projekt) nebo po změně
 * platformy hardwaru se přidělí znovu (pořadí signálů zůstane). Adresa, která není kanálem sestavy
 * (import ze skutečného stroje, ruční zápis), se respektuje — kód ji použije, signál dostane volný kanál
 * ve výkresech a validace upozorní (`foreign`).
 */
import type { Project, IoEntry, IoModule, Dir, PlatformKey } from "./model.js";
import { type CatalogBrand } from "./catalog.js";
/** Verze pravidel sestavy — změna přidělí adresy starších projektů znovu (viz `prj.hw`). */
export declare const HW_VER = 1;
export declare const HW_DIRS: Dir[];
export type HwKind = "cpu" | "head" | "io" | "acc";
export interface HwChannel {
    mod: HwModule;
    dir: Dir;
    no: number;
    /** kanonická adresa kanálu (Siemens notace) v sestavě */
    addr: string;
    io?: IoEntry;
    /** signál má vlastní adresu, která není kanálem sestavy (respektuje se v kódu) */
    foreign?: boolean;
}
export interface HwModule {
    /** stabilní identita fyzického modulu: „S<stanice>.<slot>“ (klíč `prj.moduleGuids`); vestavěné I/O „S0.B“ */
    key: string;
    kind: HwKind;
    station: number;
    /** pozice v racku (PositionNumber) */
    slot: number;
    /** označení dle IEC 81346 (-A1, -A2.1, -A12 …) */
    dt: string;
    /** řádek kusovníku, do kterého modul patří (označení skupiny: -A2, -A12 …) */
    bomTag: string;
    /** kategorie katalogu (plc_cpu, plc_di …, plc_coupler, plc_busadapter, plc_server) */
    cat: string;
    /** zvolená položka katalogu; bez ní vlastní / neznámý díl (`custom`) */
    opt?: CatalogBrand;
    custom?: string;
    builtin: boolean;
    /** počet kanálů podle směru */
    ch: Partial<Record<Dir, number>>;
    channels: HwChannel[];
    bus?: string;
    /** GUID z `prj.moduleGuids` (I/O karty a hlavy); vestavěné a příslušenství odvozeně při exportu */
    guid?: string;
    /** dřívější klíč karty (DI1, DO2 …) — migrace GUID ze starších projektů */
    legacy?: string;
}
export interface HwStation {
    no: number;
    remote: boolean;
    /** CPU (stanice 0) nebo hlava vzdálené stanice */
    head: HwModule;
    /** I/O moduly a příslušenství v pořadí slotů (u stanice 0 vč. vestavěných I/O) */
    modules: HwModule[];
    /** síť ke CPU (vzdálené stanice): PROFINET, EtherNet/IP, EtherCAT, Modbus TCP */
    net?: string;
    /** rodina pro AutomationML (System:Device.<rodina>): S71200, ET200SP, Generic */
    family: string;
}
export interface HwIssue {
    level: "error" | "warn" | "info";
    where: string;
    msg: string;
}
export interface HwLayout {
    plat: PlatformKey;
    /** platforma hardwaru projektu (adresy e.addr patří jí) */
    hwPlat: boolean;
    scheme: "s71200" | "linear";
    cpu: HwModule;
    stations: HwStation[];
    /** všechny moduly v pořadí (stanice, slot) */
    modules: HwModule[];
    /** kanálové skupiny (modul × směr, jen obsazené) — výkresy, svorkovnice */
    groups: IoModule[];
    ch: Map<IoEntry, HwChannel>;
    /** signály, které se do platformy nevejdou (bez kanálu) */
    overflow: IoEntry[];
    issues: HwIssue[];
    /** CPU zvolil PLCdesk (uživatel ho v kusovníku nevybral) */
    autoCpu: boolean;
}
/** Platforma hardwaru projektu: volba v kusovníku, jinak první zvolená platforma. */
export declare function hwPlatform(prj: Project): PlatformKey;
/** Id řádku kusovníku (označení skupiny + kategorie) — volby uživatele `prj.bom.lines`. */
export declare const hwLineId: (tag: string, cat: string) => string;
/** Sestava hardwaru pro platformu (výchozí = platforma hardwaru projektu). Výsledek je cachovaný. */
export declare function hwLayout(prj: Project, plat?: PlatformKey): HwLayout;
/** Kanál signálu v sestavě platformy. */
export declare function hwChannel(prj: Project, plat: PlatformKey, e: IoEntry): HwChannel | undefined;
/** Kanonická adresa signálu (Siemens notace) v sestavě platformy; „“ = signál se nevešel. */
export declare function hwAddr(prj: Project, plat: PlatformKey, e: IoEntry): string;
/** Adresa v notaci platformy (do kódu): Siemens %I0.0, CODESYS %IX0.0 / %IW32, FX5 X10; jinak „“. */
export declare function hwNative(prj: Project, plat: PlatformKey, e: IoEntry): string;
/** Označení kanálu pro lidi: „-A2.1 DI 3“ (platformy bez absolutních adres). */
export declare function hwChannelText(prj: Project, plat: PlatformKey, e: IoEntry): string;
/** Rockwell: alias na bod modulu Compact 5000 I/O — Local:<slot>:I.Pt00.Data, vzdálené RIO<n>:<slot>:… */
export declare function lxSpecOf(k: HwChannel | undefined): string;
/** Adresa pro dokumentaci a výkresy v platformě hardwaru: notace platformy, Rockwell alias, jinak kanál. */
export declare function hwAddrText(prj: Project, e: IoEntry, plat?: PlatformKey): string;
/**
 * Přidělí adresy (autoAddr): e.addr = kanál sestavy platformy hardwaru. Bez `force` zůstávají
 * připnuté a cizí adresy (značka `prj.hw` platí); `force` = přečíslovat vše podle pořadí.
 */
export declare function hwAssign(prj: Project, force: boolean): void;
/** Kanálové skupiny modulů platformy hardwaru (výkresy, svorkovnice, FDS). */
export declare function hwGroups(prj: Project, plat?: PlatformKey): IoModule[];
/** Nálezy sestavy pro validaci: nevejde se (všechny platformy projektu), cizí adresy (platforma hardwaru). */
export declare function hwIssues(prj: Project): HwIssue[];
/** Krátký popis modulu pro lidi: typ z katalogu, jinak kategorie. */
export declare function hwTypeText(m: HwModule, t0?: (cs: string) => string): string;
/** Signál kanálu podle katalogu (výkresy): např. „0–10 V“ u vestavěných analogů S7-1200. */
export declare function hwSignalText(m: HwModule | undefined, d: Dir): string;
/** Texty sestavy pro lidi (FDS, README): stanice a moduly. */
export declare function hwSummary(prj: Project, plat?: PlatformKey): string[];
