import { type Project, type Device, type DeviceClass, type DoRole, type PosRecord, type Dir, type SeqStep, type ValidationIssue } from "./model.js";
import { type AxisCfg, type AxisPos } from "./axis.js";
export interface EditResult {
    ok: boolean;
    /** Proč úprava neprošla (projekt beze změny). */
    error?: string;
    /** renameDevice: ručně změněné tagy, které zůstaly beze změny. */
    keptTags?: string[];
    /** setDeviceDesc / setDeviceRange: tagy signálů s ručním komentářem (komentář beze změny). */
    keptCmts?: string[];
    /** setDeviceOpts: odebrané a přidané signály (tagy). */
    removed?: string[];
    added?: string[];
    /** setDeviceOpts: indexy kroků sekvence zařízení, které čekaly na zpětné hlášení a o vstup přišly. */
    affectedSteps?: number[];
    /** insertStep / duplicateStep: index nového kroku. */
    index?: number;
    /** setIoTag / setIoAddr: uložená hodnota. */
    value?: string;
    /** addDevice: id nového zařízení. */
    id?: number;
    /** fixIoTags / renumberIo: počet změněných tagů / přečíslovaných signálů. */
    count?: number;
    /** applyAiProposal: označení od AI, která se musela změnit (duplicita, neplatný identifikátor). */
    renamed?: Array<{
        from: string;
        to: string;
    }>;
    /** applyAiProposal: kroky návrhu AI, které se nepřevzaly (důvod pro uživatele, číslo kroku návrhu). */
    dropped?: string[];
    /** Nálezy kontroly návrhu, které se úpravy týkají (zařízení, krok, signál). */
    issues?: ValidationIssue[];
}
/** Výchozí tag signálu (jako `syncIO`). */
export declare function defaultTag(d: Pick<Device, "name">, sig: string): string;
/** Výchozí komentář signálu v aktuálním jazyce (jako `syncIO`): „popis – popisek signálu“. */
export declare function defaultCmt(d: Device, sig: string): string;
/**
 * Proč označení zařízení nejde použít (`null` = v pořádku). Stejná pravidla jako `validateProject`:
 * identifikátor IEC, nejvýš 32 znaků, bez „__“ a „_“ na konci, jedinečné bez ohledu na velikost písmen.
 */
export declare function deviceNameProblem(prj: Project, name: string, skipId?: number): string | null;
/**
 * Přejmenuje zařízení. Výchozí tagy jeho signálů (`<staré>_<signál>`) dostanou nové označení,
 * ručně změněné zůstanou (vrací je v `keptTags`). GUID, adresy, kroky, E-stop a blokování
 * (vazby přes id) se nemění; výsledky oživení a úpravy bezpečnostních funkcí, které nesou
 * označení v klíči, se převedou na nové označení. Schválení se zneplatní samo (otisk obsahu).
 */
export declare function renameDevice(prj: Project, devId: number, newName: string): EditResult;
/** Změní popis zařízení; výchozí komentáře jeho signálů (a výchozí NC) se přepíšou, ruční zůstanou. */
export declare function setDeviceDesc(prj: Project, devId: number, desc: string): EditResult;
/** Skutečný stav všech voleb třídy zařízení (chybějící klíč = výchozí podle `devSignals`). */
export declare function deviceOpts(d: Device): Record<string, boolean>;
/**
 * Změní volby zařízení (zpětná hlášení, vstup poruchy, směr…). Nové signály dostanou kanál
 * sestavy (`syncIO`), ostatní si adresu nechají; odebrané signály zmizí (`removed`). Kroky
 * zařízení s přechodem na zpětné hlášení, které přišly o vstup, vrací `affectedSteps`.
 */
export declare function setDeviceOpts(prj: Project, devId: number, opt: Record<string, boolean>): EditResult;
/**
 * Změní jednotku a rozsah analogového zařízení (analog, měnič, proporcionální ventil).
 * Výchozí komentáře signálů s jednotkou se přepíšou, ruční zůstanou.
 */
export declare function setDeviceRange(prj: Project, devId: number, range: {
    unit?: string;
    rmin?: number;
    rmax?: number;
}): EditResult;
/**
 * Proč krok nejde uložit (`null` = v pořádku): zařízení existuje, akce patří jeho třídě, čas je
 * kladný (nejvýš 24 h), záznam pohonu v rozsahu, osa má cíl / dráhu / nenulovou rychlost.
 * Ostatní (rozsahy, limity os, platformy) hlásí kontrola návrhu.
 */
export declare function stepProblem(prj: Project, step: Partial<SeqStep>): string | null;
/**
 * Uloží změněný krok `index` (stejná kontrola jako při přidání). Krok s akcí (`act`) = celý nový krok
 * (formuláře posílají jen vyplněná pole); bez akce = částečná změna sloučená s původním krokem
 * (např. jen `{ timeS }` nebo `{ dev }` — akce zůstane a kontrola řekne, jestli ke zařízení patří).
 */
