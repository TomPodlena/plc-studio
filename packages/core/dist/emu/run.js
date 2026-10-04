import { devById, ioOf, interlockDevs, isCodesysFamily } from "../model.js";
import { Simulator, simulate, simScenarios, T_VALVE_TRAVEL, DI_DELAY } from "../sim.js";
import { actuators, manVarOf, limitedAnalogs, seqCond, hmiGlobalPlat } from "../codegen.js";
import { instName } from "../model.js";
import { tr } from "../i18n.js";
import { TIMER_M_UNIT } from "./compile.js";
const priv = (s) => s;
function shared(prj) {
    const ins = prj.io.filter(e => e.dir === "DI" || e.dir === "AI");
    const sigs = [];
    for (const e of prj.io)
        if (e.dir === "DO")
            sigs.push({ name: e.tag, need: true, get: sim => sim.io[e.key] === true ? 1 : 0 });
    const hasSeq = prj.program.seq.length > 0;
    if (hasSeq) {
        sigs.push({ name: "seqStep", need: true, get: sim => sim.seqStep });
        sigs.push({ name: "faultStep", need: true, get: sim => sim.faultStep });
    }
    sigs.push({ name: "machineFault", need: hasSeq || actuators(prj).length > 0, get: sim => sim.machineFault ? 1 : 0 });
    /* pořadí instancí simulátoru = pořadí pohonů v projektu */
    actuators(prj).forEach((d, i) => sigs.push({ name: instName(d) + ".statStep", need: true, get: sim => sim.insts[i].step }));
    return { inKeys: ins.map(e => e.key), inAi: ins.map(e => e.dir === "AI"), inVals: new Float64Array(ins.length), sigs, dv: new Float64Array(sigs.length) };
}
function pathsFor(plat) {
    const iec = isCodesysFamily(plat);
    return {
        io: (tag) => plat === "siemens" ? [tag] : iec ? ["GVL_IO", tag] : [tag],
        hmi: (v) => plat === "siemens" ? ["InstMachine", v] : plat === "rockwell" || plat === "unitronics" || hmiGlobalPlat(plat) ? [v] : ["MAIN", v],
        inst: (inst, m) => plat === "siemens" ? ["InstMachine", inst, m] : plat === "rockwell" ? [inst, m] : plat === "unitronics" ? [inst + "_" + m] : ["MAIN", inst, m],
    };
}
function setup(prj, sh, plat, prog, rawMax) {
    const P = pathsFor(plat);
    const missing = [];
    const slot = (path, need = true) => {
        const a = prog.addr(path);
        if (!a) {
            if (need)
                missing.push(path.join("."));
            return -1;
        }
        return a.slot;
    };
    const isReal = (path) => { const a = prog.addr(path); return !!a && a.ty.k === "elem" && a.ty.info.cat === "real"; };
    const tagOf = new Map(prj.io.map(e => [e.key, e.tag]));
    const inSlot = new Int32Array(sh.inKeys.length), inReal = new Uint8Array(sh.inKeys.length);
    sh.inKeys.forEach((k, i) => { const path = P.io(tagOf.get(k)); inSlot[i] = slot(path); inReal[i] = isReal(path) ? 1 : 0; });
    const hasSeq = prj.program.seq.length > 0;
    const hmi = {
        modeAuto: hasSeq ? slot(P.hmi("modeAuto")) : -1,
        cmdAutoStart: hasSeq ? slot(P.hmi("cmdAutoStart")) : -1,
        cmdAck: slot(P.hmi("cmdAck"), false),
        man: actuators(prj).map(d => ({ id: d.id, slot: slot(P.hmi(manVarOf(d))) })).filter(x => x.slot >= 0),
    };
    const sigSlot = new Int32Array(sh.sigs.length);
    sh.sigs.forEach((g, i) => {
        const m = /^(inst\w+)\.statStep$/.exec(g.name);
        /* styl OOP: krok bloku je v základní třídě FB_DeviceBase jako iStep (maďarská notace) */
        const path = m ? (prog.addr(P.inst(m[1], "statStep")) || !prog.addr(P.inst(m[1], "iStep")) ? P.inst(m[1], "statStep") : P.inst(m[1], "iStep"))
            : ["seqStep", "faultStep", "machineFault"].includes(g.name) ? P.hmi(g.name) : P.io(g.name);
        sigSlot[i] = slot(path, g.need);
    });
    const ao = [];
    for (const d of prj.devices)
        if (d.cls === "AnalogOut") {
            const e = ioOf(prj, d).raw;
            if (!e)
                continue;
            const s = slot(P.io(e.tag));
            if (s < 0)
                continue;
            const span = d.rmax - d.rmin || 1;
            const v = Number.isFinite(d.setpoint) ? d.setpoint : 0;
            const frac = Math.min(1, Math.max(0, (v - d.rmin) / span));
            ao.push({ name: e.tag, slot: s, expect: frac * rawMax, real: isReal(P.io(e.tag)) });
        }
    const mem = new Float64Array(prog.init);
    return {
        plat, prog, rawMax, mem, exe: prog.make(mem), inSlot, inReal, hmi, sigSlot, ao, prev: new Float64Array(mem.length),
        runtime: [], missing, still: false, hzMs: 0, lazy: false,
    };
}
/* ------------------------------------------------------------ scénáře */
const round = (t) => Math.round(t * 1000) / 1000;
const round1 = (t) => Math.round(t * 10) / 10;
/**
 * Scénáře ověření — tytéž jako verifyProject: simScenarios (běžný cyklus, výpadky hlášení,
 * poruchy motorů, E-stop, blokování, kvitace), druhý cyklus a matice stavů (klid, ruční
 * režim, každý krok × E-stop / blokování / vypnutí AUTO ve třech okamžicích, zamrzlé
 * hlášení, porucha a ztráta hlášení pohonu, ztráta polohy ventilu, analog mimo mez).
 * Matice se tu jen SESTAVÍ (stejná pravidla jako stateMatrix v sim.ts, shodu hlídá test),
 * návrh se nevyhodnocuje — emulátor porovnává kód s návrhem přímo, scan po scanu.
 */
