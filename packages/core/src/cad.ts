/**
 * PLCdesk — export pro CAD (`PLCdesk_CAD.json`, formát „plcdesk-cad“ verze 1).
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
import { modules } from "./model.js";
import { buildBom, type BomLine } from "./bom.js";
import { hwLayout, HW_DIRS, type HwModule } from "./hardware.js";
import { PLCDESK_VERSION } from "./verify_pack.js";

export const CAD_FORMAT = "plcdesk-cad";
export const CAD_VERSION = 1;
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

export interface CadPart {
  id: string; tag: string; category: string; label: string;
  brand: string; type: string; orderCode: string; supplier: string; qty: number;
  location: CadLocation; mount: CadMount;
  device: string | null; station: number | null; slot: number | null;
  sourceUrl: string;
}
export interface CadModule { slot: number; partId: string; kind: string; channels: number; }
export interface CadStation { index: number; kind: "local" | "remote"; head: string; modules: CadModule[]; }
export type CadRelationKind = "feeds" | "controls" | "actuates" | "senses";
export interface CadRelation { from: string; to: string; kind: CadRelationKind; }
export interface CadManifest {
  format: string; version: number; generator: string;
  project: { guid: string; name: string; number: string; customer: string };
  platform: PlatformKey;
  parts: CadPart[];
  plc: { stations: CadStation[] };
  terminals: Array<{ strip: string; count: number }>;
  relations: CadRelation[];
}

/** Druh modulu podle obsazených směrů kanálů („DI“, „AI+AO“…). */
const modKind = (m: HwModule) => HW_DIRS.filter(d => (m.ch[d] || 0) > 0).join("+") || m.cat.replace(/^plc_/, "").toUpperCase();
const modChannels = (m: HwModule) => HW_DIRS.reduce((s, d) => s + (m.ch[d] || 0), 0);

/**
 * Manifest pro CAD z projektu. `opts.generator` přepíše text generátoru (výchozí „PLCdesk <verze>“).
 * Popisy dílů (`label`) jsou v aktuálním jazyce (`setLang`), obsah projektu se nepřekládá.
 */
export function cadManifest(prj: Project, opts: { generator?: string } = {}): CadManifest {
  const bom = buildBom(prj);
  const plat = bom.plat;
  const L = hwLayout(prj, plat);
  const lines = bom.lines;
  const byId = new Map(lines.map(l => [l.id, l]));
  const devOf = new Map(prj.devices.map(d => [d.id, d]));

  /* PLC: řádek kusovníku každého modulu (označení skupiny + kategorie; vestavěné I/O = CPU) */
  const partOfModule = (m: HwModule): string => {
    const id = m.builtin ? "-A1:plc_cpu" : m.bomTag + ":" + m.cat;
    return byId.has(id) ? id : "";
  };
  const firstPos = new Map<string, { station: number; slot: number }>();
  for (const m of L.modules) {
    const id = partOfModule(m);
    if (id && !firstPos.has(id)) firstPos.set(id, { station: m.station, slot: m.slot });
  }
  /* BaseUnit / BusAdapter nesou jen stanici (řádek s označením hlavy) */
  const stationOfTag = new Map<string, number>(L.stations.filter(s => s.remote).map(s => [s.head.dt, s.no]));

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
    };
  });

  /* sestava PLC: hlava (CPU / hlava vzdálené stanice) a I/O moduly v pořadí slotů; vestavěné I/O jsou
     součástí CPU, příslušenství (BusAdapter, server modul, BaseUnit) nese jen řádek kusovníku se stanicí */
  const stations: CadStation[] = L.stations.map(s => ({
    index: s.no,
    kind: s.remote ? "remote" : "local",
    head: partOfModule(s.head),
    modules: s.modules.filter(m => m.kind === "io" && !m.builtin).slice().sort((a, b) => a.slot - b.slot)
      .map(m => ({ slot: m.slot, partId: partOfModule(m), kind: modKind(m), channels: modChannels(m) })),
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
      const v = pick(ls, "valve_solenoid", "hydraulic_valve", "process_valve"), cyl = pick(ls, "cylinder");
      rel(v, cyl, "actuates");
      const sw = pick(ls, "cylinder_switch");
      if (sw) rel(sw, cyl, "senses");
      const ls2 = pick(ls, "limit_switch");
      if (ls2) rel(ls2, pick(ls, "process_valve", "hydraulic_valve", "valve_solenoid"), "senses");
      driven.set(d.id, v);
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

  const meta = prj.meta || ({} as Project["meta"]);
  return {
    format: CAD_FORMAT,
    version: CAD_VERSION,
    generator: opts.generator ?? "PLCdesk " + PLCDESK_VERSION,
    project: { guid: prj.guid || "", name: meta.name || "", number: meta.number || "", customer: meta.customer || "" },
    platform: plat,
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
