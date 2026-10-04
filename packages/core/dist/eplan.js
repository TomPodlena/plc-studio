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
import { devById, modules, wireNo, addrFor, stripDia } from "./model.js";
import { tr, N_, today } from "./i18n.js";
import { buildBom, bomPlatform } from "./bom.js";
import { registerDocProvider } from "./docs.js";
import { addSafetyRegistration } from "./safety.js";
import { genEplanAml, validateEplan } from "./eplan_aml.js";
export const EPLAN_VERIFIED = N_("neověřeno importem v EPLAN Electric P8 (licence EPLAN není k dispozici); AutomationML kontrolováno proti schématu CAEX 2.15 a knihovnám AR APC 1.4.0");
export const EPLAN_SOURCES = [
    "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2026/Content/htm/plcgui_k_amlbusdatenaustausch.htm",
    "https://www.eplan.help/techtipps/en-us/SPS/TechTip-PLC-data-exchange.pdf",
    "https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip",
    "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2.9/Content/htm/projectprocessinggui_h_betriebsmittelimportieren.htm",
    "https://www.eplan.help/en-us/Infoportal/Content/Plattform/2.9/Content/htm/projectprocessinggui_d_bmdatenimport.htm",
];
/* ================================================================ označení */
const ascii = (s) => stripDia(String(s ?? "")).replace(/[^\x20-\x7E]/g, "?");
/** Řada karet v kusovníku podle směru (Unitronics: analogy v jednom kombinovaném modulu -A4). */
function bomTagOf(dir, plat) {
    return dir === "DI" ? "-A2" : dir === "DO" ? "-A3" : dir === "AI" ? "-A4" : plat === "unitronics" ? "-A4" : "-A5";
}
/** I/O karty s označením (stejné pořadí jako výkresy a seznam svorek dokumentace). */
export function eplanCards(prj) {
    const plat = bomPlatform(prj);
    const lines = buildBom(prj).lines;
    const mods = modules(prj);
    const count = {};
    for (const m of mods) {
        const t = bomTagOf(m.dir, plat);
        count[t] = (count[t] || 0) + 1;
    }
    const seen = {};
    return mods.map((m, i) => {
        const bomTag = bomTagOf(m.dir, plat);
        const k = (seen[bomTag] = (seen[bomTag] || 0) + 1);
        return { dt: count[bomTag] > 1 ? bomTag + "." + k : bomTag, bomTag, mod: m, xnum: i + 1, position: i + 2, line: lines.find(l => l.tag === bomTag) };
    });
}
/** Svorky a vodiče podle výkresů: svorka X<n>:<k>, vodič `wireNo(n, k − 1)` (X1:1 → -W101, X2:1 → -W201 …). */
export function eplanTerminals(prj, cards = eplanCards(prj)) {
    const plat = prj.platforms[0] || "siemens";
    const out = [];
    for (const c of cards)
        c.mod.ch.forEach((e, i) => {
            const d = devById(prj, e.devId);
            out.push({
                strip: "-X" + c.xnum, no: i + 1, dt: "-X" + c.xnum + ":" + (i + 1), card: c.dt, channel: i, dir: c.mod.dir,
                addr: addrFor(plat, e), tag: e.tag, device: d ? "-" + d.name : "", desc: d?.desc || e.cmt || "", wire: wireNo(c.xnum, i),
            });
        });
    return out;
}
/* ================================================================ AutomationML AR APC */
/**
 * AutomationML AR APC (CAEX 2.15): stanice, rack, CPU s rozhraním PROFINET, karty, kanály
 * a symbolické adresy — generátor a kontrola jsou v eplan_aml.ts (`genEplanAml`, `validateEplan`).
 */