export function emuScenarios(prj, scope, base = {}) {
    const list = [];
    const seen = new Set();
    const push = (s) => {
        const k = JSON.stringify(s.opts);
        if (seen.has(k))
            return;
        seen.add(k);
        list.push({ id: s.id, label: s.label, opts: s.opts });
    };
    for (const s of simScenarios(prj, base))
        push(s);
    const seq = prj.program.seq;
    const nominal = seq.length ? simulate(prj, base) : null;
    if (nominal && nominal.finished && nominal.cycleTime) {
        const again = round1((base.startAt ?? 0.2) + nominal.cycleTime + 1);
        push({ id: "second", label: tr("Druhý cyklus"), opts: { ...base, faults: [{ kind: "start", at: again }], maxTime: again + nominal.cycleTime + 3 } });
    }
    /* ruční režim: všechny pohony ručním povelem, kvitace, vypnutí povelů */
    const acts = actuators(prj);
    if (acts.length) {
        const man = acts.map(d => ({ kind: "man", dev: d.id, at: 0.5, until: 4 }));
        push({ id: "manual-all", label: tr("Ruční režim: povely všech pohonů"), opts: { ...base, startAt: 99, maxTime: 6, faults: [{ kind: "manual", at: 0.1 }, ...man, { kind: "ack", at: 4.5 }] } });
    }
    if (scope !== "full" || !nominal)
        return list;
    /* --- matice stavů (zrcadlo stateMatrix) --- */
    const es = devById(prj, prj.program.estop);
    const locks = interlockDevs(prj);
    const motors = prj.devices.filter(d => d.cls === "Motor");
    const faultMotors = motors.filter(d => ioOf(prj, d).fault);
    const lostMotors = motors.filter(d => ioOf(prj, d).fbkRunning);
    const lostValves = prj.devices.filter(d => d.cls === "Ventil" && ioOf(prj, d).fbkOpen);
    const clampRaw = (v) => Math.min(27648, Math.max(0, Math.round(+v || 0)));
    const limitCases = [];
    for (const d of limitedAnalogs(prj)) {
        const span = d.rmax - d.rmin || 1;
        const rawOf = (v) => clampRaw((v - d.rmin) / span * 27648);
        if (Number.isFinite(d.limHi)) {
            const v = Math.min(d.rmax, d.limHi + 0.05 * span);
            if (v > d.limHi)
                limitCases.push({ d, raw: rawOf(v) });
        }
        if (Number.isFinite(d.limLo)) {
            const v = Math.max(d.rmin, d.limLo - 0.05 * span);
            if (v < d.limLo)
                limitCases.push({ d, raw: rawOf(v) });
        }
    }
    const dt = nominal.opts.dt;
    const stateAt = (t) => { let last; for (const fr of nominal.frames) {
        if (fr.t <= t + 1e-9)
            last = fr;
        else
            break;
    } return last; };
    const mk = (id, label, opts) => push({ id, label, opts });
    const L = (state, what) => state + " + " + what;
    const nSteps = nominal.steps.length + 1;
    { /* klid */
        const at = 0.3, o = { ...base, startAt: 1.0, maxTime: 2.5 };
        if (es)
            mk("m-idle-estop", L(tr("Klid"), tr("E-stop")), { ...o, faults: [{ kind: "estop", at }] });
        for (const d of locks)
            mk("m-idle-lock-" + d.id, L(tr("Klid"), tr("blokování {dev}", { dev: d.name })), { ...o, faults: [{ kind: "interlock", dev: d.id, at }] });
        mk("m-idle-manual", L(tr("Klid"), tr("vypnutí AUTO")), { ...o, faults: [{ kind: "manual", at }] });
        for (const d of faultMotors)
            mk("m-idle-fault-" + d.id, L(tr("Klid"), tr("porucha {dev}", { dev: d.name })), { ...o, faults: [{ kind: "fault", dev: d.id, at }] });
        limitCases.forEach((lc, k) => { if (k % nSteps === 0)
            mk("m-idle-lim-" + lc.d.id, L(tr("Klid"), lc.d.name), { ...o, faults: [{ kind: "analog", dev: lc.d.id, at, raw: lc.raw }] }); });
    }
    if (acts.length) { /* ruční režim */
        const at = 2.0, man = acts.map(d => ({ kind: "man", dev: d.id, at: 0.5 }));
        const o = { ...base, startAt: 99, maxTime: at + 1.4 };
        if (es)
            mk("m-man-estop", L(tr("Ruční režim"), tr("E-stop")), { ...o, faults: [{ kind: "manual", at: 0.1 }, ...man, { kind: "estop", at, release: at + 1 }] });
        for (const d of locks)
            mk("m-man-lock-" + d.id, L(tr("Ruční režim"), tr("blokování {dev}", { dev: d.name })), { ...o, faults: [{ kind: "manual", at: 0.1 }, ...man, { kind: "interlock", dev: d.id, at, until: at + 1 }] });
    }
    const seenStep = new Set();
    let rowNo = 1;
    for (const run of nominal.steps) {
        if (seenStep.has(run.i))
            continue;
        seenStep.add(run.i);
        const st = seq[run.i];
        const dur = (run.tEnd ?? run.tStart + 0.6) - run.tStart;
        const at = round(run.tStart + Math.min(0.3, Math.max(dt, dur / 2)));
        const end = run.tEnd ?? run.tStart + 0.6;
        const pts = [run.tStart + 2 * dt, (run.tStart + end) / 2, end - 4 * dt].map(round).filter(t => t > run.tStart + 1e-9 && t < end - 1e-9);
        const ats = [...new Set(pts.length ? pts : [round(run.tStart + dt)])];
        const id = (k) => "m-" + run.i + "-" + k;
        const S = tr("Krok {n}", { n: run.i + 1 });
        for (const a of ats) {
            if (es)
                mk(id("estop"), L(S, tr("E-stop")) + " (t = " + a + " s)", { ...base, faults: [{ kind: "estop", at: a, release: a + 1 }], maxTime: a + 1.4 });
            for (const d of locks)
                mk(id("lock-" + d.id), L(S, tr("blokování {dev}", { dev: d.name })) + " (t = " + a + " s)", { ...base, faults: [{ kind: "interlock", dev: d.id, at: a, until: a + 1 }], maxTime: a + 1.4 });
            mk(id("manual"), L(S, tr("vypnutí AUTO")) + " (t = " + a + " s)", { ...base, faults: [{ kind: "manual", at: a, until: a + 1 }], maxTime: a + 1.4 });
        }
        const d0 = devById(prj, st.dev), cnd = seqCond(prj, st);
        const instant = run.tEnd !== null && run.tEnd - run.tStart <= 2 * dt + 1e-9;
        if (d0 && cnd.kind === "fbk" && !instant) {
            const deadline = round(run.tStart + (st.timeS || 1) + T_VALVE_TRAVEL + 0.1);
            mk(id("fbk"), L(S, tr("zamrzlé hlášení {dev}", { dev: d0.name })), { ...base, faults: [{ kind: "frozen", dev: d0.id, at: run.tStart }, { kind: "start", at: deadline }], maxTime: deadline + 1.5 });
        }
        const fr = stateAt(at);
        const step = (d) => fr && fr.dev[d.id] ? fr.dev[d.id].step : -1;
        for (const d of faultMotors)
            if (step(d) >= 10 && step(d) < 90)
                mk(id("fault-" + d.id), L(S, tr("porucha {dev}", { dev: d.name })), { ...base, faults: [{ kind: "fault", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 });
        for (const d of lostMotors)
            if (step(d) === 20)
                mk(id("lost-" + d.id), L(S, tr("ztráta hlášení {dev}", { dev: d.name })), { ...base, faults: [{ kind: "lost", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 });
        for (const d of lostValves)
            if (step(d) === 20)
                mk(id("lostv-" + d.id), L(S, tr("ztráta polohy {dev}", { dev: d.name })), { ...base, faults: [{ kind: "lost", dev: d.id, at }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 });
        limitCases.forEach((lc, k) => { if (k % nSteps === rowNo)
            mk(id("lim-" + lc.d.id), L(S, lc.d.name), { ...base, faults: [{ kind: "analog", dev: lc.d.id, at, raw: lc.raw }, { kind: "start", at: at + 1 }], maxTime: at + 1.4 }); });
        rowNo++;
    }
    return list;
}
/* ------------------------------------------------------------ běh */
export function runPlatforms(prj, list, opts = {}) {
    const t0 = Date.now();
    const base = opts.dt ? { dt: opts.dt } : {};
    const scs = emuScenarios(prj, opts.scope || "full", base);
    const sh = shared(prj);
    const progs = list.map(x => setup(prj, sh, x.plat, x.prog, x.rawMax ?? 27648));
    const res = {};
    for (const p of progs) {
        res[p.plat] = { platform: p.plat, scenarios: [], diffs: [], ok: true, ms: 0, scans: 0, skippedScans: 0, runtime: p.runtime };
        for (const m of p.missing)
            p.runtime.push({ level: "error", rule: "runtime", file: "", line: 0, col: 0, platform: p.plat, msg: tr("Signál {name} v kódu chybí — nelze porovnat s návrhem", { name: m }) });
    }
    const startAt0 = base.startAt ?? 0.2;
    const seq = prj.program.seq;
    /* --- scan obou stran + porovnání ------------------------------------------ */
    let scans = 0, skipped = 0, lazy = 0;
    /** Zápis vstupů do paměti kódu; vrací, zda se některý změnil. */
    const feed = (sim, p) => {
        const m = p.mem, c = sim.controls, t = sim.t, iv = sh.inVals, sl = p.inSlot, ai = sh.inAi;
        let ch = false;
        const put = (s, v) => { if (m[s] !== v) {
            m[s] = v;
            ch = true;
        } };
        for (let i = 0; i < sl.length; i++) {
            const s = sl[i];
            if (s < 0)
                continue;
            put(s, ai[i] ? (p.inReal[i] ? Math.fround(iv[i] / 27648 * p.rawMax) : Math.round(iv[i] / 27648 * p.rawMax)) : iv[i]);
        }
        const h = p.hmi;
        if (h.modeAuto >= 0)
            put(h.modeAuto, c.modeAuto ? 1 : 0);
        if (h.cmdAutoStart >= 0)
            put(h.cmdAutoStart, (c.start || t < sim.startUntil - 1e-9) ? 1 : 0);
        if (h.cmdAck >= 0)
            put(h.cmdAck, (c.ack || t < sim.ackUntil - 1e-9) ? 1 : 0);
        for (const x of h.man)
            put(x.slot, c.man[x.id] ? 1 : 0);
        return ch;
    };
    /** Nejbližší doběhnutí časovače kódu [ms] (stav kódu se do té doby sám nezmění). */
    const codeHorizonMs = (p, nowMs) => {
        let h = Infinity;
        const m = p.mem;
        for (const tm of p.prog.timers) {
            const b = tm.base;
            if (tm.kind === "FBD_TIMER") {
                if (m[b + 1] && !m[b + 8] && !m[b + 3])
                    h = Math.min(h, m[b + 12] + m[b + 2]);
            }
            else if (tm.kind.startsWith("TON")) {
                if (m[b] && !m[b + 2])
                    h = Math.min(h, m[b + 4] + m[b + 1]);
            }
            else if (tm.kind.startsWith("TOF")) {
                if (!m[b] && m[b + 2])
                    h = Math.min(h, m[b + 4] + m[b + 1]);
            }
            else if (tm.kind.startsWith("TP")) {
                if (m[b + 2])
                    h = Math.min(h, m[b + 4] + m[b + 1]);
            }
            else if (TIMER_M_UNIT[tm.kind]) {
                if (m[b] && !m[b + 4])
                    h = Math.min(h, m[b + 5] + Math.max(0, m[b + 1] - Math.max(0, m[b + 2])) * TIMER_M_UNIT[tm.kind]);
            }
        }
        return h === Infinity ? h : Math.max(h, nowMs);
    };
    /** Jeden scan: zásahy → vstupy → kód (všechny platformy) → návrh → porovnání. */
    const step = (sim, active, sc, onDiff, ctl) => {
        /* zásahy se do vstupů promítnou jen při změně řízení; jinak platí vstupy z konce minulého scanu
           (model stroje + vnucené hodnoty) — applyInputs() by je nezměnil a scan() ho zavolá znovu */
        if (ctl)
            sim.applyInputs();
        const io = sim.io, iv = sh.inVals;
        for (let i = 0; i < sh.inKeys.length; i++) {
            const v = io[sh.inKeys[i]];
            iv[i] = typeof v === "number" ? v : v ? 1 : 0;
        }
        const now = Math.round(sim.t * 1000);
        for (const p of active) {
            const ch = feed(sim, p);
            /* stejné vstupy a minulý scan nic nezměnil → kód by dal totéž (čas čte jen časovač; do jeho doběhnutí) */
            p.lazy = !ch && p.still && now < p.hzMs - 1 && !p.prog.readsTime && !opts.noSkip;
            if (p.lazy) {
                lazy++;
                continue;
            }
            p.prev.set(p.mem);
            try {
                p.exe.scan(now);
            }
            catch (e) {
                p.exe.rt.err = p.exe.rt.err || (e.message === "loop" ? "loop" : "exception:" + e.message);
            }
            if (p.exe.rt.err) {
                const code = p.exe.rt.err;
                p.exe.rt.err = "";
                if (!p.runtime.some(r => r.msg.includes(code)))
                    p.runtime.push({ level: "error", rule: "runtime", file: "", line: 0, col: 0, platform: p.plat,
                        msg: tr("Běhová chyba kódu ({code}) ve scénáři „{sc}“ v čase {t} s", { code, sc: sc.label, t: round(sim.t) }) });
            }
            p.still = codeStill(p);
            p.hzMs = p.still ? codeHorizonMs(p, now) : Infinity;
        }
        sim.scan();
        scans++;
        const dv = sh.dv;
        let dvCh = false;
        for (let j = 0; j < sh.sigs.length; j++) {
            const v = sh.sigs[j].get(sim);
            if (v !== dv[j]) {
                dv[j] = v;
                dvCh = true;
            }
        }
        for (const p of active) {
            if (!dvCh && p.lazy)
                continue; // návrh ani kód se nezměnil — porovnáno minule
            const m = p.mem, ss = p.sigSlot;
            for (let j = 0; j < ss.length; j++) {
                const s = ss[j];
                if (s < 0 || m[s] === dv[j])
                    continue;
                const name = sh.sigs[j].name;
                onDiff(p, { platform: p.plat, scenario: sc.id, label: sc.label, t: round(sim.t - sim.dt), signal: name, design: dv[j], code: m[s],
                    msg: tr("{signal}: návrh {design}, kód {code}", { signal: name, design: dv[j], code: m[s] }) });
                break;
            }
        }
    };
    /** Podpis stavu návrhu bez běžících časovačů a plynulého pohybu (čísla do pole; porovnání s minulým scanem). */
    const simSig = (sim, out) => {
        let n = 0;
        out[n++] = sim.seqStep;
        out[n++] = sim.faultStep;
        out[n++] = sim.machineFault ? 1 : 0;
        const model = sim.model;
        for (const k in model) {
            const v = model[k];
            out[n++] = v === true ? 1 : v === false ? 0 : +v;
        }
        /* poloha pohonů se mění plynule — do podpisu jen směr pohybu; hranice řeší horizont */
        for (const f of sim.insts) {
            out[n++] = moving(sim, f) ? (f.out ? 2 : 3) + 0.5 : sim.plant[f.d.id];
            out[n++] = f.step + (f.blocked ? 1000 : 0) + (f.lastA ? 2000 : 0) + (f.lastB ? 4000 : 0) + (f.lastR ? 8000 : 0)
                + (f.ton.q ? 16000 : 0) + (f.ton.prev ? 32000 : 0) + (f.ton2.q ? 64000 : 0) + (f.ton2.prev ? 128000 : 0);
        }
        for (const k in sim.tonSeq) {
            const t = sim.tonSeq[k];
            out[n++] = (t.q ? 1 : 0) + (t.prev ? 2 : 0);
        }
        for (const k in sim.seqVar)
            out[n++] = sim.seqVar[k] ? 1 : 0;
        return n;
    };
    const codeStill = (p) => {
        const a = p.mem, b = p.prev, mask = p.prog.etMask;
        for (let i = 0; i < a.length; i++)
            if (a[i] !== b[i] && !mask[i])
                return false;
        return true;
    };
    /** Pohon se pohybuje (model stroje mění polohu, hlášení se změní až na hranici 0 / 1). */
    const moving = (sim, f) => !sim.controls.frozen.includes(f.d.id) && (f.out ? sim.plant[f.d.id] < 1 : sim.plant[f.d.id] > 0);
    const rateOf = (sim, f) => sim.dt / Math.max(f.d.cls === "Motor" ? sim.motorDelay : sim.valveTravel, sim.dt);
    /** Nejbližší čas, kdy by se něco změnilo samo (časovač doběhne, proces dodá vstup). */
    const horizon = (sim, active) => {
        let h = Infinity;
        const now = sim.t;
        const tonLeft = (t, pt) => { if (t.prev && !t.q)
            h = Math.min(h, now + (pt - t.et)); };
        for (const f of sim.insts) {
            if (f.blocked)
                continue;
            tonLeft(f.ton, f.d.cls === "Motor" ? 3 : T_VALVE_TRAVEL);
            tonLeft(f.ton2, T_VALVE_TRAVEL);
        }
        for (const k in sim.tonSeq) {
            const i = (+k - 10) / 10;
            tonLeft(sim.tonSeq[k], seq[i] ? (seq[i].timeS || 1) : 1);
        }
        for (const f of sim.insts)
            if (moving(sim, f)) {
                const p = sim.plant[f.d.id], r = rateOf(sim, f);
                h = Math.min(h, now + Math.ceil((f.out ? 1 - p : p) / r) * sim.dt);
            }
        /* krok „čekat na vstup": proces dodá stav po DI_DELAY */
        if (sim.seqStep) {
            const s = seq[(sim.seqStep - 10) / 10];
            const run = sim.steps[sim.steps.length - 1];
            if (s && (s.act === "waitOn" || s.act === "waitOff") && run && run.tStart + DI_DELAY >= now - 1e-6)
                h = Math.min(h, run.tStart + DI_DELAY);
        }
        for (const p of active)
            if (p.hzMs !== Infinity)
                h = Math.min(h, p.hzMs / 1000);
        return h;
    };
    /** Posune čas o `n` scanů beze změny stavu: simulátor (t, časovače) — kód počítá ET z času sám. */
    const skip = (sim, n) => {
        const dt = sim.dt, add = n * dt;
        const adv = (t) => { if (t.prev && !t.q)
            t.et += add; };
        for (const f of sim.insts) {
            if (!f.blocked) {
                adv(f.ton);
                adv(f.ton2);
            }
        }
        for (const k in sim.tonSeq)
            adv(sim.tonSeq[k]);
        for (let i = 0; i < n; i++)
            sim.t = sim.t + dt; // stejné sčítání jako scan() (shodné zaokrouhlení času)
        for (const f of sim.insts)
            if (moving(sim, f)) { // poloha pohonu: stejné přičítání jako model stroje ve scan()
                const r = rateOf(sim, f);
                let p = sim.plant[f.d.id];
                for (let i = 0; i < n; i++)
                    p = Math.min(1, Math.max(0, p + (f.out ? r : -r)));
                sim.plant[f.d.id] = p;
            }
        skipped += n;
    };
    /** Řízení scénáře v čase t — zrcadlo smyčky simulate(). */
    const control = (sim, faults, startAt) => {
        const t = sim.t, c = sim.controls;
        const on = (f) => t >= f.at - 1e-9 && !(f.until !== undefined && t >= f.until - 1e-9);
        const pulse = (at) => t >= at - 1e-9 && t < at + 0.3;
        c.start = pulse(startAt) || faults.some(f => f.kind === "start" && pulse(f.at));
        c.ack = faults.some(f => f.kind === "ack" && pulse(f.at));
        c.estop = faults.some(f => f.kind === "estop" && t >= f.at - 1e-9 && !(f.release !== undefined && t >= f.release - 1e-9));
        c.fault = faults.filter(f => f.kind === "fault" && on(f)).map(f => f.dev);
        c.frozen = faults.filter(f => f.kind === "frozen" && on(f)).map(f => f.dev);
        c.modeAuto = !faults.some(f => f.kind === "manual" && on(f));
        if (faults.some(f => f.kind === "man"))
            c.man = Object.fromEntries(faults.filter(f => f.kind === "man" && on(f)).map(f => [f.dev, true]));
        for (const f of faults) {
            if (f.kind === "interlock") {
                const d = devById(prj, f.dev), e = d ? (ioOf(prj, d).in || Object.values(ioOf(prj, d))[0]) : undefined;
                if (e)
                    c.di[e.key] = !on(f);
            }
            else if (f.kind === "analog") {
                const d = devById(prj, f.dev), e = d ? ioOf(prj, d).raw : undefined;
                if (e) {
                    if (on(f))
                        c.force[e.key] = f.raw;
                    else
                        delete c.force[e.key];
                }
            }
            else if (f.kind === "lost") {
                const d = devById(prj, f.dev), io = d ? ioOf(prj, d) : undefined, e = io ? (io.fbkRunning || io.fbkOpen) : undefined;
                if (e) {
                    if (on(f))
                        c.force[e.key] = false;
                    else
                        delete c.force[e.key];
                }
            }
        }
    };
    /** Časy, kdy se mění řízení scénáře (hrany zásahů a pulzů). */
    const edges = (faults, startAt) => {
        const e = [startAt, startAt + 0.3];
        for (const f of faults) {
            e.push(f.at);
            if (f.kind === "start" || f.kind === "ack")
                e.push(f.at + 0.3);
            if ("until" in f && f.until !== undefined)
                e.push(f.until);
            if (f.kind === "estop" && f.release !== undefined)
                e.push(f.release);
        }
        return e.sort((a, b) => a - b);
    };
    /** Doběh scénáře od stavu `sim` / pamětí (vše už nastavené) — vrací rozdíly. */
    const drive = (sim, sc, active, startAt, maxTime, stopAt = Infinity) => {
        const faults = sc.opts.faults || [];
        const ev = edges(faults, startAt);
        let act = [...active];
        const cp = stopAt !== Infinity; // běh ke kontrolnímu bodu: rozdíly hlásí scénář nominal
        let sigA = [], sigB = [], nA = -1;
        let k = 0, firstScan = true;
        const lastAt = faults.reduce((a, f) => Math.max(a, f.at), -Infinity);
        const onDiff = (p, d) => { if (!cp) {
            res[p.plat].diffs.push(d);
            act = act.filter(x => x !== p);
        } };
        for (;;) {
            const t = sim.t, dt = sim.dt;
            if (t > maxTime + 1e-9 || !act.length || t >= stopAt - 1e-9)
                break;
            /* řízení scénáře se mění jen na hranách zásahů — přepočet v okolí hrany (±1 scan) */
            while (k < ev.length && t > ev[k] + dt + 1e-6)
                k++;
            const ctlNow = firstScan || (k < ev.length && t >= ev[k] - dt - 1e-6);
            if (ctlNow) {
                control(sim, faults, startAt);
                firstScan = false;
            }
            step(sim, act, sc, onDiff, ctlNow);
            if (!cp && sim.cycles > 0 && t - sim.tDone >= 1 && sim.seqIndex < 0 && !(lastAt > t))
                break;
            /* přeskočení klidu: kód i návrh beze změny (kromě časovačů a plynulého pohybu) */
            const nB = simSig(sim, sigB);
            let same = nB === nA;
            if (same)
                for (let i = 0; i < nB; i++)
                    if (sigA[i] !== sigB[i]) {
                        same = false;
                        break;
                    }
            const tmp = sigA;
            sigA = sigB;
            sigB = tmp;
            nA = nB;
            if (same && !opts.noSkip && act.length && act.every(codeStill)) {
                let h = Math.min(horizon(sim, act), maxTime, stopAt);
                /* hrana zásahu: řízení se přepočítává ve scanech ±1 kolem hrany — přes ni ani těsně za ní nepřeskakovat */
                for (const x of ev)
                    if (x >= sim.t - dt - 1e-6) {
                        h = Math.min(h, x);
                        break;
                    }
                if (sim.cycles > 0 && !cp)
                    h = Math.min(h, sim.tDone + 1);
                const n = Math.floor((h - sim.t) / dt + 1e-9) - 2;
                if (n >= 2) {
                    if (opts.trace)
                        opts.trace(sc.id + " skip t=" + sim.t.toFixed(3) + " n=" + n + " h=" + h.toFixed(3) + " seq=" + sim.seqStep);
                    skip(sim, n);
                    nA = -1;
                }
            }
        }
    };
    const estimateMax = (sim, o) => {
        const startAt = o.startAt ?? startAt0;
        const est = seq.reduce((a, s) => a + ((s.act === "wait" || s.cond === "time") ? (s.timeS || 1) : Math.max(sim.motorDelay, sim.valveTravel) + 0.5), 0);
        return o.maxTime ?? (startAt + est + T_VALVE_TRAVEL + 5);
    };
    const fresh = () => priv(new Simulator(prj, { dt: base.dt, record: false }));
    /* --- scénáře od začátku a z kontrolních bodů ---------------------------- */
    const first = (o) => { const ts = (o.faults || []).map(f => f.at); return ts.length ? Math.min(...ts) : Infinity; };
    const fromStart = [], fromCp = [];
    for (const sc of scs) {
        const f = first(sc.opts);
        const sameStart = sc.opts.startAt === undefined || sc.opts.startAt === startAt0;
        if (f !== Infinity && sameStart && f > startAt0 + 0.3 + 1e-9)
            fromCp.push(sc);
        else
            fromStart.push(sc);
    }
    const runFrom = (sim, mems, sc) => {
        for (let i = 0; i < progs.length; i++) {
            progs[i].mem.set(mems ? mems[i] : progs[i].prog.init);
            progs[i].still = false;
        }
        const n0 = progs.map(p => res[p.plat].diffs.length);
        drive(sim, sc, progs, sc.opts.startAt ?? startAt0, estimateMax(sim, sc.opts));
        const end = [sim.cycles, sim.firstCycleTime, sim.seqStep, sim.faultStep, sim.machineFault ? 1 : 0, round(sim.t)].join("|");
        progs.forEach((p, i) => res[p.plat].scenarios.push({ id: sc.id, label: sc.label, ok: res[p.plat].diffs.length === n0[i], end }));
    };
    for (const sc of fromStart)
        runFrom(fresh(), null, sc);
    /* kontrolní body: jeden běžný cyklus, zastavení v čase prvního zásahu */
    fromCp.sort((a, b) => first(a.opts) - first(b.opts));
    if (fromCp.length) {
        const nom = fresh();
        for (const p of progs) {
            p.mem.set(p.prog.init);
            p.still = false;
        }
        const nomSc = { id: "nominal-cp", label: tr("Běžný cyklus"), opts: base };
        let i = 0;
        while (i < fromCp.length) {
            const T = first(fromCp[i].opts);
            drive(nom, nomSc, progs, startAt0, Infinity, T);
            const snapMem = progs.map(p => p.mem.slice());
            const cpSim = nom.clone();
            while (i < fromCp.length && Math.abs(first(fromCp[i].opts) - T) < 1e-9) {
                runFrom(priv(cpSim.clone()), snapMem, fromCp[i]);
                i++;
            }
            for (let k = 0; k < progs.length; k++) {
                progs[k].mem.set(snapMem[k]);
                progs[k].still = false;
            }
        }
    }
    /* AO: hodnota z kódu proti žádané hodnotě návrhu (simulátor AO nemodeluje) */
    for (const p of progs) {
        for (const a of p.ao) {
            const got = p.mem[a.slot];
            const tol = a.real ? Math.max(1e-3, Math.abs(a.expect) * 1e-5) : 1.0001;
            if (Math.abs(got - a.expect) > tol)
                res[p.plat].diffs.push({ platform: p.plat, scenario: "ao", label: tr("Analogový výstup"), t: 0, signal: a.name,
                    design: Math.round(a.expect * 1000) / 1000, code: got, msg: tr("{signal}: návrh {design}, kód {code}", { signal: a.name, design: Math.round(a.expect * 1000) / 1000, code: got }) });
        }
    }
    const ms = Date.now() - t0;
    for (const p of progs) {
        const r = res[p.plat];
        r.ms = ms;
        r.scans = scans;
        r.skippedScans = skipped;
        r.lazyScans = lazy;
        r.ok = !r.diffs.length && !p.runtime.some(x => x.level === "error");
    }
    return res;
}
