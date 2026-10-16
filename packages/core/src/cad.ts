/**
 * PLCdesk — export pro CAD (`PLCdesk_CAD.json`, formát „plcdesk-cad“ verze 2).
 *
 * Verze 2 (2026-10-15) přidává k v1 (díly, sestava, svorky, vazby): GUID (řádky `parts[].guid` odvozené
 * z `Device.guid` / `Project.guid`, `deviceGuid`, kusy karet a hlav `instances` z `moduleGuids`, stanice),
 * `parts[].safety`, revizi PLCdesk se stavem schválení (`project.revision`) a ZADÁNÍ pro hrubý 3D koncept
 * (`brief` popis / takt / koncept, `devices` s parametry pro mechaniku, `sequence`, `safety` E-stop / blokování /
 * bezpečnostní funkce). Počítá se nad synchronizovanými I/O (`cadProject`), vstup se nemění.
 *
 * Datový most PLCdesk → FreeCAD (a FreeCAD PLM): co projekt ví o fyzických dílech — řádky kusovníku
 * (`buildBom`, stabilní `BomLine.id`), umístění (rozvaděč / stroj) a způsob montáže podle kategorie,
 * příslušnost k zařízení, sestava PLC (`hwLayout`: stanice, hlava, moduly v pořadí slotů), svorkovnice
 * (kanálové skupiny výkresů = `svorkyCSV`) a vazby mezi díly (jištění → spínání → motor, ventil → válec,
 * snímač → válec, výstupní modul PLC → akční člen). ŽÁDNÁ geometrie ani rozměry — patří k modelům dílů.
 *
 * Formát je závazný (C:\CLAUDE\plcdesk_freecad\MANIFEST_SCHEMA.md): každý klíč vždy (prázdné "" / null),
 * nové pole = verze 2. Výstup je deterministický (pořadí kusovníku, sestavy a zařízení). Manifest NENÍ
 * v `docFiles` ani `genFor` (golden beze změny) — klienti ho nabízejí tlačítkem v kroku Kusovník
 * a projektová složka ho ukládá do 09_Exporty/CAD (`projectBundle` s volbou `cad`).
 */
import type { Project, PlatformKey, Device } from "./model.js";
import { modules, syncIO, hasRange, interlockDevs } from "./model.js";
import { buildBom, bomLineIsSafety, type BomLine } from "./bom.js";
import { isGuid, derivedGuid } from "./guid.js";
import { axisCfgOf, type AxisCfg } from "./axis.js";
import { stepTitle } from "./sim.js";
import { proposeSafety, safetyModuleRegistered } from "./safety.js";
import { latestRevision, revisionContent } from "./revision.js";
import { canonicalJson, fnv1a64 } from "./approval.js";
import type { SolutionConcept } from "./concept.js";
import { hwLayout, HW_DIRS, type HwModule } from "./hardware.js";
import { PLCDESK_VERSION } from "./verify_pack.js";

export const CAD_FORMAT = "plcdesk-cad";
export const CAD_VERSION = 2;
/** Jméno souboru manifestu (klienti přidají předponu čísla projektu jako u ostatních souborů). */
export const CAD_FILE = "PLCdesk_CAD.json";

export type CadLocation = "cabinet" | "field";
export type CadMount = "din" | "panel" | "rack" | "field" | "none";

/**
 * Kategorie kusovníku → umístění a montáž. JEDINÉ místo, kde se to určuje (test hlídá, že každá
 * kategorie katalogu `data/catalog/*.json`, `CAT_LABEL` i řádků od modulů bezpečnosti je zařazená).
 *   cabinet = v rozvaděči, field = na stroji;
 *   din = na DIN liště, panel = přišroubované na montážní desku / do výřezu dveří rozvaděče
 *   (měniče, servoměniče, hlavní vypínač, HMI), rack = PLC moduly v pořadí slotů (`plc.stations`),
 *   field = montáž na stroji, none = nemontuje se (skříň sama, kabely).
 * Ovládací prvky (tlačítka, signálky, E-stop) jsou na stroji / ovládacím pultu — dveře rozvaděče
 * formát verze 1 nerozlišuje.
 */
