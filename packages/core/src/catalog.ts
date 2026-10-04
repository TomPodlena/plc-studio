/**
 * Katalog komponent pro kusovník: kategorie, typické značky a řady, dodavatelé.
 *
 * Statická data z rešerše (zdroje v `src`, ověřeno k datu `CATALOG_DATE`) — aplikace za běhu
 * nic nestahuje. Objednací kód je jen tam, kde ho rešerše viděla u výrobce / distributora;
 * jinak je položka na úrovni řady. Ceny se neuvádějí (jen hrubá úroveň).
 */
import { N_ } from "./i18n.js";
import type { PlatformKey } from "./model.js";
import { CATALOG_DATA, SUPPLIERS_DATA } from "./catalog_data.js";

export const CATALOG_DATE = "2026-10-02";

/**
 * Hardwarová data položky PLC (sestava hardware.ts) — z rešerše se zdrojem (`src` položky, `hwSrc`).
 *   I/O modul:  ch (kanály podle směru), bus (rack / sběrnice, do které se zasouvá), pts (body FX5), sig
 *   CPU:        builtin (vestavěné I/O), builtinSig, slots (sběrnice → max. modulů v lokálním racku),
 *               maxPts (FX5: body I/O celkem), remote (sběrnice vzdálených stanic), family (AML)
 *   hlava:      head (sběrnice modulů stanice), slots, net (síť ke CPU), family, acc (příslušenství stanice)
 */
export interface CatalogHw {
  ch?: Partial<Record<"DI" | "DO" | "AI" | "AO", number>>;
  bus?: string;
  /** modul zabírá místo i v dalším limitu racku (FX5: inteligentní modul i mezi 12 moduly vpravo; Delta: analog i mezi 32) */
  also?: string;
  pts?: number;
  sig?: Partial<Record<"DI" | "DO" | "AI" | "AO", string>>;
  builtin?: Partial<Record<"DI" | "DO" | "AI" | "AO", number>>;
  builtinSig?: Partial<Record<"DI" | "DO" | "AI" | "AO", string>>;
  slots?: Record<string, number>;
  maxPts?: number;
  remote?: string;
  head?: string;
  net?: string;
  family?: string;
  acc?: string[];
  /** CPU se volí jen výslovně v kusovníku (automatický výběr ho přeskočí) */
  auto?: boolean;
  /** URL zdroje hardwarových údajů (manuál výrobce), pokud je jiný než `src` */
  hwSrc?: string;
}

export interface CatalogBrand {
  brand: string;
  series: string[];
  /** typický konkrétní typ pro malý stroj */
  typical?: string;
  orderCode?: string;
  /** URL, kde byl typ / kód ověřen */
  src?: string;
  priceLevel?: "nízká" | "střední" | "vysoká";
  suppliers: string[];
  note?: string;
  /** hardwarová data pro sestavu (moduly, CPU, hlavy vzdálených I/O) */
  hw?: CatalogHw;
}

/** Identifikace volby z katalogu (značka + kód / řada) — hodnota v `prj.bom.brand` / `lines[].brand`. */
export function brandOptId(b: CatalogBrand): string {
  const what = b.orderCode || (b.series || [])[0] || "";
  return what ? b.brand + " · " + what : b.brand;
}

export interface CatalogCategory {
  /** český klíč překladu */
  label: string;
  unit: string;
  brands: CatalogBrand[];
}

export interface Supplier {
  name: string;
  url?: string;
  country?: string;
  kind?: string;
  cats: string[];
  note?: string;
}

