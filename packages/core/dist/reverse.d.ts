/**
 * PLC Studio — import stávajícího zařízení: přesné zpětné zpracování exportů a programů z PLC
 * (bez AI). Společné typy pro jádro i AI vrstvu (apps/web/src/import_ai.js).
 *
 *  extractFiles()   soubory → signály (tagy s kanonickou adresou) + POU (těla programů)
 *  inferProject()   signály + program → projekt (zařízení, I/O, E-stop, blokování, sekvence,
 *                   meze, žádané hodnoty, role DO) s doložením zdroje a jistoty u každé položky
 *  mergeProposals() přesný návrh + návrh AI → jeden návrh (přesné má přednost, rozpory hlásí)
 *
 * Vlastní výstupy generátoru všech 8 platforem se čtou přesně (round-trip), cizí exporty
 * a programy heuristicky (`conf: "guess"`). E-stop a blokování jsou jen signály z výrazu
 * `enable` — žádná bezpečnostní logika se tu neodvozuje ani negeneruje.
 */
import type { Dir, PlatformKey, Project, DeviceClass } from "./model.js";
export type Confidence = "sure" | "guess" | "missing";
export interface SourceRef {
    file: string;
    page?: number;
    line?: number;
    quote?: string;
}
/** Vstupní soubor. Textové formáty má jádro (text), binární (PDF, obrázky) řeší AI vrstva. */
export interface InputFile {
    name: string;
    text?: string;
    mime?: string;
    size?: number;
}
export interface ExtractedSignal {
    tag: string;
    dt: string;
    addr: string;
    cmt: string;
    dir: Dir;
    src: SourceRef;
    dev?: string;
    sig?: string;
    cls?: DeviceClass;
    raw?: string;
}
export interface ExtractedPou {
    name: string;
    kind: "program" | "functionBlock" | "function" | "routine";
    lang: "ST" | "SCL" | "LD" | "FBD" | "other";
    body: string;
    src: SourceRef;
}
export interface FileReport {
    name: string;
    fmt: string;
    ok: boolean;
    signals: number;
    pous: number;
    note?: string;
}
export interface Extracted {
    files: FileReport[];
    signals: ExtractedSignal[];
    pous: ExtractedPou[];
    platform?: PlatformKey;
    unparsed: InputFile[];
    meta?: {
        name?: string;
    };
    skipped?: string[];
}
export interface Evidence {
    conf: Confidence;
    src: SourceRef[];
    note?: string;
}
export interface ImportProposal {
    prj: Project;
    evidence: Record<string, Evidence>;
    conflicts: Array<{
        what: string;
        note: string;
        src: SourceRef[];
    }>;
    missing: string[];
}
/** Časový literál / hodnota → sekundy (T#1S500MS, T#1.5S, TIME#2m, 5000 = ms). */
export declare function parseTimeLit(s: string): number | undefined;
/** Body modulů Rockwell (alias / popis) → kanonické adresy (inverze `lxIoMap`, jinak pořadím). */
export declare function rockwellAddrs(specs: Array<{
    tag: string;
    spec: string;
}>, analog?: Set<string>): {
    addr: Map<string, string>;
    dir: Map<string, Dir>;
    exact: boolean;
};
export declare function extractFiles(files: InputFile[]): Extracted;
/**
 * Odhad zařízení a signálu z jména tagu: náš formát `<Zařízení>_<signál>` přesně,
 * jinak přípona ze slov rolí (M1_Ein, Pump1Fbk, Y1_Open, Motor_Run…).
 */
export declare function splitTag(tag: string, dir?: Dir): {
    dev: string;
    sig?: string;
    sure: boolean;
};
export declare function inferProject(ex: Extracted, base?: Project): ImportProposal;
/**
 * Sloučí přesný návrh `a` (jádro) s návrhem `b` (AI): přesné údaje mají přednost, AI doplní
 * chybějící zařízení, signály, adresy, popisy, E-stop, sekvenci a meta; rozpory jdou do
 * `conflicts`. Zařízení se párují podle označení.
 */
export declare function mergeProposals(a: ImportProposal, b: ImportProposal): ImportProposal;