export const CAD_PLACEMENT: Record<string, { location: CadLocation; mount: CadMount }> = {
  /* PLC a příslušenství sestavy hardwaru */
  plc_cpu: { location: "cabinet", mount: "rack" },
  plc_di: { location: "cabinet", mount: "rack" },
  plc_do: { location: "cabinet", mount: "rack" },
  plc_ai: { location: "cabinet", mount: "rack" },
  plc_ao: { location: "cabinet", mount: "rack" },
  plc_coupler: { location: "cabinet", mount: "rack" },
  plc_busadapter: { location: "cabinet", mount: "rack" },
  plc_server: { location: "cabinet", mount: "rack" },
  plc_baseunit_first: { location: "cabinet", mount: "rack" },
  plc_baseunit: { location: "cabinet", mount: "rack" },
  plc_hmi: { location: "cabinet", mount: "panel" },
  /* rozvaděč: přístroje na DIN liště */
  motor_protection: { location: "cabinet", mount: "din" },
  contactor: { location: "cabinet", mount: "din" },
  contactor_mirror: { location: "cabinet", mount: "din" },
  motor_starter: { location: "cabinet", mount: "din" },
  aux_contact: { location: "cabinet", mount: "din" },
  mcb: { location: "cabinet", mount: "din" },
  interface_relay: { location: "cabinet", mount: "din" },
  safety_relay: { location: "cabinet", mount: "din" },
  safety_controller: { location: "cabinet", mount: "din" },
  power_supply_24v: { location: "cabinet", mount: "din" },
  terminal_block: { location: "cabinet", mount: "din" },
  /* rozvaděč: na montážní desce / ve dveřích */
  vfd: { location: "cabinet", mount: "panel" },
  servo_drive: { location: "cabinet", mount: "panel" },
  positioning_drive: { location: "cabinet", mount: "panel" },
  main_switch: { location: "cabinet", mount: "panel" },
  cabinet: { location: "cabinet", mount: "none" },
  /* kabely — mezi rozvaděčem a strojem, nemontují se */
  cable_sensor: { location: "field", mount: "none" },
  /* konektor rozhraní k jinému stroji (lis, robot): na rozvaděči / stroji, s kabelem k druhému stroji */
  machine_interface: { location: "field", mount: "field" },
  cable_power: { location: "field", mount: "none" },
  /* stroj: pohony */
  motor: { location: "field", mount: "field" },
  gearmotor: { location: "field", mount: "field" },
  pump: { location: "field", mount: "field" },
  servo_motor: { location: "field", mount: "field" },
  linear_axis: { location: "field", mount: "field" },
  /* stroj: pneumatika a hydraulika */
  valve_solenoid: { location: "field", mount: "field" },
  valve_terminal: { location: "field", mount: "field" },
  cylinder: { location: "field", mount: "field" },
  cylinder_switch: { location: "field", mount: "field" },
  gripper: { location: "field", mount: "field" },
  vacuum_ejector: { location: "field", mount: "field" },
  suction_cup: { location: "field", mount: "field" },
  vacuum_switch: { location: "field", mount: "field" },
  air_prep: { location: "field", mount: "field" },
  hydraulic_valve: { location: "field", mount: "field" },
  hydraulic_unit: { location: "field", mount: "field" },
  process_valve: { location: "field", mount: "field" },
  proportional_valve: { location: "field", mount: "field" },
  safety_valve: { location: "field", mount: "field" },
  /* stroj: snímače */
  sensor_inductive: { location: "field", mount: "field" },
  sensor_optical: { location: "field", mount: "field" },
  sensor_capacitive: { location: "field", mount: "field" },
  limit_switch: { location: "field", mount: "field" },
  pressure_transmitter: { location: "field", mount: "field" },
  temperature_sensor: { location: "field", mount: "field" },
  level_sensor: { location: "field", mount: "field" },
  flow_sensor: { location: "field", mount: "field" },
  load_cell: { location: "field", mount: "field" },
  analog_sensor: { location: "field", mount: "field" },
  fieldbus_io: { location: "field", mount: "field" },
  /* stroj: bezpečnost a ovládání */
  light_curtain: { location: "field", mount: "field" },
  safety_switch: { location: "field", mount: "field" },
  estop_button: { location: "field", mount: "field" },
  two_hand_station: { location: "field", mount: "field" },
  pushbutton: { location: "field", mount: "field" },
  pilot_light: { location: "field", mount: "field" },
  beacon: { location: "field", mount: "field" },
  horn: { location: "field", mount: "field" },
};
/** Kategorie mimo tabulku (vlastní typ firemní knihovny): na stroji, bez montáže — konstruktér rozhodne. */
const CAD_UNKNOWN = { location: "field" as CadLocation, mount: "none" as CadMount };
export const cadPlacement = (cat: string) => CAD_PLACEMENT[cat] || CAD_UNKNOWN;

