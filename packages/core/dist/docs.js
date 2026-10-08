/**
 * PLCdesk — generování projektové dokumentace
 * (FDS, I/O list, svorkovnice, alarmy, FAT, návod, SW dokumentace, přehled).
 *
 * Texty jdou přes `tr()` po přirozených jednotkách (nadpis, odstavec, odrážka, řádek
 * hlavičky tabulky, věta v buňce); struktura Markdownu / CSV zůstává mimo klíče.
 */
import { CLS, PLAT, devById, modules, wireNo, dtFor, usedClasses, interlockDevs, DO_ROLES, codeStyleFor, isMotionClass, hasRange, ioOf, rampStepOf, tolOf, tolTicksOf, selBitsOf, maxRecord, stepSp, stepAxisTarget, } from "./model.js";
import { axisCfgOf, axisObjName } from "./axis.js";
import { axisSupport, AXIS_LIB, AXIS_NET } from "./axis_gen.js";
import { bomCsv, bomMd } from "./bom.js";
import { hwAddrText, hwTypeText, hwSummary, hwPlatform } from "./hardware.js";
import { tr, N_, today } from "./i18n.js";
import { genFor, codeLibrary } from "./codegen.js";
import { libraryDocHeader } from "./library.js";
import { oopInProject, oopProgram, oopClassSvg, OOP_CLASS_SVG } from "./codegen_oop.js";
import { svgBlock, sheetSVG, sheetDXF } from "./drawing.js";
import { conceptMd } from "./concept.js";
import { simulate, docVerifyMd, stepWatchdog, stepTitle, stepCondText, T_VFD_SPEED, T_POS_ACK, T_POS_MOVE, T_PROP_SETTLE, T_AXIS_POWER } from "./sim.js";
import { svgFlow, svgTiming, svgMachine } from "./flow.js";
import { approvalItems, approvalStamp, approvalsMd, designView, APPROVAL_FILE } from "./approval.js";
import { commissioningPlan, commissioningMd, commissioningCsv, COMMISSION_FILE_MD, COMMISSION_FILE_CSV } from "./commission.js";
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
    out.push(...motionFdsLines(prj));
    out.push(...axisFdsLines(prj));
    return out;
}
/**
 * FDS: servoosy (fáze 2b) — obálka FB_Axis, platformy, povely kroků, poruchy, ruční ovládání a co se
 * nastavuje v IDE. Bez os prázdné (dokumentace beze změny).
 */
export function axisFdsLines(prj) {
    const axes = prj.devices.filter(d => d.cls === "Axis");
    if (!axes.length)
        return [];
    const out = ["**" + tr("Servoosy (polohování po síti, PLCopen Motion)") + "**"];
    for (const d of axes) {
        const c = axisCfgOf(d), u = d.unit || "mm";
        out.push("- " + d.name + " (" + (d.desc || tr(CLS.Axis.label)) + "): " + tr("objekt osy {obj}; max. rychlost {v} {u}/s, zrychlení {a} {u}/s², zpomalení {dd} {u}/s², výchozí rychlost {vd} {u}/s; SW limity {lim}; referenční poloha {home} {u}; okno v poloze ± {tol} {u}; max. chyba sledování {fe} {u}.", {
            obj: axisObjName(d), v: c.vMax, a: c.aMax, dd: c.dMax, vd: c.vDef, u, home: c.homePos, tol: c.posTol, fe: c.followMax,
            lim: c.limNeg !== undefined || c.limPos !== undefined ? (c.limNeg ?? "—") + " … " + (c.limPos ?? "—") + " " + u : tr("nenastaveny")
        }));
        if (c.positions.length)
            out.push("  " + tr("Pojmenované polohy: {list}.", { list: c.positions.map(x => x.name + " = " + x.pos + " " + u).join(", ") }));
    }
    out.push("- " + tr("Blok FB_Axis zapíná regulaci (v AUTO sekvence, ručně povel manPower_<osa>) a provádí povely kroků: referování, najetí na polohu, posun o dráhu, rychlost, zastavení. Krok s přechodem na hlášení přejde, až blok hlásí dokončení svého povelu (done a doneId = číslo kroku); krok s přechodem časem pohyb jen spustí a „čekat na dokončení pohybu“ počká později. Nový pohyb čeká na dokončení běžícího, zastavení a přerušení sekvence platí hned."));
    out.push("- " + tr("Porucha (errCode): 1 porucha osy — pohon, chyba sledování (zaseknutá mechanika), ztráta komunikace, softwarový limit (příčina v diagnostice osy); 2 regulace nezapnuta do {t} s; 3 absolutní polohování bez referování; 7 povel odmítnut blokem MC. Porucha osy zastaví sekvenci (porucha stroje), regulace se vypne; po odstranění příčiny kvitace (MC_Reset) a nové zapnutí.", { t: T_AXIS_POWER }));
    out.push("- " + tr("Ruční režim (mimo AUTO): regulace manPower_<osa>, referování manHome_<osa> (hrana), pojezd manJogP_ / manJogN_<osa> (držet; po E-stopu nebo poruše až po puštění a novém stisku)."));
    const plats = prj.platforms.map(p => ({ p, s: axisSupport(prj, p) }));
    out.push("- " + tr("Platformy: {list}.", { list: plats.map(x => PLAT[x.p].name + " — " + (x.s.ok ? AXIS_LIB[x.s.dialect] + ", " + AXIS_NET[x.s.dialect] : tr("nepodporuje (kód se negeneruje)"))).join("; ") }));
    out.push("- " + tr("Osa a pohon se zakládají v IDE (technologický objekt / osa NC / osa SoftMotion / Axis Settings / Motion Group) podle konfiguračního listu v README platformy — import je nepřenese. Bezpečnostní funkce pohonu (STO, SS1, SLS) řeší pohon s integrovanou bezpečností nebo bezpečnostní PLC; standardní program jen čte stav."));
    out.push("");
    return out;
}
/**
 * FDS: pohony a proporcionální prvky fáze 2a — co blok dělá, jaké hlášení čeká, kdy vyhlásí poruchu
 * (kódy errCode) a co se nastavuje v pohonu. Bez těchto zařízení prázdné (dokumentace beze změny).
 */
