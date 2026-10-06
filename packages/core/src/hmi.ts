/**
 * PLCdesk — HMI vrstva z projektu: tagy pro obsluhu, alarmy a obrazovky.
 *
 * Jeden model (`buildHmi`) → exporty pro HMI výrobců (hmi_export.ts), webové HMI a JSON popis
 * obrazovek, SVG náhledy obrazovek a dokument `16_hmi.md` (hmi_docs.ts).
 *
 * Zdroje — nic se neopisuje:
 *  - tagy řízení stroje = deklarace generátoru (`ctrlDecls`), proměnné bloků = šablony
 *    (`parseFbTemplate(ST_MOTOR…)`), I/O = tabulka I/O projektu;
 *  - alarmy = seznam alarmů z dokumentace (`docAlarmCsv`, tytéž texty a kódy), spouštěcí
 *    signál podle kódu alarmu (logika nestojí na přeloženém textu);
 *  - kroky sekvence = `stepTitle` / `stepCondText` / `stepWatchdog` (sim.ts).
 *
 * Každý tag HMI ukazuje na proměnnou, kterou generovaný program deklaruje (hlídá test
 * pro všechny příklady × platformy × jazyky). Meze a žádané hodnoty jsou v programu konstanty
 * → v HMI jen ke čtení. U Mitsubishi a Omron (HMI čte jen globální) generátor řízení stroje
 * deklaruje globálně a stav bloků zrcadlí do globálních proměnných (`hmiGlobalVars`, codegen.ts).
 */
import { Project, Device, PlatformKey, ioOf, instName, stripDia, interlockDevs, isCodesysFamily, codeStyleFor } from "./model.js";
import { tr, N_ } from "./i18n.js";
import { ctrlDecls, actuators, manVarOf, parseFbTemplate, hmiGlobalPlat, motionHmiPorts, ST_MOTOR, ST_VENTIL, ST_AI, ST_AO, ST_VFD, ST_POSDRIVE, ST_PROPVALVE, ST_AXIS } from "./codegen.js";
import { axisCfgOf } from "./axis.js";
import { buildIR, irBlocks, manVarsOf } from "./ir.js";
import { docAlarmCsv } from "./docs.js";
import {
  stepTitle, stepCondText, stepWatchdog, T_MOTOR_FBK, T_VALVE_TRAVEL, T_VFD_SPEED, T_POS_ACK, T_POS_MOVE, T_PROP_SETTLE, T_AXIS_POWER, MOTION_ERR,
} from "./sim.js";
import { isMotionClass, rampStepOf, tolOf, tolTicksOf, selBitsOf, maxRecord } from "./model.js";

/* ================================================================ tagy */

export type HmiType = "BOOL" | "INT" | "WORD" | "REAL";
/** ctrl = řízení stroje, dev = blok zařízení, seq = sekvence, ana = analogy, io = signál I/O, par = parametr. */
export type HmiGroup = "ctrl" | "dev" | "seq" | "ana" | "io" | "par";

export interface HmiState { value: number; text: string; }

export interface HmiTag {
  /** Název tagu v HMI — identifikátor ASCII; u proměnných strojního bloku = tvar Unitronics (`instM1_status`). */
  name: string;
  /** machine = proměnná strojního bloku (FB_Machine / MAIN), io = globální tag I/O. */
  src: "machine" | "io";
  /** machine: cesta ve strojním bloku (`modeAuto`, `instM1.status`); io: tag I/O (`M1_fbkRunning`). */
  member: string;
  type: HmiType;
  /** RW jen u povelů z HMI (režim, start, kvitace, ruční povely). */
  access: "R" | "RW";
  /** momentary = tlačítko (TRUE po dobu stisku), toggle = přepínač. */
  cmd?: "momentary" | "toggle";
  group: HmiGroup;
  dev?: string;
  desc: string;
  unit?: string;
  min?: number;
  max?: number;
  /** Textový seznam hodnot (stav bloku, krok sekvence). */
  states?: HmiState[];
}

/** Kód chyby bloku pohonu (errCode) — texty jako dokumentace. */
const ERR_STATES = (): HmiState[] => [{ value: 0, text: tr("bez chyby") }, ...Object.entries(MOTION_ERR).map(([k, t]) => ({ value: +k, text: tr(t) }))];

const STATUS_STATES = (): HmiState[] => [
  { value: 0, text: tr("v pořádku") },
  { value: 0x8001, text: tr("blokováno (uvolnění)") },
  { value: 0x8002, text: tr("porucha") },
];

/** Názvy proměnných, které generátor deklaruje ve strojním bloku (řízení stroje). */
export function hmiCtrlNames(prj: Project): Set<string> {
  const s = new Set<string>(["enable"]);
  for (const line of ctrlDecls(prj, "codesys").split("\n")) {
    const m = line.match(/^\s*(\w+)\s*:/);
    if (m) s.add(m[1]);
  }
  return s;
}

/** Proměnné šablony bloku třídy (vstupy, výstupy) — HMI smí číst jen to, co šablona má. */
function fbVars(cls: string): Set<string> {
  const tpl = cls === "Motor" ? ST_MOTOR : cls === "Ventil" ? ST_VENTIL : cls === "AnalogIn" ? ST_AI : cls === "AnalogOut" ? ST_AO
    : cls === "Vfd" ? ST_VFD : cls === "PosDrive" ? ST_POSDRIVE : cls === "PropValve" ? ST_PROPVALVE : cls === "Axis" ? ST_AXIS : "";
  return new Set(tpl ? parseFbTemplate(tpl).vars.filter(v => v.kind !== "var").map(v => v.name) : []);
}

function stepStates(prj: Project): HmiState[] {
  return [{ value: 0, text: tr("čekání na start") },
    ...prj.program.seq.map((s, i) => ({ value: 10 + i * 10, text: tr("Krok {n}: {title}", { n: i + 1, title: stepTitle(prj, s) }) }))];
}

