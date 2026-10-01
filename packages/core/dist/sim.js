/**
 * PLC Studio — simulace procesu a ověření programu.
 *
 * Simulátor provádí scan po scanu STEJNOU logiku, jakou generuje codegen.ts
 * (šablony FB_Motor / FB_Ventil, sekvence CASE, pořadí: enable → sekvence →
 * časovače sekvence → instance zařízení), proti jednoduchému modelu stroje
 * (rozběh motoru, přestavení ventilu). Slouží k ověření NÁVRHU: že cyklus
 * doběhne, jak dlouho trvá a co program udělá při poruše nebo E-stopu.
 *
 * Co neověřuje: kód přeložený v cílovém IDE, HW konfiguraci, bezpečnostní
 * funkce. Nenahrazuje test v simulátoru platformy ani FAT.
 */
import { devById, ioOf } from "./model.js";
/** Timeouty šablon — musí odpovídat T#3S / T#5S v Gen_Library (hlídá test). */
export const T_MOTOR_FBK = 3;
export const T_VALVE_TRAVEL = 5;
const MOTOR_LABEL = { 0: "klid", 10: "rozběh", 20: "běží", 90: "porucha" };
const VALVE_LABEL = { 0: "zavřeno", 10: "otevírá", 20: "otevřeno", 30: "zavírá", 90: "porucha" };
/** Časovač TON volaný jednou za scan. */
class Ton {
    et = 0;
    q = false;
    prev = false;
    call(input, pt, dt) {
        if (!input) {
            this.et = 0;
            this.q = false;
        }
        else {
            this.et = this.prev ? this.et + dt : 0;
            this.q = this.et >= pt - 1e-9;
        }
        this.prev = input;
        return this.q;
    }
}
const round = (t) => Math.round(t * 1000) / 1000;
export function stepTitle(prj, s) {
    if (s.act === "wait")
        return "výdrž " + (s.timeS || 1) + " s";
    const d = devById(prj, s.dev);
    const a = { start: "start", stop: "stop", open: "otevřít", close: "zavřít" }[s.act] || s.act;
    return (d ? d.name : "?") + " " + a;
}
/** Podmínka přechodu kroku tak, jak ji generuje seqBody (text pro diagramy). */
export function stepCondText(prj, s) {
    if (s.act === "wait" || s.cond === "time")
        return "po " + (s.timeS || 1) + " s";
    const d = devById(prj, s.dev);
    if (!d)
        return "ihned";
    const io = ioOf(prj, d);
    if (d.cls === "Motor")
        return io.fbkRunning ? (s.act === "start" ? "" : "NOT ") + io.fbkRunning.tag : "ihned — bez zpětného hlášení";
    if (d.cls === "Ventil") {
        if (s.act === "open" && io.fbkOpen)
            return io.fbkOpen.tag;
        if (s.act === "close" && io.fbkClosed)
            return io.fbkClosed.tag;
        return "ihned — bez koncového snímače";
    }
    return "ihned";
}
export function simulate(prj, options = {}) {
    const dt = options.dt ?? 0.01;
    const motorDelay = options.motorDelay ?? prj.sim?.motorDelay ?? 0.5;
    const valveTravel = options.valveTravel ?? prj.sim?.valveTravel ?? 1.0;
    const startAt = options.startAt ?? 0.2;
    const faults = options.faults ?? [];
    const seq = prj.program.seq;
    const estimate = seq.reduce((a, s) => a + ((s.act === "wait" || s.cond === "time") ? (s.timeS || 1) : Math.max(motorDelay, valveTravel) + 0.5), 0);
    const maxTime = options.maxTime ?? (startAt + estimate + T_VALVE_TRAVEL + 5);
    /* --- vstupy a výstupy -------------------------------------------------- */
    const io = {};
    const estopDev = devById(prj, prj.program.estop);
    const estopIo = estopDev ? (ioOf(prj, estopDev).in || Object.values(ioOf(prj, estopDev))[0]) : undefined;
    for (const e of prj.io) {
        if (e.dir === "AI")
            io[e.key] = 13824; // polovina rozsahu 0..27648
        else if (e.dir === "AO")
            io[e.key] = 0;
        else if (e.dir === "DO")
            io[e.key] = false;
        else
            io[e.key] = !!e.nc; // klidový stav: NC kontakt sepnut = TRUE
    }
    if (estopIo)
        io[estopIo.key] = true; // E-stop uvolněn (TRUE = v pořádku)
    /* --- instance bloků (pořadí jako v Gen_Main) ---------------------------- */
    const inSeq = new Set(seq.filter(s => s.act !== "wait").map(s => s.dev));
    const insts = [];
    for (const d of prj.devices) {
        if (d.cls !== "Motor" && d.cls !== "Ventil")
            continue;
        insts.push({
            d, io: ioOf(prj, d), auto: seq.length > 0 && inSeq.has(d.id),
            step: 0, lastA: false, lastB: false, ton: new Ton(),
            out: false, busy: false, error: false, blocked: false,
        });
    }
    /* model stroje: 0..1 = rozběh motoru / poloha ventilu */
    const plant = {};
    for (const f of insts) {
        plant[f.d.id] = 0;
        if (f.d.cls === "Ventil" && f.io.fbkClosed)
            io[f.io.fbkClosed.key] = true; // v klidu zavřeno
    }
    /* --- proměnné strojního bloku ------------------------------------------ */
    let seqStep = 0; // 0, 10, 20… jako v generovaném kódu
    const seqVar = {}; // seqRun_X / seqOpen_X podle id zařízení
    for (const id of inSeq)
        seqVar[id] = false;
    const tonSeq = {};
    seq.forEach((s, i) => { if (s.act === "wait" || s.cond === "time")
        tonSeq[10 + i * 10] = new Ton(); });
    const modeAuto = true;
    const events = [], frames = [], steps = [];
    const errors = [];
    let started = false, finished = false, cycleStart = 0, cycleTime = null, tDone = 0;
    let lastKey = "";
    const devState = (f) => {
        const labels = f.d.cls === "Motor" ? MOTOR_LABEL : VALVE_LABEL;
        return f.blocked ? { step: -1, label: "blokováno", error: false, busy: false }
            : { step: f.step, label: labels[f.step] || String(f.step), error: f.error, busy: f.busy };
    };
    const ioKeys = prj.io.map(e => e.key);
    const snapshot = (t) => {
        const key = seqStep + "|" + insts.map(f => f.blocked ? -1 : f.step).join(",") + "|" + ioKeys.map(k => +io[k]).join(",");
        if (key === lastKey)
            return;
        lastKey = key;
        const fr = { t: round(t), step: seqStep === 0 ? -1 : (seqStep - 10) / 10, enable: estopIo ? io[estopIo.key] === true : true, dev: {}, io: { ...io } };
        for (const f of insts)
            fr.dev[f.d.id] = devState(f);
        frames.push(fr);
    };
    const active = (f, t) => t >= f.at - 1e-9;
    const frozen = (id, t) => faults.some(f => f.kind === "frozen" && f.dev === id && active(f, t));
    snapshot(0);
    let t = 0;
    for (; t <= maxTime + 1e-9; t += dt) {
        /* --- vnější zásahy podle scénáře ------------------------------------- */
        const cmdAutoStart = t >= startAt - 1e-9 && t < startAt + 0.3;
        for (const f of faults) {
            if (f.kind === "estop" && estopIo) {
                const pressed = active(f, t) && !(f.release !== undefined && t >= f.release - 1e-9);
                if (io[estopIo.key] === pressed) {
                    io[estopIo.key] = !pressed;
                    events.push({ t: round(t), kind: pressed ? "err" : "info", msg: pressed ? "Stisk nouzového zastavení" : "Nouzové zastavení uvolněno" });
                }
            }
            else if (f.kind === "fault") {
                const fb = insts.find(x => x.d.id === f.dev);
                if (fb && fb.io.fault && active(f, t) && io[fb.io.fault.key] !== true) {
                    io[fb.io.fault.key] = true;
                    events.push({ t: round(t), kind: "err", dev: f.dev, msg: fb.d.name + ": vstup poruchy aktivní" });
                }
            }
        }
        /* --- scan programu: enable → sekvence → časovače → instance ---------- */
        const enable = estopIo ? io[estopIo.key] === true : true;
        const before = seqStep;
        if (seq.length) {
            if (!modeAuto || !enable) {
                seqStep = 0;
                for (const id of inSeq)
                    seqVar[id] = false;
            }
            if (seqStep === 0) {
                if (modeAuto && cmdAutoStart)
                    seqStep = 10;
            }
            else {
                const i = (seqStep - 10) / 10, s = seq[i];
                const next = i === seq.length - 1 ? 0 : seqStep + 10;
                const d = devById(prj, s.dev);
                let cond = true;
                if (s.act === "wait")
                    cond = tonSeq[seqStep].q;
                else if (d && d.cls === "Motor") {
                    seqVar[d.id] = s.act === "start";
                    const e = ioOf(prj, d).fbkRunning;
                    if (s.cond === "time")
                        cond = tonSeq[seqStep].q;
                    else if (e)
                        cond = s.act === "start" ? io[e.key] === true : io[e.key] !== true;
                }
                else if (d && d.cls === "Ventil") {
                    seqVar[d.id] = s.act === "open";
                    const dio = ioOf(prj, d);
                    if (s.cond === "time")
                        cond = tonSeq[seqStep].q;
                    else if (s.act === "open" && dio.fbkOpen)
                        cond = io[dio.fbkOpen.key] === true;
                    else if (s.act === "close" && dio.fbkClosed)
                        cond = io[dio.fbkClosed.key] === true;
                }
                if (cond)
                    seqStep = next;
            }
            for (const n of Object.keys(tonSeq))
                tonSeq[+n].call(seqStep === +n, seq[(+n - 10) / 10].timeS || 1, dt);
        }
        if (seqStep !== before) {
            const open = steps[steps.length - 1];
            if (open && open.tEnd === null)
                open.tEnd = round(t);
            if (seqStep === 0) {
                if (started && !finished && enable) {
                    finished = true;
                    cycleTime = round(t - cycleStart);
                    tDone = t;
                    events.push({ t: round(t), kind: "seq", msg: "Cyklus dokončen — návrat do klidu (" + cycleTime + " s)" });
                }
                else
                    events.push({ t: round(t), kind: "err", msg: "Sekvence přerušena — návrat do kroku 0" });
            }
            else {
                const i = (seqStep - 10) / 10;
                if (!started) {
                    started = true;
                    cycleStart = t;
                }
                steps.push({ i, tStart: round(t), tEnd: null });
                events.push({ t: round(t), kind: "seq", step: i, dev: seq[i].dev || undefined, msg: "Krok " + (i + 1) + ": " + stepTitle(prj, seq[i]) });
            }
        }
        for (const f of insts) {
            const was = f.blocked ? -1 : f.step;
            if (!enable) {
                f.out = false;
                f.busy = false;
                f.error = false;
                f.step = 0;
                f.blocked = true;
            }
            else {
                f.blocked = false;
                const v = f.auto ? seqVar[f.d.id] : false;
                const cmdA = f.auto ? v : false, cmdB = f.auto ? !v : false;
                const trigA = cmdA && !f.lastA;
                f.lastA = cmdA;
                const trigB = cmdB && !f.lastB;
                f.lastB = cmdB;
                if (f.d.cls === "Motor") {
                    const fbk = f.io.fbkRunning ? io[f.io.fbkRunning.key] === true : true;
                    const fault = f.io.fault ? io[f.io.fault.key] === true : false;
                    if (f.step === 0) {
                        f.out = false;
                        if (trigA)
                            f.step = 10;
                    }
                    else if (f.step === 10) {
                        f.out = true;
                        if (fbk)
                            f.step = 20;
                    }
                    else if (f.step === 20) {
                        f.out = true;
                        if (!fbk)
                            f.step = 90;
                        if (trigB)
                            f.step = 0;
                    }
                    else if (f.step === 90) {
                        f.out = false;
                        if (trigB && !fault)
                            f.step = 0;
                    }
                    if (f.ton.call(f.step === 10, T_MOTOR_FBK, dt) || fault)
                        f.step = 90;
                    f.busy = f.step === 10;
                }
                else {
                    const fbkOpen = f.io.fbkOpen ? io[f.io.fbkOpen.key] === true : true;
                    const fbkClosed = f.io.fbkClosed ? io[f.io.fbkClosed.key] === true : true;
                    if (f.step === 0) {
                        f.out = false;
                        if (trigA)
                            f.step = 10;
                    }
                    else if (f.step === 10) {
                        f.out = true;
                        if (fbkOpen)
                            f.step = 20;
                    }
                    else if (f.step === 20) {
                        f.out = true;
                        if (trigB)
                            f.step = 30;
                    }
                    else if (f.step === 30) {
                        f.out = false;
                        if (fbkClosed)
                            f.step = 0;
                    }
                    else if (f.step === 90) {
                        f.out = false;
                        if (trigB)
                            f.step = 0;
                    }
                    if (f.ton.call(f.step === 10 || f.step === 30, T_VALVE_TRAVEL, dt))
                        f.step = 90;
                    f.busy = f.step === 10 || f.step === 30;
                }
                f.error = f.step === 90;
            }
            const outIo = f.d.cls === "Motor" ? f.io.outRun : f.io.outOpen;
            if (outIo)
                io[outIo.key] = f.out;
            const now = f.blocked ? -1 : f.step;
            if (now !== was) {
                const st = devState(f);
                if (st.error) {
                    errors.push({ dev: f.d.id, t: round(t) });
                    events.push({ t: round(t), kind: "err", dev: f.d.id, msg: f.d.name + ": PORUCHA bloku (status 16#8002)" });
                }
                else
                    events.push({ t: round(t), kind: "dev", dev: f.d.id, msg: f.d.name + ": " + st.label });
            }
        }
        snapshot(t);
        /* --- model stroje: reakce na výstupy do dalšího scanu ---------------- */
        for (const f of insts) {
            if (frozen(f.d.id, t))
                continue;
            const rate = dt / Math.max(f.d.cls === "Motor" ? motorDelay : valveTravel, dt);
            const p = plant[f.d.id] = Math.min(1, Math.max(0, plant[f.d.id] + (f.out ? rate : -rate)));
            if (f.d.cls === "Motor") {
                const e = f.io.fbkRunning;
                if (e) {
                    if (p >= 1 - 1e-9)
                        io[e.key] = true;
                    else if (p <= 1e-9)
                        io[e.key] = false;
                }
            }
            else {
                if (f.io.fbkOpen)
                    io[f.io.fbkOpen.key] = p >= 1 - 1e-9;
                if (f.io.fbkClosed)
                    io[f.io.fbkClosed.key] = p <= 1e-9;
            }
        }
        if (finished && t - tDone >= 1)
            break; // po dokončení ještě 1 s na doběh
    }
    const tEnd = round(Math.min(t, maxTime));
    snapshot(tEnd);
    const stalled = seq.length > 0 && started && !finished && seqStep !== 0;
    return {
        ok: finished && errors.length === 0,
        finished, cycleTime,
        stalledStep: stalled ? (seqStep - 10) / 10 : null,
        steps, events, frames, errors,
        outputsOn: prj.io.filter(e => e.dir === "DO" && io[e.key] === true).map(e => e.key),
        tEnd,
        opts: { dt, motorDelay, valveTravel, startAt, maxTime, faults },
    };
}
/** Sada scénářů k ověření: běžný cyklus + poruchy v jednotlivých krocích + E-stop. */
export function simScenarios(prj, base = {}) {
    const out = [{ id: "nominal", label: "Běžný cyklus", purpose: "cyklus bez poruch", opts: { ...base } }];
    const seq = prj.program.seq;
    if (!seq.length)
        return out;
    const nominal = simulate(prj, base);
    const tail = T_VALVE_TRAVEL + 3;
    for (const run of nominal.steps) {
        const s = seq[run.i], d = devById(prj, s.dev);
        if (!d || s.act === "wait")
            continue;
        const io = ioOf(prj, d);
        const hasFbk = d.cls === "Motor" ? !!io.fbkRunning : (s.act === "open" ? !!io.fbkOpen : !!io.fbkClosed);
        if (!hasFbk)
            continue;
        out.push({
            id: "frozen-" + run.i, step: run.i, dev: d.id,
            label: "Krok " + (run.i + 1) + ": " + d.name + " bez zpětného hlášení",
            purpose: "výpadek zpětného hlášení " + d.name + " při akci „" + stepTitle(prj, s) + "“",
            opts: { ...base, faults: [{ kind: "frozen", dev: d.id, at: run.tStart }], maxTime: run.tStart + tail + (s.cond === "time" ? (s.timeS || 1) : 0) },
        });
    }
    const seen = new Set();
    for (const run of nominal.steps) {
        const s = seq[run.i], d = devById(prj, s.dev);
        if (!d || d.cls !== "Motor" || s.act !== "start" || seen.has(d.id) || !ioOf(prj, d).fault)
            continue;
        seen.add(d.id);
        const at = round((run.tEnd ?? run.tStart) + 0.5);
        out.push({
            id: "fault-" + d.id, step: run.i, dev: d.id,
            label: "Porucha motoru " + d.name + " za chodu",
            purpose: "aktivace vstupu poruchy " + d.name + " za chodu",
            opts: { ...base, faults: [{ kind: "fault", dev: d.id, at }], maxTime: Math.max(nominal.tEnd, at + 3) },
        });
    }
    if (devById(prj, prj.program.estop) && nominal.cycleTime) {
        const at = Math.round(((base.startAt ?? 0.2) + nominal.cycleTime / 2) * 10) / 10;
        out.push({
            id: "estop", label: "Nouzové zastavení v polovině cyklu",
            purpose: "stisk E-stopu v čase " + at + " s, uvolnění po 2 s",
            opts: { ...base, faults: [{ kind: "estop", at, release: at + 2 }], maxTime: at + 6 },
        });
    }
    return out;
}
export function verifyProject(prj, base = {}) {
    const checks = [];
    const seq = prj.program.seq;
    const tagOf = (key) => (prj.io.find(e => e.key === key) || { tag: key }).tag;
    const scenarios = simScenarios(prj, base);
    const estop = devById(prj, prj.program.estop);
    if (!estop) {
        checks.push({ level: "warn", title: "Není zvoleno centrální uvolnění (E-stop)", detail: "Signál enable je trvale TRUE — program stroj na žádný vstup nezastaví. Zvol vstup v kroku Program." });
    }
    else {
        const e = ioOf(prj, estop).in || Object.values(ioOf(prj, estop))[0];
        if (e && !e.nc)
            checks.push({ level: "warn", dev: estop.id, title: "E-stop " + estop.name + " není označen jako NC", detail: "Program čeká TRUE = v pořádku (rozpínací kontakt). U spínacího kontaktu by přerušený vodič stroj nezastavil — označ vstup jako NC v kroku I/O." });
    }
    if (!seq.length) {
        checks.push({ level: "info", title: "Projekt nemá automatickou sekvenci", detail: "Není co simulovat — bloky zařízení čekají na ruční povely (TODO v generovaném kódu)." });
        return { ok: true, checks, scenarios, nominal: null };
    }
    for (const [i, s] of seq.entries()) {
        const d = devById(prj, s.dev);
        if (s.act === "wait")
            continue;
        if (!d) {
            checks.push({ level: "error", step: i, title: "Krok " + (i + 1) + " odkazuje na neexistující zařízení", detail: "Krok se v programu přeskočí (podmínka TRUE). Oprav sekvenci v kroku Program." });
            continue;
        }
        if (s.cond === "fbk" && /^ihned/.test(stepCondText(prj, s))) {
            checks.push({ level: "warn", step: i, dev: d.id, title: "Krok " + (i + 1) + " (" + stepTitle(prj, s) + ") se nepotvrzuje", detail: "Přechod je nastaven na zpětné hlášení, ale " + d.name + " ho pro tuto akci nemá — krok přejde okamžitě, aniž se akce provedla. Doplň snímač, nebo přechod časem." });
        }
    }
    /* 1) běžný cyklus */
    const nominal = simulate(prj, base);
    if (nominal.ok) {
        checks.push({ level: "ok", scenario: "nominal", title: "Běžný cyklus doběhne do konce", detail: "Všech " + seq.length + " kroků proběhlo, doba cyklu " + nominal.cycleTime + " s (model: rozběh motoru " + nominal.opts.motorDelay + " s, přestavení ventilu " + nominal.opts.valveTravel + " s)." });
    }
    else if (nominal.stalledStep !== null) {
        const s = seq[nominal.stalledStep];
        checks.push({ level: "error", scenario: "nominal", step: nominal.stalledStep, dev: s.dev || undefined, title: "Běžný cyklus se zastaví v kroku " + (nominal.stalledStep + 1) + " (" + stepTitle(prj, s) + ")", detail: "Podmínka přechodu „" + stepCondText(prj, s) + "“ se nesplní" + (nominal.errors.length ? "; v poruše: " + nominal.errors.map(e => devById(prj, e.dev)?.name).join(", ") : "") + "." });
    }
    else {
        checks.push({ level: "error", scenario: "nominal", title: "Běžný cyklus nedoběhne bez poruchy", detail: nominal.errors.length ? "V poruše skončí: " + [...new Set(nominal.errors.map(e => devById(prj, e.dev)?.name))].join(", ") + "." : "Sekvence se nespustila." });
    }
    if (nominal.finished && nominal.outputsOn.length) {
        checks.push({ level: "warn", scenario: "nominal", title: "Po skončení cyklu zůstávají sepnuté výstupy", detail: nominal.outputsOn.map(tagOf).join(", ") + " — sekvence je nevypíná. Pokud to není záměr, doplň kroky stop/zavřít." });
    }
    /* 2) poruchy a E-stop */
    for (const sc of scenarios) {
        if (sc.id === "nominal")
            continue;
        const r = simulate(prj, sc.opts);
        const d = devById(prj, sc.dev ?? 0);
        const onTags = r.outputsOn.map(tagOf);
        if (sc.id === "estop") {
            const f = sc.opts.faults[0];
            const after = r.frames.filter(fr => fr.t > f.at + 2 * r.opts.dt);
            const live = prj.io.filter(e => e.dir === "DO" && after.some(fr => fr.io[e.key] === true)).map(e => e.tag);
            const restarted = after.some(fr => fr.step >= 0);
            if (!live.length && !restarted)
                checks.push({ level: "ok", scenario: sc.id, title: "Nouzové zastavení vypne výstupy a cyklus se sám neobnoví", detail: "Po stisku v čase " + f.at + " s jsou všechny výstupy bloků FALSE do jednoho scanu, sekvence je v kroku 0 a po uvolnění čeká na nový start. Pozor: skutečnou bezpečnost zajišťuje safety technika, ne program." });
            else
                checks.push({ level: "error", scenario: sc.id, title: "Nouzové zastavení stroj spolehlivě nezastaví", detail: (live.length ? "Po stisku zůstávají sepnuté: " + live.join(", ") + ". " : "") + (restarted ? "Sekvence se po uvolnění sama znovu rozběhla." : "") });
            continue;
        }
        if (!d)
            continue;
        const errAt = r.errors.find(e => e.dev === d.id);
        const stallTxt = r.stalledStep !== null ? "sekvence zůstane stát v kroku " + (r.stalledStep + 1) : (r.finished ? "sekvence přesto doběhne do konce" : "sekvence pokračuje dál");
        const onTxt = onTags.length ? " Sepnuté zůstávají: " + onTags.join(", ") + "." : " Všechny výstupy jsou vypnuté.";
        const others = onTags.length > 0;
        if (sc.id.startsWith("fault-")) {
            if (errAt && r.frames[r.frames.length - 1].io[(ioOf(prj, d).outRun || { key: "" }).key] !== true) {
                checks.push({ level: (r.finished || others) ? "warn" : "ok", scenario: sc.id, dev: d.id, step: sc.step, title: "Porucha motoru " + d.name + ": blok motor vypne", detail: "Blok přejde do poruchy a výstup vypne; " + stallTxt + "." + onTxt + ((r.finished || others) ? " Sekvence poruchu bloku nevyhodnocuje — zvaž doplnění reakce (zastavit cyklus, vypnout ostatní pohony)." : "") });
            }
            else
                checks.push({ level: "error", scenario: sc.id, dev: d.id, step: sc.step, title: "Porucha motoru " + d.name + " se neprojeví", detail: "Blok po aktivaci vstupu poruchy nepřešel do poruchy." });
            continue;
        }
        const s = seq[sc.step];
        if (errAt) {
            checks.push({
                level: (r.finished || others) ? "warn" : "ok", scenario: sc.id, dev: d.id, step: sc.step,
                title: "Krok " + (sc.step + 1) + ": výpadek hlášení " + d.name + " → porucha bloku po " + Math.round((errAt.t - sc.opts.faults[0].at) * 10) / 10 + " s",
                detail: "Timeout bloku zabere, " + stallTxt + "." + onTxt + ((r.finished || others) ? " Sekvence na poruchu bloku nereaguje (nevyhodnocuje error) — zvaž doplnění reakce: zastavit cyklus a vypnout ostatní pohony." : ""),
            });
        }
        else {
            checks.push({
                level: "warn", scenario: sc.id, dev: d.id, step: sc.step,
                title: "Krok " + (sc.step + 1) + " (" + stepTitle(prj, s) + "): výpadek hlášení " + d.name + " nevyvolá poruchu",
                detail: "Žádný blok nepřejde do poruchy, " + stallTxt + " bez hlášení obsluze." + onTxt + " Akce „" + s.act + "“ nemá v bloku hlídání času — doplň timeout kroku sekvence.",
            });
        }
    }
    return { ok: !checks.some(c => c.level === "error"), checks, scenarios, nominal };
}
/** Protokol o ověření simulací (Markdown do dokumentace projektu). */
export function docVerifyMd(prj) {
    const v = verifyProject(prj);
    const seq = prj.program.seq;
    const icon = { ok: "✔", info: "ℹ", warn: "⚠", error: "✖" };
    const n = (lvl) => v.checks.filter(c => c.level === lvl).length;
    let s = "# Ověření programu simulací procesu\n\n**Projekt:** " + (prj.meta.name || "—") + " · generováno nástrojem PLC Studio\n\n";
    s += "**Výsledek:** " + (v.ok ? "bez chyb" : "NALEZENY CHYBY") + " — " + n("ok") + " v pořádku, " + n("warn") + " upozornění, " + n("error") + " chyb\n\n";
    s += "## 1. Co simulace ověřuje\nSimulátor provádí scan po scanu logiku generovaných bloků (stavové automaty FB_Motor a FB_Ventil, timeouty " + T_MOTOR_FBK + " s a " + T_VALVE_TRAVEL + " s, sekvence CASE) proti modelu stroje.\n";
    if (v.nominal)
        s += "Model stroje: zpětné hlášení motoru přijde " + v.nominal.opts.motorDelay + " s po sepnutí, ventil / válec se přestaví za " + v.nominal.opts.valveTravel + " s, scan " + v.nominal.opts.dt * 1000 + " ms.\n";
    s += "\n**Neověřuje** kód přeložený v cílovém IDE, HW konfiguraci, komunikaci ani bezpečnostní funkce. Nenahrazuje test v simulátoru platformy (PLCSIM, Logix Echo…) ani FAT.\n\n";
    if (v.nominal && seq.length) {
        s += "## 2. Běžný cyklus\n| Krok | Akce | Přechod | Začátek [s] | Trvání [s] |\n|---|---|---|---|---|\n";
        for (const [i, st] of seq.entries()) {
            const run = v.nominal.steps.find(r => r.i === i);
            s += "| " + (i + 1) + " | " + stepTitle(prj, st) + " | " + stepCondText(prj, st) + " | " + (run ? run.tStart : "—") + " | " + (run && run.tEnd !== null ? round(run.tEnd - run.tStart) : "nedokončen") + " |\n";
        }
        s += "\nDoba cyklu: " + (v.nominal.cycleTime !== null ? v.nominal.cycleTime + " s" : "cyklus nedoběhl") + "\n\n";
    }
    s += "## " + (v.nominal && seq.length ? "3" : "2") + ". Nálezy\n";
    for (const c of v.checks)
        s += "- " + icon[c.level] + " **" + c.title + "** — " + c.detail + "\n";
    s += "\nUpozornění nejsou chyby generátoru, ale místa, kde návrh spoléhá na doplnění ručně (reakce na poruchy, ruční režim, kvitace).";
    return s;
}
