/**
 * Kusovník komponent (BOM) z návrhu stroje.
 *
 * Z každého zařízení vznikne jedna nebo více položek (motor → motor + motorový spouštěč
 * + stykač, válec → rozváděč + válec + snímače polohy, …), k tomu PLC a I/O moduly zvolené
 * platformy a rozvaděč. Kategorie se určí z třídy zařízení, voleb, jednotky a popisu;
 * značku, typ a dodavatele nabídne katalog (`catalog.ts`), uživatel je může u kategorie
 * i u řádku změnit (`prj.bom`). Označení dle IEC 81346 (-M1, -Q1, -K1, -A1, …).
 *
 * Kusovník je podklad k poptávce, ne projekt elektro: dimenzování (výkony, průřezy,
 * jištění) a volba bezpečnostních prvků podle posouzení rizik zůstávají na projektantovi.
 * Pozn. pro verzi PRO: řádky nesou stabilní `id` (označení + kategorie), na které naváže
 * stavba zařízení v CADu.
 */
import { tr, N_ } from "./i18n.js";
import {
  BomCfg, Device, PlatformKey, Project, PLAT, interlockDevs, devRef, maxRecord, ioOf, modules, type Dir,
} from "./model.js";
import { CAT_LABEL, CatalogBrand, brandsFor, catKey, suppliersFor, brandOptId, SUPPLIERS } from "./catalog.js";
import { hwLayout, hwPlatform, HW_DIRS, type HwModule } from "./hardware.js";
import { axisCfgOf, axisObjName } from "./axis.js";
import { axisDialect, AXIS_NET } from "./axis_gen.js";

export { brandOptId };

export interface BomLine {
  /** stabilní klíč řádku: označení + kategorie (pro volby uživatele a pro CAD v PRO) */
  id: string;
  pos: number;
  /** označení dle IEC 81346, např. -M1, -Q1, -A1 */
  tag: string;
  cat: string;
  qty: number;
  unit: string;
  /** co položka je (přeložený název kategorie) */
  item: string;
  /** k čemu slouží (popis zařízení) */
  desc: string;
  devId?: number;
  brand: string;
  type: string;
  orderCode: string;
  supplier: string;
  note: string;
  /** položka podle posouzení rizik — jen HW, zapojení a volba k revizi */
  safety?: boolean;
  /** vybraná volba katalogu (`brandOptId`), prázdné = vlastní / bez katalogu */
  optId: string;
  /** URL, kde byl typ ověřen */
  src: string;
  /** uživatel nastavil množství 0 — řádek zůstává v přehledu, do CSV / dokumentu nejde */
  excluded?: boolean;
}

/** Kategorie kusovníku, které jsou bezpečnostními prvky samy o sobě (bez ohledu na zařízení). */
export const BOM_SAFETY_CATS: ReadonlySet<string> = new Set(["safety_relay", "safety_controller", "contactor_mirror",
  "safety_valve", "two_hand_station", "light_curtain", "safety_switch", "guard_lock", "guard_lock_contact", "estop_button"]);

/**
 * Je řádek kusovníku bezpečnostní díl? Řádek podle posouzení rizik (`BomLine.safety`), bezpečnostní kategorie
 * (`BOM_SAFETY_CATS`) nebo díl zařízení E-stopu / blokování programu. Sdílí export pro CAD (`parts[].safety`)
 * a klasifikace změn revize (změna takového řádku = bezpečnostní změna).
 */
export function bomLineIsSafety(prj: Project, l: Pick<BomLine, "safety" | "cat" | "devId">): boolean {
  if (l.safety || BOM_SAFETY_CATS.has(l.cat)) return true;
  if (l.devId === undefined) return false;
  return l.devId === prj.program?.estop || interlockDevs(prj).some(d => d.id === l.devId);
}

export interface Bom {
  plat: PlatformKey;
  lines: BomLine[];
}

const has = (s: string, re: RegExp) => re.test(s.toLowerCase());

/** Kategorie snímače analogové veličiny podle jednotky a popisu. */
function analogCat(d: Device): string {
  const u = (d.unit || "").toLowerCase(), t = d.desc || "";
  if (has(t, /hladin|level|füllstand|nivel/)) return "level_sensor";
  if (has(t, /průtok|flow|durchfluss|caudal/) || /\/h$|\/min$|l\/s/.test(u)) return "flow_sensor";
  if (/^(bar|mbar|kpa|pa|mpa|psi)$/.test(u) || has(t, /tlak|vakuum|podtlak|pressure|druck|presi/)) return "pressure_transmitter";
  if (/°c|^k$|°f/.test(u) || has(t, /teplot|temperat/)) return "temperature_sensor";
  if (/^(kn|n|kg|t)$/.test(u) || has(t, /síl|váh|zatížen|force|load|kraft|gewicht/)) return "load_cell";
  return "analog_sensor";
}

function diCat(prj: Project, d: Device, locks: Set<number>): string {
  const t = d.desc || "";
  if (prj.program.estop === d.id) return "estop_button";
  if (locks.has(d.id)) return has(t, /závor|mříž|curtain|lichtgitter|barrera|clona/) ? "light_curtain" : "safety_switch";
  if (has(t, SELECTOR_RE)) return "selector_switch";
  if (has(t, /tlačítk|start|kvit|button|taster|pulsador/)) return "pushbutton";
  if (bomIsInterface(d)) return "";   // kontakt druhého stroje: jen pin konektoru rozhraní (řádek machine_interface)
  if (has(t, /hladin|kapacit|level|capacit/)) return "sensor_capacitive";
  if (has(t, /optick|reflex|závor|fotobu|optical|light|licht|óptic/)) return "sensor_optical";
  if (has(t, /koncák|koncov|limit|endschalter|final de carrera/)) return "limit_switch";
  return "sensor_inductive";
}

/** Volič / přepínač (režim AUTO / RUČNĚ, seřizování…) — vlastní kategorie, ne tlačítko (pult: drážka proti pootočení). */
const SELECTOR_RE = /volič|přepínač|přepína|selector|wahlschalter|schlüsselschalter|conmutador/;