/** Tagy HMI odvozené z projektu (pořadí: řízení, sekvence, zařízení, analogy, I/O, parametry). */
export function hmiTags(prj: Project): HmiTag[] {
  const out: HmiTag[] = [];
  const ctrl = hmiCtrlNames(prj);
  const M = (member: string, type: HmiType, group: HmiGroup, desc: string, o: Partial<HmiTag> = {}): void => {
    out.push({ name: member.replace(/\./g, "_"), src: "machine", member, type, access: "R", group, desc, ...o });
  };
  M("enable", "BOOL", "ctrl", tr("Centrální uvolnění (E-stop a blokování v pořádku)"));
  if (ctrl.has("modeAuto")) M("modeAuto", "BOOL", "ctrl", tr("Režim AUTO (FALSE = ruční režim)"), { access: "RW", cmd: "toggle" });
  if (ctrl.has("cmdAutoStart")) M("cmdAutoStart", "BOOL", "ctrl", tr("Start automatického cyklu"), { access: "RW", cmd: "momentary" });
  if (ctrl.has("cmdAck")) M("cmdAck", "BOOL", "ctrl", tr("Kvitace poruchy"), { access: "RW", cmd: "momentary" });
  if (ctrl.has("machineFault")) M("machineFault", "BOOL", "ctrl", tr("Porucha stroje (drží do kvitace)"));
  if (ctrl.has("seqStep")) M("seqStep", "INT", "seq", tr("Aktuální krok sekvence"), { states: stepStates(prj) });
  if (ctrl.has("faultStep")) M("faultStep", "INT", "seq", tr("Krok sekvence, ve kterém vypršel hlídací čas"), { states: stepStates(prj) });

  const blocks = new Map(irBlocks(buildIR(prj)).map(b => [b.dev.id, b]));
  for (const d of actuators(prj)) {
    const inst = instName(d), v = fbVars(d.cls), dev = d.name;
    const manTxt = d.cls === "Motor" || d.cls === "Vfd" ? tr("{dev}: ruční povel chod (platí mimo AUTO)", { dev })
      : d.cls === "PosDrive" ? tr("{dev}: ruční povel referenční jízda (platí mimo AUTO)", { dev })
      : d.cls === "PropValve" ? tr("{dev}: ruční povel zapnout na výchozí žádanou (platí mimo AUTO)", { dev })
      : tr("{dev}: ruční povel otevřít (platí mimo AUTO)", { dev });
    if (d.cls === "Axis") {
      /* servoosa: regulace (přepínač), referování (tlačítko), pojezd ± (držet) */
      const [pw, hm, jp, jn] = manVarsOf(d);
      if (ctrl.has(pw)) M(pw, "BOOL", "dev", tr("{dev}: regulace osy zapnuta (ručně; v AUTO ji zapíná sekvence)", { dev }), { access: "RW", cmd: "toggle", dev });
      if (ctrl.has(hm)) M(hm, "BOOL", "dev", tr("{dev}: ruční referování osy (platí mimo AUTO)", { dev }), { access: "RW", cmd: "momentary", dev });
      if (ctrl.has(jp)) M(jp, "BOOL", "dev", tr("{dev}: ruční pojezd + (držet, platí mimo AUTO)", { dev }), { access: "RW", cmd: "momentary", dev });
      if (ctrl.has(jn)) M(jn, "BOOL", "dev", tr("{dev}: ruční pojezd − (držet, platí mimo AUTO)", { dev }), { access: "RW", cmd: "momentary", dev });
    } else if (ctrl.has(manVarOf(d))) M(manVarOf(d), "BOOL", "dev", manTxt, { access: "RW", cmd: "toggle", dev });
    if (isMotionClass(d.cls) || d.cls === "Axis") {
      /* pohony fáze 2a: stejné výstupy bloku, jaké u Mitsubishi / Omron zrcadlí MAIN (motionHmiPorts) */
      const b = blocks.get(d.id);
      const u = d.unit || undefined;
      const TXT: Record<string, [HmiType, string, Partial<HmiTag>?]> = {
        outRun: ["BOOL", tr("{dev}: povel chod (výstup bloku)", { dev })],
        inSpeed: ["BOOL", tr("{dev}: otáčky dosaženy", { dev })],
        speedCmd: ["REAL", tr("{dev}: žádané otáčky po rampě", { dev }), { unit: u, min: d.rmin, max: d.rmax }],
        speedAct: ["REAL", tr("{dev}: skutečné otáčky", { dev }), { unit: u, min: d.rmin, max: d.rmax }],
        done: ["BOOL", tr("{dev}: v poloze (jízda dokončena)", { dev })],
        actRec: ["INT", tr("{dev}: dosažený záznam (0 = reference)", { dev })],
        spAct: ["REAL", tr("{dev}: žádaná hodnota po rampě", { dev }), { unit: u, min: d.rmin, max: d.rmax }],
        value: ["REAL", tr("{dev}: skutečná hodnota", { dev }), { unit: u, min: d.rmin, max: d.rmax }],
        inTol: ["BOOL", tr("{dev}: skutečná hodnota v toleranci", { dev })],
        busy: ["BOOL", d.cls === "PosDrive" ? tr("{dev}: jede / referuje", { dev }) : d.cls === "Vfd" ? tr("{dev}: rozbíhá se / mění otáčky", { dev }) : tr("{dev}: rampa žádané", { dev })],
        error: ["BOOL", tr("{dev}: porucha bloku", { dev })],
        status: ["WORD", tr("{dev}: stavové slovo bloku", { dev }), { states: STATUS_STATES() }],
        errCode: ["INT", tr("{dev}: kód chyby bloku", { dev }), { states: ERR_STATES() }],
        /* servoosa (FB_Axis) */
        powered: ["BOOL", tr("{dev}: regulace osy zapnuta", { dev })],
        homed: ["BOOL", tr("{dev}: osa referována", { dev })],
        doneId: ["INT", tr("{dev}: číslo kroku posledního dokončeného povelu", { dev })],
        actPos: ["REAL", tr("{dev}: skutečná poloha osy", { dev }), { unit: u }],
        moving: ["BOOL", tr("{dev}: osa jede", { dev })],
      };
      if (d.cls === "Axis") { TXT.done = ["BOOL", tr("{dev}: povel osy dokončen", { dev })]; TXT.busy = ["BOOL", tr("{dev}: osa provádí povel", { dev })]; }
      for (const port of b ? motionHmiPorts(b) : []) {
        const t = TXT[port];
        if (t && v.has(port)) M(inst + "." + port, t[0], "dev", t[1], { dev, ...(t[2] || {}) });
      }
      continue;
    }
    const outV = d.cls === "Motor" ? "outRun" : "outOpen";
    if (v.has(outV)) M(inst + "." + outV, "BOOL", "dev", d.cls === "Motor" ? tr("{dev}: povel chod (výstup bloku)", { dev }) : tr("{dev}: povel otevřít (výstup bloku)", { dev }), { dev });
    if (v.has("busy")) M(inst + ".busy", "BOOL", "dev", d.cls === "Motor" ? tr("{dev}: rozbíhá se", { dev }) : tr("{dev}: přestavuje se", { dev }), { dev });
    if (v.has("error")) M(inst + ".error", "BOOL", "dev", tr("{dev}: porucha bloku", { dev }), { dev });
    if (v.has("status")) M(inst + ".status", "WORD", "dev", tr("{dev}: stavové slovo bloku", { dev }), { dev, states: STATUS_STATES() });
  }
  for (const d of prj.devices) {
    const inst = instName(d), dev = d.name, v = fbVars(d.cls);
    const unit = d.unit || undefined;
    if (d.cls === "AnalogIn") {
      M(inst + ".value", "REAL", "ana", tr("{dev}: měřená hodnota", { dev }) + (d.desc ? " — " + d.desc : ""), { dev, unit, min: d.rmin, max: d.rmax });
      if (v.has("alarmHi")) M(inst + ".alarmHi", "BOOL", "ana", tr("{dev}: překročena horní mez", { dev }), { dev });
      if (v.has("alarmLo")) M(inst + ".alarmLo", "BOOL", "ana", tr("{dev}: podkročena dolní mez", { dev }), { dev });
      if (Number.isFinite(d.limHi)) M(inst + ".limitHi", "REAL", "par", tr("{dev}: horní mez (konstanta programu)", { dev }), { dev, unit });
      if (Number.isFinite(d.limLo)) M(inst + ".limitLo", "REAL", "par", tr("{dev}: dolní mez (konstanta programu)", { dev }), { dev, unit });
    } else if (d.cls === "AnalogOut") {
      M(inst + ".value", "REAL", "ana", tr("{dev}: žádaná hodnota (konstanta programu)", { dev }) + (d.desc ? " — " + d.desc : ""), { dev, unit, min: d.rmin, max: d.rmax });
    }
  }
  /* signály I/O: hlášení pohonů, snímače, blokování, signálky (vše jen ke čtení) */
  const estop = prj.program.estop;
  const locked = new Set(interlockDevs(prj).map(d => d.id));
  for (const d of prj.devices) {
    const io = ioOf(prj, d);
    const pick = d.cls === "Motor" ? ["fbkRunning", "fault"] : d.cls === "Ventil" ? ["fbkOpen", "fbkClosed"] : d.cls === "DI" ? ["in"] : d.cls === "DO" ? ["out"]
      : d.cls === "Vfd" ? ["ready", "atSpeed", "fault"] : d.cls === "PosDrive" ? ["ready", "inPos", "homed", "fault"] : [];
    for (const sig of pick) {
      const e = io[sig];
      if (!e) continue;
      const what = d.id === estop ? tr("nouzové zastavení (TRUE = v pořádku)") : locked.has(d.id) ? tr("blokování (TRUE = v pořádku)") : (e.cmt || d.desc || sig);
      out.push({ name: e.tag, src: "io", member: e.tag, type: "BOOL", access: "R", group: "io", dev: d.name, desc: d.name + ": " + what });
    }
  }
  return out;
}

