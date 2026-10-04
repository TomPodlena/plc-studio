/**
 * Testy emulátoru pro styl kódu OOP (codegen_oop.ts) — část testů emulátoru (emu.test.ts):
 * - 12 příkladů × 5 platforem OOP × 5 jazyků: překlad bez error, běh kódu = návrh (stejné scénáře),
 * - OOP = klasický kód: lockstep obou přeložených programů s náhodnými vstupy (výstupy, kroky,
 *   porucha, stav bloků — busy / error / status / krok),
 * - mutace OOP: chybějící IMPLEMENTS, jiný podpis metody, neplatný odkaz za běhu, chybějící GET,
 *   abstraktní instance, PROTECTED zvenku, rozdíl TcPOU / PLCopen XML proti ST výpisu, OOP na
 *   platformě bez OOP,
 * - jazyk: dědičnost, virtuální volání přes rozhraní a THIS^, SUPER^, vlastnosti, VAR_IN_OUT.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankProject, syncIO, PLAT, supportsOop, instName } from "./model.js";
import { genFor, actuators, manVarOf } from "./codegen.js";
import { setLang, LANGS } from "./i18n.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { emulateCompile, emulateRunMany, emulateFiles, emulateRunFiles } from "./emu/index.js";
const SAMPLE_DIR = new URL("../../../samples/", import.meta.url); // dist/ → kořen repozitáře
const OOP_PLATS = Object.keys(PLAT).filter(supportsOop);
function load(name, style = "oop") {
    const raw = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    prj.platforms = [...OOP_PLATS];
    prj.codeStyle = style;
    syncIO(prj);
    return prj;
}
const samples = () => readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".plcstudio.json")).sort();
const errs = (fs) => fs.filter(f => f.level === "error").map(f => f.rule + " " + f.file + ":" + f.line + ":" + f.col + " " + f.msg);
test("emu OOP: platformy se stylem OOP = rodina CODESYS (5), ostatní OOP nemají", () => {
    assert.deepEqual(OOP_PLATS.sort(), ["beckhoff", "codesys", "delta", "schneider", "wago"]);
    const p = sampleSmall();
    p.codeStyle = "oop";
    for (const plat of ["siemens", "rockwell", "mitsubishi", "omron", "unitronics"]) {
        const c = { ...p, codeStyle: "classic" };
        assert.deepEqual(genFor(p, plat), genFor(c, plat), plat + ": volba OOP se ignoruje");
    }
});
/* ------------------------------------------------------------------ příklady */
test("emu OOP: 12 příkladů × 5 platforem × 5 jazyků — překlad bez chyb, běh kódu = návrh", () => {
    const list = samples();
    assert.ok(list.length >= 12);
    const t0 = Date.now();
    for (const f of list) {
        const prj = load(f);
        for (const l of Object.keys(LANGS)) {
            setLang(l);
            for (const p of OOP_PLATS)
                assert.deepEqual(errs(emulateCompile(prj, p).findings), [], f + " / " + p + " / " + l + ": nálezy překladu OOP");
            const r = emulateRunMany(prj, OOP_PLATS);
            for (const p of OOP_PLATS) {
                const x = r[p];
                assert.equal(x.skipped, undefined, f + " / " + p + ": běh neproběhl");
                assert.ok(x.scenarios.length > 0, f + " / " + p);
                assert.deepEqual(x.diffs.map(d => d.label + " t=" + d.t + " " + d.msg), [], f + " / " + p + " / " + l + ": OOP kód se chová jinak než návrh");
                assert.deepEqual((x.runtime || []).map(e => e.msg), [], f + " / " + p + ": běhové chyby");
            }
        }
    }
    setLang("cs");
    console.log("emu OOP: příklady × 5 platforem × jazyky " + (Date.now() - t0) + " ms");
});
/* ------------------------------------------------------------------ OOP = klasika */
/** LCG — opakovatelné náhodné vstupy. */
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
/**
 * Oba přeložené programy (klasický a OOP) běží scan po scanu se STEJNÝMI náhodnými vstupy
 * (I/O, AUTO, start, kvitace, ruční povely); po každém scanu se porovnají všechny výstupy,
 * řízení stroje a stav každého bloku (krok, busy, porucha, stavové slovo, výstupy analogů).
 */