/* ---- signální věž (maják): jedna věž s patry, patro na každý DO ----
   Dřív dostal každý DO majáku vlastní celou věž (vzor 03: -H1 a -H2 = 2 × Werma 64924005). Věž je ve skutečnosti
   jedna se světelnými patry → řádek věže `-PF<n>:beacon` (IEC 81346-2 třída P = zobrazení informace; označení
   nezávisí na jménech zařízení, takže id řádku i GUID pro CAD přežijí přejmenování / smazání kteréhokoli DO)
   + patro `-<DO>:beacon_light` na každý výstup (devId → vazba `controls` z výstupního modulu jde na patro).
   Víc věží jen když to popis zařízení výslovně říká („věž A“, „tower B“, „Turm 2“…). */
export type BeaconColor = "red" | "yellow" | "blue" | "green" | "white";
/** Pořadí pater shora podle IEC 60204-1 čl. 10.3.2 (sekundárně IDEC LD6A; skill modul-majak `data/veze.json`). */
export const BEACON_ORDER: BeaconColor[] = ["red", "yellow", "blue", "green", "white"];
const BEACON_COLOR_TEXT: Record<BeaconColor, string> = {
  red: N_("červená"), yellow: N_("žlutá"), blue: N_("modrá"), green: N_("zelená"), white: N_("bílá"),
};
/** Barva z popisu zařízení (obsah projektu cs / en / de / es — nikdy z přeloženého UI). */
const BEACON_COLOR_RE: Array<[BeaconColor, RegExp]> = [
  ["red", /červen|\bred\b|\brot\b|\brojo|\broja\b/],
  ["yellow", /žlut|oranž|jantar|yellow|amber|orange|gelb|amarillo|ámbar/],
  ["blue", /modr|\bblue\b|\bblau|\bazul/],
  ["green", /zelen|green|grün|gruen|\bverde\b/],
  ["white", /bíl|white|weiß|weiss|\bblanc/],
];
/**
 * Barva podle role DO, když ji popis neříká — výchozí PLCdesk (rozhodnutí uživatele 2026-11-03; shodně s
 * `pro3d_lib/data/veze.json` `role_DO_na_barvu`): fault / run podle významu barev, ready / stopped / lock / auto
 * (`def` = výchozí volba, poznámka to říká) bílá / žlutá / modrá / bílá.
 */
const BEACON_ROLE_COLOR: Record<string, { c: BeaconColor; def: boolean }> = {
  fault: { c: "red", def: false }, run: { c: "green", def: false },
  ready: { c: "white", def: true }, stopped: { c: "yellow", def: true }, lock: { c: "blue", def: true }, auto: { c: "white", def: true },
};
/** Barvy hotové věže z katalogu (Werma 64924005, PATLITE LR6-…-RYG, Eaton SL7 RYG, Auer CT5 RAG). */
const BEACON_STOCK: ReadonlySet<BeaconColor> = new Set(["red", "yellow", "green"]);
const TOWER_RE = /(?:věž|věže|věži|tower|turm|säule|torre)\s+([a-z0-9])\b/;

/** `roleDefault` = barva z role podle výchozí volby PLCdesk (ne z popisu ani z významu barvy). */
export interface BeaconTier { dev: Device; color: BeaconColor | null; roleDefault: boolean; }
export interface BeaconTower { tag: string; tiers: BeaconTier[]; stock: boolean; }

/**
 * Signální věže projektu: DO s kategorií `beacon` seskupené do věží (jedna, pokud popisy nejmenují víc věží),
 * patra seřazená shora (R / Y / B / G / W, neurčená barva dole). `stock` = patra se vejdou do hotové věže
 * červená / žlutá / zelená z katalogu (barvy určené, různé, nejvýš 3). Sdílí kusovník i export pro CAD.
 */
export function bomBeaconTowers(prj: Project): BeaconTower[] {
  const groups = new Map<string, Device[]>();
  for (const d of prj.devices) if (d.cls === "DO" && doCat(d) === "beacon") {
    const k = (TOWER_RE.exec((d.desc || "").toLowerCase())?.[1] || "");
    groups.set(k, [...(groups.get(k) || []), d]);
  }
  return [...groups.values()].map((devs, i) => {
    const tiers = devs.map(dev => {
      const t = (dev.desc || "").toLowerCase();
      const byDesc = BEACON_COLOR_RE.find(([, re]) => re.test(t))?.[0];
      const byRole = !byDesc && dev.role ? BEACON_ROLE_COLOR[dev.role] : undefined;
      return { dev, color: byDesc || byRole?.c || null, roleDefault: !byDesc && !!byRole?.def };
    });
    const rank = (c: BeaconColor | null) => c ? BEACON_ORDER.indexOf(c) : BEACON_ORDER.length;
    tiers.sort((a, b) => rank(a.color) - rank(b.color));   // stabilní: stejná barva v pořadí zařízení
    const cs = tiers.map(x => x.color);
    const stock = tiers.length <= 3 && cs.every(c => c && BEACON_STOCK.has(c)) && new Set(cs).size === cs.length;
    return { tag: "-PF" + (i + 1), tiers, stock };
  });
}

/* ---- zámek ochranného krytu (jištění, EN ISO 14119) ----
   DO s rolí `lock` nebo s popisem zámku = cívka blokovacího zařízení se zámkem → kategorie `guard_lock` (dřív obyčejný
   bezpečnostní spínač bez jištění; nález modulu O3 PLCdesk PRO 2026-11-04). Kontakty „zavřeno a zamčeno“ jsou součástí
   přístroje: blokovací DI, jehož popis říká „zamčeno“ / locked / verriegelt, se spáruje se zámkem (v pořadí projektu)
   a místo samostatného spínače dostane řádek `guard_lock_contact` (kontakt zámku, bez objednání — jako patro věže;
   označení vstupu zůstává v kusovníku kvůli SISTEMA / výkresům). Klíčová slova jen z obsahu projektu (cs / en / de / es). */
const LOCK_DO_RE = /zámek|zámk|lock|zuhalt|bloqueo/;
const LOCKED_DI_RE = /zamčen|zamknut|uzamčen|locked|verriegelt|zugehalten|bloquead/;
const isLockDo = (d: Device) => d.cls === "DO" && (d.role === "lock" || has(d.desc || "", LOCK_DO_RE));
/** Dvojice zámek (DO) → blokovací vstup „zavřeno a zamčeno“ (DI) téhož přístroje; nespárovaný zámek = bez vstupu. */
function guardLockPairs(prj: Project, locks: Set<number>): Map<number, Device | null> {
  const lockDos = prj.devices.filter(isLockDo);
  const lockedDis = prj.devices.filter(d => locks.has(d.id) && d.cls === "DI" && has(d.desc || "", LOCKED_DI_RE)
    && !has(d.desc || "", /závor|mříž|curtain|lichtgitter|barrera|clona/));
  return new Map(lockDos.map((d, i) => [d.id, lockedDis[i] || null]));
}

