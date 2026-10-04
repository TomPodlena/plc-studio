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
 * Označení se berou ze sestavy hardwaru (hardware.ts) jako výkresy (drawing.ts: svorkovnice X<skupina>,
 * vodiče `wireNo` z model.ts: X1:1 → -W101, X2:1 → -W201 …) a kusovník (bom.ts: -A1 CPU s vestavěnými
 * I/O, -A2 DI, -A3 DO, -A4 AI, -A5 AO; víc karet téže řady = -A2.1, -A2.2 …; vzdálená stanice s = hlava
 * -A(10s), karty -A(10s+2) …). Stav ověření: `EPLAN_VERIFIED`.
 */
import { Project, IoModule, Dir, PLAT, devById, wireNo, dtFor, stripDia, devRef } from "./model.js";
import { hwLayout, hwLineId, hwAddrText, HW_DIRS } from "./hardware.js";
import { tr, N_, today } from "./i18n.js";
import { buildBom, bomPlatform, type BomLine } from "./bom.js";
import { registerDocProvider, type ProjectFile } from "./docs.js";
import { addSafetyRegistration } from "./safety.js";
import { genEplanAml, validateEplan, type EplanAmlOptions } from "./eplan_aml.js";

export const EPLAN_VERIFIED = N_("neověřeno importem v EPLAN Electric P8 (licence EPLAN není k dispozici); AutomationML kontrolováno proti schématu CAEX 2.15 a knihovnám AR APC 1.4.0");
export const EPLAN_SOURCES = [
  "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2026/Content/htm/plcgui_k_amlbusdatenaustausch.htm",
  "https://www.eplan.help/techtipps/en-us/SPS/TechTip-PLC-data-exchange.pdf",
  "https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip",
  "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2.9/Content/htm/projectprocessinggui_h_betriebsmittelimportieren.htm",
  "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2.9/Content/htm/projectprocessinggui_d_bmdatenimport.htm",
  "https://www.eplan.help/en-us/Infoportal/Content/api/2027/plcservice.html",
  "https://www.eplan.help/en-us/Infoportal/Content/api/2027/selectionset.html",
  "https://www.eplan.help/techtipps/en-us/SPS/TechTip-Overview-of-the-PLC-properties.pdf",
];

/** Konvertor EPLAN pro import (plcservice CONVERTERID): Siemens → TIA Portal 19 (AR APC 1.4.0), jinak obecný AML EPLAN. */
export function eplanConverterId(prj: Project): string {
  return bomPlatform(prj) === "siemens" ? "PlcDcExchangerSiemensTIA19AML" : "PlcDcAMLExchangerGeneral";
}

/* ================================================================ označení */

const ascii = (s: string) => stripDia(String(s ?? "")).replace(/[^\x20-\x7E]/g, "?");

/** Kanálová skupina modulu sestavy (hardware.ts) s označením a řádkem kusovníku — jedna svorkovnice. */
export interface EplanCard {
  /** Označení modulu dle IEC 81346 (-A1 vestavěné I/O, -A2 / -A2.1, -A12 …) a skupina řádku kusovníku. */
  dt: string; bomTag: string;
  mod: IoModule;
  /** Číslo svorkovnice X<n> (pořadí kanálové skupiny jako ve výkresech). */
  xnum: number;
  /** pozice modulu v racku (slot) */
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
  const L = hwLayout(prj, plat);
  return L.groups.map((m, i) => {
    const hw = m.hw!;
    return { dt: hw.dt, bomTag: hw.bomTag, mod: m, xnum: i + 1, position: hw.slot, line: lines.find(l => l.id === hwLineId(hw.bomTag, hw.cat)) };
  });
}

/** Svorky a vodiče podle výkresů: svorka X<n>:<k>, vodič `wireNo(n, k − 1)` (X1:1 → -W101, X2:1 → -W201 …). */
export function eplanTerminals(prj: Project, cards: EplanCard[] = eplanCards(prj)): EplanTerminal[] {
  const plat = bomPlatform(prj);
  const out: EplanTerminal[] = [];
  for (const c of cards) c.mod.ch.forEach((e, i) => {
    const d = devById(prj, e.devId);
    out.push({
      strip: "-X" + c.xnum, no: i + 1, dt: "-X" + c.xnum + ":" + (i + 1), card: c.dt, channel: c.mod.chNo?.[i] ?? i, dir: c.mod.dir,
      addr: hwAddrText(prj, e, plat), tag: e.tag, device: d ? "-" + devRef(d) : "", desc: d?.desc || e.cmt || "", wire: wireNo(c.xnum, i),
    });
  });
  return out;
}

/* ================================================================ AutomationML AR APC */

/**
 * AutomationML AR APC (CAEX 2.15): stanice, rack, CPU s rozhraním PROFINET, karty, kanály
 * a symbolické adresy — generátor a kontrola jsou v eplan_aml.ts (`genEplanAml`, `validateEplan`).
 */