export function motionFdsLines(prj) {
    const devs = prj.devices.filter(d => isMotionClass(d.cls));
    if (!devs.length)
        return [];
    const out = ["**" + tr("Pohony a proporcionální prvky (přes běžné I/O)") + "**"];
    for (const d of devs) {
        const io = ioOf(prj, d), head = "- " + d.name + " (" + (d.desc || tr(CLS[d.cls].label)) + "): ";
        const ramp = rampStepOf(d) ? tr("rampa v PLC {t} s na celý rozsah (po taktech 0,1 s)", { t: d.rampS }) : tr("bez rampy v PLC");
        if (d.cls === "Vfd")
            out.push(head + tr("frekvenční měnič — chod {run}, žádaná {min}–{max} {unit} na analogový výstup, {ramp}. Krok rozběhu / změny otáček přejde, až blok hlásí „otáčky dosaženy“ ({fbk}). Porucha: vstup poruchy měniče, měnič nepřipraven za chodu, ztráta hlášení otáček za chodu, otáčky nedosaženy do {t} s po doběhu rampy.", {
                run: io.outRun ? io.outRun.tag : "—", min: d.rmin, max: d.rmax, unit: d.unit || "", ramp, t: T_VFD_SPEED,
                fbk: io.atSpeed ? tr("reléový výstup měniče {tag}", { tag: io.atSpeed.tag }) : tr("bez hlášení — po doběhu rampy")
            }));
        else if (d.cls === "PosDrive") {
            const recs = (d.records || []).map(r => r.no + " = " + (r.name || "?") + (Number.isFinite(r.pos) ? " (" + r.pos + ")" : "")).join(", ");
            out.push(head + tr("polohovací pohon se záznamy — výběr záznamu {bits} bity (1–{max}: {recs}), start, referenční jízda a HALT. Jízda se potvrzuje poklesem „v poloze“ do {ack} s a končí hlášením „v poloze“ (nejvýš {move} s); krok přejde, až blok hlásí dosažený záznam. Porucha: vstup poruchy, pohon nepřipraven, jízda bez referování, ztráta „v poloze“ v klidu, timeout. Přerušení sekvence pohyb zastaví (HALT).", {
                bits: selBitsOf(d), max: maxRecord(d), recs: recs || "—", ack: T_POS_ACK, move: T_POS_MOVE
            }));
        }
        else
            out.push(head + tr("proporcionální ventil — žádaná {min}–{max} {unit}, {ramp}; {fbk}. Krok přejde, až je žádaná po rampě dosažena{tolTxt}.", {
                min: d.rmin, max: d.rmax, unit: d.unit || "", ramp,
                fbk: io.rawAct ? tr("skutečná hodnota {tag}, odchylka nad ± {tol} {unit} déle než {t} s = porucha", { tag: io.rawAct.tag, tol: tolOf(d), unit: d.unit || "", t: tolTicksOf(d) / 10 }) : tr("bez zpětné vazby"),
                tolTxt: io.rawAct ? tr(" a skutečná hodnota je v toleranci (nejvýš {t} s po doběhu rampy)", { t: T_PROP_SETTLE }) : ""
            }));
    }
    out.push("- " + tr("Kód chyby bloku errCode (HMI, diagnostika): 1 porucha pohonu, 2 nepřipraven, 3 bez referování, 4 ztráta hlášení, 5 timeout, 6 odchylka skutečné hodnoty."));
    out.push("- " + tr("Bezpečnost pohonů (STO, odvětrání ventilu) zajišťuje bezpečnostní technika podle posouzení rizik; v programu jsou jen stavové signály."));
    out.push("");
    return out;
}
function actTxt(act) {
    return act === "start" ? tr("start") : act === "stop" ? tr("stop")
        : act === "open" ? tr("otevřít") : act === "close" ? tr("zavřít")
            : act === "waitOn" ? tr("čekat na TRUE") : act === "waitOff" ? tr("čekat na FALSE")
                : act === "home" ? tr("referenční jízda") : act === "posRecord" ? tr("jízda na záznam")
                    : act === "setPressure" ? tr("nastavit tlak") : act === "setFlow" ? tr("nastavit průtok")
                        : act === "moveAbs" ? tr("najet na polohu") : act === "moveRel" ? tr("posun o dráhu") : act === "velocity" ? tr("rychlost")
                            : act === "halt" ? tr("zastavit osu") : act === "waitInPos" ? tr("čekat na dokončení pohybu") : act;
}
/** Akce kroku s parametrem (otáčky, záznam, žádaná) pro FDS. */
function actFull(prj, sq, d) {
    if (d && d.cls === "Vfd" && sq.act === "start")
        return actTxt(sq.act) + " " + stepSp(sq, d) + " " + (d.unit || "") + (sq.rev && d.opt?.rev ? " " + tr("vzad") : "");
    if (sq.act === "posRecord")
        return actTxt(sq.act) + " " + (sq.rec ?? "?");
    if ((sq.act === "setPressure" || sq.act === "setFlow") && d)
        return actTxt(sq.act) + " " + stepSp(sq, d) + " " + (d.unit || "");
    if (d && d.cls === "Axis" && (sq.act === "moveAbs" || sq.act === "moveRel"))
        return actTxt(sq.act) + " " + stepAxisTarget(sq, d) + " " + (d.unit || "") + (sq.posRef ? " (" + sq.posRef + ")" : "")
            + (sq.vel ? ", " + tr("rychlost {v}", { v: sq.vel }) : "");
    if (d && d.cls === "Axis" && sq.act === "velocity")
        return actTxt(sq.act) + " " + stepAxisTarget(sq, d) + " " + (d.unit || "") + "/s";
    if (d && d.cls === "Axis" && sq.act === "home")
        return tr("referování osy");
    return actTxt(sq.act);
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
    [APPROVAL_FILE, N_("Schválení"), N_("schválení položek návrhu: stav, kdo, kdy, poznámka")],
    [COMMISSION_FILE_MD, N_("Oživení"), N_("plán a protokol oživení po fázích")],
    [COMMISSION_FILE_CSV, N_("Oživení CSV"), N_("protokol oživení k tisku a vyplnění")],
];
/**
 * Razítko stavu schválení v dokumentech: které skupiny položek dokument pokrývá
 * ([] = všechny povinné). Dokumenty, které tu nejsou, razítko nenesou (CSV, koncept);
 * 11 a 12 ho mají ve vlastním těle.
 */
