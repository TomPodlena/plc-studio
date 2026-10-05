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
import { PLAT, addrOrd, nativeAddr } from "./model.js";
import { brandsFor, catKey, brandOptId, type CatalogBrand, type CatalogHw } from "./catalog.js";
import { tr, N_ } from "./i18n.js";
import { cdsProfile } from "./codesys_profiles.js";

/** Verze pravidel sestavy — změna přidělí adresy starších projektů znovu (viz `prj.hw`). */
export const HW_VER = 1;
export const HW_DIRS: Dir[] = ["DI", "DO", "AI", "AO"];
const CAT_OF: Record<Dir, string> = { DI: "plc_di", DO: "plc_do", AI: "plc_ai", AO: "plc_ao" };
/** Číslo typu v označení (IEC 81346): -A2 DI, -A3 DO, -A4 AI, -A5 AO; vzdálená stanice s: -A(10s + typ). */
const TYPE_NO: Record<Dir, number> = { DI: 2, DO: 3, AI: 4, AO: 5 };
const isIn = (d: Dir) => d === "DI" || d === "AI";
const isAnalog = (d: Dir) => d === "AI" || d === "AO";

export type HwKind = "cpu" | "head" | "io" | "acc";
export interface HwChannel {
  mod: HwModule; dir: Dir; no: number;
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
  no: number; remote: boolean;
  /** CPU (stanice 0) nebo hlava vzdálené stanice */
  head: HwModule;
  /** I/O moduly a příslušenství v pořadí slotů (u stanice 0 vč. vestavěných I/O) */
  modules: HwModule[];
  /** síť ke CPU (vzdálené stanice): PROFINET, EtherNet/IP, EtherCAT, Modbus TCP */
  net?: string;
  /** rodina pro AutomationML (System:Device.<rodina>): S71200, ET200SP, Generic */
  family: string;
}
export interface HwIssue { level: "error" | "warn" | "info"; where: string; msg: string; }
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
  /** servoměniče os (třída Axis) jako uzly sítě ke CPU — kusovník -TA, FDS, EPLAN; bez os prázdné */
  drives: Array<{ dev: string; dt: string; net: string }>;
}

/** Síť servopohonů podle platformy (Siemens PROFINET, TwinCAT / CODESYS / Sysmac / Delta EtherCAT…); "" = osy nepodporuje. */
export function driveNet(plat: PlatformKey): string {
  return ({ siemens: "PROFINET", beckhoff: "EtherCAT", codesys: "EtherCAT", delta: "EtherCAT", omron: "EtherCAT", wago: "EtherCAT / CANopen (CiA 402)", rockwell: "EtherNet/IP (CIP Motion)" } as Partial<Record<PlatformKey, string>>)[plat]
    /* profily CODESYS se SoftMotion SM3: pohon CiA 402 pod EtherCAT masterem */
    || (cdsProfile(plat)?.axis === "sm3" ? "EtherCAT" : "");
}

/* ================================================================ volby katalogu */

/** Platforma hardwaru projektu: volba v kusovníku, jinak první zvolená platforma. */
export function hwPlatform(prj: Project): PlatformKey {
  const p = prj.bom?.plat;
  if (p && PLAT[p]) return p;
  return (prj.platforms && prj.platforms[0]) || "siemens";
}

/** Id řádku kusovníku (označení skupiny + kategorie) — volby uživatele `prj.bom.lines`. */
export const hwLineId = (tag: string, cat: string) => tag + ":" + cat;

