/**
 * PLCdesk — export do EPLAN Electric P8 (bez licence EPLAN, přes dokumentované importní cesty).
 *
 *   eplanAml(prj)          PLC, I/O karty, kanály a symbolické adresy ve formátu AutomationML
 *                          AR APC 1.4.0 (CAEX 2.15) — EPLAN: Import PLC dat („AutomationML AR APC“);
 *                          karty nesou označení dle IEC 81346 („ProductDesignation IEC“) a objednací
 *                          číslo z kusovníku („TypeIdentifier“ = „OrderNumber:…“)
 *   eplanDevicesCsv(prj)   seznam zařízení z kusovníku (označení, výrobce, typ, objednací číslo) —
 *                          EPLAN: Projektová data → Zařízení → Import (textový soubor, CSV Unicode)
 *   eplanTerminalsCsv(prj) svorky -X<n>:<k> s kartou, kanálem, adresou, tagem a vodičem
 *   eplanWiresCsv(prj)     vodiče -W<n><k> (zdroj → svorka) — podklad, EPLAN pro spoje nemá textový import
 *   eplanReadme(prj)       postup importu a stav ověření
 *   eplanFiles(prj)        všechny soubory (název → obsah)
 *
 * Označení se berou ze stejných pravidel jako výkresy (drawing.ts: svorkovnice X<modul>, vodiče
 * `wireNo` z model.ts: X1:1 → -W101, X2:1 → -W201 …) a kusovník (bom.ts: -A1 CPU, -A2 DI, -A3 DO,
 * -A4 AI, -A5 AO; víc karet téže řady = -A2.1, -A2.2 …). Stav ověření: `EPLAN_VERIFIED`.
 */
import { Project, IoModule, Dir, PLAT, PlatformKey, devById, modules, wireNo, addrFor, dtFor, stripDia } from "./model.js";
import { tr, N_, today } from "./i18n.js";
import { buildBom, bomPlatform, type BomLine } from "./bom.js";
import { registerDocProvider, type ProjectFile } from "./docs.js";
import { addSafetyRegistration } from "./safety.js";

export const EPLAN_VERIFIED = N_("neověřeno importem v EPLAN Electric P8 (licence EPLAN není k dispozici); AutomationML kontrolováno proti schématu CAEX 2.15 a knihovnám AR APC 1.4.0");
export const EPLAN_SOURCES = [
  "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2026/Content/htm/plcgui_k_amlbusdatenaustausch.htm",
  "https://www.eplan.help/techtipps/en-us/SPS/TechTip-PLC-data-exchange.pdf",
  "https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip",
  "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2.9/Content/htm/projectprocessinggui_h_betriebsmittelimportieren.htm",
  "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2.9/Content/htm/projectprocessinggui_d_bmdatenimport.htm",
];

/* ================================================================ označení */

const ascii = (s: string) => stripDia(String(s ?? "")).replace(/[^\x20-\x7E]/g, "?");
/** Řada karet v kusovníku podle směru (Unitronics: analogy v jednom kombinovaném modulu -A4). */
function bomTagOf(dir: Dir, plat: PlatformKey): string {
  return dir === "DI" ? "-A2" : dir === "DO" ? "-A3" : dir === "AI" ? "-A4" : plat === "unitronics" ? "-A4" : "-A5";
}

export interface EplanCard {
  /** Označení karty dle IEC 81346 (-A2 / -A2.1 …) a řádek kusovníku, ze kterého vychází. */
  dt: string; bomTag: string;
  mod: IoModule;
  /** Číslo svorkovnice X<n> (pořadí modulu jako ve výkresech). */
  xnum: number;
  position: number;
  line: BomLine | undefined;
}
export interface EplanTerminal {
  strip: string; no: number; dt: string;
  card: string; channel: number; dir: Dir;
  addr: string; tag: string; device: string; desc: string;
  wire: string;
}

