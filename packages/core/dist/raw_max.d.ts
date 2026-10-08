import type { PlatformKey } from "./model.js";
export declare const RAW_MAX: Partial<Record<PlatformKey, number>>;
/** Surový rozsah analogu platformy (bez = Siemens 27648 z výchozí hodnoty šablony). */
export declare function rawMaxFor(plat: PlatformKey): number | undefined;
/**
 * Nejhrubší kvantizace analogu napříč platformami projektu (a Siemens 27648, ze kterého počítá simulátor):
 * nejmenší počet kroků rozsahu. Rockwell bere analogy jako REAL v % (bez kvantizace) — nepočítá se.
 */
export declare function coarsestRaw(plats: PlatformKey[]): number;
