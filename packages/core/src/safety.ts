/**
 * PLCdesk — bezpečnostní funkce (ISO 13849-1, ISO 13855, IEC 60204-1).
 *
 * „Navrhovat vše, platí jen schválené“: z návrhu stroje se odvodí nebezpečí a bezpečnostní
 * funkce (E-stop, kryty a blokování, zámky krytů, světelné závory, dvouruční ovládání u lisů,
 * ochrana proti neočekávanému rozběhu, STO měničů, bezpečné odvzdušnění pneumatiky, hydraulika,
 * svislá osa, ohřev, tlak…). U každé funkce: spouštěcí událost, reakce s kategorií zastavení,
 * návrh S/F/P se zdůvodněním a PLr z grafu rizik, architektura (kategorie, kanály, EDM, reset),
 * komponenty z katalogu, výpočet dosaženého PL (kategorie × MTTFd × DCavg × CCF, zjednodušená
 * tabulka), bezpečná vzdálenost (ISO 13855, volba vydání, jen ze ZMĚŘENÉ doby doběhu),
 * zkoušky pro validaci a zdroje (URL). Vše jsou NÁVRHY — položky ke schválení (approval.ts),
 * kroky validace jdou do plánu oživení (commission.ts, fáze 10).
 *
 * Standardní program se NEMĚNÍ: E-stop a blokování v něm zůstávají jen stavové signály
 * (enable, kvitace), simulace ani generátor standardního kódu odsud nic nečtou. Bezpečnostní
 * program (safety_prog.ts) vzniká až po schválení funkcí a nese NESCHVÁLENO, dokud ho
 * odpovědná osoba neschválí. Data z rešerše jsou v safety_data.ts (scripts/build_safety.py).
 */
import { Project, Device, IoEntry, PlatformKey, PLAT, devById, ioOf, interlockDevs } from "./model.js";
import { tr, N_ } from "./i18n.js";
import {
  contentHash, registerApprovalProvider, approvalStatus, approvalStatusLabel,
  type ApprovalItem, type ApprovalStatus,
} from "./approval.js";
import { registerCommissioningProvider, type CommissioningStep } from "./commission.js";
import * as D from "./safety_data.js";

/* ================================================================ typy */

export type PL = "a" | "b" | "c" | "d" | "e";
export type SafetyCat = "B" | "1" | "2" | "3" | "4";
export type SafetyTarget = "siemens" | "rockwell" | "plcopen" | "pilz" | "sick" | "schmersal" | "relay";
export type SafetyKind =
  | "estop" | "guard" | "guard_lock" | "light_curtain" | "multibeam" | "scanner" | "mat" | "two_hand"
  | "enabling" | "mode" | "muting" | "restart" | "sto" | "pneumatic" | "hydraulic" | "vertical"
  | "temperature" | "pressure";
export type Iso13855Edition = "2010" | "2024";
export type DistanceMode = "orthogonal" | "multibeam" | "parallel" | "two_hand" | "mat" | "guard";

/** Uživatelské úpravy jedné funkce (`Project.safety.fn[ref]`); co chybí, navrhne aplikace. */
export interface SafetyFnCfg {
  /** Vyřadit navrženou funkci (důvod do `note`) — vyřazení se také schvaluje. */
  off?: boolean;
  S?: "S1" | "S2"; F?: "F1" | "F2"; P?: "P1" | "P2";
  /** Snížení PLr o 1 úroveň (nízká pravděpodobnost výskytu, ISO 13849-1:2023 příl. A) — povinné zdůvodnění. */
  reduce?: string;
  /** PLr převzaté z normy typu C (přebíjí graf rizik); zdroj do `plrSource`. */
  plr?: PL; plrSource?: string;
  stopCat?: 0 | 1 | 2;
  /** Vstupní zařízení (označení DI) a skupiny výstupů (id skupin, např. „KS“, „STO_M3“, „YS“). */
  inputs?: string[]; acts?: string[];
  cat?: SafetyCat;
  /** DC vstupního a výstupního subsystému [%]. */
  dcIn?: number; dcOut?: number;
  /** Splněná opatření proti CCF (id z `SAFETY_CCF_MEASURES`). */
  ccf?: string[];
  /** Komponenty: id z `SAFETY_COMPONENTS` (vstup, logika se volí v `SafetyCfg.logic`, výstup). */
  compIn?: string; compOut?: string;
  /** B10d [cykly] nebo MTTFd [roky] z datasheetu (přebíjí typické hodnoty). */
  b10dIn?: number; b10dOut?: number; mttfdIn?: number; mttfdOut?: number;
  /** Průměrná doba mezi vyžádáními funkce [s] (→ nop). */
  demandS?: number;
  /** ISO 13855: ZMĚŘENÁ doba doběhu stroje [ms] (povinná), reakce zařízení a logiky [ms], rozlišení d [mm], výška pole H [mm], přídavek Z [mm], dosah skrz kryt D_GT [mm]. */
  tStopMs?: number; tDeviceMs?: number; tLogicMs?: number; d?: number; H?: number; Z?: number; DGT?: number;
  /** SS1-t: zpoždění STO [ms] (kategorie zastavení 1). */
  ss1DelayMs?: number;
  note?: string;
}

/** Bezpečnostní data projektu (`Project.safety`): parametry výpočtu, volby a úpravy funkcí. */
export interface SafetyCfg {
  /** Vydání ISO 13855 pro výpočet vzdáleností (výchozí 2010 — harmonizované). */
  iso13855?: Iso13855Edition;
  /** Provozní dny za rok, hodiny za den, doba mise [roky] — vstupy nop a MTTFd (ke schválení). */
  dop?: number; hop?: number; missionYears?: number;
  /** Bezpečnostní logika: id z `SAFETY_COMPONENTS` (relé / bezpečnostní PLC). */
  logic?: string;
  /** Cíl bezpečnostního programu (jinak podle logiky). */
  target?: SafetyTarget;
  fn?: Record<string, SafetyFnCfg>;
  /** Funkce doplněné uživatelem. */
  add?: Array<{ ref: string; kind: SafetyKind; inputs?: string[]; acts?: string[]; title?: string }>;
}

export interface SafetyHazard { id: string; text: string; devs: string[]; fns: string[] }

/** Skupina výstupů (výstupní subsystém): stykače, STO, odvzdušnění, hydraulika, brzda, ohřev. */
export type OutKind = "contactors" | "sto" | "exhaust" | "hydraulic" | "brake" | "heater";
export interface OutGroup {
  id: string; kind: OutKind; devs: string[]; label: string;
  /** Bezpečné výstupy a zpětná hlášení (EDM). */
  outs: string[]; fbk: string[];
  comp: SafetyComponent | null;
}

/** Komponenta subsystému: z katalogu, nebo typická hodnota (tab. C.1) / neznámá. */
export interface SafetyComponent {
  id: string; label: string; brand?: string; series?: string; orderCode?: string;
  plMax?: PL | null; b10d?: number; mttfd?: number; pfhdText?: string; sources: string[];
  /** Hodnota převzatá z typických hodnot normy nebo odvozená z rešerše — potvrdit podle datasheetu. */
  generic?: boolean;
}

export interface SafetySubsystem {
  role: "I" | "L" | "O";
  label: string;
  comp: SafetyComponent | null;
  cat: SafetyCat | null;
  channels: number;
  /** nop [cykly/rok], MTTFd kanálu [roky] (před omezením), DC [%], T10D [roky]. */
  nop: number | null; mttfd: number | null; dc: number; t10d: number | null;
  pl: PL | null;
  /** „calc“ = výpočet z kategorie / MTTFd / DC / CCF; „device“ = PL certifikovaného přístroje. */
  from: "calc" | "device" | "none";
  notes: string[];
}

export interface SafetyRisk {
  S: "S1" | "S2"; F: "F1" | "F2"; P: "P1" | "P2";
  why: { S: string; F: string; P: string };
  graph: PL;
  /** Normová spodní mez (ISO 13850 pro E-stop, ISO 13851 pro dvouruční ovládání). */
  min?: { pl: PL; why: string };
  reduced?: string;
  override?: { pl: PL; source: string };
  plr: PL | null;
  /** PLr z grafu rizik podle návrhu aplikace (před úpravou S/F/P uživatelem). */
  proposed?: PL;
  sources: string[];
}

export interface SafetyDistance {
  edition: Iso13855Edition; mode: DistanceMode;
  S: number | null; T: number | null; K: number | null; C: number | null;
  formula: string; steps: string[]; warnings: string[]; missing: string[]; sources: string[];
}

export interface SafetySignal {
  tag: string; dir: "in" | "out";
  kind: "ch" | "ossd" | "no" | "nc" | "reset" | "fbk" | "q" | "sto" | "lock" | "unlock" | "status";
  dev?: string; text: string;
}

export interface SafetyDesign {
  cat: SafetyCat | null; channels: number; edm: boolean; reset: "manual" | "auto";
  ccf: { ids: string[]; points: number; ok: boolean };
  subs: SafetySubsystem[];
  pl: PL | null; ok: boolean;
  problems: string[];
  signals: SafetySignal[];
  wiring: string[];
}

export interface SafetyTest { id: string; name: string; kind: string; procedure: string; expected: string; sources: string[] }

export interface SafetyFunction {
  /** SF1, SF2… (pořadí návrhu; vyřazené funkce číslo drží). */
  id: string; no: number;
  /** Stabilní odkaz nezávislý na číslování: „estop“, „guard:S2“, „light_curtain:S4“… */
  ref: string; kind: SafetyKind; catalog: string;
  off: boolean; user: boolean;
  title: string; name: string;
  hazards: string[];
  inputs: string[]; acts: string[];
  /** Chybějící zařízení (návrh doplnit), např. „tlačítko nouzového zastavení“. */
  missing: string[];
  trigger: string; reaction: string; safeState: string; modes: string; resetText: string; energyLoss: string;
  stopCat: 0 | 1 | 2; stopWhy: string;
  demandS: number;
  risk: SafetyRisk;
  design: SafetyDesign | null;
  distance: SafetyDistance | null;
  tests: SafetyTest[];
  typical: { plr: string; arch: string; channels: string; edm: string; components: string[] };
  standards: string[]; sources: string[];
  note: string;
  /** Vstupní funkce (E-stop, kryt…) vs. výstupní (STO, odvzdušnění…) a bez programu (tlak). */
  role: "input" | "output" | "passive";
}

export interface SafetyProposal {
  fns: SafetyFunction[];
  hazards: SafetyHazard[];
  groups: OutGroup[];
  logic: SafetyComponent;
  target: SafetyTarget;
  edition: Iso13855Edition;
  params: { dop: number; hop: number; missionYears: number };
  warnings: string[];
}

/* ================================================================ výpočet PL */

const PLS: PL[] = ["a", "b", "c", "d", "e"];
export const plRank = (p: PL | null | undefined): number => (p ? PLS.indexOf(p) : -1);
const minPl = (xs: Array<PL | null>): PL | null => xs.some(x => !x) ? null : xs.reduce<PL>((m, x) => plRank(x) < plRank(m) ? x! : m, "e");
const maxPl = (xs: Array<PL | null>): PL | null => xs.filter(Boolean).reduce<PL | null>((m, x) => plRank(x) > plRank(m) ? x : m, null);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);

/** PLr z grafu rizik ISO 13849-1 příl. A. */
export function plrFromGraph(S: "S1" | "S2", F: "F1" | "F2", P: "P1" | "P2"): PL {
  return D.SAFETY_PLR_TABLE[S + F + P] as PL;
}

/** Třída MTTFd kanálu. */
export function mttfdClass(years: number): "not_suitable" | "low" | "medium" | "high" {
  if (!(years >= 3)) return "not_suitable";
  if (years < 10) return "low";
  if (years < 30) return "medium";
  return "high";
}
/** Třída DCavg. */
export function dcClass(pct: number): "none" | "low" | "medium" | "high" {
  if (!(pct >= 60)) return "none";
  if (pct < 90) return "low";
  if (pct < 99) return "medium";
  return "high";
}
/** nop = dop · hop · 3600 / tcycle [cykly/rok]. */
export function nopFrom(dop: number, hop: number, tcycleS: number): number { return dop * hop * 3600 / tcycleS; }
/** MTTFd = B10d / (0,1 · nop) [roky]. */
export function mttfdFromB10d(b10d: number, nop: number): number { return b10d / (0.1 * nop); }
/** Symetrizace dvou kanálů: 2/3 · [a + b − 1/(1/a + 1/b)]. */
export function symmetrizeMttfd(a: number, b: number): number { return 2 / 3 * (a + b - 1 / (1 / a + 1 / b)); }
/** MTTFd kanálu z komponent v sérii: 1/MTTFd = Σ 1/MTTFd,i. */
export function seriesMttfd(xs: number[]): number { return 1 / xs.reduce((s, x) => s + 1 / x, 0); }

export interface PlCalc { pl: PL | null; mttfdCapped: number; mttfdCls: string; dcCls: string; why: string[] }

