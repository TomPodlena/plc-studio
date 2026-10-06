/**
 * Surový rozsah analogu dle platformy (typický modul; TODO ověřit podle skutečného modulu).
 * Samostatný modul, aby ho četl generátor (codegen.ts) i validace (model.ts) bez cyklického importu.
 * Předává se vždy — FX5 nezná počáteční hodnoty a výchozí 27648 je rozsah Siemens.
 */
import { CDS_PROFILES, CDS_PROFILE_KEYS } from "./codesys_profiles.js";
import type { PlatformKey } from "./model.js";

export const RAW_MAX: Partial<Record<PlatformKey, number>> = { beckhoff: 32767, codesys: 32767, mitsubishi: 16000, schneider: 10000, omron: 32000,
  /* WAGO 750-455 (4–20 mA): 0…32767; Delta AS04AD-A: ±32000 — obojí TODO podle modulu */
  wago: 32767, delta: 32000,
  /* profily CODESYS dalších výrobců: rozsah analogového modulu z katalogu (codesys_profiles.ts, README) */
  ...Object.fromEntries(CDS_PROFILE_KEYS.map(k => [k, CDS_PROFILES[k].rawMax])) };

/** Surový rozsah analogu platformy (bez = Siemens 27648 z výchozí hodnoty šablony). */
export function rawMaxFor(plat: PlatformKey): number | undefined { return RAW_MAX[plat]; }

/**
 * Nejhrubší kvantizace analogu napříč platformami projektu (a Siemens 27648, ze kterého počítá simulátor):
 * nejmenší počet kroků rozsahu. Rockwell bere analogy jako REAL v % (bez kvantizace) — nepočítá se.
 */
export function coarsestRaw(plats: PlatformKey[]): number {
  let r = 27648;
  for (const p of plats) if (p !== "rockwell") r = Math.min(r, RAW_MAX[p] ?? 27648);
  return r;
}
