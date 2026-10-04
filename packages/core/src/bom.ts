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
import { tr } from "./i18n.js";
import {
  BomCfg, Device, PlatformKey, Project, PLAT, interlockDevs, modules, devRef, maxRecord, ioOf,
} from "./model.js";
import { CAT_LABEL, CatalogBrand, brandsFor, catKey, suppliersFor } from "./catalog.js";

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
  if (has(t, /tlačítk|start|kvit|button|taster|pulsador|přepína|selector/)) return "pushbutton";
  if (has(t, /hladin|kapacit|level|capacit/)) return "sensor_capacitive";
  if (has(t, /optick|reflex|závor|fotobu|optical|light|licht|óptic/)) return "sensor_optical";
  if (has(t, /koncák|koncov|limit|endschalter|final de carrera/)) return "limit_switch";
  return "sensor_inductive";
}

function doCat(d: Device): string {
  const t = d.desc || "";
  if (d.role === "lock" || has(t, /zámek|zámk|lock|zuhalt|bloqueo/)) return "safety_switch";
  if (has(t, /houkačk|siréna|horn|hupe|bocina|sirene/)) return "horn";
  if (has(t, /maják|věž|beacon|signalsäule|baliza|signálka.*(zelen|červen|žlut)/)) return "beacon";
  if (has(t, /signálk|kontrolk|pilot|leuchtmelder|piloto|indikac/)) return "pilot_light";
  return "interface_relay";
}

function valveCats(d: Device): string[] {
  const t = d.desc || "";
  if (has(t, /hydraul/)) return ["hydraulic_valve"];
  if (has(t, /přísav|vakuu|vacuum|sauger|ventosa/)) return ["valve_solenoid"];
  if (has(t, /šoupát|klapk|kohout|uzávěr|potrubí|armatur|damper|klappe|schieber|válvula de proceso/)) return ["process_valve"];
  return ["valve_solenoid", "cylinder"];
}

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

/** Identifikace volby z katalogu (značka + kód / řada) — hodnota v `prj.bom.brand` / `lines[].brand`. */
export function brandOptId(b: CatalogBrand): string {
  const what = b.orderCode || (b.series || [])[0] || "";
  return what ? b.brand + " · " + what : b.brand;
}

/** Nabídka katalogu pro řádek kusovníku (kategorie + platforma). */
export function bomOptions(cat: string, plat: PlatformKey): Array<{ id: string; brand: CatalogBrand }> {
  return brandsFor(cat, plat).map(b => ({ id: brandOptId(b), brand: b }));
}