function doCat(d: Device): string {
  const t = d.desc || "";
  if (isLockDo(d)) return "guard_lock";
  if (bomIsInterface(d)) return "interface_relay";
  if (has(t, /houkačk|siréna|horn|hupe|bocina|sirene/)) return "horn";
  if (has(t, /maják|věž|beacon|signalsäule|baliza|signálka.*(zelen|červen|žlut)/)) return "beacon";
  if (has(t, /signálk|kontrolk|pilot|leuchtmelder|piloto|indikac/)) return "pilot_light";
  return "interface_relay";
}

/**
 * Signálová výměna s jiným strojem (lis, robot, nadřazená linka) — zařízení projektu je kontakt rozhraní,
 * ne fyzický snímač ani akční člen. Pozná se JEN z obsahu projektu (popis zařízení je v jazyce, ve kterém
 * projekt vznikl), nikdy z přeloženého textu UI. Klíčová slova (malými písmeny):
 *   cs: „euromap“, „rozhraní“, „signál z / ze / do / od / pro / k …“, popis začíná „Robot“, „z / od / do robota“;
 *   en: „euromap“, „interface“, „handshake“, „signal from / to …“, „from / to (the) robot“;
 *   de: „euromap“, „Schnittstelle“, „Handshake“, „Signal von / vom / an / zum / zur …“, „vom / zum Roboter“, začíná „Roboter“.
 * Samotné „povolení“ / „enable“ záměrně ne — bývá i vnitřní povel stroje (povolení měniče).
 */
const IFACE_RE = /euromap|rozhraní|schnittstelle|\binterface\b|handshake|sign[aá]l[uy]? (z|ze|do|od|pro|k|ke) |\bsignal (from|to|von|vom|an|zum|zur|zu) |^robot(er)?\b|(z|ze|od|do) robota|(from|to) (the )?robot|(vom|zum|an den) roboter/;
/** Je zařízení (DI / DO / Ventil) jen signál rozhraní k jinému stroji? */
export function bomIsInterface(d: Device): boolean {
  return (d.cls === "DI" || d.cls === "DO" || d.cls === "Ventil") && IFACE_RE.test((d.desc || "").toLowerCase());
}
/** Pohyb nesoucí chapadlo / přísavky (zdvih, pojezd, otočení…) — to je válec, ne chapadlo ani ejektor. */
const MOTION_RE = /zdvih|pojezd|posuv|přesuv|výsuv|vysun|zasun|otoč|dolů|nahoru|zved|\blift|stroke|travel|slide|rotat|\braise|\blower|\bhub\b|heben|senk|verfahr|schwenk|dreh/;
/** Vakuový úchop (ejektor, přísavky, podtlak). */
const VACUUM_RE = /vakuu|vakuov|podtlak|ejektor|přísav|vacuum|suction|ejector|sauger|ventosa/;
/** Pneumatické chapadlo (sevřít / uvolnit). */
const GRIPPER_RE = /chapad|úchop|uchop|gripper|\bgrip|greifer|pinza/;

type ValveKind = "interface" | "hydraulic" | "vacuum" | "gripper" | "process" | "cylinder";
function valveKind(d: Device): ValveKind {
  const t = (d.desc || "").toLowerCase();
  if (bomIsInterface(d)) return "interface";
  if (/hydraul/.test(t)) return "hydraulic";
  const motion = MOTION_RE.test(t);
  if (!motion && VACUUM_RE.test(t)) return "vacuum";
  if (!motion && GRIPPER_RE.test(t)) return "gripper";
  if (has(t, /šoupát|klapk|kohout|uzávěr|potrubí|armatur|damper|klappe|schieber|válvula de proceso/)) return "process";
  return "cylinder";
}
/** Poznámky řádků dílů ventilu (klíče překladu). */
const VALVE_NOTE: Record<string, string> = {
  interface_relay: N_("bezpotenciálový kontakt do druhého stroje (signál rozhraní, ne akční člen)"),
  vacuum_ejector: N_("typ z katalogu je výchozí návrh — ověř sací výkon a vakuum podle dílu; ejektor může mít vlastní ventil a spínač podtlaku (pak rozváděč a spínač vypustit)"),
  suction_cup: N_("počet, průměr a tvar přísavek podle dílu — typ z katalogu je výchozí návrh, přídržnou sílu ověř výpočtem"),
  gripper: N_("paralelní chapadlo; síla a zdvih čelistí podle dílu — typ z katalogu je výchozí návrh, ověř výpočtem"),
};
const VALVE_CATS: Record<ValveKind, string[]> = {
  interface: ["interface_relay"],
  hydraulic: ["hydraulic_valve"],
  vacuum: ["valve_solenoid", "vacuum_ejector", "suction_cup"],
  gripper: ["valve_solenoid", "gripper"],
  process: ["process_valve"],
  cylinder: ["valve_solenoid", "cylinder"],
};

function motorCat(d: Device): string {
  const t = d.desc || "";
  if (has(t, /čerpadl|pump|pumpe|bomba/)) return "pump";
  if (has(t, /dopravník|pás|conveyor|förder|transportad|převodov|gear/)) return "gearmotor";
  return "motor";
}

function aoCat(d: Device): string {
  const t = d.desc || "";
  if (has(t, /ventil|tlak|valve|druck|válvula|presi/)) return "proportional_valve";
  return "vfd";
}

/** Nabídka katalogu pro řádek kusovníku (kategorie + platforma). */
export function bomOptions(cat: string, plat: PlatformKey): Array<{ id: string; brand: CatalogBrand }> {
  return brandsFor(cat, plat).map(b => ({ id: brandOptId(b), brand: b }));
}

/** Výchozí platforma kusovníku: volba v `prj.bom`, jinak první zvolená platforma. */
export function bomPlatform(prj: Project): PlatformKey {
  return hwPlatform(prj);
}