function lockstep(prj, plat, scans, seed, oopFiles) {
    const cl = emulateFiles(prj, plat, genFor({ ...prj, codeStyle: "classic" }, plat));
    const oo = emulateFiles(prj, plat, oopFiles || genFor({ ...prj, codeStyle: "oop" }, plat));
    assert.ok(cl.prog && oo.prog, plat + ": překlad");
    const A = cl.prog, B = oo.prog;
    const ma = new Float64Array(A.init), mb = new Float64Array(B.init);
    const ea = A.make(ma), eb = B.make(mb);
    const pairs = [];
    const pair = (name, pa, pb) => {
        const a = A.addr(pa), b = B.addr(pb);
        assert.ok(a && b, plat + ": " + name + " v obou programech (" + pa.join(".") + " / " + pb.join(".") + ")");
        pairs.push([name, a.slot, b.slot]);
    };
    for (const e of prj.io)
        if (e.dir === "DO" || e.dir === "AO")
            pair(e.tag, ["GVL_IO", e.tag], ["GVL_IO", e.tag]);
    const hasSeq = prj.program.seq.length > 0;
    for (const v of hasSeq ? ["seqStep", "faultStep", "machineFault"] : actuators(prj).length ? ["machineFault"] : [])
        pair(v, ["MAIN", v], ["MAIN", v]);
    for (const d of prj.devices) {
        const i = instName(d);
        if (d.cls === "Motor" || d.cls === "Ventil") {
            pair(i + ".step", ["MAIN", i, "statStep"], ["MAIN", i, "iStep"]);
            pair(i + ".busy", ["MAIN", i, "busy"], ["MAIN", i, "bBusy"]);
            pair(i + ".error", ["MAIN", i, "error"], ["MAIN", i, "bError"]);
            pair(i + ".status", ["MAIN", i, "status"], ["MAIN", i, "wStatus"]);
        }
        else if (d.cls === "AnalogIn") {
            for (const o of ["value", "alarmHi", "alarmLo"])
                pair(i + "." + o, ["MAIN", i, o], ["MAIN", i, o]);
        }
    }
    /* vstupy: I/O + proměnné HMI (stejný slot v obou programech podle jména) */
    const ins = [];
    const inp = (pa, ai, p, pulse = false) => { const a = A.addr(pa), b = B.addr(pa); if (a && b)
        ins.push({ a: a.slot, b: b.slot, ai, p, pulse }); };
    for (const e of prj.io)
        if (e.dir === "DI" || e.dir === "AI")
            inp(["GVL_IO", e.tag], e.dir === "AI", e.dir === "AI" ? 0.01 : 0.03);
    inp(["MAIN", "modeAuto"], false, 0.004);
    inp(["MAIN", "cmdAutoStart"], false, 0.02, true);
    inp(["MAIN", "cmdAck"], false, 0.01, true);
    for (const d of actuators(prj))
        inp(["MAIN", manVarOf(d)], false, 0.01);
    const r = rng(seed);
    const out = [];
    for (let k = 0; k < scans && out.length < 5; k++) {
        for (const x of ins) {
            if (x.pulse && ma[x.a]) {
                ma[x.a] = mb[x.b] = 0;
                continue;
            }
            if (r() < x.p) {
                const v = x.ai ? Math.round(r() * 32767) : ma[x.a] ? 0 : 1;
                ma[x.a] = v;
                mb[x.b] = v;
            }
        }
        /* občas trvale TRUE uvolnění a AUTO, ať sekvence opravdu běží */
        ea.scan(k * 10);
        eb.scan(k * 10);
        assert.equal(eb.rt.err, "", plat + ": běhová chyba OOP");
        for (const [n, a, b] of pairs)
            if (ma[a] !== mb[b]) {
                out.push("scan " + k + " " + n + ": klasika " + ma[a] + ", OOP " + mb[b]);
                break;
            }
    }
    return out;
}
test("emu OOP: OOP běh = klasický běh (lockstep s náhodnými vstupy, všechny výstupy a stav bloků)", () => {
    setLang("cs");
    const prjs = [["sampleSmall", sampleSmall()], ["sampleComplex", sampleComplex()],
        ...["01_pasovy_dopravnik_vyhazovac.plcstudio.json", "03_nytovaci_lis_NL-1.plcstudio.json", "05_paletizacni_bunka_PB-05.plcstudio.json"].map(f => [f, load(f, "classic")])];
    for (const [name, prj] of prjs) {
        for (const plat of OOP_PLATS) {
            for (const seed of [1, 7, 2026])
                assert.deepEqual(lockstep(prj, plat, 6000, seed), [], name + " / " + plat + " / seed " + seed);
        }
    }
});
test("emu OOP: lockstep pozná i vadu, kterou scénáře návrhu nepokryjí (kvitace se nemaže → druhá kvitace nefunguje)", () => {
    setLang("cs");
    const prj = sampleComplex();
    const files = { ...genFor({ ...prj, codeStyle: "oop" }, "codesys") };
    delete files["PLCopen_Import.xml"];
    files["Gen_Library.st"] = files["Gen_Library.st"].replace("    bResetReq := FALSE;\n", "");
    assert.ok([1, 7, 2026].some(seed => lockstep(prj, "codesys", 6000, seed, files).length > 0), "lockstep musí rozdíl najít");
});
/* ------------------------------------------------------------------ mutace OOP */
const prjOop = () => { setLang("cs"); const p = sampleComplex(); p.codeStyle = "oop"; return p; };
function mutate(plat, fn) {
    const prj = prjOop();
    const files = { ...genFor(prj, plat) };
    fn(files);
    return emulateFiles(prj, plat, files).res.findings;
}
const has = (fs, rule, re, level = "error") => fs.some(f => f.rule === rule && f.level === level && (!re || re.test(f.msg)));
/** ST výpis upravený jen pro ST (soubory pro import se odstraní, ať se nehlásí rozdíl výpisu). */
const stOnly = (f) => { for (const n of Object.keys(f))
    if (/\.Tc(POU|IO|GVL)$|PLCopen/.test(n))
        delete f[n]; };