/* ================================================================ alarmy */

export type HmiAlarmClass = "fault" | "stop" | "warning";

export interface HmiAlarmTrigger {
  /** Název tagu HMI (vždy z `hmiTags`). */
  tag: string;
  /** bit = alarm při TRUE, bitOff = alarm při FALSE (blokování), value = alarm při tag = value. */
  kind: "bit" | "bitOff" | "value";
  value?: number;
}

export interface HmiAlarm {
  /** Pořadové číslo (1…) — číslo alarmu v HMI. */
  id: number;
  /** Identifikátor alarmu (ASCII): kód ze seznamu alarmů, u sdíleného signálu `A_<zař>_ERROR`. */
  name: string;
  /** Kódy ze seznamu alarmů (`04_seznam_alarmu.csv`), které alarm pokrývá. */
  codes: string[];
  dev: string;
  text: string;
  cause: string;
  reaction: string;
  ack: string;
  cls: HmiAlarmClass;
  /** 1 = nejvyšší. */
  priority: number;
  ackRequired: boolean;
  trigger: HmiAlarmTrigger;
}

export interface AlarmRow { code: string; dev: string; alarm: string; cause: string; reaction: string; ack: string; }

/** Řádky seznamu alarmů z dokumentace (`docAlarmCsv`) — tytéž kódy a texty. */
export function alarmRows(prj: Project): AlarmRow[] {
  return docAlarmCsv(prj).split("\n").slice(1).filter(Boolean).map(line => {
    const p = line.split(";");
    /* text příčiny může obsahovat středník z popisu zařízení: krajní sloupce jsou pevné */
    const [code, dev, alarm] = p;
    const ack = p[p.length - 1], reaction = p[p.length - 2];
    const cause = p.slice(3, p.length - 2).join(";");
    return { code, dev, alarm, cause, reaction, ack };
  });
}