interface Choice { opt?: CatalogBrand; custom?: string; asked?: string; }
/** Volba uživatele pro řádek / kategorii (řádek jen na platformě hardwaru). */
function userPick(prj: Project, plat: PlatformKey, hwPlat: boolean, lineId: string, cat: string): string | undefined {
  const cfg = prj.bom || {};
  return (hwPlat ? cfg.lines?.[lineId]?.brand : undefined) ?? cfg.brand?.[catKey(cat, plat)];
}
function resolve(opts: CatalogBrand[], all: CatalogBrand[], asked: string | undefined): Choice {
  if (asked === undefined) return {};
  const hit = opts.find(o => brandOptId(o) === asked) || opts.find(o => o.brand === asked);
  if (hit) return { opt: hit, asked };
  const known = all.some(o => brandOptId(o) === asked || o.brand === asked);
  return known ? { asked } : { custom: asked, asked };
}

/* ================================================================ plán stanic */

interface Pool { bus: string; left: number; }
interface PlanStation { no: number; remote: boolean; head: HwModule; mods: HwModule[]; pools: Pool[]; pts: number; net?: string; family: string; }

const N = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const chOf = (o: CatalogBrand | undefined): Partial<Record<Dir, number>> => (o?.hw?.ch || {}) as Partial<Record<Dir, number>>;

function mkModule(p: Partial<HwModule> & Pick<HwModule, "kind" | "station" | "slot" | "cat">): HwModule {
  return { key: "S" + p.station + "." + p.slot, dt: "", bomTag: "", builtin: false, ch: {}, channels: [], ...p } as HwModule;
}

interface Ctx { prj: Project; plat: PlatformKey; hwPlat: boolean; issues: HwIssue[]; }