test("emu OOP mutace: bezchybný výstup nemá nálezy (ani varování kontroly odkazu)", () => {
    for (const p of OOP_PLATS) {
        const fs = mutate(p, () => { });
        assert.deepEqual(fs.filter(f => f.level !== "info").map(f => f.rule + " " + f.msg), [], p);
    }
});
test("emu OOP mutace: chybějící IMPLEMENTS (rozhraní neimplementováno → přiřazení do pole odkazů chyba)", () => {
    /* všude pryč: žádný blok rozhraní neimplementuje */
    const all = mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace(/ IMPLEMENTS I_Device/g, ""); });
    assert.ok(has(all, "type-conv", /neimplementuje rozhraní I_Device/), "přiřazení instance bez IMPLEMENTS");
    /* jen u odvozeného bloku: dědí implementaci od FB_DeviceBase — správně bez chyby */
    const one = mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace("FB_Motor EXTENDS FB_DeviceBase IMPLEMENTS I_Device", "FB_Motor EXTENDS FB_DeviceBase"); });
    assert.deepEqual(errs(one), [], "implementace zděděná od základní třídy");
});
test("emu OOP mutace: metoda s jiným podpisem (rozhraní i přepsání)", () => {
    assert.ok(has(mutate("beckhoff", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace("METHOD PUBLIC Reset\n", "METHOD PUBLIC Reset : BOOL\n"); }), "oop", /jiný podpis než v rozhraní I_Device/));
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace("METHOD PUBLIC Execute\n", "METHOD PUBLIC Execute\nVAR_INPUT\n    bFast : BOOL;\nEND_VAR\n"); }), "oop", /jiný podpis/));
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace(/(FB_Motor EXTENDS[\s\S]*?)METHOD PROTECTED Cycle\n/, "$1METHOD PROTECTED Cycle : INT\n"); }), "oop", /přepisuje metodu bloku FB_DeviceBase s jiným podpisem/));
    /* přepsání s jiným přístupem */
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace(/(FB_Valve EXTENDS[\s\S]*?)METHOD PROTECTED Cycle\n/, "$1METHOD PUBLIC Cycle\n"); }), "oop", /mění přístup/));
});
test("emu OOP mutace: volání přes neplatný odkaz — varování bez kontroly <> 0, za běhu chyba nullref", () => {
    const prj = prjOop();
    const files = { ...genFor(prj, "codesys") };
    stOnly(files);
    files["MAIN.st"] = files["MAIN.st"].replace("aDevices[2] := instM2;\n", "").replace(/IF aDevices\[iDev\] <> 0 THEN/g, "IF TRUE THEN");
    const c = emulateFiles(prj, "codesys", files).res;
    assert.deepEqual(errs(c.findings), [], "přeloží se (jako v CODESYS)");
    assert.ok(c.findings.some(f => f.rule === "iface-guard" && f.level === "warn"), "varování: volání bez kontroly odkazu");
    const r = emulateRunFiles(prj, "codesys", files, { scope: "quick" });
    assert.ok((r.runtime || []).some(e => /nullref/.test(e.msg)), "běhová chyba nullref: " + JSON.stringify(r.runtime));
    assert.equal(r.ok, false);
    /* s kontrolou odkazu (beze změny) je běh v pořádku i s chybějícím přiřazením (zařízení se jen přeskočí) */
    const ok = { ...genFor(prj, "codesys") };
    stOnly(ok);
    ok["MAIN.st"] = ok["MAIN.st"].replace("aDevices[2] := instM2;\n", "");
    assert.deepEqual((emulateRunFiles(prj, "codesys", ok, { scope: "quick" }).runtime || []).map(e => e.msg), []);
});
test("emu OOP mutace: chybějící PROPERTY Get (rozhraní GET žádá), čtení vlastnosti bez GET", () => {
    const drop = (t) => t.replace(/(PROPERTY PUBLIC Fault : BOOL)\nGET\n[\s\S]*?END_GET\n/, "$1\n");
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = drop(f["Gen_Library.st"]); }), "oop", /nemá GET, který rozhraní I_Device žádá/));
    assert.ok(has(mutate("wago", f => { stOnly(f); f["Gen_Library.st"] = drop(f["Gen_Library.st"]); f["MAIN.st"] = f["MAIN.st"].replace("bAnyFault := FALSE;", "bAnyFault := instM1.Fault;"); }), "oop", /nemá GET — nelze ji číst/));
    /* vlastnost jen ke čtení: zápis je chyba */
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["MAIN.st"] = f["MAIN.st"].replace("bAnyFault := FALSE;", "bAnyFault := FALSE;\ninstM1.Fault := TRUE;"); }), "oop", /nemá SET/));
});
test("emu OOP mutace: abstraktní instance, PROTECTED zvenku, SUPER^ na abstraktní metodu, OOP mimo CODESYS", () => {
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["MAIN.st"] = f["MAIN.st"].replace("    iDev : INT;", "    iDev : INT;\n    fbX : FB_DeviceBase;"); }), "oop", /ABSTRACT — jeho instanci nelze vytvořit/));
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["MAIN.st"] = f["MAIN.st"].replace("instM1.Execute();", "instM1.Execute();\ninstM1.Cycle();"); }), "oop", /PROTECTED/));
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace(/(FB_Motor EXTENDS[\s\S]*?METHOD PROTECTED Cycle\n)/, "$1    SUPER^.Cycle();\n"); }), "oop", /ABSTRACT — přes SUPER\^ ji nelze volat/));
    /* neabstraktní blok, který neimplementuje abstraktní metodu */
    assert.ok(has(mutate("codesys", f => { stOnly(f); f["Gen_Library.st"] = f["Gen_Library.st"].replace(/(FUNCTION_BLOCK FB_Motor EXTENDS[\s\S]*?)METHOD PROTECTED Cycle[\s\S]*?END_METHOD\n/, "$1"); }), "oop", /neimplementuje abstraktní metodu Cycle/));
    /* OOP konstrukce na platformě bez OOP (Mitsubishi) */
    const p = prjOop();
    const files = { ...genFor({ ...p, codeStyle: "classic" }, "mitsubishi") };
    files["Gen_Library.st"] = "INTERFACE I_X\nMETHOD Go\nEND_METHOD\nEND_INTERFACE\n" + files["Gen_Library.st"];
    assert.ok(emulateFiles(p, "mitsubishi", files).res.findings.some(f => f.rule === "oop" && f.level === "error"));
});
test("emu OOP mutace: TcPOU / TcIO / TcGVL a PLCopen XML se musí shodovat s ověřeným ST výpisem", () => {
    assert.ok(has(mutate("beckhoff", f => { f["FB_Motor.TcPOU"] = f["FB_Motor.TcPOU"].replace("PT := T#3S", "PT := T#4S"); }), "xml", /FB_Motor v souboru FB_Motor\.TcPOU se liší/));
    assert.ok(has(mutate("beckhoff", f => { f["I_Device.TcIO"] = f["I_Device.TcIO"].replace(/<Property Name="Busy"[\s\S]*?<\/Property>\n/, ""); }), "xml", /I_Device/));
    assert.ok(has(mutate("beckhoff", f => { delete f["FB_Valve.TcPOU"]; }), "xml", /FB_VALVE z ST výpisu nemá soubor TwinCAT/i));
    assert.ok(has(mutate("beckhoff", f => { f["GVL_IO.TcGVL"] = f["GVL_IO.TcGVL"].replace(/%I\*/, "%Q*"); }), "xml", /GVL_IO/));
    assert.ok(has(mutate("beckhoff", f => { f["MAIN.TcPOU"] = f["MAIN.TcPOU"].replace("<![CDATA[", "<![CDATA[x"); }), "xml"));
    for (const p of ["codesys", "schneider", "wago", "delta"]) {
        assert.ok(has(mutate(p, f => { f["PLCopen_Import.xml"] = f["PLCopen_Import.xml"].replace("PT := T#5S", "PT := T#6S"); }), "xml", /FB_Valve v souboru PLCopen_Import\.xml se liší/), p);
        assert.ok(has(mutate(p, f => { f["PLCopen_Import.xml"] = f["PLCopen_Import.xml"].replace('<variable name="fbkRunning">', '<variable name="fbkRun">'); }), "xml", /proměnné v <interface>/), p);
    }
});
/* ------------------------------------------------------------------ jazyk OOP v emulátoru */
test("emu OOP jazyk: dědičnost, virtuální volání (rozhraní, THIS^), SUPER^, vlastnosti, VAR_IN_OUT, pole odkazů", () => {
    setLang("cs");
    const prj = sampleSmall();
    const files = {
        "GVL_IO.st": "{attribute 'qualified_only'}\nVAR_GLOBAL\n    x AT %IX0.0 : BOOL;\nEND_VAR\n",
        "Gen_Library.st": [
            "INTERFACE I_Cnt", "METHOD Tick", "END_METHOD", "PROPERTY N : INT", "GET", "END_GET", "END_PROPERTY", "END_INTERFACE",
            "FUNCTION_BLOCK ABSTRACT FB_Base IMPLEMENTS I_Cnt",
            "VAR iN : INT; END_VAR",
            "VAR CONSTANT C_INC : INT := 1; END_VAR",
            "METHOD PUBLIC Tick", "THIS^.Add();", "END_METHOD",
            "METHOD PROTECTED ABSTRACT Add", "END_METHOD",
            "METHOD PROTECTED Base : INT", "iN := iN + C_INC;", "Base := iN;", "END_METHOD",
            "{attribute 'monitoring' := 'call'}", "PROPERTY PUBLIC N : INT", "GET", "    N := iN;", "END_GET", "END_PROPERTY",
            "END_FUNCTION_BLOCK",
            "FUNCTION_BLOCK FB_One EXTENDS FB_Base",
            "METHOD PROTECTED Add", "SUPER^.Base();", "END_METHOD",
            "END_FUNCTION_BLOCK",
            "FUNCTION_BLOCK FB_Ten EXTENDS FB_Base",
            "METHOD PROTECTED Add", "iN := iN + 10;", "END_METHOD",
            "END_FUNCTION_BLOCK",
            "FUNCTION_BLOCK FB_Io",
            "VAR_IN_OUT k : INT; END_VAR",
            "k := k + 100;",
            "END_FUNCTION_BLOCK",
        ].join("\n"),
        "MAIN.st": [
            "PROGRAM MAIN",
            "VAR CONSTANT N_DEV : INT := 3; END_VAR",
            "VAR a : FB_One; b : FB_Ten; io : FB_Io; aDev : ARRAY[1..N_DEV] OF I_Cnt; i : INT; s : INT; z : INT; isNull : BOOL; END_VAR",
            "aDev[1] := a; aDev[2] := b;",
            "isNull := aDev[3] = 0;",
            "FOR i := 1 TO N_DEV DO",
            "    IF aDev[i] <> 0 THEN aDev[i].Tick(); END_IF;",
            "END_FOR;",
            "s := 0;",
            "FOR i := 1 TO N_DEV DO",
            "    IF aDev[i] <> 0 THEN s := s + aDev[i].N; END_IF;",
            "END_FOR;",
            "io(k := z);",
            "END_PROGRAM",
        ].join("\n"),
    };
    const r = emulateFiles(prj, "codesys", files);
    assert.deepEqual(errs(r.res.findings), []);
    assert.deepEqual(r.res.findings.filter(f => f.rule === "iface-guard"), [], "volání jen po kontrole <> 0");
    const prog = r.prog;
    const m = new Float64Array(prog.init);
    const exe = prog.make(m);
    const at = (...p) => m[prog.addr(p).slot];
    exe.scan(0);
    exe.scan(10);
    assert.equal(at("MAIN", "a", "iN"), 2, "FB_One: Tick → THIS^.Add (virtuální) → SUPER^.Base");
    assert.equal(at("MAIN", "b", "iN"), 20, "FB_Ten: vlastní Add");
    assert.equal(at("MAIN", "s"), 22, "vlastnost N přes rozhraní");
    assert.equal(at("MAIN", "isNull"), 1, "nepřiřazený odkaz = 0");
    assert.equal(at("MAIN", "z"), 200, "VAR_IN_OUT zapisuje zpět");
    assert.equal(exe.rt.err, "");
    /* VAR_IN_OUT musí být ve volání přiřazen */
    const bad = { ...files, "MAIN.st": files["MAIN.st"].replace("io(k := z);", "io();") };
    assert.ok(emulateFiles(prj, "codesys", bad).res.findings.some(f => f.rule === "fb-param" && /VAR_IN_OUT/.test(f.msg)));
    /* přiřazení instance bloku, který rozhraní neimplementuje */
    const bad2 = { ...files, "MAIN.st": files["MAIN.st"].replace("aDev[2] := b;", "aDev[2] := io;") };
    assert.ok(emulateFiles(prj, "codesys", bad2).res.findings.some(f => f.rule === "type-conv" && /neimplementuje rozhraní I_Cnt/.test(f.msg)));
    /* odkaz na rozhraní nelze porovnat jinak než = / <> s 0 */
    const bad3 = { ...files, "MAIN.st": files["MAIN.st"].replace("isNull := aDev[3] = 0;", "isNull := aDev[3] > 0;") };
    assert.ok(emulateFiles(prj, "codesys", bad3).res.findings.some(f => f.rule === "type-conv"));
});
