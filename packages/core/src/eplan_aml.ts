/**
 * PLCdesk → EPLAN Electric P8: AutomationML AR APC 1.4.0 (CAEX 2.15) — zadání docs/eplan-aml-export.md.
 *
 *   genEplanAml(prj, opts)   soubor .aml (EPLAN: Import PLC dat, formát „AutomationML AR APC“)
 *   validateEplan(prj, opts) nálezy kontroly (§13): unikátní ID, rozlišitelné RefPartnerSideA/B a link
 *                            v nejbližším společném rodiči, povinné atributy, unikátní UDT + symbolická
 *                            adresa v CPU, unikátní název fyzické sítě, GUID v modelu
 *   validateAml(xml)         táž kontrola nad hotovým textem AML (i cizím)
 *
 * Hierarchie (§6) — role jako SupportedRoleClass, pořadí prvků dle XSD CAEX 2.15:
 *   InstanceHierarchy
 *   └ AutomationProject  (ID = Project.guid; konfigurační projekt EPLAN 20161 = název projektu bez „.“)
 *     ├ Subnet „PN_IE_1“ (Type Ethernet = sběrnicový systém 20308; název = fyzická síť 20413, unikátní)
 *     └ Device  stanice PLC (ID stanice 20408 bez „.“; TypeIdentifier System:Device.S71200 / S71500 / ET200SP / Generic)
 *       └ DeviceItem Rack „Rack_0“ (System:Rack.<rodina>; karta na racku 20410 = vnoření + PositionNumber)
 *         ├ DeviceItem CPU -A1 (slot ze sestavy, DeviceItemType CPU, OrderNumber s mezerou u Siemens)
 *         │ ├ vestavěné I/O: BuiltIn podmodul „DI 14/DQ 10“ (PositionNumber 1, Address po směrech, kanály — TIA V17)
 *         │ ├ CommunicationInterface „PROFINET_interface_1“ (Label X1, LogicalEndPoint_Interface)
 *         │ │ ├ Node „E1“ (Type Ethernet, NetworkAddress; NodeEthernet: maska, ProfinetDeviceName; LogicalEndPoint_Node)
 *         │ │ ├ IoSystem „PROFINET_IO_system“ (logická síť 20414; Number = MasterSystemID 20334)
 *         │ │ └ CommunicationPort „Port_1“ (Label P1 R)
 *         │ └ TagTable „PLCdesk“ → Tag (ID = GUID signálu; LogicalAddress bez směru; volitelně ComplexTag = UDT)
 *         └ DeviceItem karty -A2 … (slot ze sestavy, ID = GUID karty)
 *           └ Siemens: BuiltIn podmodul (PositionNumber 1) s Address a kanály (jako TIA Portal V18/V21);
 *             ostatní: Address a kanály přímo na kartě (jako EPLAN 2.7.3 / TwinCAT)
 *             → ExternalInterface „Channel_DI_0“ … všechny kanály karty podle katalogu (ID poziční z GUID karty)
 *     └ Device  vzdálená stanice (Siemens: System:Device.ET200SP) → Rack_0 → hlava -A10 (HeadModule, slot 0;
 *       Siemens: BusAdapter slot 127 s rozhraním X1, uzlem IE1 a porty P1/P2 R) → karty od slotu 1 → server modul
 *   InternalLink kanál ↔ tag v nejbližším společném rodiči (Rack_0, u vzdálených stanic AutomationProject),
 *   Node ↔ Subnet a rozhraní stanice ↔ IoSystem CPU (PROFINET) v AutomationProject (§10, jako TIA V18).
 *
 * Sestava (stanice, sloty, typy, kanály, adresy) je hardware.ts `hwLayout` — export nic nepočítá sám.
 * Vzdálené stanice na EtherCAT (Beckhoff EK1100, Omron NX-ECC203) jsou bez uzlu sítě (doplní se v EPLAN).
 *
 * GUID: export je jen čte (guid.ts) — chybějící GUID nahradí deterministickým zástupcem z názvu a
 * validateEplan to hlásí. Objekty bez vlastního záznamu (stanice, rack, CPU, rozhraní, síť) mají GUID
 * odvozený z GUID projektu. Stav: neověřeno importem do EPLAN (EPLAN_VERIFIED v eplan.ts).
 */
import { type Project, type Dir, type IoEntry, type Device, type PlatformKey, PLAT, devById, addrFor, dtFor, stripDia, devSignals, devRef } from "./model.js";
import { tr, today, withLang, getLang, LANGS, type Lang } from "./i18n.js";
import { buildBom, bomPlatform, type BomLine } from "./bom.js";
import { derivedGuid, isGuid } from "./guid.js";
import { ROLE, IFACE, LEP, DEVICE_ITEM_TYPES, SUBNET_TYPE, AML_LANG, AML_LIBS, REQUIRED, ARAPC_VERSION } from "./eplan/spec/arapc.js";
import { eplanAmlName, EPLAN_VERIFIED, type EplanCard } from "./eplan.js";
import { hwLayout, hwLineId, hwTypeText, HW_DIRS, type HwModule } from "./hardware.js";
import { axisObjName } from "./axis.js";
import { axisDialect, AXIS_NET } from "./axis_gen.js";

export interface EplanAmlOptions {
  /** karty z `eplanCards` (export čte sestavu hardwaru přímo; pole zůstává kvůli kompatibilitě volání) */
  cards?: EplanCard[];
  /** symbolické adresy jako UDT (ComplexTag = zařízení, Tag = signál) místo plochých tagů `<zařízení>_<signál>` */
  udt?: boolean;
  /** rozhraní PROFINET CPU, IO systém a podsíť (výchozí ano) */
  network?: boolean;
  /** čas zápisu do hlavičky (testy) */
  now?: Date;
}

export interface EplanIssue { level: "error" | "warn"; where: string; msg: string; }

/* ================================================================ strom */

interface Attr { name: string; xml: string; }
interface Ei { name: string; id: string; cls: string; attrs: Attr[]; }
interface Ie {
  name: string; id: string; role: string; support: string[];
  attrs: Attr[]; ifaces: Ei[]; kids: Ie[]; links: Link[]; parent?: Ie;
}
interface Link { name: string; a: Ie; ai: string; b: Ie; bi: string; }

const xe = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ascii = (s: string) => stripDia(String(s ?? "")).replace(/[^\x20-\x7E]/g, "?");
/** Část cesty CAEX: při znacích @ . : / v hranatých závorkách, „[“ a „]“ escapované (AR APC 5.2.8). */
export const amlPathPart = (s: string) => /[@.:/[\]]/.test(s) ? "[" + s.replace(/\[/g, "\\[").replace(/\]/g, "\\]") + "]" : s;

const val = (name: string, value: unknown, type = "xs:string", sub = ""): Attr =>
  ({ name, xml: '<Attribute Name="' + xe(name) + '" AttributeDataType="' + type + '"><Value>' + xe(value) + "</Value>" + sub + "</Attribute>" });
