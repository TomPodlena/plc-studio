/**
 * PLC Studio — generování projektové dokumentace
 * (FDS, I/O list, svorkovnice, alarmy, FAT, návod, SW dokumentace, přehled).
 *
 * Texty jdou přes `tr()` po přirozených jednotkách (nadpis, odstavec, odrážka, řádek
 * hlavičky tabulky, věta v buňce); struktura Markdownu / CSV zůstává mimo klíče.
 */
import { CLS, PLAT, devById, modules, dtFor, usedClasses, interlockDevs, DO_ROLES, } from "./model.js";
import { bomCsv, bomMd } from "./bom.js";
import { tr, N_, today } from "./i18n.js";
import { genFor } from "./codegen.js";
import { svgBlock, sheetSVG, sheetDXF } from "./drawing.js";
import { simulate, docVerifyMd, stepWatchdog, stepTitle, stepCondText } from "./sim.js";
import { svgFlow, svgTiming, svgMachine } from "./flow.js";
function dnes() { return today(); }
function estopTxt(prj) {
    const d = devById(prj, prj.program.estop);
    return d ? d.name + " – " + d.desc : tr("(doplnit)");
}
/** Název akce kroku sekvence (pro `wait` se nepoužívá). */
/** FDS: signalizace s vazbou na stav stroje, meze měření a žádané hodnoty. */
function funcLines(prj) {
    const out = [];
    const roles = prj.devices.filter(d => d.cls === "DO" && d.role);
    const lims = prj.devices.filter(d => d.cls === "AnalogIn" && (Number.isFinite(d.limHi) || Number.isFinite(d.limLo)));
    const sps = prj.devices.filter(d => d.cls === "AnalogOut" && Number.isFinite(d.setpoint));
    if (roles.length) {
        out.push("**" + tr("Signalizace a zámky (vazba na stav stroje)") + "**");
        for (const d of roles)
            out.push("- " + d.name + " (" + (d.desc || "") + ") — " + tr(DO_ROLES[d.role]));
        out.push("");
    }
    if (lims.length) {
        out.push("**" + tr("Hlídané meze měření (překročení = porucha stroje)") + "**");
        for (const d of lims)
            out.push("- " + d.name + " (" + (d.desc || "") + "): " + [Number.isFinite(d.limLo) ? "min " + d.limLo : "", Number.isFinite(d.limHi) ? "max " + d.limHi : ""].filter(Boolean).join(", ") + " " + (d.unit || ""));
        out.push("");
    }
    if (sps.length) {
        out.push("**" + tr("Žádané hodnoty analogových výstupů") + "**");
        for (const d of sps)
            out.push("- " + d.name + " (" + (d.desc || "") + "): " + d.setpoint + " " + (d.unit || ""));
        out.push("");
    }
    return out;
}
function actTxt(act) {
    return act === "start" ? tr("start") : act === "stop" ? tr("stop")
        : act === "open" ? tr("otevřít") : act === "close" ? tr("zavřít")
            : act === "waitOn" ? tr("čekat na TRUE") : act === "waitOff" ? tr("čekat na FALSE") : act;
}
/** Názvy souborů se nepřekládají; záložka a popis jsou klíče překladu (překlad v `docFiles`). */
export const DOC_META = [
    ["00_prehled_dokumentace.md", N_("Přehled"), N_("obsah dokumentace a checklist chybějících dokumentů")],
    ["01_funkcni_specifikace_FDS.md", N_("FDS"), N_("funkční specifikace")],
    ["02_io_list.csv", N_("I/O list"), N_("kompletní I/O list")],
    ["03_svorkovnice.csv", N_("Svorkovnice"), N_("svorkovnice pro projektanta elektro")],
    ["04_seznam_alarmu.csv", N_("Alarmy"), N_("seznam alarmů s reakcemi a kvitací")],
    ["05_testovaci_protokol_FAT.md", N_("FAT"), N_("testovací protokol (loop check, funkční testy, sekvence)")],
    ["06_navod_k_obsluze.md", N_("Návod"), N_("kostra návodu k obsluze")],
    ["07_softwarova_dokumentace.md", N_("SW dok."), N_("struktura a konvence programu")],
    ["08_overeni_simulaci.md", N_("Simulace"), N_("ověření sekvence simulací procesu (běžný cyklus, poruchy, E-stop)")],
    ["09_kusovnik.md", N_("Kusovník"), N_("kusovník komponent se značkami a dodavateli")],
    ["09_kusovnik.csv", N_("Kusovník CSV"), N_("kusovník pro Excel / poptávku")],
];
export function docIndexMd(prj) {
    return [
        "# " + tr("Přehled dokumentace projektu"),
        "",
        tr("**Projekt:** {name} · generováno {date} nástrojem PLC Studio", { name: prj.meta.name || "—", date: dnes() }),
        "",
        "## " + tr("Obsah"),
        DOC_META.map(x => "- `" + x[0] + "` — " + tr(x[2])).join("\n"),
        "- " + tr("schémata — blokové schéma, funkční a časový diagram cyklu, elektrické zapojení I/O (SVG náhled + DXF pro CAD)"),
        "- " + tr("zdrojové soubory programu pro každou zvolenou platformu včetně postupu importu (README)"),
        "",
        "## " + tr("Dokumenty, které sada NEOBSAHUJE a běžný projekt je vyžaduje (doplnit ručně)"),
        "- " + tr("URS / FRS (požadavky zákazníka a funkční požadavky)"),
        "- " + tr("Posouzení rizik a validace bezpečnostních funkcí (ISO 13849 / IEC 62061)"),
        "- " + tr("Kusovník (BOM) a výkresy rozvaděče, as-built elektrodokumentace"),
        "- " + tr("Síťová topologie a IP plán, specifikace HMI/SCADA"),
        "- " + tr("SAT protokol, IQ/OQ (dle odvětví), zálohy programů, prohlášení o shodě (CE)"),
        "",
        tr("Vygenerované dokumenty jsou výchozí návrh k revizi — před předáním zákazníkovi je zkontroluj a doplň."),
    ].join("\n");
}
export function docFDSMd(prj) {
    const mods = modules(prj);
    const L = [
        "# " + tr("Funkční specifikace (FDS)"),
        "",
        "| | |",
        "|---|---|",
        "| **" + tr("Projekt") + "** | " + (prj.meta.name || "—") + " |",
        "| **" + tr("Datum") + "** | " + dnes() + " |",
        "| **" + tr("Revize") + "** | " + tr("0.1 — návrh (PLC Studio)") + " |",
        "",
        "## " + tr("1. Popis stroje a účel"),
        prj.meta.desc || tr("(doplnit)"),
        "",
        "## " + tr("2. Cílové řídicí systémy"),
        prj.platforms.map(p => "- " + tr("{name} — {ide}, {cpu}, jazyk {lang}", { name: PLAT[p].name, ide: PLAT[p].ide, cpu: PLAT[p].cpu, lang: tr(PLAT[p].lang) })).join("\n"),
        "",
        "## " + tr("3. Zařízení"),
        tr("| Označení | Třída | Popis | Parametry |"),
        "|---|---|---|---|",
    ];
    for (const d of prj.devices) {
        const par = d.cls.startsWith("Analog")
            ? ((d.unit || "") + " " + d.rmin + "–" + d.rmax)
            : Object.entries(d.opt || {}).filter(([, v]) => v).map(([k]) => (CLS[d.cls].opts[k] ? tr(CLS[d.cls].opts[k]) : k)).join(", ");
        L.push("| " + d.name + " | " + tr(CLS[d.cls].label) + " | " + (d.desc || "") + " | " + (par || "—") + " |");
    }
    L.push("", "## " + tr("4. I/O bilance a moduly"), ["DI", "DO", "AI", "AO"].map(dd => dd + ": " + prj.io.filter(e => e.dir === dd).length).join(" · "), tr("Navržené moduly: {list}", {
        list: mods.map((m, i) => tr("{mod} (svorkovnice X{x}, {n} kanálů)", { mod: m.dir + m.idx, x: i + 1, n: m.ch.length })).join(", ") || "—",
    }), "", "## " + tr("5. Režimy a ovládání"), "- " + tr("**RUČNĚ** (`modeAuto` = FALSE) — povely na jednotlivá zařízení z HMI: `manRun_<motor>`, `manOpen_<ventil>` (specifikace HMI: doplnit)"), "- " + tr("**AUTO** (`modeAuto` = TRUE) — automatická sekvence dle kap. 6; start (`cmdAutoStart`) podmíněn centrálním uvolněním a stavem bez poruchy; ruční povely jsou v AUTO neúčinné"), "- " + tr("**Kvitace** (`cmdAck`) — zruší poruchu stroje i poruchy bloků po odstranění příčiny"), interlockDevs(prj).length
        ? "- " + tr("**Centrální uvolnění** (`enable`) — {estop} AND blokovací vstupy: {list}. FALSE kteréhokoli z nich zastaví stroj: bloky vypnou výstupy, sekvence se vrátí do kroku 0; po obnovení je nutný nový start", {
            estop: estopTxt(prj), list: interlockDevs(prj).map(d => d.name + (d.desc ? " – " + d.desc : "")).join(", "),
        })
        : "- " + tr("**Centrální uvolnění** — {estop}; podmínky doplnit (kryty, tlak vzduchu…)", { estop: estopTxt(prj) }), "", "## " + tr("6. Automatická sekvence"), prj.program.seq.length ? prj.program.seq.map((sq, i) => {
        const d = devById(prj, sq.dev);
        const akce = sq.act === "wait" ? tr("výdrž {t} s", { t: sq.timeS })
            : ((d ? d.name + " (" + (d.desc || "") + ")" : "?") + " — " + actTxt(sq.act));
        const wd = stepWatchdog(prj, sq);
        return (i + 1) + ". " + (sq.cond === "time" ? tr("{action} · přechod: čas {t} s", { action: akce, t: sq.timeS })
            : wd ? tr("{action} · přechod: zpětné hlášení (hlídací čas {wd} s)", { action: akce, wd })
                : tr("{action} · přechod: zpětné hlášení — zařízení ho nemá, krok přejde ihned", { action: akce }));
    }).join("\n") : tr("(bez automatické sekvence — pouze ruční režim)"), "", ...(prj.meta.takt ? [tr("Požadovaný takt: **{t} s** — splnění ověřuje simulace (protokol 08).", { t: prj.meta.takt }), ""] : []), ...funcLines(prj), "## " + tr("7. Chování při poruše"), tr("Každé typové zařízení hlídá zpětná hlášení s timeoutem a hlásí status: `16#0000` OK, `16#8001` blokováno (enable), `16#8002` porucha. Porucha bloku zastaví zařízení a drží do kvitace."), "", tr("**Porucha stroje** (`machineFault`) vznikne poruchou kteréhokoli bloku nebo vypršením hlídacího času kroku sekvence (`faultStep` = krok). Sekvence se okamžitě vrátí do kroku 0 a vypne všechny své povely; ostatní zařízení tím zastaví také. Nový start je možný až po odstranění příčiny a kvitaci (`cmdAck`). Strategii (okamžité zastavení × dokončení kroku) posoudit dle technologie."), "", "## " + tr("8. Bezpečnost"), tr("Bezpečnostní funkce (nouzové zastavení, kryty, dvouruční ovládání) realizuje certifikovaná bezpečnostní technika dle posouzení rizik (ISO 13849 / IEC 62061) — nejsou předmětem tohoto programu. Signály v PLC slouží pouze k blokování technologie a diagnostice."), "", "## " + tr("9. Mimo rozsah tohoto dokumentu"), tr("URS/FRS, posouzení rizik, HMI/SCADA specifikace, komunikace s nadřazenými systémy, recepty."));
    return L.join("\n");
}
export function docIOcsv(prj) {
    const l = [tr("Tag;Adresa;Směr;Datový typ;Zařízení;Komentář")];
    for (const e of prj.io) {
        const d = devById(prj, e.devId);
        l.push([e.tag, e.addr, e.dir, dtFor(e), d ? d.name : "", e.cmt || ""].join(";"));
    }
    return l.join("\n");
}
export function svorkyCSV(prj) {
    const l = [tr("Svorka;Modul;Kanál;Adresa;Tag;Komentář")];
    modules(prj).forEach((m, mi) => m.ch.forEach((e, i) => l.push("X" + (mi + 1) + ":" + (i + 1) + ";" + m.dir + m.idx + ";" + i + ";" + e.addr + ";" + e.tag + ";" + (e.cmt || ""))));
    return l.join("\n");
}
export function docAlarmCsv(prj) {
    const l = [tr("Kód;Zařízení;Alarm;Příčina;Reakce systému;Kvitace")];
    /* řádek = kód; zařízení; alarm; příčina; reakce; kvitace (buňka = jeden klíč překladu) */
    const row = (...c) => { l.push(c.join(";")); };
    for (const d of prj.devices) {
        if (d.cls === "Motor") {
            row("A_" + d.name + "_START", d.name, tr("Timeout rozběhu"), tr("Nepřišlo zpětné hlášení běhu do 3 s"), tr("Stop zařízení, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po odstranění příčiny"));
            if (d.opt.fault)
                row("A_" + d.name + "_FAULT", d.name, tr("Externí porucha"), tr("Jistič/měnič hlásí poruchu"), tr("Stop zařízení, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po odeznění poruchy"));
            if (d.opt.fbk !== false)
                row("A_" + d.name + "_RUN", d.name, tr("Ztráta hlášení běhu"), tr("Výpadek za chodu"), tr("Stop zařízení, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck)"));
        }
        else if (d.cls === "Ventil") {
            row("A_" + d.name + "_TRAVEL", d.name, tr("Timeout přestavení"), tr("Koncová poloha nedosažena do 5 s"), tr("Výstup vypnut, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck)"));
            if (d.opt.fbkOpen !== false)
                row("A_" + d.name + "_POS", d.name, tr("Ztráta polohy otevřeno"), tr("Koncák „otevřeno“ odpadl v držené poloze"), tr("Výstup vypnut, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po odstranění příčiny"));
        }
        else if (d.cls === "DI" && interlockDevs(prj).some(x => x.id === d.id)) {
            row("A_" + d.name + "_OPEN", d.name, tr("Blokování rozpojeno"), tr("{desc}: vstup FALSE (kryt otevřen / závora přerušena)", { desc: d.desc || d.name }), tr("Stop stroje: výstupy bloků vypnuty, sekvence do kroku 0"), tr("Po obnovení nový start (cmdAutoStart)"));
        }
        else if (d.cls === "AnalogIn") {
            if (Number.isFinite(d.limHi))
                row("A_" + d.name + "_HI", d.name, tr("Překročena horní mez"), tr("Hodnota > {lim} {unit}", { lim: d.limHi, unit: d.unit || "" }), tr("Porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po návratu do mezí"));
            else
                row("A_" + d.name + "_HI", d.name, tr("Překročena horní mez"), tr("Hodnota > limitHi ({unit})", { unit: d.unit || "" }), tr("Dle technologie (doplnit)"), tr("Automaticky po návratu"));
            if (Number.isFinite(d.limLo))
                row("A_" + d.name + "_LO", d.name, tr("Podkročena dolní mez"), tr("Hodnota < {lim} {unit}", { lim: d.limLo, unit: d.unit || "" }), tr("Porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po návratu do mezí"));
            else
                row("A_" + d.name + "_LO", d.name, tr("Podkročena dolní mez"), tr("Hodnota < limitLo ({unit})", { unit: d.unit || "" }), tr("Dle technologie (doplnit)"), tr("Automaticky po návratu"));
        }
    }
    prj.program.seq.forEach((sq, i) => {
        const wd = stepWatchdog(prj, sq);
        if (wd)
            row("A_SEQ_" + (i + 1), tr("sekvence"), tr("Timeout kroku {n} ({title})", { n: i + 1, title: stepTitle(prj, sq) }), tr("Podmínka „{cond}“ nesplněna do {wd} s", { cond: stepCondText(prj, sq), wd }), tr("Porucha stroje: sekvence do kroku 0, povely vypnuty (faultStep = {step})", { step: 10 + i * 10 }), tr("Kvitace (cmdAck) po odstranění příčiny"));
    });
    return l.join("\n");
}
export function docFATMd(prj) {
    const mods = modules(prj);
    /* bod ke kontrole a řádek tabulky s políčkem k zaškrtnutí */
    const chk = (t) => "- " + t + " ☐\n";
    const rowChk = (k, t) => "| " + k + " | " + t + " | ☐ |\n";
    let s = "# " + tr("Testovací protokol FAT") + "\n\n" +
        tr("**Projekt:** {name} · **Datum testu:** ………… · **Testoval:** ………… · **Za zákazníka:** …………", { name: prj.meta.name || "—" }) + "\n\n" +
        tr("Zaškrtni ☐→☑. Neshody zapiš do tabulky na konci. SAT = stejný rozsah po instalaci u zákazníka + skutečné akční členy a technologie.") + "\n\n" +
        "## " + tr("1. Kontrola I/O smyček (loop check)") + "\n" +
        tr("| Svorka | Adresa | Tag | Postup | OK |") + "\n|---|---|---|---|---|\n";
    mods.forEach((m, mi) => m.ch.forEach((e, i) => {
        const how = e.dir === "DI" ? tr("Sepnout snímač/kontakt, ověřit v PLC")
            : e.dir === "DO" ? tr("Vynutit výstup z PLC, ověřit akční člen")
                : e.dir === "AI" ? tr("Zdroj signálu (kalibrátor), ověřit hodnotu a škálování")
                    : tr("Vynutit hodnotu, změřit výstup");
        s += "| X" + (mi + 1) + ":" + (i + 1) + " | " + e.addr + " | " + e.tag + " | " + how + " | ☐ |\n";
    }));
    s += "\n## " + tr("2. Funkční testy zařízení") + "\n";
    for (const d of prj.devices) {
        const head = "**" + d.name + " — " + d.desc + "**";
        if (d.cls === "Motor")
            s += head + "\n" +
                chk(tr("Start → běží, hlášení běhu do 3 s")) +
                chk(tr("Stop → zastaví")) +
                chk(tr("Simulace ztráty hlášení za chodu → porucha, výstup vypnut")) +
                (d.opt.fault ? chk(tr("Simulace externí poruchy → porucha")) : "") +
                chk(tr("Kvitace poruchy")) + "\n";
        else if (d.cls === "Ventil")
            s += head + "\n" +
                chk(tr("Otevřít → dosažena poloha otevřeno")) +
                chk(tr("Zavřít → dosažena poloha zavřeno")) +
                chk(tr("Simulace nedojetí → timeout, porucha")) +
                chk(tr("Kvitace")) + "\n";
        else if (d.cls === "AnalogIn")
            s += head + " (" + (d.unit || "") + " " + d.rmin + "–" + d.rmax + ")\n" +
                chk(tr("Porovnání se skutečnou/kalibrovanou hodnotou ve 3 bodech")) +
                chk(tr("Test mezí Hi/Lo")) + "\n";
    }
    if (prj.program.seq.length) {
        s += "## " + tr("3. Test automatické sekvence") + "\n" + tr("| Krok | Očekávané chování | OK |") + "\n|---|---|---|\n";
        prj.program.seq.forEach((sq, i) => {
            const d = devById(prj, sq.dev);
            /* akce se tu uvádí identifikátorem (start / stop / open / close), jako v programu */
            const akce = sq.act === "wait" ? tr("výdrž {t} s", { t: sq.timeS }) : ((d ? d.name : "?") + " " + sq.act);
            s += rowChk(i + 1, sq.cond === "time" ? tr("{action} → přechod po čase", { action: akce })
                : tr("{action} → přechod na zpětné hlášení", { action: akce }));
        });
        s += rowChk("—", tr("Přerušení centrálního uvolnění uprostřed cyklu → vše bezpečně zastaveno")) +
            rowChk("—", tr("Simulace poruchy bloku / nedojetí v kroku → porucha stroje, sekvence do kroku 0, povely vypnuty")) +
            rowChk("—", tr("Start bez kvitace → cyklus se nespustí")) +
            rowChk("—", tr("Opakovaný start po kvitaci → cyklus od začátku")) +
            rowChk("—", tr("Ruční režim: povely jednotlivých zařízení z HMI; v AUTO neúčinné"));
    }
    s += "\n## " + tr("4. Neshody") + "\n" + tr("| č. | Popis | Závažnost | Vyřešeno |") + "\n|---|---|---|---|\n| | | | |\n\n" +
        tr("**Výsledek FAT:** VYHOVĚL / VYHOVĚL S VÝHRADAMI / NEVYHOVĚL") + "\n\n" +
        tr("Podpisy: …………………………");
    return s;
}
export function docManualMd(prj) {
    return [
        "# " + tr("Návod k obsluze — {name}", { name: prj.meta.name || tr("stroj") }),
        "",
        tr("Revize 0.1 ({date}) — kostra k doplnění; před předáním doplnit fotografie, ovládací panel a kontakty.", { date: dnes() }),
        "",
        "## " + tr("1. Popis stroje"),
        prj.meta.desc || tr("(doplnit)"),
        "",
        "## " + tr("2. Ovládací prvky"),
        tr("(doplnit: hlavní vypínač, panel HMI, tlačítka, signalizace — {list})", { list: prj.devices.filter(d => d.cls === "DO").map(d => d.name + " " + d.desc).join(", ") || "—" }),
        "",
        "## " + tr("3. Uvedení do chodu"),
        "1. " + tr("Zapnout hlavní vypínač, zkontrolovat signalizaci."),
        "2. " + tr("Odblokovat nouzové zastavení ({estop}), zavřít kryty.", { estop: estopTxt(prj) }),
        "3. " + tr("Zvolit režim RUČNĚ/AUTO."),
        "4. " + tr("V režimu AUTO spustit cyklus tlačítkem start."),
        "",
        "## " + tr("4. Zastavení"),
        "- " + tr("Provozní: tlačítko stop / dokončení cyklu."),
        "- " + tr("Nouzové: tlačítko nouzového zastavení — POUZE v nebezpečí; po použití nutná kvitace."),
        "",
        "## " + tr("5. Poruchy a jejich odstranění"),
        tr("Seznam alarmů: viz `{file}`. Obecný postup: odstranit příčinu → kvitovat → znovu spustit. Opakuje-li se porucha, kontaktovat údržbu.", { file: "04_seznam_alarmu.csv" }),
        "",
        "## " + tr("6. Údržba"),
        tr("(doplnit intervaly: mazání, kontrola snímačů, dotažení svorek, kalibrace analogů — doporučeno 1× ročně)"),
        "",
        "## " + tr("7. Bezpečnostní upozornění"),
        tr("Zásahy do elektrické výzbroje smí provádět jen osoba s odpovídající kvalifikací. Bezpečnostní prvky nesmí být vyřazovány."),
    ].join("\n");
}
export function docSWMd(prj) {
    const u = usedClasses(prj);
    return [
        "# " + tr("Softwarová dokumentace programu PLC"),
        "",
        tr("**Projekt:** {name} · generováno {date}", { name: prj.meta.name || "—", date: dnes() }),
        "",
        "## " + tr("1. Struktura programu"),
        "- " + tr("**Knihovna typových bloků** (`Gen_Library`): {list}", { list: ["Motor", "Ventil", "AnalogIn", "AnalogOut"].filter(c => u.has(c)).map(c => "FB_" + c).join(", ") || "—" }),
        "- " + tr("**Strojní blok** `FB_Machine` / `MAIN`: multi-instance všech zařízení + stavový automat sekvence s hlídáním času kroků, režimy AUTO / ručně (`modeAuto`, `manRun_*`, `manOpen_*`), porucha stroje (`machineFault`, `faultStep`) a kvitace (`cmdAck` → vstup `reset` všech bloků)"),
        "- " + tr("Volání: 1 instance strojního bloku v cyklickém programu (OB1 / PlcTask / MainTask)"),
        ...(prj.platforms.includes("unitronics") ? [
            "- " + tr("**Unitronics (UniLogic):** ST funkce nemá vlastní paměť, proto se knihovna bloků negeneruje — stejná logika je rozepsaná v jedné funkci `Machine.st` a stav každého zařízení je v globálních tazích `instX_*` (seznam v `Tags.csv`). Výstup nebyl ověřen překladem v UniLogic."),
        ] : []),
        "",
        "## " + tr("2. Typové bloky"),
        tr("| Blok | Funkce | Stavový automat | Timeout |"),
        "|---|---|---|---|",
        "| FB_Motor | " + tr("start/stop se zpětným hlášením") + " | IDLE→STARTING→RUNNING→ERROR | " + tr("rozběh 3 s") + " |",
        "| FB_Ventil | " + tr("otevřít/zavřít s koncáky") + " | CLOSED→OPENING→OPEN→CLOSING→ERROR | " + tr("přestavení 5 s") + " |",
        "| FB_AnalogIn | " + tr("škálování + meze") + " | — | — |",
        "| FB_AnalogOut | " + tr("jednotky → surová hodnota") + " | — | — |",
        "",
        "## " + tr("3. Instance"),
        prj.devices.map(d => "- inst" + d.name + " : FB_" + (d.cls === "DI" || d.cls === "DO" ? tr("(volný signál)") : d.cls) + " — " + (d.desc || "")).join("\n"),
        "",
        "## " + tr("4. Statusová slova"),
        tr("`16#0000` OK · `16#8001` blokováno (enable=FALSE) · `16#8002` porucha. Rozšíření kódů doplnit dle projektu."),
        "",
        "## " + tr("5. Konvence"),
        tr("Symbolické adresování, bez M-flagů; tagy `<Zařízení>_<signál>`; hrany uvnitř FB; každý čekací stav má timeout do ERROR. Dle Siemens Programming Styleguide (ID 81318674) / IEC 61131-3."),
        "",
        "## " + tr("6. Verze a zálohy"),
        tr("| Verze | Datum | Autor | Změna |"),
        "|---|---|---|---|",
        "| 0.1 | " + dnes() + " | PLC Studio | " + tr("první generování") + " |",
    ].join("\n");
}
export function docFiles(prj) {
    const bodies = [
        docIndexMd(prj), docFDSMd(prj), docIOcsv(prj), svorkyCSV(prj),
        docAlarmCsv(prj), docFATMd(prj), docManualMd(prj), docSWMd(prj), docVerifyMd(prj),
        bomMd(prj), bomCsv(prj),
    ];
    return DOC_META.map((m, i) => ({ path: m[0], tab: tr(m[1]), title: tr(m[2]), body: bodies[i] }));
}
/** Úplná sada souborů projektu: dokumenty + schémata (SVG/DXF) + zdroje platforem. */
export function allProjectFiles(prj) {
    const out = [];
    const gDocs = tr("Dokumentace"), gSch = tr("Schémata");
    for (const f of docFiles(prj))
        out.push({ group: gDocs, name: f.path, save: f.path, body: f.body, kind: "text" });
    const mods = modules(prj);
    out.push({ group: gSch, name: "blokove_schema.svg", save: "00_blokove_schema.svg", body: svgBlock(prj, mods), kind: "svg" });
    out.push({ group: gSch, name: "schema_stroje.svg", save: "00_schema_stroje.svg", body: svgMachine(prj), kind: "svg" });
    if (prj.program.seq.length) {
        const run = simulate(prj);
        out.push({ group: gSch, name: "funkcni_diagram.svg", save: "00_funkcni_diagram.svg", body: svgFlow(prj, run), kind: "svg" });
        out.push({ group: gSch, name: "casovy_diagram.svg", save: "00_casovy_diagram.svg", body: svgTiming(prj, run), kind: "svg" });
    }
    mods.forEach((m, i) => {
        const base = m.dir + m.idx + "_X" + (i + 1), pre = String(i + 1).padStart(2, "0") + "_";
        out.push({ group: gSch, name: base + ".svg", save: pre + base + ".svg", body: sheetSVG(prj, m, i + 1, i + 1, mods.length), kind: "svg" });
        out.push({ group: gSch, name: base + ".dxf", save: pre + base + ".dxf", body: sheetDXF(prj, m, i + 1, i + 1, mods.length), kind: "dxf", prev: sheetSVG(prj, m, i + 1, i + 1, mods.length) });
    });
    for (const p of prj.platforms) {
        const files = genFor(prj, p);
        for (const [n, b] of Object.entries(files))
            out.push({ group: tr("PLC — {name}", { name: PLAT[p].name }), name: n, save: p + "_" + n, body: b, kind: "text" });
    }
    return out;
}
