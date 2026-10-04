/**
 * PLCdesk — mezivrstva generátoru (IR): popis programu stroje nezávislý na platformě.
 *
 * `buildIR(prj)` převede návrh na program: řízení stroje, uvolnění, sekvenci, instance bloků
 * s napojením na I/O, výstupy s rolí, volné signály a zachycení poruchy. Renderery platforem
 * z IR jen PÍŠÍ text (codegen.ts: Siemens SCL, IEC ST pro CODESYS / TwinCAT / Schneider /
 * GX Works3 / Sysmac, plochý ST Unitronics; logix.ts: Logix ST pro L5X). PLCopen XML se dál
 * staví z finálního textu MAIN (plcopen.ts). Simulátor (sim.ts) IR nečte — sdílí s ním
 * `seqCond`, `enableInputs`, `limitedAnalogs` a zrcadlí `roleExpr` / šablony bloků.
 *
 * Co v IR je (sémantika) a co ne (zápis):
 *  - IR: kdo je instance jaké třídy, co je zapojeno na který vstup / výstup (výraz), meze,
 *    žádané hodnoty, kroky sekvence (operace, povel, podmínka přechodu ze `seqCond`,
 *    hlídací čas, časovač), proměnné řízení (`IR_CTRL`), pořadí vyhodnocení (`IR_EVAL_ORDER`).
 *  - Renderer: syntaxe (`#x`, `"tag"`, `GVL_IO.tag`), komentáře a jejich překlad (`trx`),
 *    rozložení volání na řádky, věci platformy (rawMax, meze FX5 bez počátečních hodnot,
 *    TONR v Logixu, plochá logika Unitronics, `resetIn` v Sysmacu).
 *  - Logika bloků NENÍ v IR: blok nese jen třídu (`cls`, jméno FB z `IR_CLASSES`); text bloku
 *    bere renderer ze šablony třídy `fbTemplate(cls, "st" | "scl")` (codegen.ts: `ST_MOTOR`,
 *    `SCL_MOTOR`…, dál `parseFbTemplate` / `inlineFb` / AOI). Typy portů se berou ze šablony.
 *    Komentáře v IR jsou české klíče překladu (`N_`), překládá až renderer (`trx`).
 *
 * Pořadí vyhodnocení (= generovaný program = simulátor `scan()`):
 *   enable → sekvence (CASE) → časovače kroků → instance bloků (+ role DO) → porucha stroje.
 *
 * Příprava pro fázi 2b / 2c (zatím bez implementace):
 *  - Nové třídy bloků (`Vfd` frekvenční měnič, `PosDrive` polohovací pohon, `PropValve`
 *    proporcionální ventil, `Axis` servoosa): rozšířit `IrFbClass`, `IR_CLASSES` (jméno FB)
 *    a šablony v `fbTemplate` (ST + SCL), v `fbItem` přidat větev s porty (povely jako výrazy,
 *    zpětná hlášení jako I/O, parametry jako `real`); `stCall` bez zvláštního rozložení použije
 *    obecné (port na řádek), Logix (`lxCallIr`) a Unitronics (`inlineFb`) berou porty obecně.
 *    Simulátor a ověření je potřeba doplnit zvlášť (zrcadlo šablony), stejně tak HMI a AOI typy.
 *  - Nové akce kroků (`run`/`stop` pro Vfd s rychlostí, `home`, `posRecord`, `moveAbs`,
 *    `setPressure`, `waitInPos`): rozšířit `IrStepOp`; krok nese povel jako `set`
 *    (proměnná sekvence + hodnota; pro analogové povely přibude `value: IrExpr`) a podmínku
 *    přechodu z `seqCond` (nové druhy zpětného hlášení — „v poloze", „dojeto na referenci").
 *  - Druhý (OOP) renderer téhož IR: třídy / metody (TIA V20 SCL s třídami, CODESYS
 *    `METHOD` / `PROPERTY`, TwinCAT OOP). IR je pro něj připravené: instance s typovanými
 *    porty, povely jako výrazy, kroky jako operace — renderer přidá jen jiný zápis
 *    (`instM1.Start()` místo `cmdStart := …`). Výchozí renderer zůstává klasický FB.
 *  - Vlastní šablony z firemní knihovny (`libraryOverrides(prj, plat)` v library.ts): mají
 *    stejné rozhraní jako vestavěné, IR se tedy nemění — jediné místo výběru textu bloku je
 *    `fbTemplate()` (Gen_Library, AOI v L5X, `inlineFb` u Unitronics); dostane projekt
 *    a platformu a vezme přednostně šablonu z knihovny. Typy portů v IR zůstávají z vestavěné
 *    šablony (rozhraní je validací knihovny hlídané jako shodné).
 *
 * Změna výstupu generátoru jen vědomě: referenční test `golden.test.ts`
 * (přegenerování `node scripts/golden.mjs --write`, zdůvodnění v commitu).
 */
