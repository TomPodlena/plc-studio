/**
 * PLCopen_Import.xml — struktura podle SKUTEČNÉHO importu a překladu v CODESYS V3.5 SP21 Patch 6
 * (3.5.21.60, 2026-10-05; tvar podle exportu téhož IDE):
 * - GVL_IO v addData …/plcopenxml/globalvars projektu, `<configurations />` prázdné (konfiguraci
 *   „Default“ CODESYS odmítne a GVL i úlohu přeskočí),
 * - VAR_IN_OUT jako `<inOutVars>` (jinak C37 + C540 u FB_Axis),
 * - OOP: InterfaceAsPlainText u POU v addData za </body>, u Method / Property / Interface jako přímý potomek,
 * - stejné atributy vlastností v I_Device i v implementaci (jinak C568),
 * a pravidla emulátoru, která každou z odchylek chytí (mutace).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankProject, syncIO, PLAT, isCodesysFamily, supportsOop } from "./model.js";
import { cdsProfile } from "./codesys_profiles.js";
import { axisBlocked } from "./axis_gen.js";
import { genFor } from "./codegen.js";
import { parseStPou, splitLibrary } from "./plcopen.js";
import { setLang } from "./i18n.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { emulateFiles } from "./emu/index.js";
import { xmlProblems } from "./logix.js";
const SAMPLE_DIR = new URL("../../../samples/", import.meta.url); // dist/ → kořen repozitáře
const FAMILY = Object.keys(PLAT).filter(isCodesysFamily);
/* rodina CODESYS se stylem OOP (profily se starším CODESYS — Inovance — OOP nemají) */
const FAMILY_OOP = FAMILY.filter(supportsOop);
function load(name) {
    const raw = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    prj.platforms = Object.keys(PLAT).filter(p => !axisBlocked(prj, p));
    syncIO(prj);
    return prj;
}
const AXIS = "12_portalovy_manipulator_PM-12.plcstudio.json";
const pous = (x) => [...x.matchAll(/<pou name="([^"]+)" pouType="\w+">([\s\S]*?)<\/pou>/g)].map(m => ({ name: m[1], body: m[2] }));
const ifaceOf = (b) => b.slice(0, b.indexOf("</interface>") + 12);
test("PLCopen XML: GVL_IO v addData …/globalvars projektu, <configurations /> prázdné, bez úlohy (CODESYS rodina, klasika i OOP)", () => {
    setLang("cs");
    for (const prj of [sampleSmall(), sampleComplex()])
        for (const style of ["classic", "oop"])
            for (const plat of FAMILY) {
                const x = genFor({ ...prj, codeStyle: style }, plat)["PLCopen_Import.xml"];
                const at = plat + " " + style;
                assert.deepEqual(xmlProblems(x), [], at);
                assert.ok(x.includes("<instances>\n    <configurations />\n  </instances>"), at + ": prázdné configurations");
                assert.ok(!/<configuration\b|<resource\b|<task\b|<pouInstance\b/.test(x), at + ": žádná konfigurace / úloha");
                const ad = /<instances>[\s\S]*?<\/instances>\s*<addData>\s*<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/globalvars" handleUnknown="implementation">\s*<globalVars name="GVL_IO">([\s\S]*?)<\/globalVars>\s*<\/data>/.exec(x);
                assert.ok(ad, at + ": GVL_IO v addData projektu za instances");
                const names = [...ad[1].matchAll(/<variable name="([^"]+)"/g)].map(m => m[1]);
                assert.deepEqual(names, prj.io.map(e => e.tag), at + ": všechny I/O v pořadí");
                /* WAGO a profily bez AT (I/O mapování) adresy nenesou */
                if (plat !== "wago" && cdsProfile(plat)?.at !== false)
                    assert.ok(/<variable name="[^"]+" address="%[IQ]/.test(ad[1]), at + ": adresy");
                if (style === "oop" && supportsOop(plat))
                    assert.ok(/<\/data>\s*<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/interface"/.test(x), at + ": rozhraní ve stejném addData projektu");
            }
});
test("PLCopen XML: VAR_IN_OUT → <inOutVars> (FB_Axis, vzor 12), parseStPou dává inouts; TwinCAT GVL s proměnnou osy", () => {
    setLang("cs");
    const prj = load(AXIS);
    for (const plat of ["codesys", "delta", "wago", "beckhoff"]) {
        const f = genFor(prj, plat);
        const x = f["PLCopen_Import.xml"];
        const ax = pous(x).find(p => p.name === "FB_Axis");
        assert.ok(ax, plat + ": FB_Axis v XML");
        const iface = ifaceOf(ax.body);
        assert.match(iface, /<inOutVars>\s*<variable name="Axis">/, plat + ": Axis v inOutVars");
        assert.ok(!/<localVars>[\s\S]*<variable name="Axis">/.test(iface), plat + ": Axis není lokální");
        const st = splitLibrary(f["Gen_Library.st"]).map(parseStPou).find(p => p.name === "FB_Axis");
        assert.deepEqual(st.inouts.map(v => v.name), ["Axis"], plat);
        assert.ok(!st.locals.some(v => v.name === "Axis"), plat);
        /* TwinCAT: AXIS_REF je v GVL_IO.st — i v GVL importu, jinak MAIN po importu nezná Ax_M1 */
        if (plat === "beckhoff")
            assert.match(x, /<variable name="Ax_M1">\s*<type><derived name="AXIS_REF" \/><\/type>/);
        else
            assert.ok(!x.includes('<variable name="Ax_M1">'), plat + ": osa jen v konfiguraci IDE");
    }
});
test("PLCopen XML OOP: InterfaceAsPlainText tam, odkud ho čte CODESYS (POU za </body>, Method / Property / Interface přímý potomek)", () => {
    setLang("cs");
    const prj = sampleComplex();
    prj.codeStyle = "oop";
    for (const plat of FAMILY_OOP) {
        const x = genFor(prj, plat)["PLCopen_Import.xml"];
        for (const p of pous(x)) {
            const iface = ifaceOf(p.body), tail = p.body.slice(p.body.indexOf("</body>"));
            assert.ok(!/interfaceasplaintext/i.test(iface), plat + " " + p.name + ": nic v <interface>");
            const own = tail.replace(/<data name="[^"]*\/(method|property)"[\s\S]*?<\/(Method|Property)>\s*<\/data>/g, "");
            assert.match(own, /<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/interfaceasplaintext" handleUnknown="implementation"><InterfaceAsPlainText><xhtml[^>]*>(FUNCTION_BLOCK|PROGRAM) /, plat + " " + p.name + ": data za </body>");
        }
        const members = [...x.matchAll(/<(Method|Property|Interface) name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
        assert.ok(members.length >= 10, plat);
        for (const m of members) {
            const own = m[3].replace(/<Methods>[\s\S]*?<\/Methods>|<Properties>[\s\S]*?<\/Properties>|<GetAccessor>[\s\S]*?<\/GetAccessor>/g, "");
            assert.ok(!/plcopenxml\/interfaceasplaintext/.test(own), plat + " " + m[2] + ": ne v addData/data");
            assert.match(own, /\n\s*<InterfaceAsPlainText><xhtml[^>]*>[\s\S]*?<\/xhtml><\/InterfaceAsPlainText>\n\s*<addData \/>/, plat + " " + m[1] + " " + m[2] + ": přímý potomek, pak <addData />");
        }
        /* deklarace nesou modifikátory (ABSTRACT, PROTECTED) — po importu v CODESYS shodné se ST výpisem */
        assert.match(x, /<InterfaceAsPlainText><xhtml[^>]*>METHOD PROTECTED ABSTRACT Cycle/, plat);
        assert.match(x, /interfaceasplaintext" handleUnknown="implementation"><InterfaceAsPlainText><xhtml[^>]*>FUNCTION_BLOCK ABSTRACT FB_DeviceBase IMPLEMENTS I_Device/, plat);
    }
});
test("OOP: {attribute 'monitoring' := 'call'} i u vlastností I_Device (ST výpis, PLCopen XML, TcIO) — shodně s implementací (C568)", () => {
    setLang("cs");
    const prj = sampleSmall();
    prj.codeStyle = "oop";
    for (const plat of FAMILY_OOP) {
        const f = genFor(prj, plat);
        const itf = /^INTERFACE I_Device[\s\S]*?^END_INTERFACE/m.exec(f["Gen_Library.st"])[0];
        for (const pr of ["Fault", "Status", "Busy"]) {
            assert.match(itf, new RegExp("\\{attribute 'monitoring' := 'call'\\}\\nPROPERTY " + pr + " : "), plat + " ST " + pr);
            assert.match(f["Gen_Library.st"], new RegExp("\\{attribute 'monitoring' := 'call'\\}\\nPROPERTY PUBLIC " + pr + " : "), plat + " implementace " + pr);
            const itfXml = /<Interface name="I_Device"[\s\S]*?<\/Interface>/.exec(f["PLCopen_Import.xml"])[0];
            assert.match(itfXml, new RegExp("<InterfaceAsPlainText><xhtml[^>]*>\\{attribute 'monitoring' := 'call'\\}\\nPROPERTY " + pr + " : "), plat + " XML " + pr);
        }
        if (plat === "beckhoff")
            assert.match(f["I_Device.TcIO"], /\{attribute 'monitoring' := 'call'\}\nPROPERTY Fault : BOOL/);
    }
});
/* ------------------------------------------------------------------ emulátor: mutace */
const mutate = (prj, plat, fn) => {
    const f = { ...genFor(prj, plat) };
    fn(f);
    return emulateFiles(prj, plat, f).res.findings;
};
const has = (fs, rule, re, level = "error") => fs.some(f => f.rule === rule && f.level === level && re.test(f.msg));
const noFindings = (fs, rule) => fs.filter(f => f.rule === rule).map(f => f.level + " " + f.msg);
test("emu PLCopen: bezchybný výstup bez nálezů; GVL v <configurations> / chybějící / jiná adresa → chyba", () => {
    setLang("cs");
    const prj = sampleComplex();
    for (const plat of FAMILY) {
        assert.deepEqual(noFindings(mutate(prj, plat, () => { }), "plcopen"), [], plat);
        assert.deepEqual(noFindings(mutate({ ...prj, codeStyle: "oop" }, plat, () => { }), "plcopen"), [], plat + " OOP");
    }
    /* zpět do tvaru, který CODESYS odmítne: konfigurace Default s GVL a úlohou */
    const old = (x) => {
        const g = /<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/globalvars"[^>]*>\s*(<globalVars name="GVL_IO">[\s\S]*?<\/globalVars>)\s*<\/data>\n/.exec(x);
        return x.replace(g[0], "").replace("<configurations />", '<configurations><configuration name="Default"><resource name="Application"><task name="MainTask" interval="PT0.020S" priority="1"><pouInstance name="MAIN" typeName="MAIN" /></task>' + g[1] + "</resource></configuration></configurations>");
    };
    for (const style of ["classic", "oop"]) {
        const fs = mutate({ ...prj, codeStyle: style }, "codesys", f => { f["PLCopen_Import.xml"] = old(f["PLCopen_Import.xml"]); });
        assert.ok(has(fs, "plcopen", /<configurations>.*odmítne/), style + ": konfigurace");
        assert.ok(has(fs, "plcopen", /nemá GVL_IO v addData/), style + ": GVL chybí v addData");
    }
    assert.ok(has(mutate(prj, "delta", f => { f["PLCopen_Import.xml"] = f["PLCopen_Import.xml"].replace('address="%IX0.0"', 'address="%IX7.7"'); }), "plcopen", /GVL_IO v PLCopen XML se liší od GVL_IO\.st/));
    assert.ok(has(mutate(prj, "schneider", f => { f["PLCopen_Import.xml"] = f["PLCopen_Import.xml"].replace(/<variable name="M1_outRun"[\s\S]*?<\/variable>\n/, ""); }), "plcopen", /chybí v XML: M1_OUTRUN/));
});
test("emu PLCopen: VAR_IN_OUT jako lokální proměnná / jiné proměnné rozhraní → chyba (klasika i OOP)", () => {
    setLang("cs");
    const prj = load(AXIS);
    for (const plat of ["codesys", "delta"]) {
        assert.deepEqual(noFindings(mutate(prj, plat, () => { }), "plcopen"), [], plat);
        const asLocal = (x) => {
            const m = /(\s*)<inOutVars>(\s*<variable name="Axis">[\s\S]*?<\/variable>)\s*<\/inOutVars>/.exec(x);
            return x.replace(m[0], "").replace(/(<pou name="FB_Axis"[\s\S]*?<localVars>)/, "$1" + m[2]);
        };
        assert.ok(has(mutate(prj, plat, f => { f["PLCopen_Import.xml"] = asLocal(f["PLCopen_Import.xml"]); }), "plcopen", /POU FB_Axis: proměnné v <interface>.*var AXIS/), plat);
    }
    /* klasika: výstup bloku zapsaný jako vstup */
    const small = sampleSmall();
    assert.ok(has(mutate(small, "codesys", f => { f["PLCopen_Import.xml"] = f["PLCopen_Import.xml"].replace(/<outputVars>/, "<inputVars>").replace(/<\/outputVars>/, "</inputVars>"); }), "plcopen", /POU FB_\w+: proměnné v <interface>/));
    const oop = { ...sampleSmall(), codeStyle: "oop" };
    assert.ok(has(mutate(oop, "wago", f => { f["PLCopen_Import.xml"] = f["PLCopen_Import.xml"].replace('<variable name="fbkRunning">', '<variable name="fbkRun">'); }), "plcopen", /POU FB_Motor: proměnné v <interface>/));
});
test("emu PLCopen OOP: textová deklarace na místě, odkud ji CODESYS nečte → nález (strukturní i rozdíl proti ST výpisu)", () => {
    setLang("cs");
    const prj = sampleComplex();
    prj.codeStyle = "oop";
    const PLAINDATA = /\n(\s*)<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/interfaceasplaintext" handleUnknown="implementation">(<InterfaceAsPlainText>[\s\S]*?<\/InterfaceAsPlainText>)<\/data>/;
    /* POU: plaintext zpět do <interface><addData> (tvar před opravou) */
    const intoIface = (x) => x.replace(/(<pou name="FB_DeviceBase"[\s\S]*?)(<\/interface>)([\s\S]*?)\n\s*<data name="http:\/\/www\.3s-software\.com\/plcopenxml\/interfaceasplaintext"[\s\S]*?<\/data>/, (_a, pre, end, mid) => {
        const m = PLAINDATA.exec(_a);
        return pre + '  <addData><data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation">' + m[2] + "</data></addData>\n      " + end + mid;
    });
    for (const plat of ["codesys", "wago"]) {
        const fs = mutate(prj, plat, f => { f["PLCopen_Import.xml"] = intoIface(f["PLCopen_Import.xml"]); });
        assert.ok(has(fs, "plcopen", /POU FB_DeviceBase: textová deklarace \(InterfaceAsPlainText\) je v <interface>/), plat);
        assert.ok(has(fs, "xml", /FB_DeviceBase v souboru PLCopen_Import\.xml se liší/), plat + ": emulátor plaintext z <interface> nečte");
    }
    /* metoda: plaintext zabalený v addData/data (tvar před opravou) */
    const wrapMethod = (x) => x.replace(/(<Method name="Cycle"[^>]*>[\s\S]*?<\/body>\n)(\s*)<InterfaceAsPlainText>([\s\S]*?)<\/InterfaceAsPlainText>\n\s*<addData \/>/, (_a, pre, ind, inner) => pre + ind + '<addData>\n' + ind + '  <data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation"><InterfaceAsPlainText>' + inner + "</InterfaceAsPlainText></data>\n" + ind + "</addData>");
    const fm = mutate(prj, "codesys", f => { f["PLCopen_Import.xml"] = wrapMethod(f["PLCopen_Import.xml"]); });
    assert.ok(has(fm, "plcopen", /FB_DeviceBase\.Cycle: textová deklarace je zabalená v addData/), "metoda");
    assert.ok(has(fm, "xml", /FB_DeviceBase v souboru PLCopen_Import\.xml se liší/), "metoda: rozdíl proti ST");
    /* vlastnost rozhraní */
    const wrapItfProp = (x) => x.replace(/(<Property name="Fault"[^>]*>\s*<interface><returnType><BOOL \/><\/returnType><\/interface>\s*<GetAccessor \/>\n)(\s*)<InterfaceAsPlainText>([\s\S]*?)<\/InterfaceAsPlainText>\n\s*<addData \/>/, (_a, pre, ind, inner) => pre + ind + '<addData><data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation"><InterfaceAsPlainText>' + inner + "</InterfaceAsPlainText></data></addData>");
    assert.ok(has(mutate(prj, "delta", f => { f["PLCopen_Import.xml"] = wrapItfProp(f["PLCopen_Import.xml"]); }), "plcopen", /I_Device\.Fault: textová deklarace je zabalená/), "vlastnost rozhraní");
});
test("emu OOP: atributy vlastnosti v rozhraní ≠ implementace → varování (CODESYS C568); shodné = bez nálezu", () => {
    setLang("cs");
    const prj = sampleComplex();
    prj.codeStyle = "oop";
    const stOnly = (f) => { for (const n of Object.keys(f))
        if (/\.Tc(POU|IO|GVL)$|PLCopen/.test(n))
            delete f[n]; };
    for (const plat of ["codesys", "beckhoff"]) {
        const ok = mutate(prj, plat, () => { });
        assert.ok(!ok.some(f => /C568/.test(f.msg)), plat + ": shodné atributy");
        /* I_Device bez atributu (tvar před opravou) */
        const fs = mutate(prj, plat, f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace(/(INTERFACE I_Device[\s\S]*?)\{attribute 'monitoring' := 'call'\}\nPROPERTY Fault/, "$1PROPERTY Fault"); });
        assert.ok(has(fs, "oop", /Člen Fault bloku FB_DeviceBase má jiné atributy než v rozhraní I_Device .*C568/, "warn"), plat);
        assert.deepEqual(fs.filter(f => f.level === "error").map(f => f.msg), [], plat + ": jen varování (CODESYS přeloží)");
    }
});