export declare function updateStep(prj: Project, index: number, step: Partial<SeqStep>): EditResult;
/** Vloží krok za krok `afterIndex` (−1 = na začátek, za poslední / mimo = na konec). */
export declare function insertStep(prj: Project, afterIndex: number, step: Partial<SeqStep>): EditResult;
/** Zkopíruje krok `index` hned za něj. */
export declare function duplicateStep(prj: Project, index: number): EditResult;
/** Změní tag signálu; prázdný = výchozí `<označení>_<signál>`. Nálezy (diakritika, duplicita) vrací v `issues`. */
export declare function setIoTag(prj: Project, key: string, tag: string): EditResult;
/** Změní komentář signálu (prázdný = výchozí podle zařízení). */
export declare function setIoCmt(prj: Project, key: string, cmt: string): EditResult;
/**
 * Převede ruční adresu na kanonickou (Siemens notace) — přijme Siemens notaci (%I0.0, %Q1.7,
 * %IW64, %QW80; i bez % a německé E/A) a notaci platformy hardwaru, kterou jde jednoznačně
 * převést (CODESYS %IX0.0 / %QX0.0, Mitsubishi X10 / Y7). `%IW` / `%QW` se bere vždy jako Siemens
 * (bajtová adresa). Vrací `null`, když adresa nepasuje ke směru signálu.
 */
export declare function parseIoAddr(prj: Project, dir: Dir, addr: string): string | null;
/**
 * Ruční adresa signálu: platná adresa kanál sestavy připne (adresa mimo sestavu zůstane
 * s upozorněním kontroly), prázdná = přidělit automaticky. Neplatný zápis nebo adresa, kterou
 * už má jiný signál, = chyba (projekt beze změny).
 */
export declare function setIoAddr(prj: Project, key: string, addr: string): EditResult;
/** Proč rozsah analogu nejde použít (`null` = v pořádku): čísla, REAL, minimum < maximum. */
export declare function rangeProblem(rmin: number, rmax: number): string | null;
/** Číselné parametry zařízení (formuláře kroku Zařízení ve webu i desktopu). */
export type DeviceParamKey = "limLo" | "limHi" | "setpoint" | "rampS" | "tol" | "tolTimeS" | "selBits" | "travelS";
/** Popisky číselných parametrů (klíče překladu). */
export declare const DEVICE_PARAM_LABEL: Record<DeviceParamKey, string>;
/** Které číselné parametry třída má (pořadí = pořadí polí ve formuláři). */
export declare const DEVICE_PARAMS: Partial<Record<DeviceClass, DeviceParamKey[]>>;
/**
 * Parametry zařízení z formuláře. `null` = nezadáno → klíč se ze zařízení odebere; klíč, který
 * v objektu není, se nemění. `axis` se slučuje se stávající konfigurací osy (`null` u pole =
 * výchozí z `axisCfgOf`), `positions` ji nahradí celou.
 */
export interface DeviceParams {
    limLo?: number | null;
    limHi?: number | null;
    setpoint?: number | null;
    rampS?: number | null;
    tol?: number | null;
    tolTimeS?: number | null;
    selBits?: number | null;
    travelS?: number | null;
    role?: DoRole | "" | null;
    /** jen servoosa (třídy s rozsahem mění jednotku přes setDeviceRange); prázdná = mm */
    unit?: string | null;
    records?: PosRecord[] | null;
    axis?: {
        [K in keyof AxisCfg]?: AxisCfg[K] | null;
    } | null;
}
/**
 * Proč hodnoty parametrů zařízení nejdou uložit (`null` = v pořádku). Kontroluje jen klíče v `p`
 * (u mezí i druhou mez zařízení `d`): čísla a rozsah REAL, mez min < mez max, rampa 0–3600 s,
 * tolerance a doba odchylky ventilu, bity výběru záznamu 1–6, doba jízdy, role výstupu, pole osy.
 * Stejné meze jako kontrola návrhu (`validateProject`) — formuláře je hlásí hned při zadání.
 */
export declare function deviceParamsProblem(d: Pick<Device, "cls"> & Partial<Device>, p: DeviceParams): string | null;
/**
 * Uloží parametry zařízení (meze, žádaná hodnota, rampa, tolerance, bity výběru záznamu, doba jízdy,
 * role výstupu, záznamy pohonu, konfigurace osy) po kontrole `deviceParamsProblem`. Změna bitů výběru
 * záznamu mění signály pohonu (`syncIO`, vrací `added` / `removed`).
 */