/**
 * Dosažené PL zjednodušenou metodou (sloupcový graf ISO 13849-1, tab. 6 vydání 2015):
 * kategorie × třída MTTFd kanálu × třída DCavg, u kategorií 2–4 CCF ≥ 65 bodů. MTTFd kanálu se
 * omezí na 100 let (kat. 4: 2 500 let). Kombinace, které tabulka nepřipouští, vrací `pl: null`.
 */
export function plFromCategory(o: { cat: SafetyCat; mttfd: number; dc: number; ccf: number }): PlCalc {
  const why: string[] = [];
  const cap = o.cat === "4" ? D.SAFETY_MTTFD_CAP.cat4 : D.SAFETY_MTTFD_CAP.def;
  const m = Math.min(o.mttfd, cap);
  if (o.mttfd > cap) why.push(tr("MTTFd kanálu omezeno na {cap} let", { cap }));
  let mc: string = mttfdClass(m);
  let dc: string = dcClass(o.dc);
  const out = (pl: PL | null): PlCalc => ({ pl, mttfdCapped: r1(m), mttfdCls: mc, dcCls: dc, why });
  if (mc === "not_suitable") { why.push(tr("MTTFd kanálu pod 3 roky — nevhodné")); return out(null); }
  if (o.cat !== "B" && o.cat !== "1" && o.ccf < D.SAFETY_CCF_MIN) {
    why.push(tr("opatření proti CCF {p} bodů < {min} — kategorie {cat} nesplněna", { p: o.ccf, min: D.SAFETY_CCF_MIN, cat: o.cat }));
    return out(null);
  }
  let rowDc = dc;
  if (o.cat === "B" || o.cat === "1") rowDc = "none";
  if (o.cat === "B" && mc === "high") { why.push(tr("kategorie B: nejvýš PL b")); mc = "medium"; }
  if (o.cat === "2" || o.cat === "3") {
    if (dc === "none") { why.push(tr("kategorie {cat} vyžaduje DCavg aspoň 60 %", { cat: o.cat })); return out(null); }
    if (dc === "high") rowDc = "medium";
  }
  if (o.cat === "4") {
    if (dc !== "high") { why.push(tr("kategorie 4 vyžaduje DCavg aspoň 99 %")); return out(null); }
  }
  const row = D.SAFETY_SIMPLE_PL.find(r => r.cat === o.cat && r.dc === rowDc);
  const pl = row ? (row as unknown as Record<string, string | null>)[mc] as PL | null : null;
  if (!pl) why.push(tr("kombinace kategorie {cat}, MTTFd „{m}“ a DCavg „{dc}“ není v tabulce přípustná", { cat: o.cat, m: mc, dc }));
  return out(pl);
}

/* ================================================================ ISO 13855 */

export interface DistanceInput {
  edition: Iso13855Edition; mode: DistanceMode;
  /** ZMĚŘENÁ doba doběhu stroje [ms] — bez ní se vzdálenost nepočítá. */
  tStopMs?: number; tDeviceMs?: number; tLogicMs?: number;
  d?: number; H?: number; Z?: number; covered?: boolean; DGT?: number; beams?: number; press?: boolean;
}

/**
 * Bezpečná (oddělovací) vzdálenost podle ISO 13855:2010 (S = K·T + C) nebo 2024
 * (S = K·T + D_DS + Z; hodnoty 2024 podle volných výkladů — ověřit v normě). T = změřená doba
 * doběhu + reakce ochranného zařízení + reakce logiky. Bez změřené doby doběhu S = null.
 */
export function safetyDistance(i: DistanceInput): SafetyDistance {
  const steps: string[] = [], warnings: string[] = [], missing: string[] = [];
  const src = [...(D.SAFETY_ISO13855_SOURCES.editions || [])];
  const res = (S: number | null, T: number | null, K: number | null, C: number | null, formula: string, s: string[]): SafetyDistance =>
    ({ edition: i.edition, mode: i.mode, S: S === null ? null : r0(S), T: T === null ? null : Math.round(T * 1000) / 1000, K, C: C === null ? null : r1(C), formula, steps: s, warnings, missing, sources: src });
  if (!(Number.isFinite(i.tStopMs) && (i.tStopMs as number) > 0)) missing.push(tr("změřená doba doběhu stroje (zastavení nebezpečného pohybu po vyžádání)"));
  const tDev = Number.isFinite(i.tDeviceMs) ? i.tDeviceMs as number : 0;
  const tLog = Number.isFinite(i.tLogicMs) ? i.tLogicMs as number : 0;
  const T = missing.length ? null : ((i.tStopMs as number) + tDev + tLog) / 1000;
  if (T !== null) steps.push(tr("T = {stop} ms (změřeno) + {dev} ms (ochranné zařízení) + {log} ms (logika) = {t} s", { stop: i.tStopMs, dev: tDev, log: tLog, t: Math.round(T * 1000) / 1000 }));
  const Z = Number.isFinite(i.Z) ? i.Z as number : 0;
  const d = Number.isFinite(i.d) ? i.d as number : NaN;
  const e24 = i.edition === "2024";
  if (e24) warnings.push(tr("Hodnoty ISO 13855:2024 jsou z volných výkladů (GT Engineering, Leuze, GIT); norma k datu rešerše nebyla harmonizovaná — ověř v normě."));
  const id = (x: string) => { src.push(...(D.SAFETY_ISO13855_SOURCES[x] || [])); };
  switch (i.mode) {
    case "orthogonal": {
      id(e24 ? "orthogonal_2024" : "orthogonal_d_le_40");
      if (!Number.isFinite(d)) { missing.push(tr("rozlišení ochranného zařízení d [mm]")); return res(null, T, null, null, "S = K·T + C", steps); }
      if (!e24) {
        if (d <= 40) {
          const C = 8 * (d - 14);
          if (T === null) return res(null, null, 2000, C, "S = 2000·T + 8·(d − 14)", steps);
          let S = 2000 * T + C;
          steps.push(tr("krok 1: S = 2000 · {t} + 8 · ({d} − 14) = {s} mm", { t: r1(T * 1000) / 1000, d, s: r0(S) }));
          if (S <= 500) { if (S < 100) { steps.push(tr("S < 100 mm → S = 100 mm")); S = 100; } return res(S, T, 2000, C, "S = 2000·T + 8·(d − 14)", steps); }
          S = 1600 * T + C;
          steps.push(tr("krok 1 dal S > 500 mm → krok 2: S = 1600 · {t} + 8 · ({d} − 14) = {s} mm", { t: Math.round(T * 1000) / 1000, d, s: r0(S) }));
          if (S < 500) { steps.push(tr("S < 500 mm → S = 500 mm")); S = 500; }
          return res(S, T, 1600, C, "S = 1600·T + 8·(d − 14)", steps);
        }
        if (d <= 70) {
          id("orthogonal_40_70_2010");
          warnings.push(tr("Pro 40 < d ≤ 70 mm: nejnižší paprsek ≤ 300 mm, nejvyšší ≥ 900 mm nad referenční rovinou."));
          if (T === null) return res(null, null, 1600, 850, "S = 1600·T + 850", steps);
          const S = 1600 * T + 850;
          steps.push(tr("S = 1600 · {t} + 850 = {s} mm", { t: Math.round(T * 1000) / 1000, s: r0(S) }));
          return res(S, T, 1600, 850, "S = 1600·T + 850", steps);
        }
        return safetyDistance({ ...i, mode: "multibeam" });
      }
      /* 2024: D_DT podle rozlišení, K 2000 → 1600 nad 500 mm */
      let C: number, K = 2000, minS = 100;
      if (d <= 40) C = 8 * (d - 14);
      else if (d <= 55) { C = 208 + 12 * (d - 40); minS = 500; }
      else if (d <= 120) { C = 850; K = 1600; minS = 0; }
      else { warnings.push(tr("d > 120 mm: posuď jako vícepaprskovou mříž / přístup tělem.")); return safetyDistance({ ...i, mode: "multibeam" }); }
      warnings.push(tr("ISO 13855:2024 hodnotí i přesah přes pole (D_DO) a podsah pod polem (D_DU); rozhoduje největší S — tady jen průnik polem (D_DT)."));
      if (T === null) return res(null, null, K, C, "S = K·T + D_DT + Z", steps);
      let S = K * T + C + Z;
      steps.push(tr("S = {k} · {t} + D_DT {c} + Z {z} = {s} mm", { k: K, t: Math.round(T * 1000) / 1000, c: r1(C), z: Z, s: r0(S) }));
      if (K === 2000 && S > 500) { K = 1600; S = K * T + C + Z; steps.push(tr("S > 500 mm → K = 1600: S = {s} mm", { s: r0(S) })); }
      if (S < minS) { steps.push(tr("S < {min} mm → S = {min} mm", { min: minS })); S = minS; }
      return res(S, T, K, C, "S = K·T + D_DT + Z", steps);
    }
    case "multibeam": {
      id("multibeam");
      const beams = i.beams || 3;
      const h = D.SAFETY_MULTIBEAM_HEIGHTS[String(beams)];
      if (h) steps.push(tr("výšky paprsků ({n}): {h} mm", { n: beams, h: h.join(" / ") }));
      if (e24) warnings.push(tr("ISO 13855:2024 (výklad Leuze/GIT): rozteč paprsků nejvýš 400 mm, nejnižší paprsek 200 mm, nejvyšší 900 mm → nejméně 3 paprsky."));
      else if (beams === 2) warnings.push(tr("Dvoupaprsková mříž (400 / 900 mm) jen pokud posouzení rizik vyloučí podlezení."));
      if (T === null) return res(null, null, 1600, 850, "S = 1600·T + 850", steps);
      const S = 1600 * T + 850 + (e24 ? Z : 0);
      steps.push(tr("S = 1600 · {t} + 850 = {s} mm", { t: Math.round(T * 1000) / 1000, s: r0(S) }));
      return res(S, T, 1600, 850, e24 ? "S = 1600·T + 850 + Z" : "S = 1600·T + 850", steps);
    }
    case "parallel": {
      id(e24 ? "parallel_2024" : "parallel_2010");
      const H = Number.isFinite(i.H) ? i.H as number : NaN;
      if (!Number.isFinite(H)) { missing.push(tr("výška ochranného pole nad referenční rovinou H [mm]")); return res(null, T, 1600, null, "S = 1600·T + C", steps); }
      if (H > 1000) warnings.push(tr("H > 1000 mm není přípustné."));
      if (Number.isFinite(d) && 15 * (d - 50) > H) warnings.push(tr("Rozlišení d je pro výšku H příliš hrubé: musí platit H ≥ 15 · (d − 50)."));
      if (e24 && H > 200) warnings.push(tr("H > 200 mm: riziko nezjištěného podlezení pole."));
      const C = e24 ? 1200 : Math.max(850, 1200 - 0.4 * H);
      if (T === null) return res(null, null, 1600, C, e24 ? "S = 1600·T + 1200 + Z" : "S = 1600·T + (1200 − 0,4·H)", steps);
      const S = 1600 * T + C + (e24 ? Z : 0);
      steps.push(tr("S = 1600 · {t} + {c} = {s} mm", { t: Math.round(T * 1000) / 1000, c: r1(C + (e24 ? Z : 0)), s: r0(S) }));
      return res(S, T, 1600, C, e24 ? "S = 1600·T + 1200 + Z" : "S = 1600·T + (1200 − 0,4·H)", steps);
    }
    case "two_hand": {
      id("two_hand");
      const C = i.covered ? 0 : e24 ? 550 : 250;
      if (i.covered) warnings.push(tr("Ovladače zakryté — přídavek 0 (přiblížení ruky k nebezpečí vyloučeno)."));
      if (T === null) return res(null, null, 1600, C, "S = 1600·T + " + C, steps);
      let S = 1600 * T + C;
      steps.push(tr("S = 1600 · {t} + {c} = {s} mm", { t: Math.round(T * 1000) / 1000, c: C, s: r0(S) }));
      if (e24 && i.covered && S < 100) { steps.push(tr("S < 100 mm → S = 100 mm")); S = 100; }
      return res(S, T, 1600, C, "S = 1600·T + " + C, steps);
    }
    case "mat": {
      id("pressure_mat");
      if (T === null) return res(null, null, 1600, 1200, e24 ? "S = 1600·T + 1200 + Z" : "S = 1600·T + 1200", steps);
      const S = 1600 * T + 1200 + (e24 ? Z : 0);
      steps.push(tr("S = 1600 · {t} + {c} = {s} mm", { t: Math.round(T * 1000) / 1000, c: 1200 + (e24 ? Z : 0), s: r0(S) }));
      return res(S, T, 1600, 1200, e24 ? "S = 1600·T + 1200 + Z" : "S = 1600·T + 1200", steps);
    }
    case "guard": {
      id("interlocking_guard");
      if (!Number.isFinite(i.DGT)) { missing.push(tr("dosah skrz ochrannou konstrukci D_GT podle ISO 13857 [mm]")); return res(null, T, 1600, null, "S = 1600·T + D_GT", steps); }
      if (T === null) return res(null, null, 1600, i.DGT as number, "S = 1600·T + D_GT", steps);
      const S = 1600 * T + (i.DGT as number);
      steps.push(tr("S = 1600 · {t} + {c} = {s} mm", { t: Math.round(T * 1000) / 1000, c: i.DGT, s: r0(S) }));
      return res(S, T, 1600, i.DGT as number, "S = 1600·T + D_GT", steps);
    }
  }
}