/** Označení dle IEC 81346 s RefSemantic, jak ho předepisuje AR APC 5.1.5 (TwinCAT 3 ho tak exportuje). */
const IEC_SEM: Record<string, string> = {
  "ProductDesignation IEC": "IEC 81346-1:2009-07#5.4 - Product-oriented structure",
  "LocationIdentifier IEC": "IEC 81346-1:2009-07#5.5 - Location-oriented structure",
};
const iec = (name: string, value: string): Attr => val(name, value, "xs:string", '<RefSemantic CorrespondingAttributePath="' + IEC_SEM[name] + '" />');
/** Vícejazyčný atribut (BPR Multilingual expressions): výchozí hodnota + podatributy „aml-lang=…“. */
function ml(name: string, def: string, per: Partial<Record<Lang, string>>): Attr {
  const sub = (Object.keys(per) as Lang[]).filter(l => per[l]).map(l =>
    '<Attribute Name="aml-lang=' + AML_LANG[l] + '" AttributeDataType="xs:string"><Value>' + xe(per[l]) + "</Value></Attribute>").join("");
  return { name, xml: '<Attribute Name="' + xe(name) + '" AttributeDataType="xs:string"><Value>' + xe(def) + "</Value>" + sub + "</Attribute>" };
}
const LANG_LIST = () => Object.keys(LANGS) as Lang[];
/** Text ve všech jazycích UI (technické texty se překládají, obsah projektu ne). */
const perLang = (fn: () => string): Partial<Record<Lang, string>> => Object.fromEntries(LANG_LIST().map(l => [l, withLang(l, fn)]));

function ie(parent: Ie | undefined, name: string, id: string, role: string, attrs: Attr[] = []): Ie {
  const n: Ie = { name, id, role, support: [], attrs, ifaces: [], kids: [], links: [], parent };
  if (parent) parent.kids.push(n);
  return n;
}
function ancestors(n: Ie): Ie[] { const out: Ie[] = []; for (let x: Ie | undefined = n; x; x = x.parent) out.push(x); return out; }
/** Nejbližší společný rodič dvou prvků (sám prvek, když jsou obě strany na něm). */
function lca(a: Ie, b: Ie): Ie {
  const as = new Set(ancestors(a));
  for (const x of ancestors(b)) if (as.has(x)) return x;
  throw new Error("AML: no common parent");
}
function link(name: string, a: Ie, ai: string, b: Ie, bi: string): void { lca(a, b).links.push({ name, a, ai, b, bi }); }

const ioType = (d: Dir) => (d === "DI" || d === "AI" ? "Input" : "Output");
const isAnalog = (d: Dir) => d === "AI" || d === "AO";
/** Konfigurační projekt (20161) a ID stanice (20408) nesmí obsahovat tečku (TechTip Overview of the PLC properties). */
const noDot = (s: string) => s.replace(/\./g, "_");

/**
 * Objednací číslo do TypeIdentifier. Siemens (6ES7 / 6AG1 / 6GKx) s mezerou po 4. znaku — tak je
 * zapisuje TIA Portal (V17–V21) i kmenová data EPLAN (Siemens 109766653); katalog PLCdesk nese
 * tvar bez mezery, převádí se až tady. Ostatní výrobci beze změny.
 */
export function amlOrderNumber(code: string): string {
  const s = ascii(code).trim();
  const m = s.match(/^(6ES7|6AG1|6GK\d)\s*(\d{3}-.+)$/);
  return m ? m[1] + " " + m[2] : s;
}
/**
 * LogicalAddress tagu bez směru (AR APC 1.4.0, 5.2.1): %I0.0 → 0.0, %IW64 → W64, %QW80 → W80,
 * CODESYS %IX0.0 → 0.0; TwinCAT %I* (linkování) → bez adresy; Mitsubishi X10 / Y10 beze změny
 * (písmeno je součást operandu). Směr nese IoType.
 */
export function amlLogicalAddress(plat: PlatformKey, e: IoEntry, prj: Project): string {
  return amlAddress(addrFor(plat, e, prj));
}
/** LogicalAddress z adresy v notaci platformy (viz `amlLogicalAddress`). */
export function amlAddress(a: string): string {
  if (/^%[IQ]\*$/.test(a)) return "";
  const m = a.match(/^%[IQ]([XBWD]?)(\d+(?:\.\d+)?)$/);
  return m ? (m[1] === "X" ? "" : m[1]) + m[2] : a;
}
/**
 * Rodina stanice pro TypeIdentifier Device / Rack (AR APC 5.1.4 „family identifier“; hodnoty jako
 * TIA Portal: System:Device.S71200, System:Rack.S71200 …). Jiní výrobci a neznámé CPU: Generic.
 */
export function stationFamily(plat: string, cpuOrder: string | undefined): string {
  if (plat !== "siemens") return "Generic";
  const s = String(cpuOrder || "").replace(/\s+/g, "").toUpperCase();
  if (/^6ES721/.test(s)) return "S71200";
  if (/^6ES751[02]-1[DS]/.test(s)) return "ET200SP";   // CPU 1510SP / 1512SP (F)
  if (/^6ES75/.test(s)) return "S71500";
  return "Generic";
}
function byteBit(a: string): { byte: number; bit: number } | null {
  const m = String(a || "").match(/^%[IQ]W?(\d+)(?:\.(\d+))?$/);
  return m ? { byte: +m[1], bit: +(m[2] || 0) } : null;
}

/** Popisek signálu v aktuálním jazyce (běh / povel chod …). */
function sigLabel(d: Device, sig: string): string { return (devSignals(d).find(s => s[0] === sig) || [])[2] || ""; }
/** Funkční text kanálu: -M1 + popis zařízení (obsah projektu, nepřekládá se) + popisek signálu (překládá se). */
function fnText(d: Device | undefined, e: IoEntry): string {
  if (!d) return e.cmt || "";
  return ["-" + devRef(d), [d.desc, sigLabel(d, e.sig)].filter(Boolean).join(" – ")].filter(Boolean).join(" ");
}

interface Built { root: Ie; name: string; projectId: string; }

/** Adresa modulu (AR APC Address, OrderedListType): položka na směr — StartAddress (bajt), Length (bity), IoType. */
function addressAttr(m: HwModule): Attr {
  let n = 0, items = "";
  for (const d of HW_DIRS) {
    const chs = m.channels.filter(k => k.dir === d);
    if (!chs.length) continue;
    const bb = byteBit(chs[0].addr) || { byte: 0, bit: 0 };
    const len = isAnalog(d) ? chs.length * 16 : Math.ceil(chs.length / 8) * 8;
    items += '<Attribute Name="' + (++n) + '">' + val("StartAddress", bb.byte, "xs:int").xml + val("Length", len, "xs:int").xml
      + val("IoType", ioType(d)).xml + val("BitOffset", isAnalog(d) ? 0 : bb.bit, "xs:int").xml + "</Attribute>";
  }
  return { name: "Address", xml: '<Attribute Name="Address"><RefSemantic CorrespondingAttributePath="OrderedListType" />' + items + "</Attribute>" };
}
/** Název vestavěného I/O podmodulu jako v TIA Portal („DI 14/DQ 10“, „AI 2“). */
const builtinName = (m: HwModule) => HW_DIRS.filter(d => (m.ch[d] || 0) > 0).map(d => (d === "DO" ? "DQ" : d === "AO" ? "AQ" : d) + " " + m.ch[d]).join("/");