/** Výchozí platforma kusovníku: volba v `prj.bom`, jinak první zvolená platforma. */
export function bomPlatform(prj: Project): PlatformKey {
  const p = prj.bom?.plat;
  if (p && PLAT[p]) return p;
  return (prj.platforms && prj.platforms[0]) || "siemens";
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
  const raw: Array<Omit<BomLine, "pos" | "brand" | "type" | "orderCode" | "supplier" | "item" | "optId" | "src"> & { item?: string; preset?: BomExtra["preset"] }> = [];
  const add = (tag: string, cat: string, qty: number, desc: string, extra: Partial<BomLine> = {}) => {
    if (qty <= 0) return;
    raw.push({ id: tag + ":" + cat, tag, cat, qty, unit: tr("ks"), desc, note: "", ...extra });
  };
  const safetyNote = tr("Volba a zapojení podle posouzení rizik (EN ISO 13849) — návrh k revizi.");

  /* --- PLC a I/O moduly zvolené platformy */
  const mods = modules(prj);
  const nMod = (dir: string) => mods.filter(m => m.dir === dir).length;
  add("-A1", "plc_cpu", 1, PLAT[plat].name + " — " + PLAT[plat].cpu);
  add("-A2", "plc_di", nMod("DI"), tr("{n} digitálních vstupů", { n: prj.io.filter(e => e.dir === "DI").length }));
  add("-A3", "plc_do", nMod("DO"), tr("{n} digitálních výstupů", { n: prj.io.filter(e => e.dir === "DO").length }));
  /* Unitronics: kombinovaný analogový modul (4 AI + 2 AO) a HMI přímo v CPU */
  const nAi = plat === "unitronics"
    ? Math.max(Math.ceil(prj.io.filter(e => e.dir === "AI").length / 4), Math.ceil(prj.io.filter(e => e.dir === "AO").length / 2))
    : nMod("AI");
  add("-A4", "plc_ai", nAi, tr("{n} analogových vstupů", { n: prj.io.filter(e => e.dir === "AI").length }));
  if (plat !== "unitronics") add("-A5", "plc_ao", nMod("AO"), tr("{n} analogových výstupů", { n: prj.io.filter(e => e.dir === "AO").length }));
  if (prj.program.modes !== false && plat !== "unitronics") add("-P1", "plc_hmi", 1, tr("Ovládání AUTO / START / kvitace, alarmy"));

  /* --- zařízení */
  let nMotor = 0;
  for (const d of prj.devices) {
    const t = "-" + d.name, desc = d.desc || d.name;
    if (d.cls === "Motor") {
      nMotor++;
      const n = d.name.replace(/^\D+/, "") || String(nMotor);
      add(t, motorCat(d), 1, desc, { devId: d.id });
      add("-Q" + n, "motor_protection", 1, tr("Jištění {dev}", { dev: d.name }), { devId: d.id, note: d.opt?.fault ? tr("pomocný kontakt = vstup poruchy") : "" });
      add("-K" + n, "contactor", 1, tr("Spínání {dev}", { dev: d.name }), { devId: d.id, note: d.opt?.fbk !== false ? tr("pomocný kontakt = zpětné hlášení běhu") : "" });
    } else if (d.cls === "Ventil") {
      const cats = valveCats(d);
      for (const c of cats) add(t, c, 1, desc, { devId: d.id });
      const sw = (d.opt?.fbkOpen !== false ? 1 : 0) + (d.opt?.fbkClosed ? 1 : 0);
      if (cats.includes("cylinder")) add(t, "cylinder_switch", sw, tr("Poloha {dev}", { dev: d.name }), { devId: d.id });
      else if (sw) add(t, "limit_switch", sw, tr("Koncové polohy {dev}", { dev: d.name }), { devId: d.id, note: tr("u procesní armatury často součástí pohonu") });
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
    } else if (d.cls === "PropValve") {
      add(t, "proportional_valve", 1, desc + (d.unit ? " [" + d.unit + "]" : "") + " " + d.rmin + "–" + d.rmax, { devId: d.id,
        note: ioOf(prj, d).rawAct ? tr("žádaná 0–10 V / 4–20 mA, analogový výstup skutečné hodnoty") : tr("žádaná 0–10 V / 4–20 mA") });
    } else if (d.cls === "DI") {
      const c = diCat(prj, d, locks);
      const safety = c === "estop_button" || c === "light_curtain" || c === "safety_switch";
      add(t, c, 1, desc, { devId: d.id, safety, note: safety ? safetyNote : "" });
    } else if (d.cls === "DO") {
      const c = doCat(d);
      add(t, c, 1, desc, { devId: d.id, safety: c === "safety_switch", note: c === "safety_switch" ? safetyNote : "" });
    }
  }

  /* --- rozvaděč */
  const sensors = prj.devices.filter(d => d.cls === "DI" || d.cls === "AnalogIn").length
    + prj.devices.filter(d => d.cls === "Ventil").reduce((a, d) => a + (d.opt?.fbkOpen !== false ? 1 : 0) + (d.opt?.fbkClosed ? 1 : 0), 0)
    + prj.devices.filter(d => d.cls === "PropValve" || d.cls === "PosDrive").length;   // kabel M12 k ventilu, I/O kabel k řadiči pohonu
  const safetyDevs = (prj.program.estop ? 1 : 0) + locks.size;
  if (safetyDevs) add("-K0", "safety_relay", 1, tr("Vyhodnocení E-stopu a blokování"), { safety: true, note: safetyNote });
  add("-Q0", "main_switch", 1, tr("Hlavní vypínač rozvaděče"));
  add("-F1", "mcb", 2, tr("Jištění zdroje 24 V a řízení"));
  add("-T1", "power_supply_24v", 1, tr("Napájení PLC, snímačů a ventilů"), { note: tr("dimenzovat podle odběru") });
  add("-X1", "terminal_block", Math.ceil(prj.io.length * 1.2) + 10, tr("Svorky I/O a napájení"));
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
    const pickName = cfg.lines?.[r.id]?.brand ?? cfg.brand?.[key] ?? (pre?.brand && !brands.length ? pre.brand : undefined);
    /* bez volby uživatele: značka shodná s platformou PLC (Schneider → stykače Schneider), jinak první */
    const platBrand = PLAT[plat].name.split(" ")[0].toLowerCase();
    /* volba mimo katalog (vlastní značka) = žádná data z katalogu, jen to, co zadal uživatel */
    const b: CatalogBrand | undefined = pickName !== undefined
      ? brands.find(x => brandOptId(x) === pickName) || brands.find(x => x.brand === pickName)
      : brands.find(x => x.brand.toLowerCase().startsWith(platBrand)) || brands[0];
    const custom = pickName !== undefined && !b;
    const over = cfg.lines?.[r.id] || {};
    const sup = (b?.suppliers?.[0] ? tr(b.suppliers[0]) : "") || (custom ? "" : tr(suppliersFor(key)[0]?.name || ""));
    /* typ od modulu (bez katalogu kategorie), dokud uživatel nezvolí jinou značku */
    const usePre = !!pre && custom && pickName === pre.brand;
    const { preset: _pre, item: ownItem, ...rest } = r;
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
  return out.join("\n");
}