export function eplanAml(prj: Project, cards: EplanCard[] = eplanCards(prj), opts: EplanAmlOptions = {}): string {
  return genEplanAml(prj, { ...opts, cards });
}

/* ================================================================ skript EPLAN */

/** Název skriptu EPLAN (C#) v sadě souborů a v repozitáři (apps/eplan/). */
export const EPLAN_SCRIPT_NAME = "PLCdesk_ImportAML.cs";
/**
 * Skript EPLAN (C#, skriptovací stroj EPLAN — bez licence API): import PLC dat přes akci
 * `plcservice /TYPE:BUSDATAIMPORT` (konvertor podle obsahu: Siemens → PlcDcExchangerSiemensTIA19AML,
 * jinak PlcDcAMLExchangerGeneral; IMPORTMATCH 0 = podle ID) a volitelně `GENERATEPLCSCHEMATIC`
 * s uloženým nastavením zákazníka. Text je shodný se souborem apps/eplan/PLCdesk_ImportAML.cs (hlídá test);
 * technický výstup → anglicky a ASCII v každém jazyce. Neověřeno v EPLAN.
 */
export function eplanImportScript(): string { return EPLAN_SCRIPT.replace(/\r?\n/g, "\r\n"); }
const EPLAN_SCRIPT = String.raw`// PLCdesk -> EPLAN Electric P8: import of PLC data (AutomationML AR APC) and optional "Generate PLC schematic".
//
// EPLAN script (C#, runs in EPLAN's own scripting engine - no EPLAN API licence needed).
// Run: File > Extras > Scripts > Run... (DE: Datei > Extras > Skripte > Ausfuehren), choose this file,
// then pick the *_AR_APC.aml exported by PLCdesk. The target project must be open and selected.
//
// Actions used (syntax per eplan.help):
//   selectionset /TYPE:PROJECT             https://www.eplan.help/en-us/Infoportal/Content/api/2027/selectionset.html
//   plcservice /TYPE:BUSDATAIMPORT ...     https://www.eplan.help/en-us/Infoportal/Content/api/2027/plcservice.html
//   plcservice /TYPE:GENERATEPLCSCHEMATIC  (same page; CONFIGFILE = saved "Generate PLC schematic" settings)
//   scripts calling actions               https://www.eplan.help/en-US/infoportal/content/api/2025/SimpleScriptWithParameters.html
//
// STATUS: NOT VERIFIED in EPLAN (no EPLAN licence available to PLCdesk). Check the first import manually.
// Pages are only drawn for parts that have a macro in the customer's master data (found via the order
// number = "PLC type designation"); generating schematics may require the EPLAN "PLC & Bus Extension".
//
// Generated by PLCdesk - identical to apps/eplan/PLCdesk_ImportAML.cs in the PLCdesk repository.
using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Eplan.EplApi.ApplicationFramework;
using Eplan.EplApi.Scripting;

public class PLCdesk_ImportAML
{
    // ---------------------------------------------------------------- settings (edit if needed)
    // Converter: "" = by file content (Siemens SIMATIC -> PlcDcExchangerSiemensTIA19AML, otherwise
    // PlcDcAMLExchangerGeneral = "Eplan Electric P8 AML-format"). Other IDs: PlcDcExchangerSiemensTIA20AML,
    // PlcDcExchangerSiemensTIA21AML, PlcDcExchangerBeckhoffTC3AML, PlcDcExchangerRockwellArchitectAML ...
    const string ConverterId = "";
    // Language of texts without a language tag: "" = from the file (PLCdesk writes <!-- PLCdesk language=xx_XX -->).
    const string Language = "";
    // Matching: "0" = by internal object IDs (PLCdesk GUIDs - a repeated import updates objects),
    // "1" = by identifying names, "2" = do not match (always create new functions).
    const string ImportMatch = "0";
    // Saved settings of "Generate PLC schematic" (customer's own configuration file); "" = skip generation.
    const string SchematicConfigFile = "";

    [Start]
    public void Run()
    {
        string project = CurrentProject();
        if (project == "")
        {
            MessageBox.Show("Open and select the target EPLAN project first.", "PLCdesk");
            return;
        }
        OpenFileDialog dlg = new OpenFileDialog();
        dlg.Title = "PLCdesk - AutomationML AR APC (*.aml)";
        dlg.Filter = "AutomationML (*.aml)|*.aml|All files (*.*)|*.*";
        if (dlg.ShowDialog() != DialogResult.OK) return;
        string aml = dlg.FileName;
        string text = File.ReadAllText(aml);
        string converter = ConverterId != "" ? ConverterId : DetectConverter(text);
        string language = Language != "" ? Language : DetectLanguage(text);

        ActionCallingContext imp = new ActionCallingContext();
        imp.AddParameter("TYPE", "BUSDATAIMPORT");
        imp.AddParameter("PROJECTNAME", project);
        imp.AddParameter("SOURCEFILE", aml);
        imp.AddParameter("LANGUAGE", language);
        imp.AddParameter("CONVERTERID", converter);
        imp.AddParameter("IMPORTMATCH", ImportMatch);
        bool ok = new CommandLineInterpreter().Execute("plcservice", imp);
        if (!ok)
        {
            MessageBox.Show("PLC data import failed (converter " + converter + ").\nTry the dialog Project data > PLC > Import PLC data, or another converter.", "PLCdesk");
            return;
        }
        if (SchematicConfigFile == "")
        {
            MessageBox.Show("PLC data imported (" + converter + ", " + language + ").\nNext: Generate PLC schematic with your settings, or set SchematicConfigFile in this script.", "PLCdesk");
            return;
        }
        ActionCallingContext gen = new ActionCallingContext();
        gen.AddParameter("TYPE", "GENERATEPLCSCHEMATIC");
        gen.AddParameter("PROJECTNAME", project);
        gen.AddParameter("CONFIGFILE", SchematicConfigFile);
        ok = new CommandLineInterpreter().Execute("plcservice", gen);
        MessageBox.Show(ok ? "PLC data imported and schematic generated - check the new pages." : "PLC data imported, schematic generation failed (licence, macros or configuration file).", "PLCdesk");
    }

    static string CurrentProject()
    {
        ActionCallingContext ctx = new ActionCallingContext();
        ctx.AddParameter("TYPE", "PROJECT");
        new CommandLineInterpreter().Execute("selectionset", ctx);
        string project = "";
        ctx.GetParameter("PROJECT", ref project);
        return project ?? "";
    }

    static string DetectConverter(string text)
    {
        bool siemens = text.Contains("System:Device.S71200") || text.Contains("System:Device.S71500")
            || text.Contains("System:Device.ET200SP") || text.Contains("OrderNumber:6ES7");
        return siemens ? "PlcDcExchangerSiemensTIA19AML" : "PlcDcAMLExchangerGeneral";
    }

    static string DetectLanguage(string text)
    {
        Match m = Regex.Match(text, "<!-- PLCdesk language=([a-z]{2}_[A-Z]{2}) -->");
        return m.Success ? m.Groups[1].Value : "en_US";
    }
}
`;