/** Lisy (EN 692/693): přídavek C podle rozlišení (C-norma má přednost před ISO 13855). */
export function pressSupplement(d: number): { C: number; strokeByEspe: boolean } {
  const r = D.SAFETY_PRESS_C.find(x => d <= x.dMax)!;
  return { C: r.C, strokeByEspe: r.strokeByEspe };
}

/* ================================================================ rozpoznání stroje */

const low = (s: string | undefined) => (s || "").toLowerCase();
const RE = {
  curtain: /světeln|svetel|light ?curtain|light ?grid|lichtgitter|lichtvorhang|lichtschranke|cortina|barrera (fotoel|de luz)|fotoeléctric|aopd|\besp?e\b|clona/,
  multibeam: /mříž|vícepaprs|multi.?beam|mehrstrahl|multihaz/,
  scanner: /skener|scanner|laserscan|escáner/,
  mat: /rohož|\bmat\b|trittmatte|alfombra/,
  guard: /kryt|dveř|dvere|dvířk|víko|poklop|oplocen|ohrazen|\bplot|vrata|závor|door|guard|\bcover|\bhood|\blid\b|fence|\bgate\b|\btür|schutztür|schutzhaube|schutzgitter|schutzzaun|abdeckung|haube|puerta|resguardo|\btapa\b|valla/,
  twoHand: /dvouruč|dvoruc|two.?hand|zweihand|bimanual|dos manos/,
  enabling: /povolovac|enabling|zustimm|validaci/,
  mode: /volič režim|přepínač režim|mode selector|betriebsart/,
  muting: /muting/,
  lock: /zámek|zámk|zamk|\block\b|zuhalt|bloqueo|enclavamiento/,
  press: /\blis(u|y|ů|em|ech)?\b|\blisov|nýtova|nytova|razic|ražen|\bpress(?!ur)|prensa|stanz|ohraňov|\bstamping|präg|estampa/,
  hydraulic: /hydraul|hidrául|hidraul/,
  vfd: /měnič|menic|frekv|vfd|servo|inverter|umrichter|variador|\bdrive\b/,
  vertical: /zdvih|výtah|vytah|svisl|vertik|\blift\b|hoist|zvedák|zvedac|hubwerk|elevaci/,
  heater: /ohřev|ohřív|topen|topné|heater|heizung|calentad|calefac/,
  stb: /teplotní pojistk|teplotni pojistk|omezovač teplot|\bstb\b|thermostat|übertemperatur|limitador de temperatura|temperature limiter/,
  pressureVessel: /pár[ay]\b|páry|kotl|kotel|nádob|kompres|\bco2\b|steam|boiler|vessel|kessel|dampf|caldera/,
  pressureSwitch: /tlakov\w* spínač|tlakový spínač|pressure switch|druckschalter|presostato/,
  processValve: /šoupát|klapk|kohout|uzávěr|potrubí|armatur|damper|klappe|schieber|ventil (vody|páry|teplonos|produkt|co2|čerstv)|válvula de proceso|water|steam/,
  vacuum: /přísav|vakuu|vacuum|sauger|ventosa|ejektor/,
  robot: /\brobot/,
};
const has = (s: string | undefined, re: RegExp) => re.test(low(s));

export function isPressProject(prj: Project): boolean {
  return has(prj.meta.name + " " + prj.meta.desc, RE.press) || prj.devices.some(d => (d.cls === "Ventil" || d.cls === "Motor") && has(d.desc, RE.press));
}

/** Druh ochranného DI podle popisu (nebo null). */
export function guardKindOf(d: Device): SafetyKind | null {
  if (d.cls !== "DI") return null;
  if (has(d.desc, RE.twoHand)) return null;
  if (has(d.desc, RE.curtain)) return "light_curtain";
  if (has(d.desc, RE.multibeam)) return "multibeam";
  if (has(d.desc, RE.scanner)) return "scanner";
  if (has(d.desc, RE.mat)) return "mat";
  if (has(d.desc, RE.guard)) return "guard";
  return null;
}

/* ================================================================ katalog komponent */

/** B10d odvozené z textu rešerše (B10 / podíl nebezpečných poruch) — potvrdit podle datasheetu. */
const COMP_B10D: Record<string, number> = {
  "siemens-sirius-act-3su1-nouzove-zastaven": 500000, "eaton-rmq-titan-m22-pv": 900000,
  "schneider-harmony-xb4-xb5": 1500000, "pilz-pitestop-pit-es-set": 100000, "abb-mpe-mpm-cpe-nouzove-zastaveni": 225000,
  "schmersal-az-16": 2000000, "siemens-sirius-3se5-3se52": 5000000, "sick-i10-lock": 3000000,
  "siemens-sirius-3rt20-3rt2": 1370000, "schneider-tesys-d-lc1d": 1369863, "abb-afs-af-pro-bezpecnostni-aplikace": 1300000,
  "smc-vp544-x538": 10000000, "idec-he1g": 100000, "euchner-zsm": 100000,
  "siemens-sirius-act-3su1-dvourucni-pult": 50000000,
};
/** PL přístroje pro danou funkci, kde se liší od „nejvyššího“ (zámek: jištění jen PL d). */
const COMP_PL_FOR: Record<string, PL> = { "schmersal-azm-201": "d" };

export function safetyComponent(id: string | undefined): SafetyComponent | null {
  if (!id) return null;
  const c = D.SAFETY_COMPONENTS.find(x => x.id === id);
  if (!c) return null;
  return {
    id: c.id, label: tr(c.type), brand: c.brand, series: tr(c.series), orderCode: tr(c.orderCode),
    plMax: (COMP_PL_FOR[c.id] || c.plMax) as PL | null, b10d: COMP_B10D[c.id], pfhdText: c.pfhdText ? tr(c.pfhdText) : "",
    sources: c.sources, generic: c.id in COMP_B10D,
  };
}
/** Typická hodnota z tab. C.1 ISO 13849-1 jako komponenta. */
function genericComp(key: keyof typeof D.SAFETY_GENERIC & string): SafetyComponent {
  const g = D.SAFETY_GENERIC[key];
  return { id: "generic:" + key, label: tr(g.label), b10d: g.b10d, mttfd: g.mttfd, sources: D.SAFETY_GENERIC_SOURCES, generic: true };
}
/** Komponenta bez dat (doplní uživatel). */
function unknownComp(id: string, label: string): SafetyComponent {
  return { id: "custom:" + id, label, sources: [], generic: true };
}
/** Komponenty kategorie, značka podle platformy PLC napřed. */
export function safetyComponents(cat: string, plat?: PlatformKey): SafetyComponent[] {
  const brand = plat ? PLAT[plat].name.split(" ")[0].toLowerCase() : "";
  const xs = D.SAFETY_COMPONENTS.filter(c => c.cat === cat);
  const sorted = [...xs.filter(c => brand && c.brand.toLowerCase().startsWith(brand)), ...xs.filter(c => !(brand && c.brand.toLowerCase().startsWith(brand)))];
  return sorted.map(c => safetyComponent(c.id)!);
}
const pickComp = (cat: string, plat: PlatformKey, prefer?: string): SafetyComponent | null =>
  (prefer && safetyComponent(prefer)) || safetyComponents(cat, plat)[0] || null;

/** Výchozí bezpečnostní logika podle platformy a rozsahu (počtu vstupních funkcí). */
function defaultLogic(prj: Project, nInputFns: number, needsPlc: boolean): string {
  const p = prj.platforms[0] || "siemens";
  if (nInputFns <= 2 && !needsPlc) return "pilz-pnozsigma-pnoz-s4";
  switch (p) {
    case "siemens": return prj.devices.length > 30 ? "siemens-simatic-s7-1500f-cpu-1516f-3-pn" : "siemens-simatic-s7-1200f-cpu-1214fc-dc-d";
    case "rockwell": return "rockwell-guardlogix-5580-compact-guardlo";
    case "beckhoff": return "beckhoff-twinsafe-el1904-el2904-el6910";
    case "omron": return "omron-nx-sl3300";
    default: return "pilz-pnozmulti-2-pnoz-m-b1";
  }
}
/** Cíl bezpečnostního programu podle logiky. */
export function targetForLogic(id: string): SafetyTarget {
  const c = D.SAFETY_COMPONENTS.find(x => x.id === id);
  if (!c) return "relay";
  if (c.cat === "safety_relay" || c.cat === "two_hand") return "relay";
  const b = c.brand.toLowerCase();
  if (b.startsWith("siemens")) return "siemens";
  if (b.startsWith("rockwell")) return "rockwell";
  if (b.startsWith("beckhoff") || b.startsWith("omron")) return "plcopen";
  if (b.startsWith("pilz")) return "pilz";
  if (b.startsWith("sick")) return "sick";
  if (b.startsWith("schmersal")) return "schmersal";
  return "relay";
}

/* ================================================================ texty */

const HAZ: Record<string, string> = {
  emergency: N_("Nouzová situace u kteréhokoli nebezpečí stroje"),
  motion: N_("Mechanické nebezpečí od pohyblivých částí pohonů (vtažení, navinutí, náraz, stlačení)"),
  pneumatic: N_("Stlačení a střih pneumatickými válci; zbytková energie stlačeného vzduchu"),
  hydraulic: N_("Stlačení hydraulickým pohonem, vystřiknutí tlakové kapaliny, zbytkový tlak"),
  press: N_("Stlačení a střih v pracovním prostoru lisu (zdvih beranu / nástroje)"),
  access: N_("Vstup nebo sáhnutí do nebezpečného prostoru za chodu"),
  restart: N_("Neočekávaný rozběh po zásahu, resetu nebo obnovení energie"),
  gravity: N_("Pád gravitačně zatížené (svislé) osy nebo břemene"),
  thermal: N_("Popálení a požár od ohřevu, přehřátí"),
  pressure: N_("Přetlak v tlakovém systému (roztržení, únik média)"),
  robot: N_("Pohyb robotu v pracovním prostoru při seřizování a výuce"),
};

const KIND_CATALOG: Record<SafetyKind, string> = {
  estop: "emergency_stop", guard: "guard_interlock", guard_lock: "guard_locking", light_curtain: "espe_light_curtain",
  multibeam: "espe_multibeam_access", scanner: "espe_laser_scanner", mat: "pressure_sensitive_mat", two_hand: "two_hand_control",
  enabling: "enabling_device", mode: "operating_mode_selection", muting: "muting", restart: "prevent_unexpected_startup",
  sto: "drive_safe_stop", pneumatic: "pneumatic_safe_exhaust", hydraulic: "hydraulic_safe_stop", vertical: "vertical_axis_holding",
  temperature: "overtemperature_limit", pressure: "overpressure_limit",
};
const OUTPUT_KINDS = new Set<SafetyKind>(["sto", "pneumatic", "hydraulic", "vertical"]);

/** Popisky druhů výstupních skupin (klíče překladu). */
const TEST_KIND: Record<string, string> = {
  "funkční": N_("funkční"), "porucha": N_("porucha"), "měření": N_("měření"), "manipulace": N_("manipulace"),
  "konfigurace": N_("konfigurace"), "kontrola": N_("kontrola"),
};
export function testKindLabel(k: string): string { return TEST_KIND[k] ? tr(TEST_KIND[k]) : k; }

const short = (xs: string[], n = 6) => xs.slice(0, n).join(", ") + (xs.length > n ? ", … (+" + (xs.length - n) + ")" : "");

/** Výchozí doba mezi vyžádáními [s] podle druhu funkce. */
function defaultDemand(kind: SafetyKind, prj: Project, press: boolean): number {
  const takt = prj.meta.takt && prj.meta.takt > 0 ? prj.meta.takt : 15;
  switch (kind) {
    case "estop": case "mode": return 28800;
    case "guard": case "guard_lock": return 900;
    case "light_curtain": case "muting": return press ? takt : 60;
    case "two_hand": return takt;
    case "scanner": case "mat": return 300;
    case "multibeam": case "restart": case "vertical": return 3600;
    case "enabling": return 600;
    case "temperature": case "pressure": return 86400;
    default: return 900;
  }
}

/* ================================================================ skupiny výstupů */