export interface CadInstance { guid: string | null; station: number; slot: number; }
export interface CadPart {
  id: string; tag: string; category: string; label: string;
  brand: string; type: string; orderCode: string; supplier: string; qty: number;
  location: CadLocation; mount: CadMount;
  device: string | null; station: number | null; slot: number | null;
  sourceUrl: string;
  /* verze 2 */
  /** stabilní identita řádku (odvozená, přežije přejmenování zařízení); null = projekt / zařízení bez GUID */
  guid: string | null;
  /** `Device.guid` zařízení řádku, jinak null */
  deviceGuid: string | null;
  /** bezpečnostní díl (`bomLineIsSafety`) */
  safety: boolean;
  /** fyzické kusy karet / hlav PLC (GUID z `moduleGuids`, stanice, slot); ostatní řádky [] */
  instances: CadInstance[];
}
export interface CadModule { slot: number; partId: string; guid: string | null; kind: string; channels: number; }
export interface CadStation { index: number; guid: string | null; kind: "local" | "remote"; head: string; modules: CadModule[]; }
export type CadRelationKind = "feeds" | "controls" | "actuates" | "senses";
export interface CadRelation { from: string; to: string; kind: CadRelationKind; }
export interface CadRevision {
  id: string; date: string; by: string; hash: string;
  /** povinné položky schvalování platně schválené v okamžiku revize (null = revize bez záznamu) */
  approved: { valid: number; required: number } | null;
  /** obsah projektu při exportu = obsah revize (false = rozpracováno po revizi) */
  current: boolean;
}
/** Zařízení projektu s parametry, které potřebuje konstrukce (zadání pro hrubý 3D koncept). */
export interface CadDevice {
  name: string; guid: string | null; cls: string; desc: string;
  role: string | null; unit: string;
  range: { min: number; max: number } | null;
  limits: { lo: number | null; hi: number | null } | null;
  setpoint: number | null;
  options: string[];
  rampS: number | null; tol: number | null; tolTimeS: number | null;
  selBits: number | null;
  records: Array<{ no: number; name: string; pos: number | null; vel: number | null }>;
  travelS: number | null;
  axis: (Omit<AxisCfg, "limNeg" | "limPos" | "drive"> & { limNeg: number | null; limPos: number | null; drive: string }) | null;
  libType: string | null;
  signals: Array<{ sig: string; dir: string; tag: string }>;
  parts: string[];
}
export interface CadStep {
  no: number; device: string | null; deviceGuid: string | null; act: string; cond: string; timeS: number;
  sp: number | null; rev: boolean | null; rec: number | null; pos: number | null; posRef: string | null;
  vel: number | null; acc: number | null; dec: number | null;
  title: string;
}
export interface CadDevRef { device: string; guid: string | null; }
export interface CadSafetyFunction {
  id: string; ref: string; kind: string; title: string; off: boolean;
  plr: string | null; pl: string | null; category: string | null; stopCategory: number;
  inputs: string[]; actuators: string[]; safeState: string; missing: string[];
}
export interface CadManifest {
  format: string; version: number; generator: string;
  project: { guid: string; name: string; number: string; customer: string; revision: CadRevision | null };
  platform: PlatformKey;
  brief: { desc: string; takt: number | null; startDate: string; modes: boolean; platforms: PlatformKey[]; concept: SolutionConcept | null };
  devices: CadDevice[];
  sequence: CadStep[];
  safety: { estop: CadDevRef | null; interlocks: CadDevRef[]; functions: CadSafetyFunction[] | null };
  parts: CadPart[];
  plc: { stations: CadStation[] };
  terminals: Array<{ strip: string; count: number }>;
  relations: CadRelation[];
}

