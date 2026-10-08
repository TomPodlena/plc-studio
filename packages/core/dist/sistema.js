import { tr, N_, today } from "./i18n.js";
import { registerDocProvider } from "./docs.js";
import { proposeSafety, safetyApprovalItems, safetyApprovalState, addSafetyRegistration, } from "./safety.js";
import * as D from "./safety_data.js";
export const SISTEMA_FILE = "19_sistema.md";
/** Formát projektu, který export píše (SISTEMA 2.x; SISTEMA 3.x převádí při otevření). */
export const SISTEMA_SSM_VERSION = "2.0.8";
export const SISTEMA_NORM = "ISO 13849-1:2015, ISO 13849-2:2012";
/**
 * Stav ověření importem. Aktualizovat po zkoušce v SISTEMA (verze, datum, výsledek) —
 * text jde do dokumentu i README.
 */
export const SISTEMA_VERIFIED = N_("neověřeno importem v SISTEMA — struktura souboru odpovídá příkladům IFA a schématu ssm_21.xsd");
export const SISTEMA_SOURCES = [
    "https://www.dguv.de/ifa/praxishilfen/practical-solutions-machine-safety/software-sistema/index.jsp",
    "https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/ifa_report_2_2017e_examples.zip",
    "https://www.dguv.de/medien/ifa/en/pra/softwa/sistema/kochbuch/sistema_cookbook5_en_2_0.pdf",
    "https://www.dguv.de/medien/ifa/en/pra/softwa/sistema/sistema_faqs_en.pdf",
];
const r1 = (x) => Math.round(x * 10) / 10;
/** Označení výstupní skupiny (kusovník: -KS1/-KS2, -YS1, -YH1/-YH2, měnič a brzda = označení pohonu). */
export function sistemaGroupDts(g) {
    switch (g.kind) {
        case "contactors": return ["-KS1", "-KS2"];
        case "heater": return ["-KH1", "-KH2"];
        case "exhaust": return ["-" + g.id + "1"];
        case "hydraulic": return ["-YH1", "-YH2"];
        default: return g.devs.slice(0, 1).map(d => "-" + d);
    }
}
/** Označení vstupního subsystému: zařízení funkce, jinak prvek, který kusovník doplní. */
function inputDts(prj, f) {
    const devs = f.inputs.filter(n => prj.devices.some(d => d.name === n && d.cls === "DI"));
    if (devs.length)
        return devs.map(n => "-" + n);
    if (f.kind === "estop")
        return ["-S0"];
    if (f.kind === "two_hand")
        return ["-S2H"];
    if (f.kind === "restart")
        return ["-S0R"];
    return [];
}
function techOf(role, g) {
    if (role === "L")
        return "tecElectronic";
    if (role === "I")
        return "tecElectromechanic";
    switch (g?.kind) {
        case "exhaust": return "tecPneumatic";
        case "hydraulic": return "tecHydraulic";
        case "sto": return "tecElectronic";
        default: return "tecElectromechanic";
    }
}
/** PFHd z textu katalogu („2,31E-09 1/h“). */
export function sistemaParsePfh(t) {
    /* jen hodnoty typu 1,2E-08 (záporný exponent ≥ 4), ne typová označení jako „CU240E-2“ ani PFD;
       víc variant v textu → nejvyšší hodnota (konzervativně) */
    const s = String(t || "");
    let best = null;
    for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*[eE]\s*-\s*(\d+)/g)) {
        if (+m[2] < 4 || /PFD\s*$/i.test(s.slice(Math.max(0, m.index - 6), m.index)))
            continue;
        const v = parseFloat(m[1].replace(",", ".") + "e-" + m[2]);
        if (Number.isFinite(v) && (best === null || v > best))
            best = v;
    }
    return best;
}
/** Horní mez pásma PFHd pro PL (o 1 % níž, ať zůstane v pásmu) — zástupná hodnota. */
function pfhUpper(pl) {
    const b = D.SAFETY_PL_PFH.find(x => x.pl === pl);
    return b ? +(b.max * 0.99).toPrecision(3) : 1e-5;
}
function subsystemOf(prj, f, s, g) {
    const cfg = prj.safety?.fn?.[f.ref] || {};
    const design = f.design;
    const dts = s.role === "L" ? ["-K0"] : s.role === "I" ? inputDts(prj, f) : g ? sistemaGroupDts(g) : [];
    const dt = dts.join(", ");
    const fnType = s.role === "I" ? "fncInput" : s.role === "L" ? "fncLogic" : "fncOutput";
    const notes = [...s.notes];
    const base = { role: s.role, fnType, name: s.label, dt, pl: s.pl, mttfd: s.mttfd, dc: s.dc, notes };
    const empty = () => [{ type: "ch1", blocks: [] }, { type: "ch2", blocks: [] }, { type: "chTest", blocks: [] }];
    if (s.from === "device") {
        const parsed = sistemaParsePfh(s.comp?.pfhdText);
        const pfh = parsed ?? (s.pl ? pfhUpper(s.pl) : null);
        if (parsed === null && s.pl)
            notes.push(tr("PFHd přístroje není v katalogu — zástupná hodnota {v} 1/h (horní mez pásma PL {pl}); doplň z prohlášení výrobce.", { v: sistemaNum(pfh), pl: s.pl }));
        return { ...base, cat: design.cat, mode: "device", pfh, pfhAssumed: parsed === null, ccf: null, channels: empty() };
    }
    const dual = s.channels >= 2;
    const comp = s.comp;
    const b10d = s.role === "I" ? (cfg.b10dIn ?? comp?.b10d) : (cfg.b10dOut ?? comp?.b10d);
    const byB10d = s.t10d !== null && !!b10d && !!s.nop;
    const mode = s.mttfd === null ? "missing" : byB10d ? "b10d" : "mttfd";
    const blk = (k) => ({
        name: (comp?.series ? comp.series : comp?.label || s.label) + (dual ? " — " + tr("kanál {ch}", { ch: k === 0 ? "A" : "B" }) : ""),
        dt: dts.length >= 2 ? dts[k] || dts[0] : dts[0] || "",
        tech: techOf(s.role, g), mode,
        b10d: mode === "b10d" ? b10d : null, nop: mode === "b10d" ? s.nop : null,
        mttfd: mode === "mttfd" ? s.mttfd : null, dc: s.dc,
        note: mode === "missing" ? tr("chybí B10d / MTTFd komponenty — doplň z datasheetu") : comp?.generic ? tr("hodnota z typických hodnot / rešerše — potvrdit podle datasheetu konkrétní varianty") : "",
    });
    const channels = [{ type: "ch1", blocks: [blk(0)] }, { type: "ch2", blocks: dual ? [blk(1)] : [] }, { type: "chTest", blocks: [] }];
    const cat = s.cat;
    const ccf = cat && cat !== "B" && cat !== "1" ? { ids: design.ccf.ids, points: design.ccf.points } : null;
    return { ...base, cat, mode: s.from === "none" ? "missing" : "blocks", pfh: null, pfhAssumed: false, ccf, channels };
}
/** Model exportu do SISTEMA z návrhu bezpečnostních funkcí. */
export function sistemaModel(prj, p = proposeSafety(prj), items = safetyApprovalItems(prj)) {
    const fns = [];
    const skipped = [];
    for (const f of p.fns) {
        if (f.off)
            continue;
        if (!f.design || !f.risk.plr) {
            skipped.push({ id: f.id, title: f.title, why: f.kind === "pressure" ? tr("mechanický základní princip (pojistný ventil) — PL se nepočítá") : tr("bez PLr / návrhu architektury") });
            continue;
        }
        const gs = p.groups.filter(g => f.acts.includes(g.id));
        let oi = 0;
        const subs = f.design.subs.map(s => subsystemOf(prj, f, s, s.role === "O" ? gs[oi++] || null : null));
        const r = f.risk;
        const plrDoc = [
            "S: " + r.why.S, "F: " + r.why.F, "P: " + r.why.P,
            r.min ? r.min.why : "", r.reduced ? tr("Snížení PLr: {why}", { why: r.reduced }) : "",
            r.override ? tr("PLr podle normy typu C: {src}", { src: r.override.source || "—" }) : "",
        ].filter(Boolean).join(" ");
        fns.push({
            id: f.id, ref: f.ref, name: f.name, title: f.title, plr: r.plr, pl: f.design.pl, ok: f.design.ok,
            S: r.S, F: r.F, P: r.P, plrDoc, reaction: f.reaction, safeState: f.safeState, trigger: f.trigger, subs,
        });
    }
    return {
        project: prj.meta.name || tr("(bez názvu)"), date: today(),
        missionYears: p.params.missionYears, dop: p.params.dop, hop: p.params.hop,
        fns, skipped, approved: safetyApprovalState(prj, items).fnsApproved,
        logic: [p.logic.brand, p.logic.series || p.logic.label].filter(Boolean).join(" "),
    };
}
/* ================================================================ .ssm (XML tiOPF) */
/** Číslo ve zvyklosti SISTEMA: desetinná čárka, malé hodnoty exponentem („1,5E-8“). */
export function sistemaNum(x) {
    if (!Number.isFinite(x))
        return "0";
    if (Number.isInteger(x) && Math.abs(x) < 1e15)
        return String(x);
    const a = Math.abs(x);
    const s = a !== 0 && (a < 1e-3 || a >= 1e15) ? x.toExponential(3).replace(/\.?0+e/, "e").replace("e+", "E").replace("e", "E") : String(+x.toPrecision(10));
    return s.replace(".", ",");
}
/* Pole tabulek přesně podle příkladů IFA (název:druh+velikost; s = string, i = integer, f = float, d = date). */
const TABLES = [
    ["projectops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i name:s512 author:s256 tester:s256 manager:s256 document:s1024 documentation:s4000 filename:s1024 machinename:s512 standardsfolder:s1024 documentsfolder:s1024 createdate:f status:s50 number:s50 version:s50"],
    ["sfops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i projectopoid:s38 name:s512 document:s1024 documentation:s4000 plr:s4 plrdet:s18 plrdocumentation:s2000 plrdocument:s1024 plrstandard:s2000 plrstandardfile:s1024 reaction:s1024 requestfrequency:s1024 responsetime:s1024 priority:s1024 plrgraphdocumentation:s2000 plrgraphdocument:s1024 riskparamf:i riskparamp:i riskparams:i wparameter:s11 safestate:s1024 sftype:s1024 triggerevent:s1024 opmode:s50 plcal:s4 pfhcal:s32"],
    ["componentops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i sfopoid:s38 name:s512 document:s1024 catstandard:s2000 catstandardfile:s1024 catconditionsrelevant:i ccfscore:s32 ccfscoredet:s18 ccfdocumentation:s2000 ccfdocument:s1024 dcavg:s32 dcavgdet:s18 dcavgdocumentation:s2000 mttfddocumentation:s2000 mttfd:s32 mttfddet:s18 pfh:s32 pldet:s18 pldocumentation:s2000 isplpfhbind:i pldirectnobind:s4 pldirectsoftware:s4 sildirectnobind:s4 useworstcasemttfd:i reducedtestingrate:i catconditions:s380 plconditions:s380 libversion:s40 libname:s512 libid:s1024 liburl:s1024 libinfo:s1024 libfilename:s1024 language:s2 manufacturer:s512 manufacturericonfilename:s1024 manufacturer_bool_a:i manufacturer_bool_b:i manufacturer_bool_c:i manufacturer_text_a:s1024 manufacturer_text_b:s1024 manufacturer_text_c:s2000 deviceid:s1024 devicegroup:s256 deviceiconfilename:s1024 description:s4000 partno:s256 revision:s256 equipmentid:s50 inventoryno:s50 functiontypes:s50 missiontime:s32 cat:s4 catdocumentation:s2000 usecase:s1024 usecasedocumentation:s1024 archive:i deviceidreadonly:i devicevaluedatareadonly:i device_bool_a:i device_bool_b:i device_bool_c:i device_text_a:s1024 device_text_b:s1024 device_text_c:s2000 sildirectbindcal:s4 pldirectbindcal:s4 plsubitemscal:s4 plsubitemssimplecal:s4 pfhsubitemscal:s32 pfhsubitemssimplecal:s32"],
    ["channelops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i channeltype:s9 componentopoid:s38 name:s512"],
    ["blocops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i parentopoid:s38 name:s512 document:s1024 dc:s32 dcdet:s18 dcmeasureopoid:s38 dcdocumentation:s2000 dcmeasuredocumentation:s2000 mttfddocumentation:s2000 mttfd:s10 b10d:s32 technology:s20 nop:s32 nopday:s32 nophour:s32 nopcycle:s32 b10:s32 lambda:s32 mttf:s32 mtbf:s32 rdfb10:s32 rdfmttf:s32 rdfb10readonly:i rdfmttfreadonly:i calcmttfddet:s15 calcb10ddet:s14 mttfddet:s10 libversion:s40 libname:s512 libid:s1024 liburl:s1024 libinfo:s1024 libfilename:s1024 language:s2 manufacturer:s512 manufacturericonfilename:s1024 manufacturer_bool_a:i manufacturer_bool_b:i manufacturer_bool_c:i manufacturer_text_a:s1024 manufacturer_text_b:s1024 manufacturer_text_c:s2000 deviceid:s1024 devicegroup:s256 deviceiconfilename:s1024 description:s4000 partno:s256 revision:s256 equipmentid:s50 inventoryno:s50 functiontypes:s50 missiontime:s32 cat:s4 catdocumentation:s2000 usecase:s1024 usecasedocumentation:s1024 archive:i deviceidreadonly:i devicevaluedatareadonly:i device_bool_a:i device_bool_b:i device_bool_c:i device_text_a:s1024 device_text_b:s1024 device_text_c:s2000"],
    ["elementops", ""],
    ["dcmeasureops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i dcmax:s32 dcmin:s32 dc:s32 dependency:s2000 description:s2000 documentation:s2000 document:s1024 heading:s512 insufficientpls:s30 dcmid:s38"],
    ["ccfmeasureops", "oid:s38 ssmversion:s40 normversion:s40 isprotected:i componentopoid:s38 description:s2000 documentation:s2000 document:s1024 heading:s512 number:s512 score:s32 ccfmid:s38"],
    ["libmetadata", "ssmversion:s40 normversion:s40 isprotected:i lastchange:d info:s2000 name:s512 author:s512 url:s1024 standardsfolder:s1024 documentsfolder:s1024 lib_bool_a:i lib_bool_b:i lib_bool_c:i lib_text_a:s1024 lib_text_b:s1024 lib_text_c:s2000 oid:s38"],
];
TABLES[5][1] = TABLES[4][1]; /* elementops = stejná pole jako blocops */
const KIND = { s: "string", i: "integer", f: "float", d: "date" };
const fieldsOf = (spec) => spec.split(" ").map(x => { const [n, t] = x.split(":"); return { n, k: KIND[t[0]], size: t.slice(1) || "0" }; });
/** Opatření proti CCF → položky SISTEMA (ISO 13849-1, tab. F.1). */
const CCF_MAP = {
    separation: { mid: "CCFMID-001", no: "1", heading: "Separation / Segregation" },
    diversity: { mid: "CCFMID-002", no: "2", heading: "Diversity" },
    overload: { mid: "CCFMID-003", no: "3.1", heading: "Design / application / experience" },
    welltried: { mid: "CCFMID-004", no: "3.2", heading: "Design / application / experience" },
    fmea: { mid: "CCFMID-005", no: "4", heading: "Assessment / analysis" },
    training: { mid: "CCFMID-006", no: "5", heading: "Competence / training" },
    emc: { mid: "CCFMID-007", no: "6.1", heading: "Environmental" },
    environment: { mid: "CCFMID-008", no: "6.2", heading: "Environmental" },
};
export function sistemaCcfMid(id) { return CCF_MAP[id]?.mid || ""; }
/* Výchozí hodnoty nepoužitých polí — jak je ukládá SISTEMA (příklady IFA). */
const BLOCK_DEF = {
    dc: "0", dcdet: "detDirect", mttfd: "10", b10d: "0", technology: "tecUnknown", nop: "-2", nopday: "0", nophour: "0", nopcycle: "0",
    b10: "0", lambda: "1,14155E-5", mttf: "10", mtbf: "10", rdfb10: "1", rdfmttf: "1", calcmttfddet: "calcMTTFdMTTF", calcb10ddet: "calcB10dDirect",
    mttfddet: "detDirect", functiontypes: "fncUnknown", cat: "catN",
};
const SB_DEF = {
    catconditionsrelevant: "1", ccfscore: "0", ccfscoredet: "detDirect", dcavg: "0", dcavgdet: "detSubItems", mttfd: "10", mttfddet: "detSubItems",
    pfh: "3,8E-5", pldet: "detSubItems", isplpfhbind: "1", pldirectnobind: "plA", pldirectsoftware: "plU", sildirectnobind: "sil1",
    sildirectbindcal: "silN", pldirectbindcal: "plN", plsubitemscal: "plN", plsubitemssimplecal: "plN", pfhsubitemscal: "-", pfhsubitemssimplecal: "-",
};
/** Deterministické OID (GUID) z klíče — stejný projekt = stejný soubor. */
function oidOf(key) {
    const h = (seed) => {
        let x = 0x811c9dc5 ^ seed;
        for (let i = 0; i < key.length; i++) {
            x ^= key.charCodeAt(i);
            x = Math.imul(x, 0x01000193) >>> 0;
        }
        return (x >>> 0).toString(16).padStart(8, "0");
    };
    const s = h(1) + h(2) + h(3) + h(4);
    return (s.slice(0, 8) + "-" + s.slice(8, 12) + "-4" + s.slice(13, 16) + "-a" + s.slice(17, 20) + "-" + s.slice(20, 32)).toUpperCase();
}
/** Text do pole .ssm: konce řádků jako „\n“ (zvyklost SISTEMA), bez řídicích znaků, oříznutí na délku pole. */
function ssmText(s, max = 4000) {
    const t = String(s ?? "").replace(/\r?\n/g, "\\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
const xmlAttr = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Pole „equipmentid“ (50 znaků): celá označení, zbytek jako „+N“ (úplný seznam jde do popisu). */
function dtField(dt) {
    const xs = dt.split(", ").filter(Boolean);
    let out = "";
    for (let i = 0; i < xs.length; i++) {
        const next = (out ? out + ", " : "") + xs[i];
        const rest = xs.length - i - 1;
        if (next.length + (rest ? (", +" + rest).length : 0) > 50)
            return out + (out ? ", " : "") + "+" + (xs.length - i);
        out = next;
    }
    return out;
}
const PLX = (pl) => (pl ? "pl" + pl.toUpperCase() : "plN");
const CATX = (c) => (c ? "cat" + c : "catN");
/** Projektový soubor SISTEMA (*.ssm). */
export function sistemaSsm(prj, m = sistemaModel(prj)) {
    const rows = Object.fromEntries(TABLES.map(t => [t[0], []]));
    const common = { ssmversion: SISTEMA_SSM_VERSION, normversion: SISTEMA_NORM, isprotected: "0" };
    const seed = "plcdesk|" + m.project + "|";
    const add = (table, key, v) => {
        const oid = oidOf(seed + table + "|" + key);
        const row = { oid, ...common };
        for (const [k, x] of Object.entries(v))
            row[k] = String(x);
        rows[table].push(row);
        return oid;
    };
    const mission = String(m.missionYears);
    const stateTxt = m.approved ? tr("bezpečnostní funkce schválené v PLCdesk") : tr("NESCHVÁLENO — návrh PLCdesk ke kontrole a schválení odpovědnou osobou");
    const prjOid = add("projectops", "prj", {
        name: m.project, author: "PLCdesk", status: m.approved ? "approved" : "NESCHVALENO", version: "PLCdesk " + m.date,
        documentation: tr("Export z PLCdesk ({date}): {state}. Výpočet PL v PLCdesk je zjednodušený — PL a PFHd spočítá SISTEMA. Potvrď kategorie (požadavky kategorie) a podmínky PL u každého subsystému; hodnoty B10d / MTTFd / PFHd ověř podle datasheetů.", { date: m.date, state: stateTxt }),
        documentsfolder: "Documents", createdate: "30/12/1899 00:00:00:000",
    });
    const dcm = (key, dc = 0) => add("dcmeasureops", key, { dcmax: "0,99", dcmin: "0", dc: sistemaNum(dc / 100), dcmid: "{" + oidOf(seed + "dcmid|" + key) + "}" });
    for (const f of m.fns) {
        const sfOid = add("sfops", f.ref, {
            projectopoid: prjOid, name: ssmText(f.id + " " + f.title, 500), plr: PLX(f.plr), plrdet: "detDirect", plrdocumentation: ssmText(f.plrDoc, 2000),
            reaction: ssmText(f.reaction, 1000), safestate: ssmText(f.safeState, 1000), sftype: ssmText(f.name, 1000), triggerevent: ssmText(f.trigger, 1000),
            /* parametry rizika (informativně; PLr je zadané přímo): 0 = S2/F2/P2, 1 = S1/F1/P1 — odvozeno z příkladů IFA */
            riskparams: f.S === "S1" ? 1 : 0, riskparamf: f.F === "F1" ? 1 : 0, riskparamp: f.P === "P1" ? 1 : 0, wparameter: "wParUnknown",
            plcal: "plN", pfhcal: "-",
        });
        f.subs.forEach((s, si) => {
            const k = f.ref + "|" + si;
            const sb = { ...SB_DEF, sfopoid: sfOid, name: ssmText(s.name, 500), equipmentid: dtField(s.dt), description: s.dt.length > 50 ? s.dt : "", functiontypes: s.fnType, missiontime: mission, cat: CATX(s.cat) };
            const doc = s.notes.filter(Boolean).join(" ");
            if (s.mode === "device")
                Object.assign(sb, {
                    pldet: "detDirect", isplpfhbind: 0, pldirectnobind: PLX(s.pl), pfh: sistemaNum(s.pfh || 0), catconditionsrelevant: 0,
                    dcavgdet: "detDirect", mttfddet: "detDirect", pldocumentation: ssmText(doc, 2000),
                });
            else {
                if (s.ccf)
                    Object.assign(sb, { ccfscoredet: "detMeasures", ccfdocumentation: ssmText(tr("Opatření převzatá z návrhu PLCdesk ({p} bodů) — potvrdit.", { p: s.ccf.points }), 2000) });
                sb.mttfddocumentation = ssmText(doc, 2000);
            }
            const sbOid = add("componentops", k, sb);
            if (s.ccf)
                for (const id of s.ccf.ids) {
                    const c = CCF_MAP[id];
                    const meas = D.SAFETY_CCF_MEASURES.find(x => x.id === id);
                    if (c && meas)
                        add("ccfmeasureops", k + "|ccf|" + id, { componentopoid: sbOid, description: ssmText(tr(meas.label), 2000), heading: c.heading, number: c.no, score: meas.points, ccfmid: c.mid });
                }
            for (const ch of s.channels) {
                const chOid = add("channelops", k + "|" + ch.type, { channeltype: ch.type, componentopoid: sbOid, name: "-" });
                ch.blocks.forEach((b, bi) => {
                    const bk = k + "|" + ch.type + "|" + bi;
                    const v = {
                        ...BLOCK_DEF, parentopoid: chOid, name: ssmText(b.name, 500), equipmentid: dtField(b.dt), description: b.dt.length > 50 ? b.dt : "", technology: b.tech,
                        functiontypes: s.fnType, missiontime: mission, dc: sistemaNum(b.dc / 100), dcmeasureopoid: dcm(bk, 0),
                        mttfddocumentation: ssmText(b.note, 2000),
                    };
                    if (b.mode === "b10d")
                        Object.assign(v, { mttfddet: "detB10D", b10d: sistemaNum(b.b10d), nop: sistemaNum(Math.round(b.nop)) });
                    else if (b.mode === "mttfd")
                        Object.assign(v, { mttfddet: "detDirect", mttfd: sistemaNum(r1(b.mttfd)) });
                    else
                        Object.assign(v, { mttfddet: "detDirect", mttfd: "0" });
                    if (b.dc > 0)
                        v.dcdocumentation = ssmText(tr("DC {dc} % podle návrhu PLCdesk (diagnostika bezpečnostní logiky) — potvrdit opatřením z tab. E.1.", { dc: b.dc }), 2000);
                    const blOid = add("blocops", bk, v);
                    /* každý blok nese jeden prázdný prvek (jak ukládá SISTEMA) */
                    add("elementops", bk + "|el", { ...BLOCK_DEF, parentopoid: blOid, missiontime: mission, dcmeasureopoid: dcm(bk + "|el", 0) });
                });
            }
        });
    }
    /* zápis: všechna pole tabulky v každém řádku (prázdné = výchozí) */
    const out = ['<?xml version="1.0"?>\r\n<xmldocdata><tiopf version="2.1"/><tables>'];
    for (const [name, spec] of TABLES) {
        const fs = fieldsOf(spec);
        out.push('<table table_name="' + name + '"><fields>' + fs.map(f => '<field field_name="' + f.n + '" field_kind="' + f.k + '" field_Size="' + f.size + '"/>').join("") + "</fields><rows>");
        for (const r of rows[name])
            out.push("<row " + fs.map(f => f.n + '="' + xmlAttr(ssmText(r[f.n] ?? (f.k === "integer" ? "0" : ""))) + '"').join(" ") + "/>");
        out.push("</rows></table>");
    }
    out.push("</tables></xmldocdata>\r\n");
    return out.join("");
}
/* ================================================================ předpis CSV a dokument */
const csvCell = (v) => { const s = String(v ?? ""); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const blockValue = (b) => b.mode === "b10d" ? "B10d = " + b.b10d + "; nop = " + Math.round(b.nop) : b.mode === "mttfd" ? "MTTFd = " + r1(b.mttfd) : tr("doplnit");
const ROLE = { I: N_("vstup"), L: N_("logika"), O: N_("výstup") };
/** Předpis pro ruční zadání v SISTEMA: řádek = subsystém nebo blok (středník, UTF-8 s BOM). */
export function sistemaCsv(prj, m = sistemaModel(prj)) {
    const head = [tr("Funkce"), "PLr", tr("Subsystém"), tr("Role"), tr("Označení"), tr("Kategorie"), tr("Způsob"), "PL / PFHd", "CCF", tr("Kanál"), tr("Blok"), tr("Technologie"), "MTTFd / B10d", "DC [%]", tr("PL PLCdesk"), tr("Poznámka")];
    const rows = [];
    for (const f of m.fns)
        for (const s of f.subs) {
            const how = s.mode === "device" ? tr("PL přístroje") : s.mode === "blocks" ? tr("výpočet z bloků") : tr("chybí data");
            const plPfh = s.mode === "device" ? (s.pl || "—") + " / " + (s.pfh !== null ? sistemaNum(s.pfh) : "—") + (s.pfhAssumed ? " (" + tr("zástupná") + ")" : "") : "";
            rows.push([f.id + " " + f.title, f.plr, s.name, tr(ROLE[s.role]), s.dt, s.cat || "—", how, plPfh, s.ccf ? s.ccf.points : "", "", "", "", "", s.mode === "device" ? "" : s.dc, s.pl || "—", s.notes.join(" ")]);
            for (const ch of s.channels)
                for (const b of ch.blocks)
                    rows.push([f.id, "", "", "", b.dt, "", "", "", "", ch.type, b.name, b.tech.replace(/^tec/, ""), blockValue(b), b.dc, "", b.note]);
        }
    return "\uFEFF" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
/** Bezpečný název souboru projektu (ASCII). */
export function sistemaFileName(prj) {
    const base = (prj.meta.name || "plcdesk").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "plcdesk";
    return base + ".ssm";
}
/** Dokument 19_sistema.md: postup importu, předpis krok za krokem a porovnání PL. */
export function sistemaMd(prj, items = safetyApprovalItems(prj), m = sistemaModel(prj, proposeSafety(prj), items)) {
    const L = [
        "# " + tr("Kontrola v SISTEMA (IFA) — export bezpečnostních funkcí"),
        "",
        (m.approved ? "" : "**" + tr("NESCHVÁLENO") + "** — ") + tr("Projekt: {name} · datum: {date} · doba mise {m} let · {dop} dní/rok × {hop} h/den.", { name: m.project, date: m.date, m: m.missionYears, dop: m.dop, hop: m.hop }),
        "",
        tr("Výpočet PL v PLCdesk je zjednodušený (sloupcový graf ISO 13849-1, bez PFHd). Tento export předá funkce, subsystémy, kanály a bloky do SISTEMA, kde se PL a PFHd spočítá metodou IFA. Platí výsledek ze SISTEMA po kontrole odpovědnou osobou."),
        "",
        "## " + tr("1. Soubory"),
        "",
        "- `" + sistemaFileName(prj) + "` — " + tr("projekt SISTEMA (formát SISTEMA {v}, {norm}); SISTEMA 3.x čte i projekty formátu 2.x a nabídne převod na ISO 13849-1:2023.", { v: SISTEMA_SSM_VERSION, norm: SISTEMA_NORM }),
        "- `sistema_predpis.csv` — " + tr("stejné hodnoty jako tabulka pro ruční zadání (kdyby se projekt nenačetl)."),
        "",
        tr("Stav ověření: {state}.", { state: tr(SISTEMA_VERIFIED) }),
        "",
        "## " + tr("2. Postup"),
        "",
        "1. " + tr("Stáhni SISTEMA zdarma ze stránek IFA (bez registrace) a nainstaluj."),
        "2. " + tr("Soubor → Otevřít → `{file}`. Pokud SISTEMA nabídne převod na novější vydání normy, potvrď ho.", { file: sistemaFileName(prj) }),
        "3. " + tr("U každého subsystému zkontroluj kategorii a potvrď požadavky kategorie a podmínky PL (záložky Kategorie a PL) — export je záměrně nevyplňuje."),
        "4. " + tr("U bloků ověř B10d / MTTFd a DC podle datasheetů konkrétních variant; u přístrojů s PL doplň PFHd z prohlášení výrobce (zástupné hodnoty jsou označené)."),
        "5. " + tr("Opatření proti CCF jsou převzatá z návrhu — potvrď je, nebo uprav."),
        "6. " + tr("Výsledné PL a PFHd zapiš do tabulky v kap. 4 a rozdíly vyřeš; protokol SISTEMA přilož k technické dokumentaci."),
        "",
        tr("Kdyby se soubor nenačetl: založ projekt ručně podle kap. 3 (nebo `sistema_predpis.csv`) — Bezpečnostní funkce → Subsystém → Kanál 1 / Kanál 2 → Blok."),
        "",
        "## " + tr("3. Předpis krok za krokem"),
        "",
    ];
    if (!m.fns.length)
        L.push(tr("Projekt nemá bezpečnostní funkce s PLr — není co exportovat."), "");
    for (const f of m.fns) {
        L.push("### " + cell(f.id + " — " + f.title), "");
        L.push("- PLr: **" + (f.plr || "—") + "** (" + f.S + " / " + f.F + " / " + f.P + ") — " + tr("zadat přímo (PLr určeno)"));
        L.push("- " + tr("Spouštěcí událost: {t}", { t: f.trigger }));
        L.push("- " + tr("Reakce: {t}", { t: f.reaction }));
        L.push("- " + tr("Bezpečný stav: {t}", { t: f.safeState }));
        L.push("");
        L.push("| " + [tr("Subsystém"), tr("Označení"), tr("Kategorie"), tr("Způsob"), tr("Kanál"), tr("Blok / hodnoty"), "DC", "CCF"].join(" | ") + " |");
        L.push("|---|---|---|---|---|---|---:|---:|");
        for (const s of f.subs) {
            const how = s.mode === "device" ? tr("PL přístroje {pl}, PFHd {pfh} 1/h", { pl: s.pl || "—", pfh: s.pfh !== null ? sistemaNum(s.pfh) : "—" }) + (s.pfhAssumed ? " ⚠" : "") : s.mode === "blocks" ? tr("výpočet z bloků") : tr("chybí data");
            const blocks = s.channels.flatMap(ch => ch.blocks.map(b => ch.type + ": " + b.name + " (" + b.dt + ", " + blockValue(b) + ")"));
            L.push("| " + [cell(s.name), cell(s.dt), s.cat || "—", how, s.channels.filter(c => c.blocks.length).length || "—", cell(blocks.join("; ") || "—"), s.mode === "device" ? "—" : s.dc + " %", s.ccf ? s.ccf.points : "—"].join(" | ") + " |");
        }
        const notes = [...new Set(f.subs.flatMap(s => s.notes))].filter(Boolean);
        if (notes.length) {
            L.push("");
            for (const n of notes)
                L.push("- " + cell(n));
        }
        L.push("");
    }
    if (m.skipped.length) {
        L.push("**" + tr("Neexportováno:") + "** " + m.skipped.map(s => s.id + " " + s.title + " — " + s.why).join("; "), "");
    }
    L.push("## " + tr("4. Porovnání PL: PLCdesk × SISTEMA"), "");
    L.push(tr("Sloupce SISTEMA vyplní odpovědná osoba z protokolu SISTEMA. Rozdíl je běžný: PLCdesk počítá zjednodušeně (bez PFHd a bez sčítání subsystémů přes PFHd)."), "");
    L.push("| " + [tr("Funkce"), "PLr", tr("PL PLCdesk"), tr("Subsystémy (PL PLCdesk)"), tr("PL SISTEMA"), tr("PFHd SISTEMA [1/h]"), tr("PL ≥ PLr?"), tr("Kontroloval / datum")].join(" | ") + " |");
    L.push("|---|---|---|---|---|---|---|---|");
    for (const f of m.fns)
        L.push("| " + [cell(f.id + " " + f.name), f.plr || "—", (f.pl || "—") + (f.ok ? "" : " ⚠"), cell(f.subs.map(s => s.role + " " + (s.pl || "—")).join(", ")), "", "", "☐", ""].join(" | ") + " |");
    L.push("");
    L.push("## " + tr("5. Zjištěný formát a zdroje"), "");
    L.push(tr("Projekt SISTEMA (*.ssm) je XML vrstvy tiOPF: tabulky projektu, bezpečnostních funkcí, subsystémů, kanálů, bloků, prvků a opatření DC / CCF. Struktura je převzatá z veřejných příkladů IFA a kontrolovaná proti schématu ssm_21.xsd ze SISTEMA. Knihovny SISTEMA (*.slb) jsou databáze Firebird a XML podle VDMA 66413 SISTEMA jen importuje do okna knihoven — pro projekt se proto nepoužívají."), "");
    for (const u of SISTEMA_SOURCES)
        L.push("- " + u);
    L.push("");
    return L.join("\n");
}
/** Úplný export: soubory pro SISTEMA (název → obsah). */
export function sistemaExport(prj) {
    const items = safetyApprovalItems(prj);
    const m = sistemaModel(prj, proposeSafety(prj), items);
    return {
        model: m, verified: tr(SISTEMA_VERIFIED),
        files: { [sistemaFileName(prj)]: sistemaSsm(prj, m), "sistema_predpis.csv": sistemaCsv(prj, m), [SISTEMA_FILE]: sistemaMd(prj, items, m) },
    };
}
/* ================================================================ přihlášení */
function docs(prj, items) {
    if (!proposeSafety(prj).fns.some(f => !f.off && f.design && f.risk.plr))
        return [];
    return [{ path: SISTEMA_FILE, tab: "SISTEMA", title: tr("export pro kontrolu výpočtu PL v SISTEMA (IFA), porovnání PL"), body: sistemaMd(prj, items) }];
}
function files(prj) {
    const m = sistemaModel(prj);
    if (!m.fns.length)
        return [];
    const g = "SISTEMA";
    const ssm = sistemaFileName(prj);
    return [
        { group: g, name: ssm, save: "sistema_" + ssm, body: sistemaSsm(prj, m), kind: "text", dir: "bezpecnost" },
        { group: g, name: "sistema_predpis.csv", save: "sistema_predpis.csv", body: sistemaCsv(prj, m), kind: "text", dir: "bezpecnost" },
    ];
}
/** Přihlásí export do sady projektu (dokument 19 + soubory) — samostatně, bez celého modulu. */
export function registerSistemaExport() { return registerDocProvider("sistema", { docs, files }); }
/* jezdí s bezpečnostním modulem (klient volá registerSafetyModule) */
addSafetyRegistration(registerSistemaExport);