function outGroups(prj: Project): OutGroup[] {
  const plat = prj.platforms[0] || "siemens";
  const aoRefs = prj.devices.filter(d => d.cls === "AnalogOut" && has(d.desc, RE.vfd)).map(d => low(d.desc));
  const isVfd = (d: Device) => has(d.desc, RE.vfd) || aoRefs.some(t => new RegExp("\\b" + d.name.toLowerCase() + "\\b").test(t));
  const motors = prj.devices.filter(d => d.cls === "Motor" && !has(d.desc, RE.heater));
  const out: OutGroup[] = [];
  const plain = motors.filter(d => !isVfd(d)).map(d => d.name);
  if (plain.length) out.push({ id: "KS", kind: "contactors", devs: plain, label: tr("stykače KS1/KS2 se zrcadlovými kontakty pro {devs}", { devs: short(plain) }), outs: ["KS1_Q", "KS2_Q"], fbk: ["KS1_FBK", "KS2_FBK"], comp: pickComp("contactor_mirror", plat) });
  for (const d of motors.filter(isVfd)) out.push({ id: "STO_" + d.name, kind: "sto", devs: [d.name], label: tr("STO měniče {dev}", { dev: d.name }), outs: [d.name + "_STO"], fbk: [], comp: pickComp("drive_sto", plat, plat === "siemens" || plat === "schneider" ? undefined : "abb-acs580") });
  const valves = prj.devices.filter(d => d.cls === "Ventil" && !has(d.desc, RE.processValve) && !has(d.desc, RE.vacuum));
  /* hydraulický ventil: v popisu „hydraul“; nebo lisovací ventil v projektu s hydraulickým agregátem;
     nebo hydraulický stroj (název projektu) bez stlačeného vzduchu */
  const allText = prj.devices.map(d => d.desc).join(" ");
  const hydUnit = prj.devices.some(d => d.cls === "Motor" && has(d.desc, RE.hydraulic)) || has(prj.meta.name + " " + prj.meta.desc, RE.hydraulic);
  const hydMachine = has(prj.meta.name, RE.hydraulic) && !has(allText, /pneum|vzduch|\bair\b|druckluft|neumát/);
  const hyd = valves.filter(d => !has(d.desc, /pneum/) && (has(d.desc, RE.hydraulic) || (hydUnit && has(d.desc, RE.press)) || hydMachine));
  /* pneumatika: lisovací válce přes bezpečnostní dvojitý ventil (YP), ostatní přes odvzdušnění přívodu (YS) */
  const pneuDevs = valves.filter(d => !hyd.includes(d));
  const pressPneu = pneuDevs.filter(d => has(d.desc, RE.press)).map(d => d.name);
  const pneu = pneuDevs.map(d => d.name).filter(n => !pressPneu.includes(n));
  if (pneu.length) out.push({ id: "YS", kind: "exhaust", devs: pneu, label: tr("bezpečnostní odvzdušňovací ventil YS1 pro {devs}", { devs: short(pneu) }), outs: ["YS1_Q"], fbk: ["YS1_FBK"], comp: pickComp("safety_valve", plat, "festo-ms6-sv-e") });
  if (pressPneu.length) out.push({ id: "YP", kind: "exhaust", devs: pressPneu, label: tr("bezpečnostní dvojitý ventil YP1 pro lisovací válce {devs}", { devs: short(pressPneu) }), outs: ["YP1_Q"], fbk: ["YP1_FBK"], comp: pickComp("safety_valve", plat, "ross-dm2-series-c-dm2c-dvojity-ventil") });
  const hydDevs = [...hyd.map(d => d.name), ...prj.devices.filter(d => d.cls === "Motor" && has(d.desc, RE.hydraulic)).map(d => d.name)];
  if (hyd.length || (hydDevs.length && has(prj.meta.name + " " + prj.meta.desc + " " + prj.devices.map(d => d.desc).join(" "), RE.press)))
    out.push({ id: "YH", kind: "hydraulic", devs: hydDevs, label: tr("redundantní hydraulické ventily YH1/YH2 se sledováním polohy pro {devs}", { devs: short(hydDevs) }), outs: ["YH1_Q", "YH2_Q"], fbk: ["YH1_FBK", "YH2_FBK"], comp: null });
  for (const d of motors.filter(m => has(m.desc, RE.vertical))) out.push({ id: "BRK_" + d.name, kind: "brake", devs: [d.name], label: tr("bezpečné ovládání brzdy (SBC) {dev}", { dev: d.name }), outs: [d.name + "_BRK1", d.name + "_BRK2"], fbk: [d.name + "_BRK_FBK"], comp: genericComp("mechanical") });
  const heat = prj.devices.filter(d => (d.cls === "Motor" || d.cls === "DO" || d.cls === "AnalogOut" || d.cls === "Ventil") && has(d.desc, RE.heater) && !(d.cls === "DO" && d.role)).map(d => d.name);
  if (heat.length) out.push({ id: "KH", kind: "heater", devs: heat, label: tr("stykače ohřevu KH1/KH2 pro {devs}", { devs: short(heat) }), outs: ["KH1_Q", "KH2_Q"], fbk: ["KH1_FBK", "KH2_FBK"], comp: pickComp("contactor_mirror", plat) });
  return out;
}

/* ================================================================ návrh funkcí */

interface Raw { ref: string; kind: SafetyKind; inputs: string[]; acts: string[]; missing: string[]; user?: boolean; title?: string }

function rawFunctions(prj: Project, groups: OutGroup[]): Raw[] {
  const out: Raw[] = [];
  const motion = groups.filter(g => g.kind !== "heater" && g.kind !== "brake").map(g => g.id);
  const all = groups.map(g => g.id);
  if (!groups.length) return out;
  const press = isPressProject(prj);
  const es = devById(prj, prj.program.estop);
  out.push({ ref: "estop", kind: "estop", inputs: es ? [es.name] : [], acts: all, missing: es ? [] : [tr("tlačítko nouzového zastavení (DI, zvolit v kroku Program)")] });
  const dis = prj.devices.filter(d => d.cls === "DI" && d.id !== prj.program.estop);
  const locks = new Set(interlockDevs(prj).map(d => d.id));
  const byKind = (k: SafetyKind) => dis.filter(d => guardKindOf(d) === k);
  const guards = byKind("guard");
  for (const d of guards) out.push({ ref: "guard:" + d.name, kind: "guard", inputs: [d.name], acts: motion, missing: [] });
  const lockDo = prj.devices.filter(d => d.cls === "DO" && (d.role === "lock" || has(d.desc, RE.lock)));
  if (lockDo.length && motion.length) out.push({ ref: "guard_lock", kind: "guard_lock", inputs: [...guards.map(d => d.name), ...lockDo.map(d => d.name)], acts: motion, missing: guards.length ? [] : [tr("spínač krytu se zámkem (DI)")] });
  for (const k of ["light_curtain", "multibeam", "scanner", "mat"] as SafetyKind[]) for (const d of byKind(k)) out.push({ ref: k + ":" + d.name, kind: k, inputs: [d.name], acts: motion, missing: [] });
  if (press && motion.length) {
    const th = dis.filter(d => has(d.desc, RE.twoHand)).map(d => d.name);
    const pressDevs = prj.devices.filter(d => (d.cls === "Ventil" || d.cls === "Motor") && has(d.desc, RE.press)).map(d => d.name);
    const acts = groups.filter(g => g.kind !== "heater" && g.kind !== "brake" && (!pressDevs.length || g.devs.some(x => pressDevs.includes(x)))).map(g => g.id);
    out.push({ ref: "two_hand", kind: "two_hand", inputs: th, acts: acts.length ? acts : motion, missing: th.length >= 2 ? [] : [tr("dvouruční ovládací pult (2 tlačítka, každé NO + NC)")] });
  }
  for (const d of dis.filter(x => has(x.desc, RE.muting))) out.push({ ref: "muting:" + d.name, kind: "muting", inputs: [d.name], acts: motion, missing: [] });
  if (prj.devices.some(d => has(d.desc, RE.robot)) && motion.length) {
    const en = dis.filter(d => has(d.desc, RE.enabling)).map(d => d.name);
    out.push({ ref: "enabling", kind: "enabling", inputs: en, acts: motion, missing: en.length ? [] : [tr("třípolohový povolovací spínač (ruční ovládací panel)")] });
    const md = dis.filter(d => has(d.desc, RE.mode)).map(d => d.name);
    out.push({ ref: "mode", kind: "mode", inputs: md, acts: motion, missing: md.length ? [] : [tr("volič provozního režimu s uzamčením")] });
  }
  if (motion.length) out.push({ ref: "restart", kind: "restart", inputs: [], acts: all, missing: [] });
  const sto = groups.filter(g => g.kind === "sto").map(g => g.id);
  if (sto.length) out.push({ ref: "sto", kind: "sto", inputs: [], acts: sto, missing: [] });
  const exh = groups.filter(g => g.kind === "exhaust").map(g => g.id);
  if (exh.length) out.push({ ref: "pneumatic", kind: "pneumatic", inputs: [], acts: exh, missing: [] });
  if (groups.some(g => g.id === "YH")) out.push({ ref: "hydraulic", kind: "hydraulic", inputs: [], acts: ["YH"], missing: [] });
  const vert = groups.filter(g => g.kind === "brake").map(g => g.id);
  const vertValves = prj.devices.filter(d => d.cls === "Ventil" && has(d.desc, RE.vertical)).map(d => d.name);
  if (vert.length || vertValves.length) out.push({ ref: "vertical", kind: "vertical", inputs: [], acts: [...vert, ...(vertValves.length && groups.some(g => g.id === "YS") ? ["YS"] : [])], missing: vertValves.length ? [tr("pilotně ovládané zpětné ventily přímo na válcích {devs} (zadržení při odvzdušnění)", { devs: short(vertValves) })] : [] });
  if (groups.some(g => g.id === "KH")) {
    const stb = dis.filter(d => has(d.desc, RE.stb)).map(d => d.name);
    out.push({ ref: "temperature", kind: "temperature", inputs: stb, acts: ["KH"], missing: stb.length ? [] : [tr("bezpečnostní omezovač teploty (STB, EN 14597) s kontaktem do bezpečnostní logiky")] });
  }
  const pv = prj.devices.filter(d => d.cls === "AnalogIn" && has(d.desc, RE.pressureVessel)).map(d => d.name);
  if (groups.some(g => g.id === "YH") || pv.length) {
    const ps = dis.filter(d => has(d.desc, RE.pressureSwitch) && has(d.desc, /max|přetlak|vysok|\bhigh|über|alta/)).map(d => d.name);
    out.push({ ref: "pressure", kind: "pressure", inputs: ps, acts: groups.some(g => g.id === "YH") ? ["YH"] : [], missing: [tr("pojistný ventil nastavený na nejvyšší dovolený tlak (mechanický princip, ISO 4413 / tlaková zařízení)")] });
  }
  /* doplňky uživatele */
  for (const a of prj.safety?.add || []) {
    if (!a || !a.ref || !KIND_CATALOG[a.kind] || out.some(x => x.ref === a.ref)) continue;
    out.push({ ref: a.ref, kind: a.kind, inputs: a.inputs || [], acts: (a.acts && a.acts.length ? a.acts : motion).filter(x => groups.some(g => g.id === x)), missing: [], user: true, title: a.title });
  }
  return out;
}