/** Moduly a stanice pro daný počet signálů a CPU; vrací plán a zbytek, který se nevešel. */
function plan(c: Ctx, cpuOpt: CatalogBrand | undefined, cpuCustom: string | undefined, need: Record<Dir, number>) {
  const hw: CatalogHw = cpuOpt?.hw || {};
  const generic = !cpuOpt?.hw;
  const firstSlot = c.plat === "rockwell" ? 0 : 1;
  const cpu = mkModule({ kind: "cpu", station: 0, slot: firstSlot, cat: "plc_cpu", opt: cpuOpt, custom: cpuCustom, dt: "-A1", bomTag: "-A1" });
  const st0: PlanStation = {
    no: 0, remote: false, head: cpu, mods: [],
    pools: generic ? [{ bus: "*", left: Infinity }] : Object.entries(hw.slots || {}).map(([bus, n]) => ({ bus, left: N(n) })),
    pts: generic ? Infinity : (hw.maxPts ? N(hw.maxPts) : Infinity),
    family: hw.family || "Generic",
  };
  const left: Record<Dir, number> = { ...need };
  /* vestavěné I/O CPU */
  const bi = (hw.builtin || {}) as Partial<Record<Dir, number>>;
  if (HW_DIRS.some(d => N(bi[d]) > 0)) {
    const m = mkModule({ kind: "io", station: 0, slot: firstSlot, cat: "plc_cpu", builtin: true, opt: cpuOpt, ch: { ...bi }, dt: "-A1", bomTag: "-A1", key: "S0.B" });
    st0.mods.push(m);
    for (const d of HW_DIRS) left[d] -= N(bi[d]);
    st0.pts -= HW_DIRS.filter(d => !isAnalog(d)).reduce((s, d) => s + N(bi[d]), 0);
  }
  const stations: PlanStation[] = [st0];
  let nextSlot = firstSlot + 1;

  /* modul pro směr d do stanice (volba uživatele, jinak první položka katalogu se sběrnicí stanice) */
  const fill = (st: PlanStation, slot0: number): number => {
    let slot = slot0;
    for (const d of HW_DIRS) {
      while (left[d] > 0) {
        const tagBase = "-A" + (st.no * 10 + TYPE_NO[d]);
        const lineId = hwLineId(tagBase, CAT_OF[d]);
        const all = brandsFor(CAT_OF[d], c.plat).filter(o => o.hw?.ch);
        const poolOf = (bus: string | undefined) => st.pools.find(p => p.bus === "*" || p.bus === bus);
        const room = (o: CatalogBrand) => {
          const pool = poolOf(o.hw?.bus), also = o.hw?.also ? poolOf(o.hw.also) : undefined;
          return !!pool && pool.left > 0 && (!o.hw?.also || (!!also && also.left > 0))
            && N(o.hw?.pts) <= st.pts && N(chOf(o)[d]) > 0;
        };
        const fit = all.filter(room);
        if (!fit.length) break;
        const pick = resolve(fit, brandsFor(CAT_OF[d], c.plat), userPick(c.prj, c.plat, c.hwPlat, lineId, CAT_OF[d]));
        if (pick.asked !== undefined && !pick.opt && !pick.custom && c.hwPlat)
          c.issues.push({ level: "info", where: tagBase, msg: tr("Zvolený modul {opt} do této stanice nepasuje (jiná sběrnice / rack) — použit {used}.", { opt: pick.asked, used: brandOptId(fit[0]) }) });
        const o = pick.opt || fit[0];
        poolOf(o.hw?.bus)!.left--;
        if (o.hw?.also) { const a = poolOf(o.hw.also); if (a && a.bus !== "*") a.left--; }
        st.pts -= N(o.hw?.pts);
        const ch = { ...chOf(o) };
        /* vlastní díl (mimo katalog): kanály jako první vhodná položka katalogu */
        st.mods.push(mkModule({ kind: "io", station: st.no, slot: slot++, cat: CAT_OF[d], opt: pick.custom ? undefined : o, custom: pick.custom, ch, bus: o.hw?.bus, bomTag: tagBase }));
        for (const x of HW_DIRS) left[x] -= N(ch[x]);
      }
    }
    return slot;
  };
  nextSlot = fill(st0, nextSlot);

  /* vzdálené stanice (hlava z katalogu se sběrnicí `hw.remote` CPU) */
  const remoteBus = hw.remote;
  while (HW_DIRS.some(d => left[d] > 0) && remoteBus) {
    const no = stations.length;
    const tag = "-A" + no * 10;
    const all = brandsFor("plc_coupler", c.plat).filter(o => o.hw?.head === remoteBus);
    if (!all.length) break;
    const pick = resolve(all, brandsFor("plc_coupler", c.plat), userPick(c.prj, c.plat, c.hwPlat, hwLineId(tag, "plc_coupler"), "plc_coupler"));
    const co = pick.opt || all[0];
    const head = mkModule({ kind: "head", station: no, slot: 0, cat: "plc_coupler", opt: pick.custom ? undefined : co, custom: pick.custom, dt: tag, bomTag: tag, bus: remoteBus });
    const st: PlanStation = {
      no, remote: true, head, mods: [],
      pools: Object.entries(co.hw?.slots || { [remoteBus]: 0 }).map(([bus, n]) => ({ bus, left: N(n) })),
      pts: Infinity, net: co.hw?.net, family: co.hw?.family || "Generic",
    };
    const before = HW_DIRS.map(d => left[d]).join();
    fill(st, 1);
    if (!st.mods.length || before === HW_DIRS.map(d => left[d]).join()) break;
    /* příslušenství stanice: BusAdapter (s rozhraním sítě) a server modul za posledním modulem */
    const nIo = st.mods.length;
    for (const a of (co.hw?.acc || []).filter(x => x === "plc_busadapter" || x === "plc_server")) {
      const ao = brandsFor(a, c.plat)[0];
      const slot = a === "plc_server" ? nIo + 1 : 127;
      if (ao) st.mods.push(mkModule({ kind: "acc", station: no, slot, cat: a, opt: ao, dt: tag, bomTag: tag }));
    }
    stations.push(st);
  }
  return { cpu, stations, left };
}

