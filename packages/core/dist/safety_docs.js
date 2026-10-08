/**
 * PLCdesk — dokumenty bezpečnostního modulu a jeho přihlášení do sady projektu.
 *
 *   13_bezpecnostni_funkce.md   SRS: nebezpečí, funkce, PLr (S/F/P), architektura, komponenty,
 *                               výpočet PL, zapojení, bezpečné vzdálenosti, stav schválení
 *   14_plan_validace.md         plán ověření a validace + kontrolní seznamy po funkcích
 *   bezpecnostni_okruh.svg/.dxf výkres bezpečnostního okruhu (návrh)
 *   bezpečnostní program        safety_prog.ts (jen po schválení funkcí; jinak „čeká na schválení“)
 *   kusovník                    logika, bezpečnostní stykače, ventily, chybějící prvky
 * `registerSafetyModule()` (safety.ts) přihlásí celý modul: schvalování, oživení (fáze 10),
 * dokumenty a schémata (docs.ts) a kusovník (bom.ts); `unregisterSafetyModule()` ho odhlásí.
 */
import { PLAT } from "./model.js";
import { tr, trx, today } from "./i18n.js";
import { projectRef } from "./project_meta.js";
import { approvalStamp, APPROVAL_FILE } from "./approval.js";
import { registerDocProvider } from "./docs.js";
import { registerBomProvider } from "./bom.js";
import { circuitSheetSVG, circuitSheetDXF } from "./drawing.js";
import { proposeSafety, safetyApprovalItems, safetyApprovalState, safetyItemStatus, testKindLabel, targetLabel, addSafetyRegistration, } from "./safety.js";
import { safetyProgramFiles, programFunctions, programOutputs } from "./safety_prog.js";
import * as D from "./safety_data.js";
export const SAFETY_FILE_SRS = "13_bezpecnostni_funkce.md";
export const SAFETY_FILE_VALIDATION = "14_plan_validace.md";
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const urlList = (xs) => [...new Set(xs)].map(u => "- " + u);
const fmtS = (s) => s >= 86400 ? tr("{n} d", { n: Math.round(s / 86400) }) : s >= 3600 ? tr("{n} h", { n: Math.round(s / 360) / 10 }) : s >= 60 ? tr("{n} min", { n: Math.round(s / 6) / 10 }) : tr("{n} s", { n: s });
/** Body, které aplikace jen navrhuje a odpovědná osoba schvaluje (validation.md, kap. 5). */
function responsibilities() {
    return [
        tr("Meze stroje, zamýšlené použití a rozumně předvídatelné nesprávné použití."),
        tr("Identifikace nebezpečí, odhad a hodnocení rizik a volba opatření v pořadí konstrukce → ochranná opatření → informace; aplikace nerozhoduje, že je riziko přijatelné."),
        tr("Seznam bezpečnostních funkcí a jejich přiřazení k nebezpečím."),
        tr("PLr každé funkce (S, F, P a pravděpodobnost výskytu) nebo převzetí z normy typu C; snížení PLr jen s písemným zdůvodněním."),
        tr("Celá specifikace (SRS) a její přezkum před návrhem."),
        tr("Architektura, kategorie a výběr komponent včetně každého vyloučení poruchy se zdůvodněním (PL e nesmí stát jen na vyloučení poruch)."),
        tr("Doba doběhu a bezpečné vzdálenosti — jen ze změřených hodnot; vzorec a vydání ISO 13855 jsou uvedené."),
        tr("Plán validace, protokol FAT a validační zpráva — výsledky zapisuje člověk podle skutečné zkoušky; simulace ověřuje návrh, ne stroj."),
        tr("Bezpečnostní program / konfigurace bezpečnostní logiky (položka safety:program)."),
        tr("Zbytková rizika, texty do návodu a postupy pravidelných zkoušek bezpečnostních funkcí."),
        tr("Technická dokumentace, EU prohlášení o shodě a postup posuzování shody (nařízení (EU) 2023/1230 od 20. 1. 2027)."),
        tr("Kybernetická bezpečnost: ochrana bezpečnostního softwaru a parametrů proti neoprávněné změně."),
        tr("Posouzení každé změny: rozsah opakovaného ověření a validace, případně podstatná změna stroje."),
    ];
}
function statusOf(prj, items, key) { return safetyItemStatus(prj, items, key); }
/* ================================================================ 13 — SRS */
export function safetySrsMd(prj, items = safetyApprovalItems(prj), p = proposeSafety(prj)) {
    const par = p.params;
    const L = [
        "# " + tr("Bezpečnostní funkce — specifikace (SRS)"),
        "",
        approvalStamp(prj, ["safety"], items).md,
        "",
        tr("**Projekt:** {name} · **Vytvořeno:** {date} · **Data rešerše:** {data}", { name: prj.meta.name || "—", date: today(), data: D.SAFETY_DATA_DATE }),
        "",
        tr("PLCdesk NAVRHUJE nebezpečí, bezpečnostní funkce, PLr, architekturu, komponenty a výpočet PL; platí jen to, co schválí odpovědná osoba (jméno, datum, poznámka — {file}). Návrh vychází z ISO 13849-1 (graf rizik příl. A, zjednodušené určení PL), IEC 60204-1 (kategorie zastavení) a ISO 13855 (vzdálenosti); normy jsou placené, data pochází z veřejných výkladů (IFA/DGUV, výrobci) — zdroje u každé funkce. Návrh k revizi, nenahrazuje normu ani posouzení rizik.", { file: APPROVAL_FILE }),
        "",
        tr("Bezpečnostní logika patří do bezpečnostního PLC / relé. Standardní program čte E-stop a blokování jen jako stavové signály (enable, kvitace) — bezpečnostní funkce na něm nestojí."),
        "",
        "## " + tr("Parametry návrhu"),
        "",
        tr("| Parametr | Hodnota |"), "|---|---|",
        "| " + tr("Bezpečnostní logika") + " | " + cell((p.logic.brand || "") + " " + (p.logic.series || p.logic.label) + (p.logic.orderCode ? " (" + p.logic.orderCode + ")" : "")) + " |",
        "| " + tr("Cíl bezpečnostního programu") + " | " + cell(targetLabel(p.target)) + " |",
        "| " + tr("Provozní dny / hodiny (nop)") + " | " + par.dop + " d · " + par.hop + " h |",
        "| " + tr("Doba mise") + " | " + tr("{n} let", { n: par.missionYears }) + " |",
        "| " + tr("Vydání ISO 13855") + " | " + p.edition + " |",
        "| " + tr("Metoda PL") + " | " + tr("zjednodušená: kategorie × MTTFd × DCavg × CCF (sloupcový graf ISO 13849-1); PL funkce = nejnižší PL subsystému — ověř v SISTEMA (PFH součtem)") + " |",
        "",
    ];
    if (p.warnings.length) {
        L.push("**" + tr("Upozornění") + "**", ...p.warnings.map(w => "- " + w), "");
    }
    /* nebezpečí */
    L.push("## 1. " + tr("Nebezpečí a přiřazené funkce"), "", tr("Stav schválení: **{s}**", { s: statusOf(prj, items, "safety:hazards") }), "", tr("| Nebezpečí | Zařízení | Funkce |"), "|---|---|---|");
    for (const h of p.hazards)
        L.push("| " + cell(h.text) + " | " + cell(h.devs.join(", ") || "—") + " | " + (h.fns.join(", ") || "**" + tr("chybí") + "**") + " |");
    L.push("");
    /* přehled */
    L.push("## 2. " + tr("Přehled bezpečnostních funkcí"), "", tr("| ID | Funkce | PLr | Dosažené PL | Kat. | Zastavení | Schválení funkce | Schválení návrhu |"), "|---|---|---|---|---|---|---|---|");
    for (const f of p.fns) {
        L.push("| " + f.id + " | " + cell(f.title) + (f.off ? " — " + tr("vyřazeno") : "") + " | " + (f.risk.plr || "—") + " | " + (f.design ? (f.design.pl || "—") + (f.design.ok ? " ✔" : " ✖") : "—") + " | "
            + (f.design?.cat || "—") + " | " + f.stopCat + " | " + statusOf(prj, items, "safety:" + f.id) + " | " + (f.design ? statusOf(prj, items, "safety:" + f.id + ":design") : "—") + " |");
    }
    L.push("", tr("Bezpečnostní program: **{s}**", { s: items.some(i => i.key === "safety:program") ? statusOf(prj, items, "safety:program") : "—" }), "");
    /* funkce */
    L.push("## 3. " + tr("Specifikace funkcí"), "");
    for (const f of p.fns)
        L.push(...fnSection(prj, p, f, items), "");
    /* odpovědnost */
    L.push("## 4. " + tr("Co schvaluje odpovědná osoba"), "", ...responsibilities().map((x, i) => (i + 1) + ". " + x), "");
    /* rozpory */
    L.push("## 5. " + tr("Rozpory ve zdrojích (rešerše)"), "", tr("| Téma | Řešení | Zdroje |"), "|---|---|---|");
    for (const d of D.SAFETY_DISCREPANCIES)
        L.push("| " + cell(tr(d.topic)) + " | " + cell(d.resolution ? tr(d.resolution) : tr("neřešeno — rozhodne uživatel")) + " | " + d.sources.slice(0, 2).join(" ") + " |");
    L.push("", "## 6. " + tr("Zdroje"), "", ...urlList([...D.SAFETY_PLR_SOURCES, ...D.SAFETY_SIMPLE_PL_SOURCES, ...D.SAFETY_CCF_SOURCES, ...D.SAFETY_B10D_SOURCES, ...D.SAFETY_STOP_SOURCES, ...D.SAFETY_ISO13855_SOURCES.editions]));
    return L.join("\n");
}
function fnSection(prj, p, f, items) {
    const L = ["### " + f.id + " — " + f.title];
    L.push("", tr("Stav: funkce **{a}**, návrh **{b}**", { a: statusOf(prj, items, "safety:" + f.id), b: f.design ? statusOf(prj, items, "safety:" + f.id + ":design") : "—" }));
    if (f.off) {
        L.push("", tr("Funkce je z návrhu vyřazená: {why}", { why: f.note || tr("bez zdůvodnění — doplň") }));
        return L;
    }
    const d = f.design;
    const ins = f.inputs.length ? f.inputs.join(", ") : (f.missing[0] || "—");
    const outs = p.groups.filter(g => f.acts.includes(g.id)).map(g => g.id).join(", ") || "—";
    const dist = f.distance;
    L.push("", tr("| Pole SRS | Hodnota |"), "|---|---|", "| " + tr("Popis (vstup → logika → výstup)") + " | " + cell(ins + " → " + (p.logic.series || p.logic.label) + " → " + outs) + " |", "| " + tr("Nebezpečí") + " | " + cell(f.hazards.join("; ") || "—") + " |", "| " + tr("Spouštěcí událost") + " | " + cell(f.trigger) + " |", "| " + tr("Reakce") + " | " + cell(f.reaction) + " |", "| " + tr("Bezpečný stav") + " | " + cell(f.safeState) + " |", "| " + tr("Kategorie zastavení (IEC 60204-1)") + " | " + f.stopCat + " — " + cell(f.stopWhy) + " |", "| PLr | " + (f.risk.plr ? "**" + f.risk.plr + "**" : "—") + " — " + cell(tr("graf rizik {s} / {f} / {p} → {g}", { s: f.risk.S, f: f.risk.F, p: f.risk.P, g: f.risk.graph })
        + (f.risk.min ? "; " + tr("normové minimum {pl}: {why}", { pl: f.risk.min.pl, why: f.risk.min.why }) : "")
        + (f.risk.reduced ? "; " + tr("sníženo o 1 úroveň: {why}", { why: f.risk.reduced }) : "")
        + (f.risk.override ? "; " + tr("z normy typu C: {src}", { src: f.risk.override.source || "—" }) : "")) + " |", "| " + tr("Provozní režimy") + " | " + cell(f.modes) + " |", "| " + tr("Přípustná doba odezvy") + " | " + cell(dist && dist.T !== null ? tr("≤ {t} s (z výpočtu bezpečné vzdálenosti)", { t: dist.T }) : tr("doplnit — nejvýš doba, za kterou osoba nedosáhne nebezpečí (ISO 13855)")) + " |", "| " + tr("Četnost vyžádání") + " | " + cell(tr("průměrně jednou za {t} (předpoklad pro nop — ověř podle provozu)", { t: fmtS(f.demandS) })) + " |", "| " + tr("Priorita") + " | " + cell(f.kind === "estop" ? tr("nejvyšší — přednost před všemi povely a režimy") : tr("zastavení má přednost před startem; nouzové zastavení před všemi funkcemi")) + " |", "| " + tr("Reset a opětovný rozběh") + " | " + cell(f.resetText) + " |", "| " + tr("Rozhraní ke standardnímu programu") + " | " + cell((d?.signals || []).filter(s => s.kind === "status").map(s => s.tag).join(", ") || tr("bez stavového signálu")) + " |", "| " + tr("Reakce na poruchu") + " | " + cell(tr("Detekovaná porucha (nesoulad kanálů, zkrat, EDM) → bezpečný stav; reset nejde, dokud porucha trvá.")) + " |", "| " + tr("Chování při ztrátě energie") + " | " + cell(f.energyLoss) + " |", "| " + tr("Vyloučení poruch") + " | " + cell(tr("žádné nenavrženo — každé vyloučení zdůvodni (ISO 13849-2); PL e nesmí stát jen na vyloučení poruch")) + " |", "| " + tr("Normy") + " | " + cell(f.standards.join(", ")) + " |");
    L.push("", "**" + tr("Zdůvodnění S / F / P (návrh)") + "**", "", "- " + f.risk.why.S, "- " + f.risk.why.F, "- " + f.risk.why.P, "- " + tr("Typicky podle zdrojů: PLr {plr}; architektura {arch}", { plr: f.typical.plr, arch: f.typical.arch || "—" }));
    if (d) {
        L.push("", "**" + tr("Architektura a výpočet PL") + "**", "", tr("Kategorie {cat}, {ch} kanál(y), EDM {edm}, reset ruční; CCF {pts} bodů ({ok}).", { cat: d.cat || "—", ch: d.channels, edm: d.edm ? tr("ano") : tr("ne"), pts: d.ccf.points, ok: d.ccf.ok ? tr("splněno ≥ 65") : tr("NESPLNĚNO < 65") }), "", tr("| Subsystém | Komponenta | Kat. | nop [1/rok] | MTTFd [roky] | DC [%] | PL | Poznámky |"), "|---|---|---|---|---|---|---|---|");
        for (const s of d.subs) {
            const comp = s.comp ? [s.comp.brand, s.comp.series].filter(Boolean).join(" ") + (s.comp.orderCode ? " (" + s.comp.orderCode + ")" : "") + (s.comp.brand ? "" : s.comp.label) : "—";
            L.push("| " + s.role + ": " + cell(s.label) + " | " + cell(comp) + " | " + (s.cat || "—") + " | " + (s.nop ?? "—") + " | " + (s.mttfd ?? "—") + " | " + s.dc + " | **" + (s.pl || "—") + "** | " + cell(s.notes.join("; ")) + " |");
        }
        L.push("", tr("**Dosažené PL: {pl}** — PLr {plr} {res}", { pl: d.pl || "—", plr: f.risk.plr || "—", res: d.ok ? tr("splněno") : tr("NESPLNĚNO") }));
        L.push("", tr("Opatření proti CCF (potvrdí uživatel): {list}", { list: d.ccf.ids.map(id => { const m = D.SAFETY_CCF_MEASURES.find(x => x.id === id); return tr(m.label) + " (" + m.points + ")"; }).join("; ") || "—" }));
        if (d.problems.length)
            L.push("", "**" + tr("Otevřené body návrhu") + "**", ...d.problems.map(x => "- " + x));
        L.push("", "**" + tr("Zapojení") + "**", ...d.wiring.map(x => "- " + x), "", tr("| Signál | Směr | Význam |"), "|---|---|---|", ...d.signals.map(s => "| `" + s.tag + "` | " + (s.dir === "in" ? tr("vstup") : tr("výstup")) + " | " + cell(s.text) + " |"));
    }
    if (dist) {
        L.push("", "**" + tr("Bezpečná vzdálenost (ISO 13855:{ed})", { ed: dist.edition }) + "**", "", tr("Vzorec: `{f}`", { f: dist.formula }));
        if (dist.S !== null)
            L.push("", tr("**S = {s} mm** (T = {t} s, K = {k} mm/s, C = {c} mm)", { s: dist.S, t: dist.T, k: dist.K, c: dist.C }));
        L.push(...dist.steps.map(x => "- " + x), ...dist.missing.map(x => "- **" + tr("chybí: {what}", { what: x }) + "**"), ...dist.warnings.map(x => "- ⚠ " + x));
    }
    L.push("", "**" + tr("Typické komponenty podle zdrojů") + "**", ...f.typical.components.map(x => "- " + x));
    L.push("", "**" + tr("Zdroje") + "**", ...urlList(f.sources));
    return L;
}
/* ================================================================ 14 — plán validace */
export function safetyValidationMd(prj, items = safetyApprovalItems(prj), p = proposeSafety(prj)) {
    const live = p.fns.filter(f => !f.off);
    const L = [
        "# " + tr("Plán ověření a validace bezpečnostních funkcí"),
        "",
        approvalStamp(prj, ["safety"], items).md,
        "",
        tr("**Projekt:** {name} · **Vytvořeno:** {date}", { name: prj.meta.name || "—", date: today() }),
        "",
        tr("Validaci podle ISO 13849-1:2023 kap. 10 (dříve ISO 13849-2) plánuje PLCdesk, provádí a podepisuje ji člověk — nejlépe osoba nezávislá na návrhu (míra nezávislosti podle PLr). Výsledky se zapisují do protokolu oživení (fáze 10, kroky sf:…) a do validační zprávy. Simulace v PLCdesk ověřuje návrh, ne skutečný stroj."),
        "",
        "## 1. " + tr("Validační plán"),
        "",
        tr("| Pole | Obsah |"), "|---|---|",
        "| " + tr("Předmět") + " | " + cell(tr("bezpečnostní části řízení stroje {name}: logika {logic}, vstupní prvky a výstupní skupiny podle 13_bezpecnostni_funkce.md", { name: prj.meta.name || "—", logic: (p.logic.brand || "") + " " + (p.logic.series || "") })) + " |",
        "| " + tr("Bezpečnostní funkce") + " | " + cell(live.map(f => f.id + " " + f.name + " (PLr " + (f.risk.plr || "—") + ")").join("; ") || "—") + " |",
        "| " + tr("Referenční dokumenty") + " | " + cell(tr("13_bezpecnostni_funkce.md (SRS), schéma bezpečnostního okruhu, bezpečnostní program / konfigurace, posouzení rizik, návody komponent")) + " |",
        "| " + tr("Normy") + " | ISO 13849-1:2023, ISO 13849-2:2012, IEC 60204-1, ISO 13850, ISO 14119, ISO 13855, ISO 13851, IEC 61496, IEC 61800-5-2 |",
        "| " + tr("Analýzy a zkoušky") + " | " + cell(tr("A) zapojení a konfigurace, B) normální provoz, C) vnášení poruch (každá porucha → bezpečný stav, reset nejde, dokud porucha trvá), D) měření doběhu a vzdáleností")) + " |",
        "| " + tr("Seznamy poruch") + " | " + cell(tr("ISO 13849-2 příl. A–D (mechanika, pneumatika, hydraulika, elektro); vyloučení poruch jen se zdůvodněním")) + " |",
        "| " + tr("Odpovědné osoby") + " | ……………… |",
        "| " + tr("Podmínky") + " | " + cell(tr("stroj v provozním stavu, nástroje: měřič doběhu, multimetr, propojky pro vnášení poruch; zajištěný prostor")) + " |",
        "| " + tr("Dokumentace výsledků") + " | " + cell(tr("12_protokol_ozivovani.md / .csv (fáze 10), validační zpráva, verze a podpis bezpečnostního programu")) + " |",
        "| " + tr("Kritéria přijetí") + " | " + cell(tr("očekávaný výsledek každé zkoušky splněn; dosažené PL ≥ PLr; bez otevřených bodů; při nesplnění oprava a opakování dotčených zkoušek")) + " |",
        "| " + tr("Formální údaje") + " | " + cell(tr("verze dokumentu, datum, autor, schválení ({file})", { file: APPROVAL_FILE })) + " |",
        "",
        "## 2. " + tr("Blok A — zapojení a konfigurace"),
        "",
        tr("| # | Krok | Očekávaný výsledek | Vyhověl | Poznámka |"), "|---|---|---|---|---|",
        "| A1 | " + tr("Specifikace komponent odpovídají aplikaci (základní a osvědčené principy ISO 13849-2)") + " | " + tr("shoda") + " | ☐ | |",
        "| A2 | " + tr("Vizuálně porovnat zapojení se schématem bezpečnostního okruhu") + " | " + tr("bez odchylek") + " | ☐ | |",
        "| A3 | " + tr("Konfigurace bezpečnostní logiky: program, parametry, podpis / CRC") + " | " + tr("odpovídá schválené verzi") + " | ☐ | |",
        "| A4 | " + tr("Projít všechny bezpečnostní vstupy a výstupy (I/O test)") + " | " + tr("každý signál na správném kanálu") + " | ☐ | |",
        "",
    ];
    let n = 3;
    for (const f of live) {
        L.push("## " + n++ + ". " + f.id + " — " + f.title, "", tr("PLr {plr} · dosažené PL {pl} · kategorie {cat} · kroky oživení `sf:{ref}:…`", { plr: f.risk.plr || "—", pl: f.design?.pl || "—", cat: f.design?.cat || "—", ref: f.ref }), "", tr("| # | Zkouška | Druh | Postup | Očekávaný výsledek | Vyhověl | Poznámka | Zdroj |"), "|---|---|---|---|---|---|---|---|");
        for (const t of f.tests)
            L.push("| " + t.id + " | " + cell(t.name) + " | " + cell(testKindLabel(t.kind)) + " | " + cell(t.procedure) + " | " + cell(t.expected) + " | ☐ | | " + (t.sources[0] || "") + " |");
        if (f.distance)
            L.push("| dist | " + cell(tr("Doba doběhu a bezpečná vzdálenost")) + " | " + cell(testKindLabel("měření")) + " | " + cell(tr("změřit doběh (nejhorší případ) a skutečnou vzdálenost")) + " | " + cell(f.distance.S !== null ? tr("vzdálenost ≥ {s} mm", { s: f.distance.S }) : tr("doplnit změřenou dobu doběhu a spočítat S")) + " | ☐ | | " + (f.distance.sources[0] || "") + " |");
        L.push("");
    }
    L.push("## " + n + ". " + tr("Validační zpráva"), "", tr("Shrnutí výsledků, odchylky a jejich řešení, verze a podpis bezpečnostního programu, seznam použitých vyloučení poruch, zbytková rizika do návodu, interval pravidelných zkoušek."), "", tr("Podpisy: validoval …………………… · nezávislý přezkum …………………… · datum …………"));
    return L.join("\n");
}
/* ================================================================ výkres */
export function safetyCircuitSheet(prj, p = proposeSafety(prj)) {
    const fns = programFunctions(p).filter(f => f.role === "input" && f.kind !== "restart");
    return {
        title: trx("Bezpečnostní okruh (návrh)"), projectName: prj.meta.name || "",
        /* číslo projektu, zákazník a datum zahájení do popisového pole — jen vyplněné (jinak objekt beze změny) */
        ...Object.fromEntries(Object.entries(projectRef(prj)).filter(([, v]) => v)),
        logic: "-K0 " + (p.logic.series || p.logic.label || ""),
        note: trx("NÁVRH K REVIZI — platí jen po schválení bezpečnostních funkcí; svorky podle návodu zvolené logiky."),
        inputs: fns.map(f => {
            const sig = (f.design?.signals || []).filter(s => s.dir === "in" && ["ch", "ossd", "no", "nc"].includes(s.kind));
            const kind = sig.some(s => s.kind === "ossd") ? "ossd" : f.kind === "two_hand" ? "twohand" : sig.length === 1 ? "single" : "nc2";
            return { sf: f.id, dev: f.inputs[0] || "?", label: trx(D.SAFETY_FN_CATALOG[f.catalog].name), tags: sig.map(s => s.tag), kind };
        }),
        outputs: programOutputs(prj, p).map(o => ({ id: o.g.id, label: o.g.devs.join(","), tags: o.g.outs, fbk: o.g.fbk, kind: o.g.kind === "contactors" || o.g.kind === "heater" || o.g.kind === "hydraulic" ? "contactors" : o.g.kind === "sto" ? "sto" : "valve" })),
        reset: "SF_Reset",
    };
}
/* ================================================================ kusovník */
function bomExtras(prj) {
    const p = proposeSafety(prj);
    const live = programFunctions(p);
    if (!live.length)
        return { add: [] };
    const items = safetyApprovalItems(prj);
    const s = safetyApprovalState(prj, items);
    const state = s.fnsApproved ? tr("funkce schválené") : tr("NESCHVÁLENO");
    const note = (sfs) => tr("{sfs} — návrh dle EN ISO 13849, {state}", { sfs: sfs.join(", "), state });
    const add = [];
    const preset = (c) => c ? { brand: c.brand, type: [c.series, c.label].filter(Boolean).join(" — "), orderCode: c.orderCode || "", src: c.sources[0] || "" } : undefined;
    const inFns = live.filter(f => f.role === "input" && f.kind !== "restart");
    const isRelay = p.target === "relay";
    add.push({ tag: "-K0", cat: isRelay ? "safety_relay" : "safety_controller", qty: isRelay ? Math.max(1, inFns.length) : 1,
        item: isRelay ? tr("Bezpečnostní relé") : tr("Bezpečnostní řídicí systém"), desc: tr("Bezpečnostní logika: {sfs}", { sfs: live.map(f => f.id).join(", ") }),
        safety: true, note: note(live.map(f => f.id)), preset: preset(p.logic) });
    for (const g of p.groups) {
        const sfs = live.filter(f => f.acts.includes(g.id)).map(f => f.id);
        if (!sfs.length)
            continue;
        const pr = preset(g.comp);
        if (g.kind === "contactors" || g.kind === "heater") {
            const pre = g.kind === "heater" ? "-KH" : "-KS";
            for (const k of [1, 2])
                add.push({ tag: pre + k, cat: "contactor_mirror", qty: 1, item: tr("Stykač se zrcadlovými kontakty (bezpečnostní)"), desc: g.label, safety: true, note: note(sfs), preset: pr });
        }
        else if (g.kind === "exhaust")
            add.push({ tag: "-" + g.id + "1", cat: "safety_valve", qty: 1, item: tr("Bezpečnostní ventil (pneumatika)"), desc: g.label, safety: true, note: note(sfs), preset: pr });
        else if (g.kind === "hydraulic")
            for (const k of [1, 2])
                add.push({ tag: "-YH" + k, cat: "hydraulic_valve", qty: 1, desc: g.label + " — " + tr("se sledováním polohy šoupátka"), safety: true, note: note(sfs) });
    }
    for (const f of live) {
        if (f.kind === "estop" && !f.inputs.length)
            add.push({ tag: "-S0", cat: "estop_button", qty: 1, desc: tr("Nouzové zastavení (doplnit do projektu)"), safety: true, note: note([f.id]) });
        if (f.kind === "two_hand" && f.inputs.length < 2)
            add.push({ tag: "-S2H", cat: "two_hand_station", qty: 1, item: tr("Dvouruční ovládací pult"), desc: tr("Dvouruční ovládání lisu (typ IIIC)"), safety: true, note: note([f.id]), preset: preset(f.design?.subs.find(x => x.role === "I")?.comp || null) });
    }
    add.push({ tag: "-S0R", cat: "pushbutton", qty: 1, desc: tr("Reset bezpečnostních funkcí (SF_Reset)"), safety: true, note: note(live.map(f => f.id)) });
    return { add, drop: ["-K0:safety_relay"] };
}
/* ================================================================ přihlášení */
function docs(prj, items) {
    const p = proposeSafety(prj);
    return [
        { path: SAFETY_FILE_SRS, tab: tr("Bezpečnost"), title: tr("bezpečnostní funkce: nebezpečí, PLr, architektura, výpočet PL, zapojení (SRS)"), body: safetySrsMd(prj, items, p) },
        { path: SAFETY_FILE_VALIDATION, tab: tr("Validace"), title: tr("plán ověření a validace bezpečnostních funkcí, kontrolní seznamy"), body: safetyValidationMd(prj, items, p) },
    ];
}
function files(prj) {
    const p = proposeSafety(prj);
    const out = [];
    if (!programFunctions(p).length)
        return out;
    const sh = safetyCircuitSheet(prj, p);
    const gSch = tr("Schémata");
    const svg = circuitSheetSVG(sh);
    out.push({ group: gSch, name: "bezpecnostni_okruh.svg", save: "00_bezpecnostni_okruh.svg", body: svg, kind: "svg", dir: "vykresy" });
    out.push({ group: gSch, name: "bezpecnostni_okruh.dxf", save: "00_bezpecnostni_okruh.dxf", body: circuitSheetDXF(sh), kind: "dxf", prev: svg, dir: "vykresy" });
    const prog = safetyProgramFiles(prj);
    const g = tr("Bezpečnostní program — {target}", { target: targetLabel(prog.target) });
    for (const [n, b] of Object.entries(prog.files))
        out.push({ group: g, name: n, save: "safety_" + n, body: b, kind: "text", dir: "kod/safety" });
    return out;
}
/* Přihlášení zapíná klient voláním `registerSafetyModule()` (až bude hotové UI kroku Bezpečnost);
   do té doby schvalování nese zástupnou položku „safety:external“ a sada projektu je beze změny. */
addSafetyRegistration(() => registerDocProvider("safety", { docs, files }));
addSafetyRegistration(() => registerBomProvider((prj) => bomExtras(prj), "safety"));
/** Platformy PLC, pro které má bezpečnostní program textový výstup (informace pro UI). */
export function safetyTargetsFor(prj) {
    const out = [{ target: "relay", label: targetLabel("relay") }, { target: "pilz", label: targetLabel("pilz") }, { target: "sick", label: targetLabel("sick") }, { target: "schmersal", label: targetLabel("schmersal") }];
    if (prj.platforms.includes("siemens"))
        out.unshift({ target: "siemens", label: targetLabel("siemens") });
    if (prj.platforms.includes("rockwell"))
        out.unshift({ target: "rockwell", label: targetLabel("rockwell") });
    if (prj.platforms.some(x => x === "codesys" || x === "omron" || x === "beckhoff"))
        out.unshift({ target: "plcopen", label: targetLabel("plcopen") });
    void PLAT;
    return out;
}