/** Návrh S/F/P se zdůvodněním. */
function riskProposal(kind: SafetyKind, press: boolean): { S: "S1" | "S2"; F: "F1" | "F2"; P: "P1" | "P2"; why: { S: string; F: string; P: string }; min?: { pl: PL; why: string } } {
  const sS2 = tr("S2: pohyby pohonů stroje mohou způsobit vážné, obvykle nevratné zranění (zlomeniny, amputace).");
  const fRare = tr("F1: vyžádání je výjimečné a doba vystavení krátká (méně než 1× za 15 min, souhrnně pod 1/20 doby provozu).");
  const fOften = tr("F2: zásahy obsluhy (zakládání, odstraňování poruch, čištění) mohou být častější než 1× za 15 min — uprav podle skutečného provozu.");
  const pHard = tr("P2: vyhnout se nebezpečí je sotva možné (rychlý pohyb, omezený prostor, nebezpečí nemusí být vidět).");
  const pPossible = tr("P1: vyhnout se je za určitých podmínek možné (pohyb zastaví dřív, než obsluha nebezpečí dosáhne; pomalý pohyb ≤ 250 mm/s) — u rychlých pohybů zvol P2.");
  switch (kind) {
    case "estop": return { S: "S2", F: "F1", P: "P2", why: { S: sS2, F: fRare, P: tr("P2: v nouzové situaci se obsluha nebezpečí obvykle vyhnout nedokáže.") }, min: { pl: "c", why: tr("ISO 13850:2015 požaduje pro nouzové zastavení nejméně PL c.") } };
    case "guard": case "light_curtain": case "muting": case "mat": case "scanner":
      return press ? { S: "S2", F: "F2", P: "P2", why: { S: tr("S2: stlačení / střih v nástroji lisu — vážné nevratné zranění."), F: fOften, P: tr("P2: zdvih lisu je rychlý, ruka v nástroji se nestihne stáhnout.") } }
        : { S: "S2", F: "F2", P: "P1", why: { S: sS2, F: fOften, P: pPossible } };
    case "multibeam": return { S: "S2", F: "F1", P: "P2", why: { S: sS2, F: tr("F1: vstup celým tělem do prostoru je výjimečný (seřizování, odstraňování poruch)."), P: pHard } };
    case "guard_lock": return { S: "S2", F: "F1", P: "P2", why: { S: sS2, F: tr("F1: otevírání zamčeného krytu během doběhu je výjimečné."), P: tr("P2: doběh pohybu je delší než doba přístupu — bez zámku se nebezpečí vyhnout nelze.") } };
    case "two_hand": return press ? { S: "S2", F: "F2", P: "P2", why: { S: tr("S2: stlačení / střih v nástroji lisu — vážné nevratné zranění."), F: tr("F2: obsluha sahá do nástroje v každém cyklu."), P: tr("P2: zdvih lisu je rychlý, ruka v nástroji se nestihne stáhnout.") }, min: { pl: "e", why: tr("ISO 13851:2019: dvouruční ovládání typu IIIC (lisy) = PL e, kategorie 4.") } }
      : { S: "S2", F: "F2", P: "P1", why: { S: sS2, F: tr("F2: obsluha spouští každý cyklus."), P: pPossible }, min: { pl: "c", why: tr("ISO 13851:2019: typ I a IIIA nejméně PL c.") } };
    case "enabling": return { S: "S2", F: "F1", P: "P2", why: { S: sS2, F: tr("F1: práce v nebezpečném prostoru s povolovacím spínačem jen při seřizování a výuce."), P: pHard } };
    case "mode": return { S: "S2", F: "F1", P: "P2", why: { S: sS2, F: tr("F1: přepnutí režimu je výjimečné."), P: pHard } };
    case "restart": return { S: "S2", F: "F1", P: "P2", why: { S: sS2, F: tr("F1: zásahy, po kterých hrozí neočekávaný rozběh, jsou výjimečné."), P: tr("P2: neočekávaný rozběh obsluha nepředvídá.") } };
    case "vertical": return { S: "S2", F: "F1", P: "P2", why: { S: tr("S2: pád břemene / osy — vážné nevratné zranění."), F: fRare, P: tr("P2: pádu se vyhnout nelze.") } };
    case "temperature": return { S: "S2", F: "F1", P: "P1", why: { S: tr("S2: popálení / požár."), F: fRare, P: tr("P1: přehřátí se vyvíjí pomalu a je vnímatelné — ověř podle procesu.") } };
    case "pressure": return { S: "S2", F: "F1", P: "P2", why: { S: tr("S2: roztržení tlakového systému."), F: fRare, P: pHard } };
    default: return { S: "S2", F: "F2", P: "P1", why: { S: sS2, F: fOften, P: pPossible } };
  }
}

function modesText(kind: SafetyKind): string {
  switch (kind) {
    case "estop": return tr("všechny provozní režimy (AUTO i RUČNĚ), přednost před všemi povely");
    case "enabling": return tr("seřizovací / servisní režim (práce v nebezpečném prostoru)");
    case "mode": return tr("přepínání provozních režimů");
    case "muting": return tr("automatický provoz při průchodu materiálu");
    default: return tr("všechny provozní režimy (AUTO i RUČNĚ) — standardní program ochrany nepřemosťuje");
  }
}

function groupsOf(groups: OutGroup[], ids: string[]): OutGroup[] { return groups.filter(g => ids.includes(g.id)); }

function safeStateText(gs: OutGroup[]): string {
  const parts: string[] = [];
  if (gs.some(g => g.kind === "contactors" || g.kind === "sto")) parts.push(tr("pohony bez energie (stykače odpadlé / STO)"));
  if (gs.some(g => g.kind === "exhaust")) parts.push(tr("pneumatika odvzdušněná"));
  if (gs.some(g => g.kind === "hydraulic")) parts.push(tr("hydraulika bez tlaku, pohyb zablokovaný"));
  if (gs.some(g => g.kind === "brake")) parts.push(tr("svislá osa zabrzděná"));
  if (gs.some(g => g.kind === "heater")) parts.push(tr("ohřev vypnutý"));
  return parts.join("; ") || "—";
}

/* ================================================================ návrh */

/** Normalizované parametry `Project.safety`. */
export function safetyParams(prj: Project): { dop: number; hop: number; missionYears: number; edition: Iso13855Edition } {
  const c = prj.safety || {};
  const pos = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : d);
  return { dop: pos(c.dop, D.SAFETY_NOP_DEFAULTS.dop), hop: pos(c.hop, D.SAFETY_NOP_DEFAULTS.hop), missionYears: pos(c.missionYears, D.SAFETY_NOP_DEFAULTS.missionYears), edition: c.iso13855 === "2024" ? "2024" : "2010" };
}

const DEFAULT_CCF = ["separation", "overload", "welltried", "emc", "environment"];

function ccfOf(cfg: SafetyFnCfg): { ids: string[]; points: number; ok: boolean } {
  const ids = (cfg.ccf || DEFAULT_CCF).filter(id => D.SAFETY_CCF_MEASURES.some(m => m.id === id));
  const points = ids.reduce((s, id) => s + (D.SAFETY_CCF_MEASURES.find(m => m.id === id)?.points || 0), 0);
  return { ids, points, ok: points >= D.SAFETY_CCF_MIN };
}

function catForPlr(plr: PL | null): SafetyCat {
  if (!plr) return "B";
  return plr === "e" ? "4" : plr === "d" ? "3" : plr === "c" ? "1" : "B";
}

/** Subsystém z komponenty s B10d / MTTFd výpočtem, nebo přístroj s PL. */
function subsystem(role: "I" | "L" | "O", label: string, comp: SafetyComponent | null, o: {
  cat: SafetyCat; channels: number; dc: number; ccf: number; nop: number; mission: number; b10d?: number; mttfd?: number; device?: boolean;
}): SafetySubsystem {
  const notes: string[] = [];
  if (o.device || (comp && comp.plMax && comp.b10d === undefined && comp.mttfd === undefined && !o.b10d && !o.mttfd)) {
    const pl = comp?.plMax ?? null;
    if (!pl) notes.push(tr("PL přístroje není v katalogu — doplň z prohlášení výrobce."));
    else notes.push(tr("PL podle údaje výrobce (při předepsaném zapojení); PFHd {pfh}", { pfh: comp?.pfhdText || "—" }));
    return { role, label, comp, cat: null, channels: o.channels, nop: null, mttfd: null, dc: o.dc, t10d: null, pl, from: pl ? "device" : "none", notes };
  }
  const b10d = o.b10d ?? comp?.b10d;
  let mttfd = o.mttfd ?? comp?.mttfd ?? null;
  let t10d: number | null = null;
  if (mttfd === null && b10d) {
    mttfd = mttfdFromB10d(b10d, o.nop);
    t10d = b10d / o.nop;
    notes.push(tr("MTTFd = B10d / (0,1 · nop) = {b} / (0,1 · {nop}) = {m} let", { b: b10d, nop: r0(o.nop), m: r1(mttfd) }));
    if (t10d < o.mission) notes.push(tr("T10D = {t} let < doba mise {m} let — preventivní výměna nejpozději po T10D (do návodu)", { t: r1(t10d), m: o.mission }));
  }
  if (comp?.generic) notes.push(tr("hodnota z typických hodnot / rešerše — potvrdit podle datasheetu konkrétní varianty"));
  if (mttfd === null) {
    notes.push(tr("chybí B10d / MTTFd komponenty — doplň z datasheetu"));
    return { role, label, comp, cat: o.cat, channels: o.channels, nop: r0(o.nop), mttfd: null, dc: o.dc, t10d: null, pl: null, from: "none", notes };
  }
  /* oba kanály ze stejné komponenty → symetrické; MTTFd kanálu = MTTFd komponenty */
  const calc = plFromCategory({ cat: o.cat, mttfd, dc: o.dc, ccf: o.ccf });
  notes.push(...calc.why);
  return { role, label, comp, cat: o.cat, channels: o.channels, nop: r0(o.nop), mttfd: r1(mttfd), dc: o.dc, t10d: t10d === null ? null : r1(t10d), pl: calc.pl, from: "calc", notes };
}

/** Bezpečnostní signály funkce (tagy bezpečnostní logiky; stav do standardního PLC = tag I/O). */
function signalsOf(prj: Project, f: { kind: SafetyKind; inputs: string[]; acts: string[] }, groups: OutGroup[]): SafetySignal[] {
  const s: SafetySignal[] = [];
  const st = (dev: string) => { const d = prj.devices.find(x => x.name === dev); const e = d ? Object.values(ioOf(prj, d))[0] : undefined; return e as IoEntry | undefined; };
  const inDevs = f.inputs.filter(n => prj.devices.some(d => d.name === n && d.cls === "DI"));
  const add = (x: SafetySignal) => { if (!s.some(y => y.tag === x.tag)) s.push(x); };
  switch (f.kind) {
    case "estop": case "guard": case "enabling": case "temperature": case "mat": case "muting": {
      const devs = inDevs.length ? inDevs : [f.kind === "estop" ? "ES" : f.kind === "enabling" ? "EN" : f.kind === "temperature" ? "STB" : "SG"];
      for (const dn of devs) {
        add({ tag: dn + "_ChA", dir: "in", kind: "ch", dev: dn, text: tr("{dev}: kanál A (rozpínací kontakt)", { dev: dn }) });
        add({ tag: dn + "_ChB", dir: "in", kind: "ch", dev: dn, text: tr("{dev}: kanál B (rozpínací kontakt)", { dev: dn }) });
      }
      break;
    }
    case "light_curtain": case "multibeam": case "scanner": {
      for (const dn of inDevs) {
        add({ tag: dn + "_OSSD1", dir: "in", kind: "ossd", dev: dn, text: tr("{dev}: OSSD 1", { dev: dn }) });
        add({ tag: dn + "_OSSD2", dir: "in", kind: "ossd", dev: dn, text: tr("{dev}: OSSD 2", { dev: dn }) });
      }
      break;
    }
    case "two_hand": {
      const btn = inDevs.length >= 2 ? inDevs.slice(0, 2) : ["TH_A", "TH_B"];
      for (const dn of btn) {
        add({ tag: dn + "_NO", dir: "in", kind: "no", dev: dn, text: tr("{dev}: tlačítko, spínací kontakt", { dev: dn }) });
        add({ tag: dn + "_NC", dir: "in", kind: "nc", dev: dn, text: tr("{dev}: tlačítko, rozpínací kontakt", { dev: dn }) });
      }
      break;
    }
    case "guard_lock": {
      const locks = f.inputs.filter(n => prj.devices.some(d => d.name === n && d.cls === "DO"));
      for (const dn of inDevs) {
        add({ tag: dn + "_ChA", dir: "in", kind: "ch", dev: dn, text: tr("{dev}: kanál A (rozpínací kontakt)", { dev: dn }) });
        add({ tag: dn + "_ChB", dir: "in", kind: "ch", dev: dn, text: tr("{dev}: kanál B (rozpínací kontakt)", { dev: dn }) });
      }
      for (const dn of locks.length ? locks : ["GL"]) {
        add({ tag: dn + "_LOCKED", dir: "in", kind: "lock", dev: dn, text: tr("{dev}: hlášení zamčeno (hlídání zámku)", { dev: dn }) });
        add({ tag: dn + "_ULC", dir: "out", kind: "unlock", dev: dn, text: tr("{dev}: povel odemknout (jen po zastavení nebezpečného pohybu)", { dev: dn }) });
      }
      break;
    }
    case "mode": {
      const dn = inDevs[0] || "MS";
      add({ tag: dn + "_AUTO", dir: "in", kind: "ch", dev: dn, text: tr("{dev}: volič v poloze AUTO", { dev: dn }) });
      add({ tag: dn + "_SETUP", dir: "in", kind: "ch", dev: dn, text: tr("{dev}: volič v poloze SEŘIZOVÁNÍ", { dev: dn }) });
      break;
    }
    default: break;
  }
  if (f.kind !== "pressure") add({ tag: "SF_Reset", dir: "in", kind: "reset", text: tr("tlačítko reset bezpečnostních funkcí (mimo nebezpečný prostor, s výhledem do něj; sestupná hrana)") });
  for (const g of groupsOf(groups, f.acts)) {
    g.outs.forEach((o, i) => add({ tag: o, dir: "out", kind: g.kind === "sto" ? "sto" : "q", dev: g.devs.join(","), text: g.kind === "sto" ? tr("STO měniče {dev} (dvoukanálově)", { dev: g.devs[0] }) : tr("{g}: bezpečný výstup {n}", { g: g.id, n: i + 1 }) }));
    g.fbk.forEach(o => add({ tag: o, dir: "in", kind: "fbk", dev: g.devs.join(","), text: tr("{g}: zpětné hlášení (EDM / poloha)", { g: g.id }) }));
  }
  for (const dn of inDevs) {
    const e = st(dn);
    if (e) add({ tag: e.tag, dir: "out", kind: "status", dev: dn, text: tr("stav {dev} do standardního PLC (jen informativní signál, enable / kvitace)", { dev: dn }) });
  }
  return s;
}