/**
 * Pracovní kopie projektu pro export: I/O synchronizované se zařízeními (`syncIO` — příklady a starší
 * projekty ukládají `io: []`, bez nich by manifest neměl I/O karty, svorky ani vazby „controls“).
 * Vstupní projekt se NEMĚNÍ (kopie zařízení, I/O, GUID modulů a značky adres; ostatní se jen čte).
 * GUID, které kopie při synchronizaci případně vytvoří, export nepoužije — čte jen GUID vstupu.
 */
export function cadProject(prj: Project): Project {
  const c: Project = {
    ...prj,
    devices: (prj.devices || []).map(d => JSON.parse(JSON.stringify(d))),
    io: (prj.io || []).map(e => ({ ...e })),
    program: prj.program,
    ...(prj.moduleGuids ? { moduleGuids: { ...prj.moduleGuids } } : {}),
    ...(prj.hw ? { hw: { ...prj.hw } } : {}),
  };
  syncIO(c);
  return c;
}

/** Druh modulu podle obsazených směrů kanálů („DI“, „AI+AO“…). */
const modKind = (m: HwModule) => HW_DIRS.filter(d => (m.ch[d] || 0) > 0).join("+") || m.cat.replace(/^plc_/, "").toUpperCase();
const modChannels = (m: HwModule) => HW_DIRS.reduce((s, d) => s + (m.ch[d] || 0), 0);

const numOrNull = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Manifest pro CAD z projektu. `opts.generator` přepíše text generátoru (výchozí „PLCdesk <verze>“).
 * Popisy dílů (`label`) a titulky kroků jsou v aktuálním jazyce (`setLang`), obsah projektu se nepřekládá.
 * Počítá se nad `cadProject(prj)` (synchronizovaná I/O); vstupní projekt se nemění.
 */