const DIR_TEXT: Record<Dir, string> = {
  DI: N_("{n} digitálních vstupů"), DO: N_("{n} digitálních výstupů"), AI: N_("{n} analogových vstupů"), AO: N_("{n} analogových výstupů"),
};
/** Popis řádku modulů: obsazené kanály skupiny podle směru (texty jsou klíče překladu). */
function modsDesc(mods: HwModule[]): string {
  return HW_DIRS.map(d => {
    const n = mods.reduce((s, m) => s + m.channels.filter(k => k.dir === d && k.io).length, 0);
    return n ? tr(DIR_TEXT[d], { n }) : "";
  }).filter(Boolean).join(", ");
}

/**
 * Položka kusovníku od dalšího modulu (bezpečnostní funkce…): `item` a `preset` (značka, typ,
 * kód, zdroj) nahradí katalog, pokud kategorie v katalogu není nebo modul zná konkrétní typ;
 * volby uživatele (`prj.bom.lines`) mají přednost.
 */
export interface BomExtra {
  tag: string; cat: string; qty: number; desc: string;
  item?: string; note?: string; safety?: boolean; devId?: number;
  preset?: { brand?: string; type?: string; orderCode?: string; src?: string };
}
export type BomProvider = (prj: Project, plat: PlatformKey) => { add: BomExtra[]; drop?: string[] };
const bomProviders: Array<{ name: string; fn: BomProvider }> = [];
/** Přihlásí zdroj dalších řádků kusovníku (`drop` = id řádků, které nahrazuje). Vrací odhlášení. */
export function registerBomProvider(fn: BomProvider, name: string): () => void {
  const at = bomProviders.findIndex(p => p.name === name);
  if (at >= 0) bomProviders[at] = { name, fn }; else bomProviders.push({ name, fn });
  return () => { const i = bomProviders.findIndex(p => p.name === name && p.fn === fn); if (i >= 0) bomProviders.splice(i, 1); };
}

