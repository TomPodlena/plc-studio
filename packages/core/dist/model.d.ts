/**
 * PLCdesk — datový model návrhu a odvozování I/O.
 * Čistý TypeScript bez závislostí; logika přenesená z prototypu (artifact v8).
 */
import type { SolutionConcept } from "./concept.js";
import type { ApprovalRecord } from "./approval.js";
import type { CommissioningRecord } from "./commission.js";
import type { SafetyCfg } from "./safety.js";
import type { RevisionRecord } from "./revision.js";
import type { QuoteCfg } from "./quote.js";
import type { CompanyLibrary } from "./library.js";
import { type HwModule } from "./hardware.js";
import { type AxisCfg } from "./axis.js";
import { type CdsProfileKey } from "./codesys_profiles.js";
export type PlatformKey = "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron" | "unitronics" | "wago" | "delta" | CdsProfileKey;
/** Styl generovaného kódu: klasické FB (výchozí) nebo OOP (rozhraní, dědičnost) — viz codegen_oop.ts. */
export type CodeStyle = "classic" | "oop";
export type DeviceClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "DI" | "DO" | "Vfd" | "PosDrive" | "PropValve" | "Axis";
export type Dir = "DI" | "DO" | "AI" | "AO";
/**
 * Akce kroku: povel motoru / ventilu, výdrž, nebo čekání na digitální vstup (DI = TRUE / FALSE).
 * Měnič (Vfd): start (otáčky `sp`, směr `rev`) / stop; polohovací pohon (PosDrive): home
 * (referování) / posRecord (jízda na záznam `rec`); proporcionální ventil (PropValve):
 * setPressure / setFlow (žádaná hodnota `sp` — obě akce se chovají stejně, liší se popisem).
 */