/** Úplný návrh bezpečnostních funkcí projektu (deterministický, bez vedlejších účinků). */
export function proposeSafety(prj: Project): SafetyProposal {
  const cfgAll = prj.safety || {};
  const par = safetyParams(prj);
  const press = isPressProject(prj);
  const groups = outGroups(prj);
  const raws = rawFunctions(prj, groups);
  const nIn = raws.filter(r => !OUTPUT_KINDS.has(r.kind) && r.kind !== "restart" && r.kind !== "pressure").length;
  const needsPlc = raws.some(r => ["light_curtain", "two_hand", "guard_lock", "muting", "enabling", "mode", "scanner", "multibeam"].includes(r.kind)) || groups.length > 2;
  const logicId = cfgAll.logic && safetyComponent(cfgAll.logic) ? cfgAll.logic : defaultLogic(prj, nIn, needsPlc);
  const logic = safetyComponent(logicId)!;
  const target: SafetyTarget = cfgAll.target || targetForLogic(logicId);
  const plat = prj.platforms[0] || "siemens";
  const warnings: string[] = [];

  const fns: SafetyFunction[] = raws.map((r, i) => {
    const cfg: SafetyFnCfg = cfgAll.fn?.[r.ref] || {};
    const cat = D.SAFETY_FN_CATALOG[KIND_CATALOG[r.kind]];
    const inputs = cfg.inputs && cfg.inputs.length ? cfg.inputs : r.inputs;
    const acts = (cfg.acts && cfg.acts.length ? cfg.acts : r.acts).filter(a => groups.some(g => g.id === a));
    const gs = groupsOf(groups, acts);
    const hasVfd = gs.some(g => g.kind === "sto");
    const stopCat: 0 | 1 | 2 = cfg.stopCat ?? (r.kind === "pressure" ? 0 : hasVfd && (r.kind === "estop" || r.kind === "guard" || r.kind === "sto") ? 1 : 0);
    const stopWhy = stopCat === 1 ? tr("kategorie 1 (SS1): měniče nejdřív řízeně zabrzdí, pak STO — kratší doběh než volné doběhnutí") : stopCat === 2 ? tr("kategorie 2: řízené zastavení s energií (SS2/SOS) — nouzové zastavení ji použít nesmí") : tr("kategorie 0: okamžité odpojení energie (stykače, STO, odvzdušnění)");
    const name = tr(cat.name);
    const devTxt = inputs.length ? " — " + short(inputs, 4) : "";
    const title = (r.user && r.title) ? r.title : name + devTxt;
    /* riziko */
    const rp = riskProposal(r.kind, press);
    const S = cfg.S || rp.S, F = cfg.F || rp.F, P = cfg.P || rp.P;
    const graph = plrFromGraph(S, F, P);
    const risk: SafetyRisk = {
      S, F, P,
      why: { S: cfg.S && cfg.S !== rp.S ? tr("upraveno uživatelem") : rp.why.S, F: cfg.F && cfg.F !== rp.F ? tr("upraveno uživatelem") : rp.why.F, P: cfg.P && cfg.P !== rp.P ? tr("upraveno uživatelem") : rp.why.P },
      graph, min: rp.min, plr: graph, proposed: plrFromGraph(rp.S, rp.F, rp.P), sources: D.SAFETY_PLR_SOURCES,
    };
    let plr: PL = graph;
    if (cfg.reduce && cfg.reduce.trim()) { plr = PLS[Math.max(0, plRank(plr) - 1)]; risk.reduced = cfg.reduce.trim(); }
    if (rp.min && plRank(rp.min.pl) > plRank(plr)) plr = rp.min.pl;
    if (cfg.plr && PLS.includes(cfg.plr)) { plr = cfg.plr; risk.override = { pl: cfg.plr, source: cfg.plrSource || "" }; }
    risk.plr = r.kind === "pressure" ? null : plr;
    const demandS = cfg.demandS && cfg.demandS > 0 ? cfg.demandS : defaultDemand(r.kind, prj, press);
    const haz: string[] = [];
    return {
      id: "SF" + (i + 1), no: i + 1, ref: r.ref, kind: r.kind, catalog: KIND_CATALOG[r.kind], off: !!cfg.off, user: !!r.user,
      title, name, hazards: haz, inputs, acts, missing: r.missing,
      trigger: tr(cat.trigger) + (inputs.length ? " " + tr("Vstupy: {devs}.", { devs: inputs.map(n => { const d = prj.devices.find(x => x.name === n); return d ? n + " (" + (d.desc || n) + ")" : n; }).join(", ") }) : ""),
      reaction: tr(cat.reaction) + (gs.length ? " " + tr("Výstupy: {outs}.", { outs: gs.map(g => g.label).join("; ") }) : ""),
      safeState: safeStateText(gs), modes: modesText(r.kind),
      resetText: cat.reset ? tr(cat.reset) : tr("Ruční reset tlačítkem SF_Reset mimo nebezpečný prostor (sestupná hrana, sledovaná změna signálu); reset stroj nespustí — nový start jen povelem START standardního programu."),
      energyLoss: tr("Ztráta napájení = bezpečný stav (klidové rozpínání, výstupy bez energie); po obnovení napájení nutný ruční reset (studený start ručně)."),
      stopCat, stopWhy, demandS, risk, design: null, distance: null,
      tests: cat.tests.map((t, k) => ({ id: "t" + (k + 1), name: tr(t.name), kind: t.kind, procedure: tr(t.procedure), expected: tr(t.expected), sources: t.sources })),
      typical: { plr: tr(cat.typicalPlr), arch: cat.typicalArch ? tr(cat.typicalArch) : "", channels: cat.channels ? tr(cat.channels) : "", edm: cat.edm ? tr(cat.edm) : "", components: cat.components.map(x => tr(x)) },
      standards: cat.standards.map(s => tr(s)), sources: cat.sources, note: cfg.note || "",
      role: r.kind === "pressure" ? "passive" : OUTPUT_KINDS.has(r.kind) ? "output" : "input",
    };
  });

  /* výstupní funkce dědí PLr od vstupních funkcí, které na jejich výstupy působí */
  for (const f of fns.filter(x => x.role === "output" && !x.off)) {
    const feeders = fns.filter(x => x.role === "input" && !x.off && x.acts.some(a => f.acts.includes(a)));
    const cfg = cfgAll.fn?.[f.ref] || {};
    const top = feeders.reduce<SafetyFunction | null>((m, x) => !m || plRank(x.risk.plr) > plRank(m.risk.plr) ? x : m, null);
    if (top && !cfg.S && !cfg.F && !cfg.P && !cfg.plr) {
      f.risk = { ...top.risk, why: { S: tr("převzato z {sf} (nejvyšší PLr funkcí, které tento výstup vyžadují)", { sf: top.id }), F: top.risk.why.F, P: top.risk.why.P }, min: undefined };
    }
    if (feeders.length && !cfg.demandS) f.demandS = Math.min(...feeders.map(x => x.demandS));
    f.trigger = tr(D.SAFETY_FN_CATALOG[f.catalog].trigger) + (feeders.length ? " " + tr("Vyžadují: {sfs}.", { sfs: feeders.map(x => x.id).join(", ") }) : "");
  }

  /* návrh architektury a výpočet PL */
  for (const f of fns) {
    if (f.off) continue;
    const cfg = cfgAll.fn?.[f.ref] || {};
    f.design = designOf(prj, f, cfg, groups, logic, par, plat, press);
    f.distance = distanceOf(f, cfg, par.edition, press);
  }

  /* nebezpečí */
  const hazards = hazardsOf(prj, fns, groups, press);
  for (const h of hazards) for (const sf of h.fns) { const f = fns.find(x => x.id === sf); if (f) f.hazards.push(h.text); }
  for (const h of hazards.filter(x => !x.fns.length)) warnings.push(tr("Nebezpečí „{h}“ nemá přiřazenou bezpečnostní funkci — doplň ochranné zařízení (kryt, závoru) nebo zdůvodni, proč není potřeba.", { h: h.text }));
  if (groups.length && !fns.some(f => !f.off && ["guard", "light_curtain", "multibeam", "scanner", "mat", "two_hand", "guard_lock"].includes(f.kind)))
    warnings.push(tr("Projekt nemá žádné ochranné zařízení (kryt se spínačem, světelnou závoru…) — nouzové zastavení je jen doplňkové opatření, ochranu před nebezpečím nenahrazuje (ISO 12100)."));
  return { fns, hazards, groups, logic, target, edition: par.edition, params: { dop: par.dop, hop: par.hop, missionYears: par.missionYears }, warnings };
}

function hazardsOf(prj: Project, fns: SafetyFunction[], groups: OutGroup[], press: boolean): SafetyHazard[] {
  const live = fns.filter(f => !f.off);
  const ids = (pred: (f: SafetyFunction) => boolean) => live.filter(pred).map(f => f.id);
  const protective = (f: SafetyFunction) => ["guard", "guard_lock", "light_curtain", "multibeam", "scanner", "mat", "two_hand", "muting"].includes(f.kind);
  const out: SafetyHazard[] = [];
  const add = (id: string, devs: string[], fnIds: string[]) => out.push({ id, text: tr(HAZ[id]), devs: [...new Set(devs)], fns: [...new Set(fnIds)] });
  if (!groups.length) return out;
  add("emergency", [], ids(f => f.kind === "estop"));
  const mot = groups.filter(g => g.kind === "contactors" || g.kind === "sto").flatMap(g => g.devs);
  const actsKind = (f: SafetyFunction, kinds: string[]) => f.acts.some(a => groups.some(g => g.id === a && kinds.includes(g.kind)));
  if (mot.length) add("motion", mot, ids(f => (protective(f) && actsKind(f, ["contactors", "sto"])) || f.kind === "sto"));
  const pn = groups.filter(g => g.kind === "exhaust").flatMap(g => g.devs);
  if (pn.length) add("pneumatic", pn, ids(f => (protective(f) && actsKind(f, ["exhaust"])) || f.kind === "pneumatic"));
  const hy = groups.find(g => g.id === "YH");
  if (hy) add("hydraulic", hy.devs, ids(f => (protective(f) && actsKind(f, ["hydraulic"])) || f.kind === "hydraulic" || f.kind === "pressure"));
  if (press) add("press", prj.devices.filter(d => has(d.desc, RE.press)).map(d => d.name), ids(f => f.kind === "two_hand" || f.kind === "light_curtain" || f.kind === "guard" || f.kind === "guard_lock"));
  add("access", fns.filter(f => protective(f)).flatMap(f => f.inputs), ids(f => protective(f)));
  add("restart", [], ids(f => f.kind === "restart"));
  const br = groups.filter(g => g.kind === "brake").flatMap(g => g.devs);
  const vv = prj.devices.filter(d => d.cls === "Ventil" && has(d.desc, RE.vertical)).map(d => d.name);
  if (br.length || vv.length) add("gravity", [...br, ...vv], ids(f => f.kind === "vertical"));
  const kh = groups.find(g => g.id === "KH");
  if (kh) add("thermal", kh.devs, ids(f => f.kind === "temperature"));
  if (live.some(f => f.kind === "pressure")) add("pressure", prj.devices.filter(d => d.cls === "AnalogIn" && has(d.desc, RE.pressureVessel)).map(d => d.name), ids(f => f.kind === "pressure"));
  if (prj.devices.some(d => has(d.desc, RE.robot))) add("robot", prj.devices.filter(d => has(d.desc, RE.robot)).map(d => d.name), ids(f => f.kind === "enabling" || f.kind === "mode"));
  return out;
}