/** Lokální kapacita CPU (počet kanálů, které pojme bez vzdálených stanic) — pro volbu největšího CPU. */
function localFits(c: Ctx, o: CatalogBrand, need: Record<Dir, number>): { fits: boolean; cap: number } {
  const r = plan({ ...c, issues: [] }, { ...o, hw: { ...o.hw, remote: undefined } }, undefined, need);
  const fits = HW_DIRS.every(d => r.left[d] <= 0);
  const cap = HW_DIRS.reduce((s, d) => s + Math.max(0, need[d] - Math.max(0, r.left[d])), 0);
  return { fits, cap };
}

/* ================================================================ adresy */

class Area {
  used = new Set<number>();
  take(start: number, len: number) { for (let i = 0; i < len; i++) this.used.add(start + i); }
  free(start: number, len: number) { for (let i = 0; i < len; i++) if (this.used.has(start + i)) return false; return true; }
  /** první volný souvislý blok od `from` (zarovnaný na `align`) */
  first(from: number, len: number, align = 1): number {
    for (let b = from; ; b += align) if (this.free(b, len)) return b;
  }
}
const bytesOf = (d: Dir, n: number) => (isAnalog(d) ? 2 * n : Math.ceil(n / 8));
const canon = (d: Dir, byte: number, k: number) => isAnalog(d)
  ? (isIn(d) ? "%IW" : "%QW") + (byte + 2 * k)
  : (isIn(d) ? "%I" : "%Q") + (byte + (k >> 3)) + "." + (k & 7);

/**
 * Adresy kanálů. S7-1200 (výchozí adresy TIA Portal): vestavěné DI/DQ od bajtu 0, vestavěné AI/AQ
 * od slova 64; signálový modul ve slotu s (2…9) digitálně od bajtu 8 + 4 (s − 2), analogově od
 * 96 + 16 (s − 2); vzdálené moduly (ET 200SP) první volný blok (digitální od 0, analogové od 64).
 * Ostatní platformy lineárně: digitální moduly od bajtu 0 za sebou po celých bajtech (FX5: X/Y
 * osmičkově = po osmicích, rozšíření za vestavěnými), analogové kanály od slova 64 za sebou.
 */
function assignAddresses(scheme: HwLayout["scheme"], modules: HwModule[]): void {
  const area = { I: new Area(), Q: new Area() };
  const linear = { I: 0, Q: 0, IW: 64, QW: 64 };
  /* odkaz kanál → modul je neenumerovatelný: sestava jde serializovat (JSON) bez cyklu */
  const put = (m: HwModule, d: Dir, start: number) => {
    for (let k = 0; k < N(m.ch[d]); k++) {
      const c = { dir: d, no: k, addr: canon(d, start, k) } as HwChannel;
      Object.defineProperty(c, "mod", { value: m, enumerable: false });
      m.channels.push(c);
    }
  };
  /* S7-1200: nejdřív pevné adresy CPU a lokálních slotů, pak vzdálené moduly do volných míst */
  if (scheme === "s71200") {
    for (const m of modules) {
      if (m.kind !== "io" || m.station !== 0) continue;
      for (const d of HW_DIRS) {
        const n = N(m.ch[d]); if (!n) continue;
        const start = m.builtin ? (isAnalog(d) ? 64 : 0) : (isAnalog(d) ? 96 + 16 * (m.slot - 2) : 8 + 4 * (m.slot - 2));
        area[isIn(d) ? "I" : "Q"].take(start, bytesOf(d, n));
        put(m, d, start);
      }
    }
    for (const m of modules) {
      if (m.kind !== "io" || m.station === 0) continue;
      for (const d of HW_DIRS) {
        const n = N(m.ch[d]); if (!n) continue;
        const a = area[isIn(d) ? "I" : "Q"];
        const start = a.first(isAnalog(d) ? 64 : 0, bytesOf(d, n), isAnalog(d) ? 2 : 1);
        a.take(start, bytesOf(d, n));
        put(m, d, start);
      }
    }
    return;
  }
  for (const m of modules) {
    if (m.kind !== "io") continue;
    for (const d of HW_DIRS) {
      const n = N(m.ch[d]); if (!n) continue;
      if (isAnalog(d)) { const k = isIn(d) ? "IW" : "QW"; put(m, d, linear[k]); linear[k] += 2 * n; }
      else { const k = isIn(d) ? "I" : "Q"; put(m, d, linear[k]); linear[k] += Math.ceil(n / 8); }
    }
  }
}