/** Kategorie kusovníku (pořadí = pořadí skupin v kusovníku). PLC moduly mají klíč `<kat>@<platforma>`. */
export const CAT_LABEL: Record<string, string> = {
  plc_cpu: N_("Řídicí systém PLC (CPU)"),
  plc_coupler: N_("Hlava vzdálených I/O"),
  plc_busadapter: N_("Sběrnicový adaptér (BusAdapter)"),
  plc_server: N_("Server modul (zakončení stanice)"),
  plc_baseunit_first: N_("BaseUnit světlá (otevírá potenciálovou skupinu)"),
  plc_baseunit: N_("BaseUnit tmavá"),
  plc_di: N_("Modul digitálních vstupů"),
  plc_do: N_("Modul digitálních výstupů"),
  plc_ai: N_("Modul analogových vstupů"),
  plc_ao: N_("Modul analogových výstupů"),
  plc_hmi: N_("Operátorský panel HMI"),
  motor: N_("Elektromotor"),
  gearmotor: N_("Převodový motor"),
  pump: N_("Čerpadlo s motorem"),
  motor_protection: N_("Motorový spouštěč / jistič motoru"),
  contactor: N_("Stykač"),
  motor_starter: N_("Kompaktní spouštěč"),
  aux_contact: N_("Pomocný kontakt"),
  vfd: N_("Frekvenční měnič"),
  positioning_drive: N_("Polohovací pohon (řadič se záznamy)"),
  linear_axis: N_("Elektrická lineární osa / aktuátor"),
  servo_drive: N_("Servoměnič"),
  servo_motor: N_("Servomotor"),
  valve_solenoid: N_("Pneumatický rozváděč"),
  valve_terminal: N_("Ventilový terminál"),
  cylinder: N_("Pneumatický válec"),
  cylinder_switch: N_("Snímač polohy válce"),
  air_prep: N_("Úprava vzduchu"),
  hydraulic_valve: N_("Hydraulický rozváděč"),
  hydraulic_unit: N_("Hydraulický agregát"),
  process_valve: N_("Procesní ventil s pohonem"),
  proportional_valve: N_("Proporcionální ventil"),
  sensor_inductive: N_("Indukční snímač"),
  sensor_optical: N_("Optický snímač"),
  sensor_capacitive: N_("Kapacitní snímač"),
  limit_switch: N_("Polohový spínač"),
  light_curtain: N_("Bezpečnostní světelná závora"),
  safety_switch: N_("Bezpečnostní spínač krytu"),
  estop_button: N_("Tlačítko nouzového zastavení"),
  safety_relay: N_("Bezpečnostní relé"),
  pressure_transmitter: N_("Snímač tlaku"),
  temperature_sensor: N_("Snímač teploty"),
  level_sensor: N_("Snímač hladiny"),
  flow_sensor: N_("Průtokoměr"),
  load_cell: N_("Siloměr / tenzometr"),
  analog_sensor: N_("Analogový snímač"),
  beacon: N_("Signální maják"),
  horn: N_("Houkačka"),
  pushbutton: N_("Ovládací tlačítko"),
  pilot_light: N_("Signálka"),
  interface_relay: N_("Vazební relé"),
  power_supply_24v: N_("Zdroj 24 V DC"),
  main_switch: N_("Hlavní vypínač"),
  mcb: N_("Jistič"),
  terminal_block: N_("Řadové svorky"),
  cabinet: N_("Skříň rozvaděče"),
  cable_sensor: N_("Kabel s konektorem M12"),
  cable_power: N_("Silový kabel"),
  fieldbus_io: N_("Decentrální I/O IP67 / IO-Link"),
};

/** Značky po kategoriích — z rešerše `data/catalog/*.json` (`scripts/build_catalog.py`), viz `CATALOG_DATE`. */
export const CATALOG: Record<string, CatalogBrand[]> = CATALOG_DATA;

export const SUPPLIERS: Supplier[] = SUPPLIERS_DATA;

/** Kategorie modulu PLC pro platformu (`plc_di@siemens`), jinak obecná kategorie. */
export function catKey(cat: string, plat?: PlatformKey): string {
  return plat && cat.startsWith("plc_") && CATALOG[cat + "@" + plat] ? cat + "@" + plat : cat;
}

export function brandsFor(cat: string, plat?: PlatformKey): CatalogBrand[] {
  return CATALOG[catKey(cat, plat)] || CATALOG[cat] || [];
}

export function suppliersFor(cat: string): Supplier[] {
  const base = cat.split("@")[0];
  return SUPPLIERS.filter(s => s.cats.includes(cat) || s.cats.includes(base));
}