function designOf(prj: Project, f: SafetyFunction, cfg: SafetyFnCfg, groups: OutGroup[], logic: SafetyComponent,
  par: { dop: number; hop: number; missionYears: number }, plat: PlatformKey, press: boolean): SafetyDesign {
  const problems: string[] = [];
  const ccf = ccfOf(cfg);
  const plr = f.risk.plr;
  const cat = cfg.cat || catForPlr(plr);
  const dual = cat === "3" || cat === "4";
  const nop = nopFrom(par.dop, par.hop, f.demandS);
  const subs: SafetySubsystem[] = [];
  const dcIn = Number.isFinite(cfg.dcIn) ? cfg.dcIn as number : dual ? 99 : cat === "2" ? 90 : 0;
  const dcOut = Number.isFinite(cfg.dcOut) ? cfg.dcOut as number : dual ? 99 : cat === "2" ? 90 : 0;
  const ch = dual ? 2 : 1;
  const base = { cat, channels: ch, ccf: ccf.points, nop, mission: par.missionYears };
  /* vstup */
  const inp = (label: string, comp: SafetyComponent | null, device = false) =>
    subs.push(subsystem("I", label, comp, { ...base, dc: dcIn, device, b10d: cfg.b10dIn, mttfd: cfg.mttfdIn }));
  const compIn = cfg.compIn ? safetyComponent(cfg.compIn) : null;
  switch (f.kind) {
    case "estop": inp(tr("tlačítko nouzového zastavení, 2 rozpínací kontakty s přímým rozpínáním"), compIn || pickComp("estop", plat, plat === "siemens" ? undefined : "schneider-harmony-xb4-xb5")); break;
    case "guard": {
      const c = compIn || (plRank(plr) >= 4 ? pickComp("guard_switch", plat, "schmersal-rss-260") : pickComp("guard_switch", plat, plat === "siemens" ? "siemens-sirius-3se5-3se52" : "schmersal-az-16"));
      inp(plRank(plr) >= 4 ? tr("kódovaný bezdotykový spínač krytu (RFID, OSSD)") : tr("spínač krytu se samostatným aktuátorem, rozpínací + spínací kontakt"), c, !!c && !c.b10d);
      break;
    }
    case "guard_lock": inp(tr("zámek krytu s hlídáním zamčení (princip: zamčeno pružinou, odemknutí energií)"), compIn || pickComp("guard_lock", plat, "schmersal-azm-201"), true); break;
    case "light_curtain": inp(tr("bezpečnostní světelná závora typ 4 (IEC 61496), 2 × OSSD"), compIn || pickComp("light_curtain", plat, "sick-detec4-core"), true); break;
    case "multibeam": inp(tr("vícepaprsková světelná mříž typ 4, 2 × OSSD"), compIn || pickComp("light_curtain", plat, "pilz-psenopt-ii"), true); break;
    case "scanner": inp(tr("bezpečnostní laserový skener typ 3, 2 × OSSD"), compIn || pickComp("scanner", plat, "sick-nanoscan3-core"), true); break;
    case "mat": inp(tr("bezpečnostní rohož (ISO 13856-1) s vyhodnocovací jednotkou"), compIn || unknownComp("mat", tr("bezpečnostní rohož — typ doplní uživatel")), true); break;
    case "two_hand": inp(tr("dvouruční pult: 2 tlačítka, každé spínací + rozpínací kontakt (antivalentně)"), compIn || safetyComponent("siemens-sirius-act-3su1-dvourucni-pult")); break;
    case "enabling": inp(tr("třípolohový povolovací spínač, 2 kanály"), compIn || pickComp("enabling_device", plat, "idec-he1g")); break;
    case "mode": inp(tr("volič provozního režimu s uzamčením (klíč / RFID)"), compIn || pickComp("mode_selector", plat, "pilz-pitmode-fusion"), true); break;
    case "muting": inp(tr("světelná závora s muting senzory"), compIn || pickComp("light_curtain", plat, "sick-detec4-core"), true); break;
    case "temperature": inp(tr("bezpečnostní omezovač teploty (STB, EN 14597)"), compIn || unknownComp("stb", tr("omezovač teploty — typ a MTTFd doplní uživatel"))); break;
    case "restart": subs.push(subsystem("I", tr("tlačítko reset (spínací + rozpínací kontakt, sledovaná hrana)"), compIn || genericComp("pushbutton"), { ...base, cat: cat === "B" ? "B" : "2", channels: 1, dc: Number.isFinite(cfg.dcIn) ? cfg.dcIn as number : 90, b10d: cfg.b10dIn, mttfd: cfg.mttfdIn })); break;
    default: break;
  }
  /* logika */
  if (f.kind !== "pressure") subs.push(subsystem("L", tr("bezpečnostní logika: {brand} {series}", { brand: logic.brand || "", series: logic.series || logic.label }), logic, { ...base, dc: 99, device: true }));
  /* výstupy */
  for (const g of groupsOf(groups, f.acts)) {
    const compOut = cfg.compOut ? safetyComponent(cfg.compOut) : null;
    const o = { ...base, dc: dcOut, b10d: cfg.b10dOut, mttfd: cfg.mttfdOut };
    if (g.kind === "contactors" || g.kind === "heater") subs.push(subsystem("O", g.label + (dual ? " — " + tr("2 stykače v sérii, EDM") : ""), compOut || g.comp || genericComp("contactor_nom"), { ...o, channels: dual ? 2 : 1 }));
    else if (g.kind === "sto") subs.push(subsystem("O", g.label, compOut || g.comp, { ...o, device: true }));
    else if (g.kind === "exhaust") subs.push(subsystem("O", g.label, compOut || g.comp, { ...o, device: !!(compOut || g.comp)?.plMax }));
    else if (g.kind === "hydraulic") {
      const m = nop >= 1e6 ? 150 : nop >= 5e5 ? 300 : nop >= 2.5e5 ? 600 : 1200;
      const key = nop >= 1e6 ? "hyd_1m" : nop >= 5e5 ? "hyd_500k" : nop >= 2.5e5 ? "hyd_250k" : "hyd_low";
      subs.push(subsystem("O", g.label, compOut || genericComp(key), { ...o, mttfd: cfg.mttfdOut ?? m }));
    } else if (g.kind === "brake") subs.push(subsystem("O", g.label + " — " + tr("2 brzdy / brzda + zadržovací ústrojí, test brzdy (SBT)"), compOut || g.comp, { ...o, dc: Number.isFinite(cfg.dcOut) ? cfg.dcOut as number : 60, mttfd: cfg.mttfdOut ?? 150 }));
  }
  if (f.kind === "pressure") problems.push(tr("Tlak se jistí pojistným ventilem (mechanický základní princip) — PL se nepočítá; tlakový spínač a alarm jsou doplněk. Doplň typ a nastavení ventilu."));
  const plRes = f.kind === "pressure" ? null : minPl(subs.map(s => s.pl));
  for (const s of subs) if (!s.pl && f.kind !== "pressure") problems.push(tr("Subsystém „{s}“: PL nelze určit — {why}", { s: s.label, why: s.notes.filter(Boolean).slice(-1)[0] || tr("chybí data") }));
  if (plr && plRes && plRank(plRes) < plRank(plr)) problems.push(tr("Dosažené PL {pl} je nižší než PLr {plr} — omezuje: {subs}. Zvol vyšší kategorii, komponenty s lepšími daty (B10d, PL přístroje) nebo jinou architekturu.", {
    pl: plRes, plr, subs: subs.filter(s => s.pl && plRank(s.pl) < plRank(plr)).map(s => s.role + " " + s.label).join("; "),
  }));
  for (const s of subs) if (s.cat && s.from === "calc" && ccf.points < D.SAFETY_CCF_MIN && s.cat !== "B" && s.cat !== "1") { problems.push(tr("Opatření proti CCF: {p} bodů < {min}.", { p: ccf.points, min: D.SAFETY_CCF_MIN })); break; }
  if (f.missing.length) problems.push(...f.missing.map(m => tr("Chybí: {what}", { what: m })));
  if (logic && plr && logic.plMax && plRank(logic.plMax) < plRank(plr)) problems.push(tr("Logika {l} dosahuje jen PL {pl} — pro PLr {plr} doplň bezpečnostní partner / jinou logiku.", { l: logic.series || logic.label, pl: logic.plMax, plr }));
  const signals = signalsOf(prj, f, groups);
  const ok = !!plr && !!plRes && plRank(plRes) >= plRank(plr);
  const wiring = wiringOf(f, signals, cat, groups);
  return { cat, channels: ch, edm: groupsOf(groups, f.acts).some(g => g.fbk.length > 0), reset: "manual", ccf, subs, pl: plRes, ok, problems: [...new Set(problems)], signals, wiring };
}

function wiringOf(f: SafetyFunction, sig: SafetySignal[], cat: SafetyCat, groups: OutGroup[]): string[] {
  const w: string[] = [];
  const ins = sig.filter(s => s.dir === "in" && (s.kind === "ch" || s.kind === "ossd" || s.kind === "no" || s.kind === "nc"));
  if (ins.length) w.push(cat === "3" || cat === "4"
    ? tr("Vstupy {tags}: dvoukanálově do bezpečnostní logiky, taktované signály (pulzní test) pro detekci příčného zkratu, hlídání nesouladu kanálů.", { tags: ins.map(s => s.tag).join(", ") })
    : tr("Vstupy {tags}: jednokanálově do bezpečnostní logiky, osvědčené komponenty s přímým rozpínáním.", { tags: ins.map(s => s.tag).join(", ") }));
  if (sig.some(s => s.kind === "reset")) w.push(tr("Reset SF_Reset: tlačítko mimo nebezpečný prostor s výhledem do něj; vyhodnocení sestupné hrany; reset jen připraví, start dává standardní program."));
  for (const g of groupsOf(groups, f.acts)) {
    if (g.kind === "contactors" || g.kind === "heater") w.push(tr("{g}: dva stykače v sérii řízené výstupy {outs}; rozpínací zrcadlové kontakty do EDM {fbk} (zpětná vazba před každým startem).", { g: g.id, outs: g.outs.join(" / "), fbk: g.fbk.join(" / ") }));
    else if (g.kind === "sto") w.push(tr("{g}: dvoukanálový vstup STO měniče z bezpečného výstupu {outs}; při kategorii zastavení 1 vypnout se zpožděním po řízeném zabrzdění (SS1-t).", { g: g.id, outs: g.outs.join(" / ") }));
    else if (g.kind === "exhaust") w.push(tr("{g}: bezpečnostní ventil (odvzdušnění přívodu / dvojitý ventil válce), cívka z výstupu {outs}, hlášení polohy {fbk}.", { g: g.id, outs: g.outs.join(" / "), fbk: g.fbk.join(" / ") }));
    else if (g.kind === "hydraulic") w.push(tr("{g}: dva ventily v sérii, cívky {outs}, sledování polohy šoupátek {fbk}.", { g: g.id, outs: g.outs.join(" / "), fbk: g.fbk.join(" / ") }));
    else if (g.kind === "brake") w.push(tr("{g}: dvoukanálové ovládání brzdy {outs}, hlášení {fbk}; cyklický test brzdy.", { g: g.id, outs: g.outs.join(" / "), fbk: g.fbk.join(" / ") }));
  }
  const st = sig.filter(s => s.kind === "status");
  if (st.length) w.push(tr("Stav do standardního PLC: {tags} (pomocný kontakt / zrcadlení z bezpečnostní logiky) — standardní program ho čte jen jako enable a kvitaci.", { tags: st.map(s => s.tag).join(", ") }));
  return w;
}

function distanceOf(f: SafetyFunction, cfg: SafetyFnCfg, edition: Iso13855Edition, press: boolean): SafetyDistance | null {
  const mode: DistanceMode | null = f.kind === "light_curtain" || f.kind === "muting" ? "orthogonal" : f.kind === "multibeam" ? "multibeam"
    : f.kind === "scanner" ? "parallel" : f.kind === "two_hand" ? "two_hand" : f.kind === "mat" ? "mat" : f.kind === "guard" && Number.isFinite(cfg.DGT) ? "guard" : null;
  if (!mode) return null;
  const dev = f.kind === "scanner" ? 95 : f.kind === "two_hand" ? 0 : 15;
  const d = cfg.d ?? (f.kind === "light_curtain" || f.kind === "muting" ? (press ? 14 : 30) : f.kind === "scanner" ? 70 : undefined);
  const res = safetyDistance({ edition, mode, tStopMs: cfg.tStopMs, tDeviceMs: cfg.tDeviceMs ?? dev, tLogicMs: cfg.tLogicMs ?? 20, d, H: cfg.H ?? (f.kind === "scanner" ? 300 : undefined), Z: cfg.Z, DGT: cfg.DGT, press });
  if (press && (mode === "orthogonal") && Number.isFinite(d)) {
    const ps = pressSupplement(d as number);
    res.warnings.push(tr("Lis: C-norma (EN 692 / EN 693 / ISO 16092) má přednost — přídavek C pro d = {d} mm je {c} mm; spouštění zdvihu závorou {ok}.", { d, c: ps.C, ok: ps.strokeByEspe ? tr("povoleno") : tr("nepovoleno") }));
  }
  if (!Number.isFinite(cfg.tDeviceMs)) res.warnings.push(tr("Reakční doba ochranného zařízení {t} ms a logiky {l} ms jsou návrh — doplň z datasheetu.", { t: dev, l: cfg.tLogicMs ?? 20 }));
  return res;
}

/* ================================================================ schvalování */

const st = (prj: Project, it: ApprovalItem): ApprovalStatus => approvalStatus(prj, it);

function fnContent(f: SafetyFunction): unknown {
  return { ref: f.ref, kind: f.kind, off: f.off, inputs: f.inputs, acts: f.acts, stop: f.stopCat, S: f.risk.S, F: f.risk.F, P: f.risk.P, reduce: !!f.risk.reduced, override: f.risk.override?.pl ?? null, plr: f.risk.plr };
}
function designContent(p: SafetyProposal, f: SafetyFunction): unknown {
  const d = f.design!;
  return {
    ref: f.ref, cat: d.cat, ch: d.channels, edm: d.edm, reset: d.reset, ccf: d.ccf.ids, logic: p.logic.id, pl: d.pl,
    subs: d.subs.map(s => [s.role, s.comp?.id ?? null, s.cat, s.channels, s.nop, s.mttfd, s.dc, s.pl]),
    par: p.params, demand: f.demandS, stop: f.stopCat,
    dist: f.distance ? { ed: f.distance.edition, mode: f.distance.mode, S: f.distance.S, T: f.distance.T, C: f.distance.C } : null,
    sig: d.signals.map(s => s.tag),
  };
}