const DOC_STAMP = {
    "00_prehled_dokumentace.md": [],
    "01_funkcni_specifikace_FDS.md": ["design", "program"],
    "05_testovaci_protokol_FAT.md": ["design", "program"],
    "06_navod_k_obsluze.md": ["design", "program"],
    "07_softwarova_dokumentace.md": ["program"],
    "08_overeni_simulaci.md": ["verify"],
    "09_kusovnik.md": ["design"],
};
/**
 * Protokol ověření nad návrhem (`designView`): cache ověření je tak společná se schvalováním
 * a změna názvu projektu, schválení nebo výsledků oživení ověření znovu nespouští. Návrh nemá
 * název projektu — do hlavičky se dosadí zpět.
 */
function verifyDocMd(prj) {
    const body = docVerifyMd(designView(prj));
    const head = (name) => tr("**Projekt:** {name} · generováno nástrojem PLCdesk", { name });
    return body.replace(head("—"), head(prj.meta.name || "—"));
}
/** Vloží razítko (řádek Markdownu) pod nadpis dokumentu. */
function stampBody(body, md) {
    if (!md)
        return body;
    const lines = body.split("\n");
    if (!lines[0].startsWith("# "))
        return md + "\n\n" + body;
    lines.splice(1, 0, "", md);
    return lines.join("\n");
}
export function docIndexMd(prj) {
    return [
        "# " + tr("Přehled dokumentace projektu"),
        "",
        tr("**Projekt:** {name} · generováno {date} nástrojem PLCdesk", { name: prj.meta.name || "—", date: dnes() }),
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
        "| **" + tr("Revize") + "** | " + tr("0.1 — návrh (PLCdesk)") + " |",
        "",
        "## " + tr("1. Popis stroje a účel"),
        prj.meta.desc || tr("(doplnit)"),
        "",
        ...(prj.concept ? ["### " + tr("Zvolený koncept řešení: {name}", { name: prj.concept.nazev }), prj.concept.shrnuti,
            tr("Podrobně viz {file}.", { file: "`" + CONCEPT_FILE + "`" }), ""] : []),
        "## " + tr("2. Cílové řídicí systémy"),
        prj.platforms.map(p => "- " + tr("{name} — {ide}, {cpu}, jazyk {lang}", { name: PLAT[p].name, ide: PLAT[p].ide, cpu: PLAT[p].cpu, lang: tr(PLAT[p].lang) })).join("\n"),
        "",
        "## " + tr("3. Zařízení"),
        tr("| Označení | Třída | Popis | Parametry |"),
        "|---|---|---|---|",
    ];
    for (const d of prj.devices) {
        const opts = Object.entries(d.opt || {}).filter(([, v]) => v).map(([k]) => (CLS[d.cls].opts[k] ? tr(CLS[d.cls].opts[k]) : k)).join(", ");
        const par = d.cls.startsWith("Analog")
            ? ((d.unit || "") + " " + d.rmin + "–" + d.rmax)
            : hasRange(d.cls) ? [(d.unit || "") + " " + d.rmin + "–" + d.rmax, opts].filter(x => x.trim()).join(", ")
                : d.cls === "PosDrive" ? [tr("záznamy 1–{max}", { max: maxRecord(d) }), opts].filter(Boolean).join(", ")
                    : d.cls === "Axis" ? tr("{u}, max. {v} {u}/s, {a} {u}/s²", { u: d.unit || "mm", v: axisCfgOf(d).vMax, a: axisCfgOf(d).aMax })
                        : opts;
        L.push("| " + d.name + " | " + tr(CLS[d.cls].label) + " | " + (d.desc || "") + " | " + (par || "—") + " |");
    }
    L.push("", "## " + tr("4. I/O bilance a moduly"), ["DI", "DO", "AI", "AO"].map(dd => dd + ": " + prj.io.filter(e => e.dir === dd).length).join(" · "), tr("Navržené moduly: {list}", {
        list: mods.map((m, i) => tr("{mod} (svorkovnice X{x}, {n} kanálů)", { mod: (m.hw ? m.hw.dt + " " : "") + m.dir + m.idx, x: i + 1, n: m.ch.length })).join(", ") || "—",
    }), "", tr("Sestava hardwaru ({plat}; počty a typy = kusovník, adresy = výchozí návrh k ověření v IDE):", { plat: PLAT[hwPlatform(prj)].name }), "", ...hwSummary(prj).map(x => "    " + x), "", "## " + tr("5. Režimy a ovládání"), "- " + tr("**RUČNĚ** (`modeAuto` = FALSE) — povely na jednotlivá zařízení z HMI: `manRun_<motor>`, `manOpen_<ventil>` (specifikace HMI: doplnit)")
        + (prj.devices.some(d => isMotionClass(d.cls)) ? "; " + tr("měnič `manRun_<měnič>` (výchozí otáčky), polohovací pohon `manHome_<pohon>` (referenční jízda), proporcionální ventil `manOn_<ventil>` (výchozí žádaná)") : "")
        + (prj.devices.some(d => d.cls === "Axis") ? "; " + tr("servoosa `manPower_<osa>` (regulace), `manHome_<osa>` (referování), `manJogP_` / `manJogN_<osa>` (pojezd, držet)") : ""), "- " + tr("**AUTO** (`modeAuto` = TRUE) — automatická sekvence dle kap. 6; start (`cmdAutoStart`) podmíněn centrálním uvolněním a stavem bez poruchy; ruční povely jsou v AUTO neúčinné"), "- " + tr("**Kvitace** (`cmdAck`) — zruší poruchu stroje i poruchy bloků po odstranění příčiny"), interlockDevs(prj).length
        ? "- " + tr("**Centrální uvolnění** (`enable`) — {estop} AND blokovací vstupy: {list}. FALSE kteréhokoli z nich zastaví stroj: bloky vypnou výstupy, sekvence se vrátí do kroku 0; po obnovení je nutný nový start", {
            estop: estopTxt(prj), list: interlockDevs(prj).map(d => d.name + (d.desc ? " – " + d.desc : "")).join(", "),
        })
        : "- " + tr("**Centrální uvolnění** — {estop}; podmínky doplnit (kryty, tlak vzduchu…)", { estop: estopTxt(prj) }), "", "## " + tr("6. Automatická sekvence"), prj.program.seq.length ? prj.program.seq.map((sq, i) => {
        const d = devById(prj, sq.dev);
        const akce = sq.act === "wait" ? tr("výdrž {t} s", { t: sq.timeS })
            : ((d ? d.name + " (" + (d.desc || "") + ")" : "?") + " — " + actFull(prj, sq, d));
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
        l.push([e.tag, hwAddrText(prj, e), e.dir, dtFor(e), d ? d.name : "", e.cmt || ""].join(";"));
    }
    return l.join("\n");
}
export function svorkyCSV(prj) {
    const l = [tr("Svorka;Modul;Kanál;Adresa;Tag;Vodič;Komentář;Označení;Typ")];
    modules(prj).forEach((m, mi) => m.ch.forEach((e, i) => l.push("X" + (mi + 1) + ":" + (i + 1) + ";" + m.dir + m.idx + ";" + (m.chNo?.[i] ?? i) + ";" + hwAddrText(prj, e) + ";" + e.tag + ";" + wireNo(mi + 1, i) + ";" + (e.cmt || "")
        + ";" + (m.hw?.dt || "") + ";" + (m.hw ? (m.hw.opt?.orderCode || m.hw.custom || hwTypeText(m.hw)) : ""))));
    return l.join("\n");
}
export function docAlarmCsv(prj) {
    const l = [tr("Kód;Zařízení;Alarm;Příčina;Reakce systému;Kvitace")];
    /* řádek = kód; zařízení; alarm; příčina; reakce; kvitace (buňka = jeden klíč překladu) */
    const row = (...c) => { l.push(c.join(";")); };
    for (const d of prj.devices) {
        if (d.cls === "Motor") {
            row("A_" + d.name + "_START", d.name, tr("Timeout rozběhu"), tr("Nepřišlo zpětné hlášení běhu do 3 s"), tr("Stop zařízení, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po odstranění příčiny"));
            if (d.opt?.fault)
                row("A_" + d.name + "_FAULT", d.name, tr("Externí porucha"), tr("Jistič/měnič hlásí poruchu"), tr("Stop zařízení, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po odeznění poruchy"));
            if (d.opt?.fbk !== false)
                row("A_" + d.name + "_RUN", d.name, tr("Ztráta hlášení běhu"), tr("Výpadek za chodu"), tr("Stop zařízení, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck)"));
        }
        else if (d.cls === "Ventil") {
            row("A_" + d.name + "_TRAVEL", d.name, tr("Timeout přestavení"), tr("Koncová poloha nedosažena do 5 s"), tr("Výstup vypnut, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck)"));
            if (d.opt?.fbkOpen !== false)
                row("A_" + d.name + "_POS", d.name, tr("Ztráta polohy otevřeno"), tr("Koncák „otevřeno“ odpadl v držené poloze"), tr("Výstup vypnut, porucha stroje (stop sekvence)"), tr("Kvitace (cmdAck) po odstranění příčiny"));
        }
        else if (d.cls === "Vfd") {
            const stop = tr("Stop měniče, porucha stroje (stop sekvence)");
            if (d.opt?.fault !== false)
                row("A_" + d.name + "_FAULT", d.name, tr("Porucha měniče"), tr("Měnič hlásí poruchu (vstup poruchy)"), stop, tr("Kvitace (cmdAck) po odeznění poruchy"));
            if (d.opt?.ready !== false)
                row("A_" + d.name + "_READY", d.name, tr("Měnič nepřipraven"), tr("Hlášení „připraven“ chybí při povelu chod"), stop, tr("Kvitace (cmdAck) po odstranění příčiny"));
            if (d.opt?.fbk !== false)
                row("A_" + d.name + "_SPEED", d.name, tr("Ztráta otáček"), tr("Hlášení „otáčky dosaženy“ odpadlo za chodu"), stop, tr("Kvitace (cmdAck)"));
            row("A_" + d.name + "_TIMEOUT", d.name, tr("Otáčky nedosaženy"), tr("Hlášení „otáčky dosaženy“ nepřišlo do {t} s po doběhu rampy", { t: T_VFD_SPEED }), stop, tr("Kvitace (cmdAck)"));
        }
        else if (d.cls === "PosDrive") {
            const stop = tr("Zastavení pohonu (HALT), porucha stroje (stop sekvence)");
            if (d.opt?.fault !== false)
                row("A_" + d.name + "_FAULT", d.name, tr("Porucha pohonu"), tr("Řadič pohonu hlásí poruchu (vstup poruchy)"), stop, tr("Kvitace (cmdAck) po odeznění poruchy"));
            if (d.opt?.ready !== false)
                row("A_" + d.name + "_READY", d.name, tr("Pohon nepřipraven"), tr("Hlášení „připraven“ chybí během jízdy"), stop, tr("Kvitace (cmdAck) po odstranění příčiny"));
            row("A_" + d.name + "_NOTHOMED", d.name, tr("Bez referování"), tr("Povel jízdy na záznam bez referenční jízdy"), stop, tr("Kvitace (cmdAck), pak referenční jízda"));
            row("A_" + d.name + "_POS", d.name, tr("Ztráta polohy"), tr("Hlášení „v poloze“ odpadlo v dosažené poloze"), stop, tr("Kvitace (cmdAck) po odstranění příčiny"));
            row("A_" + d.name + "_TIMEOUT", d.name, tr("Timeout jízdy"), tr("Start nepotvrzen do {ack} s nebo jízda / referování déle než {move} s", { ack: T_POS_ACK, move: T_POS_MOVE }), stop, tr("Kvitace (cmdAck)"));
        }
        else if (d.cls === "Axis") {
            const stop = tr("Osa zastavena, regulace vypnuta, porucha stroje (stop sekvence)");
            row("A_" + d.name + "_AXIS", d.name, tr("Porucha osy"), tr("Pohon / chyba sledování / ztráta komunikace / softwarový limit (příčina v diagnostice osy)"), stop, tr("Kvitace (cmdAck) po odstranění příčiny — MC_Reset, nové zapnutí regulace"));
            row("A_" + d.name + "_POWER", d.name, tr("Regulace nezapnuta"), tr("Osa nehlásí zapnutou regulaci do {t} s", { t: T_AXIS_POWER }), stop, tr("Kvitace (cmdAck) po odstranění příčiny"));
            row("A_" + d.name + "_NOTHOMED", d.name, tr("Bez referování"), tr("Absolutní polohování bez referování osy"), stop, tr("Kvitace (cmdAck), pak referování"));
            row("A_" + d.name + "_CMD", d.name, tr("Povel osy odmítnut"), tr("Blok MC hlásí chybu povelu (parametry, limity, stav osy)"), stop, tr("Kvitace (cmdAck) po opravě povelu"));
        }
        else if (d.cls === "PropValve") {
            const stop = tr("Žádaná na minimum, porucha stroje (stop sekvence)");
            if (ioOf(prj, d).rawAct)
                row("A_" + d.name + "_DEV", d.name, tr("Odchylka skutečné hodnoty"), tr("Skutečná hodnota mimo ± {tol} {unit} déle než {t} s", { tol: tolOf(d), unit: d.unit || "", t: tolTicksOf(d) / 10 }), stop, tr("Kvitace (cmdAck) po odstranění příčiny"));
            row("A_" + d.name + "_TIMEOUT", d.name, tr("Žádaná nedosažena"), ioOf(prj, d).rawAct ? tr("Skutečná hodnota není v toleranci do {t} s po doběhu rampy", { t: T_PROP_SETTLE }) : tr("Rampa nedoběhla do {t} s", { t: T_PROP_SETTLE }), stop, tr("Kvitace (cmdAck)"));
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
        s += "| X" + (mi + 1) + ":" + (i + 1) + " | " + hwAddrText(prj, e) + " | " + e.tag + " | " + how + " | ☐ |\n";
    }));
    s += "\n## " + tr("2. Funkční testy zařízení") + "\n";
    for (const d of prj.devices) {
        const head = "**" + d.name + " — " + d.desc + "**";
        if (d.cls === "Motor")
            s += head + "\n" +
                chk(tr("Start → běží, hlášení běhu do 3 s")) +
                chk(tr("Stop → zastaví")) +
                chk(tr("Simulace ztráty hlášení za chodu → porucha, výstup vypnut")) +
                (d.opt?.fault ? chk(tr("Simulace externí poruchy → porucha")) : "") +
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
        else if (d.cls === "Vfd")
            s += head + "\n" +
                chk(tr("Chod → rozběh po rampě, hlášení „otáčky dosaženy“, žádaná na analogovém výstupu odpovídá otáčkám měniče")) +
                chk(tr("Změna otáček za chodu → nová rampa, krok přejde po dosažení otáček")) +
                chk(tr("Stop → výstup chod vypnut, měnič dobrzdí svou rampou")) +
                chk(tr("Simulace poruchy měniče / ztráty hlášení otáček → porucha, výstup vypnut")) +
                chk(tr("Kvitace poruchy")) + "\n";
        else if (d.cls === "PosDrive")
            s += head + "\n" +
                chk(tr("Referenční jízda → hlášení „referováno“ a „v poloze“")) +
                chk(tr("Jízda na každý záznam → správné bity výběru, start, dosažená poloha odpovídá tabulce záznamů")) +
                chk(tr("Jízda bez referování → porucha „bez referování“")) +
                chk(tr("Přerušení cyklu za jízdy → HALT, pohon stojí")) +
                chk(tr("Simulace poruchy pohonu / ztráty „v poloze“ → porucha")) +
                chk(tr("Kvitace poruchy")) + "\n";
        else if (d.cls === "Axis")
            s += head + "\n" +
                chk(tr("Regulace zapnout / vypnout → osa hlásí stav, při vypnutí stojí")) +
                chk(tr("Referování → osa referována, poloha = referenční poloha")) +
                chk(tr("Ruční pojezd + / − → osa jede jen při drženém tlačítku, po puštění zastaví; softwarové limity zastaví osu")) +
                chk(tr("Najetí na každou pojmenovanou polohu → skutečná poloha v okně „v poloze“")) +
                chk(tr("Absolutní polohování bez referování → porucha „bez referování“")) +
                chk(tr("Přerušení cyklu za jízdy (AUTO vypnuto) → osa zastaví; E-stop → regulace vypnuta (STO dle bezpečnostní funkce)")) +
                chk(tr("Simulace poruchy pohonu / ztráty komunikace / zablokování (chyba sledování) → porucha stroje")) +
                chk(tr("Kvitace poruchy → regulace znovu zapnuta")) + "\n";
        else if (d.cls === "PropValve")
            s += head + " (" + (d.unit || "") + " " + d.rmin + "–" + d.rmax + ")\n" +
                chk(tr("Žádané hodnoty ve 3 bodech → skutečná hodnota (manometr / zpětná vazba) v toleranci")) +
                chk(tr("Rampa žádané odpovídá nastavení")) +
                (ioOf(prj, d).rawAct ? chk(tr("Simulace odchylky skutečné hodnoty → porucha po nastavené době")) : "") +
                chk(tr("Vypnutí / E-stop → žádaná na minimum")) + "\n";
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
    /* vlastní šablony firemní knihovny (codeLibrary — po kontrole převoditelnosti pro platformu) */
    const libIds = {};
    for (const p of prj.platforms) {
        const lib = codeLibrary(prj, p);
        for (const [cls, id] of Object.entries(lib.ids))
            (libIds[cls] = libIds[cls] || new Set()).add(id + (lib.library?.name ? " (" + lib.library.name + ")" : ""));
    }
    const own = (cls) => libIds[cls] ? " — " + tr("vlastní blok knihovny {name}, neověřeno simulací", { name: [...libIds[cls]].join(", ") }) : "";
    return [
        "# " + tr("Softwarová dokumentace programu PLC"),
        "",
        tr("**Projekt:** {name} · generováno {date}", { name: prj.meta.name || "—", date: dnes() }),
        "",
        "## " + tr("1. Struktura programu"),
        "- " + tr("**Knihovna typových bloků** (`Gen_Library`): {list}", { list: ["Motor", "Ventil", "AnalogIn", "AnalogOut", "Vfd", "PosDrive", "PropValve", "Axis"].filter(c => u.has(c)).map(c => "FB_" + c).join(", ") || "—" }),
        "- " + tr("**Strojní blok** `FB_Machine` / `MAIN`: multi-instance všech zařízení + stavový automat sekvence s hlídáním času kroků, režimy AUTO / ručně (`modeAuto`, `manRun_*`, `manOpen_*`), porucha stroje (`machineFault`, `faultStep`) a kvitace (`cmdAck` → vstup `reset` všech bloků)"),
        "- " + tr("Volání: 1 instance strojního bloku v cyklickém programu (OB1 / PlcTask / MainTask)"),
        ...(prj.platforms.includes("unitronics") ? [
            "- " + tr("**Unitronics (UniLogic):** ST funkce nemá vlastní paměť, proto se knihovna bloků negeneruje — stejná logika je rozepsaná v jedné funkci `Machine.st` a stav každého zařízení je v globálních tazích `instX_*` (seznam v `Tags.csv`). Výstup nebyl ověřen překladem v UniLogic."),
        ] : []),
        "",
        "## " + tr("2. Typové bloky"),
        tr("| Blok | Funkce | Stavový automat | Timeout |"),
        "|---|---|---|---|",
        "| FB_Motor | " + tr("start/stop se zpětným hlášením") + own("Motor") + " | IDLE→STARTING→RUNNING→ERROR | " + tr("rozběh 3 s") + " |",
        "| FB_Ventil | " + tr("otevřít/zavřít s koncáky") + own("Ventil") + " | CLOSED→OPENING→OPEN→CLOSING→ERROR | " + tr("přestavení 5 s") + " |",
        "| FB_AnalogIn | " + tr("škálování + meze") + own("AnalogIn") + " | — | — |",
        "| FB_AnalogOut | " + tr("jednotky → surová hodnota") + own("AnalogOut") + " | — | — |",
        ...(u.has("Vfd") ? ["| FB_Vfd | " + tr("frekvenční měnič: chod, směr, žádaná s rampou v PLC") + " | IDLE→ACCELERATING→AT_SPEED→ERROR | " + tr("otáčky {t} s po rampě", { t: T_VFD_SPEED }) + " |"] : []),
        ...(u.has("PosDrive") ? ["| FB_PosDrive | " + tr("polohovací pohon: výběr záznamu, start, referování, HALT") + " | IDLE→SELECT→START→MOVING / HOME_START→HOMING→ERROR | " + tr("potvrzení {a} s, jízda {m} s", { a: T_POS_ACK, m: T_POS_MOVE }) + " |"] : []),
        ...(u.has("PropValve") ? ["| FB_PropValve | " + tr("proporcionální ventil: žádaná s rampou, hlídání odchylky") + " | OFF→RAMP→IN_TOLERANCE→ERROR | " + tr("žádaná {t} s po rampě", { t: T_PROP_SETTLE }) + " |"] : []),
        ...(u.has("Axis") ? ["| FB_Axis | " + tr("servoosa: obálka nad bloky MC platformy (regulace, referování, polohování, rychlost, zastavení, ruční pojezd)") + " | OFF→POWERING→READY→HOMING / MOVING / STOPPING / JOG→ERROR→RESETTING | " + tr("regulace {t} s; pohyb hlídá čas kroku", { t: T_AXIS_POWER }) + " |"] : []),
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
        ...oopSwSection(prj),
        "## " + tr("6. Verze a zálohy"),
        tr("| Verze | Datum | Autor | Změna |"),
        "|---|---|---|---|",
        "| 0.1 | " + dnes() + " | PLCdesk | " + tr("první generování") + " |",
    ].join("\n");
}
/** Oddíl softwarové dokumentace pro styl kódu OOP (jen když ho projekt na některé platformě má). */
function oopSwSection(prj) {
    const plat = oopInProject(prj);
    if (!plat)
        return [];
    const prog = oopProgram(prj, plat);
    const plats = prj.platforms.filter(p => codeStyleFor(prj, p) === "oop").map(p => PLAT[p].name).join(", ");
    const row = (p) => "| " + p.name + " | " + (p.kind === "interface" ? "INTERFACE" : p.abstract ? "FUNCTION_BLOCK ABSTRACT" : p.kind === "program" ? "PROGRAM" : "FUNCTION_BLOCK")
        + (p.extends ? " EXTENDS " + p.extends : "") + (p.implements && p.implements.length ? " IMPLEMENTS " + p.implements.join(", ") : "")
        + " | " + [...p.methods.map(m => m.name + "()"), ...p.props.map(x => x.name)].join(", ") + " |";
    return [
        "## " + tr("Styl kódu OOP"),
        tr("Platformy se stylem OOP: {list}. Chování je stejné jako v klasickém stylu — třídy stojí na stejných šablonách bloků a stejné mezivrstvě programu; shodu ověřuje emulátor (stejné scénáře, scan po scanu). Diagram tříd: `{file}`.", { list: plats, file: OOP_CLASS_SVG }),
        "",
        tr("| Třída | Druh | Metody a vlastnosti |"),
        "|---|---|---|",
        ...prog.pous.map(row),
        "",
        tr("Kvitace: MAIN volá `Reset()` přes pole odkazů `aDevices` (při `cmdAck`), souhrn poruch čte vlastnost `Fault` v cyklu FOR s kontrolou odkazu `<> 0`. Stav bloku pro HMI: vlastnosti `Fault`, `Status`, `Busy` (místo výstupů `error`, `status`, `busy`)."),
        "",
    ];
}
export function docFiles(prj, items = approvalItems(prj)) {
    const plan = commissioningPlan(prj);
    const bodies = [
        docIndexMd(prj), docFDSMd(prj), docIOcsv(prj), svorkyCSV(prj),
        docAlarmCsv(prj), docFATMd(prj), docManualMd(prj), docSWMd(prj),
        verifyDocMd(prj),
        bomMd(prj), bomCsv(prj),
        approvalsMd(prj, items), commissioningMd(prj, plan), commissioningCsv(prj, plan),
    ];
    const out = DOC_META.map((m, i) => {
        const g = DOC_STAMP[m[0]];
        return { path: m[0], tab: tr(m[1]), title: tr(m[2]), body: g ? stampBody(bodies[i], approvalStamp(prj, g, items).md) : bodies[i] };
    });
    /* koncept řešení (AI nadstavba) jen když je zvolený */
    if (prj.concept)
        out.push({ path: CONCEPT_FILE, tab: tr("Koncept"), title: tr("koncept řešení (AI návrh k revizi)"), body: conceptMd(prj) });
    for (const p of docProviders)
        if (p.docs)
            out.push(...p.docs(prj, items));
    /* hlavička pod nadpisem dokumentů Markdown: firemní hlavička knihovny a řádek revize (bez nich beze změny) */
    const head = [libraryDocHeader(prj).trim(), ...docProviders.map(p => (p.header ? p.header(prj) : "").trim())].filter(Boolean).join("\n\n");
    if (head)
        for (const f of out)
            if (f.path.endsWith(".md"))
                f.body = stampBody(f.body, head);
    return out;
}
const docProviders = [];
export function registerDocProvider(name, p) {
    const at = docProviders.findIndex(x => x.name === name);
    const rec = { ...p, name };
    if (at >= 0)
        docProviders[at] = rec;
    else
        docProviders.push(rec);
    return () => { const i = docProviders.indexOf(rec); if (i >= 0)
        docProviders.splice(i, 1); };
}
/** Dokument konceptu řešení — číslo za pevnou sadou 00–09. */
export const CONCEPT_FILE = "10_koncept_reseni.md";
/** Úplná sada souborů projektu: dokumenty + schémata (SVG/DXF) + zdroje platforem. */
export function allProjectFiles(prj) {
    const out = [];
    const gDocs = tr("Dokumentace"), gSch = tr("Schémata");
    const items = approvalItems(prj);
    for (const f of docFiles(prj, items))
        out.push({ group: gDocs, name: f.path, save: f.path, body: f.body, kind: "text" });
    const mods = modules(prj);
    out.push({ group: gSch, name: "blokove_schema.svg", save: "00_blokove_schema.svg", body: svgBlock(prj, mods), kind: "svg" });
    out.push({ group: gSch, name: "schema_stroje.svg", save: "00_schema_stroje.svg", body: svgMachine(prj), kind: "svg" });
    if (prj.program.seq.length) {
        const run = simulate(prj);
        out.push({ group: gSch, name: "funkcni_diagram.svg", save: "00_funkcni_diagram.svg", body: svgFlow(prj, run), kind: "svg" });
        out.push({ group: gSch, name: "casovy_diagram.svg", save: "00_casovy_diagram.svg", body: svgTiming(prj, run), kind: "svg" });
    }
    /* styl kódu OOP: diagram tříd do softwarové dokumentace */
    const oopPlat = oopInProject(prj);
    if (oopPlat)
        out.push({ group: gSch, name: "diagram_trid.svg", save: OOP_CLASS_SVG, body: oopClassSvg(prj, oopPlat), kind: "svg" });
    mods.forEach((m, i) => {
        const base = m.dir + m.idx + "_X" + (i + 1), pre = String(i + 1).padStart(2, "0") + "_";
        out.push({ group: gSch, name: base + ".svg", save: pre + base + ".svg", body: sheetSVG(prj, m, i + 1, i + 1, mods.length), kind: "svg" });
        out.push({ group: gSch, name: base + ".dxf", save: pre + base + ".dxf", body: sheetDXF(prj, m, i + 1, i + 1, mods.length), kind: "dxf", prev: sheetSVG(prj, m, i + 1, i + 1, mods.length) });
    });
    for (const p of docProviders)
        if (p.files)
            out.push(...p.files(prj, items));
    for (const p of prj.platforms) {
        const files = genFor(prj, p);
        /* README platformy nese razítko stavu programu (zdrojové soubory se nemění) */
        const stamp = approvalStamp(prj, ["design", "program", "verify"], items).text;
        for (const [n, b] of Object.entries(files))
            out.push({ group: tr("PLC — {name}", { name: PLAT[p].name }), name: n, save: p + "_" + n, body: n === "README.txt" && stamp ? stamp + "\n\n" + b : b, kind: "text" });
    }
    return out;
}