import { devById, ioOf, instName, enableInputs, interlockDevs, isDiWait, } from "./model.js";
import { N_ } from "./i18n.js";
/* ir.ts a codegen.ts se importují navzájem: šablony se tu berou až uvnitř funkcí */
import { fbTemplate, parseFbTemplate } from "./codegen.js";
export const irBool = (v) => ({ k: "bool", v });
export const irInt = (v) => ({ k: "int", v });
export const irReal = (v) => ({ k: "real", v: Number(v) });
export const irVar = (name) => ({ k: "var", name });
export const irIo = (tag) => ({ k: "io", tag });
export const irMember = (inst, port) => ({ k: "member", inst, port });
export const irNot = (e) => ({ k: "not", e });
export const irAnd = (...args) => ({ k: "and", args });
export const irOr = (...args) => ({ k: "or", args });
export const irEq = (a, b) => ({ k: "cmp", op: "=", a, b });
export const irNe = (a, b) => ({ k: "cmp", op: "<>", a, b });
export const irParen = (e) => ({ k: "paren", e });
/** Zápis výrazu v IEC ST (TRUE/FALSE, AND/OR/NOT, `=`, `<>`); dialekty upravuje renderer. */
export function irText(e, n) {
    switch (e.k) {
        case "bool": return e.v ? "TRUE" : "FALSE";
        case "int": return String(e.v);
        case "real": return n.real(e.v);
        case "var": return n.L(e.name);
        case "io": return n.R(e.tag);
        case "member": return n.M ? n.M(e.inst, e.port) : n.L(e.inst) + "." + e.port;
        case "not": return "NOT " + irText(e.e, n);
        case "and": return e.args.map(a => irText(a, n)).join(" AND ");
        case "or": return e.args.map(a => irText(a, n)).join(" OR ");
        case "cmp": return irText(e.a, n) + " " + e.op + " " + irText(e.b, n);
        case "paren": return "(" + irText(e.e, n) + ")";
    }
}
/* ======================================================= řízení stroje */
/** Proměnné řízení stroje (jména jsou rozhraním k HMI — neměnit). */
export const IR_CTRL = {
    enable: "enable", modeAuto: "modeAuto", cmdAutoStart: "cmdAutoStart", cmdAck: "cmdAck",
    machineFault: "machineFault", faultStep: "faultStep", seqStep: "seqStep",
};
/** Pořadí vyhodnocení v jednom scanu (generátor = simulátor). */
export const IR_EVAL_ORDER = ["enable", "seq", "seqTimers", "blocks", "fault"];
/* fáze 2b: | "Vfd" | "PosDrive" | "PropValve" | "Axis" */
/** Třídy bloků: jméno FB; zdroj logiky = šablona třídy (`fbTemplate(cls, dialekt)` v codegen.ts). */
export const IR_CLASSES = {
    Motor: { fb: "FB_Motor" },
    Ventil: { fb: "FB_Ventil" },
    AnalogIn: { fb: "FB_AnalogIn" },
    AnalogOut: { fb: "FB_AnalogOut" },
};
/** Typy portů bloku z vestavěné šablony IEC ST (vstupy, výstupy). */
export function irPortTypes(cls) {
    const out = {};
    for (const v of parseFbTemplate(fbTemplate(cls, "st")).vars)
        if (v.kind !== "var")
            out[v.name] = v.type;
    return out;
}
/* ================================================ pomocné (sdílí i sim.ts) */
/** Analogové vstupy s mezemi — jejich alarm je součástí poruchy stroje. */
export function limitedAnalogs(prj) {
    return prj.devices.filter(d => d.cls === "AnalogIn" && (Number.isFinite(d.limHi) || Number.isFinite(d.limLo)));
}
/** Digitální vstupy, na které čeká sekvence. */
export function waitedDis(prj) {
    return new Set(prj.program.seq.filter(isDiWait).map(s => s.dev));
}
/** Zařízení s funkčním blokem a povelem (motory, ventily). */
export function actuators(prj) {
    return prj.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil");
}
/** Proměnná povelu ze sekvence / ručního povelu z HMI pro dané zařízení. */
export function seqVarOf(d) { return (d.cls === "Motor" ? "seqRun_" : "seqOpen_") + d.name; }
export function manVarOf(d) { return (d.cls === "Motor" ? "manRun_" : "manOpen_") + d.name; }
export function seqVars(prj) {
    const vars = new Set();
    for (const s of prj.program.seq) {
        const d = devById(prj, s.dev);
        if (d && (d.cls === "Motor" || d.cls === "Ventil"))
            vars.add(seqVarOf(d));
    }
    return [...vars];
}
export function seqCond(prj, s) {
    if (s.act === "wait" || (s.cond === "time" && !isDiWait(s)))
        return { kind: "time" };
    const d = devById(prj, s.dev);
    if (!d)
        return { kind: "none" };
    const io = ioOf(prj, d);
    if (isDiWait(s)) { // čekání na snímač / tlačítko (hlídací čas = timeS)
        const e = d.cls === "DI" ? (io.in || Object.values(io)[0]) : undefined;
        return e ? { kind: "fbk", io: e, neg: s.act === "waitOff" } : { kind: "none" };
    }
    if (d.cls === "Motor")
        return io.fbkRunning ? { kind: "fbk", io: io.fbkRunning, neg: s.act !== "start" } : { kind: "none" };
    if (d.cls === "Ventil") {
        if (s.act === "open" && io.fbkOpen)
            return { kind: "fbk", io: io.fbkOpen };
        if (s.act === "close" && io.fbkClosed)
            return { kind: "fbk", io: io.fbkClosed };
    }
    return { kind: "none" };
}
/** Kroky s časovačem: výdrž / přechod časem, nebo hlídání kroku se zpětným hlášením. */
export function seqTimedSteps(prj) {
    const list = [];
    prj.program.seq.forEach((s, i) => { if (seqCond(prj, s).kind !== "none")
        list.push(10 + i * 10); });
    return list;
}
/**
 * Výraz role výstupu — totéž jako `roleExpr` (model.ts, text pro import a starší volání);
 * shodu zápisu hlídá test. Zrcadlo v simulátoru: `roleValue` (sim.ts).
 */