export declare function setDeviceParams(prj: Project, devId: number, params: DeviceParams): EditResult;
/** Nové zařízení z formuláře: třída, označení (prázdné = další volné), popis, volby, jednotka a rozsah, parametry. */
export interface NewDevice extends DeviceParams {
    cls: DeviceClass;
    name?: string;
    desc?: string;
    opt?: Record<string, boolean>;
    unit?: string;
    rmin?: number;
    rmax?: number;
    libType?: string;
}
/**
 * Přidá zařízení po kontrole označení (`deviceNameProblem`), rozsahu (`rangeProblem`, jen třídy
 * s rozsahem) a parametrů (`deviceParamsProblem`). Dostane id, GUID a signály (`syncIO`); vrací `id`.
 */
export declare function addDevice(prj: Project, nd: NewDevice): EditResult;
/** Kde program zařízení používá: kroky sekvence (počet), vstup E-stop, blokovací vstup. */
export declare function deviceUsage(prj: Project, devId: number): {
    steps: number;
    estop: boolean;
    lock: boolean;
    used: boolean;
};
/** Odebere zařízení i s jeho kroky sekvence, vazbou E-stop a blokováním; signály zmizí (`syncIO`). */
export declare function deleteDevice(prj: Project, devId: number): EditResult;
/** Záznamy pohonu z textu formuláře; nesrozumitelné části / duplicity = `error` (nic se tiše nezahodí). */
export declare function parseRecordsForm(text: string): {
    records: PosRecord[];
    error: string | null;
};
/** Pojmenované polohy osy z textu formuláře; nesrozumitelné části / duplicity = `error`. */
export declare function parseAxisPositionsForm(text: string): {
    positions: AxisPos[];
    error: string | null;
};
/** Přečísluje adresy všech signálů od nuly podle sestavy hardwaru (ruční připnutí se zahodí). */
export declare function renumberIo(prj: Project): EditResult;
/** Opraví tagy na přenositelné (ASCII identifikátor, `sanitizeTag`) a jedinečné; vrací počet změněných. */
export declare function fixIoTags(prj: Project): EditResult;
/** Výchozí časy modelu stroje (sim.ts): rozběh motoru, přestavení ventilu [s]. */
export declare const SIM_MODEL_DEFAULT: {
    readonly motorDelay: 0.5;
    readonly valveTravel: 1;
};
/** Rozsah času modelu stroje zadaného v UI [s] (validace pustí nejvýš 3600 s; UI drží rozumnou mez). */
export declare const SIM_MODEL_RANGE: {
    readonly min: 0.05;
    readonly max: 600;
};
/**
 * Časy modelu stroje `prj.sim` (rozběh motoru, přestavení ventilu) — ovlivňují ověření simulací,
 * takt a dokumenty. Web i desktop zadávají totéž: číslo 0,05…600 s (desetinná čárka i tečka);
 * prázdné / nezadané pole = beze změny.
 */
export declare function setSimModel(prj: Project, model: {
    motorDelay?: unknown;
    valveTravel?: unknown;
}): EditResult;
/**
 * Projekt bez obsahu (žádná zařízení, název ani popis) — jeho nahrazení (nový projekt, otevření
 * souboru, příklad) se neptá. Konverzaci kroku AI návrh (stav klienta) přidá klient.
 */
export declare function projectIsEmpty(prj: Project): boolean;
/** Zařízení návrhu AI (výstup `aiNorm` z apps/web/src/ai.js). */
export interface AiProposalDevice extends Partial<Omit<Device, "id" | "name" | "cls">> {
    name: string;
    cls: DeviceClass;
}
/** Návrh AI (`aiNorm`): zařízení, E-stop a blokování podle označení, sekvence, takt. */
export interface AiProposal {
    devices: AiProposalDevice[];
    estop?: string;
    interlocks?: string[];
    seq?: Array<{
        dev: string;
        act: string;
        cond?: string;
        timeS: number;
        sp?: number;
        rec?: number;
        rev?: boolean;
        posRef?: string;
        pos?: number;
        vel?: number;
        acc?: number;
        dec?: number;
    }>;
    takt?: number | null;
}
/**
 * Převezme návrh AI do projektu (nahradí zařízení, E-stop, blokování a sekvenci; takt jen když ho
 * AI navrhla). Zařízení, které v návrhu zůstalo (stejné označení a třída), si nechá VŠECHNA svá pole
 * (GUID — identita pro export EPLAN —, knihovní typ, záznamy, konfiguraci osy…) a přepíšou se jen
 * hodnoty, které AI poslala; jeho signály si nechají adresu, komentář, NC a GUID (úpravy z kroku I/O),
 * změněný popis se propíše do komentáře. Duplicitní (i jen velikostí písmen) nebo neplatné označení
 * od AI dostane další volné (`renamed`). Kroky na neznámé zařízení se zahodí, čekání jen na třídu DI.
 * Vrací `issues` = chyby kontroly návrhu po převzetí.
 */
export declare function applyAiProposal(prj: Project, pr: AiProposal): EditResult;