export function eplanAml(prj, cards = eplanCards(prj), opts = {}) {
    return genEplanAml(prj, { ...opts, cards });
}
/* ================================================================ CSV pro EPLAN */
/** CSV pro EPLAN: čárka, uvozovky, UTF-8 s BOM, CRLF (EPLAN: „comma-delimited Unicode file“). */
const csv = (rows) => "﻿" + rows.map(r => r.map(v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n") + "\r\n";
/* Hlavičky = anglické názvy vlastností EPLAN (pro přiřazení polí v dialogu importu; nepřekládají se). */
const DEV_HEAD = ["Device tag", "Function text", "Manufacturer", "Type number", "Order number", "Part number", "Quantity", "Category", "Remark", "PLCdesk BOM line"];
/** Seznam zařízení z kusovníku: karty rozepsané na -A2.1 …, svorky a kabely v samostatných seznamech. */
export function eplanDevicesCsv(prj, cards = eplanCards(prj)) {
    const lines = buildBom(prj).lines.filter(l => !l.excluded);
    const rows = [DEV_HEAD];
    for (const l of lines) {
        if (l.tag === "-W1xx" || l.tag === "-X1" || l.tag.startsWith("+"))
            continue;
        const exp = cards.filter(c => c.bomTag === l.tag && c.dt !== c.bomTag);
        const remark = [l.safety ? tr("bezpečnostní prvek — návrh k revizi (EN ISO 13849)") : "", l.note].filter(Boolean).join("; ");
        if (exp.length)
            for (const c of exp)
                rows.push([c.dt, l.desc + " (" + c.mod.dir + c.mod.idx + ")", l.brand, l.type, l.orderCode, "", 1, l.item, remark, l.tag]);
        else
            rows.push([ascii(l.tag), l.desc, l.brand, l.type, l.orderCode, "", l.qty, l.item, remark, l.tag]);
    }
    return csv(rows);
}
/** Svorky (-X<n>:<k>) s kartou, kanálem, adresou, symbolickou adresou, cílem a vodičem. */
export function eplanTerminalsCsv(prj, cards = eplanCards(prj)) {
    const rows = [["Terminal strip", "Terminal", "Device tag", "PLC card", "Channel", "PLC address", "Symbolic address", "Target device", "Connection designation", "Function text"]];
    for (const t of eplanTerminals(prj, cards))
        rows.push([t.strip, t.no, t.dt, t.card, t.dir + " " + t.channel, t.addr, t.tag, t.device, t.wire, t.desc]);
    return csv(rows);
}
/** Vodiče: zařízení → svorka, potenciál a karta PLC (podklad — průřez a barvu doplní projektant). */
export function eplanWiresCsv(prj, cards = eplanCards(prj)) {
    const rows = [["Connection designation", "Source", "Target", "PLC card", "Channel", "Signal", "Potential", "Cross-section", "Color", "Remark"]];
    for (const t of eplanTerminals(prj, cards)) {
        const analog = t.dir === "AI" || t.dir === "AO";
        rows.push([t.wire, t.device, t.dt, t.card, t.dir + " " + t.channel, t.tag, analog ? "4-20 mA" : t.dir === "DI" ? "L+ 24 V DC" : "M 0 V", "", "", tr("doplní projektant (průřez, barva, kabel)")]);
    }
    return csv(rows);
}
export function eplanAmlName(prj) {
    const base = ascii(prj.meta.name || "plcdesk").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "plcdesk";
    return base + "_AR_APC.aml";
}
/** README: postup importu do EPLAN a stav ověření. */
export function eplanReadme(prj, cards = eplanCards(prj)) {
    const n = cards.reduce((s, c) => s + c.mod.ch.length, 0);
    const issues = validateEplan(prj, { cards });
    const nErr = issues.filter(i => i.level === "error").length, nWarn = issues.length - nErr;
    const L = [
        tr("PLCdesk — export do EPLAN Electric P8"),
        "==========================================",
        tr("Projekt: {name} · {date}", { name: prj.meta.name || "—", date: today() }),
        tr("Stav: {state}.", { state: tr(EPLAN_VERIFIED) }),
        "",
        tr("Obsah"),
        "  " + eplanAmlName(prj) + "  — " + tr("stanice PLC (rack, CPU -A1 s rozhraním PROFINET a sítí PN_IE_1), {cards} I/O karet, {n} kanálů a symbolických adres s vícejazyčnými funkčními texty (AutomationML AR APC 1.4.0)", { cards: cards.length, n }),
        "  eplan_zarizeni.csv     — " + tr("seznam zařízení z kusovníku (označení IEC 81346, výrobce, typ, objednací číslo)"),
        "  eplan_svorky.csv       — " + tr("svorky -X<n>:<k> s kartou, kanálem, adresou, tagem a vodičem (shodně s výkresy)"),
        "  eplan_vodice.csv       — " + tr("vodiče -W1xx: zařízení → svorka (podklad)"),
        "",
        tr("1) PLC karty a přiřazení I/O (AutomationML AR APC)"),
        "   " + tr("Projektová data → PLC → Import PLC dat (nebo Exchange PLC data), formát „AutomationML AR APC“, soubor {file}.", { file: eplanAmlName(prj) }),
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
        "   - " + tr("Objednací čísla jsou typické volby z kusovníku PLCdesk — podklad k poptávce, ne projekt elektro."),
        "   - " + tr("Katalog objednacích čísel dílů EPLAN (Data Portal) zatím není — bez shody s kmenovými daty EPLAN makro nenajde a stránku nenakreslí; karty přiřaď ručně."),
        "   - " + tr("Vzdálené stanice, IO-Link a pohony model zatím nezná — export nese lokální rack CPU a rozhraní PROFINET CPU."),
        "   - " + tr("Bezpečnostní prvky jsou jen hardware podle návrhu (EN ISO 13849, návrh k revizi)."),
        "",
        tr("Zdroje formátů"),
        ...EPLAN_SOURCES.map(u => "   " + u),
        "",
    ];
    return L.join("\r\n");
}
/** Všechny soubory exportu do EPLAN (název → obsah). */
export function eplanFiles(prj) {
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
function files(prj) {
    if (!prj.io.length)
        return [];
    return eplanFiles(prj).map(f => ({ group: "EPLAN", name: f.name, save: f.name.startsWith("eplan_") ? f.name : "eplan_" + f.name, body: f.body, kind: "text" }));
}
/** Přihlásí soubory pro EPLAN do sady projektu (skupina „EPLAN“). Vrací odhlášení. */
export function registerEplanExport() { return registerDocProvider("eplan", { files }); }
/* jezdí s modulem bezpečnosti / rozšíření (klient volá registerSafetyModule) */
addSafetyRegistration(registerEplanExport);
