/**
 * PLCdesk — bezpečnostní program z certifikovaných bloků (jen pro SCHVÁLENÉ bezpečnostní funkce).
 *
 * Bez schválení funkcí (safety:hazards, safety:SFn, safety:SFn:design) se program negeneruje —
 * místo něj vznikne dokument „čeká na schválení“. Po schválení funkcí vznikne návrh programu,
 * který nese výrazně NESCHVÁLENO, dokud odpovědná osoba neschválí položku safety:program.
 *
 * Co se generuje (viz safety_plc.json → text_generation):
 *   - Rockwell GuardLogix: L5X safety programu (RLL: DCS, DCSTL, THRSe, DCSRT, CROUT, TON) pro
 *     import do safety tasku — podpis safety tasku vzniká až v Logix Designeru,
 *   - Siemens: předpis volání F-bloků (ESTOP1, SFDOOR, EV1oo2DI, TWO_H_EN, FDBACK, ACK_GL) jako
 *     dokument — textový import F-LAD/F-FBD (Openness / Source Documents) není ověřený,
 *   - PLCopen Safety (CODESYS Safety, Omron NX-SL, Beckhoff TwinSAFE): dokument s bloky SF_*,
 *   - Pilz PNOZmulti, SICK Flexi Soft, Schmersal PSC1, bezpečnostní relé: konfigurační předpis.
 * Nic z toho není ověřeno překladem v cílovém IDE a nenahrazuje validaci na stroji.
 */