/** `ready` / `notReady` / `blockers` položky ke schválení ze seznamu důvodů (prázdný = lze schválit). */
function blocked(reasons: string[]): Pick<ApprovalItem, "ready" | "notReady" | "blockers"> {
  const r = [...new Set(reasons)];
  return r.length ? { ready: false, notReady: r.join(" "), blockers: r } : { ready: true };
}

/**
 * Proč funkci (riziko, PLr) zatím nejde schválit: vyřazení bez zdůvodnění, PLr převzaté z normy
 * typu C bez zdroje, PLr snížené úpravou parametrů rizika (S/F/P) bez zdůvodnění v poznámce.
 * Snížení přes `reduce` nese zdůvodnění v sobě (prázdný text = bez snížení).
 */
export function fnBlockers(f: SafetyFunction): string[] {
  const out: string[] = [];
  if (f.off) {
    if (!(f.note || "").trim()) out.push(tr("Vyřazení funkce potřebuje zdůvodnění (poznámka u funkce)."));
    return out;
  }
  const r = f.risk;
  if (r.override && !(r.override.source || "").trim()) out.push(tr("PLr převzaté z normy typu C potřebuje zdroj (norma a článek)."));
  if (!r.override && r.plr && r.proposed && plRank(r.graph) < plRank(r.proposed) && !(f.note || "").trim())
    out.push(tr("Snížení PLr úpravou parametrů rizika (graf {graph} místo navrženého {proposed}) potřebuje zdůvodnění (poznámka u funkce).", { graph: r.graph, proposed: r.proposed }));
  return out;
}

/**
 * Proč návrh funkce (architektura, PL) zatím nejde schválit: dosažené PL nižší než PLr nebo
 * neurčitelné, chybějící údaje pro bezpečnou vzdálenost. Chybějící zařízení (pojistný ventil,
 * zpětné ventily…) schválení neblokuje — zůstává otevřeným bodem v `design.problems`.
 */
export function designBlockers(f: SafetyFunction): string[] {
  const out: string[] = [];
  const d = f.design, plr = f.risk.plr;
  if (!d || f.off) return out;
  if (plr && !d.pl) out.push(tr("Dosažené PL nelze určit — doplň data subsystémů (B10d / MTTFd, PL přístroje)."));
  else if (plr && d.pl && plRank(d.pl) < plRank(plr)) {
    const lim = d.subs.filter(s => !s.pl || plRank(s.pl) < plRank(plr)).map(s => s.role + " " + s.label);
    out.push(tr("Dosažené PL {pl} je nižší než PLr {plr} — omezuje: {subs}.", { pl: d.pl, plr, subs: lim.join("; ") || "—" }));
  }
  if (f.distance && f.distance.missing.length) out.push(tr("chybí pro výpočet bezpečné vzdálenosti: {what}", { what: f.distance.missing.join(", ") }));
  return out;
}

/** Položky ke schválení bezpečnostního modulu (bez `safety:program`, ten skládá `safetyApprovalItems`). */
function baseItems(prj: Project, p: SafetyProposal): ApprovalItem[] {
  const items: ApprovalItem[] = [];
  items.push({
    key: "safety:hazards", group: "safety", required: true, title: tr("Nebezpečí a přiřazení bezpečnostních funkcí"),
    summary: tr("{n} nebezpečí, {m} navržených funkcí ({off} vyřazeno); identifikace nebezpečí a volba opatření (ISO 12100) — aplikace nerozhoduje, že je riziko přijatelné.", { n: p.hazards.length, m: p.fns.filter(f => !f.off).length, off: p.fns.filter(f => f.off).length })
      + (p.warnings.length ? " " + tr("Upozornění: {n}.", { n: p.warnings.length }) : ""),
    hash: contentHash({ hz: p.hazards.map(h => [h.id, h.devs, h.fns]), fns: p.fns.map(f => [f.id, f.ref, f.off]) }),
  });
  for (const f of p.fns) {
    items.push({
      key: "safety:" + f.id, group: "safety", required: true,
      title: f.id + " — " + f.title,
      summary: f.off ? tr("vyřazeno z návrhu: {why}", { why: f.note || tr("bez zdůvodnění — doplň") })
        : (f.risk.plr ? tr("PLr {plr} ({s}/{f}/{p}{red}); kategorie zastavení {stop}; spouští: {inp}", {
          plr: f.risk.plr, s: f.risk.S, f: f.risk.F, p: f.risk.P, red: f.risk.reduced ? ", " + tr("sníženo o 1") : f.risk.override ? ", " + tr("z normy typu C") : "",
          stop: f.stopCat, inp: f.inputs.join(", ") || f.missing.join(", ") || "—",
        }) : tr("bez PLr (mechanický princip); kategorie zastavení {stop}", { stop: f.stopCat })),
      hash: contentHash(fnContent(f)),
      ...blocked(fnBlockers(f)),
    });
    if (!f.off && f.design) {
      const d = f.design;
      items.push({
        key: "safety:" + f.id + ":design", group: "safety", required: true,
        title: tr("{sf} — architektura, komponenty a výpočet PL", { sf: f.id }),
        summary: tr("kat. {cat}, {ch} kanál(y), EDM {edm}; dosažené PL {pl} {cmp} PLr {plr}; logika {logic}", {
          cat: d.cat || "—", ch: d.channels, edm: d.edm ? tr("ano") : tr("ne"), pl: d.pl || "—", cmp: d.ok ? "≥" : "<", plr: f.risk.plr || "—", logic: p.logic.series || p.logic.label,
        }) + (f.distance && f.distance.S !== null ? "; " + tr("S = {s} mm (ISO 13855:{ed})", { s: f.distance.S, ed: f.distance.edition }) : "")
          + (d.problems.length ? "; " + tr("{n} otevřených bodů", { n: d.problems.length }) : ""),
        hash: contentHash(designContent(p, f)), ...blocked(designBlockers(f)),
      });
    }
  }
  return items;
}

/** Stav schválení bezpečnostních funkcí (bez programu). */
export interface SafetyApprovalState {
  /** Všechny položky nebezpečí, funkcí a návrhu jsou platně schválené. */
  fnsApproved: boolean;
  /** Bezpečnostní program schválen (a funkce také). */
  programApproved: boolean;
  /** Položky funkcí, které nejsou platně schválené. */
  open: Array<{ item: ApprovalItem; status: ApprovalStatus }>;
}

/** Položky ke schválení bezpečnostního modulu (provider „safety“ v approval.ts). */
export function safetyApprovalItems(prj: Project): ApprovalItem[] {
  const p = proposeSafety(prj);
  const items = baseItems(prj, p);
  if (p.fns.some(f => !f.off && f.role !== "passive")) {
    const open = items.filter(i => st(prj, i) !== "approved");
    const fnsOk = !open.length;
    items.push({
      key: "safety:program", group: "safety", required: true,
      title: tr("Bezpečnostní program ({target})", { target: targetLabel(p.target) }),
      summary: tr("bezpečnostní program / konfigurace pro {logic}: certifikované bloky pro {n} funkcí, výstupy {outs}; generuje se až po schválení funkcí", {
        logic: p.logic.series || p.logic.label, n: p.fns.filter(f => !f.off && f.role !== "passive").length, outs: p.groups.map(g => g.id).join(", ") || "—",
      }),
      hash: programHashFn ? programHashFn(prj, p) : contentHash({ t: p.target }),
      ready: fnsOk, notReady: fnsOk ? undefined : tr("nejdřív schválit bezpečnostní funkce ({n} položek)", { n: open.length }),
    });
  }
  return items;
}

/** Otisk programu dodá safety_prog.ts (aby se moduly nenačítaly v kruhu). */
let programHashFn: ((prj: Project, p: SafetyProposal) => string) | null = null;
export function setSafetyProgramHash(fn: (prj: Project, p: SafetyProposal) => string): void { programHashFn = fn; }

export function safetyApprovalState(prj: Project, items: ApprovalItem[] = safetyApprovalItems(prj)): SafetyApprovalState {
  const fnItems = items.filter(i => i.key !== "safety:program");
  const open = fnItems.map(item => ({ item, status: st(prj, item) })).filter(x => x.status !== "approved");
  const prog = items.find(i => i.key === "safety:program");
  return { fnsApproved: !open.length, programApproved: !open.length && !!prog && st(prj, prog) === "approved", open };
}

export function targetLabel(t: SafetyTarget): string {
  return ({ siemens: "Siemens F-program", rockwell: "Rockwell GuardLogix", plcopen: "PLCopen Safety", pilz: "Pilz PNOZmulti", sick: "SICK Flexi Soft", schmersal: "Schmersal PROTECT PSC1", relay: tr("bezpečnostní relé") } as Record<SafetyTarget, string>)[t];
}

/* ================================================================ oživení (fáze 10) */

/** Kroky validace bezpečnostních funkcí do plánu oživení. */
export function safetyCommissioningSteps(prj: Project): CommissioningStep[] {
  const p = proposeSafety(prj);
  const out: CommissioningStep[] = [];
  for (const f of p.fns.filter(x => !x.off)) {
    const sig = (f.design?.signals || []).map(s => s.tag);
    f.tests.forEach((t, k) => out.push({
      id: "sf:" + f.ref + ":" + t.id, phase: 10, title: f.id + ": " + t.name,
      how: t.procedure, expect: t.expected, signals: sig, data: { ref: f.ref, k, kind: t.kind },
    }));
    if (f.distance) out.push({
      id: "sf:" + f.ref + ":distance", phase: 10, title: tr("{sf}: doba doběhu a bezpečná vzdálenost (ISO 13855)", { sf: f.id }),
      how: tr("Změř dobu doběhu nebezpečného pohybu od vyžádání funkce (měřič doběhu, nejhorší případ: plná rychlost, nejvyšší zatížení) a změř skutečnou vzdálenost ochranného zařízení od nebezpečného místa."),
      expect: f.distance.S !== null ? tr("Skutečná vzdálenost ≥ S = {s} mm (vzorec {f}); změřená doba doběhu nepřekročí hodnotu použitou ve výpočtu.", { s: f.distance.S, f: f.distance.formula }) : tr("Změřenou dobu doběhu zapiš do projektu — bez ní nelze vzdálenost spočítat ani schválit návrh."),
      signals: sig, data: { ref: f.ref, S: f.distance.S, ed: f.distance.edition },
    });
  }
  if (p.fns.some(f => !f.off && f.role !== "passive")) {
    out.push({ id: "sf:config", phase: 10, title: tr("Bezpečnostní program / konfigurace: verze a podpis"), how: tr("Porovnej nahraný bezpečnostní program / konfiguraci s dokumentací (verze, souhrnný podpis / CRC, parametry: časy nesouladu, reset, zpoždění)."), expect: tr("Verze a podpis odpovídají schválenému stavu; zapsáno v protokolu validace."), signals: [], data: { target: p.target } });
    out.push({ id: "sf:report", phase: 10, title: tr("Validační zpráva bezpečnostních funkcí"), how: tr("Shrň výsledky zkoušek fáze 10, odchylky a jejich řešení; podepíše osoba nezávislá na návrhu (míra nezávislosti podle PLr)."), expect: tr("Všechny bezpečnostní funkce validované bez otevřených bodů — bez toho stroj nepředávat."), signals: [], data: { n: p.fns.filter(f => !f.off).length } });
  }
  return out;
}

/* ================================================================ registr modulu */

let offs: Array<() => void> = [];
/** Další zdroje, které modul přihlašuje (dokumenty, kusovník — dodá safety_docs.ts). */
const extraRegs: Array<() => () => void> = [];
export function addSafetyRegistration(fn: () => () => void): void { extraRegs.push(fn); if (offs.length) offs.push(fn()); }

/** Přihlásí bezpečnostní modul (položky ke schválení, kroky oživení, dokumenty, kusovník). Vrací odhlášení. */
export function registerSafetyModule(): () => void {
  unregisterSafetyModule();
  offs = [
    registerApprovalProvider(safetyApprovalItems, "safety"),
    registerCommissioningProvider(safetyCommissioningSteps, "safety"),
    ...extraRegs.map(f => f()),
  ];
  return unregisterSafetyModule;
}
/** Odhlásí bezpečnostní modul (testy, klient bez modulu). */
export function unregisterSafetyModule(): void { for (const o of offs) o(); offs = []; }
export function safetyModuleRegistered(): boolean { return offs.length > 0; }

/** Popis stavu položky (pro dokumenty). */
export function safetyItemStatus(prj: Project, items: ApprovalItem[], key: string): string {
  const it = items.find(i => i.key === key);
  return it ? approvalStatusLabel(st(prj, it)) : "—";
}