/** Sestaví kusovník. Výsledek je deterministický (stejný projekt → stejné řádky). */
export function buildBom(prj: Project): Bom {
  const plat = bomPlatform(prj);
  const cfg: BomCfg = prj.bom || {};
  const locks = new Set(interlockDevs(prj).map(d => d.id));
  const lockPairs = guardLockPairs(prj, locks);
  const lockedDi = new Set([...lockPairs.values()].filter((x): x is Device => !!x).map(x => x.id));
  type Raw = Omit<BomLine, "pos" | "brand" | "type" | "orderCode" | "supplier" | "item" | "optId" | "src"> & {
    item?: string; preset?: BomExtra["preset"];
    /** položka zvolená sestavou hardwaru (hardware.ts) — kusovník ji nevybírá znovu */
    hw?: { opt?: CatalogBrand; custom?: string };
  };
  const raw: Raw[] = [];
  const add = (tag: string, cat: string, qty: number, desc: string, extra: Partial<Raw> = {}) => {
    if (qty <= 0) return;
    /* kolize označení (např. M1 a P1 → oba -Q1; validateProject ji hlásí jako chybu): ID řádku musí zůstat
       jedinečné, jinak kusovník v UI spadne — druhý výskyt dostane příponu .2, .3 … */
    let tg = tag;
    for (let k = 2; raw.some(x => x.id === tg + ":" + cat); k++) tg = tag + "." + k;
    raw.push({ id: tg + ":" + cat, tag: tg, cat, qty, unit: tr("ks"), desc, note: "", ...extra });
  };
  const safetyNote = tr("Volba a zapojení podle posouzení rizik (EN ISO 13849) — návrh k revizi.");

  /* --- PLC: CPU, karty a vzdálené stanice = sestava hardwaru (hardware.ts), nic se nepočítá zvlášť */
  const L = hwLayout(prj, plat);
  const hwOf = (m: HwModule) => ({ hw: { opt: m.opt, custom: m.custom } });
  const bi = L.modules.find(m => m.builtin);
  add("-A1", "plc_cpu", 1, PLAT[plat].name + " — " + PLAT[plat].cpu
    + (bi && bi.channels.some(k => k.io) ? " (" + tr("vestavěné I/O: {list}", { list: modsDesc([bi]) }) + ")" : ""), hwOf(L.cpu));
  for (const s of L.stations) {
    if (s.remote) {
      const ios = s.modules.filter(m => m.kind === "io");
      add(s.head.dt, "plc_coupler", 1, tr("Vzdálená stanice {dt}: {n} modulů, síť {net}", { dt: s.head.dt, n: ios.length, net: s.net || "—" }), hwOf(s.head));
      for (const a of s.modules.filter(m => m.kind === "acc" && m.cat === "plc_busadapter"))
        add(s.head.dt, a.cat, 1, tr("Připojení stanice {dt} na síť", { dt: s.head.dt }), hwOf(a));
      /* ET 200SP: každý modul na BaseUnit — první světlá (napájení skupiny), další tmavé */
      if (s.head.opt?.hw?.acc?.includes("plc_baseunit") && ios.length) {
        const first = brandsFor("plc_baseunit_first", plat)[0], next = brandsFor("plc_baseunit", plat)[0];
        add(s.head.dt, "plc_baseunit_first", 1, tr("Pod první modul stanice {dt}", { dt: s.head.dt }), { hw: { opt: first } });
        add(s.head.dt, "plc_baseunit", ios.length - 1, tr("Pod další moduly stanice {dt}", { dt: s.head.dt }), { hw: { opt: next } });
      }
    }
    /* karty po skupinách označení (-A2 = DI stanice CPU, -A12 = DI stanice 1 …) */
    const groups = new Map<string, HwModule[]>();
    for (const m of s.modules) if (m.kind === "io" && !m.builtin) {
      const k = m.bomTag + ":" + m.cat;
      groups.set(k, [...(groups.get(k) || []), m]);
    }
    for (const g of groups.values()) add(g[0].bomTag, g[0].cat, g.length, modsDesc(g), hwOf(g[0]));
  }
  if (prj.program.modes !== false && plat !== "unitronics") add("-P1", "plc_hmi", 1, tr("Ovládání AUTO / START / kvitace, alarmy"));

  /* --- zařízení */
  let nMotor = 0;
  const towers = bomBeaconTowers(prj), towersDone = new Set<string>();
  for (const d of prj.devices) {
    const t = "-" + d.name, desc = d.desc || d.name;
    if (d.cls === "Motor") {
      nMotor++;
      const n = d.name.replace(/^\D+/, "") || String(nMotor);
      add(t, motorCat(d), 1, desc, { devId: d.id });
      add("-Q" + n, "motor_protection", 1, tr("Jištění {dev}", { dev: d.name }), { devId: d.id, note: d.opt?.fault ? tr("pomocný kontakt = vstup poruchy") : "" });
      add("-K" + n, "contactor", 1, tr("Spínání {dev}", { dev: d.name }), { devId: d.id, note: d.opt?.fbk !== false ? tr("pomocný kontakt = zpětné hlášení běhu") : "" });
    } else if (d.cls === "Ventil") {
      const kind = valveKind(d);
      const sw = (d.opt?.fbkOpen !== false ? 1 : 0) + (d.opt?.fbkClosed ? 1 : 0);
      for (const c of VALVE_CATS[kind]) add(t, c, 1, desc, { devId: d.id, note: VALVE_NOTE[c] ? tr(VALVE_NOTE[c]) : "" });
      /* hlášení: snímače polohy válce / chapadla, spínač podtlaku, u armatury koncové spínače;
         u rozhraní je hlášení kontakt druhého stroje (pin konektoru rozhraní) */
      if (kind === "cylinder" || kind === "gripper") add(t, "cylinder_switch", sw, tr("Poloha {dev}", { dev: d.name }), { devId: d.id });
      else if (kind === "vacuum") add(t, "vacuum_switch", sw ? 1 : 0, tr("Hlášení podtlaku {dev}", { dev: d.name }), { devId: d.id, note: tr("typ z katalogu je výchozí návrh") });
      else if (kind !== "interface" && sw) add(t, "limit_switch", sw, tr("Koncové polohy {dev}", { dev: d.name }), { devId: d.id, note: tr("u procesní armatury často součástí pohonu") });
    } else if (d.cls === "AnalogIn") {
      add(t, analogCat(d), 1, desc + (d.unit ? " [" + d.unit + "]" : "") + " " + d.rmin + "–" + d.rmax, { devId: d.id });
    } else if (d.cls === "AnalogOut") {
      add(t, aoCat(d), 1, desc, { devId: d.id });
    } else if (d.cls === "Vfd") {
      /* měnič: motor (-M), řadič měniče (-TA, svorky řídicích signálů), jištění přívodu (-Q) */
      const n = d.name.replace(/^\D+/, "") || d.name;
      add(t, motorCat(d), 1, desc, { devId: d.id, note: tr("dimenzovat podle zátěže; motor pro provoz s měničem") });
      add("-" + devRef(d), "vfd", 1, tr("Řízení otáček {dev} ({min}–{max} {unit})", { dev: d.name, min: d.rmin, max: d.rmax, unit: d.unit || "" }).replace(/\s+\)/, ")"), { devId: d.id,
        note: tr("analogová žádaná, DI chod{rev}, reléové výstupy připraven / porucha / otáčky dosaženy", { rev: d.opt?.rev ? tr(" a směr") : "" }) });
      add("-Q" + n, "mcb", 1, tr("Jištění měniče {dev}", { dev: d.name }), { devId: d.id, note: tr("podle návodu měniče (jistič / pojistky, případně EMC filtr)") });
    } else if (d.cls === "PosDrive") {
      /* polohovací pohon: řadič se záznamy (-TA) a elektrická osa s motorem (-M) */
      add("-" + devRef(d), "positioning_drive", 1, tr("Řadič polohování {dev}: {n} záznamů přes I/O", { dev: d.name, n: maxRecord(d) }), { devId: d.id,
        note: tr("paralelní I/O: výběr záznamu, start, referování, HALT; tabulka záznamů v řadiči") });
      add(t, "linear_axis", 1, desc, { devId: d.id, note: (d.records || []).length ? tr("záznamy: {list}", { list: (d.records || []).map(r => r.no + " " + (r.name || "")).join(", ") }) : "" });
    } else if (d.cls === "Axis") {
      /* servoosa: servoměnič (-TA, uzel sítě) a servomotor (-M); mechanika osy (šroub / řemen) mimo rozsah */
      const c = axisCfgOf(d), dia = axisDialect(prj, plat);
      add("-" + devRef(d), "servo_drive", 1, tr("Servoměnič osy {dev} ({net})", { dev: d.name, net: dia ? AXIS_NET[dia] : tr("síť podle platformy") }), { devId: d.id,
        note: tr("objekt osy {obj}; STO na svorkách / bezpečná síť podle bezpečnostní funkce", { obj: axisObjName(d) }) });
      add(t, "servo_motor", 1, desc, { devId: d.id, note: tr("dimenzovat podle zátěže: max. {v} {u}/s, {a} {u}/s²; brzda u svislé osy", { v: c.vMax, a: c.aMax, u: d.unit || "mm" }) });
    } else if (d.cls === "PropValve") {
      add(t, "proportional_valve", 1, desc + (d.unit ? " [" + d.unit + "]" : "") + " " + d.rmin + "–" + d.rmax, { devId: d.id,
        note: ioOf(prj, d).rawAct ? tr("žádaná 0–10 V / 4–20 mA, analogový výstup skutečné hodnoty") : tr("žádaná 0–10 V / 4–20 mA") });
    } else if (d.cls === "DI") {
      const c = diCat(prj, d, locks);
      if (!c) continue;
      if (lockedDi.has(d.id)) {
        /* kontakt „zavřeno a zamčeno“ zámku krytu = součást přístroje zámku (řádek DO), nic se neobjednává */
        const lk = [...lockPairs.entries()].find(([, di]) => di?.id === d.id)!;
        const lkDev = prj.devices.find(x => x.id === lk[0])!;
        add(t, "guard_lock_contact", 1, desc, { devId: d.id, safety: true,
          note: tr("kontakt zavřeno a zamčeno blokovacího zařízení se zámkem -{lock} (součást přístroje, neobjednává se)", { lock: lkDev.name })
            + "; " + tr("návrh, ověřit v posouzení rizik (EN ISO 14119, EN ISO 13849)") });
        continue;
      }
      const safety = c === "estop_button" || c === "light_curtain" || c === "safety_switch";
      add(t, c, 1, desc, { devId: d.id, safety, note: safety ? safetyNote
        : c === "selector_switch" ? tr("počet poloh, s klíčem / bez klíče a kontakty podle funkce — typ doplní projektant") : "" });
    } else if (d.cls === "DO") {
      const c = doCat(d);
      if (c === "beacon") {
        /* věž se zapíše u prvního jejího DO (řádek věže + všechna patra shora), další DO téže věže už nic */
        const tw = towers.find(w => w.tiers.some(x => x.dev.id === d.id))!;
        if (towersDone.has(tw.tag)) continue;
        towersDone.add(tw.tag);
        const cname = (x: BeaconTier) => x.color ? tr(BEACON_COLOR_TEXT[x.color]) : "?";
        add(tw.tag, "beacon", 1, tr("Signální věž: {list}", { list: tw.tiers.map(x => x.dev.name + " " + cname(x)).join(", ") }), {
          note: tw.stock && tw.tiers.length === 3
            ? tr("jedna věž, patro na každý výstup (pořadí shora červená / žlutá / modrá / zelená / bílá); hotová věž červená / žlutá / zelená z katalogu; montáž (patka / trubka / držák) podle místa na stroji")
            : tw.stock
            ? tr("jedna věž, patro na každý výstup (pořadí shora červená / žlutá / modrá / zelená / bílá); hotová věž červená / žlutá / zelená z katalogu — nepoužité patro zůstane rezervou; montáž (patka / trubka / držák) podle místa na stroji")
            : tr("jedna věž, patro na každý výstup (pořadí shora červená / žlutá / modrá / zelená / bílá); barvy pater hotová věž z katalogu (červená / žlutá / zelená) nepokryje — stavebnicová věž (přípojný prvek, světelné prvky, montáž), typ doplní projektant") });
        for (const x of tw.tiers) add("-" + x.dev.name, "beacon_light", 1, x.dev.desc || x.dev.name, { devId: x.dev.id,
          note: !x.color ? tr("patro věže {tower}: barvu doplní projektant (popis ani role ji neurčují)", { tower: tw.tag })
            : x.roleDefault ? tr("patro věže {tower}: {color} — výchozí PLCdesk podle role {role} (rozhodnutí uživatele); u hotové věže součást věže, u stavebnicové světelný prvek této barvy", { tower: tw.tag, color: cname(x), role: x.dev.role || "" })
            : tr("patro věže {tower}: {color}; u hotové věže součást věže, u stavebnicové světelný prvek této barvy", { tower: tw.tag, color: cname(x) }) });
        continue;
      }
      if (c === "guard_lock") {
        const di = lockPairs.get(d.id);
        add(t, c, 1, desc, { devId: d.id, safety: true, note: (di
          ? tr("blokovací zařízení se zámkem (jištění krytu, EN ISO 14119): cívka zámku = výstup {dev}, kontakt zavřeno a zamčeno = vstup {di} (bez samostatného spínače)", { dev: d.name, di: di.name })
          : tr("blokovací zařízení se zámkem (jištění krytu, EN ISO 14119): cívka zámku = výstup {dev}; kontakty hlídání dveří jsou součástí přístroje — samostatný spínač krytu podle posouzení rizik", { dev: d.name }))
          + "; " + tr("návrh, ověřit v posouzení rizik (EN ISO 14119, EN ISO 13849)") });
        continue;
      }
      add(t, c, 1, desc, { devId: d.id, note: bomIsInterface(d) ? tr(VALVE_NOTE.interface_relay) : "" });
    }
  }
  /* rozhraní k jinému stroji (lis, robot…): jeden konektor s kabelem pro všechny signály výměny */
  const iface = prj.devices.filter(d => bomIsInterface(d) && (d.cls !== "DI" || diCat(prj, d, locks) === ""));
  if (iface.length) add("-XG1", "machine_interface", 1, tr("Rozhraní k jinému stroji: {list}", { list: iface.map(d => d.name).join(", ") }), {
    note: iface.some(d => /euromap/i.test(d.desc || ""))
      ? tr("EUROMAP: konektor a kabel podle normy rozhraní, výstupy do druhého stroje bezpotenciálovými kontakty (vazební relé) — typ doplní projektant")
      : tr("konektor, kabel a přiřazení pinů podle dokumentace druhého stroje — typ doplní projektant") });

  /* --- pneumatika stroje (2026-11-04, moduly P2 / P3 PLCdesk PRO): rozváděče válců / chapadel / vakua na jedné liště
     (-WP1, IEC 81346-2 třída W = vedení média; počet míst = počet rozváděčů) a přívod přes ruční uzávěr (-QM1)
     a filtr-regulátor (-HQ1 = filtrování). Bezpečnostní odvzdušňovací ventil přidává modul bezpečnosti (-YS1). */
  const pneuValves = raw.filter(x => x.cat === "valve_solenoid");
  if (pneuValves.length) {
    const list = pneuValves.map(x => x.tag.replace(/^-/, "")).join(", ");
    add("-WP1", "valve_manifold", 1, tr("Lišta rozváděčů — počet míst: {n} ({list})", { n: pneuValves.length, list }), {
      note: tr("počet míst = počet rozváděčů (rezervu míst doplní projektant); typ lišty podle počtu míst ověřit u výrobce") });
    add("-QM1", "air_shutoff", 1, tr("Ruční uzávěr přívodu stlačeného vzduchu stroje"), {
      note: tr("uzamykatelnost (odpojení energie, EN ISO 14118) ověřit u výrobce") });
    add("-HQ1", "air_prep", 1, tr("Filtr-regulátor stlačeného vzduchu stroje"), {
      note: tr("tlak a průtok podle spotřeby válců; za uzávěrem, před rozváděči") });
  }

  /* --- rozvaděč */
  const sensors = prj.devices.filter(d => (d.cls === "DI" && diCat(prj, d, locks) !== "") || d.cls === "AnalogIn").length
    + prj.devices.filter(d => d.cls === "Ventil" && !bomIsInterface(d)).reduce((a, d) => a + (d.opt?.fbkOpen !== false ? 1 : 0) + (d.opt?.fbkClosed ? 1 : 0), 0)
    + prj.devices.filter(d => d.cls === "PropValve" || d.cls === "PosDrive").length;   // kabel M12 k ventilu, I/O kabel k řadiči pohonu
  const safetyDevs = (prj.program.estop ? 1 : 0) + locks.size;
  if (safetyDevs) add("-K0", "safety_relay", 1, tr("Vyhodnocení E-stopu a blokování"), { safety: true, note: safetyNote });
  add("-Q0", "main_switch", 1, tr("Hlavní vypínač rozvaděče"));
  add("-F1", "mcb", 2, tr("Jištění zdroje 24 V a řízení"));
  add("-T1", "power_supply_24v", 1, tr("Napájení PLC, snímačů a ventilů"), { note: tr("dimenzovat podle odběru") });
  /* svorky = svorkovnice výkresů X1…Xn (kanálová skupina = list zapojení = `svorkyCSV`, jedna svorka na kanál),
     jeden řádek na svorkovnici — stejné počty jako `terminals` manifestu pro CAD (dřív odhad I/O × 1,2 + 10,
     který s výkresy ani se 3D nesouhlasil; zpětná vazba z CAD 2026-10-14). Svorky napájení a rezervu
     výkresy neobsahují — doplní projektant (poznámka řádku), kusovník je nevymýšlí. */
  modules(prj).forEach((m, i) => add("-X" + (i + 1), "terminal_block", m.ch.length,
    tr("Svorkovnice X{n} ({mod}) podle výkresu zapojení", { n: i + 1, mod: m.dir + m.idx }),
    i === 0 ? { note: tr("svorky napájení 24 V / 0 V / PE a rezervu doplní projektant") } : {}));
  add("-W1xx", "cable_sensor", sensors, tr("Připojení snímačů"));
  add("+1", "cabinet", 1, tr("Rozvaděč stroje"), { note: tr("velikost podle počtu modulů a stykačů") });

  /* --- řádky dalších modulů (bezpečnostní funkce…) */
  for (const p of bomProviders) {
    const r = p.fn(prj, plat);
    for (const id of r.drop || []) { const i = raw.findIndex(x => x.id === id); if (i >= 0) raw.splice(i, 1); }
    for (const e of r.add) if (e.qty > 0 && !raw.some(x => x.id === e.tag + ":" + e.cat))
      raw.push({ id: e.tag + ":" + e.cat, tag: e.tag, cat: e.cat, qty: e.qty, unit: tr("ks"), desc: e.desc, note: e.note || "", safety: e.safety, devId: e.devId, item: e.item, preset: e.preset });
  }

  /* --- značky z katalogu a volby uživatele */
  const lines: BomLine[] = raw.map((r, i) => {
    const key = catKey(r.cat, plat);
    const brands = brandsFor(r.cat, plat);
    const pre = r.preset;
    let pickName = cfg.lines?.[r.id]?.brand ?? cfg.brand?.[key] ?? (pre?.brand && !brands.length ? pre.brand : undefined);
    /* bez volby uživatele: značka shodná s platformou PLC (Schneider → stykače Schneider), jinak první */
    const platBrand = PLAT[plat].name.split(" ")[0].toLowerCase();
    /* volba mimo katalog (vlastní značka) = žádná data z katalogu, jen to, co zadal uživatel;
       řádky PLC nesou položku zvolenou sestavou hardwaru (respektuje volby uživatele i rack) */
    let b: CatalogBrand | undefined = pickName !== undefined
      ? brands.find(x => brandOptId(x) === pickName) || brands.find(x => x.brand === pickName)
      : brands.find(x => x.brand.toLowerCase().startsWith(platBrand)) || brands[0];
    if (r.hw) { b = r.hw.opt; pickName = r.hw.custom ?? (b ? brandOptId(b) : pickName); }
    const custom = pickName !== undefined && !b;
    const over = cfg.lines?.[r.id] || {};
    const sup = (b?.suppliers?.[0] ? tr(b.suppliers[0]) : "") || (custom ? "" : tr(suppliersFor(key)[0]?.name || ""));
    /* typ od modulu (bez katalogu kategorie), dokud uživatel nezvolí jinou značku */
    const usePre = !!pre && custom && pickName === pre.brand;
    const { preset: _pre, item: ownItem, hw: _hw, ...rest } = r;
    return {
      ...rest,
      pos: i + 1,
      item: ownItem || tr(CAT_LABEL[r.cat] || r.cat),
      qty: Number.isFinite(over.qty) && over.qty! >= 0 ? over.qty! : r.qty,
      brand: custom ? pickName! : b?.brand ?? "",
      type: over.type ?? (usePre ? pre!.type || "" : b?.typical ? tr(b.typical) : (b?.series || []).map(x => tr(x)).join(" / ")),
      orderCode: over.orderCode ?? (usePre ? pre!.orderCode || "" : b?.orderCode ?? ""),
      supplier: over.supplier ?? sup,
      note: [r.note, over.note].filter(Boolean).join("; "),
      optId: b ? brandOptId(b) : "",
      src: usePre ? pre!.src || "" : b?.src || "",
      ...(Number.isFinite(over.qty) && over.qty === 0 ? { excluded: true } : {}),
    };
  }).filter(l => l.qty > 0 || l.excluded);
  lines.forEach((l, i) => { l.pos = i + 1; });
  return { plat, lines };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** CSV pro Excel (středník, UTF-8 s BOM — česká lokalizace Excelu). */