import { stripDia } from "./model.js";
import { tr, trx, today, withLang, techLang } from "./i18n.js";
import { contentHash } from "./approval.js";
import { proposeSafety, safetyApprovalItems, safetyApprovalState, setSafetyProgramHash, targetLabel, } from "./safety.js";
import { SAFETY_BLOCK_MAP, SAFETY_BLOCKS_SIEMENS, SAFETY_TEXTGEN, SAFETY_PLC_SOURCES } from "./safety_data.js";
import { genRockwellSafetyL5X, lxAscii } from "./logix.js";
/** Funkce, které mají blok v bezpečnostním programu (aktivní, ne mechanický princip). */
export function programFunctions(p) {
    return p.fns.filter(f => !f.off && f.role !== "passive");
}
const inputFns = (p) => programFunctions(p).filter(f => f.role === "input" && f.kind !== "restart");
/** Zpoždění STO pro kategorii zastavení 1 (SS1-t) [ms]: úprava funkce, jinak 1000 ms (návrh, ověřit doběhem). */
const ss1Of = (prj, f) => (f.stopCat === 1 ? prj.safety?.fn?.[f.ref]?.ss1DelayMs || 1000 : 0);
export function programOutputs(prj, p) {
    const fns = inputFns(p);
    return p.groups.map(g => {
        const en = fns.filter(f => f.acts.includes(g.id));
        const ss1 = g.kind === "sto" ? Math.max(0, ...en.map(f => ss1Of(prj, f))) : 0;
        return { g, enables: en.map(f => f.id), ss1Ms: ss1 };
    }).filter(o => o.enables.length);
}
/** Struktura programu bez textů — otisk položky safety:program. */
export function programStructure(prj, p) {
    return {
        target: p.target, logic: p.logic.id,
        fns: programFunctions(p).map(f => [f.id, f.kind, (f.design?.signals || []).map(s => s.tag), f.acts, f.stopCat, f.risk.plr, f.design?.cat ?? null]),
        outs: programOutputs(prj, p).map(o => [o.g.id, o.g.kind, o.g.outs, o.g.fbk, o.enables, o.ss1Ms]),
    };
}
setSafetyProgramHash((prj, p) => contentHash(programStructure(prj, p)));
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const ms = (x) => "T#" + Math.max(0, Math.round(x)) + "MS";
function banner(prj, state) {
    if (state === "approved") {
        const rec = prj.approvals?.["safety:program"];
        return "> **" + tr("SCHVÁLENO") + "** — " + tr("bezpečnostní program schválil(a) {who}, {date}. Validace na stroji (ISO 13849-1:2023 kap. 10 / ISO 13849-2) je přesto povinná a provádí ji člověk.", { who: rec?.by || "—", date: (rec?.at || "").slice(0, 10) });
    }
    return "> **" + tr("NESCHVÁLENO") + "** — " + tr("bezpečnostní program je NÁVRH k revizi. Bezpečnostní funkce jsou schválené, program zatím ne: před nahráním do bezpečnostní logiky ho musí přezkoumat a schválit odpovědná osoba (položka safety:program), potom validace na stroji. Neověřeno překladem v cílovém IDE.");
}
/** Dokument „čeká na schválení“ (bez programu). */
export function pendingDoc(prj, p = proposeSafety(prj)) {
    const items = safetyApprovalItems(prj);
    const s = safetyApprovalState(prj, items);
    const L = [
        "# " + tr("Bezpečnostní program — čeká na schválení bezpečnostních funkcí"),
        "",
        "> **" + tr("NESCHVÁLENO") + "** — " + tr("bezpečnostní program se generuje až po schválení nebezpečí, bezpečnostních funkcí (PLr) a jejich návrhu (architektura, komponenty, výpočet PL). Standardní program E-stop a blokování dál čte jen jako stavové signály (enable, kvitace)."),
        "",
        tr("**Projekt:** {name} · **Cíl:** {target} · **Logika:** {logic}", { name: prj.meta.name || "—", target: targetLabel(p.target), logic: (p.logic.brand || "") + " " + (p.logic.series || p.logic.label) }),
        "",
        "## " + tr("Položky, které chybí schválit ({n})", { n: s.open.length }),
        "",
        tr("| Položka | Co se schvaluje | Stav |"), "|---|---|---|",
        ...s.open.map(o => "| " + cell(o.item.title) + " | " + cell(o.item.summary) + " | **" + cell(statusText(o.status)) + "** |"),
        "",
        tr("Návrh funkcí a výpočty jsou v 13_bezpecnostni_funkce.md, plán validace v 14_plan_validace.md, schvalování v 11_schvaleni.md."),
    ];
    return L.join("\n");
}
function statusText(s) {
    return s === "stale" ? tr("změněno po schválení") : s === "rejected" ? tr("zamítnuto") : s === "proposed" ? tr("čeká na rozhodnutí") : tr("neschváleno");
}
/* ---------------------------------------------------------------- společné */
function ioTable(sig) {
    const L = [tr("| Signál | Směr | Význam |"), "|---|---|---|"];
    for (const s of sig)
        L.push("| `" + s.tag + "` | " + (s.dir === "in" ? tr("vstup") : tr("výstup")) + " | " + cell(s.text) + " |");
    return L;
}
function allSignals(p) {
    const seen = new Map();
    for (const f of programFunctions(p))
        for (const s of f.design?.signals || [])
            if (!seen.has(s.tag))
                seen.set(s.tag, s);
    return [...seen.values()];
}
const chOf = (f, kind) => (f.design?.signals || []).filter(s => s.kind === kind && s.dir === "in").map(s => s.tag);
const head = (prj, p, title, state) => [
    "# " + title, "", banner(prj, state), "",
    tr("**Projekt:** {name} · **Cíl:** {target} · **Logika:** {logic} · **Vytvořeno:** {date}", { name: prj.meta.name || "—", target: targetLabel(p.target), logic: (p.logic.brand || "") + " " + (p.logic.series || p.logic.label), date: today() }),
    "",
];
/* ---------------------------------------------------------------- PLCopen Safety */
function plcopenDoc(prj, p, state) {
    const L = head(prj, p, tr("Bezpečnostní program — PLCopen Safety (CODESYS Safety, Omron NX-SL, Beckhoff TwinSAFE)"), state);
    L.push(tr("Předpis sítí FBD z certifikovaných bloků PLCopen Safety (Part 1, Basic Level). Každá bezpečnostní funkce = vstupní blok s blokováním opětovného startu (S_StartReset = FALSE, S_AutoReset = FALSE, ruční Reset); výstupy = SF_OutControl + SF_EDM. Jména bloků u Omronu a TwinSAFE podle mapování v tabulce; u CODESYS ověř obsah knihovny PLCopen Safety FBs."), "");
    for (const k of ["codesys", "omron", "beckhoff"]) {
        const t = SAFETY_TEXTGEN[k];
        if (t)
            L.push("- **" + k + "** — " + tr(t.feasible) + ": " + tr(t.how) + (t.limits ? " " + tr(t.limits) : ""));
    }
    L.push("", "## " + tr("Bezpečnostní signály"), "", ...ioTable(allSignals(p)), "");
    L.push("## " + tr("Sítě po funkcích"), "");
    const row = (inst, fb, map, pins) => {
        L.push(tr("**{inst}** : `{fb}` ({map})", { inst, fb, map }), "", tr("| Vstup / výstup | Připojení |"), "|---|---|", ...pins.map(([a, b]) => "| " + a + " | `" + b + "` |"), "");
    };
    const mapCols = (key) => {
        const m = SAFETY_BLOCK_MAP[key];
        return m ? "Omron: " + tr(m.omron) + " · TwinSAFE: " + tr(m.beckhoff) + " · CODESYS: " + tr(m.codesys) : "";
    };
    for (const f of inputFns(p)) {
        L.push("### " + f.id + " — " + cell(f.title), "", tr("PLr {plr}, kategorie {cat}; výsledek `{ok}`.", { plr: f.risk.plr || "—", cat: f.design?.cat || "—", ok: f.id + "_OK" }), "");
        const ch = chOf(f, "ch"), os = chOf(f, "ossd"), no = chOf(f, "no"), nc = chOf(f, "nc");
        const common = [["Activate", "TRUE"], ["S_StartReset", "FALSE"], ["S_AutoReset", "FALSE"], ["Reset", "SF_Reset"]];
        switch (f.kind) {
            case "estop":
            case "temperature":
                row(f.id + "_EQ", "SF_Equivalent", mapCols("dual_channel"), [["Activate", "TRUE"], ["S_ChannelA", ch[0] || "?"], ["S_ChannelB", ch[1] || "?"], ["DiscrepancyTime", "T#500MS"], ["S_EquivalentOut", f.id + "_EQ.S_EquivalentOut"]]);
                row(f.id + "_ES", "SF_EmergencyStop", mapCols("estop"), [["S_EStopIn", f.id + "_EQ.S_EquivalentOut"], ...common, ["S_EStopOut", f.id + "_OK"]]);
                break;
            case "guard":
                row(f.id + "_GM", "SF_GuardMonitoring", mapCols("guard"), [["S_GuardSwitch1", ch[0] || "?"], ["S_GuardSwitch2", ch[1] || "?"], ["DiscrepancyTime", "T#500MS"], ...common, ["S_GuardMonitoring", f.id + "_OK"]]);
                break;
            case "guard_lock": {
                const lk = chOf(f, "lock")[0] || "?", ul = (f.design?.signals || []).find(s => s.kind === "unlock")?.tag || "?";
                row(f.id + "_GL", "SF_GuardLocking_2", mapCols("guard_lock"), [["S_Guard", ch.length ? ch[0] : "?"], ["S_SafetyActive", "SF_Standstill"], ["S_GuardLock", lk], ["UnlockRequest", "STD_UnlockRequest"], ...common, ["S_GuardLocked", f.id + "_OK"], ["S_UnlockGuard", ul]]);
                L.push(tr("`SF_Standstill` = všechny nebezpečné pohyby zastavené (výstupy vypnuté a uplynulo zpoždění / hlídání klidu); `STD_UnlockRequest` = žádost o odemknutí ze standardního programu (jen žádost, ne povolení)."), "");
                break;
            }
            case "light_curtain":
            case "multibeam":
            case "scanner":
            case "muting":
                row(f.id + "_EQ", "SF_Equivalent", mapCols("dual_channel"), [["Activate", "TRUE"], ["S_ChannelA", os[0] || "?"], ["S_ChannelB", os[1] || "?"], ["DiscrepancyTime", "T#100MS"], ["S_EquivalentOut", f.id + "_EQ.S_EquivalentOut"]]);
                row(f.id + "_ESPE", "SF_ESPE", mapCols("light_curtain"), [["S_ESPE_In", f.id + "_EQ.S_EquivalentOut"], ...common, ["S_ESPE_Out", f.id + "_OK"]]);
                if (f.kind === "muting")
                    L.push(tr("Muting: doplň SF_MutingPar / SF_MutingSeq s muting senzory a maximální dobou mutingu (IEC 62046) — senzory nejsou v návrhu."), "");
                break;
            case "mat":
                row(f.id + "_EQ", "SF_Equivalent", mapCols("dual_channel"), [["Activate", "TRUE"], ["S_ChannelA", ch[0] || "?"], ["S_ChannelB", ch[1] || "?"], ["DiscrepancyTime", "T#500MS"], ["S_EquivalentOut", f.id + "_EQ.S_EquivalentOut"]]);
                row(f.id + "_PSE", "SF_PSE", "", [["S_PSE_In", f.id + "_EQ.S_EquivalentOut"], ...common, ["S_PSE_Out", f.id + "_OK"]]);
                break;
            case "two_hand":
                for (let b = 0; b < 2; b++)
                    row(f.id + "_AV" + (b + 1), "SF_Antivalent", mapCols("dual_channel"), [["Activate", "TRUE"], ["S_ChannelNC", nc[b] || "?"], ["S_ChannelNO", no[b] || "?"], ["DiscrepancyTime", "T#100MS"], ["S_AntivalentOut", f.id + "_AV" + (b + 1) + ".S_AntivalentOut"]]);
                row(f.id + "_TH", "SF_TwoHandControlTypeIII", mapCols("two_hand"), [["Activate", "TRUE"], ["S_Button1", f.id + "_AV1.S_AntivalentOut"], ["S_Button2", f.id + "_AV2.S_AntivalentOut"], ["S_TwoHandOut", f.id + "_OK"]]);
                L.push(tr("Typ IIIC (ISO 13851): každé tlačítko spínací + rozpínací kontakt, souběh do 500 ms; uvolnění kteréhokoli tlačítka zastaví pohyb."), "");
                break;
            case "enabling":
                row(f.id + "_EN", "SF_EnableSwitch", mapCols("enable_device"), [["Activate", "TRUE"], ["S_SafetyActive", "SF_SetupMode"], ["S_EnableSwitchCh1", ch[0] || "?"], ["S_EnableSwitchCh2", ch[1] || "?"], ["S_AutoReset", "FALSE"], ["Reset", "SF_Reset"], ["S_EnableSwitchOut", f.id + "_OK"]]);
                break;
            case "mode":
                row(f.id + "_MS", "SF_ModeSelector", mapCols("mode_select"), [["Activate", "TRUE"], ["S_Mode0", ch[0] || "?"], ["S_Mode1", ch[1] || "?"], ["S_Unlock", "SF_ModeUnlock"], ["S_SetMode", "SF_ModeConfirm"], ["AutoSetMode", "FALSE"], ["ModeMonitorTime", "T#2S"], ["Reset", "SF_Reset"], ["S_Mode1Sel", "SF_SetupMode"], ["S_AnyModeSel", f.id + "_OK"]]);
                break;
            default: break;
        }
    }
    L.push("## " + tr("Výstupy"), "");
    for (const o of programOutputs(prj, p)) {
        L.push("### " + o.g.id + " — " + cell(o.g.label), "", tr("Uvolnění: {en} (AND).", { en: o.enables.map(x => x + "_OK").join(" AND ") }), "");
        row(o.g.id + "_OC", "SF_OutControl", mapCols("out_control"), [["Activate", "TRUE"], ["S_SafeControl", o.enables.map(x => x + "_OK").join(" AND ")], ["ProcessControl", "TRUE"], ["StaticControl", "TRUE"], ["S_StartReset", "FALSE"], ["S_AutoReset", "FALSE"], ["Reset", "SF_Reset"], ["S_OutControl", o.g.id + "_OC.S_OutControl"]]);
        if (o.g.kind === "sto") {
            if (o.ss1Ms)
                L.push(tr("Kategorie zastavení 1 (SS1-t): STO vypnout se zpožděním {t} ms po řízeném zabrzdění (TOF v Extended Level, nebo funkce SS1 pohonu / SF_SafetyRequest).", { t: o.ss1Ms }), "");
            L.push(tr("`{out}` := {oc}.S_OutControl (STO měniče, dvoukanálově).", { out: o.g.outs.join(" / "), oc: o.g.id + "_OC" }), "");
        }
        else {
            row(o.g.id + "_EDM", "SF_EDM", mapCols("edm"), [["Activate", "TRUE"], ["S_OutControl", o.g.id + "_OC.S_OutControl"], ["EDM1", o.g.fbk[0] || "?"], ["EDM2", o.g.fbk[1] || o.g.fbk[0] || "?"], ["MonitoringTime", "T#300MS"], ["Reset", "SF_Reset"], ["S_EDM_Out", o.g.outs.join(" / ")]]);
        }
    }
    L.push("## " + tr("Diagnostika a zdroje"), "", tr("DiagCode bloků (16#8000 = aktivní bez chyby, 16#C... = chyba) vyveď do standardního programu jen pro zobrazení. Stav `SFn_OK` smí standardní program číst, nikdy zapisovat."), "", ...SAFETY_PLC_SOURCES.plcopen.map(u => "- " + u));
    return L.join("\n");
}
/* ---------------------------------------------------------------- Siemens F-program */
function siemensDoc(prj, p, state) {
    const L = head(prj, p, tr("Bezpečnostní program — Siemens F-program (předpis volání F-bloků)"), state);
    const t = SAFETY_TEXTGEN.siemens;
    L.push(tr("Textový import bezpečnostního programu (SimaticML / SIMATIC Source Documents přes Openness) PLCdesk zatím negeneruje — není ověřený. Tento dokument je podrobný předpis: v TIA Portalu (STEP 7 Safety) založ F-runtime skupinu a v F-LAD / F-FBD zavolej instrukce s uvedeným zapojením. Po překladu vznikne nový souhrnný F-podpis → přijetí (acceptance) a validace."), "", "- " + tr(t.feasible) + ": " + tr(t.how), "- " + tr(t.limits), "");
    L.push("## " + tr("Konfigurace F-I/O"), "", tr("- F-DI: páry kanálů vyhodnocení 1oo2 — rozpínací páry ekvivalentně, tlačítka dvouručního ovládání (NO + NC) antivalentně; čas nesouladu 500 ms (OSSD 100 ms); test zkratu napájením snímačů zapnut (kromě OSSD)."), tr("- F-DQ: spínání PM (P/M) pro stykače a cívky ventilů; zpětná hlášení (EDM) na F-DI."), tr("- ACK_NEC = 1 u všech F-I/O s nutnou kvitací (výchozí) — reintegrace jen přes ACK_GL / tlačítko reset."), "", "## " + tr("Bezpečnostní signály"), "", ...ioTable(allSignals(p)), "");
    const blk = (name) => SAFETY_BLOCKS_SIEMENS.find(b => b.name === name);
    const call = (inst, fb, pins) => {
        const def = blk(fb);
        L.push(tr("**{inst}** : `{fb}` — {purpose}", { inst, fb, purpose: def ? tr(def.purpose) : "" }), "", tr("| Parametr | Připojení | Význam |"), "|---|---|---|");
        for (const [pin, v] of pins) {
            const m = def ? [...def.inputs, ...def.outputs].find(x => x.name === pin) : undefined;
            L.push("| " + pin + " | `" + v + "` | " + cell(m && m.meaning ? tr(m.meaning) : "") + " |");
        }
        L.push("");
    };
    L.push("## " + tr("Volání po funkcích"), "");
    for (const f of inputFns(p)) {
        const ch = chOf(f, "ch"), os = chOf(f, "ossd"), no = chOf(f, "no");
        L.push("### " + f.id + " — " + cell(f.title), "");
        const delay = ss1Of(prj, f);
        switch (f.kind) {
            case "estop":
            case "temperature":
            case "mat":
                call(f.id + "_DB", "ESTOP1", [["E_STOP", ch[0] ? ch[0] + " (1oo2: " + ch.join(" / ") + ")" : "?"], ["ACK_NEC", "TRUE"], ["ACK", "SF_Reset"], ["TIME_DEL", ms(delay)], ["Q", f.id + "_OK"], ["Q_DELAY", f.id + "_OK_DEL"], ["ACK_REQ", f.id + "_ACK_REQ"]]);
                break;
            case "guard":
            case "guard_lock":
                call(f.id + "_DB", "SFDOOR", [["IN1", ch[0] || "?"], ["IN2", ch[1] || "?"], ["QBAD_IN1", "\"F-DI\".QBAD (" + (ch[0] || "?") + ")"], ["QBAD_IN2", "\"F-DI\".QBAD (" + (ch[1] || "?") + ")"], ["OPEN_NEC", "TRUE"], ["ACK_NEC", "TRUE"], ["ACK", "SF_Reset"], ["Q", f.id + "_OK"], ["ACK_REQ", f.id + "_ACK_REQ"]]);
                if (f.kind === "guard_lock")
                    L.push(tr("Zámek: STEP 7 Safety nemá vlastní instrukci (mapování: SFDOOR + logika). Povel odemknout `{ul}` := žádost ze standardního programu AND všechny výstupy vypnuté (FDBACK.Q = 0) AND uplynulý doběh; `{ok}` := SFDOOR.Q AND hlášení zamčeno.", { ul: (f.design?.signals || []).find(s => s.kind === "unlock")?.tag || "?", ok: f.id + "_OK" }), "");
                break;
            case "light_curtain":
            case "multibeam":
            case "scanner":
            case "muting":
                call(f.id + "_EV", "EV1oo2DI", [["IN1", os[0] || "?"], ["IN2", os[1] || "?"], ["DISCTIME", "T#100MS"], ["ACK_NEC", "TRUE"], ["ACK", "SF_Reset"], ["Q", f.id + "_EV.Q"], ["DISC_FLT", f.id + "_DISC"]]);
                call(f.id + "_DB", "ESTOP1", [["E_STOP", f.id + "_EV.Q"], ["ACK_NEC", "TRUE"], ["ACK", "SF_Reset"], ["TIME_DEL", ms(delay)], ["Q", f.id + "_OK"], ["Q_DELAY", f.id + "_OK_DEL"]]);
                L.push(tr("ESTOP1 zde slouží jako blokování opětovného startu po přerušení závory (ruční kvitace)."), "");
                if (f.kind === "muting")
                    L.push(tr("Muting: MUT_P (paralelní muting se 4 senzory, S7-1200/1500) — senzory nejsou v návrhu, doplň je."), "");
                break;
            case "two_hand":
                call(f.id + "_DB", "TWO_H_EN", [["IN1", (no[0] || "?") + " (1oo2 NO/NC)"], ["IN2", (no[1] || "?") + " (1oo2 NO/NC)"], ["ENABLE", "TRUE"], ["DISCTIME", "T#500MS"], ["Q", f.id + "_OK"]]);
                break;
            case "enabling":
                call(f.id + "_EV", "EV1oo2DI", [["IN1", ch[0] || "?"], ["IN2", ch[1] || "?"], ["DISCTIME", "T#500MS"], ["ACK_NEC", "TRUE"], ["ACK", "SF_Reset"], ["Q", f.id + "_OK"]]);
                L.push(tr("Povolovací spínač platí jen v seřizovacím režimu: `{ok}` AND režim SEŘIZOVÁNÍ (logika F-LAD).", { ok: f.id + "_OK" }), "");
                break;
            case "mode":
                L.push(tr("Volba režimu: STEP 7 Safety nemá vlastní instrukci — logika F-LAD: právě jeden režim aktivní, změna jen s potvrzením; výstup `{ok}`.", { ok: f.id + "_OK" }), "");
                break;
            default: break;
        }
    }
    L.push("## " + tr("Výstupy"), "");
    for (const o of programOutputs(prj, p)) {
        const on = o.enables.map(x => x + "_OK").join(" AND ");
        L.push("### " + o.g.id + " — " + cell(o.g.label), "");
        if (o.g.kind === "sto") {
            L.push(tr("`{out}` (F-DQ) := {on}{ss1}.", { out: o.g.outs.join(" / "), on, ss1: o.ss1Ms ? " " + tr("— SS1-t: vypnutí STO zpozdit o {t} ms po poklesu uvolnění (TOF v F-LAD; u ESTOP1 výstup Q_DELAY), pohon mezitím řízeně zabrzdí", { t: o.ss1Ms }) : "" }), "");
        }
        else {
            call(o.g.id + "_FB", "FDBACK", [["ON", on], ["FEEDBACK", o.g.fbk.join(" + ") + (o.g.fbk.length > 1 ? " " + tr("(rozpínací kontakty v sérii)") : "")], ["QBAD_FIO", "\"F-DQ\".QBAD (" + o.g.outs[0] + ")"], ["ACK_NEC", "TRUE"], ["ACK", "SF_Reset"], ["FDB_TIME", "T#300MS"], ["Q", o.g.outs.join(" / ")], ["ERROR", o.g.id + "_EDM_ERR"]]);
        }
    }
    L.push("## " + tr("Kvitace a rozhraní"), "");
    call("ACK_GL_DB", "ACK_GL", [["ACK_GLOB", "SF_Reset"]]);
    L.push(tr("Standardní program čte stav funkcí (`SFn_OK`, ACK_REQ) jen pro zobrazení a pro enable / kvitaci — bezpečnostní program z něj nic nepřebírá kromě žádostí (odemknutí). Kvitace z HMI jen přes ACK_OP (dvoukrokově)."), "", ...SAFETY_PLC_SOURCES.siemens.map(u => "- " + u));
    return L.join("\n");
}
/* ---------------------------------------------------------------- Rockwell GuardLogix */
/** Hodnota parametru Safety Function u DCS (jen popisná). */
const DCS_FN = { estop: "EMERGENCY_STOP", guard: "SAFETY_GATE", light_curtain: "LIGHT_CURTAIN", multibeam: "LIGHT_CURTAIN", scanner: "AREA_SCANNER", mat: "SAFETY_MAT", muting: "LIGHT_CURTAIN", temperature: "USER_DEFINED", enabling: "USER_DEFINED", guard_lock: "SAFETY_GATE", mode: "USER_DEFINED" };
export function rockwellSafety(prj, p, state) {
    const rungs = [];
    const tags = [];
    const tag = (name, type, desc, io = false) => { if (!tags.some(t => t.name === name))
        tags.push({ name, type, desc: lxAscii(desc), io }); };
    const banner0 = state === "approved"
        ? trx("SCHVÁLENO: bezpečnostní program schválen v PLCdesk; podpis safety tasku vytvoř v Logix Designeru po validaci.")
        : trx("NESCHVÁLENO: návrh bezpečnostního programu z PLCdesk k revizi. Neověřeno importem. Podpis safety tasku vzniká až v Logix Designeru.");
    rungs.push({ comment: lxAscii(banner0), text: "NOP();" });
    for (const s of allSignals(p))
        if (s.kind !== "status")
            tag(s.tag, "BOOL", s.text, true);
    tag("SF_InputStatus", "BOOL", trx("Stav bezpečnostních vstupních modulů (1 = platné) - propojit se stavem modulu"));
    tag("SF_OutputStatus", "BOOL", trx("Stav bezpečnostních výstupních modulů (1 = platné) - propojit se stavem modulu"));
    for (const f of inputFns(p)) {
        const ch = chOf(f, "ch"), os = chOf(f, "ossd"), no = chOf(f, "no"), nc = chOf(f, "nc");
        const cmt = lxAscii(f.id + " - " + stripDia(f.title) + " (PLr " + (f.risk.plr || "-") + ")");
        tag(f.id + "_OK", "BOOL", trx("Bezpečnostní funkce {sf} v pořádku (uvolnění)", { sf: f.id }));
        const a = ch[0] || os[0] || "SF_Unused", b = ch[1] || os[1] || "SF_Unused";
        if (f.kind === "two_hand") {
            tag(f.id + "_THRS", "THRS_ENHANCED", trx("Instrukce THRSe (dvouruční ovládání)"));
            rungs.push({ comment: cmt, text: `THRSe(${f.id}_THRS,500,1,0,${no[0] || "?"},${nc[0] || "?"},${no[1] || "?"},${nc[1] || "?"},SF_InputStatus,SF_Reset);` });
            rungs.push({ comment: "", text: `XIC(${f.id}_THRS.O1)OTE(${f.id}_OK);` });
        }
        else if (f.kind === "guard_lock") {
            const lk = chOf(f, "lock")[0] || "SF_Unused", ul = (f.design?.signals || []).find(s => s.kind === "unlock")?.tag || "SF_Unused";
            tag(f.id + "_DCSTL", "DCI_STOP_TEST_LOCK", trx("Instrukce DCSTL (kryt se zámkem)"));
            tag("STD_UnlockRequest", "BOOL", trx("Žádost o odemknutí ze standardního programu (jen žádost)"));
            tag("SF_Standstill", "BOOL", trx("Nebezpečné pohyby zastavené (výstupy vypnuté, doběh uplynul)"));
            tag("SF_TestRequest", "BOOL", trx("Požadavek testu zařízení (není-li použit, 0)"));
            rungs.push({ comment: cmt, text: `DCSTL(${f.id}_DCSTL,SAFETY_GATE,0,500,0,0,${a},${b},SF_TestRequest,STD_UnlockRequest,${lk},SF_Standstill,SF_InputStatus,SF_Reset);` });
            rungs.push({ comment: "", text: `XIC(${f.id}_DCSTL.O1)OTE(${f.id}_OK);` });
            rungs.push({ comment: lxAscii(trx("Povel odemknout jen po zastavení nebezpečného pohybu")), text: `XIC(${f.id}_DCSTL.ULC)OTE(${ul});` });
        }
        else if (f.kind === "enabling") {
            tag(f.id + "_DCSRT", "DCI_START", trx("Instrukce DCSRT (povolovací spínač)"));
            tag("SF_SetupMode", "BOOL", trx("Seřizovací režim zvolen (volič režimu)"));
            rungs.push({ comment: cmt, text: `DCSRT(${f.id}_DCSRT,USER_DEFINED,0,500,SF_SetupMode,${a},${b},SF_InputStatus,SF_Reset);` });
            rungs.push({ comment: "", text: `XIC(${f.id}_DCSRT.O1)OTE(${f.id}_OK);` });
        }
        else if (f.kind === "mode") {
            rungs.push({ comment: lxAscii(cmt + " - " + trx("volba režimu: doplň EPMS podle voliče (rozhraní EPMS v rešerši neověřeno)")), text: `XIC(${a})OTE(${f.id}_OK);` });
        }
        else {
            tag(f.id + "_DCS", "DCI_STOP", trx("Instrukce DCS (dvoukanálové zastavení)"));
            rungs.push({ comment: cmt, text: `DCS(${f.id}_DCS,${DCS_FN[f.kind] || "USER_DEFINED"},0,${os.length ? 100 : 500},0,0,${a},${b},SF_InputStatus,SF_Reset);` });
            rungs.push({ comment: "", text: `XIC(${f.id}_DCS.O1)OTE(${f.id}_OK);` });
        }
    }
    tag("SF_Unused", "BOOL", trx("Nepoužitý vstup (0)"));
    for (const o of programOutputs(prj, p)) {
        const en = o.g.id + "_EN";
        tag(en, "BOOL", trx("Uvolnění skupiny {g}", { g: o.g.id }));
        rungs.push({ comment: lxAscii(o.g.id + " - " + stripDia(o.g.label)), text: o.enables.map(x => `XIC(${x}_OK)`).join("") + `OTE(${en});` });
        if (o.g.kind === "sto") {
            if (o.ss1Ms) {
                tag(o.g.id + "_SS1", "TIMER", trx("SS1-t: zpoždění STO po řízeném zabrzdění"));
                rungs.push({ comment: lxAscii(trx("SS1-t: STO vypnout po zpoždění {t} ms", { t: o.ss1Ms })), text: `XIO(${en})TON(${o.g.id}_SS1,${o.ss1Ms},0);` });
                rungs.push({ comment: "", text: `[XIC(${en}) ,XIO(${o.g.id}_SS1.DN) ]OTE(${o.g.outs[0]});` });
            }
            else
                rungs.push({ comment: "", text: `XIC(${en})OTE(${o.g.outs[0]});` });
        }
        else if (o.g.outs.length >= 2 && o.g.fbk.length >= 2) {
            tag(o.g.id + "_CROUT", "CONFIGURABLE_ROUT", trx("Instrukce CROUT (redundantní výstup s EDM)"));
            rungs.push({ comment: lxAscii(trx("Redundantní výstup s hlídáním zpětné vazby (EDM)")), text: `CROUT(${o.g.id}_CROUT,0,500,${en},${o.g.fbk[0]},${o.g.fbk[1]},SF_InputStatus,SF_OutputStatus,SF_Reset);` });
            rungs.push({ comment: "", text: `XIC(${o.g.id}_CROUT.O1)OTE(${o.g.outs[0]});` });
            rungs.push({ comment: "", text: `XIC(${o.g.id}_CROUT.O2)OTE(${o.g.outs[1]});` });
        }
        else {
            rungs.push({ comment: lxAscii(trx("Hlášení polohy {fbk} hlídat (DCM / logika) - doplnit", { fbk: o.g.fbk.join(", ") || "-" })), text: `XIC(${en})OTE(${o.g.outs[0]});` });
        }
    }
    const l5x = genRockwellSafetyL5X({
        name: "PLCdesk_Safety", description: lxAscii((prj.meta.name || "PLCdesk") + " - " + banner0), banner: lxAscii(banner0), tags, rungs,
    });
    return { l5x, rungs, tags };
}
function rockwellReadme(prj, p, state) {
    const t = SAFETY_TEXTGEN.rockwell;
    return [
        lxAscii(state === "approved" ? trx("SCHVÁLENO - bezpečnostní program schválen; validace na stroji je povinná.") : trx("NESCHVÁLENO - návrh bezpečnostního programu k revizi.")),
        "",
        lxAscii(trx("PLCdesk_Safety.L5X: safety program (Class = Safety) s rutinou SafetyRoutine (ladder). Import: Safety Task -> Add -> Import Program. Projekt nesmí být safety-locked ani mít podpis safety tasku.")),
        lxAscii(trx("Podpis safety tasku (safety signature) vzniká až v Logix Designeru po přeložení, přezkoumání a validaci - PLCdesk ho negeneruje.")),
        lxAscii(trx("Pořadí operandů DCS / DCSTL / THRSe / DCSRT / CROUT a výčtové hodnoty (Safety Function, Input Type, Restart Type) jsou podle rešerše RM095 - po importu je zkontroluj v dialogu instrukce. Neověřeno importem.")),
        lxAscii(trx("Vstupní a výstupní tagy jsou BOOL zástupci - nahraď je aliasy na kanály bezpečnostních modulů (Local:x:I.Pt00Data) a SF_InputStatus / SF_OutputStatus stavem modulů.")),
        "",
        lxAscii(trx(t.how)), lxAscii(trx(t.limits)), "",
        ...SAFETY_PLC_SOURCES.rockwell.map(u => "- " + u),
        "",
        lxAscii(trx("Projekt: {name}", { name: prj.meta.name || "-" })),
    ].join("\n");
}
/* ---------------------------------------------------------------- Pilz / SICK / Schmersal / relé */
function configDoc(prj, p, state, target) {
    const col = target === "pilz" ? "pilz_pnozmulti" : target === "sick" ? "sick_flexisoft" : "";
    const titles = {
        pilz: tr("Konfigurace — Pilz PNOZmulti (PNOZmulti Configurator)"),
        sick: tr("Konfigurace — SICK Flexi Soft (Flexi Soft Designer)"),
        schmersal: tr("Konfigurace — Schmersal PROTECT PSC1 (SafePLC2)"),
        relay: tr("Zapojení — bezpečnostní relé"),
    };
    const L = head(prj, p, titles[target] || titles.relay, state);
    const tg = SAFETY_TEXTGEN[target === "relay" ? "pilz" : target];
    if (target === "relay")
        L.push(tr("Každá vstupní bezpečnostní funkce má vlastní bezpečnostní relé (nebo modul dvouručního ovládání); výstupy relé uvolňují výstupní skupiny v sérii (AND). Reset: tlačítko v sérii se zpětnovazební smyčkou (rozpínací zrcadlové kontakty stykačů) — hlídaný ruční start. Přesné svorky podle návodu zvoleného relé."), "");
    else
        L.push(tr("Konfigurace se dělá graficky v nástroji výrobce — textový import logiky není dokumentovaný, proto předpis: prvky, parametry a propojení."), "", ...(tg ? ["- " + tr(tg.feasible) + ": " + tr(tg.how) + (tg.limits ? " " + tr(tg.limits) : "")] : []), "");
    if (target === "schmersal")
        L.push(tr("Názvy funkčních bloků SafePLC2 nebyly v rešerši ověřeny — uveden druh funkce a parametry."), "");
    L.push("## " + tr("Bezpečnostní signály"), "", ...ioTable(allSignals(p)), "");
    L.push("## " + tr("Vstupní funkce"), "", tr("| Funkce | Prvek / blok | Vstupy | Parametry | Výstup |"), "|---|---|---|---|---|");
    const kindMap = { estop: "estop", guard: "guard", guard_lock: "guard_lock", light_curtain: "light_curtain", multibeam: "light_curtain", scanner: "light_curtain", muting: "muting", two_hand: "two_hand", enabling: "enable_device", mode: "mode_select", mat: "guard", temperature: "estop" };
    for (const f of inputFns(p)) {
        const m = SAFETY_BLOCK_MAP[kindMap[f.kind] || "estop"];
        const el = col && m ? tr(m[col]) : target === "relay" ? (f.kind === "two_hand" ? tr("modul dvouručního ovládání (typ IIIC)") : tr("bezpečnostní relé")) + (p.logic.series ? " (" + p.logic.series + ")" : "") : tr(m ? m.popis : "");
        const ins = (f.design?.signals || []).filter(s => s.dir === "in" && s.kind !== "fbk" && s.kind !== "reset").map(s => s.tag).join(", ");
        const par = f.kind === "two_hand" ? tr("souběh ≤ 500 ms, každé tlačítko NO + NC, uvolnění = stop")
            : (f.kind === "light_curtain" || f.kind === "multibeam" || f.kind === "scanner" || f.kind === "muting") ? tr("OSSD, čas nesouladu 100 ms, ruční restart")
                : tr("2 kanály ekvivalentně, čas nesouladu 500 ms, test zkratu (takty), ruční hlídaný reset, test při spuštění");
        L.push("| " + f.id + " " + cell(f.name) + " | " + cell(el) + " | `" + (ins || "—") + "` | " + cell(par) + " | `" + f.id + "_OK` |");
    }
    L.push("", "## " + tr("Výstupy"), "", tr("| Skupina | Uvolnění (AND) | Výstupy | Zpětná vazba (EDM) |"), "|---|---|---|---|");
    for (const o of programOutputs(prj, p))
        L.push("| " + o.g.id + " — " + cell(o.g.label) + " | " + o.enables.map(x => x + "_OK").join(" AND ") + (o.ss1Ms ? " (" + tr("STO se zpožděním {t} ms", { t: o.ss1Ms }) + ")" : "") + " | `" + o.g.outs.join(", ") + "` | `" + (o.g.fbk.join(", ") || "—") + "` |");
    L.push("", tr("Reset: `SF_Reset` — ruční hlídaný reset (sestupná hrana), mimo nebezpečný prostor. EDM: zpětná vazba musí být sepnutá (stykače odpadlé) před každým uvolněním."), "");
    const src = target === "relay" ? [] : SAFETY_PLC_SOURCES[target] || [];
    for (const u of src)
        L.push("- " + u);
    return L.join("\n");
}
/* ---------------------------------------------------------------- vstup */
/** Soubory bezpečnostního programu pro cíl (výchozí podle logiky / `Project.safety.target`). */
export function safetyProgramFiles(prj, target) {
    const p0 = proposeSafety(prj);
    const p = target ? { ...p0, target } : p0;
    const items = safetyApprovalItems(prj);
    const s = safetyApprovalState(prj, items);
    if (!programFunctions(p).length)
        return { state: "pending", target: p.target, files: {} };
    if (!s.fnsApproved)
        return { state: "pending", target: p.target, files: { "00_CEKA_NA_SCHVALENI.md": pendingDoc(prj, p) } };
    const state = s.programApproved && (!target || target === p0.target) ? "approved" : "draft";
    const files = {};
    switch (p.target) {
        case "rockwell": {
            /* L5X je ASCII a latinkou: popisy z návrhu v technickém jazyce (při čínštině angličtina) */
            const pt = withLang(techLang(), () => ({ ...proposeSafety(prj), target: p.target }));
            const r = withLang(techLang(), () => rockwellSafety(prj, pt, state));
            files["PLCdesk_Safety.L5X"] = r.l5x;
            files["README_safety.txt"] = rockwellReadme(prj, p, state);
            break;
        }
        case "siemens":
            files["F_program_predpis.md"] = siemensDoc(prj, p, state);
            break;
        case "plcopen":
            files["PLCopen_Safety_predpis.md"] = plcopenDoc(prj, p, state);
            break;
        default: files["Konfigurace_" + p.target + ".md"] = configDoc(prj, p, state, p.target);
    }
    return { state, target: p.target, files };
}