export function roleIr(role, hasSeq) {
    const C = IR_CTRL;
    const running = hasSeq ? irNe(irVar(C.seqStep), irInt(0)) : irBool(false);
    switch (role) {
        case "run": return running;
        case "fault": return irVar(C.machineFault);
        case "ready": return hasSeq
            ? irAnd(irVar(C.enable), irNot(irVar(C.machineFault)), irVar(C.modeAuto), irEq(irVar(C.seqStep), irInt(0)))
            : irAnd(irVar(C.enable), irNot(irVar(C.machineFault)));
        case "stopped": return irNot(irVar(C.enable));
        case "lock": return running;
        case "auto": return hasSeq ? irVar(C.modeAuto) : irBool(false);
    }
}
/* ============================================================ sestavení */
/** Povel zapnout / otevřít: sekvence NEBO ruční povel (ruční jen mimo AUTO; bez sekvence vždy). */
export function cmdIr(prj, d) {
    if (!prj.program.seq.length)
        return irVar(manVarOf(d));
    const man = irParen(irAnd(irVar(manVarOf(d)), irNot(irVar(IR_CTRL.modeAuto))));
    return seqVars(prj).includes(seqVarOf(d)) ? irOr(irVar(seqVarOf(d)), man) : man;
}
function fbItem(prj, d) {
    if (d.cls !== "Motor" && d.cls !== "Ventil" && d.cls !== "AnalogIn" && d.cls !== "AnalogOut")
        return null;
    const cls = d.cls;
    const T = irPortTypes(cls);
    const io = ioOf(prj, d);
    const C = IR_CTRL;
    const port = (name, expr, src) => ({ name, type: T[name], expr, src });
    const sig = (name, e, dflt) => e ? port(name, irIo(e.tag), "io") : port(name, dflt, "default");
    const out = (name, e) => e ? { name, type: T[name], tag: e.tag } : { name, type: T[name] };
    const base = { kind: "fb", dev: d, cls, fb: IR_CLASSES[cls].fb, inst: instName(d) };
    if (cls === "Motor" || cls === "Ventil") {
        const cmd = cmdIr(prj, d);
        const [on, off] = cls === "Motor" ? ["cmdStart", "cmdStop"] : ["cmdOpen", "cmdClose"];
        const inputs = [port("enable", irVar(C.enable), "ctrl"), port(on, cmd, "ctrl"), port(off, irNot(irParen(cmd)), "ctrl"), port("reset", irVar(C.cmdAck), "ctrl")];
        if (cls === "Motor") {
            inputs.push(sig("fbkRunning", io.fbkRunning, irBool(true)), sig("fault", io.fault, irBool(false)));
            return { ...base, cmd, inputs, outputs: [out("outRun", io.outRun)] };
        }
        inputs.push(sig("fbkOpen", io.fbkOpen, irBool(true)), sig("fbkClosed", io.fbkClosed, irBool(true)));
        return { ...base, cmd, inputs, outputs: [out("outOpen", io.outOpen)] };
    }
    if (cls === "AnalogIn") {
        const inputs = [sig("rawValue", io.raw, irInt(0)), port("scaleMin", irReal(d.rmin), "param"), port("scaleMax", irReal(d.rmax), "param")];
        const limits = {};
        if (Number.isFinite(d.limHi)) {
            limits.hi = d.limHi;
            inputs.push(port("limitHi", irReal(d.limHi), "param"));
        }
        if (Number.isFinite(d.limLo)) {
            limits.lo = d.limLo;
            inputs.push(port("limitLo", irReal(d.limLo), "param"));
        }
        return { ...base, inputs, outputs: [], limits };
    }
    const sp = Number.isFinite(d.setpoint);
    return {
        ...base, ...(sp ? { setpoint: d.setpoint } : {}),
        inputs: [sp ? port("value", irReal(d.setpoint), "param") : port("value", irReal(0), "default"), port("scaleMin", irReal(d.rmin), "param"), port("scaleMax", irReal(d.rmax), "param")],
        outputs: [out("rawValue", io.raw)],
    };
}
/** Zařazení zařízení bez ohledu na uvolnění (blok, role, čtený vstup, volný signál). */
function deviceItem(prj, d, waited, hasSeq) {
    const fb = fbItem(prj, d);
    if (fb)
        return fb;
    if (d.cls === "DO" && d.role)
        return { kind: "role", dev: d, role: d.role, outs: Object.values(ioOf(prj, d)), expr: roleIr(d.role, hasSeq) };
    if (d.cls === "DI" && waited.has(d.id))
        return { kind: "seqInput", dev: d };
    return { kind: "free", dev: d, io: Object.values(ioOf(prj, d)) };
}
/** Program stroje z návrhu (viz hlavička souboru). */
export function buildIR(prj) {
    const C = IR_CTRL;
    const steps = prj.program.seq, hasSeq = steps.length > 0;
    const acts = actuators(prj), analogs = limitedAnalogs(prj);
    const svars = seqVars(prj);
    /* deklarace řízení stroje */
    const decls = [];
    if (hasSeq) {
        decls.push({ name: C.modeAuto, type: "BOOL", group: "ctrl", todo: true, note: N_("přepínač režimu (HMI); FALSE = ruční režim") });
        decls.push({ name: C.cmdAutoStart, type: "BOOL", group: "ctrl", todo: true, note: N_("tlačítko start auto") });
    }
    /* stejná podmínka jako u poruchy / role: meze analogů a DO s vazbou na stav stroje */
    if (hasSeq || acts.length || analogs.length || prj.devices.some(d => d.cls === "DO" && d.role)) {
        decls.push({ name: C.cmdAck, type: "BOOL", group: "ctrl", todo: true, note: N_("tlačítko kvitace poruchy (HMI)") });
        decls.push({ name: C.machineFault, type: "BOOL", group: "ctrl", note: N_("porucha stroje (chyba bloku / timeout kroku); drží do kvitace") });
    }
    for (const d of acts)
        decls.push({ name: manVarOf(d), type: "BOOL", group: "man", todo: true, note: hasSeq ? N_("ruční povel z HMI (platí při vypnutém AUTO)") : N_("ruční povel z HMI") });
    if (hasSeq) {
        decls.push({ name: C.faultStep, type: "INT", group: "ctrl", note: N_("krok sekvence, ve kterém vypršel čas (diagnostika)") });
        decls.push({ name: C.seqStep, type: "INT", group: "seq" });
        for (const v of svars)
            decls.push({ name: v, type: "BOOL", group: "seqOut" });
        for (const n of seqTimedSteps(prj))
            decls.push({ name: "tonSeq" + n, type: "TON", group: "timer" });
    }
    /* sekvence */
    let seq = null;
    if (hasSeq) {
        seq = {
            outputs: svars,
            abort: irOr(irNot(irVar(C.modeAuto)), irNot(irVar(C.enable)), irVar(C.machineFault)),
            start: irAnd(irVar(C.modeAuto), irVar(C.enable), irNot(irVar(C.machineFault)), irVar(C.cmdAutoStart)),
            steps: steps.map((s, i) => {
                const n = 10 + i * 10, next = i === steps.length - 1 ? 0 : 10 + (i + 1) * 10;
                const d = devById(prj, s.dev);
                const cond = seqCond(prj, s);
                let op = "none", set;
                if (s.act === "wait")
                    op = "dwell";
                else if (isDiWait(s))
                    op = s.act === "waitOn" ? "waitOn" : "waitOff";
                else if (d && d.cls === "Motor") {
                    op = s.act === "start" ? "run" : "stop";
                    set = { var: seqVarOf(d), value: s.act === "start" };
                }
                else if (d && d.cls === "Ventil") {
                    op = s.act === "open" ? "open" : "close";
                    set = { var: seqVarOf(d), value: s.act === "open" };
                }
                return {
                    index: i, n, next, op, act: s.act, ...(d ? { dev: d } : {}), ...(set ? { set } : {}), cond,
                    timeS: s.timeS || 1, ...(cond.kind !== "none" ? { timer: "tonSeq" + n } : {}),
                };
            }),
        };
    }
    /* zařízení: E-stop a blokování jsou v enable, DI čekání čte sekvence */
    const enIds = new Set(interlockDevs(prj).map(d => d.id));
    const waited = waitedDis(prj);
    const devices = prj.devices.map(d => {
        const item = deviceItem(prj, d, waited, hasSeq);
        if (d.id === prj.program.estop || enIds.has(d.id))
            return { kind: "enableInput", dev: d, estop: d.id === prj.program.estop, alt: item };
        return item;
    });
    /* porucha stroje: chyby bloků akčních členů a alarmy mezí analogů */
    let fault = null;
    const errors = [];
    for (const d of acts)
        errors.push(irMember(instName(d), "error"));
    for (const d of analogs) {
        if (Number.isFinite(d.limHi))
            errors.push(irMember(instName(d), "alarmHi"));
        if (Number.isFinite(d.limLo))
            errors.push(irMember(instName(d), "alarmLo"));
    }
    if (acts.length || hasSeq || errors.length)
        fault = { errors, resetFaultStep: hasSeq };
    return {
        prj, hasSeq, decls, seq, devices, fault, order: IR_EVAL_ORDER,
        enable: { inputs: enableInputs(prj).map(x => ({ dev: x.dev, tag: x.io.tag, estop: x.estop })) },
    };
}
/** Instance bloků programu (v pořadí zařízení; bez vstupů uvolnění). */
export function irBlocks(ir) {
    return ir.devices.filter((x) => x.kind === "fb");
}