function build(prj: Project, opts: EplanAmlOptions): Built {
  /* platforma hardwaru (kusovník) = sestava, adresy, rodina stanice */
  const plat = bomPlatform(prj);
  const bomPlat = plat;
  const L = hwLayout(prj, plat);
  const lines = buildBom(prj).lines;
  const lineOf = (m: HwModule) => lines.find(l => l.id === hwLineId(m.bomTag, m.cat));
  const cpuLine = lines.find(l => l.tag === "-A1");
  const rawName = ascii(prj.meta.name || "PLCdesk").trim() || "PLCdesk";
  /* konfigurační projekt EPLAN (20161) = název AutomationProject — bez tečky */
  const name = noDot(rawName);
  /* GUID projektu; bez něj deterministický zástupce z názvu (validateEplan hlásí) */
  const pg = isGuid(prj.guid) ? prj.guid : derivedGuid("plcdesk-unsaved", rawName);
  const G = (role: string) => derivedGuid(pg, role);
  const typeId = (l: BomLine | undefined) => (l?.orderCode ? "OrderNumber:" + amlOrderNumber(l.orderCode) : "");
  const maker = cpuLine?.brand || PLAT[bomPlat].name.split(" ")[0];
  const family = stationFamily(bomPlat, cpuLine?.orderCode);
  /* Siemens: karta → BuiltIn podmodul s adresou a kanály (TIA Portal V18/V21, S7-1500 i ET 200SP);
     ostatní ploše — karta nese adresu a kanály přímo (EPLAN 2.7.3, TwinCAT 3) */
  const hierarchical = bomPlat === "siemens";
  const cur = getLang();

  const project = ie(undefined, name, pg, ROLE.AutomationProject, [
    val("ProjectManufacturer", "PLCdesk"), val("ProjectSign", name), val("ProjectRevision", "0.1"),
    val("ProjectInformation", tr("Export PLCdesk {date} — {state}", { date: today(true), state: tr(EPLAN_VERIFIED) })),
  ]);
  const network = opts.network !== false;
  const subnetName = "PN_IE_1";
  const subnet = network ? ie(project, subnetName, G("subnet:" + subnetName), ROLE.Subnet, [val("Type", SUBNET_TYPE.ethernet)]) : undefined;
  if (subnet) subnet.ifaces.push({ name: LEP.subnet, id: derivedGuid(subnet.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });

  /* stanice CPU (ID stanice EPLAN 20408 = název Device, bez tečky); TypeIdentifier = rodina */
  const station = ie(project, noDot(ascii(PLAT[bomPlat].name) + " -A1"), G("station:1"), ROLE.Device, [
    val("TypeIdentifier", "System:Device." + family),
    ml("Comment", tr("Stanice PLC navržená v PLCdesk (návrh k revizi)"), perLang(() => tr("Stanice PLC navržená v PLCdesk (návrh k revizi)"))),
    val("Manufacturer", maker),
  ]);
  const rack = ie(station, "Rack_0", G("rack:0"), ROLE.DeviceItem, [
    val("TypeName", "Rack"), val("PositionNumber", 0, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
    val("TypeIdentifier", "System:Rack." + family), iec("LocationIdentifier IEC", "+1"),
  ]);
  const cpu = ie(rack, "-A1", G("cpu:1"), ROLE.DeviceItem, [
    val("TypeName", PLAT[bomPlat].cpu), val("DeviceItemType", "CPU"), val("PositionNumber", L.cpu.slot, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
    ...(typeId(cpuLine) ? [val("TypeIdentifier", typeId(cpuLine))] : []), val("Manufacturer", maker),
    val("Comment", [cpuLine?.type, cpuLine?.desc].filter(Boolean).join(" — ")), iec("ProductDesignation IEC", "-A1"), iec("LocationIdentifier IEC", "+1"),
  ]);
  let ioSystem: Ie | undefined;
  if (network && subnet) {
    const pn = ie(cpu, "PROFINET_interface_1", G("cpu:1/if:X1"), ROLE.CommunicationInterface, [
      val("TypeName", "PROFINET interface"), val("PositionNumber", 32768, "xs:int"), val("BuiltIn", "true", "xs:boolean"), val("Label", "X1"),
    ]);
    pn.ifaces.push({ name: LEP.iface, id: derivedGuid(pn.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
    const node = ie(pn, "E1", G("cpu:1/if:X1/node"), ROLE.Node, [
      val("Type", SUBNET_TYPE.ethernet), val("NetworkAddress", "192.168.0.1"),
      val("SubnetMask", "255.255.255.0"), val("IpProtocolSelection", "Project"), val("ProfinetDeviceName", "plc-1"),
    ]);
    node.support.push(ROLE.NodeEthernet);
    node.ifaces.push({ name: LEP.node, id: derivedGuid(node.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
    ioSystem = ie(pn, "PROFINET_IO_system", G("cpu:1/if:X1/iosystem:100"), ROLE.IoSystem, [val("Number", 100, "xs:int")]);
    ioSystem.ifaces.push({ name: LEP.ioSystem, id: derivedGuid(ioSystem.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
    const port = ie(pn, "Port_1", G("cpu:1/if:X1/port:1"), ROLE.CommunicationPort, [
      val("TypeName", "Port"), val("PositionNumber", 32769, "xs:int"), val("BuiltIn", "true", "xs:boolean"), val("Label", "P1 R"),
    ]);
    port.ifaces.push({ name: "CommunicationPortInterface", id: derivedGuid(port.id, "CommunicationPortInterface"), cls: IFACE.CommunicationPortInterface, attrs: [] });
    link("Link_" + subnetName + "_E1", node, LEP.node, subnet, LEP.subnet);
  }
  const table = ie(cpu, "PLCdesk", G("tagtable:PLCdesk"), ROLE.TagTable, [val("AssignToDefault", "false", "xs:boolean")]);

  /* symbolické adresy: tag na každý signál s kanálem (ID = GUID signálu), vícejazyčný funkční text */
  const tagOwner = new Map<IoEntry, { el: Ie; name: string }>();
  const udtOf = new Map<number, Ie>();
  for (const m of L.modules) for (const k of m.channels) {
    const e = k.io;
    if (!e) continue;
    const d = devById(prj, e.devId);
    const dg = isGuid(e.guid) ? e.guid : derivedGuid(pg, "io-unsaved:" + e.key);
    const def = [d ? "-" + devRef(d) : "", e.cmt || d?.desc || ""].filter(Boolean).join(" ");
    const per = perLang(() => fnText(d, e));
    per[cur] = def;    // aktuální jazyk = komentář z I/O tabulky (úpravy uživatele)
    const la = amlLogicalAddress(plat, e, prj);
    const tag: Ei = {
      name: e.tag, id: dg, cls: IFACE.Tag, attrs: [
        val("DataType", dtFor(e), "xs:string", val("Customized", "false", "xs:boolean").xml),
        val("IoType", ioType(e.dir)), ...(la ? [val("LogicalAddress", la)] : []), ml("Comment", def, per),
      ],
    };
    if (opts.udt && d) {
      let ct = udtOf.get(d.id);
      if (!ct) {
        ct = ie(table, d.name, derivedGuid(isGuid(d.guid) ? d.guid : derivedGuid(pg, "dev-unsaved:" + d.id), "udt"), ROLE.ComplexTag, [
          val("DataType", "UDT_" + d.cls), val("Comment", d.desc || ""),
        ]);
        udtOf.set(d.id, ct);
      }
      tag.name = e.sig;
      ct.ifaces.push(tag);
      tagOwner.set(e, { el: ct, name: e.sig });
    } else {
      table.ifaces.push(tag);
      tagOwner.set(e, { el: table, name: e.tag });
    }
  }

  /* kanály modulu (všechny podle katalogu, neobsazené bez tagu); ID kanálu poziční z GUID modulu */
  const channels = (holder: Ie, m: HwModule, mid: string) => {
    for (const k of m.channels) {
      const chName = "Channel_" + k.dir + "_" + k.no;
      holder.ifaces.push({
        name: chName, id: derivedGuid(mid, "ch:" + k.dir + ":" + k.no), cls: IFACE.Channel, attrs: [
          val("Type", isAnalog(k.dir) ? "Analog" : "Digital"), val("IoType", ioType(k.dir)), val("Number", k.no, "xs:int"), val("Length", isAnalog(k.dir) ? 16 : 1, "xs:int"),
        ],
      });
      const t = k.io && tagOwner.get(k.io);
      if (k.io && t) link("Link_" + k.io.tag, holder, chName, t.el, t.name);
    }
  };
  const xOf = (m: HwModule) => L.groups.map((g, i) => (g.hw === m ? "-X" + (i + 1) : "")).filter(Boolean).join(", ");
  const moduleId = (m: HwModule) => isGuid(m.guid) ? m.guid : isGuid(prj.moduleGuids?.[m.key]) ? prj.moduleGuids![m.key] : derivedGuid(pg, "card-unsaved:" + m.key);

  /* vestavěné I/O CPU: Siemens BuiltIn podmodul CPU (PositionNumber 1, Address po směrech; TIA Portal V17
     S7-1200), ostatní ploše jako karty — Address a kanály přímo na CPU (EPLAN 2.7.3) */
  for (const m of L.modules.filter(x => x.builtin)) {
    const bid = derivedGuid(G("cpu:1"), "builtin:1");
    if (hierarchical) {
      const bi = ie(cpu, builtinName(m), bid, ROLE.DeviceItem, [
        val("PositionNumber", 1, "xs:int"), val("BuiltIn", "true", "xs:boolean"), addressAttr(m),
      ]);
      channels(bi, m, bid);
    } else {
      cpu.attrs.push(addressAttr(m));
      channels(cpu, m, bid);
    }
  }

  /* I/O karta v racku: Siemens karta → BuiltIn podmodul s adresou a kanály (TIA V18/V21), ostatní ploše */
  const card = (parent: Ie, m: HwModule, loc: string) => {
    const id = moduleId(m);
    const ln = lineOf(m);
    const x = xOf(m);
    const comment = ml("Comment", m.dt + (x ? " — " + tr("svorkovnice {x}", { x }) : ""), perLang(() => m.dt + (x ? " — " + tr("svorkovnice {x}", { x }) : "")));
    const el = ie(parent, m.dt, id, ROLE.DeviceItem, [
      val("TypeName", ln?.type || hwTypeText(m)),
      val("PositionNumber", m.slot, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
      ...(typeId(ln) ? [val("TypeIdentifier", typeId(ln))] : []), val("Manufacturer", ln?.brand || ""),
      comment, iec("ProductDesignation IEC", m.dt), iec("LocationIdentifier IEC", loc),
      ...(hierarchical ? [] : [addressAttr(m)]),
    ]);
    /* BuiltIn podmodul: identita = GUID karty + PositionNumber (AR APC 5.1.5) */
    const io = hierarchical
      ? ie(el, m.dt, derivedGuid(id, "builtin:1"), ROLE.DeviceItem, [val("PositionNumber", 1, "xs:int"), val("BuiltIn", "true", "xs:boolean"), addressAttr(m)])
      : el;
    channels(io, m, id);
  };
  for (const m of L.stations[0].modules) if (m.kind === "io" && !m.builtin) card(rack, m, "+1");

  /* vzdálené stanice: Device → Rack_0 → hlava (HeadModule, slot 0) + karty od slotu 1 (+ server modul);
     Siemens ET 200SP: rozhraní PROFINET na BusAdapteru (slot 127) jako v TIA Portal V18 */
  for (const s of L.stations.filter(x => x.remote)) {
    const h = s.head;
    const hid = moduleId(h);
    const hl = lineOf(h);
    const loc = "+" + (s.no + 1);
    const fam = plat === "siemens" ? s.family : "Generic";
    const label = ascii((h.opt?.series || [])[0] || hwTypeText(h)).replace(/\s+IM.*$/, "");
    const dev = ie(project, noDot(label + " " + h.dt), derivedGuid(hid, "station"), ROLE.Device, [
      val("TypeIdentifier", "System:Device." + fam),
      ml("Comment", tr("Vzdálená stanice {dt} navržená v PLCdesk (návrh k revizi)", { dt: h.dt }), perLang(() => tr("Vzdálená stanice {dt} navržená v PLCdesk (návrh k revizi)", { dt: h.dt }))),
      val("Manufacturer", hl?.brand || maker),
    ]);
    const rk = ie(dev, "Rack_0", derivedGuid(hid, "rack:0"), ROLE.DeviceItem, [
      val("TypeName", "Rack"), val("PositionNumber", 0, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
      val("TypeIdentifier", "System:Rack." + fam), iec("LocationIdentifier IEC", loc),
    ]);
    const head = ie(rk, h.dt, hid, ROLE.DeviceItem, [
      val("TypeName", hl?.type || hwTypeText(h)), val("DeviceItemType", "HeadModule"), val("PositionNumber", 0, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
      ...(typeId(hl) ? [val("TypeIdentifier", typeId(hl))] : []), val("Manufacturer", hl?.brand || ""),
      val("Comment", [hl?.type, s.net].filter(Boolean).join(" — ")), iec("ProductDesignation IEC", h.dt), iec("LocationIdentifier IEC", loc),
    ]);
    if (plat === "siemens") ie(head, h.dt, derivedGuid(hid, "builtin:0"), ROLE.DeviceItem, [val("PositionNumber", 0, "xs:int"), val("BuiltIn", "true", "xs:boolean")]);
    /* síť: IP sítě (PROFINET, EtherNet/IP, Modbus TCP) = uzel v PN_IE_1; EtherCAT bez uzlu (doplní se v EPLAN) */
    const ipNet = network && subnet && s.net && s.net !== "EtherCAT";
    const ba = s.modules.find(m => m.kind === "acc" && m.cat === "plc_busadapter");
    let ifParent: Ie = head;
    if (ba) {
      const bl = lineOf(ba) || lines.find(l => l.cat === "plc_busadapter");
      ifParent = ie(head, ascii(ba.opt?.typical ? tr(ba.opt.typical).split(" – ")[0] : "BusAdapter"), derivedGuid(hid, "acc:" + ba.slot), ROLE.DeviceItem, [
        val("TypeName", ascii(ba.opt?.typical ? tr(ba.opt.typical).split(" – ")[0] : "BusAdapter")), val("PositionNumber", ba.slot, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
        ...(ba.opt?.orderCode ? [val("TypeIdentifier", "OrderNumber:" + amlOrderNumber(ba.opt.orderCode))] : typeId(bl) ? [val("TypeIdentifier", typeId(bl))] : []),
      ]);
    }
    if (ipNet && subnet) {
      const ip = "192.168.0." + (10 + s.no);
      const pn = ie(ifParent, s.net === "PROFINET" ? "PROFINET_interface" : "Ethernet_interface", derivedGuid(hid, "if:X1"), ROLE.CommunicationInterface, [
        val("TypeName", s.net + " interface"), val("PositionNumber", 1, "xs:int"), val("BuiltIn", "true", "xs:boolean"), val("Label", "X1"),
      ]);
      pn.ifaces.push({ name: LEP.iface, id: derivedGuid(pn.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
      const node = ie(pn, "IE1", derivedGuid(hid, "if:X1/node"), ROLE.Node, [
        val("Type", SUBNET_TYPE.ethernet), val("NetworkAddress", ip), val("SubnetMask", "255.255.255.0"), val("IpProtocolSelection", "Project"),
        val("ProfinetDeviceName", ascii(h.dt.replace(/^-/, "") + "-io").toLowerCase()),
      ]);
      node.support.push(ROLE.NodeEthernet);
      node.ifaces.push({ name: LEP.node, id: derivedGuid(node.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
      for (const p of [1, 2]) {
        const port = ie(pn, "Port_" + p, derivedGuid(hid, "if:X1/port:" + p), ROLE.CommunicationPort, [
          val("TypeName", "Port"), val("PositionNumber", p, "xs:int"), val("BuiltIn", "true", "xs:boolean"), val("Label", "P" + p + " R"),
        ]);
        port.ifaces.push({ name: "CommunicationPortInterface", id: derivedGuid(port.id, "CommunicationPortInterface"), cls: IFACE.CommunicationPortInterface, attrs: [] });
      }
      link("Link_" + subnetName + "_" + noDot(h.dt.replace(/^-/, "")), node, LEP.node, subnet, LEP.subnet);
      /* IO zařízení PROFINET v IO systému CPU (TIA V18: LogicalEndPoint_Interface ↔ LogicalEndPoint_IoSystem) */
      if (s.net === "PROFINET" && ioSystem) link("Link_IoSystem_" + noDot(h.dt.replace(/^-/, "")), pn, LEP.iface, ioSystem, LEP.ioSystem);
    }
    for (const m of s.modules) {
      if (m.kind === "io") card(rk, m, loc);
      else if (m.kind === "acc" && m.cat === "plc_server") {
        const sid = derivedGuid(hid, "acc:" + m.slot);
        const name = ascii(m.opt?.typical ? tr(m.opt.typical).split(" – ")[0] : "Server module");
        const el = ie(rk, name, sid, ROLE.DeviceItem, [
          val("TypeName", name), val("PositionNumber", m.slot, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
          ...(m.opt?.orderCode ? [val("TypeIdentifier", "OrderNumber:" + amlOrderNumber(m.opt.orderCode))] : []),
        ]);
        if (plat === "siemens") ie(el, name, derivedGuid(sid, "builtin:1"), ROLE.DeviceItem, [val("PositionNumber", 1, "xs:int"), val("BuiltIn", "true", "xs:boolean")]);
      }
    }
  }
  /* servoosy: servoměnič jen jako uzel sítě (Device → Rack_0 → pohon; IP sítě s uzlem v PN_IE_1, PROFINET
     i v IO systému CPU; EtherCAT bez uzlu jako vzdálené stanice) — parametry pohonu (ARE Drive) mimo rozsah */
  const dia = axisDialect(prj, plat), net = dia ? AXIS_NET[dia] : "";
  prj.devices.filter(x => x.cls === "Axis").forEach((d, i) => {
    const dt = "-" + devRef(d);
    const ln = lines.find(l => l.id === dt + ":servo_drive");
    const did = derivedGuid(isGuid(d.guid) ? d.guid : derivedGuid(pg, "dev-unsaved:" + d.id), "drive");
    const label = ascii(ln?.type ? tr(ln.type).split(" – ")[0] : "Servo drive");
    const cmt = (s: () => string) => ml("Comment", s(), perLang(s));
    const dev = ie(project, noDot(label + " " + dt), did, ROLE.Device, [
      val("TypeIdentifier", "System:Device.Generic"),
      cmt(() => tr("Servoměnič osy {dev} navržený v PLCdesk (uzel sítě, návrh k revizi)", { dev: d.name })),
      val("Manufacturer", ln?.brand || ""),
    ]);
    const rk = ie(dev, "Rack_0", derivedGuid(did, "rack:0"), ROLE.DeviceItem, [
      val("TypeName", "Rack"), val("PositionNumber", 0, "xs:int"), val("BuiltIn", "false", "xs:boolean"), val("TypeIdentifier", "System:Rack.Generic"), iec("LocationIdentifier IEC", "+1"),
    ]);
    const head = ie(rk, dt, derivedGuid(did, "item"), ROLE.DeviceItem, [
      val("TypeName", ln?.type ? ascii(tr(ln.type).split(" – ")[0]) : "Servo drive"), val("DeviceItemType", "HeadModule"), val("PositionNumber", 0, "xs:int"), val("BuiltIn", "false", "xs:boolean"),
      ...(typeId(ln) ? [val("TypeIdentifier", typeId(ln))] : []), val("Manufacturer", ln?.brand || ""),
      val("Comment", ascii(axisObjName(d) + " — " + net)), iec("ProductDesignation IEC", dt), iec("LocationIdentifier IEC", "+1"),
    ]);
    const ipNet = network && subnet && (net === "PROFINET" || net.startsWith("EtherNet/IP"));
    if (ipNet && subnet) {
      const pn = ie(head, net === "PROFINET" ? "PROFINET_interface" : "Ethernet_interface", derivedGuid(did, "if:X1"), ROLE.CommunicationInterface, [
        val("TypeName", (net === "PROFINET" ? "PROFINET" : "EtherNet/IP") + " interface"), val("PositionNumber", 1, "xs:int"), val("BuiltIn", "true", "xs:boolean"), val("Label", "X1"),
      ]);
      pn.ifaces.push({ name: LEP.iface, id: derivedGuid(pn.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
      const node = ie(pn, "IE1", derivedGuid(did, "if:X1/node"), ROLE.Node, [
        val("Type", SUBNET_TYPE.ethernet), val("NetworkAddress", "192.168.0." + (100 + i)), val("SubnetMask", "255.255.255.0"), val("IpProtocolSelection", "Project"),
        val("ProfinetDeviceName", ascii(dt.replace(/^-/, "") + "-drive").toLowerCase()),
      ]);
      node.support.push(ROLE.NodeEthernet);
      node.ifaces.push({ name: LEP.node, id: derivedGuid(node.id, "LogicalEndPoint"), cls: IFACE.LogicalEndPoint, attrs: [] });
      link("Link_" + subnetName + "_" + noDot(dt.replace(/^-/, "")), node, LEP.node, subnet, LEP.subnet);
      if (net === "PROFINET" && ioSystem) link("Link_IoSystem_" + noDot(dt.replace(/^-/, "")), pn, LEP.iface, ioSystem, LEP.ioSystem);
    }
  });
  return { root: project, name, projectId: pg };
}

/** Pořadí podle XSD CAEX 2.15: Attribute, ExternalInterface, InternalElement, SupportedRoleClass, InternalLink. */
function render(n: Ie): string {
  return '<InternalElement Name="' + xe(n.name) + '" ID="' + n.id + '">'
    + n.attrs.map(a => a.xml).join("")
    + n.ifaces.map(i => '<ExternalInterface Name="' + xe(i.name) + '" ID="' + i.id + '" RefBaseClassPath="' + i.cls + '">' + i.attrs.map(a => a.xml).join("") + "</ExternalInterface>").join("")
    + n.kids.map(render).join("")
    + [n.role, ...n.support].map(s => '<SupportedRoleClass RefRoleClassPath="' + s + '" />').join("")
    + n.links.map(l => '<InternalLink Name="' + xe(l.name) + '" RefPartnerSideA="' + l.a.id + ":" + amlPathPart(l.ai) + '" RefPartnerSideB="' + l.b.id + ":" + amlPathPart(l.bi) + '" />').join("")
    + "</InternalElement>";
}

/** AutomationML AR APC 1.4.0 (CAEX 2.15): stanice, rack, CPU s rozhraním PROFINET, karty, kanály, symbolické adresy. */
export function genEplanAml(prj: Project, opts: EplanAmlOptions = {}): string {
  const { root, name, projectId } = build(prj, opts);
  const now = (opts.now || new Date()).toISOString().slice(0, 19);
  /* jazyk textů bez značky aml-lang (výchozí hodnota Comment) — čte ho skript EPLAN (parametr LANGUAGE) */
  return '<?xml version="1.0" encoding="utf-8"?>\r\n'
    + "<!-- PLCdesk language=" + (AML_LANG[getLang()] || "en-US").replace("-", "_") + " -->\r\n"
    + '<CAEXFile FileName="' + xe(eplanAmlName(prj)) + '" SchemaVersion="2.15" xsi:noNamespaceSchemaLocation="CAEX_ClassModel_V2.15.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '<AdditionalInformation AutomationMLVersion="2.0" />'
    + '<AdditionalInformation DocumentVersions="Recommendations"><Document DocumentIdentifier="AR APC" Version="' + ARAPC_VERSION + '" /></AdditionalInformation>'
    + "<AdditionalInformation><WriterHeader><WriterName>PLCdesk</WriterName><WriterID>" + derivedGuid("plcdesk", "writer") + "</WriterID><WriterVendor>PLCdesk</WriterVendor>"
    + "<WriterVendorURL>https://plcdesk.app</WriterVendorURL><WriterVersion>0.2</WriterVersion><WriterRelease>0.2</WriterRelease>"
    + "<LastWritingDateTime>" + now + "</LastWritingDateTime><WriterProjectTitle>" + xe(name) + "</WriterProjectTitle><WriterProjectID>" + projectId + "</WriterProjectID></WriterHeader></AdditionalInformation>"
    + '<InstanceHierarchy Name="' + xe(name) + '"><Version>0.2</Version>' + render(root) + "</InstanceHierarchy>"
    + AML_LIBS + "</CAEXFile>\r\n";
}

/* ================================================================ validace (§13) */

interface XNode { tag: string; at: Record<string, string>; kids: XNode[]; text: string; parent?: XNode; }
const unent = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e]);

function parseXml(src: string): XNode | string {
  const root: XNode = { tag: "#doc", at: {}, kids: [], text: "" };
  let cur = root;
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/([^\s>]+)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) { if (cur.tag !== m[1]) return "</" + m[1] + ">"; cur = cur.parent!; }
    else if (m[2] !== undefined) {
      const n: XNode = { tag: m[2], at: {}, kids: [], text: "", parent: cur };
      for (const a of (m[3] || "").matchAll(/([^\s=/>]+)\s*=\s*"([^"]*)"/g)) n.at[a[1]] = unent(a[2]);
      cur.kids.push(n);
      if (!m[4]) cur = n;
    } else if (m[5] !== undefined) cur.text += unent(m[5]);
  }
  return cur === root ? root : "<" + cur.tag + ">";
}
const kidsOf = (n: XNode, tag: string) => n.kids.filter(k => k.tag === tag);
const attrsOf = (n: XNode): Map<string, string> => new Map(kidsOf(n, "Attribute").map(a => [a.at.Name, (kidsOf(a, "Value")[0]?.text ?? "").trim()]));
/** Rozdělí „ID:rozhraní“ podle AR APC 5.2.8 (části v [] s escapovanými \[ \]). */
function splitRef(s: string): [string, string] | null {
  const parts: string[] = [];
  let i = 0;
  while (i <= s.length) {
    if (s[i] === "[") {
      let j = i + 1, out = "";
      for (; j < s.length && s[j] !== "]"; j++) { if (s[j] === "\\" && (s[j + 1] === "[" || s[j + 1] === "]")) { out += s[++j]; } else out += s[j]; }
      if (j >= s.length) return null;
      parts.push(out); i = j + 1;
      if (i < s.length && s[i] !== ":") return null;
      i++;
    } else {
      const j = s.indexOf(":", i);
      parts.push(j < 0 ? s.slice(i) : s.slice(i, j));
      if (j < 0) break;
      i = j + 1;
    }
  }
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

/** Prvek instanční hierarchie AML ve zjednodušené podobě (porovnání se vzorky, budoucí import). */
export interface AmlElement {
  name: string; id: string; roles: string[]; depth: number; parent: AmlElement | null;
  /** atributy: hodnota a názvy podatributů (aml-lang=…, položky Address …) */
  attrs: Record<string, { value: string; sub: string[] }>;
  ifaces: Array<{ name: string; id: string; cls: string; attrs: Record<string, string> }>;
  links: Array<{ name: string; a: string; b: string }>;
}
/** Strom InternalElementů (do hloubky, v pořadí souboru) — role ze SupportedRoleClass i RoleRequirements. */
export function amlStructure(xml: string): AmlElement[] {
  const doc = parseXml(xml.replace(/^﻿/, ""));
  if (typeof doc === "string") throw new Error("AML: not well-formed " + doc);
  const out: AmlElement[] = [];
  const walk = (n: XNode, depth: number, parent: AmlElement | null) => {
    for (const k of kidsOf(n, "InternalElement")) {
      const attrs: AmlElement["attrs"] = {};
      for (const a of kidsOf(k, "Attribute")) attrs[a.at.Name] = { value: (kidsOf(a, "Value")[0]?.text ?? "").trim(), sub: kidsOf(a, "Attribute").map(s => s.at.Name) };
      const el: AmlElement = {
        name: k.at.Name || "", id: k.at.ID || "", depth, parent,
        roles: [...kidsOf(k, "SupportedRoleClass").map(r => r.at.RefRoleClassPath || ""), ...kidsOf(k, "RoleRequirements").map(r => r.at.RefBaseRoleClassPath || "")].filter(Boolean),
        attrs,
        ifaces: kidsOf(k, "ExternalInterface").map(i => ({ name: i.at.Name || "", id: i.at.ID || "", cls: i.at.RefBaseClassPath || "", attrs: Object.fromEntries(attrsOf(i)) })),
        links: kidsOf(k, "InternalLink").map(l => ({ name: l.at.Name || "", a: l.at.RefPartnerSideA || "", b: l.at.RefPartnerSideB || "" })),
      };
      out.push(el);
      walk(k, depth + 1, el);
    }
  };
  for (const ih of kidsOf(kidsOf(doc, "CAEXFile")[0] || doc, "InstanceHierarchy")) walk(ih, 0, null);
  return out;
}

export interface ValidateAmlOptions {
  /**
   * Vlastní export (validateEplan): i odchylky od AR APC, které reálné exporty dělají (chybějící
   * „mandatory“ atribut, neznámá role, LogicalAddress se směrem, nestandardní DeviceItemType), jsou chyba.
   * Bez `strict` (cizí soubor) jsou to jen upozornění; chybou zůstává jen to, co soubor rozbíjí
   * (well-formed XML, ID, rozložitelné a existující odkazy, unikátnost).
   */
  strict?: boolean;
}

/** Kontrola hotového AML (CAEX 2.15 / AR APC) bez schématu: ID, odkazy, povinné atributy, unikátnost. */
export function validateAml(xml: string, opts: ValidateAmlOptions = {}): EplanIssue[] {
  const out: EplanIssue[] = [];
  const strict = !!opts.strict;
  const E = (where: string, msg: string) => out.push({ level: "error", where, msg });
  const W = (where: string, msg: string) => out.push({ level: "warn", where, msg });
  /* odchylka od AR APC: ve vlastním exportu chyba, v cizím souboru upozornění */
  const D = strict ? E : W;
  const doc = parseXml(xml.replace(/^﻿/, ""));
  if (typeof doc === "string") { E("XML", tr("AML není well-formed XML ({at}).", { at: doc })); return out; }
  const file = kidsOf(doc, "CAEXFile")[0];
  if (!file) { E("XML", tr("Chybí kořen CAEXFile.")); return out; }
  if (file.at.SchemaVersion !== "2.15") E("CAEXFile", tr("SchemaVersion musí být 2.15 (AutomationML Edition 1)."));
  const ihs = kidsOf(file, "InstanceHierarchy");
  if (!ihs.length) { E("CAEXFile", tr("Chybí InstanceHierarchy.")); return out; }
  const ids = new Map<string, XNode>();
  const ies: XNode[] = [];
  const walk = (n: XNode) => {
    for (const k of n.kids) {
      if (k.tag === "InternalElement" || k.tag === "ExternalInterface") {
        const id = k.at.ID || "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) E(k.at.Name || k.tag, tr("ID „{id}“ není GUID.", { id }));
        else if (ids.has(id.toLowerCase())) E(k.at.Name || k.tag, tr("Duplicitní ID {id}.", { id }));
        else ids.set(id.toLowerCase(), k);
        if (k.tag === "InternalElement") ies.push(k);
      }
      walk(k);
    }
  };
  ihs.forEach(walk);
  const knownRoles = new Set<string>(Object.values(ROLE));
  const knownIfaces = new Set<string>(Object.values(IFACE));
  /* role: SupportedRoleClass (exporty EPLAN / TIA / TwinCAT) i RoleRequirements (CAEX), první známá role AR APC */
  const rolesOf = (n: XNode) => [
    ...kidsOf(n, "SupportedRoleClass").map(k => k.at.RefRoleClassPath || ""),
    ...kidsOf(n, "RoleRequirements").map(k => k.at.RefBaseRoleClassPath || ""),
  ].filter(Boolean);
  const roleOf = (n: XNode) => { const r = rolesOf(n); return r.find(x => knownRoles.has(x) && x !== ROLE.NodeEthernet) || r[0] || ""; };
  const need = (n: XNode, key: string) => {
    const a = attrsOf(n);
    for (const r of REQUIRED[key] || []) if (!a.get(r)) D(n.at.Name || key, tr("Chybí povinný atribut {attr} ({cls}).", { attr: r, cls: key.split("/").pop() }));
  };
  const devNames = new Map<string, number>(), subnets = new Map<string, number>();
  for (const n of ies) {
    const role = roleOf(n);
    if (!role) D(n.at.Name || "?", tr("Prvek nemá roli (SupportedRoleClass)."));
    else if (!knownRoles.has(role)) D(n.at.Name || "?", tr("Neznámá role {role}.", { role }));
    need(n, role);
    if (role === ROLE.Device) devNames.set(n.at.Name, (devNames.get(n.at.Name) || 0) + 1);
    if (role === ROLE.Subnet) subnets.set(n.at.Name, (subnets.get(n.at.Name) || 0) + 1);
    const attrEls = kidsOf(n, "Attribute");
    const addr = attrEls.find(a => a.at.Name === "Address");
    if (addr) for (const it of kidsOf(addr, "Attribute")) if (!attrsOf(it).get("IoType")) D(n.at.Name, tr("Adresa karty bez IoType."));
    const dit = attrEls.find(a => a.at.Name === "DeviceItemType");
    if (dit) {
      const v = (kidsOf(dit, "Value")[0]?.text ?? "").trim();
      const custom = (kidsOf(kidsOf(dit, "Attribute").find(a => a.at.Name === "Customized") || dit, "Value")[0]?.text ?? "").trim() === "true";
      if (v && !custom && !(DEVICE_ITEM_TYPES as readonly string[]).includes(v))
        D(n.at.Name, tr("DeviceItemType „{v}“ není standardní hodnota (CPU, HeadModule, Accessory) ani Customized.", { v }));
    }
    for (const ei of kidsOf(n, "ExternalInterface")) {
      const cls = ei.at.RefBaseClassPath || "";
      if (!knownIfaces.has(cls)) D(ei.at.Name || "?", tr("Neznámá třída rozhraní {cls}.", { cls }));
      need(ei, cls);
      /* AR APC 1.4.0, 5.2.1: LogicalAddress bez směru (AR APC 1.0.0 ho připouštěl → u cizích jen upozornění) */
      const la = cls === IFACE.Tag ? attrsOf(ei).get("LogicalAddress") || "" : "";
      if (/^%|^[IQ](?:[XBWD]?\d|$)/.test(la)) D(ei.at.Name || "?", tr("LogicalAddress „{a}“ obsahuje směr — podle AR APC 1.4.0 jen adresa (směr nese IoType).", { a: la }));
    }
  }
  for (const [n, c] of devNames) if (c > 1) E(n, tr("Název stanice (Device) není v projektu unikátní."));
  for (const [n, c] of subnets) if (c > 1) E(n, tr("Název fyzické sítě není v projektu unikátní."));
  /* odkazy: obě strany existují, rozhraní je na daném prvku; link mimo nejbližšího společného rodiče
     jen upozornění (AR APC ho doporučuje, ale TIA Portal V18 dává linky kanál ↔ tag do AutomationProject) */
  const ieAnc = (n: XNode) => { const a: XNode[] = []; for (let x: XNode | undefined = n; x && x.tag !== "InstanceHierarchy"; x = x.parent) if (x.tag === "InternalElement") a.push(x); return a; };
  const links = [...ies.map(n => [n, kidsOf(n, "InternalLink")] as const), ...ihs.map(h => [h, kidsOf(h, "InternalLink")] as const)];
  for (const [n, ls] of links) for (const l of ls) {
    const side = (ref: string | undefined, s: string): XNode | null => {
      const p = splitRef(ref || "");
      if (!p) { E(l.at.Name || "InternalLink", tr("RefPartnerSide{s} „{ref}“ nelze rozložit.", { s, ref: ref || "" })); return null; }
      const el = ids.get(p[0].toLowerCase());
      if (!el || el.tag !== "InternalElement") { E(l.at.Name || "InternalLink", tr("RefPartnerSide{s}: prvek {id} neexistuje.", { s, id: p[0] })); return null; }
      if (!kidsOf(el, "ExternalInterface").some(x => x.at.Name === p[1])) { E(l.at.Name || "InternalLink", tr("RefPartnerSide{s}: rozhraní {iface} na prvku {el} neexistuje.", { s, iface: p[1], el: el.at.Name })); return null; }
      return el;
    };
    const a = side(l.at.RefPartnerSideA, "A"), b = side(l.at.RefPartnerSideB, "B");
    if (a && b) {
      const as = new Set(ieAnc(a));
      const common = ieAnc(b).find(x => as.has(x));
      if (common !== n) W(l.at.Name || "InternalLink", tr("InternalLink neleží v nejbližším společném rodiči ({el}).", { el: common?.at.Name || "—" }));
    }
  }
  /* UDT + symbolická adresa unikátní v rámci CPU (EPLAN 20618 + symbolická adresa) */
  for (const cpu of ies.filter(n => roleOf(n) === ROLE.DeviceItem && attrsOf(n).get("DeviceItemType") === "CPU")) {
    const seen = new Map<string, number>();
    const scan = (n: XNode, udt: string) => {
      for (const k of n.kids) {
        if (k.tag === "ExternalInterface" && k.at.RefBaseClassPath === IFACE.Tag) {
          const key = (udt ? udt + "." : "") + k.at.Name;
          seen.set(key.toUpperCase(), (seen.get(key.toUpperCase()) || 0) + 1);
        } else if (k.tag === "InternalElement") {
          const r = roleOf(k);
          if (r === ROLE.TagTable || r === ROLE.TagUserFolder) scan(k, "");
          else if (r === ROLE.ComplexTag) scan(k, (udt ? udt + "." : "") + k.at.Name);
        }
      }
    };
    scan(cpu, "");
    for (const [k, c] of seen) if (c > 1) E(cpu.at.Name + " / " + k, tr("UDT a symbolická adresa nejsou v CPU unikátní."));
  }
  return out;
}

/** Nálezy exportu do EPLAN: GUID v modelu (export je negeneruje) + kontrola vygenerovaného AML. */
export function validateEplan(prj: Project, opts: EplanAmlOptions = {}): EplanIssue[] {
  const out: EplanIssue[] = [];
  const W = (where: string, msg: string) => out.push({ level: "warn", where, msg });
  const hint = tr("GUID se přiděluje při vzniku objektu a ukládá s projektem — otevři a ulož projekt, ať se doplní (jinak druhý import do EPLAN objekty neaktualizuje, ale zduplikuje).");
  if (!isGuid(prj.guid)) W(tr("projekt"), tr("Projekt nemá GUID.") + " " + hint);
  const noDev = prj.devices.filter(d => !isGuid(d.guid)).map(d => d.name);
  if (noDev.length) W(noDev.slice(0, 5).join(", ") + (noDev.length > 5 ? " …" : ""), tr("Zařízení bez GUID: {n}.", { n: noDev.length }) + " " + hint);
  const noIo = prj.io.filter(e => !isGuid(e.guid)).map(e => e.tag);
  if (noIo.length) W(noIo.slice(0, 5).join(", ") + (noIo.length > 5 ? " …" : ""), tr("Signály bez GUID: {n}.", { n: noIo.length }) + " " + hint);
  const L = hwLayout(prj, bomPlatform(prj));
  const noMod = L.modules.filter(m => ((m.kind === "io" && !m.builtin) || m.kind === "head") && !isGuid(m.guid) && !isGuid(prj.moduleGuids?.[m.key])).map(m => m.dt);
  if (noMod.length) W(noMod.join(", "), tr("I/O karty bez GUID: {n}.", { n: noMod.length }) + " " + hint);
  for (const e of L.overflow) W(e.tag, tr("Signál nemá kanál (do sestavy se nevejde) — EPLAN ho nepřiřadí."));
  return [...out, ...validateAml(genEplanAml(prj, opts), { strict: true })];
}