/* ================================================================ sestava */

const cache = new WeakMap<Project, Map<PlatformKey, { sig: string; io: IoEntry[]; L: HwLayout }>>();
function signature(prj: Project, plat: PlatformKey): string {
  const b = prj.bom || {};
  const lines = b.lines ? Object.entries(b.lines).filter(([k]) => /:plc_/.test(k)).map(([k, v]) => k + "=" + (v?.brand ?? "")) : [];
  return JSON.stringify([plat, hwPlatform(prj), prj.hw || null, b.brand || null, lines, prj.moduleGuids || null,
    prj.io.map(e => e.key + "|" + e.dir + "|" + (e.addr || "")), prj.devices.filter(d => d.cls === "Axis").map(d => d.name)]);
}

/** Sestava hardwaru pro platformu (výchozí = platforma hardwaru projektu). Výsledek je cachovaný. */
export function hwLayout(prj: Project, plat: PlatformKey = hwPlatform(prj)): HwLayout {
  let per = cache.get(prj);
  if (!per) { per = new Map(); cache.set(prj, per); }
  const sig = signature(prj, plat);
  const hit = per.get(plat);
  if (hit && hit.sig === sig && hit.io.length === prj.io.length && hit.io.every((e, i) => e === prj.io[i])) return hit.L;
  const L = build(prj, plat);
  per.set(plat, { sig, io: [...prj.io], L });
  return L;
}