export function bomCsv(prj: Project): string {
  const lines = buildBom(prj).lines.filter(l => !l.excluded);
  const head = [tr("Pozice"), tr("Označení"), tr("Položka"), tr("Popis"), tr("Množství"), tr("Jednotka"),
    tr("Výrobce"), tr("Typ"), tr("Objednací kód"), tr("Dodavatel"), tr("Poznámka")];
  const rows = lines.map(l => [l.pos, l.tag, l.item, l.desc, l.qty, l.unit, l.brand, l.type, l.orderCode, l.supplier, l.note]);
  return "﻿" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** Sloupce tabulky kusovníku pro export (CSV i kopírování) — klíče překladu. */
const BOM_EXPORT_HEAD = [N_("Pozice"), N_("Označení"), N_("Položka"), N_("Popis"), N_("Množství"), N_("Jednotka"),
  N_("Výrobce"), N_("Typ"), N_("Objednací kód"), N_("Dodavatel"), N_("Poznámka")];

/**
 * Text tabulky ke kopírování (tabulátory, řádky \n) — Excel / e-mail. Stejné sloupce a řádky
 * jako `bomCsv` (řádky s množstvím 0 vyřazené); web i desktop volají tuto funkci, nic neskládají sami.
 */
export function bomTableText(prj: Project): string {
  const cell = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  const rows = buildBom(prj).lines.filter(l => !l.excluded)
    .map(l => [l.pos, l.tag, l.item, l.desc, l.qty, l.unit, l.brand, l.type, l.orderCode, l.supplier, l.note]);
  return [BOM_EXPORT_HEAD.map(h => tr(h)), ...rows].map(r => r.map(cell).join("\t")).join("\n") + "\n";
}

/** Nejvyšší množství řádku kusovníku, které jde zadat ručně. */
export const BOM_QTY_MAX = 100000;

/**
 * Množství řádku kusovníku zadané uživatelem (text z pole nebo číslo): celé číslo 0…`BOM_QTY_MAX`
 * (0 = řádek vyřadit z CSV a dokumentu, zůstane v přehledu šedě). Prázdné pole = `reset` (zpět
 * na množství z návrhu). Jednotky kusovníku jsou kusy, proto jen celá čísla.
 */
export function bomQtyInput(v: unknown): { qty?: number; reset?: boolean; error?: string } {
  const s = typeof v === "number" ? String(v) : String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return { reset: true };
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > BOM_QTY_MAX)
    return { error: tr("Množství zadej jako celé číslo 0 až {max}.", { max: BOM_QTY_MAX }) };
  return { qty: n };
}

