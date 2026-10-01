/**
 * PLC Studio — datový model návrhu a odvozování I/O.
 * Čistý TypeScript bez závislostí; logika přenesená z prototypu (artifact v8).
 */
export type PlatformKey = "siemens" | "rockwell" | "beckhoff" | "codesys" | "mitsubishi" | "schneider" | "omron";
export type DeviceClass = "Motor" | "Ventil" | "AnalogIn" | "AnalogOut" | "DI" | "DO";
export type Dir = "DI" | "DO" | "AI" | "AO";
export type SeqAct = "start" | "stop" | "open" | "close" | "wait";
export type SeqCond = "fbk" | "time";
export interface PlatformInfo {
    name: string;
    ide: string;
    cpu: string;
    lang: string;
    imp: string;
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
}
export interface IoEntry {
    key: string;
    devId: number;
    sig: string;
    dir: Dir;
    tag: string;
    addr: string;
    cmt: string;
    nc?: boolean;
}
export interface SeqStep {
    dev: number;
    act: SeqAct;
    cond: SeqCond;
    timeS: number;
}
export interface ProgramCfg {
    modes: boolean;
    estop: number | "";
    seq: SeqStep[];
}
export interface Project {
    meta: {
        name: string;
        desc: string;
    };
    platforms: PlatformKey[];
    devices: Device[];
    io: IoEntry[];
    program: ProgramCfg;
    nextId: number;
}
export interface IoModule {
    dir: Dir;
    idx: number;
    ch: IoEntry[];
}
export declare const PLAT: Record<PlatformKey, PlatformInfo>;
export declare const IECPLATS: PlatformKey[];
export declare const CLS: Record<DeviceClass, {
    prefix: string;
    label: string;
    opts: Record<string, string>;
}>;
export declare function stripDia(s: string): string;
export declare function esc(s: unknown): string;
export declare const xmlEsc: typeof esc;
export declare function blankProject(): Project;
export declare function devById(prj: Project, id: number | ""): Device | undefined;
export declare function nextName(prj: Project, cls: DeviceClass): string;
export declare function instName(d: Device): string;
export declare function usedClasses(prj: Project): Set<DeviceClass>;
export declare function ioOf(prj: Project, dev: Device): Record<string, IoEntry>;
export declare function devSignals(d: Device): Array<[sig: string, dir: Dir, label: string]>;
/** Synchronizuje I/O tabulku se zařízeními; existující řádky (edity) zachová. */
export declare function syncIO(prj: Project): void;
/** Doplní (force=true: přepíše) adresy v Siemens notaci. */
export declare function autoAddr(prj: Project, force: boolean): void;
export declare function dtFor(e: IoEntry): "BOOL" | "INT";
/** Převod kanonické (Siemens) adresy na notaci cílové platformy. */
export declare function addrFor(plat: PlatformKey, e: IoEntry): string;
export declare function addrOrd(e: IoEntry): number;
/** Rozdělení I/O do modulů (DI16 / DO16 / AI8 / AO4) pro schémata a FDS. */
export declare function modules(prj: Project): IoModule[];
export interface ValidationIssue {
    level: "error" | "warn";
    where: string;
    msg: string;
}
/** Tag bezpečný pro všechny platformy: ASCII, bez mezer, nezačíná číslicí. */
export declare function sanitizeTag(tag: string): string;
export declare function validateProject(prj: Project): ValidationIssue[];