function build(prj: Project, plat: PlatformKey): HwLayout {
  const hwPlat = plat === hwPlatform(prj);
  const issues: HwIssue[] = [];
  const c: Ctx = { prj, plat, hwPlat, issues };
  const need: Record<Dir, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const e of prj.io) if (need[e.dir] !== undefined) need[e.dir]++;

  /* CPU: volba uživatele, jinak první, do kterého se I/O vejdou lokálně, jinak největší lokální kapacita */
  const cpuAll = brandsFor("plc_cpu", plat);
  const cpuHw = cpuAll.filter(o => o.hw && o.hw.auto !== false);
  const asked = resolve(cpuAll, cpuAll, userPick(prj, plat, hwPlat, hwLineId("-A1", "plc_cpu"), "plc_cpu"));
  let cpuOpt = asked.opt, autoCpu = false;
  if (!cpuOpt && !asked.custom) {
    autoCpu = true;
    let best: { o: CatalogBrand; cap: number } | undefined;
    for (const o of cpuHw) {
      const f = localFits(c, o, need);
      if (f.fits) { cpuOpt = o; break; }
      if (!best || f.cap > best.cap) best = { o, cap: f.cap };
    }
    if (!cpuOpt) cpuOpt = best?.o || cpuAll[0];
  }
  const p = plan(c, cpuOpt, asked.custom, need);
  if (asked.custom) issues.push({ level: "info", where: "-A1", msg: tr("Vlastní CPU {cpu} není v katalogu — vestavěné I/O a limit modulů neznám, moduly navrženy bez omezení racku.", { cpu: asked.custom }) });

  /* označení modulů: skupina -A<typ> / -A<10s+typ>, víc karet ve skupině = .1, .2 … */
  const modules: HwModule[] = [];
  const stations: HwStation[] = p.stations.map(s => ({ no: s.no, remote: s.remote, head: s.head, modules: s.mods, net: s.net, family: s.family }));
  for (const s of stations) {
    const count: Record<string, number> = {}, seen: Record<string, number> = {};
    for (const m of s.modules) if (m.kind === "io" && !m.builtin) count[m.bomTag] = (count[m.bomTag] || 0) + 1;
    for (const m of s.modules) if (m.kind === "io" && !m.builtin) {
      const k = (seen[m.bomTag] = (seen[m.bomTag] || 0) + 1);
      m.dt = count[m.bomTag] > 1 ? m.bomTag + "." + k : m.bomTag;
    }
    modules.push(s.head, ...s.modules);
  }
  /* dřívější klíče karet (DI1, DO1 … po směrech, bez vestavěných) — migrace GUID */
  const legacyN: Record<string, number> = {};
  for (const m of modules) if (m.kind === "io" && !m.builtin) {
    const d = HW_DIRS.find(x => CAT_OF[x] === m.cat)!;
    m.legacy = d + (legacyN[d] = (legacyN[d] || 0) + 1);
  }
  for (const m of modules) {
    const g = prj.moduleGuids?.[m.key];
    if (g && (m.kind === "io" && !m.builtin || m.kind === "head")) m.guid = g;
  }
  const scheme: HwLayout["scheme"] = p.stations[0].family === "S71200" ? "s71200" : "linear";
  assignAddresses(scheme, modules);

  /* přiřazení signálů ke kanálům: připnuté adresy (jen platforma hardwaru se značkou), pak pořadí */
  const pins = hwPlat && !!prj.hw && prj.hw.plat === plat && prj.hw.ver === HW_VER;
  const ch = new Map<IoEntry, HwChannel>();
  const byAddr = new Map<string, HwChannel>();
  const free: Record<Dir, HwChannel[]> = { DI: [], DO: [], AI: [], AO: [] };
  for (const m of modules) for (const k of m.channels) { byAddr.set(k.addr, k); free[k.dir].push(k); }
  const rest: Array<{ e: IoEntry; i: number }> = [];
  prj.io.forEach((e, i) => {
    const k = pins && e.addr ? byAddr.get(e.addr) : undefined;
    if (k && k.dir === e.dir && !k.io) { k.io = e; ch.set(e, k); }
    else rest.push({ e, i });
  });
  rest.sort((a, b) => (addrOrd(a.e) - addrOrd(b.e)) || (a.i - b.i));
  const overflow: IoEntry[] = [];
  const ptr: Record<Dir, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const { e } of rest) {
    const list = free[e.dir] || [];
    while (ptr[e.dir] < list.length && list[ptr[e.dir]].io) ptr[e.dir]++;
    const k = list[ptr[e.dir]];
    /* ruční adresa mimo kanály sestavy (cizí) nebo na kanálu, který už připnul jiný signál (duplicita —
       hlásí validateProject jako chybu): adresa zůstane, signál dostane volný kanál ve výkresech */
    const dup = pins && !!e.addr && !!byAddr.get(e.addr)?.io;
    const foreign = pins && !!e.addr && (!byAddr.has(e.addr) || dup) && /^%[IQ]W?\d+(\.[0-7])?$/.test(e.addr);
    if (!k) { overflow.push(e); continue; }
    k.io = e; ch.set(e, k);
    if (foreign) k.foreign = true;
    if (foreign && !dup) {
      issues.push({ level: "warn", where: e.tag, msg: tr("Adresa {addr} není kanálem navržené sestavy ({plat}) — kód ji použije, ve výkresech je signál na kanálu {ch} ({hw}). Pro shodu s hardwarem přečísluj adresy.", { addr: e.addr, plat: PLAT[plat].name, ch: k.mod.dt + " " + k.dir + " " + k.no, hw: k.addr }) });
    }
  }
  if (overflow.length) {
    const by = HW_DIRS.map(d => [d, overflow.filter(e => e.dir === d).length] as const).filter(x => x[1]).map(x => x[1] + " " + x[0]).join(", ");
    issues.push({ level: "error", where: PLAT[plat].name, msg: tr("Projekt se do platformy {plat} nevejde: {n} signálů bez kanálu ({dirs}). CPU {cpu} pojme {max} modulů a katalog nemá pro tuto platformu vzdálené I/O — zvol větší CPU nebo jinou platformu.", { plat: PLAT[plat].name, n: overflow.length, dirs: by, cpu: p.cpu.opt?.orderCode || p.cpu.custom || "—", max: Object.values(cpuOpt?.hw?.slots || {}).reduce((s, n) => s + N(n), 0) }) });
  }
  const drives = prj.devices.filter(d => d.cls === "Axis").map(d => ({ dev: d.name, dt: "-TA" + (d.name.replace(/^\D+/, "") || d.name), net: driveNet(plat) }));
  return { plat, hwPlat, scheme, cpu: p.cpu, stations, modules, groups: groupsOf(modules), ch, overflow, issues, autoCpu, drives };
}