/** I/O karty s označením (stejné pořadí jako výkresy a seznam svorek dokumentace). */
export function eplanCards(prj: Project): EplanCard[] {
  const plat = bomPlatform(prj);
  const lines = buildBom(prj).lines;
  const mods = modules(prj);
  const count: Record<string, number> = {};
  for (const m of mods) { const t = bomTagOf(m.dir, plat); count[t] = (count[t] || 0) + 1; }
  const seen: Record<string, number> = {};
  return mods.map((m, i) => {
    const bomTag = bomTagOf(m.dir, plat);
    const k = (seen[bomTag] = (seen[bomTag] || 0) + 1);
    return { dt: count[bomTag] > 1 ? bomTag + "." + k : bomTag, bomTag, mod: m, xnum: i + 1, position: i + 2, line: lines.find(l => l.tag === bomTag) };
  });
}

/** Svorky a vodiče podle výkresů: svorka X<n>:<k>, vodič `wireNo(n, k − 1)` (X1:1 → -W101, X2:1 → -W201 …). */
export function eplanTerminals(prj: Project, cards: EplanCard[] = eplanCards(prj)): EplanTerminal[] {
  const plat = prj.platforms[0] || "siemens";
  const out: EplanTerminal[] = [];
  for (const c of cards) c.mod.ch.forEach((e, i) => {
    const d = devById(prj, e.devId);
    out.push({
      strip: "-X" + c.xnum, no: i + 1, dt: "-X" + c.xnum + ":" + (i + 1), card: c.dt, channel: i, dir: c.mod.dir,
      addr: addrFor(plat, e), tag: e.tag, device: d ? "-" + d.name : "", desc: d?.desc || e.cmt || "", wire: wireNo(c.xnum, i),
    });
  });
  return out;
}

/* ================================================================ AutomationML AR APC */