/**
 * Alarmy HMI: každý kód seznamu alarmů právě jednou. Blok zařízení nerozlišuje příčinu
 * poruchy (jediný výstup `error`) — kódy se společným signálem tvoří jeden alarm HMI
 * s texty všech příčin. Externí porucha motoru má vlastní vstup → vlastní alarm.
 */
export function hmiAlarms(prj: Project, tags: HmiTag[] = hmiTags(prj)): HmiAlarm[] {
  const byName = new Set(tags.map(t => t.name));
  const groups = new Map<string, { rows: AlarmRow[]; trigger: HmiAlarmTrigger; cls: HmiAlarmClass; dev: string }>();
  for (const r of alarmRows(prj)) {
    const m = r.code.match(/^A_(\w+?)_(START|RUN|FAULT|TRAVEL|POS|OPEN|HI|LO|READY|NOTHOMED|SPEED|TIMEOUT|DEV|AXIS|POWER|CMD)$/);
    const seq = r.code.match(/^A_SEQ_(\d+)$/);
    let trigger: HmiAlarmTrigger | undefined, cls: HmiAlarmClass = "fault", dev = r.dev, key = r.code;
    if (seq) {
      trigger = { tag: "faultStep", kind: "value", value: 10 + (+seq[1] - 1) * 10 };
    } else if (m) {
      const d = prj.devices.find(x => x.name === m[1]);
      if (!d) continue;
      dev = d.name;
      const inst = instName(d), io = ioOf(prj, d);
      /* pohony fáze 2a: blok rozlišuje příčinu kódem chyby errCode (1 porucha … 6 odchylka) */
      const ERR: Record<string, number> = { FAULT: 1, READY: 2, NOTHOMED: 3, SPEED: 4, POS: 4, TIMEOUT: 5, DEV: 6 };
      /* servoosa: errCode 1 porucha osy, 2 regulace nezapnuta, 3 bez referování, 7 povel odmítnut */
      const AXE: Record<string, number> = { AXIS: 1, POWER: 2, NOTHOMED: 3, CMD: 7 };
      if (d.cls === "Axis" && AXE[m[2]]) {
        trigger = { tag: inst + "_errCode", kind: "value", value: AXE[m[2]] };
      } else if (isMotionClass(d.cls) && ERR[m[2]]) {
        trigger = m[2] === "FAULT" && io.fault ? { tag: io.fault.tag, kind: "bit" } : { tag: inst + "_errCode", kind: "value", value: ERR[m[2]] };
      } else switch (m[2]) {
        case "START": case "RUN": case "TRAVEL": case "POS":
          trigger = { tag: inst + "_error", kind: "bit" }; key = "err:" + d.name; break;
        case "FAULT":
          trigger = io.fault ? { tag: io.fault.tag, kind: "bit" } : { tag: inst + "_error", kind: "bit" };
          if (!io.fault) key = "err:" + d.name;
          break;
        case "OPEN":
          trigger = io.in ? { tag: io.in.tag, kind: "bitOff" } : undefined; cls = "stop"; break;
        case "HI": case "LO":
          trigger = { tag: inst + (m[2] === "HI" ? "_alarmHi" : "_alarmLo"), kind: "bit" };
          if (!Number.isFinite(m[2] === "HI" ? d.limHi : d.limLo)) cls = "warning";
          break;
      }
    }
    if (!trigger || !byName.has(trigger.tag)) {
      /* neplatné označení zařízení (mezera, diakritika…) hlásí validateProject jako chybu — HMI alarm
         vynechá, aby dokumentace nespadla; u platného projektu je to porušení invariantu */
      if (r.dev && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.dev)) continue;
      throw new Error("HMI: alarm " + r.code + " nemá spouštěcí tag");
    }
    const g = groups.get(key);
    if (g) g.rows.push(r); else groups.set(key, { rows: [r], trigger, cls, dev });
  }
  const PRIO: Record<HmiAlarmClass, number> = { fault: 1, stop: 2, warning: 3 };
  let id = 0;
  return [...groups.values()].map(g => {
    const one = g.rows.length === 1;
    const uniq = (a: string[]) => [...new Set(a)].join(" / ");
    return {
      id: ++id,
      name: one ? g.rows[0].code : "A_" + g.dev + "_ERROR",
      codes: g.rows.map(r => r.code),
      dev: g.dev,
      text: (g.dev ? g.dev + ": " : "") + uniq(g.rows.map(r => r.alarm)),
      cause: uniq(g.rows.map(r => r.cause)),
      reaction: uniq(g.rows.map(r => r.reaction)),
      ack: uniq(g.rows.map(r => r.ack)),
      cls: g.cls, priority: PRIO[g.cls], ackRequired: g.cls === "fault",
      trigger: g.trigger,
    };
  });
}

export function alarmClassLabel(c: HmiAlarmClass): string {
  return tr(c === "fault" ? N_("Porucha (kvitace)") : c === "stop" ? N_("Zastavení (blokování)") : N_("Výstraha"));
}

/* ================================================================ obrazovky */

export type HmiScreenKind = "overview" | "manual" | "alarms" | "sequence" | "params";
export const HMI_SCREEN_KINDS: HmiScreenKind[] = ["overview", "manual", "sequence", "alarms", "params"];
const SCREEN_TITLE: Record<HmiScreenKind, string> = {
  overview: N_("Přehled stroje"), manual: N_("Ruční režim"), sequence: N_("Sekvence"), alarms: N_("Alarmy"), params: N_("Parametry"),
};
export function screenTitle(k: HmiScreenKind): string { return tr(SCREEN_TITLE[k]); }