/* ================================================================ CSV pro EPLAN */

/** CSV pro EPLAN: čárka, uvozovky, UTF-8 s BOM, CRLF (EPLAN: „comma-delimited Unicode file“). */
const csv = (rows: unknown[][]) => "﻿" + rows.map(r => r.map(v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n") + "\r\n";
/* Hlavičky = anglické názvy vlastností EPLAN (pro přiřazení polí v dialogu importu; nepřekládají se). */
const DEV_HEAD = ["Device tag", "Function text", "Manufacturer", "Type number", "Order number", "Part number", "Quantity", "Category", "Remark", "PLCdesk BOM line"];

/** Seznam zařízení z kusovníku: karty rozepsané na -A2.1 …, svorky a kabely v samostatných seznamech. */
export function eplanDevicesCsv(prj: Project, cards: EplanCard[] = eplanCards(prj)): string {
  const lines = buildBom(prj).lines.filter(l => !l.excluded);
  const L = hwLayout(prj, bomPlatform(prj));
  const rows: unknown[][] = [DEV_HEAD];
  for (const l of lines) {
    if (l.tag === "-W1xx" || l.tag === "-X1" || l.tag.startsWith("+")) continue;
    /* karty sestavy rozepsané po kusech (-A2.1, -A2.2 …), skupiny svorkovnic v popisu */
    const exp = L.modules.filter(m => m.kind === "io" && !m.builtin && m.bomTag === l.tag && m.cat === l.cat && m.dt !== l.tag);
    const remark = [l.safety ? tr("bezpečnostní prvek — návrh k revizi (EN ISO 13849)") : "", l.note].filter(Boolean).join("; ");
    const grp = (m: typeof exp[number]) => cards.filter(c => c.mod.hw === m).map(c => c.mod.dir + c.mod.idx).join(", ");
    if (exp.length) for (const m of exp) rows.push([m.dt, l.desc + (grp(m) ? " (" + grp(m) + ")" : ""), l.brand, l.type, l.orderCode, "", 1, l.item, remark, l.tag]);
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
  const HL = hwLayout(prj, bomPlatform(prj));
  const nCards = HL.modules.filter(m => m.kind === "io" && !m.builtin).length;
  const nRemote = HL.stations.filter(s => s.remote).length;
  const issues = validateEplan(prj, { cards });
  const nErr = issues.filter(i => i.level === "error").length, nWarn = issues.length - nErr;
  const L = [
    tr("PLCdesk — export do EPLAN Electric P8"),
    "==========================================",
    tr("Projekt: {name} · {date}", { name: prj.meta.name || "—", date: today() }),
    tr("Stav: {state}.", { state: tr(EPLAN_VERIFIED) }),
    "",
    tr("Obsah"),
    "  " + eplanAmlName(prj) + "  — " + tr("stanice PLC (rack, CPU -A1 s rozhraním PROFINET a sítí PN_IE_1), {cards} I/O karet, {n} kanálů a symbolických adres s vícejazyčnými funkčními texty (AutomationML AR APC 1.4.0)", { cards: nCards, n })
      + (nRemote ? "; " + tr("vzdálené stanice: {n}", { n: nRemote }) : ""),
    "  eplan_zarizeni.csv     — " + tr("seznam zařízení z kusovníku (označení IEC 81346, výrobce, typ, objednací číslo)"),
    "  eplan_svorky.csv       — " + tr("svorky -X<n>:<k> s kartou, kanálem, adresou, tagem a vodičem (shodně s výkresy)"),
    "  eplan_vodice.csv       — " + tr("vodiče -W1xx: zařízení → svorka (podklad)"),
    "  " + EPLAN_SCRIPT_NAME + "  — " + tr("skript EPLAN (C#): import PLC dat a volitelně generování schématu PLC jedním spuštěním"),
    "",
    tr("1) PLC karty a přiřazení I/O (AutomationML AR APC)"),
    "   " + tr("Ručně: otevři cílový projekt (firemní šablona s kmenovými daty), Projektová data → PLC → Import PLC dat (dialog „Import PLC data“), soubor {file}, konvertor {conv}, porovnání objektů podle ID.", { file: eplanAmlName(prj), conv: eplanConverterId(prj) }),
    "   " + tr("Potom „Start Generate PLC schematic“ (Projektová data → PLC → Generovat schéma PLC) s uloženým nastavením — vzniknou stránky PLC karet; svorkovnicový plán a kusovník vygenerují standardní reporty."),
    "   " + tr("Skriptem: Soubor → Extras → Skripty → Spustit, vyber {script} a soubor {file}. Skript zavolá akci plcservice (BUSDATAIMPORT; konvertor podle obsahu souboru, porovnání podle ID) a, je-li v něm vyplněn soubor uloženého nastavení (SchematicConfigFile), i GENERATEPLCSCHEMATIC.", { script: EPLAN_SCRIPT_NAME, file: eplanAmlName(prj) }),
    "   " + tr("Karty se v EPLAN dohledají podle vlastnosti „Typové označení PLC“ (TypeIdentifier = OrderNumber:<objednací číslo z kusovníku>). Bez shody v katalogu dílů je založ / přiřaď ručně."),
    "   " + tr("Kanály nesou symbolickou adresu, adresu PLC a komentář; označení karet -A1, -A2 … je ve vlastnosti „ProductDesignation IEC“."),
    "   " + tr("Opakovaný import: každý objekt nese stálý GUID z projektu PLCdesk (projekt, zařízení, karty, signály; stanice, rack, CPU a síť odvozeně z GUID projektu). Po úpravě I/O listu vyexportuj znovu — EPLAN má objekty podle GUID aktualizovat, ne zduplikovat (neověřeno importem do EPLAN)."),
    "   " + tr("Kontrola exportu: {e} chyb, {w} upozornění (unikátní ID, odkazy InternalLink v nejbližším společném rodiči, povinné atributy, UDT + symbolická adresa v CPU, GUID).", { e: nErr, w: nWarn }),
    ...issues.slice(0, 20).map(i => "     " + (i.level === "error" ? "✖ " : "⚠ ") + i.where + ": " + i.msg),
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
    "   - " + tr("Skript ani konvertory nejsou ověřeny v EPLAN; makra a díly (kmenová data) jsou u zákazníka. Generování schématu PLC může vyžadovat licenci EPLAN „PLC & Bus Extension“."),
    "   - " + tr("Objednací čísla jsou typické volby z kusovníku PLCdesk — podklad k poptávce, ne projekt elektro."),
    "   - " + tr("Katalog objednacích čísel dílů EPLAN (Data Portal) zatím není — bez shody s kmenovými daty EPLAN makro nenajde a stránku nenakreslí; karty přiřaď ručně."),
    "   - " + tr("Sestava hardwaru (stanice, sloty, typy karet, vestavěné I/O CPU, vzdálené stanice) je návrh PLCdesk podle katalogu — adresy jsou výchozí návrh, v IDE je ověř. IO-Link a pohony po síti model zatím nezná; vzdálené stanice na EtherCAT jsou bez uzlu sítě (doplň v EPLAN)."),
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
    { name: EPLAN_SCRIPT_NAME, body: eplanImportScript() },
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