const xe = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Deterministické ID (GUID) z klíče. */
function idOf(key: string): string {
  const h = (seed: number) => {
    let x = 0x811c9dc5 ^ seed;
    for (let i = 0; i < key.length; i++) { x ^= key.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return (x >>> 0).toString(16).padStart(8, "0");
  };
  const s = h(11) + h(12) + h(13) + h(14);
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-4" + s.slice(13, 16) + "-8" + s.slice(17, 20) + "-" + s.slice(20, 32);
}
/** Část cesty CAEX: při znacích @ . : / v hranatých závorkách, „[“ a „]“ escapované. */
const pathPart = (s: string) => /[@.:/[\]]/.test(s) ? "[" + s.replace(/\[/g, "\\[").replace(/\]/g, "\\]") + "]" : s;

const attr = (name: string, value: unknown, type = "xs:string", sub = "") =>
  '<Attribute Name="' + xe(name) + '" AttributeDataType="' + type + '"><Value>' + xe(value) + "</Value>" + sub + "</Attribute>";

/* Minimální výřez knihoven AR APC 1.4.0 (cesty tříd beze změny, aby je importér našel). */
const AML_LIBS = [
  '<InterfaceClassLib Name="AutomationMLInterfaceClassLib"><Version>2.2.2</Version>',
  '<InterfaceClass Name="AutomationMLBaseInterface">',
  '<InterfaceClass Name="ExternalDataConnector" RefBaseClassPath="AutomationMLBaseInterface"><Attribute Name="refURI" AttributeDataType="xs:anyURI" />',
  '<InterfaceClass Name="PLCopenXMLInterface" RefBaseClassPath="ExternalDataConnector">',
  '<InterfaceClass Name="VariableInterface" RefBaseClassPath="PLCopenXMLInterface" />',
  "</InterfaceClass></InterfaceClass>",
  '<InterfaceClass Name="Communication" RefBaseClassPath="AutomationMLBaseInterface"><InterfaceClass Name="SignalInterface" RefBaseClassPath="Communication" /></InterfaceClass>',
  "</InterfaceClass></InterfaceClassLib>",
  '<InterfaceClassLib Name="AutomationProjectConfigurationInterfaceClassLib"><Version>1.4.0</Version>',
  '<InterfaceClass Name="Tag" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector/PLCopenXMLInterface/VariableInterface">',
  '<Attribute Name="DataType" AttributeDataType="xs:string"><Attribute Name="Customized" AttributeDataType="xs:boolean"><DefaultValue>false</DefaultValue></Attribute></Attribute>',
  '<Attribute Name="IoType" AttributeDataType="xs:string" /><Attribute Name="LogicalAddress" AttributeDataType="xs:string" /><Attribute Name="Comment" AttributeDataType="xs:string" />',
  "</InterfaceClass>",
  '<InterfaceClass Name="Channel" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication/SignalInterface">',
  '<Attribute Name="Type" AttributeDataType="xs:string" /><Attribute Name="IoType" AttributeDataType="xs:string" /><Attribute Name="Number" AttributeDataType="xs:int" /><Attribute Name="Length" AttributeDataType="xs:int" />',
  "</InterfaceClass></InterfaceClassLib>",
  '<RoleClassLib Name="AutomationMLBaseRoleClassLib"><Version>2.2.2</Version><RoleClass Name="AutomationMLBaseRole"><RoleClass Name="Structure" RefBaseClassPath="AutomationMLBaseRole" /></RoleClass></RoleClassLib>',
  '<RoleClassLib Name="CommunicationRoleClassLib"><Version>1.0.1</Version>',
  '<RoleClass Name="PhysicalDevice" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole"><RoleClass Name="VariableList" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole" /></RoleClass>',
  "</RoleClassLib>",
  '<RoleClassLib Name="AutomationProjectConfigurationRoleClassLib"><Version>1.4.0</Version>',
  '<RoleClass Name="AutomationProject" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Structure"><Attribute Name="ProjectManufacturer" AttributeDataType="xs:string" /><Attribute Name="ProjectSign" AttributeDataType="xs:string" /><Attribute Name="ProjectRevision" AttributeDataType="xs:string" /><Attribute Name="ProjectInformation" AttributeDataType="xs:string" /></RoleClass>',
  '<RoleClass Name="Device" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice"><Attribute Name="TypeIdentifier" AttributeDataType="xs:string" /><Attribute Name="Comment" AttributeDataType="xs:string" /><Attribute Name="Manufacturer" AttributeDataType="xs:string" /></RoleClass>',
  '<RoleClass Name="DeviceItem" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice"><Attribute Name="TypeName" AttributeDataType="xs:string" /><Attribute Name="DeviceItemType" AttributeDataType="xs:string" /><Attribute Name="PositionNumber" AttributeDataType="xs:int" /><Attribute Name="BuiltIn" AttributeDataType="xs:boolean" /><Attribute Name="TypeIdentifier" AttributeDataType="xs:string" /><Attribute Name="Manufacturer" AttributeDataType="xs:string" /><Attribute Name="Comment" AttributeDataType="xs:string" /><Attribute Name="ProductDesignation IEC" AttributeDataType="xs:string" /><Attribute Name="LocationIdentifier IEC" AttributeDataType="xs:string" /></RoleClass>',
  '<RoleClass Name="TagTable" RefBaseClassPath="CommunicationRoleClassLib/PhysicalDevice/VariableList"><Attribute Name="AssignToDefault" AttributeDataType="xs:boolean" /></RoleClass>',
  "</RoleClassLib>",
].join("");

const RC = "AutomationProjectConfigurationRoleClassLib/";
const IC = "AutomationProjectConfigurationInterfaceClassLib/";
/** Bajt a bit kanonické adresy (%I0.3 → 0/3, %IW64 → 64/0). */
function byteBit(a: string): { byte: number; bit: number } | null {
  const m = String(a || "").match(/^%[IQ]W?(\d+)(?:\.(\d+))?$/);
  return m ? { byte: +m[1], bit: +(m[2] || 0) } : null;
}
const ioType = (d: Dir) => (d === "DI" || d === "AI" ? "Input" : "Output");
const isAnalog = (d: Dir) => d === "AI" || d === "AO";

/** AutomationML AR APC (CAEX 2.15) s PLC, kartami, kanály a symbolickými adresami. */
export function eplanAml(prj: Project, cards: EplanCard[] = eplanCards(prj)): string {
  const plat = prj.platforms[0] || "siemens";
  const bomPlat = bomPlatform(prj);
  const lines = buildBom(prj).lines;
  const cpuLine = lines.find(l => l.tag === "-A1");
  const name = ascii(prj.meta.name || "PLCdesk").trim() || "PLCdesk";
  const fileName = eplanAmlName(prj);
  const key = "plcdesk|" + name + "|";
  const typeId = (l: BomLine | undefined) => (l?.orderCode ? "OrderNumber:" + ascii(l.orderCode) : "");
  const tagTableId = idOf(key + "tagtable");
  const cpuId = idOf(key + "cpu");
  const items: string[] = [];
  const links: string[] = [];
  /* CPU s tabulkou tagů */
  const tags = cards.flatMap(c => c.mod.ch.map(e => {
    const d = devById(prj, e.devId);
    const cmt = [d ? "-" + d.name : "", e.cmt || d?.desc || ""].filter(Boolean).join(" ");
    return '<ExternalInterface Name="' + xe(e.tag) + '" ID="' + idOf(key + "tag|" + e.tag) + '" RefBaseClassPath="' + IC + 'Tag">'
      + attr("DataType", dtFor(e), "xs:string", attr("Customized", "false", "xs:boolean"))
      + attr("IoType", ioType(e.dir)) + attr("LogicalAddress", addrFor(plat, e)) + attr("Comment", cmt) + "</ExternalInterface>";
  }));
  items.push('<InternalElement Name="' + xe("-A1") + '" ID="' + cpuId + '">'
    + attr("TypeName", PLAT[bomPlat].cpu) + attr("DeviceItemType", "CPU") + attr("PositionNumber", 1, "xs:int") + attr("BuiltIn", "false", "xs:boolean")
    + (typeId(cpuLine) ? attr("TypeIdentifier", typeId(cpuLine)) : "") + attr("Manufacturer", cpuLine?.brand || PLAT[bomPlat].name.split(" ")[0])
    + attr("Comment", [cpuLine?.type, cpuLine?.desc].filter(Boolean).join(" — ")) + attr("ProductDesignation IEC", "-A1") + attr("LocationIdentifier IEC", "+1")
    + '<InternalElement Name="PLCdesk" ID="' + tagTableId + '">' + attr("AssignToDefault", "false", "xs:boolean") + tags.join("")
    + '<RoleRequirements RefBaseRoleClassPath="' + RC + 'TagTable" /></InternalElement>'
    + '<RoleRequirements RefBaseRoleClassPath="' + RC + 'DeviceItem" /></InternalElement>');
  /* I/O karty s kanály */
  for (const c of cards) {
    const id = idOf(key + "card|" + c.dt);
    const bb = c.mod.ch.map(e => byteBit(e.addr)).filter((x): x is { byte: number; bit: number } => !!x);
    const start = bb.length ? Math.min(...bb.map(x => x.byte)) : 0;
    const bit = bb.length ? Math.min(...bb.filter(x => x.byte === start).map(x => x.bit)) : 0;
    const width = isAnalog(c.mod.dir) ? 16 : 1;
    const addr = '<Attribute Name="Address"><RefSemantic CorrespondingAttributePath="OrderedListType" /><Attribute Name="1">'
      + attr("StartAddress", start, "xs:int") + attr("Length", c.mod.ch.length * width, "xs:int") + attr("IoType", ioType(c.mod.dir)) + attr("BitOffset", isAnalog(c.mod.dir) ? 0 : bit, "xs:int")
      + "</Attribute></Attribute>";
    const chans = c.mod.ch.map((e, i) => {
      const chName = c.mod.dir + "_" + i;
      links.push('<InternalLink Name="' + xe("Link_" + e.tag) + '" RefPartnerSideA="' + id + ":" + pathPart(chName) + '" RefPartnerSideB="' + tagTableId + ":" + pathPart(e.tag) + '" />');
      return '<ExternalInterface Name="' + chName + '" ID="' + idOf(key + "ch|" + c.dt + "|" + i) + '" RefBaseClassPath="' + IC + 'Channel">'
        + attr("Type", isAnalog(c.mod.dir) ? "Analog" : "Digital") + attr("IoType", ioType(c.mod.dir)) + attr("Number", i, "xs:int") + attr("Length", width, "xs:int") + "</ExternalInterface>";
    });
    items.push('<InternalElement Name="' + xe(c.dt) + '" ID="' + id + '">'
      + attr("TypeName", c.line?.type || c.line?.item || c.mod.dir) + attr("DeviceItemType", isAnalog(c.mod.dir) ? "AnalogModule" : "DigitalModule", "xs:string", attr("Customized", "true", "xs:boolean"))
      + attr("PositionNumber", c.position, "xs:int") + attr("BuiltIn", "false", "xs:boolean")
      + (typeId(c.line) ? attr("TypeIdentifier", typeId(c.line)) : "") + attr("Manufacturer", c.line?.brand || "")
      + attr("Comment", c.mod.dir + c.mod.idx + " — " + tr("svorkovnice {x}", { x: "-X" + c.xnum })) + attr("ProductDesignation IEC", c.dt) + attr("LocationIdentifier IEC", "+1")
      + addr + chans.join("")
      + '<RoleRequirements RefBaseRoleClassPath="' + RC + 'DeviceItem" /></InternalElement>');
  }
  const dev = '<InternalElement Name="' + xe(ascii(PLAT[bomPlat].name) + " -A1") + '" ID="' + idOf(key + "device") + '">'
    + (typeId(cpuLine) ? attr("TypeIdentifier", typeId(cpuLine)) : "") + attr("Comment", tr("Stanice PLC navržená v PLCdesk (návrh k revizi)")) + attr("Manufacturer", cpuLine?.brand || PLAT[bomPlat].name.split(" ")[0])
    + items.join("") + links.join("")
    + '<RoleRequirements RefBaseRoleClassPath="' + RC + 'Device" /></InternalElement>';
  const project = '<InternalElement Name="' + xe(name) + '" ID="' + idOf(key + "project") + '">'
    + attr("ProjectManufacturer", "PLCdesk") + attr("ProjectSign", name) + attr("ProjectRevision", "0.1") + attr("ProjectInformation", tr("Export PLCdesk {date} — {state}", { date: today(true), state: tr(EPLAN_VERIFIED) }))
    + dev + '<RoleRequirements RefBaseRoleClassPath="' + RC + 'AutomationProject" /></InternalElement>';
  return '<?xml version="1.0" encoding="utf-8"?>\r\n'
    + '<CAEXFile FileName="' + xe(fileName) + '" SchemaVersion="2.15" xsi:noNamespaceSchemaLocation="CAEX_ClassModel_V2.15.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '<AdditionalInformation AutomationMLVersion="2.0" />'
    + '<AdditionalInformation DocumentVersions="Recommendations"><Document DocumentIdentifier="AR APC" Version="1.4.0" /></AdditionalInformation>'
    + "<AdditionalInformation><WriterHeader><WriterName>PLCdesk</WriterName><WriterID>" + idOf("plcdesk-writer") + "</WriterID><WriterVendor>PLCdesk</WriterVendor>"
    + "<WriterVendorURL>https://plcdesk.app</WriterVendorURL><WriterVersion>0.1</WriterVersion><WriterRelease>0.1</WriterRelease>"
    + "<LastWritingDateTime>" + new Date().toISOString().slice(0, 19) + "</LastWritingDateTime><WriterProjectTitle>" + xe(name) + "</WriterProjectTitle><WriterProjectID>" + idOf(key + "project") + "</WriterProjectID></WriterHeader></AdditionalInformation>"
    + '<InstanceHierarchy Name="' + xe(name) + '"><Version>0.1</Version>' + project + "</InstanceHierarchy>"
    + AML_LIBS + "</CAEXFile>\r\n";
}

/* ================================================================ CSV pro EPLAN */

/** CSV pro EPLAN: čárka, uvozovky, UTF-8 s BOM, CRLF (EPLAN: „comma-delimited Unicode file“). */
const csv = (rows: unknown[][]) => "﻿" + rows.map(r => r.map(v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n") + "\r\n";
/* Hlavičky = anglické názvy vlastností EPLAN (pro přiřazení polí v dialogu importu; nepřekládají se). */
const DEV_HEAD = ["Device tag", "Function text", "Manufacturer", "Type number", "Order number", "Part number", "Quantity", "Category", "Remark", "PLCdesk BOM line"];

/** Seznam zařízení z kusovníku: karty rozepsané na -A2.1 …, svorky a kabely v samostatných seznamech. */
export function eplanDevicesCsv(prj: Project, cards: EplanCard[] = eplanCards(prj)): string {
  const lines = buildBom(prj).lines.filter(l => !l.excluded);
  const rows: unknown[][] = [DEV_HEAD];
  for (const l of lines) {
    if (l.tag === "-W1xx" || l.tag === "-X1" || l.tag.startsWith("+")) continue;
    const exp = cards.filter(c => c.bomTag === l.tag && c.dt !== c.bomTag);
    const remark = [l.safety ? tr("bezpečnostní prvek — návrh k revizi (EN ISO 13849)") : "", l.note].filter(Boolean).join("; ");
    if (exp.length) for (const c of exp) rows.push([c.dt, l.desc + " (" + c.mod.dir + c.mod.idx + ")", l.brand, l.type, l.orderCode, "", 1, l.item, remark, l.tag]);
    else rows.push([ascii(l.tag), l.desc, l.brand, l.type, l.orderCode, "", l.qty, l.item, remark, l.tag]);
  }
  return csv(rows);
}

/** Svorky (-X<n>:<k>) s kartou, kanálem, adresou, symbolickou adresou, cílem a vodičem. */
export function eplanTerminalsCsv(prj: Project, cards: EplanCard[] = eplanCards(prj)): string {
  const rows: unknown[][] = [["Terminal strip", "Terminal", "Device tag", "PLC card", "Channel", "PLC address", "Symbolic address", "Target device", "Connection designation", "Function text"]];
  for (const t of eplanTerminals(prj, cards)) rows.push([t.strip, t.no, t.dt, t.card, t.dir + " " + t.channel, t.addr, t.tag, t.device, t.wire, t.desc]);
  return csv(rows);
}

/** Vodiče: zařízení → svorka, potenciál a karta PLC (podklad — průřez a barvu doplní projektant). */
export function eplanWiresCsv(prj: Project, cards: EplanCard[] = eplanCards(prj)): string {
  const rows: unknown[][] = [["Connection designation", "Source", "Target", "PLC card", "Channel", "Signal", "Potential", "Cross-section", "Color", "Remark"]];
  for (const t of eplanTerminals(prj, cards)) {
    const analog = t.dir === "AI" || t.dir === "AO";
    rows.push([t.wire, t.device, t.dt, t.card, t.dir + " " + t.channel, t.tag, analog ? "4-20 mA" : t.dir === "DI" ? "L+ 24 V DC" : "M 0 V", "", "", tr("doplní projektant (průřez, barva, kabel)")]);
  }
  return csv(rows);
}

export function eplanAmlName(prj: Project): string {
  const base = ascii(prj.meta.name || "plcdesk").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "plcdesk";
  return base + "_AR_APC.aml";
}

/** README: postup importu do EPLAN a stav ověření. */
export function eplanReadme(prj: Project, cards: EplanCard[] = eplanCards(prj)): string {
  const n = cards.reduce((s, c) => s + c.mod.ch.length, 0);
  const L = [
    tr("PLCdesk — export do EPLAN Electric P8"),
    "==========================================",
    tr("Projekt: {name} · {date}", { name: prj.meta.name || "—", date: today() }),
    tr("Stav: {state}.", { state: tr(EPLAN_VERIFIED) }),
    "",
    tr("Obsah"),
    "  " + eplanAmlName(prj) + "  — " + tr("PLC -A1, {cards} I/O karet, {n} kanálů a symbolických adres (AutomationML AR APC 1.4.0)", { cards: cards.length, n }),
    "  eplan_zarizeni.csv     — " + tr("seznam zařízení z kusovníku (označení IEC 81346, výrobce, typ, objednací číslo)"),
    "  eplan_svorky.csv       — " + tr("svorky -X<n>:<k> s kartou, kanálem, adresou, tagem a vodičem (shodně s výkresy)"),
    "  eplan_vodice.csv       — " + tr("vodiče -W1xx: zařízení → svorka (podklad)"),
    "",
    tr("1) PLC karty a přiřazení I/O (AutomationML AR APC)"),
    "   " + tr("Projektová data → PLC → Import PLC dat (nebo Exchange PLC data), formát „AutomationML AR APC“, soubor {file}.", { file: eplanAmlName(prj) }),
    "   " + tr("Karty se v EPLAN dohledají podle vlastnosti „Typové označení PLC“ (TypeIdentifier = OrderNumber:<objednací číslo z kusovníku>). Bez shody v katalogu dílů je založ / přiřaď ručně."),
    "   " + tr("Kanály nesou symbolickou adresu, adresu PLC a komentář; označení karet -A1, -A2 … je ve vlastnosti „ProductDesignation IEC“."),
    "",
    tr("2) Seznam zařízení"),
    "   " + tr("Projektová data → Zařízení → Import, typ zdroje „Text“, soubor eplan_zarizeni.csv (čárka, UTF-8 s BOM)."),
    "   " + tr("V přiřazení polí namapuj: Device tag → Označení zařízení, Function text → Funkční text, Manufacturer / Type number / Order number → vlastnosti dílu; díly přiřaď v dialogu synchronizace („Přiřadit díl“)."),
    "",
    tr("3) Svorky a vodiče"),
    "   " + tr("eplan_svorky.csv lze načíst stejným importem zařízení (označení -X1:1 …) nebo použít jako předlohu ve správě svorkovnic; eplan_vodice.csv je podklad pro označení spojů (EPLAN pro spoje textový import nemá)."),
    "   " + tr("Výkresy modulů (DXF R12) z PLCdesk lze vložit jako grafiku; čísla vodičů a svorky v nich odpovídají těmto seznamům."),
    "",
    tr("Omezení"),
    "   - " + tr("Neověřeno importem v EPLAN — první import zkontroluj a nálezy zapiš (README projektu)."),
    "   - " + tr("Objednací čísla jsou typické volby z kusovníku PLCdesk — podklad k poptávce, ne projekt elektro."),
    "   - " + tr("Bezpečnostní prvky jsou jen hardware podle návrhu (EN ISO 13849, návrh k revizi)."),
    "",
    tr("Zdroje formátů"),
    ...EPLAN_SOURCES.map(u => "   " + u),
    "",
  ];
  return L.join("\r\n");
}

/** Všechny soubory exportu do EPLAN (název → obsah). */
export function eplanFiles(prj: Project): Array<{ name: string; body: string }> {
  const cards = eplanCards(prj);
  return [
    { name: eplanAmlName(prj), body: eplanAml(prj, cards) },
    { name: "eplan_zarizeni.csv", body: eplanDevicesCsv(prj, cards) },
    { name: "eplan_svorky.csv", body: eplanTerminalsCsv(prj, cards) },
    { name: "eplan_vodice.csv", body: eplanWiresCsv(prj, cards) },
    { name: "README_EPLAN.txt", body: eplanReadme(prj, cards) },
  ];
}

/* ================================================================ přihlášení */

function files(prj: Project): ProjectFile[] {
  if (!prj.io.length) return [];
  return eplanFiles(prj).map(f => ({ group: "EPLAN", name: f.name, save: f.name.startsWith("eplan_") ? f.name : "eplan_" + f.name, body: f.body, kind: "text" as const }));
}
/** Přihlásí soubory pro EPLAN do sady projektu (skupina „EPLAN“). Vrací odhlášení. */
export function registerEplanExport(): () => void { return registerDocProvider("eplan", { files }); }
/* jezdí s modulem bezpečnosti / rozšíření (klient volá registerSafetyModule) */
addSafetyRegistration(registerEplanExport);
