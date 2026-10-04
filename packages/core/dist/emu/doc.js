import { PLAT } from "../model.js";
import { tr } from "../i18n.js";
import { registerDocProvider } from "../docs.js";
import { DIALECTS, RULES } from "./dialects.js";
export const EMU_DOC_FILE = "15_emulace_prekladu.md";
let api = null;
export function bindEmuApi(a) { api = a; }
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const where = (f) => f.file ? f.file + (f.line ? ":" + f.line + (f.col ? ":" + f.col : "") : "") : "—";
/** Markdown dokument emulace (platformy projektu; bez platforem všech 8). */
export function emuDocMd(prj) {
    if (!api)
        return "";
    const plats = (prj.platforms && prj.platforms.length ? prj.platforms : Object.keys(PLAT));
    /* plná matice stavů u menších projektů; u velkých (nad 40 kroků) rychlá sada — plnou spustí emulateAll(prj) */
    const scope = prj.program.seq.length <= 40 ? "full" : "quick";
    const all = api.emulateAll(prj, { platforms: plats, scope });
    const L = [];
    L.push("# " + tr("Emulace překladu a běhu vygenerovaného kódu"), "");
    L.push("> **" + tr("UPOZORNĚNÍ: Emulátor NENÍ překladač výrobce.") + "**  ");
    L.push("> " + tr("Kód se kontroluje parserem IEC 61131-3 a pravidly dialektů podle manuálů výrobců (zdroje u pravidel). Chování se ověřuje během přeloženého kódu proti modelu stroje simulace. Skutečný překlad v TIA Portal, CODESYS, TwinCAT, Machine Expert, GX Works3, Sysmac Studio, Studio 5000 a UniLogic tím NENÍ nahrazen — reálný import a překlad v IDE je dál nutné ověřit a teprve pak kód nasadit."), "");
    L.push(tr("**Projekt:** {name} · generováno nástrojem PLCdesk", { name: prj.meta.name || "—" }), "");
    L.push("## 1. " + tr("Souhrn"), "");
    L.push(tr("| Platforma | Překlad | Chyby | Upozornění | Běh: scénáře | Rozdíly kód ↔ návrh | Výsledek |"), "|---|---|---|---|---|---|---|");
    for (const p of plats) {
        const c = all.compile[p], r = all.run[p];
        const e = c.findings.filter(f => f.level === "error").length, w = c.findings.filter(f => f.level === "warn").length;
        const rt = (r.runtime || []).filter(x => x.level === "error").length;
        L.push("| " + PLAT[p].name + " | " + (c.ok ? "✔" : "✖") + " | " + e + " | " + w + " | " + (r.skipped ? "—" : r.scenarios.length) + " | " + (r.skipped ? "—" : r.diffs.length + (rt ? " + " + tr("{n} běhových chyb", { n: rt }) : "")) + " | " + (c.ok && r.ok ? "✔" : "✖") + " |");
    }
    L.push("", tr("Celková doba emulace {s} s.", { s: Math.round(all.ms / 100) / 10 }) + " " + (scope === "full"
        ? tr("Rozsah běhu: všechny scénáře ověření včetně celé matice stavů.")
        : tr("Rozsah běhu: rychlá sada (běžný a druhý cyklus, výpadky hlášení, poruchy, E-stop, blokování, kvitace, ruční režim) — projekt má přes 40 kroků; celou matici stavů spustí emulateAll(prj).")), "");
    L.push("## 2. " + tr("Nálezy překladu"), "");
    for (const p of plats) {
        const c = all.compile[p];
        const list = c.findings.filter(f => f.level !== "info");
        L.push("### " + PLAT[p].name + " — " + DIALECTS[p].label, "");
        L.push(tr("Ověřené soubory: {files}", { files: c.files.filter(f => f !== "README.txt").join(", ") }), "");
        if (!list.length) {
            L.push(tr("Bez nálezů."), "");
            continue;
        }
        L.push(tr("| Úroveň | Místo | Pravidlo | Nález | Zdroj |"), "|---|---|---|---|---|");
        for (const f of list.slice(0, 200))
            L.push("| " + (f.level === "error" ? "✖ " + tr("chyba") : "⚠ " + tr("upozornění")) + " | " + esc(where(f)) + " | " + esc(f.rule) + " | " + esc(f.msg) + " | " + (f.source ? "[" + tr("zdroj") + "](" + f.source + ")" : "—") + " |");
        if (list.length > 200)
            L.push("", tr("… a dalších {n} nálezů.", { n: list.length - 200 }));
        L.push("");
    }
    L.push("## 3. " + tr("Běh kódu proti návrhu"), "");
    L.push(tr("Přeložený kód každé platformy běží scan po scanu (10 ms, deterministický čas) ve stejných scénářích jako ověření simulací: běžný a druhý cyklus, výpadky zpětných hlášení, poruchy pohonů, E-stop a blokování v každém kroku, vypnutí AUTO, ruční režim, kvitace a nový start, analogy mimo mez. Vstupy čte kód z téhož modelu stroje jako návrh; po každém scanu se porovnají výstupy, krok sekvence, porucha stroje, krok poruchy a stavy bloků. Analogové výstupy se porovnají se žádanou hodnotou."), "");
    for (const p of plats) {
        const r = all.run[p];
        L.push("### " + PLAT[p].name, "");
        if (r.skipped) {
            L.push(r.skipped, "");
            continue;
        }
        L.push(tr("{n} scénářů, {scans} scanů kódu ({skip} scanů klidu přeskočeno), {d} rozdílů.", { n: r.scenarios.length, scans: r.scans, skip: r.skippedScans || 0, d: r.diffs.length }), "");
        if (r.diffs.length) {
            L.push(tr("| Scénář | Čas [s] | Signál | Návrh | Kód |"), "|---|---|---|---|---|");
            for (const d of r.diffs.slice(0, 100))
                L.push("| " + esc(d.label) + " | " + d.t + " | " + esc(d.signal) + " | " + d.design + " | " + d.code + " |");
            L.push("");
        }
        for (const f of r.runtime || [])
            L.push("- ✖ " + esc(f.msg));
        if ((r.runtime || []).length)
            L.push("");
    }
    L.push("## 4. " + tr("Pravidla podle platforem"), "");
    L.push(tr("| Pravidlo | Popis |"), "|---|---|");
    for (const [k, v] of Object.entries(RULES))
        L.push("| " + k + " | " + esc(tr(v)) + " |");
    L.push("");
    L.push(tr("| Platforma | Středník za END_IF | ASCII | Max. délka jména | Počáteční hodnoty | Implicitní převody | Zdroj syntaxe |"), "|---|---|---|---|---|---|---|");
    for (const p of plats) {
        const d = DIALECTS[p];
        const lv = (l) => l === "error" ? tr("povinné") : l === "warn" ? tr("doporučené") : tr("volitelné");
        L.push("| " + PLAT[p].name + " | " + lv(d.endSemi) + " | " + (d.ascii === "error" ? tr("povinné") : "—") + " | " + d.maxIdent + " | " + (d.initValues ? "✔" : "✖") + " | "
            + (p === "rockwell" ? tr("implicitní (Logix)") : p === "siemens" ? tr("jen rozšiřující (IEC check)") : p === "mitsubishi" || p === "omron" ? tr("jen rozšiřující") : tr("zužující = upozornění")) + " | [" + tr("zdroj") + "](" + d.src.syntax + ") |");
    }
    L.push("");
    L.push("## 5. " + tr("Co emulátor neověřuje"), "");
    for (const s of [
        tr("Skutečný překladač a verzi IDE (hlášení, varování, limity paměti, kapacita časovačů)."),
        tr("Import souborů do IDE (formát CSV / XML / L5X přesně podle verze, kódování, pořadí sloupců)."),
        tr("HW konfiguraci, adresy modulů, rozsahy analogových modulů (rawMax), komunikaci a HMI."),
        tr("Chování časovačů a převodů na hranách rozsahu u konkrétní CPU (např. FX5 TON nad 32 767 ms)."),
        tr("Bezpečnostní funkce — E-stop a blokování jsou v programu jen stavové signály."),
        tr("Unitronics a Rockwell výstupy nejsou ověřeny překladem v UniLogic / Studio 5000 — pravidla vycházejí z dokumentace."),
    ])
        L.push("- " + s);
    L.push("");
    return L.join("\n");
}
/* Dokument se do sady přidá až po přihlášení modulu (jako HMI): emulace celé matice je výpočetně
   náročná a klient ji zapíná vědomě — import jádra sám nic nepřihlašuje. */
let off = null;
/** Přihlásí dokument emulace do dokumentace projektu. Vrací odhlášení. */
export function registerEmuModule() {
    unregisterEmuModule();
    off = registerDocProvider("emu", {
        docs: (prj) => {
            const body = emuDocMd(prj);
            return body ? [{ path: EMU_DOC_FILE, tab: tr("Emulace"), title: tr("emulace překladu a běhu kódu (NENÍ překladač výrobce)"), body }] : [];
        },
    });
    return unregisterEmuModule;
}
export function unregisterEmuModule() { if (off)
    off(); off = null; }
export function emuModuleRegistered() { return off !== null; }