/** Kanálové skupiny (modul × směr) s obsazenými kanály — pořadí = svorkovnice X1, X2 … */
function groupsOf(modules: HwModule[]): IoModule[] {
  const out: IoModule[] = [];
  const idx: Record<Dir, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const m of modules) {
    if (m.kind !== "io") continue;
    for (const d of HW_DIRS) {
      const used = m.channels.filter(k => k.dir === d && k.io);
      if (!used.length) continue;
      out.push({ dir: d, idx: ++idx[d], ch: used.map(k => k.io!), chNo: used.map(k => k.no), cap: N(m.ch[d]), hw: m, guid: m.guid });
    }
  }
  return out;
}

/* ================================================================ dotazy */

/** Kanál signálu v sestavě platformy. */
export function hwChannel(prj: Project, plat: PlatformKey, e: IoEntry): HwChannel | undefined {
  return hwLayout(prj, plat).ch.get(e);
}
/** Kanonická adresa signálu (Siemens notace) v sestavě platformy; „“ = signál se nevešel. */
export function hwAddr(prj: Project, plat: PlatformKey, e: IoEntry): string {
  const k = hwChannel(prj, plat, e);
  if (!k) return "";
  return k.foreign ? e.addr : k.addr;
}
/** Adresa v notaci platformy (do kódu): Siemens %I0.0, CODESYS %IX0.0 / %IW32, FX5 X10; jinak „“. */
export function hwNative(prj: Project, plat: PlatformKey, e: IoEntry): string {
  return nativeAddr(plat, hwAddr(prj, plat, e), e.dir);
}

/** Označení kanálu pro lidi: „-A2.1 DI 3“ (platformy bez absolutních adres). */
export function hwChannelText(prj: Project, plat: PlatformKey, e: IoEntry): string {
  const k = hwChannel(prj, plat, e);
  return k ? k.mod.dt + " " + k.dir + " " + k.no : "";
}

/** Rockwell: alias na bod modulu Compact 5000 I/O — Local:<slot>:I.Pt00.Data, vzdálené RIO<n>:<slot>:… */
export function lxSpecOf(k: HwChannel | undefined): string {
  if (!k) return "";
  const m = k.mod;
  const mod = m.station === 0 ? "Local:" + m.slot : "RIO" + m.station + ":" + m.slot;
  return mod + ":" + (isIn(k.dir) ? "I" : "O") + "." + (isAnalog(k.dir) ? "Ch" : "Pt") + String(k.no).padStart(2, "0") + ".Data";
}

/** Adresa pro dokumentaci a výkresy v platformě hardwaru: notace platformy, Rockwell alias, jinak kanál. */
export function hwAddrText(prj: Project, e: IoEntry, plat: PlatformKey = hwPlatform(prj)): string {
  const k = hwChannel(prj, plat, e);
  if (!k) return e.addr || "";
  if (plat === "rockwell") return lxSpecOf(k);
  return nativeAddr(plat, k.foreign ? e.addr : k.addr, e.dir) || (k.foreign ? e.addr : k.mod.dt + " " + k.dir + " " + k.no);
}

