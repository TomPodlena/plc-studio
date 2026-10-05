import { ELEM, TYPE_ALIAS, IEC_KEYWORDS, isWidening, SRC } from "./dialects.js";
import { tr } from "../i18n.js";
import { axisInit, mcCall, lxExec } from "../axis.js";
import { AXIS_MEMBERS, AX_SIZE, MI_MEMBERS, MI_SIZE, MC_ENUMS, mcBlocks, mcPlatOf, LX_MOTION_INSTR } from "./motion.js";
import { AXIS_TYPE } from "../axis_gen.js";
/** Běhové funkce modelu os pro přeložený program (axis.ts). */
const MC_RT = { mcCall, lxExec };
/** Zdroje pravidel OOP (CODESYS / TwinCAT). */
const SRC_OOP = SRC.cdsItf, SRC_ABS = SRC.tcAbstract, SRC_PROP = SRC.cdsProp, SRC_REF = SRC.tcItfRef;
/** Atributy {attribute …} před metodou / vlastností (normalizované, seřazené) — shoda rozhraní × implementace. */
export function attrsOf(pragmas) {
    /* token pragmy nese text bez složených závorek (lexer) */
    return (pragmas || []).map(p => p.replace(/^\{|\}$/g, "").replace(/\s+/g, " ").trim())
        .filter(p => /^attribute\b/i.test(p)).map(p => "{" + p.toLowerCase() + "}").sort().join(" ");
}
const LOGIX_TYPES = new Set(["BOOL", "SINT", "INT", "DINT", "LINT", "REAL"]);
const ANYINT = { k: "elem", name: "ANY_INT", info: { cat: "sint", bits: 64 }, lit: true };
const ANYREAL = { k: "elem", name: "ANY_REAL", info: { cat: "real", bits: 64 }, lit: true };
const elem = (n) => ({ k: "elem", name: n, info: ELEM[n] });
const BOOL = elem("BOOL"), TIME = elem("TIME"), REAL = elem("REAL"), DINT = elem("DINT"), INT = elem("INT");
export function tyName(t) {
    switch (t.k) {
        case "elem": return t.lit ? (t.info.cat === "real" ? "REAL" : "ANY_INT") : t.name;
        case "fb": return t.def.name;
        case "struct": return t.name || "STRUCT";
        case "array": return "ARRAY OF " + tyName(t.of);
        case "enum": return t.name;
        case "ns": return t.name;
        case "itf": return t.def.name;
    }
}
function sizeOf(t) {
    switch (t.k) {
        case "elem":
        case "enum":
        case "itf": return 1;
        case "fb": return t.def.size;
        case "struct": return t.size;
        case "array": return t.size;
        case "ns": return 0;
    }
}
/** Standardní funkční bloky: členy v pořadí (offset = index). */
const STD_FB = {
    TON: [["IN", "BOOL", "in"], ["PT", "TIME", "in"], ["Q", "BOOL", "out"], ["ET", "TIME", "out"], ["_start", "TIME", "var"], ["_prev", "BOOL", "var"]],
    R_TRIG: [["CLK", "BOOL", "in"], ["Q", "BOOL", "out"], ["M", "BOOL", "var"]],
    RS: [["S", "BOOL", "in"], ["R1", "BOOL", "in"], ["Q1", "BOOL", "out"]],
    SR: [["S1", "BOOL", "in"], ["R", "BOOL", "in"], ["Q1", "BOOL", "out"]],
    CTU: [["CU", "BOOL", "in"], ["R", "BOOL", "in"], ["PV", "INT", "in"], ["Q", "BOOL", "out"], ["CV", "INT", "out"], ["_prev", "BOOL", "var"]],
    CTD: [["CD", "BOOL", "in"], ["LD", "BOOL", "in"], ["PV", "INT", "in"], ["Q", "BOOL", "out"], ["CV", "INT", "out"], ["_prev", "BOOL", "var"]],
    FBD_TIMER: [["EnableIn", "BOOL", "in"], ["TimerEnable", "BOOL", "in"], ["PRE", "DINT", "in"], ["Reset", "BOOL", "in"], ["EnableOut", "BOOL", "out"],
        ["ACC", "DINT", "out"], ["EN", "BOOL", "out"], ["TT", "BOOL", "out"], ["DN", "BOOL", "out"], ["Status", "DINT", "out"],
        ["InstructFault", "BOOL", "out"], ["PresetInv", "BOOL", "out"], ["_start", "DINT", "var"], ["_prev", "BOOL", "var"]],
};
STD_FB.TOF = STD_FB.TON;
STD_FB.TP = STD_FB.TON;
STD_FB.F_TRIG = STD_FB.R_TRIG;
STD_FB.TON_TIME = STD_FB.TON;
STD_FB.TOF_TIME = STD_FB.TON;
STD_FB.TP_TIME = STD_FB.TON;
/* Mitsubishi TIMER_1/10/100_FB_M (FX5 Programming Manual Instructions JY997D55801Z, kap. 32.4):
   Coil = podmínka, Preset INT 0–32 767 v jednotkách 1 / 10 / 100 ms, ValueIn = počáteční hodnota
   (záporná = 0), ValueOut = aktuální hodnota (po vypnutí Coil = ValueIn), Status = doběhl */
STD_FB.TIMER_100_FB_M = [["Coil", "BOOL", "in"], ["Preset", "INT", "in"], ["ValueIn", "INT", "in"], ["ValueOut", "INT", "out"], ["Status", "BOOL", "out"],
    ["_start", "TIME", "var"], ["_prev", "BOOL", "var"]];