export type HmiCell = { t: string } | { tag: string; unit?: string };

/** Prvek obrazovky — jedna geometrie pro SVG náhled, webové HMI i JSON popis. */
export interface HmiElem {
  k: "header" | "nav" | "motor" | "valve" | "analog" | "aout" | "di" | "do" | "button" | "lamp" | "value" | "text" | "steps" | "alarmview" | "table" | "manrow";
  x: number; y: number; w: number; h: number;
  label?: string;
  sub?: string;
  dev?: string;
  /** Vazby na tagy HMI podle role (run, busy, err, open, value, on, hi, lo, cmd, status…). */
  tags?: Record<string, string>;
  unit?: string;
  min?: number; max?: number; limHi?: number; limLo?: number;
  /** Tlačítko: momentary / toggle. */
  cmd?: "momentary" | "toggle";
  /** Signálka: barva aktivního stavu. */
  color?: "green" | "red" | "yellow" | "blue";
  /** Přechod na obrazovku (navigace). */
  screen?: string;
  /** steps: řádky [hodnota kroku, text]. */
  steps?: Array<{ value: number; text: string; sub: string }>;
  /** table: hlavička a řádky. */
  head?: string[];
  rows?: HmiCell[][];
  cols?: number[];
  /** alarmview: náhledové řádky. */
  alarms?: Array<{ id: number; text: string; cls: HmiAlarmClass }>;
  /** DI: role vstupu (E-stop / blokování) pro barvu. */
  role?: "estop" | "interlock";
}

export interface HmiScreen {
  id: string;
  kind: HmiScreenKind;
  title: string;
  page: number;
  pages: number;
  W: number; H: number;
  elems: HmiElem[];
}

export interface HmiModel {
  project: string;
  tags: HmiTag[];
  alarms: HmiAlarm[];
  screens: HmiScreen[];
}

export const HMI_W = 1024, HMI_H = 600;
const TOP = 56, BOTTOM = 548;

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out.length ? out : [[]];
}

function frame(prj: Project, kind: HmiScreenKind, page: number, pages: number, has: Set<string>, firstIds: Record<HmiScreenKind, string>): HmiElem[] {
  const title = screenTitle(kind) + (pages > 1 ? " " + page + "/" + pages : "");
  const tags: Record<string, string> = {};
  if (has.has("modeAuto")) tags.auto = "modeAuto";
  if (has.has("machineFault")) tags.fault = "machineFault";
  if (has.has("seqStep")) tags.step = "seqStep";
  tags.enable = "enable";
  const el: HmiElem[] = [{ k: "header", x: 0, y: 0, w: HMI_W, h: 48, label: prj.meta.name || "PLCdesk", sub: title, tags }];
  const navW = Math.floor(HMI_W / HMI_SCREEN_KINDS.length);
  HMI_SCREEN_KINDS.forEach((k, i) => el.push({ k: "nav", x: i * navW + 2, y: BOTTOM + 6, w: navW - 4, h: HMI_H - BOTTOM - 10, label: screenTitle(k), screen: firstIds[k] }));
  /* listování mezi stránkami téže obrazovky */
  if (pages > 1) {
    const id = (p: number) => kind + (p > 1 ? "_" + p : "");
    if (page > 1) el.push({ k: "nav", x: HMI_W - 196, y: 8, w: 40, h: 32, label: "<", screen: id(page - 1) });
    if (page < pages) el.push({ k: "nav", x: HMI_W - 150, y: 8, w: 40, h: 32, label: ">", screen: id(page + 1) });
  }
  return el;
}

function fmtNum(v: number | undefined): string {
  return Number.isFinite(v) ? String(v) : "—";
}

