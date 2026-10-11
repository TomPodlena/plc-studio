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
 * Pohony fáze 2a (hotovo — `Vfd`, `PosDrive`, `PropValve`, viz CLAUDE.md „Pohony a polohování“):
 *  - bloky `motionFbItem` (porty: povely jako výrazy, hlášení jako I/O, parametry `real`,
 *    surový rozsah analogu `src: "rawMax"` dosazuje renderer), šablony `ST_VFD` / `ST_POSDRIVE` /
 *    `ST_PROPVALVE` (SCL ze ST), obecné volání `stCall` / `lxCallIr` / `inlineFb`;
 *  - kroky: `IrStep.sets` (povely kroku, zapisované i při přechodu DO kroku), `IrSeq.resets`
 *    (hodnoty po přerušení), podmínka `SeqCondition.expr` nad výstupy instance.
 * Příprava pro fázi 2b / 2c (zatím bez implementace):
 *  - Servoosa `Axis`: obálka FB_Axis nad bloky MC platformy (nejsou společné — S7-1200 / 1500,
 *    TwinCAT, CODESYS SM3, Omron, Logix instrukce v hlavní rutině), stejný vzor jako 2a: třída
 *    v `IrFbClass`, šablona per platforma, akce `moveAbs` / `moveRel` / `moveVel` / `halt`
 *    s parametry v `IrStep.sets`, podmínka „v poloze“ přes `expr`; emulátor potřebuje modely MC
 *    bloků a implicitních objektů os (TO, AXIS_REF), simulátor lichoběžníkový profil.
 *  - Druhý (OOP) renderer téhož IR je `codegen_oop.ts` (rodina CODESYS: INTERFACE I_Device,
 *    ABSTRACT FB_DeviceBase, třídy zařízení s Cycle ze šablony, FB_Sequence, pole odkazů v MAIN;
 *    volba `prj.codeStyle = "oop"`). Výchozí renderer zůstává klasický FB; shodu chování obou
 *    hlídá emulátor (emu_oop.test.ts). TIA V20 SCL s třídami zatím ne.
 *  - Vlastní šablony z firemní knihovny (napojeno, fáze 2c): `libraryOverrides(prj, plat)`
 *    (library.ts) → `codeLibrary(prj, plat)` (codegen.ts; vyřadí šablony, které nejde spolehlivě
 *    převést pro Unitronics / Logix, a vrátí důvod) → jediné místo výběru textu bloku
 *    `fbTemplate(cls, dialekt, lib)` (Gen_Library, AOI v L5X, `inlineFb` u Unitronics). Mají
 *    stejné rozhraní jako vestavěné, IR se tedy nemění; typy portů v IR zůstávají z vestavěné
 *    šablony (rozhraní je validací knihovny hlídané jako shodné).
 *
 * Změna výstupu generátoru jen vědomě: referenční test `golden.test.ts`
 * (přegenerování `node scripts/golden.mjs --write`, zdůvodnění v commitu).
 */