/** Druhy dodavatelů z katalogu (data jsou česky) → klíč překladu. */
const SUP_KIND: Record<string, string> = {
  "distributor": N_("distributor"), "e-shop": N_("e-shop"), "výrobce": N_("výrobce"),
  "pobočka výrobce": N_("pobočka výrobce"), "pobočka výrobce (EU)": N_("pobočka výrobce (EU)"),
  "výrobce (evropská pobočka)": N_("výrobce (evropská pobočka)"),
};

export interface BomSupplierRow {
  /** jméno, jak stojí v řádcích kusovníku */
  name: string;
  url: string;
  /** druh (přeložený), prázdné = neznámý */
  kind: string;
  /** dodavatele zadal uživatel a v katalogu není */
  custom: boolean;
  /** počet řádků kusovníku s tímto dodavatelem */
  rows: number;
}

/**
 * Přehled dodavatelů POUŽITÝCH v kusovníku (podklad k poptávce: koho oslovit a kolik položek).
 * Nabídku všech dodavatelů kategorie dává výběr u řádku. Dodavatelé u značek v katalogu jsou volný
 * text („Festo CZ (přímo)“) → shoda se seznamem dodavatelů i podle začátku jména.
 */
export function bomSuppliers(prj: Project): BomSupplierRow[] {
  const lines = buildBom(prj).lines.filter(l => !l.excluded);
  const own = prj.bom?.lines || {};
  const used = [...new Set(lines.map(l => l.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const head = (s: string) => s.split(" (")[0].toLowerCase();
  return used.map(n => {
    const base = head(n);
    const s = SUPPLIERS.find(x => x.name === n || tr(x.name) === n) || SUPPLIERS.find(x => head(x.name) === base)
      || SUPPLIERS.find(x => base.length > 3 && (x.name.toLowerCase().startsWith(base) || base.startsWith(head(x.name))));
    const mine = lines.filter(l => l.supplier === n);
    return {
      name: n, url: s?.url || "",
      kind: s?.kind ? (SUP_KIND[s.kind] ? tr(SUP_KIND[s.kind]) : s.kind) : "",
      custom: !s && mine.some(l => own[l.id]?.supplier === n),
      rows: mine.length,
    };
  });
}

/** Kusovník do dokumentace (Markdown). */
export function bomMd(prj: Project): string {
  const { plat } = buildBom(prj);
  const lines = buildBom(prj).lines.filter(l => !l.excluded);
  const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "/");
  const out = [
    "# " + tr("Kusovník komponent") + " — " + (prj.meta.name || ""),
    "",
    tr("Platforma řízení: **{plat}**. Značky a typy jsou typické volby z katalogu PLCdesk — podklad k poptávce, ne projekt elektro. Dimenzování a bezpečnostní prvky podle posouzení rizik ověří projektant (návrh k revizi).", { plat: PLAT[plat].name }),
    "",
    "| # | " + [tr("Označení"), tr("Položka"), tr("Popis"), tr("Ks"), tr("Výrobce"), tr("Typ"), tr("Objednací kód"), tr("Dodavatel")].join(" | ") + " |",
    "|---|---|---|---|---:|---|---|---|---|",
    ...lines.map(l => "| " + [l.pos, l.tag, l.item + (l.safety ? " ⚠" : ""), l.desc, l.qty, l.brand, l.type, l.orderCode, l.supplier].map(esc).join(" | ") + " |"),
    "",
  ];
  if (lines.some(l => l.safety)) out.push("⚠ " + tr("Volba a zapojení podle posouzení rizik (EN ISO 13849) — návrh k revizi."), "");
  const fbMd = cadFeedbackMd(prj);
  if (fbMd) out.push(fbMd);
  return out.join("\n");
}

/**
 * Oddíl kusovníku (Markdown) s rozhodnutími o zpětné vazbě z CAD (`cad_feedback.ts`, historie
 * `prj.bom.cadFeedback`); bez historie prázdný — výstup beze změny (golden).
 */
export function cadFeedbackMd(prj: Project): string {
  const h = prj.bom?.cadFeedback || [];
  if (!h.length) return "";
  const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ");
  return [
    "## " + tr("Změny ze zpětné vazby CAD"), "",
    tr("Neshody nalezené ve 3D modelu; PLCdesk je zdroj pravdy kusovníku — návrhy přijal nebo odmítl uživatel."), "",
    "| " + [tr("Kdy"), tr("Kdo"), tr("Rozhodnutí"), tr("Položka"), tr("Zpráva z CAD"), tr("Změna")].join(" | ") + " |",
    "|---|---|---|---|---|---|",
    ...h.map(r => "| " + [r.at.slice(0, 10), r.by || "—", r.decision === "accepted" ? tr("přijato") : tr("odmítnuto"),
      r.partId || "—", r.message, r.change || "—"].map(esc).join(" | ") + " |"),
    "",
  ].join("\n");
}


/**
 * Jediná vazba rozvaděč → válec / chapadlo téhož zařízení (kusovník `ls` = řádky jednoho zařízení).
 * Používá ji export pro CAD (`actuates`) i pneumatické schéma (`pneuCircuits`).
 */
export function valveCylinder(ls: BomLine[]): { valve?: BomLine; cyl?: BomLine } {
  return {
    valve: ls.find(l => l.cat === "valve_solenoid" || l.cat === "hydraulic_valve" || l.cat === "process_valve"),
    cyl: ls.find(l => l.cat === "cylinder" || l.cat === "gripper"),
  };
}
