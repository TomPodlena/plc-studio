/**
 * Unitronics VisiLogic (Vision / Samba) a U90 Ladder (Jazz / M91) — ruční přenos (unitronics_ladder.ts):
 * soubory, operandy (každý signál, jednoznačné adresy, presety časovačů), větve pro každý krok a zařízení,
 * ASCII, determinismus, jazyky, emulátor (info bez pádu), osa nepodporována — a LOCKSTEP: interpret žebříčku
 * scan po scanu proti emulaci téhož ST (plochá logika UniLogicu) s náhodnými vstupy = převod zachová chování.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankProject, syncIO, PLAT, validateProject, isManualPlat, stripDia } from "./model.js";
import { genFor, uniSections, genUnitronicsTags } from "./codegen.js";
import { buildIR } from "./ir.js";
import { setLang, LANGS } from "./i18n.js";
import { buildLadder, timerPreset, LADDER_PLATS } from "./unitronics_ladder.js";
import { emulateCompile, emulateRun, emulateAll, emulateFiles } from "./emu/index.js";
import { axisBlocked } from "./axis_gen.js";
import { buildBom } from "./bom.js";
import { verificationInfo } from "./verification.js";
const SAMPLES = ["00b_lisovaci_linka_LL-03", "01_pasovy_dopravnik_vyhazovac", "03_nytovaci_lis_NL-1", "11_podavaci_lisovaci_stanice_PS-11"];
function load(name) {
    const raw = JSON.parse(readFileSync(new URL("../../../samples/" + name + ".plcstudio.json", import.meta.url), "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    syncIO(prj);
    return prj;
}
const csvRows = (s) => s.split("\n").slice(1).filter(Boolean).map(l => (l.match(/"([^"]*)"/g) || []).map(x => x.slice(1, -1)));
test("vision / jazz: platformy, ruční přenos, ověření beta", () => {
    for (const p of LADDER_PLATS) {
        assert.ok(PLAT[p] && isManualPlat(p), p);
        assert.equal(verificationInfo(p).state, "beta", p);
        assert.ok(verificationInfo(p).formats.every(f => f.state === "manual"), p);
    }
    assert.ok(!isManualPlat("unitronics"));
});
test("vision / jazz: soubory, operandy, větve, ASCII, determinismus", () => {
    setLang("cs");
    for (const name of SAMPLES)
        for (const plat of LADDER_PLATS) {
            const prj = load(name);
            const f = genFor(prj, plat);
            assert.deepEqual(Object.keys(f).sort(), ["IO_mapa.csv", "Ladder.html", "Ladder.md", "Operandy.csv", "README.txt"], name + "/" + plat);
            assert.deepEqual(genFor(load(name), plat), f, name + "/" + plat + ": determinismus");
            for (const k of ["Operandy.csv", "IO_mapa.csv"])
                assert.ok(!/[^\x00-\x7F]/.test(f[k]), name + "/" + plat + "/" + k + ": ASCII");
            for (const block of f["Ladder.md"].match(/```\n[\s\S]*?```/g) || [])
                assert.ok(!/[^\x00-\x7F]/.test(block), name + "/" + plat + ": kresba ASCII");
            assert.ok(/STAV OVĚŘENÍ: BETA/.test(f["README.txt"]) && /NEOVĚŘENO/.test(f["README.txt"]), name + "/" + plat + ": README");
            assert.ok(!/undefined|NaN|\[object Object\]|\{[a-z][A-Za-z]*\}/.test(Object.values(f).join("\n")), name + "/" + plat + ": zástupné znaky");
            /* operandy: každý signál, jednoznačné adresy, časovače v jednotkách platformy */
            const ops = csvRows(f["Operandy.csv"]);
            const byName = new Map(ops.map(r => [r[0], r]));
            const P = buildLadder(prj, plat);
            for (const e of prj.io) {
                const r = byName.get(e.tag);
                assert.ok(r, name + "/" + plat + ": operand " + e.tag);
                assert.equal(r[1], e.dir === "DI" ? "I" : e.dir === "DO" ? "O" : "MI", e.tag);
                const fits = !!P.L.ch.get(e);
                if (fits)
                    assert.ok(r[2] !== "", e.tag + ": adresa");
            }
            const seen = new Set();
            for (const r of ops) {
                const k = r[1] + " " + r[2];
                assert.ok(!seen.has(k), name + "/" + plat + ": duplicitní adresa " + k);
                seen.add(k);
            }
            assert.equal(new Set(ops.map(r => r[0])).size, ops.length, "jména operandů jednoznačná");
            assert.deepEqual(P.problems, [], name + "/" + plat + ": převod bez nepodporovaných konstrukcí");
            for (const o of P.ops.values())
                if (o.type === "T") {
                    assert.ok(o.presetMs !== undefined && o.preset > 0, o.name + ": preset");
                    if (plat === "vision")
                        assert.equal(o.unit, 10, "Vision: 10 ms");
                    assert.ok(o.preset * o.unit >= o.presetMs, o.name);
                    if (plat === "jazz")
                        assert.ok(o.preset <= 16383, "U90: 14 bitů");
                }
            for (const r of csvRows(f["Operandy.csv"]).filter(r => r[1] === "T"))
                assert.ok(/^\d+$/.test(r[4]) && /^\d+$/.test(r[5]), r[0]);
            /* každý krok sekvence a každé zařízení s blokem má větev */
            const md = f["Ladder.md"];
            const ir = buildIR(prj);
            for (const s of ir.seq?.steps || [])
                assert.ok(md.includes("seqStep = #" + s.n), name + "/" + plat + ": krok " + s.n);
            for (const it of ir.devices)
                if (it.kind === "fb" || it.kind === "role")
                    assert.ok(md.includes("## ") && md.includes(it.dev.name), name + "/" + plat + ": zařízení " + it.dev.name);
            for (const sec of P.sections.filter(s => s.kind === "dev"))
                assert.ok(sec.rungs.length > 0, sec.title);
            const nums = P.sections.flatMap(s => s.rungs.map(r => r.no));
            assert.deepEqual(nums, nums.map((_, i) => i + 1), "větve číslované 1…n");
            assert.ok(f["Ladder.html"].startsWith("<!doctype html>") && f["Ladder.html"].includes("page-break-inside:avoid"), "HTML pro tisk");
            /* IO mapa: každý signál s modulem */
            assert.equal(csvRows(f["IO_mapa.csv"]).length, prj.io.length);
        }
});
test("vision / jazz: časovače — Vision 10 ms, U90 nejjemnější jednotka do 14 bitů", () => {
    assert.deepEqual(timerPreset("vision", 3000), { preset: 300, unit: 10 });
    assert.deepEqual(timerPreset("vision", 1015), { preset: 102, unit: 10 });
    assert.deepEqual(timerPreset("jazz", 3000), { preset: 300, unit: 10 });
    assert.deepEqual(timerPreset("jazz", 300000), { preset: 3000, unit: 100 });
    assert.deepEqual(timerPreset("jazz", 2000000), { preset: 2000, unit: 1000 });
});
test("vision / jazz: 5 jazyků — bez češtiny ve výstupech jiných jazyků", () => {
    const prj = load("01_pasovy_dopravnik_vyhazovac");
    for (const lang of Object.keys(LANGS)) {
        setLang(lang);
        for (const plat of LADDER_PLATS) {
            const f = genFor(prj, plat);
            if (lang === "cs")
                continue;
            for (const [k, v] of Object.entries(f)) {
                /* obsah projektu (názvy, popisy) se nepřekládá — kontrolují se jen texty mimo něj */
                let t = v;
                for (const d of prj.devices)
                    t = t.split(d.desc || "\u0000").join("").split(d.name).join("");
                for (const e of prj.io)
                    t = t.split(e.cmt || "\u0000").join("");
                t = t.split(prj.meta.name).join("");
                assert.ok(!/[ěščřžůĚŠČŘŽŮ]/.test(t), lang + "/" + plat + "/" + k + ": " + (t.match(/.{0,40}[ěščřžůĚŠČŘŽŮ].{0,40}/) || [""])[0]);
            }
        }
    }
    setLang("cs");
});
test("vision / jazz: emulátor (info, bez pádu), osa nepodporována, kusovník, validace", () => {
    const prj = load("01_pasovy_dopravnik_vyhazovac");
    for (const plat of LADDER_PLATS) {
        const c = emulateCompile(prj, plat);
        assert.ok(c.ok && c.findings.length === 1 && c.findings[0].level === "info" && c.findings[0].rule === "manual", plat);
        const r = emulateRun(prj, plat);
        assert.ok(r.ok && r.skipped, plat + ": běh přeskočen");
        const bom = buildBom({ ...prj, platforms: [plat] });
        assert.ok(bom.lines.some(l => l.id === "-A1:plc_cpu" && l.orderCode), plat + ": CPU z katalogu");
        assert.ok(!bom.lines.some(l => l.cat === "plc_hmi"), plat + ": displej v CPU");
    }
    const all = emulateAll(prj, { platforms: ["unitronics", "vision", "jazz"], scope: "quick" });
    assert.deepEqual(Object.keys(all.compile), ["unitronics"], "emulateAll ruční přenos přeskočí");
    const ax = load("12_portalovy_manipulator_PM-12");
    for (const plat of LADDER_PLATS) {
        assert.ok(axisBlocked(ax, plat), plat);
        assert.deepEqual(Object.keys(genFor(ax, plat)), ["README.txt"]);
        ax.platforms = [plat];
        assert.ok(validateProject(ax).some(i => i.level === "error"), plat + ": osa = chyba validace");
    }
    /* velký vzor na Jazz: překročené limity = varování */
    const big = load("00b_lisovaci_linka_LL-03");
    big.platforms = ["jazz"];
    assert.ok(validateProject(big).some(i => i.level === "warn" && /MB/.test(i.msg)), "Jazz: limit MB");
});
const w16 = (v) => ((Math.trunc(v) % 65536) + 65536) % 65536;
function ladderScan(P, m, now, tstart) {
    const val = (x) => x.startsWith("#") ? Number(x.slice(1)) : (m.get(x) ?? 0);
    const real = (x) => P.ops.get(x)?.dt === "REAL";
    const ev = (n) => {
        switch (n.t) {
            case "const": return n.v;
            case "no": return !!val(n.op);
            case "nc": return !val(n.op);
            case "cmp": {
                const a = val(n.a), b = val(n.b);
                return n.op === "=" ? a === b : n.op === "<>" ? a !== b : n.op === "<" ? a < b : n.op === ">" ? a > b : n.op === "<=" ? a <= b : a >= b;
            }
            case "and": return n.items.every(ev);
            case "or": return n.items.some(ev);
        }
    };
    for (const s of P.sections)
        for (const r of s.rungs) {
            const c = ev(r.cond);
            for (const o of r.outs) {
                if (o.t === "coil")
                    m.set(o.op, c ? 1 : 0);
                else if (o.t === "set") {
                    if (c)
                        m.set(o.op, 1);
                }
                else if (o.t === "rst") {
                    if (c)
                        m.set(o.op, 0);
                }
                else if (o.t === "timer") {
                    if (!c) {
                        tstart.delete(o.op);
                        m.set(o.op, 0);
                    }
                    else {
                        if (!tstart.has(o.op))
                            tstart.set(o.op, now);
                        m.set(o.op, now - tstart.get(o.op) >= o.presetMs ? 1 : 0);
                    }
                }
                else if (c && o.t === "fn") {
                    const a = o.args.map(val), fp = real(o.dst);
                    let v = o.fn === "MOV" ? a[0] : o.fn === "ADD" ? a[0] + a[1] : o.fn === "SUB" ? a[0] - a[1] : o.fn === "MUL" ? a[0] * a[1]
                        : o.fn === "DIV" ? (fp ? a[0] / a[1] : (a[1] === 0 ? 0 : Math.trunc(a[0] / a[1]))) : o.fn === "INT>FP" ? a[0] : Math.trunc(a[0]);
                    if (fp)
                        v = Math.fround(v);
                    else if (o.fn !== "MOV" || !o.args[0].startsWith("#"))
                        v = Math.trunc(v);
                    m.set(o.dst, v);
                }
            }
        }
}
test("vision: lockstep — žebříček = emulace téhož ST (náhodné vstupy, 4 vzory)", () => {
    setLang("cs");
    for (const name of SAMPLES) {
        const prj = load(name);
        const P = buildLadder(prj, "vision");
        /* týž ST jako vstup převodu (rawMax Vision), přeložený emulátorem UniLogicu */
        const st = uniSections(prj, "vision").sections.map(s => s.st).join("\n\n");
        const files = { "Tags.csv": genUnitronicsTags(prj), "Machine.st": stripDia(st).replace(/[^\x00-\x7F]/g, "?") };
        const { res, prog } = emulateFiles(prj, "unitronics", files);
        assert.ok(res.ok && prog, name + ": ST se přeložil " + JSON.stringify(res.findings.filter(f => f.level === "error").slice(0, 2)));
        const mem = new Float64Array(prog.init), exe = prog.make(mem);
        const slot = (n) => prog.addr([n]);
        /* vstupy = operandy, které program nezapisuje (DI, AI, povely HMI) */
        const written = new Set();
        for (const s of P.sections)
            for (const r of s.rungs)
                for (const o of r.outs)
                    written.add(o.t === "fn" ? o.dst : o.op);
        const inputs = [...P.ops.values()].filter(o => !written.has(o.name) && o.type !== "T" && !o.aux && slot(o.name));
        const compare = [...P.ops.values()].filter(o => !o.aux && o.type !== "T" && slot(o.name));
        const lm = new Map(), ts = new Map();
        let seed = 12345, changes = 0;
        const last = new Map();
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (let scan = 0; scan < 3000; scan++) {
            const now = scan * 37;
            for (const o of inputs) {
                if (rnd() > 0.15 && scan)
                    continue;
                const v = o.dt === "BIT" ? (rnd() < (/^(S\d|.*_in$)/.test(o.name) ? 0.9 : 0.5) ? 1 : 0) : Math.round(rnd() * 16383);
                lm.set(o.name, v);
                mem[slot(o.name).slot] = v;
            }
            exe.scan(now);
            ladderScan(P, lm, now, ts);
            for (const o of compare) {
                const a = mem[slot(o.name).slot], b = lm.get(o.name) ?? 0;
                const same = o.dt === "REAL" ? Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a)) : w16(a) === w16(b);
                assert.ok(same, name + " scan " + scan + ": " + o.name + " ST " + a + " × Ladder " + b);
                if (last.has(o.name) && last.get(o.name) !== b && !inputs.includes(o))
                    changes++;
                last.set(o.name, b);
            }
        }
        assert.ok(changes > 100, name + ": program v testu skutečně pracuje (" + changes + " změn)");
        /* citlivost: záměrná chyba převodu (první SET → RST) se musí projevit rozdílem */
        const bad = buildLadder(prj, "vision");
        const r0 = bad.sections.filter(s => s.kind === "dev").flatMap(s => s.rungs).find(r => r.outs.some(o => o.t === "set"));
        const i0 = r0.outs.findIndex(o => o.t === "set");
        r0.outs[i0] = { t: "rst", op: r0.outs[i0].op };
        const lm2 = new Map(), ts2 = new Map(), mem2 = new Float64Array(prog.init), exe2 = prog.make(mem2);
        seed = 12345;
        let diff = false;
        for (let scan = 0; scan < 3000 && !diff; scan++) {
            const now = scan * 37;
            for (const o of inputs) {
                if (rnd() > 0.15 && scan)
                    continue;
                const v = o.dt === "BIT" ? (rnd() < (/^(S\d|.*_in$)/.test(o.name) ? 0.9 : 0.5) ? 1 : 0) : Math.round(rnd() * 16383);
                lm2.set(o.name, v);
                mem2[slot(o.name).slot] = v;
            }
            exe2.scan(now);
            ladderScan(bad, lm2, now, ts2);
            diff = compare.some(o => o.dt === "REAL" ? Math.abs(mem2[slot(o.name).slot] - (lm2.get(o.name) ?? 0)) > 1e-4 : w16(mem2[slot(o.name).slot]) !== w16(lm2.get(o.name) ?? 0));
        }
        assert.ok(diff, name + ": mutace převodu odhalena");
    }
});
