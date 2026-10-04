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
import { ioOf, instName, stripDia, interlockDevs, isCodesysFamily, codeStyleFor } from "./model.js";
import { tr, N_ } from "./i18n.js";
import { ctrlDecls, actuators, manVarOf, parseFbTemplate, hmiGlobalPlat, ST_MOTOR, ST_VENTIL, ST_AI, ST_AO } from "./codegen.js";
import { docAlarmCsv } from "./docs.js";
import { stepTitle, stepCondText, stepWatchdog, T_MOTOR_FBK, T_VALVE_TRAVEL } from "./sim.js";
const STATUS_STATES = () => [
    { value: 0, text: tr("v pořádku") },
    { value: 0x8001, text: tr("blokováno (uvolnění)") },
    { value: 0x8002, text: tr("porucha") },
];
/** Názvy proměnných, které generátor deklaruje ve strojním bloku (řízení stroje). */
export function hmiCtrlNames(prj) {
    const s = new Set(["enable"]);
    for (const line of ctrlDecls(prj, "codesys").split("\n")) {
        const m = line.match(/^\s*(\w+)\s*:/);
        if (m)
            s.add(m[1]);
    }
    return s;
}
/** Proměnné šablony bloku třídy (vstupy, výstupy) — HMI smí číst jen to, co šablona má. */
function fbVars(cls) {
    const tpl = cls === "Motor" ? ST_MOTOR : cls === "Ventil" ? ST_VENTIL : cls === "AnalogIn" ? ST_AI : cls === "AnalogOut" ? ST_AO : "";
    return new Set(tpl ? parseFbTemplate(tpl).vars.filter(v => v.kind !== "var").map(v => v.name) : []);
}
function stepStates(prj) {
    return [{ value: 0, text: tr("čekání na start") },
        ...prj.program.seq.map((s, i) => ({ value: 10 + i * 10, text: tr("Krok {n}: {title}", { n: i + 1, title: stepTitle(prj, s) }) }))];
}
/** Tagy HMI odvozené z projektu (pořadí: řízení, sekvence, zařízení, analogy, I/O, parametry). */
export function hmiTags(prj) {
    const out = [];
    const ctrl = hmiCtrlNames(prj);
    const M = (member, type, group, desc, o = {}) => {
        out.push({ name: member.replace(/\./g, "_"), src: "machine", member, type, access: "R", group, desc, ...o });
    };
    M("enable", "BOOL", "ctrl", tr("Centrální uvolnění (E-stop a blokování v pořádku)"));
    if (ctrl.has("modeAuto"))
        M("modeAuto", "BOOL", "ctrl", tr("Režim AUTO (FALSE = ruční režim)"), { access: "RW", cmd: "toggle" });
    if (ctrl.has("cmdAutoStart"))
        M("cmdAutoStart", "BOOL", "ctrl", tr("Start automatického cyklu"), { access: "RW", cmd: "momentary" });
    if (ctrl.has("cmdAck"))
        M("cmdAck", "BOOL", "ctrl", tr("Kvitace poruchy"), { access: "RW", cmd: "momentary" });
    if (ctrl.has("machineFault"))
        M("machineFault", "BOOL", "ctrl", tr("Porucha stroje (drží do kvitace)"));
    if (ctrl.has("seqStep"))
        M("seqStep", "INT", "seq", tr("Aktuální krok sekvence"), { states: stepStates(prj) });
    if (ctrl.has("faultStep"))
        M("faultStep", "INT", "seq", tr("Krok sekvence, ve kterém vypršel hlídací čas"), { states: stepStates(prj) });
    for (const d of actuators(prj)) {
        const inst = instName(d), v = fbVars(d.cls), dev = d.name;
        if (ctrl.has(manVarOf(d)))
            M(manVarOf(d), "BOOL", "dev", d.cls === "Motor" ? tr("{dev}: ruční povel chod (platí mimo AUTO)", { dev }) : tr("{dev}: ruční povel otevřít (platí mimo AUTO)", { dev }), { access: "RW", cmd: "toggle", dev });
        const outV = d.cls === "Motor" ? "outRun" : "outOpen";
        if (v.has(outV))
            M(inst + "." + outV, "BOOL", "dev", d.cls === "Motor" ? tr("{dev}: povel chod (výstup bloku)", { dev }) : tr("{dev}: povel otevřít (výstup bloku)", { dev }), { dev });
        if (v.has("busy"))
            M(inst + ".busy", "BOOL", "dev", d.cls === "Motor" ? tr("{dev}: rozbíhá se", { dev }) : tr("{dev}: přestavuje se", { dev }), { dev });
        if (v.has("error"))
            M(inst + ".error", "BOOL", "dev", tr("{dev}: porucha bloku", { dev }), { dev });
        if (v.has("status"))
            M(inst + ".status", "WORD", "dev", tr("{dev}: stavové slovo bloku", { dev }), { dev, states: STATUS_STATES() });
    }
    for (const d of prj.devices) {
        const inst = instName(d), dev = d.name, v = fbVars(d.cls);
        const unit = d.unit || undefined;
        if (d.cls === "AnalogIn") {
            M(inst + ".value", "REAL", "ana", tr("{dev}: měřená hodnota", { dev }) + (d.desc ? " — " + d.desc : ""), { dev, unit, min: d.rmin, max: d.rmax });
            if (v.has("alarmHi"))
                M(inst + ".alarmHi", "BOOL", "ana", tr("{dev}: překročena horní mez", { dev }), { dev });
            if (v.has("alarmLo"))
                M(inst + ".alarmLo", "BOOL", "ana", tr("{dev}: podkročena dolní mez", { dev }), { dev });
            if (Number.isFinite(d.limHi))
                M(inst + ".limitHi", "REAL", "par", tr("{dev}: horní mez (konstanta programu)", { dev }), { dev, unit });
            if (Number.isFinite(d.limLo))
                M(inst + ".limitLo", "REAL", "par", tr("{dev}: dolní mez (konstanta programu)", { dev }), { dev, unit });
        }
        else if (d.cls === "AnalogOut") {
            M(inst + ".value", "REAL", "ana", tr("{dev}: žádaná hodnota (konstanta programu)", { dev }) + (d.desc ? " — " + d.desc : ""), { dev, unit, min: d.rmin, max: d.rmax });
        }
    }
    /* signály I/O: hlášení pohonů, snímače, blokování, signálky (vše jen ke čtení) */
    const estop = prj.program.estop;
    const locked = new Set(interlockDevs(prj).map(d => d.id));
    for (const d of prj.devices) {
        const io = ioOf(prj, d);
        const pick = d.cls === "Motor" ? ["fbkRunning", "fault"] : d.cls === "Ventil" ? ["fbkOpen", "fbkClosed"] : d.cls === "DI" ? ["in"] : d.cls === "DO" ? ["out"] : [];
        for (const sig of pick) {
            const e = io[sig];
            if (!e)
                continue;
            const what = d.id === estop ? tr("nouzové zastavení (TRUE = v pořádku)") : locked.has(d.id) ? tr("blokování (TRUE = v pořádku)") : (e.cmt || d.desc || sig);
            out.push({ name: e.tag, src: "io", member: e.tag, type: "BOOL", access: "R", group: "io", dev: d.name, desc: d.name + ": " + what });
        }
    }
    return out;
}
/** Řádky seznamu alarmů z dokumentace (`docAlarmCsv`) — tytéž kódy a texty. */
export function alarmRows(prj) {
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
export function hmiAlarms(prj, tags = hmiTags(prj)) {
    const byName = new Set(tags.map(t => t.name));
    const groups = new Map();
    for (const r of alarmRows(prj)) {
        const m = r.code.match(/^A_(\w+?)_(START|RUN|FAULT|TRAVEL|POS|OPEN|HI|LO)$/);
        const seq = r.code.match(/^A_SEQ_(\d+)$/);
        let trigger, cls = "fault", dev = r.dev, key = r.code;
        if (seq) {
            trigger = { tag: "faultStep", kind: "value", value: 10 + (+seq[1] - 1) * 10 };
        }
        else if (m) {
            const d = prj.devices.find(x => x.name === m[1]);
            if (!d)
                continue;
            dev = d.name;
            const inst = instName(d), io = ioOf(prj, d);
            switch (m[2]) {
                case "START":
                case "RUN":
                case "TRAVEL":
                case "POS":
                    trigger = { tag: inst + "_error", kind: "bit" };
                    key = "err:" + d.name;
                    break;
                case "FAULT":
                    trigger = io.fault ? { tag: io.fault.tag, kind: "bit" } : { tag: inst + "_error", kind: "bit" };
                    if (!io.fault)
                        key = "err:" + d.name;
                    break;
                case "OPEN":
                    trigger = io.in ? { tag: io.in.tag, kind: "bitOff" } : undefined;
                    cls = "stop";
                    break;
                case "HI":
                case "LO":
                    trigger = { tag: inst + (m[2] === "HI" ? "_alarmHi" : "_alarmLo"), kind: "bit" };
                    if (!Number.isFinite(m[2] === "HI" ? d.limHi : d.limLo))
                        cls = "warning";
                    break;
            }
        }
        if (!trigger || !byName.has(trigger.tag))
            throw new Error("HMI: alarm " + r.code + " nemá spouštěcí tag");
        const g = groups.get(key);
        if (g)
            g.rows.push(r);
        else
            groups.set(key, { rows: [r], trigger, cls, dev });
    }
    const PRIO = { fault: 1, stop: 2, warning: 3 };
    let id = 0;
    return [...groups.values()].map(g => {
        const one = g.rows.length === 1;
        const uniq = (a) => [...new Set(a)].join(" / ");
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
export function alarmClassLabel(c) {
    return tr(c === "fault" ? N_("Porucha (kvitace)") : c === "stop" ? N_("Zastavení (blokování)") : N_("Výstraha"));
}
export const HMI_SCREEN_KINDS = ["overview", "manual", "sequence", "alarms", "params"];
const SCREEN_TITLE = {
    overview: N_("Přehled stroje"), manual: N_("Ruční režim"), sequence: N_("Sekvence"), alarms: N_("Alarmy"), params: N_("Parametry"),
};
export function screenTitle(k) { return tr(SCREEN_TITLE[k]); }
export const HMI_W = 1024, HMI_H = 600;
const TOP = 56, BOTTOM = 548;
function chunk(a, n) {
    const out = [];
    for (let i = 0; i < a.length; i += n)
        out.push(a.slice(i, i + n));
    return out.length ? out : [[]];
}
function frame(prj, kind, page, pages, has, firstIds) {
    const title = screenTitle(kind) + (pages > 1 ? " " + page + "/" + pages : "");
    const tags = {};
    if (has.has("modeAuto"))
        tags.auto = "modeAuto";
    if (has.has("machineFault"))
        tags.fault = "machineFault";
    if (has.has("seqStep"))
        tags.step = "seqStep";
    tags.enable = "enable";
    const el = [{ k: "header", x: 0, y: 0, w: HMI_W, h: 48, label: prj.meta.name || "PLCdesk", sub: title, tags }];
    const navW = Math.floor(HMI_W / HMI_SCREEN_KINDS.length);
    HMI_SCREEN_KINDS.forEach((k, i) => el.push({ k: "nav", x: i * navW + 2, y: BOTTOM + 6, w: navW - 4, h: HMI_H - BOTTOM - 10, label: screenTitle(k), screen: firstIds[k] }));
    /* listování mezi stránkami téže obrazovky */
    if (pages > 1) {
        const id = (p) => kind + (p > 1 ? "_" + p : "");
        if (page > 1)
            el.push({ k: "nav", x: HMI_W - 196, y: 8, w: 40, h: 32, label: "<", screen: id(page - 1) });
        if (page < pages)
            el.push({ k: "nav", x: HMI_W - 150, y: 8, w: 40, h: 32, label: ">", screen: id(page + 1) });
    }
    return el;
}
function fmtNum(v) {
    return Number.isFinite(v) ? String(v) : "—";
}
/** Obrazovky HMI (stránkované): Přehled, Ruční režim, Sekvence, Alarmy, Parametry. */
export function hmiScreens(prj, tags = hmiTags(prj), alarms = hmiAlarms(prj, tags)) {
    const has = new Set(tags.map(t => t.name));
    const T = (n) => has.has(n) ? n : undefined;
    const pick = (o) => {
        const r = {};
        for (const [k, v] of Object.entries(o))
            if (v)
                r[k] = v;
        return r;
    };
    const pagesOf = [];
    /* --- Přehled: mimiky zařízení podle tříd, mřížka 8 × 5 --- */
    const order = ["Motor", "Ventil", "AnalogIn", "AnalogOut", "DI", "DO"];
    const devs = [...prj.devices].sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls));
    const estop = prj.program.estop, locked = new Set(interlockDevs(prj).map(d => d.id));
    const tile = (d, x, y) => {
        const inst = instName(d), io = ioOf(prj, d), base = { x, y, w: 120, h: 88, label: d.name, sub: d.desc || "", dev: d.name };
        if (d.cls === "Motor")
            return { k: "motor", ...base, tags: pick({ run: T(inst + "_outRun"), fbk: io.fbkRunning && T(io.fbkRunning.tag), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
        if (d.cls === "Ventil")
            return { k: "valve", ...base, tags: pick({ open: T(inst + "_outOpen"), fbkOpen: io.fbkOpen && T(io.fbkOpen.tag), fbkClosed: io.fbkClosed && T(io.fbkClosed.tag), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }) };
        if (d.cls === "AnalogIn")
            return { k: "analog", ...base, unit: d.unit, min: d.rmin, max: d.rmax, limHi: d.limHi, limLo: d.limLo, tags: pick({ value: T(inst + "_value"), hi: T(inst + "_alarmHi"), lo: T(inst + "_alarmLo") }) };
        if (d.cls === "AnalogOut")
            return { k: "aout", ...base, unit: d.unit, min: d.rmin, max: d.rmax, tags: pick({ value: T(inst + "_value") }) };
        if (d.cls === "DI")
            return { k: "di", ...base, role: d.id === estop ? "estop" : locked.has(d.id) ? "interlock" : undefined, tags: pick({ on: io.in && T(io.in.tag) }) };
        return { k: "do", ...base, color: d.role === "fault" ? "red" : d.role === "run" || d.role === "ready" ? "green" : d.role === "stopped" ? "red" : "yellow", tags: pick({ on: io.out && T(io.out.tag) }) };
    };
    pagesOf.push({
        kind: "overview",
        pages: chunk(devs, 40).map(list => list.map((d, i) => tile(d, 8 + (i % 8) * 126, TOP + 4 + Math.floor(i / 8) * 96))),
    });
    /* --- Ruční režim: přepínač AUTO, kvitace, řádek na pohon (2 sloupce × 11) --- */
    const acts = actuators(prj);
    const ctrlRow = (y) => {
        const e = [];
        let x = 8;
        if (has.has("modeAuto")) {
            e.push({ k: "button", x, y, w: 180, h: 36, label: tr("AUTO / RUČNĚ"), cmd: "toggle", tags: { cmd: "modeAuto" } });
            x += 188;
        }
        if (has.has("cmdAutoStart")) {
            e.push({ k: "button", x, y, w: 140, h: 36, label: tr("START"), cmd: "momentary", tags: { cmd: "cmdAutoStart" } });
            x += 148;
        }
        if (has.has("cmdAck")) {
            e.push({ k: "button", x, y, w: 140, h: 36, label: tr("KVITACE"), cmd: "momentary", tags: { cmd: "cmdAck" } });
            x += 148;
        }
        if (has.has("machineFault")) {
            e.push({ k: "lamp", x, y, w: 180, h: 36, label: tr("Porucha stroje"), color: "red", tags: { on: "machineFault" } });
            x += 188;
        }
        e.push({ k: "lamp", x, y, w: 180, h: 36, label: tr("Uvolnění"), color: "green", tags: { on: "enable" } });
        return e;
    };
    pagesOf.push({
        kind: "manual",
        pages: chunk(acts, 22).map(list => [
            ...ctrlRow(TOP + 4),
            ...(list.length ? list.map((d, i) => {
                const inst = instName(d);
                return {
                    k: "manrow", x: 8 + Math.floor(i / 11) * 504, y: TOP + 50 + (i % 11) * 40, w: 496, h: 36, label: d.name, sub: d.desc || "", dev: d.name,
                    cmd: "toggle",
                    tags: pick({ cmd: T(manVarOf(d)), run: T(inst + (d.cls === "Motor" ? "_outRun" : "_outOpen")), busy: T(inst + "_busy"), err: T(inst + "_error"), status: T(inst + "_status") }),
                };
            }) : [{ k: "text", x: 8, y: TOP + 60, w: 600, h: 24, label: tr("Projekt nemá zařízení s ručním povelem.") }]),
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
                { k: "value", x: 8, y: TOP + 48, w: 496, h: 28, label: tr("Aktuální krok"), tags: { value: "seqStep" } },
                ...(has.has("faultStep") ? [{ k: "value", x: 512, y: TOP + 48, w: 496, h: 28, label: tr("Krok s vypršeným hlídacím časem"), tags: { value: "faultStep" } }] : []),
                ...chunk(list, 16).map((col, ci) => ({ k: "steps", x: 8 + ci * 504, y: TOP + 84, w: 496, h: col.length * 25, steps: col, tags: { step: "seqStep" } })),
            ] : [{ k: "text", x: 8, y: TOP + 60, w: 600, h: 24, label: tr("Bez automatické sekvence — pouze ruční režim.") }]),
        ]),
    });
    /* --- Alarmy: živý seznam (náhled = nakonfigurované alarmy), kvitace --- */
    pagesOf.push({
        kind: "alarms",
        pages: [[
                { k: "alarmview", x: 8, y: TOP + 4, w: HMI_W - 16, h: 420, alarms: alarms.slice(0, 16).map(a => ({ id: a.id, text: a.text, cls: a.cls })), label: tr("Aktivní alarmy") },
                ...(has.has("cmdAck") ? [{ k: "button", x: 8, y: TOP + 432, w: 180, h: 48, label: tr("KVITACE"), cmd: "momentary", tags: { cmd: "cmdAck" } }] : []),
                { k: "text", x: 200, y: TOP + 448, w: 800, h: 24, label: tr("Nakonfigurováno alarmů: {n} (kódy dle seznamu alarmů {file})", { n: alarms.length, file: "04_seznam_alarmu.csv" }) },
            ]],
    });
    /* --- Parametry: meze, rozsahy, žádané hodnoty, hlídací časy, takt (16 řádků na stránku) --- */
    const rows = [];
    const cst = tr("konstanta programu");
    for (const d of prj.devices) {
        const inst = instName(d), u = d.unit || "";
        if (d.cls === "AnalogIn") {
            rows.push([{ t: d.name }, { t: tr("Rozsah měření") }, { t: fmtNum(d.rmin) + " … " + fmtNum(d.rmax) }, { t: u }, { t: cst }]);
            if (Number.isFinite(d.limHi))
                rows.push([{ t: d.name }, { t: tr("Horní mez") }, T(inst + "_limitHi") ? { tag: inst + "_limitHi", unit: u } : { t: fmtNum(d.limHi) }, { t: u }, { t: cst }]);
            if (Number.isFinite(d.limLo))
                rows.push([{ t: d.name }, { t: tr("Dolní mez") }, T(inst + "_limitLo") ? { tag: inst + "_limitLo", unit: u } : { t: fmtNum(d.limLo) }, { t: u }, { t: cst }]);
        }
        else if (d.cls === "AnalogOut") {
            rows.push([{ t: d.name }, { t: tr("Žádaná hodnota") }, T(inst + "_value") ? { tag: inst + "_value", unit: u } : { t: fmtNum(d.setpoint) }, { t: u }, { t: cst }]);
        }
        else if (d.cls === "Motor") {
            rows.push([{ t: d.name }, { t: tr("Hlídací čas rozběhu") }, { t: String(T_MOTOR_FBK) }, { t: "s" }, { t: tr("blok FB_Motor") }]);
        }
        else if (d.cls === "Ventil") {
            rows.push([{ t: d.name }, { t: tr("Hlídací čas přestavení") }, { t: String(T_VALVE_TRAVEL) }, { t: "s" }, { t: tr("blok FB_Ventil") }]);
        }
    }
    prj.program.seq.forEach((s, i) => {
        const wd = stepWatchdog(prj, s);
        if (wd)
            rows.push([{ t: tr("Krok {n}", { n: i + 1 }) }, { t: tr("Hlídací čas kroku") }, { t: String(wd) }, { t: "s" }, { t: cst }]);
        else if (s.act === "wait" || s.cond === "time")
            rows.push([{ t: tr("Krok {n}", { n: i + 1 }) }, { t: tr("Čas kroku") }, { t: String(s.timeS || 1) }, { t: "s" }, { t: cst }]);
    });
    if (prj.meta.takt)
        rows.push([{ t: "—" }, { t: tr("Požadovaný takt") }, { t: String(prj.meta.takt) }, { t: "s" }, { t: tr("ověřuje simulace") }]);
    const head = [tr("Zařízení"), tr("Parametr"), tr("Hodnota"), tr("Jednotka"), tr("Zdroj")];
    pagesOf.push({
        kind: "params",
        pages: chunk(rows, 16).map(list => [
            { k: "table", x: 8, y: TOP + 4, w: HMI_W - 16, h: 26 * (list.length + 1), head, rows: list.length ? list : [[{ t: "—" }, { t: tr("žádné parametry") }, { t: "" }, { t: "" }, { t: "" }]], cols: [140, 330, 170, 110, 258] },
            { k: "text", x: 8, y: BOTTOM - 30, w: 1000, h: 20, label: tr("Hodnoty jsou konstanty generovaného programu — změna = úprava programu a nové ověření.") },
        ]),
    });
    const firstIds = {};
    for (const p of pagesOf)
        firstIds[p.kind] = p.kind;
    const out = [];
    for (const kind of HMI_SCREEN_KINDS) {
        const p = pagesOf.find(x => x.kind === kind);
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
export function buildHmi(prj) {
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
export function hmiPlcPath(plat, t, prj) {
    if (t.src === "io") {
        if (plat === "siemens")
            return '"' + t.member + '"';
        if (isCodesysFamily(plat))
            return "GVL_IO." + t.member;
        return t.member;
    }
    if (plat === "siemens")
        return '"InstMachine".' + t.member;
    if (plat === "rockwell")
        return "Program:" + LX_PROG + "." + t.member;
    if (plat === "unitronics" || hmiGlobalPlat(plat))
        return t.member.replace(/\./g, "_");
    /* styl OOP: stav bloku jsou vlastnosti rozhraní I_Device (codegen_oop.ts) — error → Fault, busy → Busy, status → Status */
    if (prj && codeStyleFor(prj, plat) === "oop")
        return "MAIN." + t.member.replace(/\.(error|busy|status)$/, (_m, x) => "." + (x === "error" ? "Fault" : x === "busy" ? "Busy" : "Status"));
    return "MAIN." + t.member;
}
/** ASCII pro formáty, které Unicode nesnesou (CSV pro starší HMI, identifikátory). */
export function hmiAscii(s) {
    return stripDia(s).replace(/[—–]/g, "-").replace(/°/g, "deg").replace(/[„“”«»]/g, '"').replace(/[‚‘’]/g, "'")
        .replace(/…/g, "...").replace(/·/g, "|").replace(/→/g, "->").replace(/×/g, "x").replace(/[^\x00-\x7F]/g, "?");
}
/** Tag HMI podle názvu. */
export function hmiTag(m, name) { return m.tags.find(t => t.name === name); }
/** Zařízení elementu (pro odkazy v UI). */
export function hmiElemDevice(prj, e) {
    return e.dev ? prj.devices.find(d => d.name === e.dev) : undefined;
}