STD_FB.TIMER_10_FB_M = STD_FB.TIMER_100_FB_M;
STD_FB.TIMER_1_FB_M = STD_FB.TIMER_100_FB_M;
/** Jednotka předvolby časovačů TIMER_x_FB_M [ms]. */
export const TIMER_M_UNIT = { TIMER_1_FB_M: 1, TIMER_10_FB_M: 10, TIMER_100_FB_M: 100 };
STD_FB.CTUD = [["CU", "BOOL", "in"], ["CD", "BOOL", "in"], ["R", "BOOL", "in"], ["LD", "BOOL", "in"], ["PV", "INT", "in"], ["QU", "BOOL", "out"], ["QD", "BOOL", "out"], ["CV", "INT", "out"], ["_pu", "BOOL", "var"], ["_pd", "BOOL", "var"]];
/** Časovače: offset slotu, který se mění při běhu (ET / ACC) — pro rychlé přeskočení klidu. */
const TIMER_ET = { TON: 3, TOF: 3, TP: 3, TON_TIME: 3, TOF_TIME: 3, TP_TIME: 3, FBD_TIMER: 5, TIMER_1_FB_M: 3, TIMER_10_FB_M: 3, TIMER_100_FB_M: 3 };
const WRAP = {
    BOOL: x => "((" + x + ")?1:0)", SINT: x => "((" + x + ")<<24>>24)", INT: x => "((" + x + ")<<16>>16)", DINT: x => "((" + x + ")|0)",
    USINT: x => "((" + x + ")&255)", UINT: x => "((" + x + ")&65535)", UDINT: x => "((" + x + ")>>>0)",
    BYTE: x => "((" + x + ")&255)", WORD: x => "((" + x + ")&65535)", DWORD: x => "((" + x + ")>>>0)",
    REAL: x => "fr(" + x + ")", LREAL: x => "(" + x + ")", TIME: x => "((" + x + ")|0)", LTIME: x => "(" + x + ")",
    LINT: x => "Math.trunc(" + x + ")", ULINT: x => "Math.trunc(" + x + ")", LWORD: x => "Math.trunc(" + x + ")", STRING: x => "0",
};
export function compile(inp) {
    const d = inp.d;
    const out = [];
    const add = (level, rule, p, msg, source) => {
        if (level === "info" && rule === "end-semicolon")
            return;
        out.push({ level, rule, file: p ? p.file : "", line: p ? p.line : 0, col: p ? p.col : 0, msg, source, platform: d.plat });
    };
    const lvlAdd = (lvl, rule, p, msg, source) => { if (lvl !== "ok")
        add(lvl, rule, p, msg, source); };
    const key = (s) => s.toUpperCase();
    /* --------------------------------------------------------- identifikátory */
    const seenIdent = new Set();
    function checkIdent(name, p, what) {
        const sig = name + "@" + p.file + ":" + p.line + ":" + p.col;
        if (seenIdent.has(sig))
            return;
        seenIdent.add(sig);
        if (/[^\x00-\x7F]/.test(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            add("error", "ident-format", p, tr("{what} {name} není platný identifikátor (písmeno nebo _, pak písmena, číslice, _; bez diakritiky a mezer)", { what, name }), d.src.ident);
            return;
        }
        if (name.includes("__"))
            lvlAdd(d.noDoubleUnderscore, "ident-format", p, tr("{what} {name} obsahuje dvě podtržítka za sebou", { what, name }), d.src.ident);
        if (name.endsWith("_"))
            lvlAdd(d.noTrailingUnderscore, "ident-format", p, tr("{what} {name} končí podtržítkem", { what, name }), d.src.ident);
        if (name.startsWith("_"))
            lvlAdd(d.noLeadingUnderscore, "ident-format", p, tr("{what} {name} začíná podtržítkem", { what, name }), d.src.ident);
        if (name.length > d.maxIdent)
            add("error", "ident-format", p, tr("{what} {name} je delší než {max} znaků", { what, name, max: d.maxIdent }), d.src.ident);
        const K = key(name);
        if (IEC_KEYWORDS.has(K) || d.reserved.has(K))
            add("error", "reserved", p, tr("{what} {name} je rezervované slovo / jméno instrukce platformy", { what, name }), d.src.reserved);
        else if (d.deviceName && d.deviceName.test(name))
            add("error", "reserved", p, tr("{what} {name} má tvar jména operandu (zařízení) PLC", { what, name }), d.src.reserved);
        else if (d.reservedPrefix && d.reservedPrefix.test(name))
            add("error", "reserved", p, tr("{what} {name} začíná rezervovanou předponou", { what, name }), d.src.reserved);
    }
    /* --------------------------------------------------------- typy a bloky */
    const fbs = new Map();
    const itfs = new Map();
    const types = new Map();
    const pouByKey = new Map();
    /* servoosy: vestavěné typy dialektu (objekt osy, výčty knihoven, MOTION_INSTRUCTION) a bloky MC */
    const motion = inp.motion;
    const builtinTypes = new Map();
    const motionFbs = new Map();
    const P0 = { file: "", line: 0, col: 0 };
    const memberStruct = (name, list, size, ro) => {
        /* vnořené skupiny (StatusBits.HomingDone) mají offset 0 a listy absolutní slot — jen jiná jména slotů modelu */
        const root = { k: "struct", name, fields: [], map: new Map(), size };
        for (const [path, type, slot] of list) {
            const parts = path.split(".");
            let cur = root;
            for (const part of parts.slice(0, -1)) {
                let f = cur.map.get(key(part));
                if (!f) {
                    const sub = { k: "struct", name: name + "_" + part, fields: [], map: new Map(), size: 0 };
                    f = { name: part, key: key(part), kind: "var", ty: sub, pos: P0, off: 0, ro };
                    cur.fields.push(f);
                    cur.map.set(f.key, f);
                }
                cur = f.ty;
            }
            const leaf = { name: parts[parts.length - 1], key: key(parts[parts.length - 1]), kind: "var", ty: elem(type), pos: P0, off: slot, ro };
            cur.fields.push(leaf);
            cur.map.set(leaf.key, leaf);
        }
        return root;
    };
    if (motion) {
        const dia = motion.dialect;
        const axTy = memberStruct(AXIS_TYPE[dia], AXIS_MEMBERS[dia], AX_SIZE, true);
        axTy.axis = true;
        builtinTypes.set(key(AXIS_TYPE[dia]), axTy);
        for (const [en, vals] of Object.entries(MC_ENUMS[dia] || {}))
            builtinTypes.set(key(en), { k: "enum", name: en, values: new Map(Object.entries(vals).map(([n, v]) => [key(n), v])) });
        if (dia === "lx")
            builtinTypes.set("MOTION_INSTRUCTION", memberStruct("MOTION_INSTRUCTION", MI_MEMBERS, MI_SIZE, false));
        for (const [n, sp] of Object.entries(mcBlocks(dia)))
            motionFbs.set(n, sp);
        for (const [k, t] of builtinTypes)
            if (t.k === "enum")
                types.set(k, t);
    }
    /** Definice bloku MC (standardní blok dialektu nad modelem osy). */
    const mcDef = (K) => {
        const ex = fbs.get(K);
        if (ex)
            return ex;
        const sp = motionFbs.get(K);
        const vars = [];
        const map = { axis: -1, exe: -1, en: -1, reg: -1, drv: -1, epos: -1, eneg: -1, pos: -1, vel: -1, acc: -1, dec: -1,
            done: -1, busy: -1, abort: -1, err: -1, errId: -1, status: -1, inVel: -1, prev: -1, ser: -1, st: -1, shown: -1 };
        let dirOff = -1;
        const all = [...sp.members, ["_prev", "BOOL", "var", "prev"], ["_ser", "LREAL", "var", "ser"], ["_st", "INT", "var", "st"], ["_shown", "BOOL", "var", "shown"]];
        all.forEach(([nm, t, kind, sem], i) => {
            const bt = builtinTypes.get(key(t));
            const ty = bt || elem(t);
            const v = { name: nm, key: key(nm), kind: kind, ty, pos: P0, off: i, ...(sem === "axis" ? { byRef: true } : {}) };
            vars.push(v);
            if (sem)
                map[sem] = i;
            if (key(nm) === "DIRECTION")
                dirOff = i;
        });
        const def = { name: K, key: K, std: K, vars, map: new Map(vars.map(v => [v.key, v])), size: vars.length, methods: new Map(), js: "", laid: true,
            mc: { key: K, spec: sp, map: map, dirOff } };
        fbs.set(K, def);
        return def;
    };
    let jsN = 0, tidN = 0;
    const stdDef = (n) => {
        const K = key(n);
        const ex = fbs.get(K);
        if (ex)
            return ex;
        const vars = STD_FB[K].map(([nm, t, kind], i) => ({ name: nm, key: key(nm), kind, ty: elem(t), pos: { file: "", line: 0, col: 0 }, off: i }));
        const def = { name: K, key: K, std: K, vars, map: new Map(vars.map(v => [v.key, v])), size: vars.length, methods: new Map(), js: "", laid: true };
        fbs.set(K, def);
        return def;
    };
    for (const u of inp.units) {
        for (const p of u.pous)
            if (p.kind === "fb" || p.kind === "function" || p.kind === "interface") {
                if (pouByKey.has(key(p.name)) || fbs.has(key(p.name)))
                    add("error", "duplicate", p.pos, tr("Blok {name} je deklarován vícekrát", { name: p.name }), d.src.ident);
                pouByKey.set(key(p.name), p);
                checkIdent(p.name, p.pos, tr("Blok"));
                if (p.kind === "fb")
                    fbs.set(key(p.name), { name: p.name, key: key(p.name), vars: [], map: new Map(), size: 0, methods: new Map(), pou: p, pos: p.pos, body: p.body, js: "F" + (jsN++), laid: false,
                        tid: ++tidN, abstract: p.abstract, final: p.final, props: new Map(), itfs: [] });
                if (p.kind === "interface")
                    itfs.set(key(p.name), { name: p.name, key: key(p.name), pou: p, pos: p.pos, methods: new Map(), props: new Map(), laid: false });
                if (!d.oop && (p.kind === "interface" || p.methods.length || p.extendsName || p.implementsNames))
                    add("error", "oop", p.pos, tr("{name}: OOP (INTERFACE / METHOD / PROPERTY / EXTENDS) platforma {plat} nemá", { name: p.name, plat: d.label }), SRC_OOP);
            }
        for (const t of u.types) {
            checkIdent(t.name, t.pos, tr("Typ"));
            if (types.has(key(t.name)))
                add("error", "duplicate", t.pos, tr("Typ {name} je deklarován vícekrát", { name: t.name }), d.src.ident);
            types.set(key(t.name), { k: "enum", name: t.name, values: new Map() }); // zástupce, upřesní se níže
        }
    }
    for (const a of inp.aois || []) {
        checkIdent(a.name, a.pos, tr("Add-On Instruction"));
        fbs.set(key(a.name), { name: a.name, key: key(a.name), aoi: true, vars: [], map: new Map(), size: 0, methods: new Map(), pos: a.pos, body: a.body, js: "F" + (jsN++), laid: false });
    }
    const typeDecls = new Map(inp.units.flatMap(u => u.types).map(t => [key(t.name), t]));
    const resolving = new Set();
    function resolveTypeName(n, p, quoted) {
        let K = key(n.trim());
        if (TYPE_ALIAS[K])
            K = TYPE_ALIAS[K];
        if (ELEM[K] && !quoted) {
            if (d.plat === "rockwell" && !LOGIX_TYPES.has(K))
                add("error", "logix-construct", p, tr("Datový typ {name} v Logix není (jen BOOL, SINT, INT, DINT, LINT, REAL)", { name: n }), "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm007_-en-p.pdf");
            return elem(K);
        }
        if (d.scl && (K === "TON" || K === "TOF" || K === "TP") && !quoted)
            add("warn", "ton-type", p, tr("Časovač typu {name}: TIA v exportu zdrojů pro S7-1200/1500 píše {name}_TIME — alias {name} v externím zdroji neověřen", { name: K }), "https://abedgnu.github.io/Automation-Notes/chapters/PLC/Siemens/exercises-solutions.html");
        if (builtinTypes.has(K) && !quoted)
            return builtinTypes.get(K);
        if (motionFbs.has(K) && !quoted)
            return { k: "fb", def: mcDef(K) };
        if (fbs.has(K)) {
            const f = fbs.get(K);
            layoutFb(f);
            return { k: "fb", def: f };
        }
        if (itfs.has(K) && !quoted) {
            const i = itfs.get(K);
            layoutItf(i);
            return { k: "itf", def: i };
        }
        if (d.stdFbs.has(K) && !quoted)
            return { k: "fb", def: stdDef(K) };
        if (STD_FB[K] && !quoted) {
            add("error", "undeclared", p, tr("Blok {name} na této platformě není (dostupné: {list})", { name: n, list: [...d.stdFbs].join(", ") }), d.src.syntax);
            return { k: "fb", def: stdDef(K) };
        }
        const td = typeDecls.get(K);
        if (td) {
            const cached = types.get(K);
            if (cached && cached.k !== "enum")
                return cached;
            if (cached && cached.k === "enum" && cached.values.size)
                return cached;
            if (resolving.has(K)) {
                add("error", "syntax", p, tr("Typ {name} odkazuje sám na sebe", { name: n }));
                return INT;
            }
            resolving.add(K);
            const t = resolveSpec(td.spec, td.name);
            resolving.delete(K);
            types.set(K, t);
            return t;
        }
        add("error", "undeclared", p, tr("Neznámý datový typ {name}", { name: n }), d.src.syntax);
        return undefined;
    }
    /** `def` = blok, jehož konstanty smí stát v mezích pole (ARRAY[1..N_DEVICES]). */
    function resolveSpec(s, name = "", def) {
        switch (s.k) {
            case "name": return resolveTypeName(s.name, s.pos, s.quoted) || INT;
            case "array": {
                const dims = s.dims.map(([lo, hi]) => {
                    const a = constOf(lo, def), b = constOf(hi, def);
                    if (a === undefined || b === undefined)
                        add("error", "syntax", s.pos, tr("Meze pole musí být konstanty"), d.src.syntax);
                    else if (b < a)
                        add("error", "syntax", s.pos, tr("Pole s horní mezí {hi} menší než dolní {lo}", { lo: a, hi: b }), d.src.syntax);
                    return [a ?? 0, b ?? 0];
                });
                const of = resolveSpec(s.of, "", def);
                const n = dims.reduce((a, [lo, hi]) => a * Math.max(0, hi - lo + 1), 1);
                return { k: "array", of, dims, size: n * sizeOf(of) };
            }
            case "struct": {
                const fields = [];
                let off = 0;
                for (const f of s.fields) {
                    checkIdent(f.name, f.pos, tr("Člen"));
                    const ty = resolveSpec(f.type);
                    fields.push({ name: f.name, key: key(f.name), kind: "var", ty, init: f.init, pos: f.pos, off });
                    off += sizeOf(ty);
                }
                return { k: "struct", name, fields, map: new Map(fields.map(f => [f.key, f])), size: off };
            }
            case "enum": {
                const values = new Map();
                let v = 0;
                for (const e of s.values) {
                    if (e.value)
                        v = constOf(e.value) ?? v;
                    values.set(key(e.name), v);
                    v++;
                }
                return { k: "enum", name, values };
            }
        }
    }
    function constOf(e, def) {
        if (e.k === "lit")
            return e.ty === "STR" ? undefined : e.v;
        if (e.k === "un" && e.op === "-") {
            const v = constOf(e.e, def);
            return v === undefined ? undefined : -v;
        }
        if (e.k === "un" && e.op === "NOT") {
            const v = constOf(e.e, def);
            return v === undefined ? undefined : v ? 0 : 1;
        }
        if (e.k === "bin") {
            const a = constOf(e.a, def), b = constOf(e.b, def);
            if (a === undefined || b === undefined)
                return undefined;
            switch (e.op) {
                case "+": return a + b;
                case "-": return a - b;
                case "*": return a * b;
                case "/": return b ? (Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b) : undefined;
            }
            return undefined;
        }
        if (e.k === "ref" && e.path.length >= 1) {
            const n = key(e.path[0].name);
            if (def && e.path.length === 1) {
                const v = def.map.get(n) || (def.owner && def.owner.map.get(n));
                if (v && v.constVal !== undefined)
                    return v.constVal;
            }
            if (e.path.length === 1) {
                const g = globals.get(n);
                if (g && g.constVal !== undefined)
                    return g.constVal;
            }
            if (e.path.length === 2) {
                const t = typeDecls.has(n) ? resolveTypeName(e.path[0].name, e.path[0].pos) : types.get(n);
                if (t && t.k === "enum")
                    return t.values.get(key(e.path[1].name));
            }
        }
        return undefined;
    }
    /* konstanty první: smí stát v mezích polí dalších deklarací (ARRAY[1..N_DEVICES]) */
    const KIND_ORDER = ["const", "in", "out", "inout", "var", "stat", "temp"];
    /** Instance abstraktního bloku (i v poli) nejde vytvořit. */
    function checkInstantiable(ty, p) {
        const t = ty.k === "array" ? ty.of : ty;
        if (t.k === "fb" && t.def.abstract)
            add("error", "oop", p, tr("Blok {fb} je ABSTRACT — jeho instanci nelze vytvořit (jen odvozeného bloku)", { fb: t.def.name }), SRC_ABS);
    }
    function addVars(def, blocks, offStart) {
        let off = offStart;
        for (const b of blocks)
            for (const v of b.decls) {
                checkIdent(v.name, v.pos, tr("Proměnná"));
                const K = key(v.name);
                if (def.map.has(K)) {
                    add("error", "duplicate", v.pos, tr("Proměnná {name} je v bloku {fb} deklarována vícekrát (velikost písmen se nerozlišuje)", { name: v.name, fb: def.name }), d.src.ident);
                    continue;
                }
                const ty = resolveSpec(v.type, "", def);
                checkInstantiable(ty, v.pos);
                const s = { name: v.name, key: K, kind: b.kind, ty, init: v.init, pos: v.pos, off };
                /* objekt osy jako parametr bloku = odkaz (TO / AXIS_REF se předávají odkazem — S7-1200 Motion Control V6–V8, PLCopen VAR_IN_OUT) */
                if (ty.k === "struct" && ty.axis && (b.kind === "in" || b.kind === "inout"))
                    s.byRef = true;
                if (b.kind === "const") {
                    s.constVal = v.init ? constOf(v.init, def) : undefined;
                    if (s.constVal === undefined)
                        add("error", "syntax", v.pos, tr("Konstanta {name} nemá konstantní hodnotu", { name: v.name }), d.src.syntax);
                }
                if (v.init && !d.initValues && b.kind !== "const")
                    add("warn", "init-value", v.pos, tr("Počáteční hodnota {name} := … se na této platformě neuplatní (FX5 nepodporuje počáteční hodnoty) — hodnotu je nutné předat při volání", { name: v.name }), d.src.ident);
                if (v.at)
                    add("error", "address", v.atPos, tr("AT adresa uvnitř bloku {fb} — fyzické adresy patří do globálních proměnných", { fb: def.name }), d.src.addr);
                def.vars.push(s);
                def.map.set(K, s);
                off += s.byRef ? 1 : sizeOf(ty);
            }
        return off;
    }
    function layoutFb(def) {
        if (def.laid || def.std)
            return;
        if (resolving.has("FB:" + def.key)) {
            add("error", "syntax", def.pos, tr("Blok {name} obsahuje sám sebe", { name: def.name }));
            def.laid = true;
            return;
        }
        resolving.add("FB:" + def.key);
        if (def.pou) {
            const p = def.pou;
            let off = 0;
            let parent;
            if (p.extendsName) {
                parent = fbs.get(key(p.extendsName));
                if (!parent)
                    add("error", "undeclared", p.pos, tr("EXTENDS: blok {name} neexistuje", { name: p.extendsName }), d.src.syntax);
                else if (parent.final)
                    add("error", "oop", p.pos, tr("Blok {fb} je FINAL — nelze z něj dědit", { fb: parent.name }), SRC_OOP);
            }
            if (parent) {
                layoutFb(parent);
                def.parent = parent;
                for (const v of parent.vars) {
                    def.vars.push(v);
                    def.map.set(v.key, v);
                }
                off = parent.size;
                for (const [k, m] of parent.methods)
                    def.methods.set(k, m);
                for (const [k, pr] of parent.props || [])
                    def.props.set(k, pr);
            }
            else {
                /* kořenový blok: skrytý identifikátor třídy (slot 0) — dynamické volání metod přes rozhraní a THIS^ */
                const t = { name: "__TID", key: "__TID", kind: "var", ty: DINT, pos: p.pos, off: 0 };
                def.vars.push(t);
                def.map.set(t.key, t);
                off = 1;
            }
            for (const n of p.implementsNames || []) {
                const i = itfs.get(key(n));
                if (!i) {
                    add("error", "oop", p.pos, tr("IMPLEMENTS: rozhraní {name} neexistuje", { name: n }), SRC_OOP);
                    continue;
                }
                layoutItf(i);
                def.itfs.push(i);
            }
            const blocks = [...p.vars].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
            for (const b of blocks)
                if (b.kind === "global" || b.kind === "external")
                    add(b.kind === "global" ? "error" : "info", "syntax", b.pos, tr("{kind} uvnitř bloku {fb}", { kind: b.kind === "global" ? "VAR_GLOBAL" : "VAR_EXTERNAL", fb: def.name }));
            off = addVars(def, blocks.filter(b => b.kind !== "global" && b.kind !== "external"), off);
            /* metody: lokální proměnné metody leží v instanci (metody nejsou reentrantní) */
            for (const m of p.methods) {
                const acc = m.kind === "property" ? [m.getter, m.setter].filter(Boolean) : [m];
                const prop = m.kind === "property" ? { name: m.name, ty: m.retType ? resolveSpec(m.retType) : INT, owner: def, pos: m.pos, access: m.access, attrs: attrsOf(m.pragmas) } : undefined;
                if (prop) {
                    checkIdent(m.name, m.pos, tr("Vlastnost"));
                    if (def.map.has(key(m.name)))
                        add("error", "duplicate", m.pos, tr("Vlastnost {name} má stejné jméno jako proměnná bloku {fb} (velikost písmen se nerozlišuje)", { name: m.name, fb: def.name }), d.src.ident);
                    def.props.set(key(m.name), prop);
                }
                for (const mp of acc) {
                    const md = { name: mp.name, key: key(mp.name), vars: [], map: new Map(), size: 0, methods: new Map(), pou: mp, pos: mp.pos, body: mp.body, js: "F" + (jsN++), laid: true, owner: def,
                        access: mp.access, abstract: mp.abstract, final: mp.final };
                    if (!prop) {
                        checkIdent(mp.name, mp.pos, tr("Metoda"));
                        if (def.map.has(md.key))
                            add("error", "duplicate", mp.pos, tr("Metoda {name} má stejné jméno jako proměnná bloku {fb} (velikost písmen se nerozlišuje)", { name: mp.name, fb: def.name }), d.src.ident);
                        const inherited = def.methods.get(md.key);
                        if (inherited && inherited.owner !== def && inherited.final)
                            add("error", "oop", mp.pos, tr("Metoda {name} je v bloku {fb} FINAL — nelze ji přepsat", { name: mp.name, fb: inherited.owner.name }), SRC_OOP);
                    }
                    if (mp.abstract && !def.abstract)
                        add("error", "oop", mp.pos, tr("ABSTRACT metoda {name} smí být jen v ABSTRACT bloku", { name: prop ? prop.name : mp.name }), SRC_ABS);
                    if (mp.abstract && mp.body.length)
                        add("error", "oop", mp.pos, tr("ABSTRACT metoda {name} nesmí mít implementaci", { name: prop ? prop.name : mp.name }), SRC_ABS);
                    off = addVars(md, mp.vars, off);
                    /* návratová hodnota: metoda pod svým jménem; GET / SET vlastnosti pod jménem vlastnosti */
                    const isSet = /^__set_/i.test(mp.name);
                    if (mp.retType) {
                        md.retTy = resolveSpec(mp.retType);
                        const rn = prop ? prop.name : mp.name;
                        const r = { name: rn, key: key(rn), kind: prop && isSet ? "in" : "var", ty: md.retTy, pos: mp.pos, off };
                        md.vars.push(r);
                        md.map.set(r.key, r);
                        off += sizeOf(md.retTy);
                        if (!(prop && isSet))
                            md.retSym = r;
                    }
                    if (prop) {
                        if (isSet)
                            prop.setter = md;
                        else
                            prop.getter = md;
                    }
                    def.methods.set(md.key, md);
                }
            }
            def.size = off;
        }
        else if (def.aoi) {
            const a = (inp.aois || []).find(x => key(x.name) === def.key);
            let off = 0;
            const push = (name, type, kind, p, initNum) => {
                const K = key(name);
                if (def.map.has(K)) {
                    add("error", "duplicate", p, tr("Proměnná {name} je v bloku {fb} deklarována vícekrát (velikost písmen se nerozlišuje)", { name, fb: def.name }), d.src.ident);
                    return;
                }
                if (!/^Enable(In|Out)$/.test(name))
                    checkIdent(name, p, tr("Parametr"));
                const ty = resolveTypeName(type, p) || INT;
                const s = { name, key: K, kind, ty, pos: p, off, initNum };
                def.vars.push(s);
                def.map.set(K, s);
                off += sizeOf(ty);
            };
            push("EnableIn", "BOOL", "in", a.pos, 1);
            push("EnableOut", "BOOL", "out", a.pos);
            for (const pr of a.params)
                if (!/^Enable(In|Out)$/i.test(pr.name))
                    push(pr.name, pr.type, pr.usage === "Output" ? "out" : pr.usage === "InOut" ? "inout" : "in", pr.pos, pr.def);
            for (const l of a.locals)
                push(l.name, l.type, "var", l.pos, l.def);
            def.size = off;
        }
        def.laid = true;
        resolving.delete("FB:" + def.key);
    }
    /** Parametry metody (vstupy, výstupy, IN_OUT v pořadí deklarace). */
    function paramsOf(vars) {
        const out = [];
        for (const b of vars)
            if (b.kind === "in" || b.kind === "out" || b.kind === "inout")
                for (const v of b.decls)
                    out.push({ name: v.name, key: key(v.name), kind: b.kind, ty: resolveSpec(v.type) });
        return out;
    }
    function layoutItf(i) {
        if (i.laid)
            return;
        i.laid = true;
        if (i.pou.extendsName)
            add("warn", "oop", i.pos, tr("Rozhraní {name}: EXTENDS emulátor nevyhodnocuje", { name: i.name }), SRC_OOP);
        for (const m of i.pou.methods) {
            if (m.kind === "property") {
                if (i.props.has(key(m.name)) || i.methods.has(key(m.name)))
                    add("error", "duplicate", m.pos, tr("Rozhraní {itf}: člen {name} je deklarován vícekrát", { itf: i.name, name: m.name }), SRC_OOP);
                i.props.set(key(m.name), { name: m.name, ty: m.retType ? resolveSpec(m.retType) : INT, get: !!m.getter, set: !!m.setter, pos: m.pos, attrs: attrsOf(m.pragmas) });
                if (!m.getter && !m.setter)
                    add("error", "oop", m.pos, tr("Vlastnost {name} rozhraní {itf} nemá GET ani SET", { name: m.name, itf: i.name }), SRC.cdsItfProp);
                continue;
            }
            if (m.body.length)
                add("error", "oop", m.pos, tr("Metoda {name} rozhraní {itf} nesmí mít implementaci", { name: m.name, itf: i.name }), SRC_OOP);
            if (i.methods.has(key(m.name)) || i.props.has(key(m.name)))
                add("error", "duplicate", m.pos, tr("Rozhraní {itf}: člen {name} je deklarován vícekrát", { itf: i.name, name: m.name }), SRC_OOP);
            checkIdent(m.name, m.pos, tr("Metoda"));
            i.methods.set(key(m.name), { name: m.name, params: paramsOf(m.vars), retTy: m.retType ? resolveSpec(m.retType) : undefined, pos: m.pos, attrs: attrsOf(m.pragmas) });
        }
    }
    /** Podpis metody: návratový typ a parametry (směr, jméno, typ) — pro přepsání a implementaci rozhraní. */
    const sigOf = (retTy, params) => (retTy ? tyName(retTy) : "-") + "(" + params.map(p => p.kind + " " + p.key + ":" + tyName(p.ty)).join(", ") + ")";
    const methodSig = (md) => sigOf(md.retTy, md.pou ? paramsOf(md.pou.vars) : []);
    /** Blok `f` je `t` nebo z něj dědí. */
    const isA = (f, t) => { for (let x = f; x; x = x.parent)
        if (x === t)
            return true; return false; };
    /** Blok implementuje rozhraní (sám nebo předek). */
    const implementsItf = (f, i) => { for (let x = f; x; x = x.parent)
        if ((x.itfs || []).includes(i))
            return true; return false; };
    /**
     * Kontroly OOP po rozložení bloků: neabstraktní blok bez implementace abstraktní metody,
     * přepsaná metoda s jiným podpisem, rozhraní (IMPLEMENTS) bez metody / vlastnosti / GET
     * nebo s jiným podpisem. Hlášení jako překladač CODESYS / TwinCAT (C0434, „does not implement").
     */
    function checkOop() {
        /* CODESYS 3.5.21.60 (import a překlad 2026-10-05): C568 „Interface of overridden method … doesn't match
           declaration“, když se atributy ({attribute 'monitoring' := 'call'} …) implementace liší od rozhraní */
        const attrWarn = (p, name, fb, itf, a, b) => add("warn", "oop", p, tr("Člen {name} bloku {fb} má jiné atributy než v rozhraní {itf} ({a} × {b}) — CODESYS hlásí C568", { name, fb, itf, a: a || "—", b: b || "—" }), SRC.cdsItfProp);
        for (const f of fbs.values()) {
            if (!f.pou || f.std)
                continue;
            const own = new Map([...f.methods].filter(([, m]) => m.owner === f));
            /* přepsání: stejný podpis jako u předka */
            if (f.parent)
                for (const [k, m] of own) {
                    const base = f.parent.methods.get(k);
                    if (base && methodSig(base) !== methodSig(m))
                        add("error", "oop", m.pos, tr("Metoda {name} přepisuje metodu bloku {fb} s jiným podpisem ({a} × {b})", { name: m.name.replace(/^__(get|set)_/i, ""), fb: base.owner.name, a: methodSig(m), b: methodSig(base) }), SRC.cdsMethod);
                    if (base && (base.access || "PUBLIC") !== (m.access || "PUBLIC"))
                        add("error", "oop", m.pos, tr("Metoda {name} mění přístup proti bloku {fb} ({a} × {b})", { name: m.name.replace(/^__(get|set)_/i, ""), fb: base.owner.name, a: m.access || "PUBLIC", b: base.access || "PUBLIC" }), SRC.cdsMethod);
                }
            /* neabstraktní blok musí mít všechny metody implementované */
            if (!f.abstract)
                for (const m of f.methods.values()) {
                    if (m.abstract)
                        add("error", "oop", f.pos, tr("Blok {fb} není ABSTRACT, ale neimplementuje abstraktní metodu {name} bloku {base}", { fb: f.name, name: m.name.replace(/^__(get|set)_/i, ""), base: m.owner.name }), SRC_ABS);
                }
            /* rozhraní: každá metoda a vlastnost se shodným podpisem */
            const all = [];
            for (let x = f; x; x = x.parent)
                for (const i of x.itfs || [])
                    if (!all.includes(i))
                        all.push(i);
            for (const i of all) {
                for (const [k, im] of i.methods) {
                    const m = f.methods.get(k);
                    if (!m) {
                        add("error", "oop", f.pos, tr("Blok {fb} neimplementuje metodu {name} rozhraní {itf}", { fb: f.name, name: im.name, itf: i.name }), SRC_OOP);
                        continue;
                    }
                    if (methodSig(m) !== sigOf(im.retTy, im.params))
                        add("error", "oop", m.pos, tr("Metoda {name} bloku {fb} má jiný podpis než v rozhraní {itf} ({a} × {b})", { name: m.name, fb: f.name, itf: i.name, a: methodSig(m), b: sigOf(im.retTy, im.params) }), SRC_OOP);
                    if (m.access && m.access !== "PUBLIC")
                        add("error", "oop", m.pos, tr("Metoda {name} implementuje rozhraní {itf} — musí být PUBLIC", { name: m.name, itf: i.name }), SRC_OOP);
                    if (attrsOf(m.pou?.pragmas) !== im.attrs)
                        attrWarn(m.pos, m.name, f.name, i.name, attrsOf(m.pou?.pragmas), im.attrs);
                }
                for (const [k, ip] of i.props) {
                    const pr = f.props.get(k);
                    if (!pr) {
                        add("error", "oop", f.pos, tr("Blok {fb} neimplementuje vlastnost {name} rozhraní {itf}", { fb: f.name, name: ip.name, itf: i.name }), SRC.cdsItfProp);
                        continue;
                    }
                    if (tyName(pr.ty) !== tyName(ip.ty))
                        add("error", "oop", pr.pos, tr("Vlastnost {name} bloku {fb} má typ {a}, rozhraní {itf} žádá {b}", { name: ip.name, fb: f.name, itf: i.name, a: tyName(pr.ty), b: tyName(ip.ty) }), SRC.cdsItfProp);
                    if (ip.get && !pr.getter)
                        add("error", "oop", pr.pos, tr("Vlastnost {name} bloku {fb} nemá GET, který rozhraní {itf} žádá", { name: ip.name, fb: f.name, itf: i.name }), SRC.cdsItfProp);
                    if (ip.set && !pr.setter)
                        add("error", "oop", pr.pos, tr("Vlastnost {name} bloku {fb} nemá SET, který rozhraní {itf} žádá", { name: ip.name, fb: f.name, itf: i.name }), SRC.cdsItfProp);
                    if (pr.attrs !== ip.attrs)
                        attrWarn(pr.pos, ip.name, f.name, i.name, pr.attrs, ip.attrs);
                }
            }
        }
    }
    /* --------------------------------------------------------- globální paměť */
    const globals = new Map();
    let gsize = 0;
    const allocGlobal = (s) => {
        const g = { ...s, off: gsize };
        gsize += sizeOf(s.ty);
        globals.set(s.key, g);
        return g;
    };
    /* tagy z tabulek */
    const declTag = (t, what) => {
        checkIdent(t.name, t.pos, what);
        const K = key(t.name);
        if (globals.has(K)) {
            add("error", "duplicate", t.pos, tr("Tag {name} je deklarován vícekrát (velikost písmen se nerozlišuje)", { name: t.name }), d.src.ident);
            return;
        }
        const ty = resolveTypeName(t.type, t.pos) || BOOL;
        allocGlobal({ name: t.name, key: K, kind: "global", ty, pos: t.pos, initNum: t.init });
    };
    for (const t of inp.progTags || [])
        declTag(t, tr("Tag"));
    for (const t of inp.tags)
        if (!globals.has(key(t.name)) || !(inp.progTags || []).length)
            declTag(t, tr("Tag"));
    /* GVL: VAR_GLOBAL v souboru → jmenný prostor podle jména souboru (CODESYS objekt GVL) */
    for (const u of inp.units)
        for (const b of u.globals) {
            const nsName = u.file.replace(/\.[^.]+$/, "");
            const qo = b.pragmas.some(p => /attribute\s+'qualified_only'/i.test(p));
            let ns = globals.get(key(nsName));
            if (!ns || ns.ty.k !== "ns")
                ns = allocGlobal({ name: nsName, key: key(nsName), kind: "global", ty: { k: "ns", name: nsName, vars: new Map(), qualifiedOnly: qo }, pos: b.pos });
            const nsTy = ns.ty;
            for (const v of b.decls) {
                checkIdent(v.name, v.pos, tr("Globální proměnná"));
                const K = key(v.name);
                if (nsTy.vars.has(K)) {
                    add("error", "duplicate", v.pos, tr("Globální proměnná {name} je deklarována vícekrát (velikost písmen se nerozlišuje)", { name: v.name }), d.src.ident);
                    continue;
                }
                const ty = resolveSpec(v.type);
                const s = { name: v.name, key: K, kind: b.constant ? "const" : "global", ty, init: v.init, pos: v.pos, off: gsize };
                if (b.constant && v.init)
                    s.constVal = constOf(v.init);
                gsize += sizeOf(ty);
                nsTy.vars.set(K, s);
            }
        }
    /* objekty os z konfigurace IDE (technologický objekt, osa SoftMotion / Sysmac, tag osy Logix) */
    if (motion)
        for (const a of motion.axes) {
            if (!a.implicit || globals.has(key(a.name)))
                continue;
            allocGlobal({ name: a.name, key: key(a.name), kind: "global", ty: builtinTypes.get(key(AXIS_TYPE[motion.dialect])), pos: P0 });
        }
    /* programy a instanční DB */
    const programs = new Map();
    for (const u of inp.units)
        for (const p of u.pous)
            if (p.kind === "program") {
                checkIdent(p.name, p.pos, tr("Program"));
                const def = { name: p.name, key: key(p.name), vars: [], map: new Map(), size: 0, methods: new Map(), pou: p, pos: p.pos, body: p.body, js: "P" + (jsN++), laid: false };
                def.size = addVars(def, [...p.vars].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)), 0);
                def.laid = true;
                programs.set(def.key, def);
                allocGlobal({ name: p.name, key: def.key, kind: "global", ty: { k: "fb", def }, pos: p.pos });
            }
    for (const f of fbs.values())
        layoutFb(f);
    for (const i of itfs.values())
        layoutItf(i);
    checkOop();
    for (const u of inp.units)
        for (const db of u.dbs) {
            checkIdent(db.name, db.pos, tr("Datový blok"));
            if (db.ofType) {
                const ty = resolveTypeName(db.ofType, db.ofTypePos || db.pos, true);
                if (ty && ty.k !== "fb")
                    add("error", "syntax", db.ofTypePos, tr("Instanční DB {name}: {type} není funkční blok", { name: db.name, type: db.ofType }), d.src.syntax);
                if (ty)
                    allocGlobal({ name: db.name, key: key(db.name), kind: "global", ty, pos: db.pos });
            }
            else {
                const fields = [];
                let off = 0;
                for (const b of db.vars)
                    for (const v of b.decls) {
                        const ty = resolveSpec(v.type);
                        fields.push({ name: v.name, key: key(v.name), kind: "var", ty, init: v.init, pos: v.pos, off });
                        off += sizeOf(ty);
                    }
                allocGlobal({ name: db.name, key: key(db.name), kind: "global", ty: { k: "struct", name: db.name, fields, map: new Map(fields.map(f => [f.key, f])), size: off }, pos: db.pos });
            }
        }
    /* --------------------------------------------------------- výrazy */
    let readsTime = false;
    const helpersUsed = new Set();
    const isInt = (t) => t.k === "elem" && (t.info.cat === "sint" || t.info.cat === "uint");
    const isNum = (t) => t.k === "elem" && (t.info.cat === "sint" || t.info.cat === "uint" || t.info.cat === "real" || t.info.cat === "bits");
    const isBool = (t) => t.k === "elem" && t.info.cat === "bool";
    const isBits = (t) => t.k === "elem" && t.info.cat === "bits";
    /** Kontrola přiřazení hodnoty typu `src` do `dst`; vrací JS se zabalením na cílový typ. */
    function assignJs(v, dst, p, what) {
        const src = v.ty;
        if (dst.k !== "elem" || src.k !== "elem") {
            if (dst.k === "enum" && (src.k === "enum" || (src.k === "elem" && src.lit)))
                return v.js;
            if (dst.k === "enum" && src.k === "elem" && isInt(src)) {
                lvlAdd(d.looseBool ? "ok" : "error", "type-conv", p, tr("{what}: nelze přiřadit {from} do {to}", { what, from: tyName(src), to: tyName(dst) }), d.src.conv);
                return v.js;
            }
            if (dst.k === "elem" && src.k === "enum" && isInt(dst))
                return v.js;
            if (tyName(dst) !== tyName(src) || dst.k !== src.k)
                add("error", "type-conv", p, tr("{what}: nelze přiřadit {from} do {to}", { what, from: tyName(src), to: tyName(dst) }), d.src.conv);
            return v.js;
        }
        const to = dst.info, dn = dst.name;
        if (src.lit) {
            const val = v.c;
            if (to.cat === "bool") {
                if (!(d.looseBool && (val === 0 || val === 1)))
                    add("error", "type-conv", p, tr("{what}: číselný literál nelze přiřadit do BOOL", { what }), d.src.conv);
            }
            else if (to.cat === "time") {
                add("error", "type-conv", p, tr("{what}: číslo nelze přiřadit do {to} (použij časový literál T#…)", { what, to: dn }), d.src.conv);
            }
            else if (src.info.cat === "real" && to.cat !== "real") {
                lvlAdd(d.looseBool ? "ok" : "error", "type-conv", p, tr("{what}: reálný literál nelze přiřadit do {to}", { what, to: dn }), d.src.conv);
            }
            else if (val !== undefined && to.min !== undefined && to.max !== undefined && (val < to.min || val > to.max) && to.cat !== "real") {
                lvlAdd(d.plat === "rockwell" ? "warn" : "error", "literal-range", p, tr("{what}: hodnota {v} je mimo rozsah typu {to} ({min}…{max})", { what, v: val, to: dn, min: to.min, max: to.max }), d.src.conv);
            }
            if (val !== undefined && Number.isFinite(val)) { // konstanta: zabalit už při překladu
                if (to.cat === "bool")
                    return val ? "1" : "0";
                if (dn === "REAL")
                    return String(Math.fround(val));
                if (to.cat === "real")
                    return String(val);
                const expr = (WRAP[dn] || (x => x))(String(Math.trunc(val)));
                /* CSP bez 'unsafe-eval' new Function zakáže — pak se konstanta zabalí až za běhu (kontrola překladu běží dál) */
                try {
                    return String(new Function("return " + expr)());
                }
                catch {
                    return expr;
                }
            }
            return (WRAP[dn] || (x => x))(v.js);
        }
        const from = src.info;
        /* stejný typ: BOOL výrazy dávají vždy 0/1, čistý odkaz na proměnnou je už zabalený */
        if (src.name === dn && (to.cat === "bool" || /^m\[[^\]]*\]$/.test(v.js)))
            return v.js;
        if (src.name !== dn) {
            const lvl = d.conv({ ...from, name: src.name }, { ...to, name: dn });
            if (lvl !== "ok") {
                const msg = from.cat === "time" || to.cat === "time"
                    ? tr("{what}: {from} nelze implicitně převést na {to} (TIME není celé číslo — použij převodní funkci)", { what, from: src.name, to: dn })
                    : tr("{what}: implicitní převod {from} → {to} (možná ztráta / jiný význam) — použij převodní funkci", { what, from: src.name, to: dn });
                lvlAdd(lvl, "type-conv", p, msg, d.src.conv);
            }
        }
        if (from.cat === "real" && to.cat !== "real" && to.cat !== "bool")
            return (WRAP[dn] || (x => x))(d.plat === "rockwell" ? "rndE(" + v.js + ")" : "Math.trunc(" + v.js + ")");
        if (to.cat === "bool")
            return WRAP.BOOL(v.js);
        return (WRAP[dn] || (x => x))(v.js);
    }
    /** Výsledný typ dvou číselných operandů. */
    function common(a, b, p, op) {
        if (a.k !== "elem" || b.k !== "elem") {
            if (a.k === "enum" && b.k === "enum" && a.name === b.name)
                return INT;
            if ((a.k === "enum" && b.k === "elem" && (b.lit || isInt(b))) || (b.k === "enum" && a.k === "elem" && (a.lit || isInt(a))))
                return INT;
            add("error", "type-conv", p, tr("Operátor {op}: nepovolené operandy {a} a {b}", { op, a: tyName(a), b: tyName(b) }), d.src.conv);
            return INT;
        }
        if (a.lit && b.lit)
            return a.info.cat === "real" || b.info.cat === "real" ? ANYREAL : ANYINT;
        if (a.lit)
            return b.info.cat === "real" || a.info.cat !== "real" ? b : (b.info.cat === "time" ? b : REAL);
        if (b.lit)
            return a.info.cat === "real" || b.info.cat !== "real" ? a : (a.info.cat === "time" ? a : REAL);
        if (a.name === b.name)
            return a;
        if (isWidening(a.name, b.name))
            return b;
        if (isWidening(b.name, a.name))
            return a;
        const lvl = d.conv({ ...a.info, name: a.name }, { ...b.info, name: b.name });
        if (lvl !== "ok")
            lvlAdd(lvl, "type-conv", p, tr("Operátor {op}: smíšené typy {a} a {b} bez implicitního převodu", { op, a: a.name, b: b.name }), d.src.conv);
        return a.info.bits >= b.info.bits ? a : b;
    }
    function expr(e, cx) {
        switch (e.k) {
            case "lit":
                if (e.ty === "BOOL")
                    return { js: String(e.v ? 1 : 0), ty: e.typed ? BOOL : BOOL, c: e.v ? 1 : 0 };
                if (e.ty === "TIME") {
                    if (d.plat === "rockwell")
                        add("error", "logix-construct", e.pos, tr("Časový literál {lit}: časovače Logix (TONR / FBD_TIMER) berou PRE v ms jako DINT", { lit: e.s }), "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm003_-en-p.pdf");
                    return { js: String(e.v), ty: TIME, c: e.v };
                }
                if (e.ty === "STR")
                    return { js: "0", ty: elem("STRING") };
                if (e.typed) {
                    const tn = TYPE_ALIAS[e.typed] || e.typed;
                    if (ELEM[tn]) {
                        const t = elem(tn);
                        if (t.info.min !== undefined && t.info.max !== undefined && (e.v < t.info.min || e.v > t.info.max))
                            add("error", "literal-range", e.pos, tr("Literál {lit} je mimo rozsah typu {to}", { lit: e.s, to: tn }), d.src.conv);
                        return { js: String(e.v), ty: t, c: e.v };
                    }
                    const en = types.get(key(e.typed));
                    if (en && en.k === "enum")
                        return { js: String(e.v), ty: en, c: e.v };
                }
                return { js: String(e.v), ty: e.ty === "REAL" ? ANYREAL : ANYINT, c: e.v };
            case "ref": return ref(e.path, cx, false, e.pos);
            case "un": {
                const v = expr(e.e, cx);
                if (e.op === "NOT") {
                    if (isBool(v.ty))
                        return { js: "(" + v.js + "^1)", ty: BOOL, c: v.c !== undefined ? (v.c ? 0 : 1) : undefined };
                    if (isBits(v.ty) || isInt(v.ty))
                        return { js: "(~" + v.js + ")", ty: v.ty };
                    if (!(d.looseBool && isNum(v.ty)))
                        add("error", "type-conv", e.pos, tr("NOT nad typem {t}", { t: tyName(v.ty) }), d.src.conv);
                    return { js: "((" + v.js + ")?0:1)", ty: BOOL };
                }
                if (isBool(v.ty))
                    add("error", "type-conv", e.pos, tr("Unární minus nad BOOL"), d.src.conv);
                return { js: "(-" + v.js + ")", ty: v.ty, c: v.c !== undefined ? -v.c : undefined };
            }
            case "bin": {
                const a = expr(e.a, cx), b = expr(e.b, cx), op = e.op;
                const c = (a.c !== undefined && b.c !== undefined) ? constOf(e, cx.def) : undefined;
                if (op === "AND" || op === "OR" || op === "XOR") {
                    const jsop = op === "AND" ? "&" : op === "OR" ? "|" : "^";
                    if (isBool(a.ty) && isBool(b.ty))
                        return { js: "(" + a.js + jsop + b.js + ")", ty: BOOL };
                    if (d.looseBool && (isBool(a.ty) || isBool(b.ty)))
                        return { js: "((" + a.js + "?1:0)" + jsop + "(" + b.js + "?1:0))", ty: BOOL };
                    if ((isBits(a.ty) || isInt(a.ty)) && (isBits(b.ty) || isInt(b.ty))) {
                        const t = common(a.ty, b.ty, e.pos, op);
                        return { js: "(" + a.js + jsop + b.js + ")", ty: t };
                    }
                    add("error", "type-conv", e.pos, tr("Operátor {op}: nepovolené operandy {a} a {b}", { op, a: tyName(a.ty), b: tyName(b.ty) }), d.src.conv);
                    return { js: "0", ty: BOOL };
                }
                if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
                    if (a.ty.k === "itf" || b.ty.k === "itf") {
                        /* odkaz na rozhraní: jen = / <> s 0 nebo s jiným odkazem (kontrola platnosti) */
                        const okSide = (v) => v.ty.k === "itf" || (v.c === 0 && v.ty.k === "elem" && !!v.ty.lit);
                        if ((op !== "=" && op !== "<>") || !okSide(a) || !okSide(b))
                            add("error", "type-conv", e.pos, tr("Odkaz na rozhraní lze jen porovnat (= / <>) s 0 nebo s jiným odkazem"), SRC_REF);
                        return { js: "(" + a.js + (op === "=" ? "===" : "!==") + b.js + "?1:0)", ty: BOOL };
                    }
                    if (isBool(a.ty) !== isBool(b.ty) && !d.looseBool)
                        add("error", "type-conv", e.pos, tr("Porovnání {a} {op} {b} různých typů", { a: tyName(a.ty), op, b: tyName(b.ty) }), d.src.conv);
                    else if (!isBool(a.ty))
                        common(a.ty, b.ty, e.pos, op);
                    const jsop = op === "=" ? "===" : op === "<>" ? "!==" : op;
                    return { js: "(" + a.js + jsop + b.js + "?1:0)", ty: BOOL, c };
                }
                if (isBool(a.ty) || isBool(b.ty)) {
                    if (!d.looseBool)
                        add("error", "type-conv", e.pos, tr("Aritmetika {op} nad BOOL", { op }), d.src.conv);
                }
                const aT = a.ty.k === "elem" ? a.ty : INT, bT = b.ty.k === "elem" ? b.ty : INT;
                if (aT.k === "elem" && bT.k === "elem" && (aT.info.cat === "time" || bT.info.cat === "time")) {
                    const both = aT.info.cat === "time" && bT.info.cat === "time";
                    if ((op === "+" || op === "-") && !both && !(aT.lit || bT.lit))
                        add("error", "type-conv", e.pos, tr("Operátor {op}: TIME a {b} nelze sčítat", { op, b: tyName(aT.info.cat === "time" ? bT : aT) }), d.src.conv);
                    if ((op === "*" || op === "/") && both)
                        add("error", "type-conv", e.pos, tr("Operátor {op}: TIME {op} TIME není definováno", { op }), d.src.conv);
                    return { js: "((" + a.js + (op === "MOD" ? "%" : op) + b.js + ")|0)", ty: TIME, c };
                }
                const t = common(a.ty, b.ty, e.pos, op);
                const intRes = t.k === "elem" && t.info.cat !== "real";
                /* REAL je 32bitový: výsledek každé operace se zaokrouhlí na float32 (jako v PLC) */
                const r32 = (js) => t.k === "elem" && t.name === "REAL" ? "fr(" + js + ")" : js;
                if (op === "/") {
                    helpersUsed.add("div");
                    return { js: intRes ? "idiv(" + a.js + "," + b.js + ")" : r32("rdiv(" + a.js + "," + b.js + ")"), ty: t, c };
                }
                if (op === "MOD") {
                    helpersUsed.add("div");
                    return { js: "imod(" + a.js + "," + b.js + ")", ty: t, c };
                }
                if (op === "**")
                    return { js: "Math.pow(" + a.js + "," + b.js + ")", ty: t.k === "elem" && t.info.cat === "real" ? t : REAL, c };
                return { js: r32("(" + a.js + op + b.js + ")"), ty: t, c };
            }
            case "call": return fnCall(e, cx, true) || { js: "0", ty: INT };
        }
    }
    /** Výchozí kontext proměnných: blok (vč. metody → vlastník) a globální jména. */
    function lookupLocal(cx, K) {
        if (!cx.def)
            return undefined;
        return cx.def.map.get(K) || (cx.def.owner ? cx.def.owner.map.get(K) : undefined);
    }
    /* --------------------------------------------------------- OOP: metody, vlastnosti, rozhraní */
    /** Třída, v jejímž kódu se překládá (tělo FB nebo jeho metoda); program = žádná. */
    function classOf(cx) {
        const c = cx.def ? (cx.def.owner || cx.def) : undefined;
        return c && c.pou && fbs.get(c.key) === c ? c : undefined;
    }
    /** Klíč cesty odkazu (pro kontrolu `x <> 0` před voláním přes rozhraní). */
    function exprKey(e) {
        switch (e.k) {
            case "lit": return String(e.v);
            case "ref": return pathKey(e.path);
            case "un": return e.op + exprKey(e.e);
            case "bin": return "(" + exprKey(e.a) + e.op + exprKey(e.b) + ")";
            case "call": return "?" + e.pos.line + ":" + e.pos.col;
        }
    }
    function pathKey(parts) {
        return parts.map(pp => key(pp.name) + (pp.idx ? "[" + pp.idx.map(exprKey).join(",") + "]" : "")).join(".");
    }
    const pathText = (parts) => parts.map(pp => pp.name + (pp.idx ? "[…]" : "")).join(".");
    /** Odkazy ověřené podmínkou (`x <> 0`, i v konjunkci AND). */
    function guardKeys(c) {
        if (c.k === "bin" && c.op === "<>") {
            if (c.a.k === "ref" && c.b.k === "lit" && c.b.v === 0)
                return [pathKey(c.a.path)];
            if (c.b.k === "ref" && c.a.k === "lit" && c.a.v === 0)
                return [pathKey(c.b.path)];
        }
        if (c.k === "bin" && c.op === "AND")
            return [...guardKeys(c.a), ...guardKeys(c.b)];
        return [];
    }
    function guardCheck(prefix, cx, p) {
        if (!(cx.guards || []).includes(pathKey(prefix)))
            add("warn", "iface-guard", p, tr("Volání přes odkaz na rozhraní {ref} bez kontroly {ref} <> 0 — neplatný odkaz je za běhu výjimka", { ref: pathText(prefix) }), SRC_REF);
    }
    /** Přístup k metodě / vlastnosti (PRIVATE jen ve vlastním bloku, PROTECTED i v odvozených). */
    function accessCheck(md, cx, p, name) {
        const caller = classOf(cx), own = md.owner;
        if (!own)
            return;
        if (md.access === "PRIVATE" && caller !== own)
            add("error", "oop", p, tr("{name} je PRIVATE v bloku {fb} — zvenku nepřístupné", { name, fb: own.name }), SRC.cdsMethod);
        if (md.access === "PROTECTED" && !(caller && isA(caller, own)))
            add("error", "oop", p, tr("{name} je PROTECTED v bloku {fb} — přístupné jen v něm a v odvozených blocích", { name, fb: own.name }), SRC.cdsMethod);
    }
    /**
     * Dynamické volání metody (virtuální, podle třídy instance v jejím slotu __TID): pomocná
     * funkce se switch přes všechny neabstraktní třídy, které jsou `target` (blok) nebo ho
     * implementují (rozhraní). Rozhraní: argument R = adresa instance + 1, 0 = neplatný odkaz
     * → běhová chyba `nullref` (CODESYS / TwinCAT: výjimka při volání přes nulový odkaz).
     */
    const dispFns = new Map();
    const dispSrc = [];
    function dispatchFn(target, mkey, pkeys) {
        const id = target.k + ":" + target.def.key + ":" + mkey + ":" + pkeys.join(",");
        const hit = dispFns.get(id);
        if (hit)
            return hit;
        const fn = "D" + dispFns.size;
        dispFns.set(id, fn);
        const classes = [...fbs.values()].filter(f => f.pou && !f.abstract && (target.k === "fb" ? isA(f, target.def) : implementsItf(f, target.def)));
        const args = pkeys.map((_, i) => "a" + i);
        let s = "function " + fn + "(" + [target.k === "itf" ? "R" : "B", ...args].join(",") + ") {\n";
        if (target.k === "itf")
            s += "  if (!R) { rt.err = rt.err || 'nullref'; return 0; }\n  const B = R - 1;\n";
        s += "  switch (m[B]) {\n";
        for (const c of classes) {
            const md = c.methods.get(mkey);
            if (!md || md.abstract)
                continue;
            const sets = pkeys.map((k, i) => { const v = md.map.get(k); return v ? "m[B+" + v.off + "]=a" + i + "; " : ""; }).join("");
            s += "    case " + c.tid + ": " + sets + md.js + "(B); return " + (md.retSym ? "m[B+" + md.retSym.off + "]" : "0") + ";\n";
        }
        s += "  }\n  rt.err = rt.err || 'dispatch'; return 0;\n}\n";
        dispSrc.push(s);
        return fn;
    }
    const paramsOfMd = (md) => md.pou ? paramsOf(md.pou.vars) : [];
    /** Argumenty volání metody → klíče parametrů a hodnoty (už převedené na typ parametru). */
    function argList(params, e, cx, what) {
        const keys = [], vals = [];
        const ins = params.filter(x => x.kind === "in" || x.kind === "inout");
        e.args.forEach((a, i) => {
            const pr = a.name ? params.find(x => x.key === key(a.name)) : ins[i];
            if (!pr || a.out || pr.kind === "out") {
                add("error", "fb-param", a.pos, tr("Metoda {fn} nemá parametr {name}", { fn: what, name: a.name || String(i + 1) }), d.src.syntax);
                return;
            }
            if (keys.includes(pr.key))
                add("error", "fb-param", a.pos, tr("Parametr {name} je ve volání uveden vícekrát", { name: pr.name }), d.src.syntax);
            keys.push(pr.key);
            vals.push(assignJs(expr(a.e, cx), pr.ty, a.pos, tr("parametr {name}", { name: pr.name })));
        });
        return { keys, vals };
    }
    /** Vlastnost (GET / SET) bloku nebo rozhraní na adrese `at` (blok: adresa instance; rozhraní: slot odkazu). */
    function propAccess(pr, target, at, cx, write, p) {
        const PK = key(pr.name);
        let mkey;
        if (target.k === "fb") {
            const ps = pr, acc = write ? ps.setter : ps.getter;
            if (!acc) {
                add("error", "oop", p, write ? tr("Vlastnost {name} bloku {fb} nemá SET — je jen ke čtení", { name: ps.name, fb: target.def.name }) : tr("Vlastnost {name} bloku {fb} nemá GET — nelze ji číst", { name: ps.name, fb: target.def.name }), SRC_PROP);
                return { js: "0", ty: ps.ty };
            }
            accessCheck(acc, cx, p, ps.name);
            mkey = acc.key;
        }
        else {
            const ip = pr;
            if (write ? !ip.setterOk : !ip.getterOk) {
                add("error", "oop", p, write ? tr("Vlastnost {name} rozhraní {itf} nemá SET — je jen ke čtení", { name: ip.name, itf: target.def.name }) : tr("Vlastnost {name} rozhraní {itf} nemá GET — nelze ji číst", { name: ip.name, itf: target.def.name }), SRC.cdsItfProp);
                return { js: "0", ty: pr.ty };
            }
            mkey = (write ? "__SET_" : "__GET_") + PK;
        }
        const fn = dispatchFn(target, mkey, write ? [PK] : []);
        if (write)
            return { js: "", ty: pr.ty, set: (v) => fn + "(" + at + "," + v + ");" };
        return { js: fn + "(" + at + ")", ty: pr.ty };
    }
    /**
     * Volání metody (příkaz i výraz): `inst.M()`, `itf.M()`, `THIS^.M()`, `SUPER^.M()` a `M()`
     * uvnitř bloku. Vrací null, když nejde o metodu (volání instance / funkce řeší volající).
     */
    function invoke(e, cx) {
        const fn = e.fn, last = fn[fn.length - 1], MK = key(last.name);
        const cls = classOf(cx);
        const virt = (def, md, base) => {
            const { keys, vals } = argList(md.params || (md.params = paramsOfMd(md)), e, cx, md.name);
            return { js: dispatchFn({ k: "fb", def }, MK, keys) + "(" + [base, ...vals].join(",") + ")", ty: md.retTy || INT };
        };
        if (fn.length === 1) {
            if (last.loc || last.q || !cls || !cls.methods.has(MK) || cx.def.map.has(MK))
                return null;
            return virt(cls, cls.methods.get(MK), "b"); // M() = THIS^.M()
        }
        const head = key(fn[0].name);
        if (fn.length === 2 && (head === "THIS" || head === "SUPER") && !fn[0].loc && !fn[0].q) {
            if (!cls) {
                add("error", "oop", fn[0].pos, tr("{kw}^ jen v metodě nebo těle funkčního bloku", { kw: head }), SRC.cdsThis);
                return { js: "0", ty: INT };
            }
            if (head === "THIS") {
                const md = cls.methods.get(MK);
                if (!md) {
                    add("error", "fb-member", last.pos, tr("Blok {fb} nemá metodu {name}", { fb: cls.name, name: last.name }), SRC.cdsMethod);
                    return { js: "0", ty: INT };
                }
                return virt(cls, md, "b");
            }
            const md = cls.parent ? cls.parent.methods.get(MK) : undefined;
            if (!cls.parent) {
                add("error", "oop", fn[0].pos, tr("SUPER^ jen v bloku, který dědí (EXTENDS)"), SRC.cdsThis);
                return { js: "0", ty: INT };
            }
            if (!md) {
                add("error", "fb-member", last.pos, tr("Blok {fb} nemá metodu {name}", { fb: cls.parent.name, name: last.name }), SRC.cdsMethod);
                return { js: "0", ty: INT };
            }
            if (md.abstract) {
                add("error", "oop", last.pos, tr("Metoda {name} je v bloku {fb} ABSTRACT — přes SUPER^ ji nelze volat", { name: last.name, fb: md.owner.name }), SRC_ABS);
                return { js: "0", ty: INT };
            }
            accessCheck(md, cx, last.pos, last.name);
            const { keys, vals } = argList(md.params || (md.params = paramsOfMd(md)), e, cx, md.name);
            const sets = keys.map((k, i) => "m[b+" + md.map.get(k).off + "]=" + vals[i]);
            return { js: "(" + [...sets, md.js + "(b)", md.retSym ? "m[b+" + md.retSym.off + "]" : "0"].join(",") + ")", ty: md.retTy || INT };
        }
        const prefix = fn.slice(0, -1);
        const t = safeRefTy(prefix, cx);
        if (!t)
            return null;
        if (t.k === "fb" && t.def.pou && t.def.methods.has(MK)) {
            const inst = ref(prefix, cx, false, e.pos);
            const md = t.def.methods.get(MK);
            if (/^__(GET|SET)_/.test(MK))
                return null;
            accessCheck(md, cx, last.pos, last.name);
            return virt(t.def, md, inst.js.slice(2, -1));
        }
        if (t.k === "itf") {
            const im = t.def.methods.get(MK);
            if (!im) {
                add("error", "fb-member", last.pos, tr("Rozhraní {itf} nemá metodu {name}", { itf: t.def.name, name: last.name }), SRC_OOP);
                return { js: "0", ty: INT };
            }
            const r = ref(prefix, cx, false, e.pos);
            guardCheck(prefix, cx, e.pos);
            const { keys, vals } = argList(im.params, e, cx, im.name);
            return { js: dispatchFn({ k: "itf", def: t.def }, MK, keys) + "(" + [r.js, ...vals].join(",") + ")", ty: im.retTy || INT };
        }
        return null;
    }
    /** Odkaz na proměnnou (případně člen / prvek pole) → JS výraz nad m[]. */
    function ref(path, cx, write, p) {
        /* THIS^.x = proměnná bloku (i když ji zakrývá lokální proměnná metody) */
        let thisOnly = false;
        if (path.length > 1 && key(path[0].name) === "THIS" && !path[0].loc && !path[0].q) {
            if (!classOf(cx)) {
                add("error", "oop", path[0].pos, tr("THIS^ jen v metodě nebo těle funkčního bloku"), SRC.cdsThis);
                return { js: "0", ty: INT };
            }
            path = path.slice(1);
            thisOnly = true;
        }
        const first = path[0];
        const K = key(first.name);
        let sym, base = "", off = 0, dyn = "", absolute = true;
        if (thisOnly) {
            sym = (cx.def.owner || cx.def).map.get(K);
            if (!sym || sym.key.startsWith("_")) {
                add("error", "fb-member", first.pos, tr("Blok {fb} nemá člen {name}", { fb: (cx.def.owner || cx.def).name, name: first.name }), d.src.syntax);
                return { js: "0", ty: INT };
            }
        }
        else if (d.scl && first.loc) {
            sym = lookupLocal(cx, K);
            if (!sym) {
                add("error", "undeclared", first.pos, tr("Lokální proměnná #{name} není deklarovaná", { name: first.name }), d.src.ident);
                return { js: "0", ty: INT };
            }
        }
        else if (d.scl && first.q) {
            sym = globals.get(K);
            if (!sym) {
                add("error", "undeclared", first.pos, tr("Globální tag / DB \"{name}\" neexistuje", { name: first.name }), d.src.ident);
                return { js: "0", ty: INT };
            }
        }
        else {
            sym = lookupLocal(cx, K);
            if (!sym && !cx.aoi) {
                sym = globals.get(K);
                if (!sym) {
                    /* nekvalifikovaný přístup ke GVL */
                    for (const g of globals.values())
                        if (g.ty.k === "ns" && g.ty.vars.has(K)) {
                            const s = g.ty.vars.get(K);
                            if (g.ty.qualifiedOnly)
                                add("error", "qualified-only", first.pos, tr("{name} je v GVL {gvl} s {attribute 'qualified_only'} — piš {gvl}.{name}", { name: first.name, gvl: g.name }), "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_pragma_attribute_qualified_only.html");
                            sym = s;
                            break;
                        }
                }
                if (!sym && path.length === 2) {
                    const t = typeDecls.has(K) ? resolveTypeName(first.name, first.pos) : types.get(K);
                    if (t && t.k === "enum") {
                        const v = t.values.get(key(path[1].name));
                        if (v === undefined)
                            add("error", "undeclared", path[1].pos, tr("Výčet {type} nemá hodnotu {name}", { type: t.name, name: path[1].name }), d.src.ident);
                        return { js: String(v ?? 0), ty: t, c: v ?? 0 };
                    }
                }
            }
            if (!sym) {
                if (fbs.has(K) || d.stdFbs.has(K))
                    add("error", "undeclared", first.pos, tr("{name} je typ bloku, ne proměnná", { name: first.name }), d.src.ident);
                else
                    add("error", "undeclared", first.pos, cx.aoi ? tr("Identifikátor {name} není parametr ani lokální tag Add-On Instruction", { name: first.name }) : tr("Nedeklarovaný identifikátor {name}", { name: first.name }), d.src.ident);
                return { js: "0", ty: INT };
            }
        }
        const local = thisOnly || (!!lookupLocal(cx, K) && !(d.scl && first.q));
        if (local) {
            base = cx.base;
            absolute = cx.base === "";
        }
        off = sym.off;
        let ty = sym.ty;
        if (sym.byRef) { // odkaz na objekt osy: slot = adresa + 1
            base = "(m[" + (absolute ? String(off) : base + "+" + off) + "]-1)";
            off = 0;
            absolute = false;
        }
        if (sym.constVal !== undefined && path.length === 1 && !first.idx) {
            if (write)
                add("error", "syntax", p, tr("Do konstanty {name} nelze zapisovat", { name: first.name }), d.src.syntax);
            return { js: String(sym.constVal), ty, c: sym.constVal };
        }
        const index = (part) => {
            if (!part.idx)
                return;
            if (ty.k !== "array") {
                add("error", "type-conv", part.pos, tr("{name} není pole", { name: part.name }), d.src.conv);
                return;
            }
            const arr = ty;
            const es = sizeOf(arr.of);
            let stride = es;
            const terms = [];
            for (let i = arr.dims.length - 1; i >= 0; i--) {
                const iv = part.idx[i] ? expr(part.idx[i], cx) : { js: "0", ty: INT };
                if (!isInt(iv.ty) && !(iv.ty.k === "elem" && iv.ty.lit))
                    add("error", "type-conv", part.pos, tr("Index pole musí být celé číslo"), d.src.conv);
                helpersUsed.add("idx");
                terms.push("ix(" + iv.js + "," + arr.dims[i][0] + "," + arr.dims[i][1] + ")*" + stride);
                stride *= arr.dims[i][1] - arr.dims[i][0] + 1;
            }
            dyn += "+" + terms.join("+");
            ty = arr.of;
        };
        index(first);
        for (let i = 1; i < path.length; i++) {
            const part = path[i], PK = key(part.name);
            if (ty.k === "ns") {
                const s = ty.vars.get(PK);
                if (!s) {
                    add("error", "undeclared", part.pos, tr("GVL {gvl} nemá proměnnou {name}", { gvl: ty.name, name: part.name }), d.src.ident);
                    return { js: "0", ty: INT };
                }
                off = s.off;
                base = "";
                absolute = true;
                ty = s.ty;
                if (s.constVal !== undefined)
                    return { js: String(s.constVal), ty, c: s.constVal };
            }
            else if (ty.k === "fb" && !ty.def.map.has(PK) && ty.def.props && ty.def.props.has(PK)) {
                /* vlastnost bloku: čtení = GET, zápis = SET (dynamicky podle třídy instance) */
                const at = absolute ? String(off) + dyn : base + "+" + off + dyn;
                if (i < path.length - 1 || part.idx) {
                    add("error", "oop", part.pos, tr("Za vlastností {name} emulátor další člen ani index nepodporuje", { name: part.name }), SRC_PROP);
                    return { js: "0", ty: INT };
                }
                return propAccess(ty.def.props.get(PK), { k: "fb", def: ty.def }, at, cx, write, part.pos);
            }
            else if (ty.k === "itf") {
                /* rozhraní: jen vlastnosti (metody se volají) */
                const ip = ty.def.props.get(PK);
                if (!ip) {
                    add("error", "fb-member", part.pos, ty.def.methods.has(PK) ? tr("Metoda {name} rozhraní {itf} se volá se závorkami", { name: part.name, itf: ty.def.name }) : tr("Rozhraní {itf} nemá vlastnost {name}", { itf: ty.def.name, name: part.name }), SRC_OOP);
                    return { js: "0", ty: INT };
                }
                if (i < path.length - 1 || part.idx) {
                    add("error", "oop", part.pos, tr("Za vlastností {name} emulátor další člen ani index nepodporuje", { name: part.name }), SRC_PROP);
                    return { js: "0", ty: INT };
                }
                const at = absolute ? String(off) + dyn : base + "+" + off + dyn;
                guardCheck(path.slice(0, i), cx, part.pos);
                return propAccess({ name: ip.name, ty: ip.ty, pos: ip.pos, getterOk: ip.get, setterOk: ip.set }, { k: "itf", def: ty.def }, "m[" + at + "]", cx, write, part.pos);
            }
            else if (ty.k === "fb") {
                const s = ty.def.map.get(PK);
                if (!s || s.key.startsWith("_")) {
                    add("error", "fb-member", part.pos, tr("Blok {fb} nemá člen {name}", { fb: ty.def.name, name: part.name }), d.src.syntax);
                    return { js: "0", ty: INT };
                }
                if (s.kind === "temp" || s.kind === "const")
                    add("error", "fb-member", part.pos, tr("Člen {name} bloku {fb} není zvenku přístupný", { fb: ty.def.name, name: part.name }), d.src.syntax);
                if (write && s.kind === "out" && !ty.def.aoi && !d.statementsOnly)
                    add("error", "fb-member", part.pos, tr("Do výstupu {name} instance bloku {fb} nelze zvenku zapisovat", { fb: ty.def.name, name: part.name }), d.src.syntax);
                if (ty.def.std && !write && (s.key === "ET" || s.key === "ACC" || s.key === "VALUEOUT"))
                    readsTime = true;
                if (ty.def.aoi && s.kind === "var")
                    add("error", "fb-member", part.pos, tr("Lokální tag {name} Add-On Instruction {fb} není zvenku přístupný", { fb: ty.def.name, name: part.name }), d.src.syntax);
                off += s.off;
                ty = s.ty;
            }
            else if (ty.k === "elem" && /^%X\d+$/i.test(PK) && (ty.info.cat === "bits" || ty.info.cat === "sint" || ty.info.cat === "uint")) {
                /* SCL: bit slova (#Axis.StatusWord.%X5) — jen čtení */
                const bit = +PK.slice(2);
                if (!d.scl)
                    add("error", "syntax", part.pos, tr("Bitový přístup {name} je zápis SCL (TIA)", { name: part.name }), d.src.syntax);
                if (bit >= ty.info.bits)
                    add("error", "fb-member", part.pos, tr("Bit {name} je mimo typ {type}", { name: part.name, type: tyName(ty) }), d.src.syntax);
                if (write)
                    add("error", "fb-member", part.pos, tr("Do bitu {name} člena osy nelze zapisovat", { name: part.name }), d.src.syntax);
                if (i < path.length - 1) {
                    add("error", "fb-member", part.pos, tr("Za bitem {name} nemůže být další člen", { name: part.name }), d.src.syntax);
                    return { js: "0", ty: INT };
                }
                const at = absolute ? String(off) + dyn : base + "+" + off + dyn;
                return { js: "((m[" + at + "]>>>" + bit + ")&1)", ty: BOOL };
            }
            else if (ty.k === "struct") {
                const s = ty.map.get(PK);
                if (!s) {
                    add("error", "fb-member", part.pos, tr("Struktura {type} nemá člen {name}", { type: ty.name, name: part.name }), d.src.syntax);
                    return { js: "0", ty: INT };
                }
                if (s.ro && write)
                    add("error", "fb-member", part.pos, tr("Člen {name} objektu osy je jen ke čtení (zapisuje ho technologický objekt / osa)", { name: part.name }), d.src.syntax);
                off += s.off;
                ty = s.ty;
            }
            else {
                add("error", "fb-member", part.pos, tr("{name} nemá členy (typ {type})", { name: path[i - 1].name, type: tyName(ty) }), d.src.syntax);
                return { js: "0", ty: INT };
            }
            index(part);
        }
        const addr = absolute ? String(off) + dyn : base + "+" + off + dyn;
        return { js: "m[" + addr + "]", ty };
    }
    /** Volání funkce ve výrazu (INT_TO_REAL, LIMIT …). */
    function fnCall(e, cx, inExpr) {
        const name = e.fn.map(x => x.name).join(".");
        const N = key(name);
        const args = e.args;
        const named = (n) => args.find(a => a.name && key(a.name) === n);
        const pos = (i, n) => (n ? named(n) : undefined) || args.filter(a => !a.name)[i];
        const argV = (a) => a ? expr(a.e, cx) : (add("error", "fb-param", e.pos, tr("Funkce {fn}: chybí argument", { fn: name }), d.src.syntax), { js: "0", ty: INT });
        const conv = /^([A-Z]+)_TO_([A-Z]+)$/.exec(N);
        if (conv && e.fn.length === 1) {
            const [, f, t] = conv;
            if (!d.convFns)
                add("error", "logix-construct", e.pos, tr("Převodní funkce {fn} na této platformě neexistuje (převody jsou implicitní)", { fn: name }), d.src.syntax);
            if (!ELEM[f] || !ELEM[t]) {
                add("error", "unknown-function", e.pos, tr("Neznámá funkce {fn}", { fn: name }), d.src.syntax);
                return { js: "0", ty: INT };
            }
            if (args.length !== 1)
                add("error", "fb-param", e.pos, tr("Funkce {fn} má jeden argument", { fn: name }), d.src.syntax);
            const v = argV(args[0]);
            if (v.ty.k === "elem" && !v.ty.lit && v.ty.name !== f) {
                const lvl = d.conv({ ...v.ty.info, name: v.ty.name }, { ...ELEM[f], name: f });
                if (lvl !== "ok")
                    lvlAdd(lvl, "type-conv", e.pos, tr("{fn}: argument je {t}, očekáváno {f}", { fn: name, t: v.ty.name, f }), d.src.conv);
            }
            const tt = elem(t);
            let js = v.js;
            if (ELEM[f].cat === "real" && ELEM[t].cat !== "real")
                js = d.truncReal ? "Math.trunc(" + js + ")" : "rnd(" + js + ")";
            return { js: (WRAP[t] || (x => x))(js), ty: tt };
        }
        if (e.fn.length === 1 && d.fns.has(N)) {
            if (N === "TO_REAL" || N === "TO_INT" || N === "TO_DINT" || N === "TO_UINT" || N === "TO_UDINT" || N === "TO_BOOL") {
                const v = argV(args[0]);
                const t = N === "TO_REAL" ? "REAL" : N === "TO_BOOL" ? "BOOL" : N.slice(3);
                let js = v.js;
                if (v.ty.k === "elem" && v.ty.info.cat === "real" && t !== "REAL")
                    js = "Math.trunc(" + js + ")"; // UniLogic: ořez k nule
                return { js: (WRAP[t] || (x => x))(js), ty: elem(t) };
            }
            if (N === "LIMIT") {
                const mn = argV(pos(0, "MN")), iv = argV(pos(1, "IN")), mx = argV(pos(2, "MX"));
                const t = common(common(mn.ty, iv.ty, e.pos, N), mx.ty, e.pos, N);
                return { js: "Math.min(Math.max(" + iv.js + "," + mn.js + ")," + mx.js + ")", ty: t };
            }
            if (N === "MIN" || N === "MAX") {
                const vs = args.map(a => expr(a.e, cx));
                if (vs.length < 2)
                    add("error", "fb-param", e.pos, tr("Funkce {fn}: chybí argument", { fn: name }), d.src.syntax);
                const t = vs.reduce((acc, v) => common(acc, v.ty, e.pos, N), vs[0] ? vs[0].ty : INT);
                return { js: "Math." + N.toLowerCase() + "(" + vs.map(v => v.js).join(",") + ")", ty: t };
            }
            if (N === "SEL") {
                const g = argV(pos(0, "G")), a = argV(pos(1, "IN0")), b = argV(pos(2, "IN1"));
                if (!isBool(g.ty))
                    add("error", "type-conv", e.pos, tr("SEL: selektor musí být BOOL"), d.src.conv);
                return { js: "(" + g.js + "?" + b.js + ":" + a.js + ")", ty: common(a.ty, b.ty, e.pos, N) };
            }
            if (N === "MOVE") {
                const v = argV(args[0]);
                return v;
            }
            if (N === "ABS") {
                const v = argV(args[0]);
                return { js: "Math.abs(" + v.js + ")", ty: v.ty };
            }
            if (N === "TRUNC") {
                const v = argV(args[0]);
                return { js: "Math.trunc(" + v.js + ")", ty: DINT };
            }
            if (N === "ROUND") {
                const v = argV(args[0]);
                return { js: "Math.round(" + v.js + ")", ty: DINT };
            }
            if (N === "CEIL" || N === "FLOOR") {
                const v = argV(args[0]);
                return { js: "Math." + N.toLowerCase() + "(" + v.js + ")", ty: DINT };
            }
            if (N === "NORM_X") {
                const mn = argV(pos(0, "MIN")), v = argV(pos(1, "VALUE")), mx = argV(pos(2, "MAX"));
                return { js: "((" + v.js + "-" + mn.js + ")/(" + mx.js + "-" + mn.js + "))", ty: REAL };
            }
            if (N === "SCALE_X") {
                const mn = argV(pos(0, "MIN")), v = argV(pos(1, "VALUE")), mx = argV(pos(2, "MAX"));
                return { js: "(" + v.js + "*(" + mx.js + "-" + mn.js + ")+" + mn.js + ")", ty: REAL };
            }
            if (N === "DEG" || N === "RAD") {
                const v = argV(args[0]);
                return { js: "(" + v.js + (N === "DEG" ? "*180/Math.PI)" : "*Math.PI/180)"), ty: REAL };
            }
            const M = { SQRT: "sqrt", LN: "log", LOG: "log10", EXP: "exp", SIN: "sin", COS: "cos", TAN: "tan", ASIN: "asin", ACOS: "acos", ATAN: "atan" };
            if (M[N]) {
                const v = argV(args[0]);
                return { js: "Math." + M[N] + "(" + v.js + ")", ty: v.ty.k === "elem" && v.ty.info.cat === "real" && !v.ty.lit ? v.ty : REAL };
            }
            if (N === "EXPT") {
                const a = argV(args[0]), b = argV(args[1]);
                return { js: "Math.pow(" + a.js + "," + b.js + ")", ty: REAL };
            }
        }
        /* uživatelská funkce */
        const pou = e.fn.length === 1 ? pouByKey.get(N) : undefined;
        if (pou && pou.kind === "function") {
            add("info", "syntax", e.pos, tr("Volání uživatelské funkce {fn} se v emulátoru nevyhodnocuje (vrací 0)", { fn: name }));
            return { js: "0", ty: pou.retType ? resolveSpec(pou.retType) : INT };
        }
        if (inExpr) {
            /* metoda bloku / rozhraní ve výrazu */
            const mv = invoke(e, cx);
            if (mv)
                return mv;
            if (fbs.has(N) || d.stdFbs.has(N))
                add("error", "syntax", e.pos, tr("Blok {fn} nelze volat ve výrazu", { fn: name }), d.src.syntax);
            else
                add("error", "unknown-function", e.pos, tr("Neznámá funkce {fn} (na platformě {plat} není)", { fn: name, plat: d.label }), d.src.syntax);
            return { js: "0", ty: INT };
        }
        return undefined;
    }
    /* --------------------------------------------------------- příkazy */
    let loopId = 0;
    const mcUsed = new Map();
    function stmts(list, cx, ind, loop) {
        return list.map(s => stmt(s, cx, ind, loop)).join("");
    }
    function condJs(e, cx, what) {
        const v = expr(e, cx);
        if (!isBool(v.ty) && !(d.looseBool && isNum(v.ty)))
            add("error", "condition", e.pos, tr("Podmínka {what} musí být BOOL (je {t})", { what, t: tyName(v.ty) }), d.src.conv);
        return v.js;
    }
    function stmt(s, cx, ind, loop) {
        switch (s.k) {
            case "empty": return "";
            case "assign": {
                if (s.lhs.k !== "ref") {
                    add("error", "syntax", s.pos, tr("Levá strana přiřazení musí být proměnná"));
                    return "";
                }
                const l = ref(s.lhs.path, cx, true, s.pos);
                if (l.set)
                    return ind + l.set(assignJs(expr(s.rhs, cx), l.ty, s.pos, tr("přiřazení do {name}", { name: s.lhs.path.map(x => x.name).join(".") }))) + "\n";
                if (l.c !== undefined || !l.js.startsWith("m["))
                    return "";
                if (l.ty.k === "itf") {
                    /* odkaz na rozhraní: instance bloku, který rozhraní implementuje, jiný odkaz téhož rozhraní, nebo 0 */
                    const r = expr(s.rhs, cx), it = l.ty.def;
                    if (r.ty.k === "fb" && r.js.startsWith("m[")) {
                        if (!implementsItf(r.ty.def, it))
                            add("error", "type-conv", s.pos, tr("Blok {fb} neimplementuje rozhraní {itf} (chybí IMPLEMENTS) — instanci nelze přiřadit", { fb: r.ty.def.name, itf: it.name }), SRC_OOP);
                        return ind + l.js + "=(" + r.js.slice(2, -1) + ")+1;\n";
                    }
                    if (r.ty.k === "itf") {
                        if (r.ty.def !== it)
                            add("error", "type-conv", s.pos, tr("Odkaz na rozhraní {a} nelze přiřadit do {b}", { a: r.ty.def.name, b: it.name }), SRC_OOP);
                        return ind + l.js + "=" + r.js + ";\n";
                    }
                    if (r.c === 0)
                        return ind + l.js + "=0;\n";
                    add("error", "type-conv", s.pos, tr("{what}: nelze přiřadit {from} do {to}", { what: tr("přiřazení do {name}", { name: s.lhs.path.map(x => x.name).join(".") }), from: tyName(r.ty), to: it.name }), d.src.conv);
                    return "";
                }
                if (l.ty.k === "fb" || l.ty.k === "ns") {
                    add("error", "type-conv", s.pos, tr("Instanci bloku nelze přiřadit"), d.src.conv);
                    return "";
                }
                const r = expr(s.rhs, cx);
                return ind + l.js + "=" + assignJs(r, l.ty, s.pos, tr("přiřazení do {name}", { name: s.lhs.path.map(x => x.name).join(".") })) + ";\n";
            }
            case "if": {
                let js = "";
                s.conds.forEach((c, i) => {
                    /* větev za `IF itf <> 0` smí volat přes itf (kontrola iface-guard) */
                    const g = guardKeys(c.c), bcx = g.length ? { ...cx, guards: [...(cx.guards || []), ...g] } : cx;
                    js += (i ? " else if (" : ind + "if (") + condJs(c.c, cx, "IF") + ") {\n" + stmts(c.body, bcx, ind + "  ", loop) + ind + "}";
                });
                if (s.els)
                    js += " else {\n" + stmts(s.els, cx, ind + "  ", loop) + ind + "}";
                return js + "\n";
            }
            case "case": {
                const sel = expr(s.sel, cx);
                if (!isInt(sel.ty) && sel.ty.k !== "enum" && !(sel.ty.k === "elem" && sel.ty.lit) && !isBits(sel.ty))
                    add("error", "case-label", s.sel.pos, tr("Selektor CASE musí být celé číslo nebo výčet (je {t})", { t: tyName(sel.ty) }), d.src.syntax);
                const seen = new Map();
                let simple = true;
                const brs = s.branches.map(b => b.labels.map(l => {
                    const lo = constOf(l.lo, cx.def) ?? enumConst(l.lo), hi = l.hi ? (constOf(l.hi, cx.def) ?? enumConst(l.hi)) : undefined;
                    if (lo === undefined || (l.hi && hi === undefined)) {
                        add("error", "case-label", l.lo.pos, tr("Návěští CASE musí být konstanta"), d.src.syntax);
                        return { lo: 0, hi: undefined };
                    }
                    if (hi !== undefined)
                        simple = false;
                    for (let v = lo; v <= (hi ?? lo) && v - lo < 10000; v++) {
                        if (seen.has(v))
                            add("error", "case-label", l.lo.pos, tr("Návěští CASE {v} je uvedeno vícekrát (poprvé na řádku {line})", { v, line: seen.get(v).line }), d.src.syntax);
                        else
                            seen.set(v, l.lo.pos);
                    }
                    return { lo, hi };
                }));
                const id = "c" + (loopId++);
                if (simple) {
                    let js = ind + "switch (" + sel.js + ") {\n";
                    s.branches.forEach((b, i) => {
                        js += brs[i].map(l => ind + "  case " + l.lo + ":").join("\n") + "\n" + stmts(b.body, cx, ind + "    ", loop) + ind + "    break;\n";
                    });
                    if (s.els)
                        js += ind + "  default:\n" + stmts(s.els, cx, ind + "    ", loop) + ind + "    break;\n";
                    return js + ind + "}\n";
                }
                let js = ind + "{ const " + id + "=" + sel.js + ";\n";
                s.branches.forEach((b, i) => {
                    const cond = brs[i].map(l => l.hi !== undefined ? "(" + id + ">=" + l.lo + "&&" + id + "<=" + l.hi + ")" : id + "===" + l.lo).join("||");
                    js += ind + (i ? "else if (" : "if (") + cond + ") {\n" + stmts(b.body, cx, ind + "  ", loop) + ind + "}\n";
                });
                if (s.els)
                    js += ind + (s.branches.length ? "else {\n" : "{\n") + stmts(s.els, cx, ind + "  ", loop) + ind + "}\n";
                return js + ind + "}\n";
            }
            case "for": {
                if (s.v.k !== "ref")
                    return "";
                const v = ref(s.v.path, cx, true, s.pos);
                if (!isInt(v.ty))
                    add("error", "type-conv", s.pos, tr("Proměnná cyklu FOR musí být celé číslo"), d.src.conv);
                const from = expr(s.from, cx), to = expr(s.to, cx), by = s.by ? expr(s.by, cx) : { js: "1", ty: ANYINT, c: 1 };
                const L = "L" + (loopId++);
                return ind + "{ const " + L + "t=" + to.js + ", " + L + "s=" + by.js + "; let " + L + "g=0;\n" + ind + L + ": for (" + v.js + "=" + from.js + "; " + L + "s>=0 ? " + v.js + "<=" + L + "t : " + v.js + ">=" + L + "t; " + v.js + "+=" + L + "s) {\n"
                    + ind + "  if (++" + L + "g>100000) throw new Error('loop');\n" + stmts(s.body, cx, ind + "  ", L) + ind + "} }\n";
            }
            case "while": {
                const L = "L" + (loopId++);
                return ind + "{ let " + L + "g=0;\n" + ind + L + ": while (" + condJs(s.c, cx, "WHILE") + ") {\n" + ind + "  if (++" + L + "g>100000) throw new Error('loop');\n" + stmts(s.body, cx, ind + "  ", L) + ind + "} }\n";
            }
            case "repeat": {
                const L = "L" + (loopId++);
                return ind + "{ let " + L + "g=0;\n" + ind + L + ": do {\n" + ind + "  if (++" + L + "g>100000) throw new Error('loop');\n" + stmts(s.body, cx, ind + "  ", L) + ind + "} while (!(" + condJs(s.c, cx, "UNTIL") + ")); }\n";
            }
            case "exit":
                if (!loop) {
                    add("error", "syntax", s.pos, tr("EXIT mimo cyklus"));
                    return "";
                }
                return ind + "break " + loop + ";\n";
            case "continue":
                if (!loop) {
                    add("error", "syntax", s.pos, tr("CONTINUE mimo cyklus"));
                    return "";
                }
                return ind + "continue " + loop + ";\n";
            case "return":
                if (d.plat === "rockwell")
                    add("error", "logix-construct", s.pos, tr("RETURN není konstrukce Logix ST (a instrukce RET je v AOI zakázaná)"), "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm007_-en-p.pdf");
                if (d.plat === "unitronics")
                    add("warn", "unitronics-fb", s.pos, tr("RETURN ukončí celou ST funkci UniLogic, ne jen blok"), "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Ladder/Structured_Text_Functions.htm");
                return ind + "return;\n";
            case "region": return stmts(s.body, cx, ind, loop);
            case "call": return callStmt(s.call, cx, ind);
        }
    }
    function enumConst(e) {
        if (e.k === "ref" && e.path.length === 1) {
            for (const t of types.values())
                if (t.k === "enum" && t.values.has(key(e.path[0].name)))
                    return t.values.get(key(e.path[0].name));
        }
        return undefined;
    }
    /** Volání instance bloku / AOI / časovače jako příkaz. */
    function callStmt(e, cx, ind) {
        const N = key(e.fn.map(x => x.name).join("."));
        /* Logix: AOI(instance) a TONR(timer) */
        if (e.fn.length === 1 && !e.fn[0].loc && !e.fn[0].q) {
            const tdef = fbs.get(N);
            const isLogixTimer = d.plat === "rockwell" && ["TONR", "TOFR", "RTOR"].includes(N);
            if ((tdef && tdef.aoi) || isLogixTimer) {
                const a0 = e.args[0];
                if (!a0 || a0.name || a0.e.k !== "ref") {
                    add("error", "fb-param", e.pos, tr("{fn}: prvním argumentem musí být instanční tag", { fn: e.fn[0].name }), d.src.syntax);
                    return "";
                }
                if (e.args.length > 1)
                    add("error", "fb-param", e.pos, tr("{fn}: povinné parametry v ST zde nejsou definované — nepovinné se zapisují jako členy instance", { fn: e.fn[0].name }), "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm010_-en-p.pdf");
                const inst = ref(a0.e.path, cx, false, a0.pos);
                const want = isLogixTimer ? "FBD_TIMER" : tdef.key;
                if (inst.ty.k !== "fb" || inst.ty.def.key !== want) {
                    add("error", "fb-param", a0.pos, tr("{inst} není instance typu {type}", { inst: a0.e.path.map(x => x.name).join("."), type: isLogixTimer ? "FBD_TIMER" : tdef.name }), d.src.syntax);
                    return "";
                }
                const b = inst.js.slice(2, -1);
                if (isLogixTimer) {
                    helpersUsed.add(N);
                    return ind + N.toLowerCase() + "(" + b + ");\n";
                }
                return ind + "m[" + b + "+" + tdef.map.get("ENABLEIN").off + "]=1; " + tdef.js + "(" + b + ");\n";
            }
        }
        /* Logix: instrukce pohybu MSO / MAM … (osa, MOTION_INSTRUCTION, operandy — MOTION-RM002) */
        if (d.plat === "rockwell" && e.fn.length === 1 && LX_MOTION_INSTR[N] !== undefined) {
            const want = LX_MOTION_INSTR[N];
            if (e.args.length !== want || e.args.some(a => a.name)) {
                add("error", "fb-param", e.pos, tr("{fn}: v ST má {n} pozičních operandů", { fn: N, n: want }), "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/motion-rm002_-en-p.pdf");
                return "";
            }
            const ax = e.args[0], mi = e.args[1];
            if (ax.e.k !== "ref" || mi.e.k !== "ref") {
                add("error", "fb-param", e.pos, tr("{fn}: první dva operandy jsou tag osy a tag MOTION_INSTRUCTION", { fn: N }), "https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/motion-rm002_-en-p.pdf");
                return "";
            }
            const a = ref(ax.e.path, cx, false, ax.pos), m2 = ref(mi.e.path, cx, true, mi.pos);
            if (!(a.ty.k === "struct" && a.ty.axis))
                add("error", "fb-param", ax.pos, tr("{fn}: operand Axis musí být tag osy (AXIS_CIP_DRIVE)", { fn: N }), d.src.syntax);
            if (!(m2.ty.k === "struct" && m2.ty.name === "MOTION_INSTRUCTION"))
                add("error", "fb-param", mi.pos, tr("{fn}: operand Motion Control musí být tag MOTION_INSTRUCTION", { fn: N }), d.src.syntax);
            const rest = e.args.slice(2).map(x => { const v = expr(x.e, cx); if (!isNum(v.ty) && !isBool(v.ty))
                add("error", "fb-param", x.pos, tr("{fn}: operand musí být číslo nebo tag", { fn: N }), d.src.syntax); return v.js; });
            if (!a.js.startsWith("m[") || !m2.js.startsWith("m["))
                return "";
            return ind + "mc.lxExec(" + JSON.stringify(N) + ", m, " + a.js.slice(2, -1) + ", " + m2.js.slice(2, -1) + ", [" + rest.join(",") + "]);\n";
        }
        /* Tc2_MC2: Axis.ReadStatus() — obnoví Axis.Status (akce AXIS_REF) */
        if (e.fn.length >= 2 && key(e.fn[e.fn.length - 1].name) === "READSTATUS" && !e.args.length) {
            const t = safeRefTy(e.fn.slice(0, -1), cx);
            if (t && t.k === "struct" && t.axis) {
                if (motion?.dialect !== "tc")
                    add("error", "fb-member", e.pos, tr("ReadStatus je akce AXIS_REF knihovny Tc2_MC2 (TwinCAT)"), d.src.syntax);
                const r = ref(e.fn.slice(0, -1), cx, false, e.pos);
                return r.js.startsWith("m[") ? ind + "mc.mcCall(\"readStatus\", m, 0, " + r.js.slice(2, -1) + ", null, \"tc\");\n" : "";
            }
        }
        /* metoda: inst.M(), itf.M(), THIS^.M(), SUPER^.M(), M() uvnitř bloku */
        const mv = invoke(e, cx);
        if (mv)
            return ind + mv.js + ";\n";
        /* instance bloku */
        const head = e.fn[0];
        const HK = key(head.name);
        const isVar = head.loc || head.q || lookupLocal(cx, HK) || (!cx.aoi && (globals.has(HK) || [...globals.values()].some(g => g.ty.k === "ns" && g.ty.vars.has(HK)))) || e.fn.length > 1;
        if (!isVar) {
            const v = fnCall(e, cx, false);
            if (v)
                return ind + v.js + ";\n";
            if (fbs.has(HK) || d.stdFbs.has(HK))
                add("error", "syntax", e.pos, tr("{fn} je typ bloku — volá se instance (deklaruj proměnnou typu {fn})", { fn: head.name }), d.src.syntax);
            else
                add("error", "undeclared", e.pos, tr("Nedeklarovaný identifikátor {name}", { name: head.name }), d.src.ident);
            return "";
        }
        const inst = ref(e.fn, cx, false, e.pos);
        if (inst.ty.k !== "fb") {
            if (inst.js !== "0")
                add("error", "syntax", e.pos, tr("{name} není instance bloku (typ {type}) — nelze volat", { name: e.fn.map(x => x.name).join("."), type: tyName(inst.ty) }), d.src.syntax);
            return "";
        }
        const def = inst.ty.def;
        if (d.plat === "rockwell")
            add("error", "logix-construct", e.pos, tr("Logix ST nevolá instance s parametry inst(par := …) — AOI se volá JménoAOI(instance), časovač TONR(tag)"), "https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm010_-en-p.pdf");
        if (d.plat === "unitronics" && !def.std)
            add("error", "unitronics-fb", e.pos, tr("UniLogic ST funkce nemá instance funkčních bloků"), "https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Ladder/Structured_Text_Functions.htm");
        const b = inst.js.slice(2, -1);
        const bv = "b" + (loopId++);
        const ins = [], outs = [];
        const inputs = def.vars.filter(v => v.kind === "in" || v.kind === "inout");
        const formal = e.args.some(a => a.name);
        if (formal && e.args.some(a => !a.name))
            add("error", "fb-param", e.pos, tr("Volání {fb}: nelze míchat pojmenované a poziční parametry", { fb: def.name }), d.src.syntax);
        const seenP = new Set();
        e.args.forEach((a, i) => {
            const s = a.name ? def.map.get(key(a.name)) : inputs[i];
            if (!s || s.key.startsWith("_") || s.kind === "var" || s.kind === "temp" || s.kind === "const" || s.kind === "stat") {
                add("error", "fb-param", a.pos, tr("Blok {fb} nemá parametr {name}", { fb: def.name, name: a.name || String(i + 1) }), d.src.syntax);
                return;
            }
            if (seenP.has(s.key))
                add("error", "fb-param", a.pos, tr("Parametr {name} je ve volání uveden vícekrát", { name: s.name }), d.src.syntax);
            seenP.add(s.key);
            if (a.out) {
                if (s.kind !== "out") {
                    add("error", "fb-param", a.pos, tr("{name} je vstup bloku {fb} — přiřazuje se :=, ne =>", { name: s.name, fb: def.name }), d.src.syntax);
                    return;
                }
                if (a.e.k !== "ref") {
                    add("error", "fb-param", a.pos, tr("Výstup {name} musí jít do proměnné", { name: s.name }), d.src.syntax);
                    return;
                }
                const t = ref(a.e.path, cx, true, a.pos);
                if (!t.js.startsWith("m["))
                    return;
                const v = { js: "m[" + bv + "+" + s.off + "]", ty: s.ty };
                outs.push(t.js + "=" + assignJs(v, t.ty, a.pos, tr("výstup {name}", { name: s.name })) + ";");
            }
            else {
                if (s.kind === "out") {
                    add("error", "fb-param", a.pos, tr("{name} je výstup bloku {fb} — čte se =>, ne :=", { name: s.name, fb: def.name }), d.src.syntax);
                    return;
                }
                if (s.byRef) {
                    /* objekt osy: předává se odkaz (adresa + 1) */
                    if (a.e.k !== "ref") {
                        add("error", "fb-param", a.pos, tr("Parametr {name} bloku {fb} musí dostat objekt osy, ne výraz", { name: s.name, fb: def.name }), d.src.syntax);
                        return;
                    }
                    const t = ref(a.e.path, cx, false, a.pos);
                    if (!t.js.startsWith("m["))
                        return;
                    if (tyName(t.ty) !== tyName(s.ty))
                        add("error", "type-conv", a.pos, tr("Parametr {name}: objekt osy typu {a}, blok {fb} čeká {b}", { name: s.name, a: tyName(t.ty), b: tyName(s.ty), fb: def.name }), d.src.conv);
                    ins.push("m[" + bv + "+" + s.off + "]=(" + t.js.slice(2, -1) + ")+1;");
                    return;
                }
                if (s.kind === "inout") {
                    /* VAR_IN_OUT = odkaz: kopie dovnitř a po volání zpět (v jednom scanu bez souběhu totéž) */
                    if (a.e.k !== "ref") {
                        add("error", "fb-param", a.pos, tr("VAR_IN_OUT {name} bloku {fb} musí dostat proměnnou, ne výraz", { name: s.name, fb: def.name }), d.src.syntax);
                        return;
                    }
                    const t = ref(a.e.path, cx, true, a.pos);
                    if (!t.js.startsWith("m[")) {
                        if (t.c !== undefined)
                            add("error", "fb-param", a.pos, tr("VAR_IN_OUT {name} bloku {fb} musí dostat proměnnou, ne výraz", { name: s.name, fb: def.name }), d.src.syntax);
                        return;
                    }
                    if (tyName(t.ty) !== tyName(s.ty))
                        add("error", "type-conv", a.pos, tr("VAR_IN_OUT {name}: typ {a} se musí shodovat s {b}", { name: s.name, a: tyName(t.ty), b: tyName(s.ty) }), d.src.conv);
                    ins.push("m[" + bv + "+" + s.off + "]=" + t.js + ";");
                    outs.push(t.js + "=m[" + bv + "+" + s.off + "];");
                    return;
                }
                const v = expr(a.e, cx);
                if (d.timerMaxMs && def.std && /^TON|^TOF|^TP/.test(def.std) && s.key === "PT" && v.c !== undefined && v.c > d.timerMaxMs)
                    add("warn", "timer-range", a.pos, tr("PT = {ms} ms je nad rozsahem časovače TON této platformy (0–{max} ms) — podle manuálu nebude program pracovat správně", { ms: v.c, max: d.timerMaxMs }), "https://dl.mitsubishielectric.com/dl/fa/document/manual/plcf/jy997d55801/jy997d55801z.pdf");
                ins.push("m[" + bv + "+" + s.off + "]=" + assignJs(v, s.ty, a.pos, tr("parametr {name}", { name: s.name })) + ";");
            }
        });
        if (!def.std && !def.aoi)
            for (const s of inputs)
                if (s.kind === "inout" && !seenP.has(s.key))
                    add("error", "fb-param", e.pos, tr("VAR_IN_OUT {name} bloku {fb} musí být ve volání přiřazen", { name: s.name, fb: def.name }), d.src.syntax);
        if (def.mc && !seenP.has("AXIS"))
            add("error", "fb-param", e.pos, tr("Blok {fb}: parametr Axis (objekt osy) musí být ve volání přiřazen", { fb: def.name }), d.src.syntax);
        let call;
        if (def.mc) {
            mcUsed.set(def.key, def);
            call = "mcFb(" + bv + "," + JSON.stringify(def.key) + ");";
        }
        else if (def.std) {
            helpersUsed.add(def.std);
            call = stdFn(def.std) + "(" + bv + ");";
        }
        else
            call = def.js + "(" + bv + ");";
        return ind + "{ const " + bv + "=" + b + "; " + ins.join(" ") + " " + call + (outs.length ? " " + outs.join(" ") : "") + " }\n";
    }
    function safeRefTy(path, cx) {
        const n = out.length;
        const v = ref(path, cx, false, path[0].pos);
        out.length = n; // jen zjištění typu, nálezy zahodit
        return v.js === "0" ? undefined : v.ty;
    }
    const stdFn = (std) => ({ TON_TIME: "ton", TOF_TIME: "tof", TP_TIME: "tp", TON: "ton", TOF: "tof", TP: "tp", R_TRIG: "rtrig", F_TRIG: "ftrig", RS: "rs", SR: "sr", CTU: "ctu", CTD: "ctd", CTUD: "ctud",
        TIMER_1_FB_M: "tmr1", TIMER_10_FB_M: "tmr10", TIMER_100_FB_M: "tmr100" }[std] || "noop");
    /* --------------------------------------------------------- generování */
    const fnSrc = [];
    const emitFb = (def) => {
        const cx = { def, base: "b", aoi: !!def.aoi, file: def.pos ? def.pos.file : "", loops: 0 };
        fnSrc.push("function " + def.js + "(b) {\n" + stmts(def.body || [], cx, "  ") + "}\n");
        for (const m of def.methods.values()) {
            if (m.owner !== def)
                continue;
            const mcx = { def: m, base: "b", aoi: false, file: cx.file, loops: 0 };
            fnSrc.push("function " + m.js + "(b) {\n" + stmts(m.body || [], mcx, "  ") + "}\n");
        }
    };
    for (const f of fbs.values())
        if (!f.std)
            emitFb(f);
    let entry = "";
    if ("program" in inp.entry) {
        const P = programs.get(key(inp.entry.program));
        if (!P)
            add("error", "undeclared", undefined, tr("Chybí program {name}", { name: inp.entry.program }));
        else {
            const g = globals.get(P.key);
            const cx = { def: P, base: String(g.off), aoi: false, file: P.pos ? P.pos.file : "", loops: 0 };
            fnSrc.push("function " + P.js + "(b) {\n" + stmts(P.body || [], cx, "  ") + "}\n");
            entry = P.js + "(" + g.off + ");";
        }
    }
    else {
        const cx = { base: "", aoi: false, file: inp.entry.file, loops: 0 };
        fnSrc.push("function ENTRY() {\n" + stmts(inp.entry.stmts, cx, "  ") + "}\n");
        entry = "ENTRY();";
    }
    /* --------------------------------------------------------- počáteční stav */
    const init = new Float64Array(Math.max(1, gsize));
    const timers = [];
    const etMask = new Uint8Array(Math.max(1, gsize));
    const initVal = (s, defOwner) => {
        if (s.constVal !== undefined)
            return s.constVal;
        if (s.initNum !== undefined)
            return s.initNum;
        if (s.init && d.initValues)
            return constOf(s.init, defOwner);
        return undefined;
    };
    const fill = (ty, at, v) => {
        if (ty.k === "elem" || ty.k === "enum") {
            if (v !== undefined)
                init[at] = ty.k === "elem" && ty.name === "REAL" ? Math.fround(v) : v;
            return;
        }
        if (ty.k === "itf")
            return; // odkaz na rozhraní: 0 = neplatný
        if (ty.k === "fb") {
            const def = ty.def;
            if (def.std) {
                timersCollect(def, at);
                return;
            }
            for (const s of def.vars)
                fill(s.ty, at + s.off, initVal(s, def));
            if (def.tid && def.map.get("__TID"))
                init[at + def.map.get("__TID").off] = def.tid; // třída instance
            return;
        }
        if (ty.k === "struct") {
            for (const s of ty.fields)
                fill(s.ty, at + s.off, initVal(s));
            return;
        }
        if (ty.k === "array") {
            const es = sizeOf(ty.of);
            for (let i = 0; i < ty.size / Math.max(1, es); i++)
                fill(ty.of, at + i * es, v);
            return;
        }
        if (ty.k === "ns") {
            for (const s of ty.vars.values())
                fill(s.ty, s.off, initVal(s));
        }
    };
    const timersCollect = (def, at) => {
        const et = TIMER_ET[def.std];
        if (et !== undefined) {
            timers.push({ kind: def.std, base: at });
            etMask[at + et] = 1;
        }
    };
    for (const g of globals.values())
        fill(g.ty, g.off, initVal(g));
    /* objekty os: konfigurace z konfiguračního listu (jak ji uživatel zadá v IDE) a poloha po zapnutí */
    const axisObjs = [];
    if (motion)
        for (const a of motion.axes) {
            let g = globals.get(key(a.name));
            if (!g)
                for (const gg of globals.values())
                    if (gg.ty.k === "ns" && gg.ty.vars.has(key(a.name))) {
                        g = gg.ty.vars.get(key(a.name));
                        break;
                    }
            const at = g ? { slot: g.off, ty: g.ty } : undefined;
            if (!at || at.ty.k !== "struct" || !at.ty.axis) {
                add("error", "undeclared", undefined, tr("Objekt osy {name} v programu chybí nebo nemá typ {type}", { name: a.name, type: AXIS_TYPE[motion.dialect] }));
                continue;
            }
            axisInit(init, at.slot, a.cfg);
            axisObjs.push({ name: a.name, base: at.slot });
        }
    const mcTable = [...mcUsed.values()].map(def => {
        const mc = def.mc, sp = mc.spec;
        return JSON.stringify(def.key) + ":{k:" + JSON.stringify(sp.kind) + ",M:" + JSON.stringify(mc.map) + ",p:" + JSON.stringify(mcPlatOf(motion.dialect)) +
            ",dir:" + mc.dirOff + ",pos:" + JSON.stringify(sp.dir?.pos || []) + ",neg:" + JSON.stringify(sp.dir?.neg || []) + "}";
    });
    const mcSrc = mcTable.length ? `
const MCD = {${mcTable.join(",")}};
function mcFb(b, key) {
  const d = MCD[key], p = m[b + d.M.axis];
  if (!(p > 0)) { rt.err = rt.err || 'nullref'; return; }
  let k = d.k;
  if (k === "vel") { const v = d.dir >= 0 ? m[b + d.dir] : 0; k = d.neg.indexOf(v) >= 0 ? "velN" : d.pos.indexOf(v) >= 0 ? "velP" : (m[b + d.M.vel] < 0 ? "velN" : "velP"); }
  mc.mcCall(k, m, b, p - 1, d.M, d.p);
}
` : "";
    /* --------------------------------------------------------- JS modul */
    const helpers = `
const fr = Math.fround;
const rnd = x => x < 0 ? -Math.round(-x) : Math.round(x);
const rndE = x => { const f = Math.floor(x), r = x - f; return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
function idiv(a, b) { if (b === 0) { rt.err = rt.err || 'div0'; return 0; } return Math.trunc(a / b); }
function rdiv(a, b) { if (b === 0) { rt.err = rt.err || 'div0'; return a === 0 ? 0 : (a > 0 ? Infinity : -Infinity); } return a / b; }
function imod(a, b) { if (b === 0) { rt.err = rt.err || 'div0'; return 0; } return a % b; }
function ix(i, lo, hi) { if (i < lo || i > hi) { rt.err = rt.err || 'index'; return 0; } return i - lo; }
function ton(b) { if (m[b]) { if (!m[b+5]) m[b+4] = now; let et = now - m[b+4]; if (et >= m[b+1]) { et = m[b+1]; m[b+2] = 1; } else m[b+2] = 0; m[b+3] = et; } else { m[b+2] = 0; m[b+3] = 0; } m[b+5] = m[b]; }
function tof(b) { if (m[b]) { m[b+2] = 1; m[b+3] = 0; } else { if (m[b+5]) m[b+4] = now; if (m[b+2]) { let et = now - m[b+4]; if (et >= m[b+1]) { et = m[b+1]; m[b+2] = 0; } m[b+3] = et; } } m[b+5] = m[b]; }
function tp(b) { if (m[b] && !m[b+5] && !m[b+2]) { m[b+4] = now; m[b+2] = 1; } if (m[b+2]) { let et = now - m[b+4]; if (et >= m[b+1]) { et = m[b+1]; m[b+2] = 0; } m[b+3] = et; } else if (!m[b]) m[b+3] = 0; m[b+5] = m[b]; }
function rtrig(b) { m[b+1] = m[b] && !m[b+2] ? 1 : 0; m[b+2] = m[b]; }
function ftrig(b) { m[b+1] = !m[b] && m[b+2] ? 1 : 0; m[b+2] = m[b]; }
function rs(b) { m[b+2] = !m[b+1] && (m[b] || m[b+2]) ? 1 : 0; }
function sr(b) { m[b+2] = m[b] || (!m[b+1] && m[b+2]) ? 1 : 0; }
function ctu(b) { if (m[b+1]) m[b+4] = 0; else if (m[b] && !m[b+5] && m[b+4] < 32767) m[b+4]++; m[b+3] = m[b+4] >= m[b+2] ? 1 : 0; m[b+5] = m[b]; }
function ctd(b) { if (m[b+1]) m[b+4] = m[b+2]; else if (m[b] && !m[b+5] && m[b+4] > -32768) m[b+4]--; m[b+3] = m[b+4] <= 0 ? 1 : 0; m[b+5] = m[b]; }
function ctud(b) { if (m[b+2]) m[b+7] = 0; else if (m[b+3]) m[b+7] = m[b+4]; else { if (m[b] && !m[b+8]) m[b+7]++; if (m[b+1] && !m[b+9]) m[b+7]--; } m[b+5] = m[b+7] >= m[b+4] ? 1 : 0; m[b+6] = m[b+7] <= 0 ? 1 : 0; m[b+8] = m[b]; m[b+9] = m[b+1]; }
function tonr(b) { m[b+4] = 1; if (m[b+2] < 0) { m[b+11] = 1; m[b+10] = 1; } if (m[b+3]) { m[b+5] = 0; m[b+8] = 0; m[b+7] = 0; m[b+6] = m[b+1]; } else if (m[b+1]) { if (!m[b+13]) m[b+12] = now; let acc = now - m[b+12]; if (acc >= m[b+2]) { acc = m[b+2]; m[b+8] = 1; m[b+7] = 0; } else { m[b+8] = 0; m[b+7] = 1; } m[b+5] = acc; m[b+6] = 1; } else { m[b+5] = 0; m[b+8] = 0; m[b+7] = 0; m[b+6] = 0; } m[b+13] = m[b+3] ? 0 : m[b+1]; }
function tmr(b, u) { const v0 = m[b+2] > 0 ? m[b+2] : 0; if (m[b]) { if (!m[b+6]) m[b+5] = now; let v = v0 + Math.floor((now - m[b+5]) / u + 1e-9); if (v >= m[b+1]) { v = Math.max(v0, m[b+1]); m[b+4] = 1; } else m[b+4] = 0; m[b+3] = v; } else { m[b+3] = v0; m[b+4] = 0; } m[b+6] = m[b]; }
function tmr1(b) { tmr(b, 1); }
function tmr10(b) { tmr(b, 10); }
function tmr100(b) { tmr(b, 100); }
function tofr(b) { tonr(b); }
function rtor(b) { tonr(b); }
function noop(b) {}
`;
    const src = '"use strict";\nlet now = 0;\nconst rt = { err: "" };\n' + helpers + mcSrc + fnSrc.join("\n") + dispSrc.join("\n") + "\nreturn { scan(t) { now = t; " + entry + " }, rt };\n";
    /* --------------------------------------------------------- adresy pro běh */
    const addr = (path) => {
        let s = globals.get(key(path[0]));
        if (!s) {
            for (const g of globals.values())
                if (g.ty.k === "ns" && g.ty.vars.has(key(path[0]))) {
                    s = g.ty.vars.get(key(path[0]));
                    break;
                }
        }
        if (!s)
            return undefined;
        let off = s.off, ty = s.ty;
        for (let i = 1; i < path.length; i++) {
            const K = key(path[i]);
            let m;
            if (ty.k === "ns") {
                m = ty.vars.get(K);
                if (m) {
                    off = m.off;
                    ty = m.ty;
                    continue;
                }
            }
            else if (ty.k === "fb")
                m = ty.def.map.get(K);
            else if (ty.k === "struct")
                m = ty.map.get(K);
            if (!m)
                return undefined;
            off += m.off;
            ty = m.ty;
        }
        return { slot: off, ty };
    };
    const ok = !out.some(f => f.level === "error");
    let make;
    if (ok) {
        try {
            const factory = new Function("m", "mc", src);
            make = (m) => factory(m, MC_RT);
        }
        catch (e) {
            add("error", "runtime", undefined, tr("Interní chyba emulátoru při sestavení programu: {msg}", { msg: e.message }));
        }
    }
    return { ok: ok && !!make, findings: out, size: gsize, init, src, make, addr, timers, etMask, readsTime, axisObjs };
}
