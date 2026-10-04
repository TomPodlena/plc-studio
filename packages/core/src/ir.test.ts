/** Testy mezivrstvy generátoru (ir.ts): sestavení IR z návrhu a čtení IR renderery. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleExpr, PLAT, type DoRole, type PlatformKey } from "./model.js";
import {
  buildIR, irText, roleIr, irPortTypes, seqCond, IR_EVAL_ORDER, IR_CLASSES, irBlocks,
  irVar, irIo, irNot, irParen, irOr, irAnd, irReal, type IrNames,
} from "./ir.js";
import { seqBody, renderSeq, stCtx, genFor, fbTemplate, parseFbTemplate } from "./codegen.js";
import { sampleSmall, sampleComplex } from "./samples.js";

const ID: IrNames = { L: v => v, R: t => t, real: v => String(v) };

test("ir: role výstupu — výraz IR = roleExpr (text pro import a simulátor)", () => {
  const ROLES: DoRole[] = ["run", "fault", "ready", "stopped", "lock", "auto"];
  for (const r of ROLES) for (const hasSeq of [true, false]) for (const L of [(v: string) => v, (v: string) => "#" + v]) {
    assert.equal(irText(roleIr(r, hasSeq), { ...ID, L }), roleExpr(r, hasSeq, L), r + " / " + hasSeq);
  }
});

test("ir: výrazy — závorky jen výslovné, listy přes renderer", () => {
  const n: IrNames = { L: v => "#" + v, R: t => '"' + t + '"', M: (i, p) => i + "_" + p, real: v => v.toFixed(1) };
  assert.equal(irText(irNot(irParen(irOr(irVar("a"), irIo("b")))), n), 'NOT (#a OR "b")');
  assert.equal(irText(irAnd(irVar("a"), irNot(irVar("b"))), n), "#a AND NOT #b");
  assert.equal(irText({ k: "member", inst: "instM1", port: "error" }, n), "instM1_error");
  assert.equal(irText({ k: "member", inst: "instM1", port: "error" }, ID), "instM1.error");
  assert.equal(irText(irReal(2), n), "2.0");
});

test("ir: sestavení z návrhu (ukázka) — řízení, sekvence, bloky, uvolnění, porucha", () => {
  const p = sampleSmall();
  const ir = buildIR(p);
  assert.deepEqual([...ir.order], ["enable", "seq", "seqTimers", "blocks", "fault"]);
  assert.equal(ir.order, IR_EVAL_ORDER);
  assert.ok(ir.hasSeq);
  assert.deepEqual(ir.decls.map(d => d.name), ["modeAuto", "cmdAutoStart", "cmdAck", "machineFault", "manRun_M1", "manOpen_Y1",
    "faultStep", "seqStep", "seqOpen_Y1", "seqRun_M1", "tonSeq10", "tonSeq20", "tonSeq30", "tonSeq40", "tonSeq50"]);
  /* sekvence: operace, povely, podmínky = seqCond (jediný zdroj s simulátorem) */
  const seq = ir.seq!;
  assert.deepEqual(seq.steps.map(s => s.op), ["open", "run", "dwell", "stop", "close"]);
  assert.deepEqual(seq.steps.map(s => s.n + ">" + s.next), ["10>20", "20>30", "30>40", "40>50", "50>0"]);
  assert.deepEqual(seq.steps[1].set, { var: "seqRun_M1", value: true });
  assert.deepEqual(seq.steps[3].set, { var: "seqRun_M1", value: false });
  seq.steps.forEach((s, i) => assert.deepEqual(s.cond, seqCond(p, p.program.seq[i])));
  assert.equal(irText(seq.abort, ID), "NOT modeAuto OR NOT enable OR machineFault");
  assert.equal(irText(seq.start, ID), "modeAuto AND enable AND NOT machineFault AND cmdAutoStart");
  /* zařízení: bloky s typovanými porty, E-stop a kryt v enable, volný výstup */
  assert.deepEqual(ir.devices.map(d => d.dev.name + ":" + d.kind), ["M1:fb", "Y1:fb", "B1:fb", "B2:fb", "S1:enableInput", "S2:enableInput", "H1:free"]);
  const es = ir.devices[4];
  assert.ok(es.kind === "enableInput" && es.estop && es.alt.kind === "free");
  assert.deepEqual(ir.enable.inputs.map(x => x.dev.name + (x.estop ? "!" : "")), ["S1!", "S2"]);
  const m1 = irBlocks(ir)[0];
  assert.equal(m1.fb, IR_CLASSES.Motor.fb);
  assert.deepEqual(m1.inputs.map(x => x.name + ":" + x.type + ":" + x.src), ["enable:BOOL:ctrl", "cmdStart:BOOL:ctrl", "cmdStop:BOOL:ctrl", "reset:BOOL:ctrl", "fbkRunning:BOOL:io", "fault:BOOL:io"]);
  assert.equal(irText(m1.inputs[2].expr, ID), "NOT (seqRun_M1 OR (manRun_M1 AND NOT modeAuto))");
  assert.deepEqual(m1.outputs, [{ name: "outRun", type: "BOOL", tag: "M1_outRun" }]);
  assert.deepEqual(ir.fault!.errors.map(e => irText(e, ID)), ["instM1.error", "instY1.error"]);
});

test("ir: typy portů se berou ze šablony bloku (IR šablony neduplikuje)", () => {
  for (const cls of ["Motor", "Ventil", "AnalogIn", "AnalogOut"] as const) {
    const vars = parseFbTemplate(fbTemplate(cls, "st")).vars.filter(v => v.kind !== "var");
    assert.deepEqual(irPortTypes(cls), Object.fromEntries(vars.map(v => [v.name, v.type])), cls);
  }
  for (const b of irBlocks(buildIR(sampleComplex()))) {
    const T = irPortTypes(b.cls);
    for (const p of [...b.inputs, ...b.outputs]) assert.equal(p.type, T[p.name], b.inst + "." + p.name);
  }
});

test("ir: renderery čtou IR (změna IR se projeví ve výstupu, bez IR výstup shodný)", () => {
  const p = sampleSmall();
  for (const plat of Object.keys(PLAT) as PlatformKey[]) assert.equal(renderSeq(buildIR(p), stCtx(plat)), seqBody(p, plat), plat);
  const ir = buildIR(p);
  ir.seq!.steps[2].timeS = 7.25;
  const txt = renderSeq(ir, stCtx("codesys"));
  assert.match(txt, /tonSeq30\(IN := \(seqStep = 30\), PT := T#7S250MS\);/);
  assert.match(txt, /výdrž 7.25 s|vydrz 7.25 s/);
  /* bez sekvence: IR bez seq a bez deklarací kroku, program dál vzniká */
  p.program.seq = [];
  const ir0 = buildIR(p);
  assert.equal(ir0.seq, null);
  assert.ok(!ir0.decls.some(d => d.group === "seq" || d.group === "timer" || d.name === "modeAuto"));
  assert.match(genFor(p, "codesys")["MAIN.st"], /instM1\(enable := enable,\n {8}cmdStart := manRun_M1,/);
});