export type SeqAct = "start" | "stop" | "open" | "close" | "wait" | "waitOn" | "waitOff" | "home" | "posRecord" | "setPressure" | "setFlow" | "moveAbs" | "moveRel" | "velocity" | "halt" | "waitInPos";
/** Vazba digitálního výstupu na stav stroje (generuje se do programu i do simulace). */
export type DoRole = "run" | "fault" | "ready" | "stopped" | "lock" | "auto";
export type SeqCond = "fbk" | "time";
export interface PlatformInfo {
    name: string;
    ide: string;
    cpu: string;
    lang: string;
    imp: string;
    /** Profil jiné platformy (WAGO, Delta AX = CODESYS V3.5): stejný dialekt, adresy i emulátor. */
    base?: PlatformKey;
    /** Platforma umí styl kódu OOP (INTERFACE / METHOD / PROPERTY / EXTENDS). */
    oop?: boolean;
}
export interface Device {
    id: number;
    name: string;
    cls: DeviceClass;
    desc: string;
    opt: Record<string, boolean>;
    unit: string;
    rmin: number;
    rmax: number;
    /** AnalogIn: meze v jednotkách; překročení = porucha stroje (alarm A_<dev>_HI / _LO). */
    limHi?: number;
    limLo?: number;
    /** AnalogOut: žádaná hodnota v jednotkách (konstanta zapisovaná programem). */
    setpoint?: number;
    /** DO: vazba výstupu na stav stroje (maják chod/porucha, zámek krytů…). */
    role?: DoRole;
    /**
     * Vfd / PropValve: rampa žádané hodnoty v PLC [s] na celý rozsah (rmin → rmax), po taktech
     * 0,1 s; 0 / bez zadání = bez rampy (rampu dělá měnič / ventil sám).
     */
    rampS?: number;
    /** PropValve se zpětnou vazbou: povolená odchylka skutečné hodnoty [jednotky] a doba [s], po které je odchylka porucha. */
    tol?: number;
    tolTimeS?: number;
    /** PosDrive: počet bitů výběru záznamu (1–6 → záznamy 1 … 2^n − 1; 0 = referenční poloha). */
    selBits?: number;
    /** PosDrive: tabulka záznamů (jen dokumentace — záznamy žijí v pohonu: poloha, rychlost). */
    records?: PosRecord[];
    /** PosDrive: model stroje pro simulaci — doba jízdy na záznam / referování [s]. */
    travelS?: number;
    /**
     * Axis: konfigurace servoosy (konfigurační list — nastavuje se v IDE: TO, osa NC / SoftMotion,
     * Axis Settings, Motion Group); chybějící pole doplní `axisCfgOf` (axis.ts). Jednotky = `unit`.
     */
    axis?: Partial<AxisCfg>;
    /** typ z firemní knihovny (`LibDeviceType.id`, viz library.ts) */
    libType?: string;
    /** Trvalý identifikátor (viz guid.ts) — přidělen jednou při vzniku, export ho jen čte. */
    guid?: string;
}
export interface IoEntry {
    key: string;
    devId: number;
    sig: string;
    dir: Dir;
    tag: string;
    /**
     * Přidělený kanál jako kanonická adresa (Siemens notace, %I0.0 / %IW64) v sestavě hardwaru
     * platformy `prj.hw.plat` (hardware.ts). Výstupy čtou adresu ze sestavy (`addrFor`, `hwAddrText`).
     */
    addr: string;
    cmt: string;
    nc?: boolean;
    /** Trvalý identifikátor (viz guid.ts): odvozený z GUID zařízení a signálu při vzniku řádku. */
    guid?: string;
}
export interface SeqStep {
    dev: number;
    act: SeqAct;
    cond: SeqCond;
    timeS: number;
    /** Vfd start: žádané otáčky [jednotky zařízení]; PropValve: žádaná hodnota. Bez zadání = `Device.setpoint`. */
    sp?: number;
    /** Vfd start: směr vzad (výstup outRev). */
    rev?: boolean;
    /** PosDrive posRecord: číslo záznamu (1 … 2^selBits − 1). */
    rec?: number;
    /** Axis moveAbs: cílová poloha (nebo `posRef` = jméno pojmenované polohy osy); moveRel: dráha. */
    pos?: number;
    posRef?: string;
    /** Axis: rychlost (velocity: se znaménkem = směr), zrychlení, zpomalení; bez zadání = výchozí z konfigurace osy. */
    vel?: number;
    acc?: number;
    dec?: number;
}
/** Záznam polohovacího pohonu (dokumentace tabulky v pohonu). */
export interface PosRecord {
    no: number;
    name: string;
    pos?: number;
    vel?: number;
}
export interface ProgramCfg {
    modes: boolean;
    estop: number | "";
    seq: SeqStep[];
    /**
     * Blokovací vstupy (kryty, světelná závora, tlak vzduchu…): DI zařízení, která jsou spolu
     * s E-stopem součástí `enable` — FALSE zastaví stroj (výstupy vypnout, sekvence do kroku 0).
     * Funkční blokování v běžném programu, NE bezpečnostní funkce. Starší projekty pole nemají.
     */
    interlocks?: number[];
}
export interface Project {
    /**
     * `takt` = požadovaná doba cyklu [s]; ověření ji porovná se simulovaným cyklem.
     * `number` = číslo projektu / zakázky, `customer` = zákazník (volný text, nepřekládá se; do výkresů,
     * hlaviček dokumentů, README a názvů souborů — ne do kódu PLC; viz project_meta.ts).
     * `startDate` = datum zahájení projektu (ISO YYYY-MM-DD; dokumenty, README, výkresy).
     * `dataDir` = kořenová složka dat projektu na disku (jen desktop; web ji jen zachová).
     * `desc` smí být víceřádkový. Prázdná / chybějící pole = výstup jako dřív.
     */
    meta: {
        name: string;
        desc: string;
        takt?: number;
        number?: string;
        customer?: string;
        startDate?: string;
        dataDir?: string;
    };
    platforms: PlatformKey[];
    devices: Device[];
    io: IoEntry[];
    program: ProgramCfg;
    nextId: number;
    /** Model stroje pro simulaci: doba rozběhu motoru a přestavení ventilu [s]. */
    sim?: {
        motorDelay?: number;
        valveTravel?: number;
    };
    /** Kusovník: platforma HW, značka po kategoriích, úpravy řádků (klíč = `BomLine.id`). */
    bom?: BomCfg;
    /** Zvolený koncept řešení z AI nadstavby (viz concept.ts); null = zatím nezvolen. */
    concept?: SolutionConcept | null;
    /** Schválení položek návrhu (klíč = `ApprovalItem.key`, viz approval.ts). Bez záznamu = neschváleno. */
    approvals?: Record<string, ApprovalRecord>;
    /** Výsledky kroků oživení (klíč = `CommissioningStep.id`, viz commission.ts). */
    commissioning?: Record<string, CommissioningRecord>;
    /** Bezpečnostní funkce: parametry výpočtu, volby a úpravy návrhu (viz safety.ts). */
    safety?: SafetyCfg;
    /** Nabídka (interní): ceník, sazby, parametry odhadu hodin (viz quote.ts). */
    quote?: QuoteCfg;
    /** Kopie firemní knihovny (typy zařízení, šablony FB, hlavička; viz library.ts). */
    library?: CompanyLibrary;
    /** Revize projektu (nejstarší první): zmrazený obsah a stav schválení (viz revision.ts). */
    revisions?: RevisionRecord[];
    /** Trvalý identifikátor projektu (viz guid.ts) — přidělen v `blankProject`, export ho jen čte. */
    guid?: string;
    /**
     * GUID fyzických modulů sestavy (I/O karty, hlavy vzdálených stanic) podle klíče „S<stanice>.<slot>“
     * (hardware.ts `HwModule.key`, guid.ts). Starší klíče „<směr><pořadí>“ (DI1…) se při načtení převedou.
     */
    moduleGuids?: Record<string, string>;
    /**
     * Značka adres: `io[].addr` patří sestavě platformy `plat` podle pravidel verze `ver` (hardware.ts
     * `HW_VER`) — jen pak jsou připnutím. Chybí u starších projektů → adresy se přidělí znovu.
     */
    hw?: {
        plat: PlatformKey;
        ver: number;
    };
    /**
     * Styl kódu (výchozí classic). OOP platí jen pro platformy s `PLAT[…].oop` (CODESYS, TwinCAT,
     * Schneider, WAGO, Delta AX); ostatní platformy ho ignorují. Chování programu je v obou
     * stylech stejné (stejný IR, stejné šablony bloků) — liší se jen zápis.
     */
    codeStyle?: CodeStyle;
}
export interface BomLineCfg {
    brand?: string;
    type?: string;
    orderCode?: string;
    supplier?: string;
    qty?: number;
    note?: string;
}
export interface BomCfg {
    plat?: PlatformKey;
    brand?: Record<string, string>;
    lines?: Record<string, BomLineCfg>;
}
/**
 * Kanálová skupina modulu (modul × směr) ze sestavy hardware.ts — jeden list zapojení a jedna
 * svorkovnice X<n>. `ch[i]` je na kanálu `chNo[i]` modulu `hw`; `idx` = pořadí skupiny ve směru (DI1…).
 */
