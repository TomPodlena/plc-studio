/**
 * Testy stylu kódu OOP (codegen_oop.ts) a profilů CODESYS (WAGO, Delta AX):
 * soubory a jejich struktura, robustnost zápisu, import vlastního OOP výstupu (round-trip),
 * HMI cesty, dokumentace (diagram tříd jen u OOP), profily platforem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAT, platBase, isCodesysFamily, supportsOop, codeStyleFor, addrFor, syncIO, validateProject, interlockDevs, } from "./model.js";
import { genFor, seqCond } from "./codegen.js";
import { oopProgram, oopClassSvg, pouText, tcFile, genPLCopenOopXML, OOP_CLASSES } from "./codegen_oop.js";
import { setLang, withLang, LANGS } from "./i18n.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { extractFiles, inferProject } from "./reverse.js";
import { xmlProblems } from "./logix.js";
import { docFiles, allProjectFiles } from "./docs.js";
import { buildHmi, hmiPlcPath } from "./hmi.js";
import { hmiFiles } from "./hmi_export.js";
import { buildBom } from "./bom.js";
const OOP_PLATS = ["codesys", "beckhoff", "schneider", "wago", "delta"];
const oop = (p) => ({ ...p, codeStyle: "oop" });
const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);
test("profily CODESYS: WAGO a Delta AX — základ codesys, rodina CODESYS, OOP; ostatní beze změny", () => {
    assert.equal(platBase("wago"), "codesys");
    assert.equal(platBase("delta"), "codesys");
    assert.equal(platBase("siemens"), "siemens");
    for (const p of OOP_PLATS) {
        assert.ok(isCodesysFamily(p), p);
        assert.ok(supportsOop(p), p);
    }
    for (const p of ["siemens", "rockwell", "mitsubishi", "omron", "unitronics"]) {
        assert.ok(!isCodesysFamily(p));
        assert.ok(!supportsOop(p));
    }
    const p = sampleSmall();
    assert.equal(codeStyleFor(p, "codesys"), "classic", "výchozí styl");
    assert.equal(codeStyleFor(oop(p), "codesys"), "oop");
    assert.equal(codeStyleFor(oop(p), "siemens"), "classic", "OOP jen kde ho platforma umí");
    /* adresy: Delta = CODESYS notace, WAGO bez AT (I/O mapování) */
    const e = p.io.find(x => x.dir === "DI"), w = p.io.find(x => x.dir === "AI");
    assert.equal(addrFor("delta", e, p), addrFor("codesys", e, p));
    assert.equal(addrFor("delta", w, p), addrFor("codesys", w, p));
    assert.equal(addrFor("wago", e, p), "");
    assert.doesNotMatch(genFor(p, "wago")["GVL_IO.st"], /\bAT\b/, "WAGO GVL bez pevných adres");
    assert.match(genFor(p, "delta")["GVL_IO.st"], /AT %IX/, "Delta GVL s adresami CODESYS");
});
test("profily CODESYS: kód shodný s CODESYS (jen hlavičky / README / rawMax / adresy), README s postupem IDE", () => {
    const p = sampleComplex();
    const c = genFor(p, "codesys");
    for (const plat of ["wago", "delta"]) {
        const f = genFor(p, plat);
        assert.deepEqual(Object.keys(f).sort(), Object.keys(c).sort(), plat + ": stejná sada souborů");
        const norm = (s) => s.replace(/ - (CODESYS|WAGO|Delta Electronics) \*\)/g, " - X *)").replace(/rawMax := \d+/g, "rawMax := N").replace(/(AT )?%[IQ][XW][\d.]+/g, "").replace(/[ \t]+/g, " ");
        assert.equal(norm(f["Gen_Library.st"]), norm(c["Gen_Library.st"]), plat + ": knihovna");
        assert.equal(norm(f["MAIN.st"]), norm(c["MAIN.st"]), plat + ": MAIN");
        assert.deepEqual(xmlProblems(f["PLCopen_Import.xml"]), []);
    }
    assert.match(genFor(p, "wago")["README.txt"], /WAGO e!COCKPIT/);
    assert.match(genFor(p, "wago")["README.txt"], /K-Bus/);
    assert.match(genFor(p, "delta")["README.txt"], /DIADESIGNER-AX/);
    assert.match(genFor(p, "delta")["README.txt"], /ADRESY NEOVĚŘENY/);
    assert.match(genFor(p, "wago")["MAIN.st"], /rawMax := 32767/);
    assert.match(genFor(p, "delta")["MAIN.st"], /rawMax := 32000/);
});
test("profily CODESYS: kusovník (katalog WAGO / Delta s ověřenými kódy) a export HMI jako CODESYS", () => {
    for (const [plat, cpu] of [["wago", "750-8212"], ["delta", "AX-308EA0MA1T"]]) {
        const p = sampleComplex();
        p.platforms = [plat];
        const b = buildBom(p);
        assert.equal(b.plat, plat);
        const line = b.lines.find(l => l.cat === "plc_cpu");
        assert.equal(line.orderCode, cpu, plat + ": CPU z katalogu platformy");
        for (const l of b.lines.filter(x => x.cat.startsWith("plc_") && x.orderCode))
            assert.ok(l.src && /^https?:/.test(l.src), plat + " " + l.cat + ": kód má zdroj");
        const h = hmiFiles(p, plat);
        assert.ok(h["Symbolconfiguration_PLCdesk.xml"] && h["README_HMI.txt"], plat + ": HMI export jako CODESYS");
    }
});
test("OOP: soubory podle platformy (TcPOU / TcIO / TcGVL jen TwinCAT), PLCopen XML well-formed, README s oddílem OOP", () => {
    const p = oop(sampleComplex());
    for (const plat of OOP_PLATS) {
        const f = genFor(p, plat);
        for (const n of ["GVL_IO.st", "Gen_Library.st", "FB_Sequence.st", "MAIN.st", "PLCopen_Import.xml", "README.txt"])
            assert.ok(f[n], plat + ": " + n);
        const tc = Object.keys(f).filter(n => /\.Tc/.test(n)).sort();
        if (plat === "beckhoff")
            assert.deepEqual(tc, ["FB_AnalogIn.TcPOU", "FB_AnalogOut.TcPOU", "FB_DeviceBase.TcPOU", "FB_Motor.TcPOU", "FB_Sequence.TcPOU", "FB_Valve.TcPOU", "GVL_IO.TcGVL", "I_Device.TcIO", "MAIN.TcPOU"]);
        else
            assert.deepEqual(tc, [], plat);
        for (const [n, b] of Object.entries(f))
            if (/\.(xml|Tc\w+)$/.test(n))
                assert.deepEqual(xmlProblems(b), [], plat + " " + n);
        assert.match(f["README.txt"], /STYL KÓDU OOP/);
        assert.match(f["README.txt"], /10 ms/);
        assert.match(f["README.txt"], /watchdog/);
        assert.match(f["PLCopen_Import.xml"], /plcopenxml\/pouinheritance/);
        assert.match(f["PLCopen_Import.xml"], /<Interface name="I_Device"/);
    }
});
test("OOP: třídy, rozhraní, robustnost zápisu (bez ukazatelů, __NEW, WHILE), maďarská notace jen uvnitř, I/O tagy beze změny", () => {
    const p = oop(sampleComplex());
    const f = genFor(p, "codesys");
    const all = f["Gen_Library.st"] + f["FB_Sequence.st"] + f["MAIN.st"];
    for (const bad of [/\bPOINTER\b/, /\bREFERENCE TO\b/, /__NEW/, /__DELETE/, /\bWHILE\b/, /\bREPEAT\b/, /\bADR\(/])
        assert.doesNotMatch(all, bad);
    assert.match(f["Gen_Library.st"], /^INTERFACE I_Device$/m);
    assert.match(f["Gen_Library.st"], /^FUNCTION_BLOCK ABSTRACT FB_DeviceBase IMPLEMENTS I_Device$/m);
    for (const c of [...new Set(p.devices.map(d => d.cls))].flatMap(k => OOP_CLASSES[k] ? [OOP_CLASSES[k]] : []))
        assert.match(f["Gen_Library.st"], new RegExp("^FUNCTION_BLOCK " + c + " EXTENDS FB_DeviceBase IMPLEMENTS I_Device$", "m"));
    for (const pr of ["Fault : BOOL", "Status : WORD", "Busy : BOOL"])
        assert.match(f["Gen_Library.st"], new RegExp("PROPERTY PUBLIC " + pr));
    assert.match(f["MAIN.st"], /aDevices : ARRAY\[1\.\.N_DEVICES\] OF I_Device;/);
    assert.match(f["MAIN.st"], /FOR iDev := 1 TO N_DEVICES DO\n\s+IF aDevices\[iDev\] <> 0 THEN/);
    assert.equal((f["FB_Sequence.st"].match(/^\s*CASE seqStep OF$/gm) || []).length, 1, "sekvence jedním CASE");
    /* I/O tagy a proměnné řízení (rozhraní HMI) beze změny */
    for (const e of p.io)
        assert.ok(all.includes("GVL_IO." + e.tag) || f["MAIN.st"].includes(e.tag), e.tag);
    for (const v of ["modeAuto", "cmdAutoStart", "cmdAck", "machineFault", "faultStep", "seqStep", "instM1", "manRun_M1"])
        assert.match(f["MAIN.st"], new RegExp("\\b" + v + "\\b"));
    /* vnitřní proměnné tříd maďarskou notací */
    const prog = oopProgram(p, "codesys");
    for (const c of prog.library)
        for (const b of c.blocks)
            if (b.kind === "var")
                for (const v of b.vars)
                    assert.match(v.name, /^(b|i|w|r|t|fb|a)[A-Z]/, c.name + "." + v.name);
});
test("OOP: výstup je deterministický, GUID objektů TwinCAT jedinečné a stálé", () => {
    const p = oop(sampleComplex());
    assert.deepEqual(genFor(p, "beckhoff"), genFor(p, "beckhoff"));
    const ids = Object.entries(genFor(p, "beckhoff")).filter(([n]) => /\.Tc/.test(n)).flatMap(([, b]) => [...b.matchAll(/Id="\{([^}]+)\}"/g)].map(m => m[1]));
    assert.equal(new Set(ids).size, ids.length, "Id jedinečná v projektu");
});
test("OOP: všech 5 jazyků — bez diakritiky a s přeloženými komentáři; ST výpis = TcPOU = PLCopen (stejné objekty)", () => {
    for (const l of Object.keys(LANGS))
        withLang(l, () => {
            const p = oop(sampleComplex());
            const f = genFor(p, "beckhoff");
            for (const n of ["Gen_Library.st", "FB_Sequence.st", "MAIN.st"])
                assert.doesNotMatch(f[n], /[áčďéěíňóřšťúůýž]/i, l + " " + n + ": bez diakritiky (IEC ST jako klasika)");
            if (l !== "cs")
                assert.doesNotMatch(f["Gen_Library.st"], /Sablona: motor/, l + ": komentáře šablon přeložené");
            const prog = oopProgram(p, "beckhoff");
            assert.match(tcFile(prog.main), /<POU Name="MAIN"/);
            assert.ok(pouText(prog.main).startsWith("PROGRAM MAIN"));
            assert.deepEqual(xmlProblems(genPLCopenOopXML(p, "beckhoff")), []);
        });
});
test("OOP i18n: v jiných jazycích žádný český text generátoru (komentáře kódu bez diakritiky, README, SW dokumentace)", () => {
    const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;
    /* komentáře IEC ST jsou bez diakritiky — kontrola podle textů generátoru OOP */
    const PHRASES = ["krok stavoveho automatu", "kvitace vyzadana metodou Reset", "jeden cyklus zarizeni", "Odkazy na zarizeni",
        "Kvitace: Reset vsem zarizenim", "Porucha stroje a kvitace", "hlavni program", "knihovna trid OOP", "sekvence stroje, styl OOP",
        "Automaticka sekvence stroje", "pocet zarizeni v poli odkazu", "odkazy na zarizeni", "krok sekvence (promenna MAIN", "porucha zarizeni",
        "stavovy automat", "Spolecny zaklad", "styl OOP", "Sablona:"];
    for (const l of ["en", "de", "es", "zh"])
        withLang(l, () => {
            const p = oop(l === "zh" ? withLang("en", sampleComplex) : sampleComplex());
            p.platforms = [...OOP_PLATS];
            for (const plat of OOP_PLATS)
                for (const [n, b] of Object.entries(genFor(p, plat))) {
                    if (n === "README.txt") {
                        const m = b.match(CZ);
                        assert.ok(!m, l + " " + plat + "/README: „" + (m ? b.slice(Math.max(0, m.index - 40), m.index + 40) : "") + "“");
                        continue;
                    }
                    for (const ph of PHRASES)
                        assert.ok(!b.includes(ph), l + " " + plat + "/" + n + ": nepřeložený komentář „" + ph + "“");
                    if (l === "zh" && /\.(st|TcPOU|TcIO)$/.test(n))
                        assert.ok(!/[一-鿿]/.test(b), l + " " + plat + "/" + n + ": kód při čínštině anglicky");
                }
            for (const f of allProjectFiles(p))
                if (f.kind === "text" && /^(07_|.*README)/.test(f.save)) {
                    const m = f.body.match(CZ);
                    assert.ok(!m, l + " / " + f.save + ": „" + (m ? f.body.slice(Math.max(0, m.index - 40), m.index + 40) : "") + "“");
                }
        });
});
/** Srovnatelný obraz projektu (stejně jako round-trip v core.test.ts). */
function rtView(p) {
    const dn = (id) => (p.devices.find(d => d.id === id) || { name: "" }).name;
    return {
        devs: p.devices.map(d => {
            const o = d.opt || {};
            const opt = d.cls === "Motor" ? { fbk: o.fbk !== false, fault: !!o.fault } : d.cls === "Ventil" ? { fbkOpen: o.fbkOpen !== false, fbkClosed: !!o.fbkClosed } : {};
            const an = d.cls === "AnalogIn" || d.cls === "AnalogOut";
            return JSON.stringify({ name: d.name, cls: d.cls, opt, rng: an ? [d.rmin, d.rmax] : null, lim: d.cls === "AnalogIn" ? [d.limLo ?? null, d.limHi ?? null] : null,
                sp: d.cls === "AnalogOut" ? d.setpoint ?? null : null, role: d.cls === "DO" ? d.role ?? null : null });
        }),
        io: p.io.map(e => dn(e.devId) + "." + e.sig + "=" + e.tag + ":" + e.dir),
        estop: dn(p.program.estop),
        locks: interlockDevs(p).map(d => d.name),
        seq: p.program.seq.map(s => { const k = seqCond(p, s).kind; return [s.act === "wait" ? "" : dn(s.dev), s.act, k, k === "none" ? null : s.timeS].join("/"); }),
    };
}
test("import: round-trip OOP výstupu (5 platforem) a profilů WAGO / Delta — export → import → stejný projekt", () => {
    const prjs = [["sampleSmall", sampleSmall()], ["sampleComplex", sampleComplex()]];
    for (const f of ["03_nytovaci_lis_NL-1", "07_transferova_lisovna_TL-07"]) {
        const j = JSON.parse(readFileSync(new URL(f + ".plcstudio.json", SAMPLE_DIR), "utf8"));
        const p = j.prj || j;
        syncIO(p);
        prjs.push([f, p]);
    }
    for (const [name, p] of prjs) {
        const want = rtView(p);
        for (const style of ["oop", "classic"])
            for (const plat of OOP_PLATS) {
                if (style === "classic" && plat !== "wago" && plat !== "delta")
                    continue; // klasika ostatních: core.test.ts
                const files = genFor({ ...p, codeStyle: style }, plat);
                const ex = extractFiles(Object.entries(files).map(([n, text]) => ({ name: n, text })));
                assert.equal(ex.platform, plat, name + "/" + style + "/" + plat + ": platforma");
                assert.equal(ex.unparsed.length, 0, name + "/" + plat + ": vše přečteno");
                const r = inferProject(ex);
                assert.deepEqual(rtView(r.prj), want, name + "/" + style + "/" + plat);
                assert.deepEqual(r.conflicts, [], name + "/" + style + "/" + plat + ": bez rozporů");
                assert.deepEqual(validateProject(r.prj).filter(i => i.level === "error"), [], name + "/" + plat);
                for (const [k, e] of Object.entries(r.evidence))
                    if (/^(dev|seq|lock):|^estop$/.test(k))
                        assert.equal(e.conf, "sure", name + "/" + style + "/" + plat + " " + k);
            }
    }
});
test("OOP: HMI čte vlastnosti (Fault / Status / Busy), klasika výstupy; dokumentace a diagram tříd jen u OOP", () => {
    setLang("cs");
    const p = sampleComplex();
    p.platforms = ["codesys", "siemens"];
    const m = buildHmi(p);
    const t = m.tags.find(x => x.member === "instM1.error");
    assert.equal(hmiPlcPath("codesys", t, p), "MAIN.instM1.error");
    assert.equal(hmiPlcPath("codesys", t, oop(p)), "MAIN.instM1.Fault");
    assert.equal(hmiPlcPath("siemens", t, oop(p)), '"InstMachine".instM1.error', "Siemens bez OOP");
    /* dokumentace: klasika beze změny, OOP s oddílem a diagramem tříd */
    const swC = docFiles(p).find(d => d.path === "07_softwarova_dokumentace.md").body;
    const swO = docFiles(oop(p)).find(d => d.path === "07_softwarova_dokumentace.md").body;
    assert.doesNotMatch(swC, /Styl kódu OOP/);
    assert.match(swO, /## Styl kódu OOP/);
    assert.match(swO, /FB_DeviceBase \| FUNCTION_BLOCK ABSTRACT IMPLEMENTS I_Device/);
    assert.ok(!allProjectFiles(p).some(f => f.save === "00_diagram_trid.svg"));
    const svg = allProjectFiles(oop(p)).find(f => f.save === "00_diagram_trid.svg");
    assert.ok(svg && svg.kind === "svg");
    assert.deepEqual(xmlProblems(svg.body), []);
    for (const c of ["I_Device", "FB_DeviceBase", "FB_Motor", "FB_Valve", "FB_Sequence", "MAIN"])
        assert.match(svg.body, new RegExp('data-class="' + c + '"'));
    assert.match(oopClassSvg(oop(sampleSmall())), /«interface»/);
});
test("OOP: projekt bez sekvence a bez akčních členů (žádné pole odkazů, žádná FB_Sequence)", () => {
    const p = sampleSmall();
    p.program.seq = [];
    const f = genFor(oop(p), "codesys");
    assert.ok(!f["FB_Sequence.st"]);
    const q = sampleSmall();
    q.program.seq = [];
    q.devices = q.devices.filter(d => d.cls === "DI" || d.cls === "DO");
    syncIO(q);
    const g = genFor(oop(q), "codesys");
    assert.doesNotMatch(g["MAIN.st"], /aDevices/);
    assert.match(g["Gen_Library.st"], /zadne instancovane tridy/);
    assert.ok(PLAT.codesys.oop);
});