export function cadManifest(prj0: Project, opts: { generator?: string } = {}): CadManifest {
  const prj = cadProject(prj0);
  const bom = buildBom(prj);
  const plat = bom.plat;
  const L = hwLayout(prj, plat);
  const lines = bom.lines;
  const byId = new Map(lines.map(l => [l.id, l]));
  const devOf = new Map(prj.devices.map(d => [d.id, d]));

  /* GUID jen ze vstupu (export je nikdy nevytváří): projekt, zařízení, karty a hlavy (`moduleGuids`,
     v kopii případně převedené ze starších klíčů DI1… — hodnoty ale musí pocházet ze vstupu) */
  const prjGuid = isGuid(prj0.guid) ? prj0.guid : null;
  const devGuid = new Map<number, string>();
  for (const d of prj0.devices || []) if (isGuid(d.guid)) devGuid.set(d.id, d.guid);
  const inGuids = new Set(Object.values(prj0.moduleGuids || {}).filter(isGuid).map(g => g.toLowerCase()));
  const modGuid = (m: HwModule): string | null => {
    const g = prj.moduleGuids?.[m.key];
    return isGuid(g) && inGuids.has(g.toLowerCase()) ? g : null;
  };

  /* PLC: řádek kusovníku každého modulu (označení skupiny + kategorie; vestavěné I/O = CPU) */
  const partOfModule = (m: HwModule): string => {
    const id = m.builtin ? "-A1:plc_cpu" : m.bomTag + ":" + m.cat;
    return byId.has(id) ? id : "";
  };
  const firstPos = new Map<string, { station: number; slot: number }>();
  const instancesOf = new Map<string, CadInstance[]>();
  for (const m of L.modules) {
    const id = partOfModule(m);
    if (id && !firstPos.has(id)) firstPos.set(id, { station: m.station, slot: m.slot });
    /* fyzické kusy s vlastní identitou: I/O karty a hlavy vzdálených stanic */
    if (id && ((m.kind === "io" && !m.builtin) || m.kind === "head")) {
      if (!instancesOf.has(id)) instancesOf.set(id, []);
      instancesOf.get(id)!.push({ guid: modGuid(m), station: m.station, slot: m.slot });
    }
  }
  /* BaseUnit / BusAdapter nesou jen stanici (řádek s označením hlavy) */
  const stationOfTag = new Map<string, number>(L.stations.filter(s => s.remote).map(s => [s.head.dt, s.no]));

  /* GUID řádku (deterministicky, bez nového stavu v projektu): řádek zařízení z `Device.guid` a kategorie
     (+ pořadí, má-li zařízení víc řádků téže kategorie), karty PLC z GUID projektu, kategorie a stanice,
     ostatní (CPU, skříň, zdroj, svorky…) z GUID projektu a id řádku */
  const catSeen = new Map<string, number>();
  const lineGuid = (l: BomLine, station: number | null): string | null => {
    if (l.devId !== undefined) {
      const dg = devGuid.get(l.devId);
      if (!dg) return null;
      const k = l.devId + ":" + l.cat, n = (catSeen.get(k) || 0) + 1;
      catSeen.set(k, n);
      return derivedGuid(dg, "bom:" + l.cat + (n > 1 ? ":" + n : ""));
    }
    if (!prjGuid) return null;
    if (/^plc_(di|do|ai|ao)$/.test(l.cat) && station !== null) return derivedGuid(prjGuid, "bom:" + l.cat + ":" + station);
    return derivedGuid(prjGuid, "bom:" + l.id);
  };

  const parts: CadPart[] = lines.map(l => {
    const pl = cadPlacement(l.cat);
    const pos = firstPos.get(l.id);
    const st = pos ? pos.station : /^plc_(baseunit|busadapter|server)/.test(l.cat) ? stationOfTag.get(l.tag) ?? null : null;
    const dev = l.devId !== undefined ? devOf.get(l.devId) : undefined;
    return {
      id: l.id, tag: l.tag, category: l.cat, label: l.item,
      brand: l.brand || "", type: l.type || "", orderCode: l.orderCode || "", supplier: l.supplier || "",
      qty: l.qty,
      location: pl.location, mount: pl.mount,
      device: dev ? dev.name : null,
      station: st, slot: pos ? pos.slot : null,
      sourceUrl: l.src || "",
      guid: lineGuid(l, st),
      deviceGuid: l.devId !== undefined ? devGuid.get(l.devId) ?? null : null,
      safety: bomLineIsSafety(prj, l),
      instances: instancesOf.get(l.id) || [],
    };
  });

  /* sestava PLC: hlava (CPU / hlava vzdálené stanice) a I/O moduly v pořadí slotů; vestavěné I/O jsou
     součástí CPU, příslušenství (BusAdapter, server modul, BaseUnit) nese jen řádek kusovníku se stanicí */
  const stations: CadStation[] = L.stations.map(s => ({
    index: s.no,
    guid: prjGuid ? derivedGuid(prjGuid, "cad:station:" + s.no) : null,
    kind: s.remote ? "remote" : "local",
    head: partOfModule(s.head),
    modules: s.modules.filter(m => m.kind === "io" && !m.builtin).slice().sort((a, b) => a.slot - b.slot)
      .map(m => ({ slot: m.slot, partId: partOfModule(m), guid: modGuid(m), kind: modKind(m), channels: modChannels(m) })),
  }));

  /* svorkovnice = kanálové skupiny výkresů (X1, X2 … jako svorkyCSV / listy zapojení) */
  const terminals = modules(prj).map((m, i) => ({ strip: "X" + (i + 1), count: m.ch.length }));

  /* vazby z modelu projektu (pořadí zařízení) */
  const relations: CadRelation[] = [];
  const seen = new Set<string>();
  const rel = (from: string | undefined, to: string | undefined, kind: CadRelationKind) => {
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) return;
    const k = from + ">" + to + ">" + kind;
    if (!seen.has(k)) { seen.add(k); relations.push({ from, to, kind }); }
  };
  const linesOf = (d: Device) => lines.filter(l => l.devId === d.id);
  const pick = (ls: BomLine[], ...cats: string[]) => ls.find(l => cats.includes(l.cat))?.id;
  /** díl zařízení, který ovládá výstup PLC */
  const driven = new Map<number, string | undefined>();
  for (const d of prj.devices) {
    const ls = linesOf(d);
    const main = ls.find(l => l.tag === "-" + d.name)?.id;
    if (d.cls === "Motor") {
      const q = pick(ls, "motor_protection"), k = pick(ls, "contactor"), m = pick(ls, "motor", "gearmotor", "pump");
      rel(q, k, "feeds"); rel(k, m, "feeds");
      driven.set(d.id, k);
    } else if (d.cls === "Vfd") {
      const q = pick(ls, "mcb"), ta = pick(ls, "vfd"), m = pick(ls, "motor", "gearmotor", "pump");
      rel(q, ta, "feeds"); rel(ta, m, "feeds");
      driven.set(d.id, ta);
    } else if (d.cls === "PosDrive") {
      const ta = pick(ls, "positioning_drive"), ax = pick(ls, "linear_axis");
      rel(ta, ax, "feeds");
      driven.set(d.id, ta);
    } else if (d.cls === "Axis") {
      rel(pick(ls, "servo_drive"), pick(ls, "servo_motor"), "feeds");
    } else if (d.cls === "Ventil") {
      const v = pick(ls, "valve_solenoid", "hydraulic_valve", "process_valve"), cyl = pick(ls, "cylinder", "gripper");
      rel(v, cyl, "actuates");
      const sw = pick(ls, "cylinder_switch");
      if (sw) rel(sw, cyl, "senses");
      /* vakuový úchop: rozváděč → ejektor → přísavky, spínač podtlaku hlídá ejektor */
      const ej = pick(ls, "vacuum_ejector");
      rel(v, ej, "actuates"); rel(ej, pick(ls, "suction_cup"), "actuates");
      const vs = pick(ls, "vacuum_switch");
      if (vs) rel(vs, ej, "senses");
      const ls2 = pick(ls, "limit_switch");
      if (ls2) rel(ls2, pick(ls, "process_valve", "hydraulic_valve", "valve_solenoid"), "senses");
      driven.set(d.id, v || pick(ls, "interface_relay"));
    } else if (d.cls === "PropValve" || d.cls === "AnalogOut" || d.cls === "DO") {
      driven.set(d.id, main);
    }
  }
  /* výstupní moduly PLC → akční člen (DO / AO kanál signálu zařízení) */
  for (const e of prj.io) {
    if (e.dir !== "DO" && e.dir !== "AO") continue;
    const ch = L.ch.get(e);
    if (!ch) continue;
    rel(partOfModule(ch.mod), driven.get(e.devId), "controls");
  }

  /* ---- zadání pro hrubý 3D koncept: jen to, co projekt nese (nic se nedopočítává ani nevymýšlí) */
  const devices: CadDevice[] = prj.devices.map(d => {
    const ax = d.cls === "Axis" ? axisCfgOf(d) : null;
    return {
      name: d.name, guid: devGuid.get(d.id) ?? null, cls: d.cls, desc: d.desc || "",
      role: d.cls === "DO" && d.role ? d.role : null, unit: d.unit || "",
      range: hasRange(d.cls) ? { min: d.rmin, max: d.rmax } : null,
      limits: d.cls === "AnalogIn" ? { lo: numOrNull(d.limLo), hi: numOrNull(d.limHi) } : null,
      setpoint: numOrNull(d.setpoint),
      options: Object.keys(d.opt || {}).filter(k => d.opt[k] === true).sort(),
      rampS: numOrNull(d.rampS), tol: numOrNull(d.tol), tolTimeS: numOrNull(d.tolTimeS),
      selBits: d.cls === "PosDrive" ? numOrNull(d.selBits) : null,
      records: (Array.isArray(d.records) ? d.records : []).map(r => ({ no: r.no, name: r.name || "", pos: numOrNull(r.pos), vel: numOrNull(r.vel) })),
      travelS: numOrNull(d.travelS),
      axis: ax ? {
        vMax: ax.vMax, aMax: ax.aMax, dMax: ax.dMax, jerk: ax.jerk, vDef: ax.vDef,
        limNeg: numOrNull(ax.limNeg), limPos: numOrNull(ax.limPos), homePos: ax.homePos,
        posTol: ax.posTol, followMax: ax.followMax, jogVel: ax.jogVel, startPos: ax.startPos,
        drive: ax.drive || "", positions: ax.positions.map(p => ({ name: p.name, pos: p.pos })),
      } : null,
      libType: d.libType || null,
      signals: prj.io.filter(e => e.devId === d.id).map(e => ({ sig: e.sig, dir: e.dir, tag: e.tag })),
      parts: lines.filter(l => l.devId === d.id).map(l => l.id),
    };
  });
  const sequence: CadStep[] = (prj.program?.seq || []).map((s, i) => {
    const d = s.act === "wait" ? undefined : devOf.get(s.dev);
    return {
      no: i + 1, device: d ? d.name : null, deviceGuid: d ? devGuid.get(d.id) ?? null : null,
      act: s.act, cond: s.cond, timeS: s.timeS,
      sp: numOrNull(s.sp), rev: typeof s.rev === "boolean" ? s.rev : null, rec: numOrNull(s.rec),
      pos: numOrNull(s.pos), posRef: s.posRef || null, vel: numOrNull(s.vel), acc: numOrNull(s.acc), dec: numOrNull(s.dec),
      title: stepTitle(prj, s),
    };
  });
  const devRef = (d: Device): CadDevRef => ({ device: d.name, guid: devGuid.get(d.id) ?? null });
  const esId = prj.program?.estop;
  const es = typeof esId === "number" ? devOf.get(esId) : undefined;
  let functions: CadSafetyFunction[] | null = null;
  if (safetyModuleRegistered()) {
    functions = proposeSafety(prj).fns.map(f => ({
      id: f.id, ref: f.ref, kind: f.kind, title: f.title, off: !!f.off,
      plr: f.risk?.plr ?? null, pl: f.design?.pl ?? null, category: f.design?.cat != null ? String(f.design.cat) : null,
      stopCategory: f.stopCat, inputs: [...f.inputs], actuators: [...f.acts], safeState: f.safeState || "", missing: [...f.missing],
    }));
  }

  /* revize PLCdesk (poslední) se stavem schválení — PLM podle ní hlídá vydání (MANIFEST_SCHEMA v2) */
  const rev = latestRevision(prj0);
  const revision: CadRevision | null = rev ? {
    id: rev.id, date: rev.date, by: rev.by, hash: rev.hash,
    approved: rev.approved ? { valid: rev.approved.valid, required: rev.approved.required } : null,
    current: fnv1a64(canonicalJson(revisionContent(prj0))) === rev.hash,
  } : null;

  const meta = prj0.meta || ({} as Project["meta"]);
  return {
    format: CAD_FORMAT,
    version: CAD_VERSION,
    generator: opts.generator ?? "PLCdesk " + PLCDESK_VERSION,
    project: { guid: prj0.guid || "", name: meta.name || "", number: meta.number || "", customer: meta.customer || "", revision },
    platform: plat,
    brief: {
      desc: meta.desc || "", takt: numOrNull(meta.takt), startDate: meta.startDate || "",
      modes: !!prj.program?.modes, platforms: [...(prj.platforms || [])],
      concept: prj0.concept ? JSON.parse(JSON.stringify(prj0.concept)) : null,
    },
    devices,
    sequence,
    safety: { estop: es ? devRef(es) : null, interlocks: interlockDevs(prj).map(devRef), functions },
    parts,
    plc: { stations },
    terminals,
    relations,
  };
}

/** Manifest jako text JSON (odsazení 2 mezery, konec řádku na konci). */
export function cadManifestJson(prj: Project, opts: { generator?: string } = {}): string {
  return JSON.stringify(cadManifest(prj, opts), null, 2) + "\n";
}