export interface IoModule {
    dir: Dir;
    idx: number;
    ch: IoEntry[];
    /** čísla kanálů modulu pro `ch` (stejná délka) */
    chNo?: number[];
    /** počet kanálů tohoto směru na modulu (katalog) */
    cap?: number;
    /** fyzický modul sestavy */
    hw?: HwModule;
    /** GUID fyzického modulu z `Project.moduleGuids` (klíč `hw.key`). */
    guid?: string;
}
export declare const PLAT: Record<PlatformKey, PlatformInfo>;
/** Základ platformy: profil (WAGO, Delta AX) → „codesys“, jinak platforma sama. */
export declare function platBase(plat: PlatformKey): PlatformKey;
/** Rodina CODESYS (GVL_IO, PLCopen XML, adresy %IX / %IW): CODESYS a jeho profily, TwinCAT, Schneider. */
export declare function isCodesysFamily(plat: PlatformKey): boolean;
/** Platforma umí styl kódu OOP. */
export declare function supportsOop(plat: PlatformKey): boolean;
/** Styl kódu, který pro platformu skutečně platí (OOP jen kde ho platforma umí). */
export declare function codeStyleFor(prj: Project, plat: PlatformKey): CodeStyle;
/** Tabulka platforem s texty v nastaveném jazyce (`PLAT` drží české klíče překladu). */
export declare function platInfo(): Record<PlatformKey, PlatformInfo>;
export declare const IECPLATS: PlatformKey[];
export declare const CLS: Record<DeviceClass, {
    prefix: string;
    label: string;
    opts: Record<string, string>;
}>;
/** Pohony a proporcionální prvky fáze 2a (blok s analogovou žádanou / výběrem záznamu). */
export declare function isMotionClass(cls: DeviceClass): boolean;
/** Servoosa (fáze 2b). */
export declare function isAxisClass(cls: DeviceClass): boolean;
/** Akce kroku servoosy. */
export declare function isAxisAct(act: SeqAct): boolean;
/**
 * Cíl kroku osy: moveAbs = poloha (pojmenovaná `posRef` má přednost), moveRel = dráha,
 * velocity = rychlost se znaménkem; jinak 0.
 */