import { devById, ioOf, instName, enableInputs, interlockDevs, isDiWait, isMotionClass, isSpAct, stepSp, devSp, rampStepOf, tolOf, tolTicksOf, stepAxisTarget, } from "./model.js";
import { axisCfgOf, axisObjName } from "./axis.js";
import { N_ } from "./i18n.js";
import { IR_CTRL, FB_NAMES, SEQ_TIMER_PREFIX, MOTION_SEQ_PREFIX, seqVarOf, manVarOf, manVarsOf } from "./names.js";
export { IR_CTRL, seqVarOf, manVarOf, manVarsOf };
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
        case "axis": return n.A ? n.A(e.name) : e.name;
    }
}
/* ======================================================= řízení stroje */
/* IR_CTRL (proměnné řízení stroje) — names.ts */
/** Pořadí vyhodnocení v jednom scanu (generátor = simulátor). */
export const IR_EVAL_ORDER = ["enable", "seq", "seqTimers", "blocks", "fault"];
/** Třídy bloků: jméno FB; zdroj logiky = šablona třídy (`fbTemplate(cls, dialekt)` v codegen.ts). */
export const IR_CLASSES = Object.fromEntries(Object.entries(FB_NAMES).map(([k, fb]) => [k, { fb }]));
/** Pořadí tříd v knihovně bloků (Gen_Library, AOI, OOP) — nové třídy za původními (golden). */
export const IR_CLASS_ORDER = ["Motor", "Ventil", "AnalogIn", "AnalogOut", "Vfd", "PosDrive", "PropValve", "Axis"];
/** Typy portů bloku z vestavěné šablony IEC ST (vstupy, výstupy). */
export function irPortTypes(cls) {
    const out = {};
    for (const v of parseFbTemplate(fbTemplate(cls, "st")).vars)
        if (v.kind !== "var")
            out[v.name] = v.type;
    if (cls === "Axis")
        out.Axis = "AXIS"; // VAR_IN_OUT (Siemens VAR_INPUT) — parseFbTemplate ho nečte
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
/** Zařízení s funkčním blokem a povelem (motory, ventily, měniče, polohovací pohony, proporcionální ventily). */
export function actuators(prj) {
    return prj.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil" || isMotionClass(d.cls) || d.cls === "Axis");
}
/* jména povelů (seqVarOf, manVarOf, manVarsOf) a řízení (IR_CTRL) jsou v names.ts — sdílí je kontrola kolizí tagů */
/** Povely sekvence motorů a ventilů (BOOL, pořadí prvního výskytu v sekvenci). */
export function seqVars(prj) {
    const vars = new Set();
    for (const s of prj.program.seq) {
        const d = devById(prj, s.dev);
        if (d && (d.cls === "Motor" || d.cls === "Ventil"))
            vars.add(seqVarOf(d));
    }
    return [...vars];
}
/** Proměnné povelů sekvence pohonu fáze 2a (jméno → typ a hodnota po přerušení). */
export function motionSeqVars(d) {
    const n = d.name;
    if (d.cls === "Vfd") {
        const [run, spd, rev] = MOTION_SEQ_PREFIX.Vfd;
        return [{ var: run + n, type: "BOOL", value: irBool(false) }, { var: spd + n, type: "REAL", value: irReal(devSp(d)) },
            ...(d.opt?.rev ? [{ var: rev + n, type: "BOOL", value: irBool(false) }] : [])];
    }
    if (d.cls === "PosDrive") {
        const [move, home, rec] = MOTION_SEQ_PREFIX.PosDrive;
        return [{ var: move + n, type: "BOOL", value: irBool(false) }, { var: home + n, type: "BOOL", value: irBool(false) }, { var: rec + n, type: "INT", value: irInt(0) }];
    }
    if (d.cls === "PropValve") {
        const [on, sp] = MOTION_SEQ_PREFIX.PropValve;
        return [{ var: on + n, type: "BOOL", value: irBool(false) }, { var: sp + n, type: "REAL", value: irReal(devSp(d)) }];
    }
    if (d.cls === "Axis") {
        const [cmd, mode, tgt, vel, acc, dec] = MOTION_SEQ_PREFIX.Axis;
        return [{ var: cmd + n, type: "INT", value: irInt(0) }, { var: mode + n, type: "INT", value: irInt(0) },
            { var: tgt + n, type: "REAL", value: irReal(0) }, { var: vel + n, type: "REAL", value: irReal(0) },
            { var: acc + n, type: "REAL", value: irReal(0) }, { var: dec + n, type: "REAL", value: irReal(0) }];
    }
    return [];
}
/** Pohony fáze 2a a servoosy, které sekvence ovládá (pořadí prvního výskytu v sekvenci). */
export function seqMotionDevs(prj) {
    const out = [];
    for (const s of prj.program.seq) {
        const d = devById(prj, s.dev);
        if (d && (isMotionClass(d.cls) || d.cls === "Axis") && s.act !== "wait" && !out.includes(d))
            out.push(d);
    }
    return out;
}
/** Režim povelu osy (vstup cmdMode FB_Axis): 1 absolutně, 2 relativně, 3 rychlost, 4 zastavit, 5 referovat. */
export const AXIS_MODE = { moveAbs: 1, moveRel: 2, velocity: 3, halt: 4, home: 5 };
/**
 * Povely kroku pohonu fáze 2a / servoosy (prázdné u ostatních). Zrcadlo v simulátoru. `stepNo` = číslo
 * kroku v programu (10, 20…) — u osy je to číslo povelu (cmdId), FB_Axis ho vrátí v doneId.
 */
export function motionStepSets(d, s, stepNo = 0) {
    const n = d.name;
    if (d.cls === "Axis") {
        const mode = AXIS_MODE[s.act];
        if (!mode)
            return []; // waitInPos: jen čeká
        const r = (v) => irReal(Number(v) > 0 ? Number(v) : 0);
        return [{ var: "seqTgt_" + n, type: "REAL", value: irReal(stepAxisTarget(s, d)) },
            { var: "seqVel_" + n, type: "REAL", value: s.act === "velocity" ? irReal(0) : r(s.vel) },
            { var: "seqAcc_" + n, type: "REAL", value: r(s.acc) }, { var: "seqDec_" + n, type: "REAL", value: r(s.dec) },
            { var: "seqMode_" + n, type: "INT", value: irInt(mode) }, { var: "seqCmd_" + n, type: "INT", value: irInt(stepNo) }];
    }
    if (d.cls === "Vfd") {
        if (s.act !== "start")
            return [{ var: "seqRun_" + n, type: "BOOL", value: irBool(false) }];
        return [{ var: "seqSpd_" + n, type: "REAL", value: irReal(stepSp(s, d)) },
            ...(d.opt?.rev ? [{ var: "seqRev_" + n, type: "BOOL", value: irBool(!!s.rev) }] : []),
            { var: "seqRun_" + n, type: "BOOL", value: irBool(true) }];
    }
    if (d.cls === "PosDrive") {
        if (s.act === "home")
            return [{ var: "seqMove_" + n, type: "BOOL", value: irBool(false) }, { var: "seqHome_" + n, type: "BOOL", value: irBool(true) }];
        return [{ var: "seqHome_" + n, type: "BOOL", value: irBool(false) }, { var: "seqRec_" + n, type: "INT", value: irInt(Math.round(Number(s.rec) || 0)) },
            { var: "seqMove_" + n, type: "BOOL", value: irBool(true) }];
    }
    if (d.cls === "PropValve")
        return [{ var: "seqSp_" + n, type: "REAL", value: irReal(stepSp(s, d)) }, { var: "seqOn_" + n, type: "BOOL", value: irBool(true) }];
    return [];
}
export function seqCond(prj, s) {
    if (s.act === "wait" || (s.cond === "time" && !isDiWait(s) && s.act !== "waitInPos"))
        return { kind: "time" };
    const d = devById(prj, s.dev);
    if (!d)
        return { kind: "none" };
    /* pohony fáze 2a: přechod na výstup bloku (po zpracování povelu v tomtéž scanu — viz IrStep.sets) */
    const inst = instName(d);
    if (d.cls === "Vfd")
        return s.act === "start" ? { kind: "fbk", expr: irMember(inst, "inSpeed") } : { kind: "none" };
    if (d.cls === "PosDrive") {
        if (s.act !== "home" && s.act !== "posRecord")
            return { kind: "none" };
        const rec = s.act === "home" ? 0 : Math.round(Number(s.rec) || 0);
        return { kind: "fbk", expr: irAnd(irMember(inst, "done"), irEq(irMember(inst, "actRec"), irInt(rec))) };
    }
    if (d.cls === "PropValve")
        return isSpAct(s.act) ? { kind: "fbk", expr: irMember(inst, "inTol") } : { kind: "none" };
    if (d.cls === "Axis") {
        /* osa: povel = číslo kroku; hotovo = done AND doneId (čekání na dokončení = číslo posledního pohybu osy před krokem) */
        const seq = prj.program.seq, i = seq.indexOf(s);
        if (i < 0)
            return { kind: "none" };
        let k = i;
        if (s.act === "waitInPos") {
            k = -1;
            for (let j = i - 1; j >= 0; j--)
                if (seq[j].dev === d.id && AXIS_MODE[seq[j].act]) {
                    k = j;
                    break;
                }
        }
        else if (!AXIS_MODE[s.act])
            return { kind: "none" };
        if (k < 0)
            return { kind: "none" };
        return { kind: "fbk", expr: irAnd(irMember(inst, "done"), irEq(irMember(inst, "doneId"), irInt(10 + k * 10))) };
    }
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
    /* polohovací pohon: ruční povel = referování → v sekvenci seqHome_ */
    const sv = d.cls === "PosDrive" ? "seqHome_" + d.name : seqVarOf(d);
    const inSeq = isMotionClass(d.cls) ? seqMotionDevs(prj).includes(d) : seqVars(prj).includes(seqVarOf(d));
    return inSeq ? irOr(irVar(sv), man) : man;
}
/** Blok pohonu fáze 2a: povely ze sekvence / ručního povelu, zpětná hlášení z I/O, parametry. */
function motionFbItem(prj, d, base, T) {
    const io = ioOf(prj, d);
    const C = IR_CTRL, n = d.name;
    const inSeq = prj.program.seq.length > 0 && seqMotionDevs(prj).includes(d);
    const port = (name, expr, src) => ({ name, type: T[name], expr, src });
    const sig = (name, e, dflt) => e ? port(name, irIo(e.tag), "io") : port(name, dflt, "default");
    const outs = (names, must = []) => names.filter(x => io[x] || must.includes(x)).map(x => io[x] ? { name: x, type: T[x], tag: io[x].tag } : { name: x, type: T[x] });
    const rawMax = port("rawMax", irInt(27648), "rawMax");
    const cmd = cmdIr(prj, d);
    if (d.cls === "Vfd") {
        const inputs = [port("enable", irVar(C.enable), "ctrl"), port("cmdRun", cmd, "ctrl"), port("cmdStop", irNot(irParen(cmd)), "ctrl"),
            inSeq && d.opt?.rev ? port("cmdRev", irVar("seqRev_" + n), "ctrl") : port("cmdRev", irBool(false), "default"),
            port("reset", irVar(C.cmdAck), "ctrl"),
            sig("ready", io.ready, irBool(true)), sig("atSpeed", io.atSpeed, irBool(true)), sig("fault", io.fault, irBool(false)),
            inSeq ? port("speedSp", irVar("seqSpd_" + n), "ctrl") : port("speedSp", irReal(devSp(d)), "param"),
            port("rampStep", irReal(rampStepOf(d)), "param"), port("scaleMin", irReal(d.rmin), "param"), port("scaleMax", irReal(d.rmax), "param"),
            rawMax, sig("rawAct", io.rawAct, irInt(0))];
        return { ...base, cmd, inputs, outputs: outs(["outRun", "outRev", "outReset", "rawSpeed"], ["outRun", "rawSpeed"]) };
    }
    if (d.cls === "PosDrive") {
        const inputs = [port("enable", irVar(C.enable), "ctrl"), port("cmdHome", cmd, "ctrl"),
            inSeq ? port("cmdMove", irVar("seqMove_" + n), "ctrl") : port("cmdMove", irBool(false), "default"),
            inSeq ? port("recNo", irVar("seqRec_" + n), "ctrl") : port("recNo", irInt(0), "default"),
            port("reset", irVar(C.cmdAck), "ctrl"),
            sig("ready", io.ready, irBool(true)), sig("inPos", io.inPos, irBool(true)), sig("homed", io.homed, irBool(true)), sig("fault", io.fault, irBool(false))];
        const sel = [0, 1, 2, 3, 4, 5].map(k => "outSel" + k);
        return { ...base, cmd, inputs, outputs: outs(["outEnable", "outStart", "outHome", "outHalt", ...sel, "outReset"], ["outEnable", "outStart", "outHome"]) };
    }
    /* PropValve */
    const fbk = !!io.rawAct;
    const inputs = [port("enable", irVar(C.enable), "ctrl"), port("cmdOn", cmd, "ctrl"),
        inSeq ? port("spTarget", irVar("seqSp_" + n), "ctrl") : port("spTarget", irReal(devSp(d)), "param"),
        port("reset", irVar(C.cmdAck), "ctrl"),
        port("rampStep", irReal(rampStepOf(d)), "param"), port("tol", irReal(tolOf(d)), "param"), port("tolTicks", irInt(tolTicksOf(d)), "param"),
        port("useFbk", irBool(fbk), "param"), port("scaleMin", irReal(d.rmin), "param"), port("scaleMax", irReal(d.rmax), "param"),
        rawMax, sig("rawAct", io.rawAct, irInt(0))];
    return { ...base, cmd, inputs, outputs: outs(["rawSp"], ["rawSp"]) };
}
/**
 * Blok servoosy (FB_Axis): regulace v AUTO (osa v sekvenci) NEBO ručním povelem, povel sekvence
 * (číslo kroku, režim, cíl, dynamika — 0 = výchozí z konfigurace), ruční referování a pojezd jen
 * mimo AUTO, konfigurace osy jako parametry, objekt osy jako odkaz (`src: "axis"`).
 */
function axisFbItem(prj, d, base, T) {
    const C = IR_CTRL, n = d.name, c = axisCfgOf(d);
    const hasSeq = prj.program.seq.length > 0;
    const inSeq = hasSeq && seqMotionDevs(prj).includes(d);
    const port = (name, expr, src) => ({ name, type: T[name], expr, src });
    const man = (v) => hasSeq ? irParen(irAnd(irVar(v + n), irNot(irVar(C.modeAuto)))) : irVar(v + n);
    const power = inSeq ? irOr(irVar(C.modeAuto), irVar("manPower_" + n)) : irVar("manPower_" + n);
    const sv = (k, dflt) => inSeq ? port(k, irVar({ cmdId: "seqCmd_", cmdMode: "seqMode_", cmdPos: "seqTgt_", cmdVel: "seqVel_", cmdAcc: "seqAcc_", cmdDec: "seqDec_" }[k] + n), "ctrl") : port(k, dflt, "default");
    const inputs = [port("enable", irVar(C.enable), "ctrl"), port("power", power, "ctrl"),
        sv("cmdId", irInt(0)), sv("cmdMode", irInt(0)), sv("cmdPos", irReal(0)), sv("cmdVel", irReal(0)), sv("cmdAcc", irReal(0)), sv("cmdDec", irReal(0)),
        port("manHome", man("manHome_"), "ctrl"), port("jogPos", man("manJogP_"), "ctrl"), port("jogNeg", man("manJogN_"), "ctrl"),
        port("reset", irVar(C.cmdAck), "ctrl"),
        port("cfgVel", irReal(c.vDef), "param"), port("cfgAcc", irReal(c.aMax), "param"), port("cfgDec", irReal(c.dMax), "param"),
        port("cfgJerk", irReal(c.jerk), "param"), port("jogVel", irReal(c.jogVel), "param"), port("homePos", irReal(c.homePos), "param"),
        port("Axis", { k: "axis", name: axisObjName(d) }, "axis")];
    return { ...base, cmd: power, inputs, outputs: [] };
}
function fbItem(prj, d) {
    if (d.cls !== "Motor" && d.cls !== "Ventil" && d.cls !== "AnalogIn" && d.cls !== "AnalogOut" && !isMotionClass(d.cls) && d.cls !== "Axis")
        return null;
    const cls = d.cls;
    const T = irPortTypes(cls);
    const io = ioOf(prj, d);
    const C = IR_CTRL;
    const port = (name, expr, src) => ({ name, type: T[name], expr, src });
    const sig = (name, e, dflt) => e ? port(name, irIo(e.tag), "io") : port(name, dflt, "default");
    const out = (name, e) => e ? { name, type: T[name], tag: e.tag } : { name, type: T[name] };
    const base = { kind: "fb", dev: d, cls, fb: IR_CLASSES[cls].fb, inst: instName(d) };
    if (isMotionClass(d.cls))
        return motionFbItem(prj, d, base, T);
    if (d.cls === "Axis")
        return axisFbItem(prj, d, base, T);
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
    const mvars = seqMotionDevs(prj).flatMap(motionSeqVars);
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
    for (const d of acts) {
        if (d.cls === "Axis") {
            const [pw, hm, jp, jn] = manVarsOf(d);
            decls.push({ name: pw, type: "BOOL", group: "man", todo: true, note: N_("regulace osy zapnuta (HMI); v AUTO zapíná osu sekvence") });
            decls.push({ name: hm, type: "BOOL", group: "man", todo: true, note: hasSeq ? N_("ruční referování osy (hrana; platí při vypnutém AUTO)") : N_("ruční referování osy (hrana)") });
            decls.push({ name: jp, type: "BOOL", group: "man", todo: true, note: hasSeq ? N_("ruční pojezd v kladném směru (držet; platí při vypnutém AUTO)") : N_("ruční pojezd v kladném směru (držet)") });
            decls.push({ name: jn, type: "BOOL", group: "man", todo: true, note: hasSeq ? N_("ruční pojezd v záporném směru (držet; platí při vypnutém AUTO)") : N_("ruční pojezd v záporném směru (držet)") });
            continue;
        }
        decls.push({ name: manVarOf(d), type: "BOOL", group: "man", todo: true, note: hasSeq ? N_("ruční povel z HMI (platí při vypnutém AUTO)") : N_("ruční povel z HMI") });
    }
    if (hasSeq) {
        decls.push({ name: C.faultStep, type: "INT", group: "ctrl", note: N_("krok sekvence, ve kterém vypršel čas (diagnostika)") });
        decls.push({ name: C.seqStep, type: "INT", group: "seq" });
        for (const v of svars)
            decls.push({ name: v, type: "BOOL", group: "seqOut" });
        for (const v of mvars)
            decls.push({ name: v.var, type: v.type, group: "seqOut" });
        for (const n of seqTimedSteps(prj))
            decls.push({ name: SEQ_TIMER_PREFIX + n, type: "TON", group: "timer" });
    }
    /* sekvence */
    let seq = null;
    if (hasSeq) {
        seq = {
            outputs: svars,
            resets: mvars,
            abort: irOr(irNot(irVar(C.modeAuto)), irNot(irVar(C.enable)), irVar(C.machineFault)),
            start: irAnd(irVar(C.modeAuto), irVar(C.enable), irNot(irVar(C.machineFault)), irVar(C.cmdAutoStart)),
            steps: steps.map((s, i) => {
                const n = 10 + i * 10, next = i === steps.length - 1 ? 0 : 10 + (i + 1) * 10;
                const d = devById(prj, s.dev);
                const cond = seqCond(prj, s);
                let op = "none", set, sets;
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
                else if (d && isMotionClass(d.cls)) {
                    op = d.cls === "Vfd" ? (s.act === "start" ? "run" : "stop") : d.cls === "PosDrive" ? (s.act === "home" ? "home" : "posRecord") : "setPressure";
                    sets = motionStepSets(d, s);
                }
                else if (d && d.cls === "Axis" && (s.act === "home" || s.act === "moveAbs" || s.act === "moveRel" || s.act === "velocity" || s.act === "halt" || s.act === "waitInPos")) {
                    op = s.act;
                    sets = motionStepSets(d, s, n);
                }
                return {
                    index: i, n, next, op, act: s.act, ...(d ? { dev: d } : {}), ...(set ? { set } : {}), ...(sets ? { sets } : {}), cond,
                    timeS: s.timeS || 1, ...(cond.kind !== "none" ? { timer: SEQ_TIMER_PREFIX + n } : {}),
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
