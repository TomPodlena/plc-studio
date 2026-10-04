/**
 * PLCdesk — HMI: dokument `16_hmi.md`, soubory sady projektu a přihlášení modulu.
 *
 * `registerHmiModule()` přihlásí přes `registerDocProvider` (docs.ts):
 *   16_hmi.md                    seznam tagů, alarmů, obrazovek, exporty a stav jejich ověření
 *   HMI — <platforma>            soubory exportu pro HMI výrobce (hmiFiles, hmi_export.ts)
 *   HMI — web                    hmi_web.html (samostatné webové HMI), hmi_screens.json, SVG obrazovek
 * Do přihlášení (klient, až bude krok HMI v UI) je sada projektu beze změny.
 */
import { PLAT } from "./model.js";
import { tr, today } from "./i18n.js";
import { registerDocProvider } from "./docs.js";
import { buildHmi, alarmClassLabel, hmiPlcPath } from "./hmi.js";
import { hmiScreenSVG, hmiJson, hmiWebHtml } from "./hmi_view.js";
import { hmiFiles, hmiExportSpec, hmiStatusLabel } from "./hmi_export.js";
export const HMI_DOC_FILE = "16_hmi.md";
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
function rangeOf(t) {
    const r = Number.isFinite(t.min) && Number.isFinite(t.max) ? t.min + " … " + t.max : "";
    return [r, t.unit || ""].filter(Boolean).join(" ");
}
/** Dokument HMI: tagy, alarmy, obrazovky, cesty v programu a exporty se stavem ověření. */
export function hmiDocMd(prj, m = buildHmi(prj)) {
    const L = [
        "# " + tr("Specifikace HMI"),
        "",
        tr("**Projekt:** {name} · generováno {date} nástrojem PLCdesk", { name: prj.meta.name || "—", date: today() }),
        "",
        tr("Návrh HMI odvozený z projektu — k revizi. Tagy odkazují na proměnné, které generovaný program deklaruje; program se kvůli HMI nemění."),
        "",
        "## " + tr("1. Přehled"),
        "- " + tr("Tagy: {n} (povely z HMI: {rw})", { n: m.tags.length, rw: m.tags.filter(t => t.access === "RW").length }),
        "- " + tr("Alarmy: {n} (pokrývají {c} kódů ze seznamu alarmů {file})", { n: m.alarms.length, c: m.alarms.reduce((a, x) => a + x.codes.length, 0), file: "`04_seznam_alarmu.csv`" }),
        "- " + tr("Obrazovky: {list}", { list: m.screens.map(s => s.title + (s.pages > 1 ? " " + s.page + "/" + s.pages : "")).join(", ") }),
        "",
        "## " + tr("2. Tagy"),
        tr("| Tag | Typ | Přístup | Popis | Rozsah / jednotka |"),
        "|---|---|---|---|---|",
        ...m.tags.map(t => "| `" + t.name + "` | " + t.type + " | " + (t.access === "RW" ? tr("čtení / zápis") + (t.cmd === "momentary" ? " (" + tr("tlačítko") + ")" : t.cmd === "toggle" ? " (" + tr("přepínač") + ")" : "") : tr("čtení")) + " | " + cell(t.desc) + " | " + cell(rangeOf(t)) + " |"),
        "",
        "### " + tr("Cesta tagu v programu podle platformy"),
        tr("| Platforma | Proměnná strojního bloku | Signál I/O |"),
        "|---|---|---|",
    ];
    const exM = m.tags.find(t => t.src === "machine" && t.member.includes(".")) || m.tags.find(t => t.src === "machine");
    const exIo = m.tags.find(t => t.src === "io");
    for (const p of prj.platforms)
        L.push("| " + PLAT[p].name + " | `" + hmiPlcPath(p, exM) + "` | " + (exIo ? "`" + hmiPlcPath(p, exIo) + "`" : "—") + " |");
    L.push("", tr("Textové seznamy: stavové slovo bloku (0 = v pořádku, 16#8001 = blokováno, 16#8002 = porucha), krok sekvence (0 = čekání na start, 10, 20 … = kroky)."), "", "## " + tr("3. Alarmy"), tr("Kódy a texty jsou ze seznamu alarmů (`04_seznam_alarmu.csv`). Blok zařízení nerozlišuje příčinu poruchy (jediný výstup `error`), proto kódy se společným signálem tvoří jeden alarm HMI."), "", tr("| Č. | Alarm | Kódy | Třída | Priorita | Text | Spouštění | Reakce | Kvitace |"), "|---|---|---|---|---|---|---|---|---|", ...m.alarms.map(a => "| " + a.id + " | `" + a.name + "` | " + a.codes.join(", ") + " | " + alarmClassLabel(a.cls) + " | " + a.priority + " | " + cell(a.text) + " | `" +
        (a.trigger.kind === "bit" ? a.trigger.tag + " = TRUE" : a.trigger.kind === "bitOff" ? a.trigger.tag + " = FALSE" : a.trigger.tag + " = " + a.trigger.value) + "` | " + cell(a.reaction) + " | " + cell(a.ack) + " |"), "", "## " + tr("4. Obrazovky"), tr("| Obrazovka | Stránka | Obsah | Náhled |"), "|---|---|---|---|");
    const content = {
        overview: tr("mimiky zařízení podle tříd (motor, ventil, analog, vstupy, výstupy), stav stroje v záhlaví"),
        manual: tr("přepínač AUTO / RUČNĚ, start, kvitace, ruční povely pohonů se stavem bloku"),
        sequence: tr("aktuální krok, krok s vypršeným hlídacím časem, seznam kroků s podmínkami přechodu"),
        alarms: tr("živý seznam aktivních alarmů, kvitace"),
        params: tr("meze měření, rozsahy, žádané hodnoty, hlídací časy, takt (jen ke čtení)"),
    };
    for (const s of m.screens)
        L.push("| " + s.title + " | " + s.page + "/" + s.pages + " | " + content[s.kind] + " | `hmi_" + s.id + ".svg` |");
    L.push("", tr("Záhlaví každé obrazovky: uvolnění, AUTO, porucha stroje, aktuální krok; zápatí: navigace mezi obrazovkami."), "", "## " + tr("5. Exporty pro HMI a stav ověření"), tr("| Platforma | Soubor | Formát | Stav | Zdroj formátu |"), "|---|---|---|---|---|");
    for (const p of prj.platforms) {
        const spec = hmiExportSpec(p);
        if (!spec) {
            L.push("| " + PLAT[p].name + " | — | " + tr("bez exportu pro HMI výrobce — použij webové HMI nebo seznam tagů z `16_hmi.md`") + " | — | — |");
            continue;
        }
        for (const f of spec.files)
            L.push("| " + PLAT[p].name + " (" + spec.product + ") | `hmi_" + p + "_" + f.name + "` | " + cell(tr(f.format)) + " | " + hmiStatusLabel(f.status) + " | " + f.sources.map(u => "<" + u + ">").join(" ") + " |");
    }
    L.push("| " + tr("obecné") + " | `hmi_web.html` | " + tr("samostatná webová stránka (SVG obrazovky, WebSocket / demo)") + " | " + hmiStatusLabel("stub") + " | — |", "| " + tr("obecné") + " | `hmi_screens.json` | " + tr("JSON popis tagů, alarmů a obrazovek pro budoucí runtime") + " | " + tr("vlastní formát PLCdesk") + " | — |", "", "## " + tr("6. Výhrady"), "- " + tr("Exporty označené „neověřeno importem“ odpovídají veřejné dokumentaci výrobce, ale nebyly naimportovány do cílového nástroje — po prvním importu doplnit zjištěné odchylky."), "- " + tr("Tlačítka start a kvitace jsou impulzní (TRUE po dobu stisku); ruční povely platí jen mimo AUTO — logiku hlídá program, ne HMI."), "- " + tr("E-stop a blokování jsou v HMI jen stavové signály; bezpečnostní funkce se z HMI neovládají."), "- " + tr("Webové HMI se k PLC připojuje přes bránu OPC UA ↔ WebSocket (kostra protokolu v souboru) — prohlížeč OPC UA binárně neumí."));
    return L.join("\n");
}
/* ================================================================ sada projektu */
function docs(prj) {
    return [{ path: HMI_DOC_FILE, tab: tr("HMI"), title: tr("HMI: tagy, alarmy, obrazovky a exporty pro panely"), body: hmiDocMd(prj) }];
}
/** Soubory HMI do sady projektu (exporty platforem, webové HMI, JSON, náhledy obrazovek). */
export function hmiProjectFiles(prj, m = buildHmi(prj)) {
    const out = [];
    const gWeb = tr("HMI — web a náhledy");
    out.push({ group: gWeb, name: "hmi_web.html", save: "hmi_web.html", body: hmiWebHtml(prj, m), kind: "text" });
    out.push({ group: gWeb, name: "hmi_screens.json", save: "hmi_screens.json", body: hmiJson(prj, m), kind: "text" });
    for (const s of m.screens)
        out.push({ group: gWeb, name: "hmi_" + s.id + ".svg", save: "hmi_" + s.id + ".svg", body: hmiScreenSVG(s), kind: "svg" });
    for (const p of prj.platforms) {
        const g = tr("HMI — {name}", { name: PLAT[p].name });
        for (const [n, b] of Object.entries(hmiFiles(prj, p, m)))
            out.push({ group: g, name: n, save: "hmi_" + p + "_" + n, body: b, kind: "text" });
    }
    return out;
}
let off = null;
/** Přihlásí modul HMI do dokumentace a sady projektu. Vrací odhlášení. */
export function registerHmiModule() {
    unregisterHmiModule();
    off = registerDocProvider("hmi", { docs, files: (prj) => hmiProjectFiles(prj) });
    return unregisterHmiModule;
}
export function unregisterHmiModule() { if (off)
    off(); off = null; }
export function hmiModuleRegistered() { return off !== null; }