export declare function stepAxisTarget(s: SeqStep, d: Device | undefined): number;
/** Třídy s analogovým rozsahem (rmin / rmax / jednotka). */
export declare function hasRange(cls: DeviceClass): boolean;
/** Akce kroku, které třída zařízení umí (UI editoru kroků, validace). `wait` nemá zařízení. */
export declare const ACTS_FOR: Record<DeviceClass, SeqAct[]>;
/** Je akce proporcionálního ventilu (žádaná hodnota)? */
export declare function isSpAct(act: SeqAct): boolean;
/** Výchozí parametry nového zařízení třídy (UI „přidat zařízení“, AI návrhář). */
export declare function devDefaults(cls: DeviceClass): Partial<Device>;
/**
 * Označení přístroje, ke kterému vede signál (výkresy, kusovník, EPLAN): u měniče a polohovacího
 * pohonu řadič -TA<n> (svorky řídicích signálů jsou na řadiči, ne na motoru), jinak zařízení samo.
 */
export declare function devRef(d: {
    name: string;
    cls?: DeviceClass;
}): string;
/** Tabulka záznamů PosDrive jako text pro editaci v UI: „1 = převzetí @ 0; 2 = lis @ 180“. */
export declare function recordsText(recs: PosRecord[] | undefined): string;
/** Zpět z textu (řádky / středníky „číslo = název @ poloha“; poloha nepovinná). Neplatné části přeskočí. */
export declare function parseRecords(s: string): PosRecord[];
/** Počet bitů výběru záznamu PosDrive (1–6, výchozí 3). */
export declare function selBitsOf(d: Device): number;
/** Nejvyšší číslo záznamu PosDrive (2^bity − 1; záznam 0 = referenční poloha). */
export declare function maxRecord(d: Device): number;
/** Doba jízdy PosDrive v modelu simulace [s] (výchozí 1 s). */
export declare function travelOf(d: Device): number;
/**
 * Krok rampy v PLC na jeden takt 0,1 s [jednotky] (Vfd / PropValve); 0 = bez rampy.
 * Zaokrouhleno na 6 platných číslic — generátor píše tentýž literál, simulátor počítá s ním.
 */
export declare function rampStepOf(d: Device): number;
/** Povolená odchylka PropValve [jednotky] (výchozí 3 % rozsahu). */
export declare function tolOf(d: Device): number;
/** Doba odchylky PropValve, po které je porucha, v taktech 0,1 s (výchozí 1 s; nejméně 1 takt). */
export declare function tolTicksOf(d: Device): number;
/** Žádaná hodnota kroku (Vfd start / PropValve): `sp` kroku, jinak výchozí žádaná zařízení. */
export declare function stepSp(s: SeqStep, d: Device | undefined): number;
/** Výchozí žádaná hodnota zařízení (ruční režim, po přerušení sekvence): `setpoint`, jinak 0 / rmin. */
export declare function devSp(d: Device): number;
/** Třídy zařízení s texty v nastaveném jazyce (`CLS` drží české klíče překladu). */
export declare function clsInfo(): Record<DeviceClass, {
    prefix: string;
    label: string;
    opts: Record<string, string>;
}>;
/** Vazby výstupů na stav stroje — popisky (klíče překladu) pro výběr v UI. */
export declare const DO_ROLES: Record<DoRole, string>;
/** Čeká krok na digitální vstup? */
export declare function isDiWait(s: SeqStep): boolean;
export declare function stripDia(s: string): string;
export declare function esc(s: unknown): string;
export declare const xmlEsc: typeof esc;
export declare function blankProject(): Project;
export declare function devById(prj: Project, id: number | ""): Device | undefined;
export declare function nextName(prj: Project, cls: DeviceClass): string;
export declare function instName(d: Device): string;
/** Výraz role výstupu (proměnné strojního bloku přes `L`); `hasSeq` = projekt má sekvenci. */
export declare function roleExpr(role: DoRole, hasSeq: boolean, L: (v: string) => string): string;
/** Blokovací zařízení programu: existující DI, bez E-stopu, bez duplicit, v pořadí projektu. */
export declare function interlockDevs(prj: Project): Device[];
/**
 * Vstupy, ze kterých se skládá `enable` (AND): E-stop a blokovací vstupy.
 * TRUE = v pořádku; FALSE kteréhokoli zastaví stroj. Generátor i simulátor berou odsud.
 */