/**
 * Přidělí adresy (autoAddr): e.addr = kanál sestavy platformy hardwaru. Bez `force` zůstávají
 * připnuté a cizí adresy (značka `prj.hw` platí); `force` = přečíslovat vše podle pořadí.
 */
export function hwAssign(prj: Project, force: boolean): void {
  const plat = hwPlatform(prj);
  if (force) delete prj.hw;
  const L = hwLayout(prj, plat);
  for (const e of prj.io) {
    const k = L.ch.get(e);
    if (!k) { e.addr = ""; continue; }
    if (!k.foreign) e.addr = k.addr;
  }
  prj.hw = { plat, ver: HW_VER };
}

/** Kanálové skupiny modulů platformy hardwaru (výkresy, svorkovnice, FDS). */
export function hwGroups(prj: Project, plat: PlatformKey = hwPlatform(prj)): IoModule[] {
  return hwLayout(prj, plat).groups;
}

/** Nálezy sestavy pro validaci: nevejde se (všechny platformy projektu), cizí adresy (platforma hardwaru). */
export function hwIssues(prj: Project): HwIssue[] {
  const out: HwIssue[] = [];
  const plats = new Set<PlatformKey>([...(prj.platforms || []), hwPlatform(prj)]);
  for (const p of plats) {
    const L = hwLayout(prj, p);
    for (const i of L.issues) if (i.level === "error" || L.hwPlat) out.push(i);
  }
  return out;
}

/** Krátký popis modulu pro lidi: typ z katalogu, jinak kategorie. */
export function hwTypeText(m: HwModule, t0: (cs: string) => string = tr): string {
  if (m.custom) return m.custom;
  if (m.builtin) return t0(N_("vestavěné I/O CPU"));
  const t = m.opt?.typical ? t0(m.opt.typical) : (m.opt?.series || []).map(s => t0(s)).join(" / ");
  return (t.split(" – ")[0] || t || m.cat).trim();
}

/** Signál kanálu podle katalogu (výkresy): např. „0–10 V“ u vestavěných analogů S7-1200. */
export function hwSignalText(m: HwModule | undefined, d: Dir): string {
  const s = (m?.builtin ? m?.opt?.hw?.builtinSig : m?.opt?.hw?.sig) as Partial<Record<Dir, string>> | undefined;
  return s?.[d] || "";
}

/** Texty sestavy pro lidi (FDS, README): stanice a moduly. */
export function hwSummary(prj: Project, plat: PlatformKey = hwPlatform(prj)): string[] {
  const L = hwLayout(prj, plat);
  const out: string[] = [];
  for (const s of L.stations) {
    const head = s.head;
    const name = s.remote
      ? tr("Vzdálená stanice {dt}: {type} ({code}, {net})", { dt: head.dt, type: hwTypeText(head), code: head.opt?.orderCode || head.custom || "—", net: s.net || "—" })
      : tr("Stanice CPU {dt}: {type} ({code})", { dt: head.dt, type: hwTypeText(head), code: head.opt?.orderCode || head.custom || "—" });
    out.push(name);
    for (const m of s.modules) {
      if (m.kind === "acc") continue;
      const chs = HW_DIRS.filter(d => N(m.ch[d])).map(d => {
        const used = m.channels.filter(k => k.dir === d && k.io).length;
        return d + " " + used + "/" + N(m.ch[d]);
      }).join(", ");
      out.push("  " + tr("slot {slot}: {dt} {type} ({code}) — kanály {ch}", { slot: m.builtin ? head.slot : m.slot, dt: m.dt, type: hwTypeText(m), code: m.builtin ? tr("v CPU") : (m.opt?.orderCode || m.custom || "—"), ch: chs }));
    }
  }
  for (const x of L.drives) out.push(tr("Uzel sítě {net}: {dt} servoměnič osy {dev}", { net: x.net || tr("osa na této platformě není podporována"), dt: x.dt, dev: x.dev }));
  return out;
}
