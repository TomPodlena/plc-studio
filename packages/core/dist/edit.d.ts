import { type Project, type Device, type Dir, type SeqStep, type ValidationIssue } from "./model.js";
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
/** Uloží změněný krok `index` (stejná kontrola jako při přidání). */
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