export declare function enableInputs(prj: Project): Array<{
    dev: Device;
    io: IoEntry;
    estop: boolean;
}>;
export declare function usedClasses(prj: Project): Set<DeviceClass>;
export declare function ioOf(prj: Project, dev: Device): Record<string, IoEntry>;
export declare function devSignals(d: Device): Array<[sig: string, dir: Dir, label: string]>;
/**
 * Synchronizuje I/O tabulku se zařízeními; existující řádky (edity) zachová.
 * Komentář nového signálu vzniká v jazyce nastaveném v okamžiku vytvoření — je to obsah
 * projektu, při přepnutí jazyka se nepřekládá.
 */
export declare function syncIO(prj: Project): void;
/**
 * Doplní chybějící GUID projektu, zařízení, I/O karet a signálů (viz guid.ts); platné nemění.
 * Vrací true, když něco doplnila — při načtení starého projektu ho volající označí jako změněný.
 * Export GUID nikdy negeneruje (jen čte); volá se při vzniku objektů (`syncIO`) a při načtení.
 */
export declare function ensureGuids(prj: Project): boolean;
/**
 * Přidělí adresy podle sestavy hardwaru (hardware.ts `hwAssign`): nové signály dostanou volný kanál,
 * připnuté a cizí adresy zůstanou; `force` = přečíslovat vše (pořadí signálů zůstane).
 */
export declare function autoAddr(prj: Project, force: boolean): void;
export declare function dtFor(e: IoEntry): "BOOL" | "INT";
/** Adresa signálu v notaci cílové platformy — kanál sestavy hardwaru platformy (hardware.ts). */
export declare function addrFor(plat: PlatformKey, e: IoEntry, prj: Project): string;
/** Převod kanonické (Siemens) adresy `a` signálu směru `dir` na notaci cílové platformy. */
export declare function nativeAddr(plat: PlatformKey, a: string, dir: Dir): string;
export declare function addrOrd(e: IoEntry): number;
/**
 * Číslo vodiče kanálu: stovky = svorkovnice X<n> (pořadí kanálové skupiny z `modules()`), zbytek =
 * svorka X<n>:<k> — X1:1 → -W101, X2:3 → -W203, X10:1 → -W1001. Unikátní v celém projektu (skupina
 * má nejvýš 16 kanálů) a stabilní: změna jednoho modulu nepřečísluje vodiče ostatních.
 * Jediný zdroj pro výkresy (SVG/DXF), seznam svorek dokumentace a export EPLAN.
 */
export declare function wireNo(xnum: number, ch: number): string;
/**
 * Kanálové skupiny modulů sestavy hardwaru (hardware.ts): vestavěné I/O CPU, karty lokálního racku
 * a vzdálených stanic, po směrech — pro schémata, svorkovnice a FDS. Počty a typy = kusovník.
 */
export declare function modules(prj: Project): IoModule[];
export interface ValidationIssue {
    /** info = jen upozornění na způsob řešení (nic není potřeba opravit) */
    level: "error" | "warn" | "info";
    where: string;
    msg: string;
}
/** Tag bezpečný pro všechny platformy: ASCII, bez mezer, nezačíná číslicí. */
export declare function sanitizeTag(tag: string): string;
export declare function validateProject(prj: Project): ValidationIssue[];
/**
 * Validace servoos (fáze 2b): podpora platforem projektu, konfigurace osy a kroky s pohybem.
 * Nepodporovaná platforma = chyba (kód se pro ni negeneruje, README vysvětlí proč).
 */
export declare function axisIssues(prj: Project): ValidationIssue[];