/** Obrazovky HMI (stránkované): Přehled, Ruční režim, Sekvence, Alarmy, Parametry. */
export function hmiScreens(prj: Project, tags: HmiTag[] = hmiTags(prj), alarms: HmiAlarm[] = hmiAlarms(prj, tags)): HmiScreen[] {
  const has = new Set(tags.map(t => t.name));
  const T = (n: string) => has.has(n) ? n : undefined;
  const pick = (o: Record<string, string | undefined>) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (v) r[k] = v;
    return r;
  };
  const pagesOf: Array<{ kind: HmiScreenKind; pages: HmiElem[][] }> = [];

  /* --- Přehled: mimiky zařízení podle tříd, mřížka 8 × 5 --- */
  const order = ["Motor", "Vfd", "PosDrive", "Axis", "Ventil", "PropValve", "AnalogIn", "AnalogOut", "DI", "DO"];
  const devs = [...prj.devices].sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls));
  const estop = prj.program.estop, locked = new Set(interlockDevs(prj).map(d => d.id));
  const tile = (d: Device, x: number, y: number): HmiElem => {
    const inst = instName(d), io = ioOf(prj, d), base = { x, y, w: 120, h: 88, label: d.name, sub: d.desc || "", dev: d.name };
    if (d.cls === "Motor") return { k: "motor", ...base, tags: pick({ run: T(inst + "_outRun"), fbk: io.fbkRunning && T(io.fbkRunning.tag), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
    /* pohony fáze 2a: měnič a polohovací pohon jako pohon (chod / v poloze), proporcionální ventil jako žádaná hodnota */
    if (d.cls === "Vfd") return { k: "motor", ...base, tags: pick({ run: T(inst + "_outRun"), fbk: T(inst + "_inSpeed"), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
    if (d.cls === "PosDrive") return { k: "motor", ...base, tags: pick({ run: T(inst + "_done"), fbk: io.homed && T(io.homed.tag), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
    if (d.cls === "PropValve") return { k: "aout", ...base, unit: d.unit, min: d.rmin, max: d.rmax, tags: pick({ value: T(inst + (io.rawAct ? "_value" : "_spAct")) }) };
    /* servoosa: jako pohon (osa jede / referováno) */
    if (d.cls === "Axis") return { k: "motor", ...base, tags: pick({ run: T(inst + "_moving"), fbk: T(inst + "_homed"), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
    if (d.cls === "Ventil") return { k: "valve", ...base, tags: pick({ open: T(inst + "_outOpen"), fbkOpen: io.fbkOpen && T(io.fbkOpen.tag), fbkClosed: io.fbkClosed && T(io.fbkClosed.tag), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
    if (d.cls === "AnalogIn") return { k: "analog", ...base, unit: d.unit, min: d.rmin, max: d.rmax, limHi: d.limHi, limLo: d.limLo, tags: pick({ value: T(inst + "_value"), hi: T(inst + "_alarmHi"), lo: T(inst + "_alarmLo") }) };
    if (d.cls === "AnalogOut") return { k: "aout", ...base, unit: d.unit, min: d.rmin, max: d.rmax, tags: pick({ value: T(inst + "_value") }) };
    if (d.cls === "DI") return { k: "di", ...base, role: d.id === estop ? "estop" : locked.has(d.id) ? "interlock" : undefined, tags: pick({ on: io.in && T(io.in.tag) }) };
    return { k: "do", ...base, color: d.role === "fault" ? "red" : d.role === "run" || d.role === "ready" ? "green" : d.role === "stopped" ? "red" : "yellow", tags: pick({ on: io.out && T(io.out.tag) }) };
  };
  pagesOf.push({
    kind: "overview",
    pages: chunk(devs, 40).map(list => list.map((d, i) => tile(d, 8 + (i % 8) * 126, TOP + 4 + Math.floor(i / 8) * 96))),
  });

  /* --- Ruční režim: přepínač AUTO, kvitace, řádek na pohon (2 sloupce × 11) --- */
  const acts = actuators(prj);
  const ctrlRow = (y: number): HmiElem[] => {
    const e: HmiElem[] = [];
    let x = 8;
    if (has.has("modeAuto")) { e.push({ k: "button", x, y, w: 180, h: 36, label: tr("AUTO / RUČNĚ"), cmd: "toggle", tags: { cmd: "modeAuto" } }); x += 188; }
    if (has.has("cmdAutoStart")) { e.push({ k: "button", x, y, w: 140, h: 36, label: tr("START"), cmd: "momentary", tags: { cmd: "cmdAutoStart" } }); x += 148; }
    if (has.has("cmdAck")) { e.push({ k: "button", x, y, w: 140, h: 36, label: tr("KVITACE"), cmd: "momentary", tags: { cmd: "cmdAck" } }); x += 148; }
    if (has.has("machineFault")) { e.push({ k: "lamp", x, y, w: 180, h: 36, label: tr("Porucha stroje"), color: "red", tags: { on: "machineFault" } }); x += 188; }
    e.push({ k: "lamp", x, y, w: 180, h: 36, label: tr("Uvolnění"), color: "green", tags: { on: "enable" } });
    return e;
  };
  pagesOf.push({
    kind: "manual",
    pages: chunk(acts, 22).map(list => [
      ...ctrlRow(TOP + 4),
      ...(list.length ? list.map((d, i): HmiElem => {
        const inst = instName(d);
        return {
          k: "manrow", x: 8 + Math.floor(i / 11) * 504, y: TOP + 50 + (i % 11) * 40, w: 496, h: 36, label: d.name, sub: d.desc || "", dev: d.name,
          cmd: "toggle",
          tags: pick({ cmd: T(manVarOf(d)), run: T(inst + (d.cls === "Motor" || d.cls === "Vfd" ? "_outRun" : d.cls === "PosDrive" ? "_done" : d.cls === "PropValve" ? "_inTol" : d.cls === "Axis" ? "_powered" : "_outOpen")), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }),
        };
      }) : [{ k: "text" as const, x: 8, y: TOP + 60, w: 600, h: 24, label: tr("Projekt nemá zařízení s ručním povelem.") }]),
    ]),
  });

  /* --- Sekvence: stav, ovládání, seznam kroků (2 sloupce × 16) --- */
  const steps = prj.program.seq.map((s, i) => {
    const wd = stepWatchdog(prj, s);
    return { value: 10 + i * 10, text: tr("Krok {n}: {title}", { n: i + 1, title: stepTitle(prj, s) }), sub: stepCondText(prj, s) + (wd ? " · " + tr("hlídací čas {t} s", { t: wd }) : "") };
  });
  pagesOf.push({
    kind: "sequence",
    pages: chunk(steps, 32).map(list => [
      ...ctrlRow(TOP + 4),
      ...(has.has("seqStep") ? [
        { k: "value" as const, x: 8, y: TOP + 48, w: 496, h: 28, label: tr("Aktuální krok"), tags: { value: "seqStep" } },
        ...(has.has("faultStep") ? [{ k: "value" as const, x: 512, y: TOP + 48, w: 496, h: 28, label: tr("Krok s vypršeným hlídacím časem"), tags: { value: "faultStep" } }] : []),
        ...chunk(list, 16).map((col, ci): HmiElem => ({ k: "steps", x: 8 + ci * 504, y: TOP + 84, w: 496, h: col.length * 25, steps: col, tags: { step: "seqStep" } })),
      ] : [{ k: "text" as const, x: 8, y: TOP + 60, w: 600, h: 24, label: tr("Bez automatické sekvence — pouze ruční režim.") }]),
    ]),
  });

  /* --- Alarmy: živý seznam (náhled = nakonfigurované alarmy), kvitace --- */
  pagesOf.push({
    kind: "alarms",
    pages: [[
      { k: "alarmview", x: 8, y: TOP + 4, w: HMI_W - 16, h: 420, alarms: alarms.slice(0, 16).map(a => ({ id: a.id, text: a.text, cls: a.cls })), label: tr("Aktivní alarmy") },
      ...(has.has("cmdAck") ? [{ k: "button" as const, x: 8, y: TOP + 432, w: 180, h: 48, label: tr("KVITACE"), cmd: "momentary" as const, tags: { cmd: "cmdAck" } }] : []),
      { k: "text", x: 200, y: TOP + 448, w: 800, h: 24, label: tr("Nakonfigurováno alarmů: {n} (kódy dle seznamu alarmů {file})", { n: alarms.length, file: "04_seznam_alarmu.csv" }) },
    ]],
  });

  /* --- Parametry: meze, rozsahy, žádané hodnoty, hlídací časy, takt (16 řádků na stránku) --- */
  const rows: HmiCell[][] = [];
  const cst = tr("konstanta programu");
  for (const d of prj.devices) {
    const inst = instName(d), u = d.unit || "";
    if (d.cls === "AnalogIn") {
      rows.push([{ t: d.name }, { t: tr("Rozsah měření") }, { t: fmtNum(d.rmin) + " … " + fmtNum(d.rmax) }, { t: u }, { t: cst }]);
      if (Number.isFinite(d.limHi)) rows.push([{ t: d.name }, { t: tr("Horní mez") }, T(inst + "_limitHi") ? { tag: inst + "_limitHi", unit: u } : { t: fmtNum(d.limHi) }, { t: u }, { t: cst }]);
      if (Number.isFinite(d.limLo)) rows.push([{ t: d.name }, { t: tr("Dolní mez") }, T(inst + "_limitLo") ? { tag: inst + "_limitLo", unit: u } : { t: fmtNum(d.limLo) }, { t: u }, { t: cst }]);
    } else if (d.cls === "AnalogOut") {
      rows.push([{ t: d.name }, { t: tr("Žádaná hodnota") }, T(inst + "_value") ? { tag: inst + "_value", unit: u } : { t: fmtNum(d.setpoint) }, { t: u }, { t: cst }]);
    } else if (d.cls === "Motor") {
      rows.push([{ t: d.name }, { t: tr("Hlídací čas rozběhu") }, { t: String(T_MOTOR_FBK) }, { t: "s" }, { t: tr("blok FB_Motor") }]);
    } else if (d.cls === "Ventil") {
      rows.push([{ t: d.name }, { t: tr("Hlídací čas přestavení") }, { t: String(T_VALVE_TRAVEL) }, { t: "s" }, { t: tr("blok FB_Ventil") }]);
    } else if (d.cls === "Vfd") {
      rows.push([{ t: d.name }, { t: tr("Rozsah žádané otáček") }, { t: fmtNum(d.rmin) + " … " + fmtNum(d.rmax) }, { t: u }, { t: cst }]);
      rows.push([{ t: d.name }, { t: tr("Rampa v PLC (celý rozsah)") }, { t: rampStepOf(d) ? String(d.rampS) : "—" }, { t: "s" }, { t: cst }]);
      rows.push([{ t: d.name }, { t: tr("Otáčky dosaženy do (po rampě)") }, { t: String(T_VFD_SPEED) }, { t: "s" }, { t: tr("blok FB_Vfd") }]);
    } else if (d.cls === "PosDrive") {
      rows.push([{ t: d.name }, { t: tr("Výběr záznamu") }, { t: tr("{bits} bity, záznamy 1–{max}", { bits: selBitsOf(d), max: maxRecord(d) }) }, { t: "" }, { t: tr("nastavení v pohonu") }]);
      for (const r of d.records || []) rows.push([{ t: d.name }, { t: tr("Záznam {n}: {name}", { n: r.no, name: r.name || "" }) }, { t: fmtNum(r.pos) }, { t: "" }, { t: tr("nastavení v pohonu") }]);
      rows.push([{ t: d.name }, { t: tr("Potvrzení startu / jízda nejvýš") }, { t: T_POS_ACK + " / " + T_POS_MOVE }, { t: "s" }, { t: tr("blok FB_PosDrive") }]);
    } else if (d.cls === "Axis") {
      const c = axisCfgOf(d);
      rows.push([{ t: d.name }, { t: tr("Max. rychlost / zrychlení / zpomalení") }, { t: c.vMax + " / " + c.aMax + " / " + c.dMax }, { t: u + "/s, /s²" }, { t: tr("konfigurace osy v IDE") }]);
      rows.push([{ t: d.name }, { t: tr("Softwarové limity") }, { t: fmtNum(c.limNeg) + " … " + fmtNum(c.limPos) }, { t: u }, { t: tr("konfigurace osy v IDE") }]);
      for (const x of c.positions) rows.push([{ t: d.name }, { t: tr("Poloha {name}", { name: x.name }) }, { t: fmtNum(x.pos) }, { t: u }, { t: cst }]);
      rows.push([{ t: d.name }, { t: tr("Regulace zapnuta do") }, { t: String(T_AXIS_POWER) }, { t: "s" }, { t: tr("blok FB_Axis") }]);
    } else if (d.cls === "PropValve") {
      rows.push([{ t: d.name }, { t: tr("Rozsah žádané hodnoty") }, { t: fmtNum(d.rmin) + " … " + fmtNum(d.rmax) }, { t: u }, { t: cst }]);
      rows.push([{ t: d.name }, { t: tr("Rampa v PLC (celý rozsah)") }, { t: rampStepOf(d) ? String(d.rampS) : "—" }, { t: "s" }, { t: cst }]);
      if (ioOf(prj, d).rawAct) {
        rows.push([{ t: d.name }, { t: tr("Povolená odchylka") }, { t: "± " + tolOf(d) }, { t: u }, { t: cst }]);
        rows.push([{ t: d.name }, { t: tr("Doba odchylky do poruchy") }, { t: String(tolTicksOf(d) / 10) }, { t: "s" }, { t: cst }]);
      }
      rows.push([{ t: d.name }, { t: tr("Žádaná dosažena do (po rampě)") }, { t: String(T_PROP_SETTLE) }, { t: "s" }, { t: tr("blok FB_PropValve") }]);
    }
  }
  prj.program.seq.forEach((s, i) => {
    const wd = stepWatchdog(prj, s);
    if (wd) rows.push([{ t: tr("Krok {n}", { n: i + 1 }) }, { t: tr("Hlídací čas kroku") }, { t: String(wd) }, { t: "s" }, { t: cst }]);
    else if (s.act === "wait" || s.cond === "time") rows.push([{ t: tr("Krok {n}", { n: i + 1 }) }, { t: tr("Čas kroku") }, { t: String(s.timeS || 1) }, { t: "s" }, { t: cst }]);
  });
  if (prj.meta.takt) rows.push([{ t: "—" }, { t: tr("Požadovaný takt") }, { t: String(prj.meta.takt) }, { t: "s" }, { t: tr("ověřuje simulace") }]);
  const head = [tr("Zařízení"), tr("Parametr"), tr("Hodnota"), tr("Jednotka"), tr("Zdroj")];
  pagesOf.push({
    kind: "params",
    pages: chunk(rows, 16).map(list => [
      { k: "table", x: 8, y: TOP + 4, w: HMI_W - 16, h: 26 * (list.length + 1), head, rows: list.length ? list : [[{ t: "—" }, { t: tr("žádné parametry") }, { t: "" }, { t: "" }, { t: "" }]], cols: [140, 330, 170, 110, 258] },
      { k: "text", x: 8, y: BOTTOM - 30, w: 1000, h: 20, label: tr("Hodnoty jsou konstanty generovaného programu — změna = úprava programu a nové ověření.") },
    ]),
  });

  const firstIds = {} as Record<HmiScreenKind, string>;
  for (const p of pagesOf) firstIds[p.kind] = p.kind;
  const out: HmiScreen[] = [];
  for (const kind of HMI_SCREEN_KINDS) {
    const p = pagesOf.find(x => x.kind === kind)!;
    p.pages.forEach((elems, i) => {
      out.push({
        id: kind + (i ? "_" + (i + 1) : ""), kind, title: screenTitle(kind), page: i + 1, pages: p.pages.length, W: HMI_W, H: HMI_H,
        elems: [...frame(prj, kind, i + 1, p.pages.length, has, firstIds), ...elems],
      });
    });
  }
  return out;
}

/** Celý model HMI projektu. */
export function buildHmi(prj: Project): HmiModel {
  const tags = hmiTags(prj);
  const alarms = hmiAlarms(prj, tags);
  return { project: prj.meta.name || "", tags, alarms, screens: hmiScreens(prj, tags, alarms) };
}

/* ================================================================ adresy v PLC */

/** Program Logix, do kterého generátor dává programové tagy (logix.ts `LX_PROGRAM`). */
const LX_PROG = "PLCdesk";

/**
 * Symbolická cesta tagu HMI v programu cílové platformy:
 * Siemens `"InstMachine".instM1.status` / `"M1_outRun"`, CODESYS rodina `MAIN.x` / `GVL_IO.x`,
 * Rockwell `Program:PLCdesk.x` / `x`, Unitronics plochý tag `instM1_status`, Mitsubishi a Omron
 * globální proměnná `modeAuto` / `instM1_status` (GOT a NA čtou jen globální — generátor je tam
 * deklaruje v GlobalLabels.csv / Variables.txt a stav bloků do nich zrcadlí, `hmiGlobalVars`).
 */
export function hmiPlcPath(plat: PlatformKey, t: HmiTag, prj?: Project): string {
  if (t.src === "io") {
    if (plat === "siemens") return '"' + t.member + '"';
    if (isCodesysFamily(plat)) return "GVL_IO." + t.member;
    return t.member;
  }
  if (plat === "siemens") return '"InstMachine".' + t.member;
  if (plat === "rockwell") return "Program:" + LX_PROG + "." + t.member;
  if (plat === "unitronics" || hmiGlobalPlat(plat)) return t.member.replace(/\./g, "_");
  /* styl OOP: stav bloku jsou vlastnosti rozhraní I_Device (codegen_oop.ts) — error → Fault, busy → Busy, status → Status */
  if (prj && codeStyleFor(prj, plat) === "oop") return "MAIN." + t.member.replace(/\.(error|busy|status)$/, (_m, x: string) => "." + (x === "error" ? "Fault" : x === "busy" ? "Busy" : "Status"));
  return "MAIN." + t.member;
}

/** ASCII pro formáty, které Unicode nesnesou (CSV pro starší HMI, identifikátory). */
export function hmiAscii(s: string): string {
  return stripDia(s).replace(/[—–]/g, "-").replace(/°/g, "deg").replace(/[„“”«»]/g, '"').replace(/[‚‘’]/g, "'")
    .replace(/…/g, "...").replace(/·/g, "|").replace(/→/g, "->").replace(/×/g, "x").replace(/[^\x00-\x7F]/g, "?");
}

/** Tag HMI podle názvu. */
export function hmiTag(m: HmiModel, name: string): HmiTag | undefined { return m.tags.find(t => t.name === name); }

/** Zařízení elementu (pro odkazy v UI). */
export function hmiElemDevice(prj: Project, e: HmiElem): Device | undefined {
  return e.dev ? prj.devices.find(d => d.name === e.dev) : undefined;
}
