import { blankProject, devSignals, autoAddr, sanitizeTag, stripDia, roleExpr } from "./model.js";
import { tr, trIn, N_, LANGS } from "./i18n.js";
import { parseXml, xmlAll, xmlChild, xmlText, splitDelimited, guessDelimiter, canonAddr, isMemAddr, } from "./importers.js";
/* ====================================================================== pomocné */
const clone = (x) => JSON.parse(JSON.stringify(x));
const up = (s) => s.toUpperCase();
function lineAt(text, pos) {
    let n = 1;
    for (let i = 0; i < pos && i < text.length; i++)
        if (text.charCodeAt(i) === 10)
            n++;
    return n;
}
const quoteOf = (s) => s.trim().replace(/\s+/g, " ").slice(0, 160);
const ANALOG_DT = /^(INT|DINT|UINT|WORD|REAL|LREAL|SINT|USINT|UDINT|DWORD|INT16|UINT16|INT32|UINT32|FLOAT|WORD \[SIGNED\]|WORD \[UNSIGNED\/BIT STRING \[16-BIT\]\]|DOUBLE WORD.*|FLOAT.*)$/i;
const BOOL_DT = /^(BOOL|BIT|BOOLEAN)$/i;
/** Normalizovaný datový typ (BOOL / INT / REAL / …) z textu exportu. */
function normDt(dt) {
    const d = (dt || "").trim();
    if (!d)
        return "";
    if (BOOL_DT.test(d))
        return "BOOL";
    if (/^word \[signed\]$/i.test(d) || /^int16$/i.test(d))
        return "INT";
    if (/^float|^real$/i.test(d))
        return "REAL";
    if (/^double word/i.test(d))
        return "DINT";
    return d.toUpperCase();
}
/** Směr signálu z kanonické adresy, datového typu a jména. */
function dirOf(addr, dt, name) {
    if (/^%I\d+\.\d$/.test(addr))
        return "DI";
    if (/^%Q\d+\.\d$/.test(addr))
        return "DO";
    if (/^%IW/.test(addr))
        return "AI";
    if (/^%QW/.test(addr))
        return "AO";
    const n = stripDia(name);
    if (dt && !BOOL_DT.test(dt) && ANALOG_DT.test(dt))
        return /(^|_|\b)(ao|aq|aout|out|set|sp|setpoint|soll|ref|cmd|y)(_|\b|\d|$)|Out$|Set$|SP$/i.test(n) ? "AO" : "AI";
    if (/(^|_)(out|do|q|cmd|coil|lamp|lampe|horn|siren|y|h|k|km|yv)(_|\d|$)|outRun$|outOpen$|_out$|Out$|Cmd$|_(run|open|on|ein|auf|start|close|zu)$|^(Y|YV|H|K|KM|Q)\d/i.test(n))
        return "DO";
    /* akční člen bez slov snímače (Pump, Heater, Valve_2 …) = výstup */
    if (/pump|motor|valve|ventil|solenoid|heater|heizung|lamp|light|beacon|horn|siren|buzzer|fan(_|\d|$)|conveyor|mixer|agitat|compressor|blower|contactor|relay|cerpad|topen/i.test(n) && !/sensor|switch|button|_?fb|fbk|feedback|status|sts|state|ok$|level|pressure|temp|flow|position|limit|_ls|_ps|prox|confirm|ready|alarm|fault|trip|error/i.test(n))
        return "DO";
    return "DI";
}
/** Časový literál / hodnota → sekundy (T#1S500MS, T#1.5S, TIME#2m, 5000 = ms). */
export function parseTimeLit(s) {
    const t = (s || "").trim().replace(/_/g, "");
    if (/^\d+$/.test(t))
        return +t / 1000;
    const m = t.match(/^(?:T|TIME|LTIME|LT)#(.+)$/i);
    if (!m)
        return undefined;
    let sec = 0, ok = false;
    for (const p of m[1].matchAll(/(\d+(?:\.\d+)?)(ms|d|h|m|s|us|ns)/gi)) {
        const v = +p[1], u = p[2].toLowerCase();
        sec += u === "d" ? v * 86400 : u === "h" ? v * 3600 : u === "m" ? v * 60 : u === "s" ? v : u === "ms" ? v / 1000 : 0;
        ok = true;
    }
    return ok ? Math.round(sec * 1000) / 1000 : undefined;
}
function addSig(sink, s) {
    if (!s.tag)
        return;
    if (!s.dev) {
        const g = splitTag(s.tag, s.dir);
        if (g.dev) {
            s.dev = g.dev;
            if (g.sig)
                s.sig = g.sig;
        }
    }
    sink.signals.push(s);
}
const PLAT_BY_NAME = [
    [/- Beckhoff \*\)/, "beckhoff"], [/- CODESYS \*\)/, "codesys"], [/- Schneider Electric \*\)/, "schneider"],
    [/- Mitsubishi \*\)/, "mitsubishi"], [/- OMRON \*\)/, "omron"],
];
function platFromText(t) {
    for (const [re, p] of PLAT_BY_NAME)
        if (re.test(t))
            return p;
    if (/S7_Optimized_Access|ORGANIZATION_BLOCK|\bDATA_BLOCK\b|#\w+\s*:=|"[A-Za-z_]\w*"\s*:=/.test(t))
        return "siemens";
    if (/\bTwinCAT\b|\{attribute 'TcTypeSystem'/i.test(t))
        return "beckhoff";
    return undefined;
}
/* ---------------------------------------------------------------- Siemens SimaticML */
function exSimaticTags(f, t, sink) {
    for (const el of xmlAll(parseXml(t), "SW.Tags.PlcTag")) {
        const al = xmlChild(el, "AttributeList");
        const get = (n) => xmlText(xmlChild(al, n)).trim();
        const name = get("Name"), la = get("LogicalAddress"), dt = normDt(get("DataTypeName"));
        if (!name || isMemAddr(la))
            continue;
        const addr = canonAddr(la, "siemens");
        const cmt = xmlText(xmlAll(el, "Text")[0]).trim();
        addSig(sink, { tag: name, dt, addr, cmt, dir: dirOf(addr, dt, name), src: { file: f.name, line: lineAt(t, el.pos), quote: quoteOf(name + " " + la) } });
    }
    sink.plats.push("siemens");
    return { fmt: tr("Siemens SimaticML (tabulka tagů)") };
}
/** STL (AWL) `CALL FB, DB` s parametry → pseudo-ST přiřazení členů instance. */
function stlCallsToSt(text) {
    const out = [];
    for (const m of text.matchAll(/^\s*CALL\s+"?([\w.]+)"?\s*,\s*"?([\w.]+)"?[^\n]*\n((?:[ \t]+[\w.]+\s*:=\s*[^\n]*\n?)+)/gim)) {
        const inst = m[2].replace(/\W/g, "_");
        for (const p of m[3].split("\n")) {
            const pm = p.match(/^\s*([\w.]+)\s*:=\s*"?([^"\s/]+)"?/);
            if (pm && /^[A-Za-z_#"]/.test(pm[2]))
                out.push(inst + "." + pm[1] + " := " + pm[2].replace(/^#/, "").replace(/"/g, "") + ";");
        }
    }
    return out;
}
/** Text SCL z tokenů SimaticML (V17+: Token, Blank, NewLine, Access/Symbol/Component, Constant). */
function simaticStText(n) {
    if (!n.children.length)
        return n.text;
    let s = "";
    const walk = (x) => {
        switch (x.name) {
            case "Token":
                s += x.attrs.Text || "";
                return;
            case "Blank":
                s += " ".repeat(+(x.attrs.Num || 1));
                return;
            case "NewLine":
                s += "\n".repeat(+(x.attrs.Num || 1));
                return;
            case "LineComment":
                s += "//" + xmlText(xmlChild(x, "Text"));
                return;
            case "Comment":
                s += "(*" + xmlText(xmlChild(x, "Text")) + "*)";
                return;
            case "Access": {
                const sc = x.attrs.Scope || "";
                const comps = xmlAll(x, "Component").map(c => c.attrs.Name);
                const cv = xmlText(xmlAll(x, "ConstantValue")[0]).trim();
                if (cv) {
                    s += cv;
                    return;
                }
                if (comps.length) {
                    s += (sc === "GlobalVariable" ? '"' + comps[0] + '"' + (comps.length > 1 ? "." + comps.slice(1).join(".") : "") : (sc === "LocalVariable" ? "#" : "") + comps.join("."));
                    return;
                }
                for (const c of x.children)
                    walk(c);
                return;
            }
            default: for (const c of x.children)
                walk(c);
        }
    };
    for (const c of n.children)
        walk(c);
    return s || n.text;
}
/** LAD/FBD (FlgNet) → pseudo-ST: volání FB s instancí a parametry napojenými na proměnné; cívky a kontakty jako směr. */
function simaticFlgNet(net, dirHint) {
    const out = [];
    const acc = new Map(); // UId → jméno proměnné
    for (const a of xmlAll(net, "Access")) {
        const comps = xmlAll(a, "Component").map(c => c.attrs.Name);
        if (comps.length && a.attrs.UId)
            acc.set(a.attrs.UId, comps.join("."));
    }
    const parts = new Map();
    for (const p of [...xmlAll(net, "Part"), ...xmlAll(net, "Call")])
        if (p.attrs.UId)
            parts.set(p.attrs.UId, p);
    for (const w of xmlAll(net, "Wire")) {
        const nc = w.children.find(c => c.name === "NameCon"), ic = w.children.find(c => c.name === "IdentCon");
        if (!nc || !ic)
            continue;
        const v = acc.get(ic.attrs.UId);
        const p = parts.get(nc.attrs.UId);
        if (!v || !p)
            continue;
        if (p.name === "Part" && /^(Coil|SCoil|RCoil|SetCoil|ResetCoil)$/.test(p.attrs.Name || ""))
            dirHint.set(up(v), "DO");
        else if (p.name === "Part" && /^Contact$/.test(p.attrs.Name || "")) {
            if (!dirHint.has(up(v)))
                dirHint.set(up(v), "DI");
        }
        else if (p.name === "Call") {
            const ci = xmlChild(p, "CallInfo");
            const inst = xmlAll(xmlChild(ci, "Instance") || ci || p, "Component").map(c => c.attrs.Name).join("_");
            if (!inst)
                continue;
            const par = xmlAll(ci || p, "Parameter").find(x => x.attrs.Name === nc.attrs.Name);
            const isOut = par && /Output/i.test(par.attrs.Section || "");
            out.push(isOut ? v + " := " + inst + "." + nc.attrs.Name + ";" : inst + "." + nc.attrs.Name + " := " + v + ";");
        }
    }
    return out;
}
/**
 * Bloky TIA Openness (SimaticML): FB / FC / OB / GlobalDB / InstanceDB / PlcStruct. Rozhraní → deklarace,
 * SCL (i tokeny V17+), STL a LAD/FBD (volání FB, cívky, kontakty) → tělo / pseudo-ST; instanční DB → typ instance.
 */
function exSimaticBlock(f, t, sink) {
    const doc = parseXml(t);
    sink.plats.push("siemens");
    const blk = doc.children.flatMap(c => [c, ...c.children]).find(c => /^SW\.(Blocks|Types|TechnologicalObjects)\./.test(c.name));
    if (!blk)
        return { fmt: tr("SimaticML (TIA Openness)") };
    const al = xmlChild(blk, "AttributeList");
    const name = xmlText(xmlChild(al, "Name")).trim() || "Block";
    const kindName = blk.name.split(".").pop() || "";
    const decl = [];
    for (const sec of xmlAll(xmlChild(al, "Interface") || blk, "Section")) {
        const kw = sec.attrs.Name === "Input" ? "VAR_INPUT" : sec.attrs.Name === "Output" ? "VAR_OUTPUT" : sec.attrs.Name === "InOut" ? "VAR_IN_OUT" : sec.attrs.Name === "Return" || sec.attrs.Name === "Constant" ? "" : "VAR";
        if (!kw)
            continue;
        const mem = sec.children.filter(c => c.name === "Member");
        if (mem.length)
            decl.push(kw + "\n" + mem.map(m => "    " + m.attrs.Name.replace(/\W/g, "_") + " : " + (m.attrs.Datatype || "").replace(/"/g, "").replace(/\W.*$/, "") + ";").join("\n") + "\nEND_VAR");
    }
    if (kindName === "InstanceDB" || kindName === "TechnologicalInstanceDB") {
        const of = xmlText(xmlChild(al, "InstanceOfName")).trim();
        sink.pous.push({ name, kind: "routine", lang: "other", body: "VAR\n    " + name.replace(/\W/g, "_") + " : " + (of || "DB").replace(/\W/g, "_") + ";\nEND_VAR\n", src: { file: f.name, line: lineAt(t, blk.pos) } });
        return { fmt: tr("SimaticML — instanční DB") };
    }
    if (kindName === "GlobalDB" || kindName === "PlcStruct") {
        sink.pous.push({ name, kind: "routine", lang: "other", body: decl.join("\n").replace(/\bVAR_(INPUT|OUTPUT|IN_OUT)\b/g, "VAR") + "\n", src: { file: f.name, line: lineAt(t, blk.pos) } });
        return { fmt: kindName === "GlobalDB" ? tr("SimaticML — globální DB") : tr("SimaticML — datový typ") };
    }
    const lang0 = xmlText(xmlChild(al, "ProgrammingLanguage")).trim();
    const code = [], pseudo = [];
    const dirHint = new Map();
    for (const cu of xmlAll(blk, "SW.Blocks.CompileUnit")) {
        const ns = xmlAll(cu, "NetworkSource")[0];
        const stt = ns ? xmlAll(ns, "StructuredText")[0] : undefined;
        const stl = ns ? xmlAll(ns, "StatementList")[0] : undefined;
        const flg = ns ? xmlAll(ns, "FlgNet")[0] : undefined;
        if (stt)
            code.push(simaticStText(stt));
        else if (stl) {
            const s = simaticStText(stl);
            code.push(s);
            pseudo.push(...stlCallsToSt(s));
        }
        else if (flg)
            pseudo.push(...simaticFlgNet(flg, dirHint));
    }
    const kw = kindName === "FB" ? "FUNCTION_BLOCK" : kindName === "FC" ? "FUNCTION" : "ORGANIZATION_BLOCK";
    const isScl = /SCL/i.test(lang0) && code.length;
    const body = (isScl ? kw + ' "' + name + '"\n' + decl.join("\n") + "\nBEGIN\n" + code.join("\n") + "\nEND_" + kw + "\n"
        : decl.join("\n") + "\n" + (code.length ? "(* " + lang0 + " *)\n" + code.join("\n").replace(/\(\*|\*\)/g, " ").split("\n").map(l => "// " + l).join("\n") + "\n" : "")
            + (pseudo.length ? "(* " + (lang0 || "LAD") + " -> ST: vazby volání *)\n" + pseudo.join("\n") + "\n" : ""));
    sink.pous.push({ name, kind: kindName === "FB" ? "functionBlock" : kindName === "FC" ? "function" : "program", lang: isScl ? "SCL" : /STL/i.test(lang0) ? "other" : /LAD/i.test(lang0) ? "LD" : /FBD/i.test(lang0) ? "FBD" : "other", body, src: { file: f.name, line: lineAt(t, blk.pos) } });
    /* směr proměnných podle cívek / kontaktů — použije se u tagů z tabulky */
    for (const [k, v] of dirHint)
        sink.dirHints.set(k, v);
    return { fmt: tr("SimaticML — blok {kind} ({lang})", { kind: kindName, lang: lang0 || "?" }) };
}
/** Tabulka symbolů STEP 7 (.sdf): "Symbol","Adresa","Typ","Komentář"; DB s typem FB = instance. */
function exSdf(f, t, sink) {
    const rows = t.split("\n").map((l, i) => ({ c: splitDelimited(l, ","), line: i + 1, raw: l })).filter(r => r.c.length >= 3 && r.c[0]);
    if (!rows.length || !rows.every(r => /^"/.test(r.raw.trim())))
        return null;
    const sym = new Map(rows.map(r => [up(r.c[1].replace(/\s+/g, "")), r.c[0]]));
    const decl = [];
    let n = 0;
    for (const r of rows) {
        const [name, a, ty, cmt] = r.c;
        const addr = canonAddr(a.replace(/\s+/g, ""), "siemens");
        if (addr) {
            addSig(sink, { tag: name, dt: normDt(ty), addr, cmt: cmt || "", dir: dirOf(addr, normDt(ty), name), src: { file: f.name, line: r.line, quote: quoteOf(r.raw) } });
            n++;
        }
        else if (/^DB\s*\d+$/i.test(a.trim()) && /^FB\s*\d+$/i.test(ty.trim()))
            decl.push("    " + name.replace(/\W/g, "_") + " : " + (sym.get(up(ty.replace(/\s+/g, ""))) || ty).replace(/\W/g, "_") + ";");
    }
    if (decl.length)
        sink.pous.push({ name: f.name + ":symbols", kind: "routine", lang: "other", body: "VAR\n" + decl.join("\n") + "\nEND_VAR\n", src: { file: f.name, line: 1 } });
    sink.plats.push("siemens");
    return { fmt: tr("STEP 7 — tabulka symbolů (SDF)"), note: n ? undefined : tr("Bez symbolů vstupů a výstupů.") };
}
/* ------------------------------------------------------------------- Rockwell L5X */
/** Body modulů Rockwell (alias / popis) → kanonické adresy (inverze `lxIoMap`, jinak pořadím). */
export function rockwellAddrs(specs, analog) {
    const pts = [];
    for (const { tag, spec } of specs) {
        const m = spec.match(/^([A-Za-z_][\w]*(?::(\d+))?):([IO])\.(.+)$/);
        if (!m)
            continue;
        const io = m[3], mem = m[4];
        let ch = -1, an = false, ours = false, k;
        if ((k = mem.match(/^Pt(\d+)\.Data$/i))) {
            ch = +k[1];
            ours = /^Local$/i.test(m[1].split(":")[0]);
        }
        else if ((k = mem.match(/^Ch(\d+)\.?Data$/i))) {
            ch = +k[1];
            an = true;
            ours = /^Local$/i.test(m[1].split(":")[0]) && /\.Data$/.test(mem);
        }
        else if ((k = mem.match(/^(?:Data|Slot)\[(\d+)\]\.(\d+)$/i)))
            ch = +k[1] * 32 + +k[2];
        else if ((k = mem.match(/^(?:Data|Slot)\[(\d+)\]$/i))) {
            ch = +k[1];
            an = !!analog?.has(tag);
        }
        else if ((k = mem.match(/^(?:Data\.)?(\d+)$/i)))
            ch = +k[1];
        if (ch < 0)
            continue;
        if (analog?.has(tag))
            an = true;
        const dir = an ? (io === "I" ? "AI" : "AO") : (io === "I" ? "DI" : "DO");
        pts.push({ tag, mod: m[1], slot: m[2] ? +m[2] : 0, dir, ch, ours });
    }
    const PER = { DI: 16, DO: 16, AI: 8, AO: 4 };
    const ORDER = ["DI", "DO", "AI", "AO"];
    const addr = new Map(), dir = new Map();
    const canon = (d, c) => d === "DI" ? "%I" + (c >> 3) + "." + (c & 7) : d === "DO" ? "%Q" + (c >> 3) + "." + (c & 7)
        : (d === "AI" ? "%IW" : "%QW") + (64 + 2 * c);
    /* náš generátor (inverze lxIoMap): moduly Local, sloty od 1 — DI, pak DO, AI, AO; báze směru = max slot předchozího + 1 */
    let exact = pts.length > 0 && pts.every(p => p.ours && p.ch < PER[p.dir]);
    const base = { DI: 1, DO: 1, AI: 1, AO: 1 };
    if (exact) {
        let next = 1;
        for (const d of ORDER) {
            const s = [...new Set(pts.filter(p => p.dir === d).map(p => p.slot))].sort((a, b) => a - b);
            base[d] = next;
            if (s.length) {
                if (s[0] < next)
                    exact = false;
                next = s[s.length - 1] + 1;
            }
        }
    }
    if (exact) {
        for (const p of pts) {
            dir.set(p.tag, p.dir);
            addr.set(p.tag, canon(p.dir, (p.slot - base[p.dir]) * PER[p.dir] + p.ch));
        }
        return { addr, dir, exact };
    }
    /* cizí projekt: každý modul (rack + slot) dostane vlastní souvislý rozsah kanálů daného směru (pořadí modulů) */
    for (const d of ORDER) {
        const list = pts.filter(p => p.dir === d);
        const mods = [...new Set(list.map(p => p.mod))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
        let off = 0;
        for (const md of mods) {
            const ps = list.filter(p => p.mod === md);
            const width = Math.max(...ps.map(p => p.ch)) + 1;
            for (const p of ps) {
                dir.set(p.tag, d);
                addr.set(p.tag, canon(d, off + p.ch));
            }
            off += d === "DI" || d === "DO" ? Math.ceil(width / 8) * 8 : width;
        }
    }
    return { addr, dir, exact: false };
}
/** Je alias bodem fyzického modulu (ne vnitřní tag / pole)? */
const IO_ALIAS = /^[A-Za-z_]\w*(?::\d+)?:[IO]\./;
const ATOMIC = /^(BOOL|SINT|INT|DINT|LINT|REAL|LREAL|USINT|UINT|UDINT|BIT)$/i;
/**
 * FBD (Logix) → zjednodušený ST: jen vazby bloků AOI (`inst.Param := tag;`, `tag := inst.Param;`)
 * a přímé vazby IRef → ORef. Logika funkčních bloků (BAND, TON…) se nepřepisuje.
 */
function lxFbdToSt(r) {
    const out = [];
    for (const sh of xmlAll(r, "Sheet")) {
        const byId = new Map();
        for (const el of sh.children)
            if (el.attrs.ID !== undefined)
                byId.set(el.attrs.ID, el);
        const ocon = new Map(); // spojka OCon jméno → ID zdroje
        const wires = sh.children.filter(c => c.name === "Wire");
        for (const w of wires) {
            const to = byId.get(w.attrs.ToID);
            if (to && to.name === "OCon")
                ocon.set(to.attrs.Name, w.attrs.FromID);
        }
        const srcOf = (id, depth = 0) => {
            const el = byId.get(id);
            if (el && el.name === "ICon" && depth < 5) {
                const s = ocon.get(el.attrs.Name);
                return s ? srcOf(s, depth + 1) : undefined;
            }
            return el;
        };
        for (const el of sh.children.filter(c => c.name === "AddOnInstruction")) {
            const inst = el.attrs.Operand;
            if (!inst)
                continue;
            for (const p of xmlAll(el, "InOutParameter"))
                if (p.attrs.Argument)
                    out.push(inst + "." + p.attrs.Name + " := " + p.attrs.Argument + ";");
        }
        for (const w of wires) {
            const from = srcOf(w.attrs.FromID), to = byId.get(w.attrs.ToID);
            if (!from || !to)
                continue;
            if (to.name === "AddOnInstruction" && w.attrs.ToParam && from.name === "IRef" && /^[A-Za-z_]/.test(from.attrs.Operand || ""))
                out.push(to.attrs.Operand + "." + w.attrs.ToParam + " := " + from.attrs.Operand + ";");
            else if (from.name === "AddOnInstruction" && w.attrs.FromParam && to.name === "ORef")
                out.push(to.attrs.Operand + " := " + from.attrs.Operand + "." + w.attrs.FromParam + ";");
            else if (from.name === "IRef" && to.name === "ORef" && /^[A-Za-z_]/.test(from.attrs.Operand || ""))
                out.push(to.attrs.Operand + " := " + from.attrs.Operand + ";");
        }
    }
    return out.join("\n");
}
/** Volání AOI v RLL `Name(inst,arg1,…)` → přiřazení členů podle povinných parametrů. */
function lxRllAoi(text, aois) {
    const out = [];
    for (const m of text.matchAll(/\b([A-Za-z_]\w*)\(/g)) {
        const def = aois.get(m[1]);
        if (!def)
            continue;
        let i = m.index + m[0].length, depth = 1, cur = "";
        const args = [];
        while (i < text.length && depth) {
            const ch = text[i++];
            if (ch === "(" || ch === "[")
                depth++;
            if (ch === ")" || ch === "]") {
                if (--depth === 0)
                    break;
            }
            if (ch === "," && depth === 1) {
                args.push(cur.trim());
                cur = "";
                continue;
            }
            cur += ch;
        }
        args.push(cur.trim());
        const inst = args.shift();
        if (!inst || !/^[A-Za-z_]/.test(inst))
            continue;
        const req = def.filter(p => p.req);
        req.forEach((p, k) => {
            const a = args[k];
            if (!a || !/^[A-Za-z_][\w.:\[\]]*$/.test(a) || a === "?")
                return;
            out.push(p.out ? a + " := " + inst + "." + p.name + ";" : inst + "." + p.name + " := " + a + ";");
        });
    }
    return out;
}
function lxRoutineText(r, aois) {
    const st = xmlChild(r, "STContent");
    /* export z Logix má CDATA na samostatném řádku uvnitř <Line> — okrajové konce řádku pryč */
    if (st)
        return { body: xmlAll(st, "Line").map(l => xmlText(l).replace(/^[ \t]*\n|\n[ \t]*$/g, "")).join("\n"), lang: "ST" };
    const rll = xmlChild(r, "RLLContent");
    if (rll) {
        const rungs = xmlAll(rll, "Rung").map(g => { const c = xmlText(xmlChild(g, "Comment")).trim(); return (c ? "(* " + c.replace(/\*\)/g, "* )") + " *)\n" : "") + xmlText(xmlChild(g, "Text")).trim(); });
        const aoi = aois ? lxRllAoi(rungs.join("\n"), aois) : [];
        return { body: rungs.join("\n") + (aoi.length ? "\n(* AOI -> ST *)\n" + aoi.join("\n") : ""), lang: "LD" };
    }
    if ((r.attrs.Type || "") === "FBD") {
        const b = lxFbdToSt(r);
        return { body: b ? "(* FBD -> ST: AOI *)\n" + b : "", lang: "FBD" };
    }
    return { body: "", lang: (r.attrs.Type || "") === "SFC" ? "other" : "other" };
}
/** Jméno vypadá jako fyzický signál (konvence I_/O_/DI_/…, PB, LS, Sensor, Valve…)? */
const IO_NAME = /^(I|O|DI|DO|AI|AO|IN|OUT|INP|OUTP|X|Y|Q)_|_(I|O|DI|DO|AI|AO|IN|OUT|PB|LS|PS|SW|ZS|ZSO|ZSC|SOL|XV|YV|LSH|LSL)(_|\d|$)|(^|_)(PB|LS|PS|ZS|ZSO|ZSC|SOL|XV|YV|HS|LT|PT|TT|FT|LSH|LSL)\d*(_|$)|sensor|button|switch|solenoid|valve|motor|pump|lamp|light|beacon|horn|prox|limit|contactor|starter|estop|e_stop/i;
/** Typické vnitřní / diagnostické / systémové tagy (ne zařízení). */
const NOT_IO_NAME = /^(S|C|M|T|TMR|CNT|CTR|STS|CMD|HMI|SCADA|EPICS|PLC|SYS|DIAG|ALM|ALARM|FAULT|FLT|TMP|TEMP|AUX|SPARE|RESERVED|DUMMY|TEST|DEBUG)_|_(HMI|SCADA|EPICS|DIAG|ALM|TMR|TIMER|CNT|SP|SETPOINT|PARAM|CFG|BIT|WORD|ONS|OS|LATCH|LATCHED|REQUEST|REQ|ACK|SUM|MSG)$|^(First_?Scan|Heartbeat|Watchdog|Spare|Reserved)/i;
/**
 * Přímé odkazy na body modulů v logice (bez aliasů): `XIC(Local:2:I.Data.2)`, `MOV(Local:4:I.Ch0Data,X[1])`,
 * `OTE(Local:3:O.Data.5)` → signály pojmenované podle bodu; popis z cíle / zdroje přesunu (komentáře tagů).
 */
function rockwellModuleRefs(f, texts, comments, sink) {
    const refs = new Map();
    for (const { text, line } of texts) {
        const lines = text.split("\n");
        lines.forEach((l, i) => {
            for (const m of l.matchAll(/\b([A-Za-z_]\w*(?::\d+)?:[IO]\.(?:Data|Pt\d+|Ch\d+)[\w.\[\]]*)/g)) {
                const ref = m[1].replace(/[.\]]+$/, "");
                if (refs.has(ref))
                    continue;
                /* popis: druhý operand MOV / cíl OTE na stejném řádku → jeho komentář */
                const mv = l.match(new RegExp("MOV\\(\\s*" + ref.replace(/[.[\]]/g, "\\$&") + "\\s*,\\s*([\\w.\\[\\]]+)\\)")) || l.match(new RegExp("MOV\\(\\s*([\\w.\\[\\]]+)\\s*,\\s*" + ref.replace(/[.[\]]/g, "\\$&") + "\\s*\\)"));
                const ote = l.match(/OTE\(([\w.[\]]+)\)/);
                const other = mv ? mv[1] : ote && !/:[IO]\./.test(ote[1]) ? ote[1] : "";
                const cmt = (other && (comments.get(up(other)) || other)) || "";
                refs.set(ref, { cmt, line: line + i, quote: quoteOf(l) });
            }
        });
    }
    if (!refs.size)
        return 0;
    const ra = rockwellAddrs([...refs.keys()].map(r => ({ tag: r, spec: r })));
    for (const [ref, x] of refs) {
        const d = ra.dir.get(ref) || (/:I\./.test(ref) ? "DI" : "DO");
        addSig(sink, { tag: ref.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+$/, ""), dt: d === "AI" || d === "AO" ? "REAL" : "BOOL", addr: ra.addr.get(ref) || "", cmt: x.cmt, dir: d, raw: ref, src: { file: f.name, line: x.line, quote: x.quote } });
    }
    return refs.size;
}
/** Rockwell L5K (textový export RSLogix 5000): tagy, aliasy, komentáře prvků a rutiny RLL / ST. */
function exL5K(f, t, sink) {
    sink.plats.push("rockwell");
    const comments = new Map();
    const aliases = [];
    const decl = [];
    for (const blk of t.matchAll(/^\s*TAG\s*$([\s\S]*?)^\s*END_TAG/gm)) {
        const base = lineAt(t, blk.index);
        for (const m of blk[1].matchAll(/^\s*([A-Za-z_]\w*)\s*(?::\s*([\w:]+)(?:\[[^\]]*\])?|OF\s+([\w:.\[\]]+))\s*(\(([\s\S]*?)\))?\s*(?::=[\s\S]*?)?;/gm)) {
            const [, name, type, of, , attrs] = m;
            const desc = ((attrs || "").match(/Description\s*:=\s*"((?:[^"]|"")*)"/) || [])[1] || "";
            for (const c of (attrs || "").matchAll(/COMMENT((?:\[\d+\]|\.\w+)+)\s*:=\s*"((?:[^"]|"")*)"/g))
                comments.set(up(name + c[1]), c[2].replace(/\$N/g, " ").trim());
            if (desc)
                comments.set(up(name), desc);
            if (of)
                aliases.push({ tag: name, spec: of, cmt: desc, line: base + lineAt(blk[1], m.index) - 1 });
            else if (type)
                decl.push("    " + name + " : " + type + ";");
        }
    }
    const io = aliases.filter(a => IO_ALIAS.test(a.spec));
    const ra = rockwellAddrs(io.map(a => ({ tag: a.tag, spec: a.spec })));
    for (const a of io)
        addSig(sink, { tag: a.tag, dt: "BOOL", addr: ra.addr.get(a.tag) || "", cmt: a.cmt, dir: ra.dir.get(a.tag) || dirOf("", "BOOL", a.tag), raw: a.spec, src: { file: f.name, line: a.line, quote: quoteOf(a.tag + " OF " + a.spec) } });
    const routines = [];
    for (const r of t.matchAll(/^\s*(ROUTINE|ST_ROUTINE)\s+(\w+)[^\n]*\n([\s\S]*?)^\s*END_(?:ST_)?ROUTINE/gm)) {
        routines.push({ name: r[2], st: r[1] === "ST_ROUTINE", line: lineAt(t, r.index) + 1, text: r[3].split("\n").map(l => l.replace(/^\s*(?:N|RC)\s*:\s*/, "").replace(/^\s*'?\d*\s*/, "")).join("\n") });
    }
    let n = io.length;
    if (!io.length)
        n += rockwellModuleRefs(f, routines.map(r => ({ text: r.text, line: r.line })), comments, sink);
    const pre = "\nVAR\n" + decl.join("\n") + "\nEND_VAR\n";
    for (const r of routines)
        sink.pous.push({ name: r.name, kind: "routine", lang: r.st ? "ST" : "LD", body: r.text + pre, src: { file: f.name, line: r.line } });
    return { fmt: tr("Rockwell L5K (textový export)"), note: n ? undefined : tr("Bez aliasů a odkazů na moduly I/O.") };
}
function exL5X(f, t, sink) {
    const doc = parseXml(t);
    const ctrl = xmlAll(doc, "Controller")[0];
    const ctrlTags = xmlChild(ctrl, "Tags")?.children.filter(c => c.name === "Tag") || [];
    const progTags = xmlAll(doc, "Program").flatMap(p => xmlChild(p, "Tags")?.children.filter(c => c.name === "Tag") || []);
    const spec = (el) => el.attrs.AliasFor || ((xmlText(xmlChild(el, "Description")).match(/\[(Local:[^\]]+)\]/) || [])[1] || "");
    const isIoAlias = (el) => IO_ALIAS.test(el.attrs.AliasFor || "");
    const ours = ctrlTags.some(el => /\[Local:/.test(xmlText(xmlChild(el, "Description"))));
    const hasAlias = [...ctrlTags, ...progTags].some(isIoAlias);
    /* výběr I/O: aliasy na body modulů; náš L5X (bod v popisu); bez aliasů jen jména ve stylu I/O */
    const atomic = (el) => ATOMIC.test(el.attrs.DataType || "") || el.attrs.TagType === "Alias";
    let sigEls;
    let note;
    if (ours)
        sigEls = ctrlTags.filter(atomic);
    else if (hasAlias)
        sigEls = [...ctrlTags, ...progTags].filter(isIoAlias);
    else {
        const all = [...ctrlTags, ...progTags].filter(el => ATOMIC.test(el.attrs.DataType || ""));
        const conv = all.filter(el => /^(I|O|DI|DO|AI|AO|In|Out|Inp|Outp)_/.test(el.attrs.Name || ""));
        sigEls = conv.length ? conv : all.filter(el => IO_NAME.test(el.attrs.Name || "") && !NOT_IO_NAME.test(el.attrs.Name || ""));
        note = tr("I/O tagy bez aliasů na moduly — vybrány podle jmen ({n} z {all}), adresy doplň.", { n: sigEls.length, all: all.length });
        if (!sigEls.length) {
            /* logika čte body modulů přímo (Local:2:I.Data.3) — signály z odkazů */
            const comments = new Map();
            for (const el of [...ctrlTags, ...progTags]) {
                const d = xmlText(xmlChild(el, "Description")).trim();
                if (d)
                    comments.set(up(el.attrs.Name), d);
                for (const c of xmlAll(el, "Comment"))
                    comments.set(up(el.attrs.Name + (c.attrs.Operand || "")), xmlText(c).trim());
            }
            const texts = xmlAll(doc, "Routine").map(r => ({ text: lxRoutineText(r).body, line: lineAt(t, r.pos) }));
            const n = rockwellModuleRefs(f, texts, comments, sink);
            if (n)
                note = tr("Signály z přímých odkazů na body modulů v logice ({n}), bez aliasů.", { n });
        }
    }
    const analog = new Set(sigEls.filter(el => /^(REAL|INT|DINT|LREAL)$/i.test(el.attrs.DataType || "")).map(el => el.attrs.Name));
    const ra = rockwellAddrs(sigEls.map(el => ({ tag: el.attrs.Name, spec: spec(el) })).filter(x => x.spec), analog);
    const decl = [];
    for (const el of ctrlTags)
        if (!sigEls.includes(el))
            decl.push("    " + el.attrs.Name + " : " + (el.attrs.DataType || "BOOL") + ";");
    if (!ours)
        for (const el of [...ctrlTags, ...progTags])
            if (!sigEls.includes(el) && ATOMIC.test(el.attrs.DataType || ""))
                sink.skipped.push(el.attrs.Name);
    const seen = new Set();
    for (const el of sigEls) {
        const name = el.attrs.Name;
        if (!name || seen.has(up(name)))
            continue;
        seen.add(up(name));
        const d0 = ra.dir.get(name);
        const dt = normDt(el.attrs.DataType || (d0 === "AI" || d0 === "AO" ? "REAL" : "BOOL"));
        const addr = ra.addr.get(name) || "";
        const cmt = xmlText(xmlChild(el, "Description")).trim().replace(/\s*\[Local:[^\]]+\]\s*$/, "");
        /* konvence předpon (I_ vstup, O_ výstup) má přednost před odhadem podle slov */
        const an = /^(REAL|INT|DINT|LREAL)$/i.test(el.attrs.DataType || "");
        const pre = /^(I|DI|AI|In|Inp)_/i.test(name) ? (an ? "AI" : "DI") : /^(O|DO|AO|Out|Outp)_/i.test(name) ? (an ? "AO" : "DO") : undefined;
        const d = d0 || pre || dirOf(addr, dt, name);
        addSig(sink, { tag: name, dt, addr, cmt, dir: d, ...(spec(el) ? { raw: spec(el) } : {}), src: { file: f.name, line: lineAt(t, el.pos), quote: quoteOf(name + (spec(el) ? " -> " + spec(el) : "")) } });
    }
    const aois = new Map();
    for (const aoi of xmlAll(doc, "AddOnInstructionDefinition")) {
        const params = xmlAll(aoi, "Parameter").filter(p => !/^Enable(In|Out)$/.test(p.attrs.Name || ""));
        aois.set(aoi.attrs.Name || "", params.map(p => ({ name: p.attrs.Name, out: p.attrs.Usage === "Output", req: p.attrs.Required === "true" })));
    }
    for (const aoi of xmlAll(doc, "AddOnInstructionDefinition")) {
        const r = xmlAll(aoi, "Routine")[0];
        const { body, lang } = r ? lxRoutineText(r, aois) : { body: "", lang: "other" };
        const params = xmlAll(aoi, "Parameter").filter(p => !/^Enable(In|Out)$/.test(p.attrs.Name || ""));
        const pre = "\nVAR_INPUT\n" + params.filter(p => p.attrs.Usage !== "Output").map(p => "    " + p.attrs.Name + " : " + p.attrs.DataType + ";").join("\n") + "\nEND_VAR\nVAR_OUTPUT\n" +
            params.filter(p => p.attrs.Usage === "Output").map(p => "    " + p.attrs.Name + " : " + p.attrs.DataType + ";").join("\n") + "\nEND_VAR\n";
        sink.pous.push({ name: aoi.attrs.Name || "AOI", kind: "functionBlock", lang, body: body + pre, src: { file: f.name, line: lineAt(t, aoi.pos) } });
    }
    for (const prog of xmlAll(doc, "Program")) {
        const ptags = xmlChild(prog, "Tags")?.children.filter(c => c.name === "Tag") || [];
        const pre = "\nVAR\n" + [...decl, ...ptags.map(el => "    " + el.attrs.Name + " : " + (el.attrs.DataType || "BOOL") + ";")].join("\n") + "\nEND_VAR\n";
        for (const r of xmlAll(prog, "Routine")) {
            const { body, lang } = lxRoutineText(r, aois);
            sink.pous.push({ name: r.attrs.Name || "Routine", kind: "routine", lang, body: body + pre, src: { file: f.name, line: lineAt(t, r.pos) + 2 } });
        }
        const d = xmlText(xmlChild(prog, "Description")).trim();
        if (d && !sink.meta.name)
            sink.meta.name = d.replace(/\s*-\s*(PLCdesk|PLC Studio)$/, "");
    }
    if (!sink.meta.name && ctrl && !ours) {
        const d = xmlText(xmlChild(ctrl, "Description")).trim();
        if (d)
            sink.meta.name = d;
    }
    sink.plats.push("rockwell");
    return { fmt: "Rockwell L5X", note };
}
/* -------------------------------------------------------------- PLCopen XML (TC6) */
function plcTypeName(v) {
    const ty = xmlChild(v, "type");
    const c = ty?.children[0];
    if (!c)
        return "";
    return c.name === "derived" ? (c.attrs.name || "") : c.name.toUpperCase();
}
/** Identifikátor z cizího jména instance (FT-101 → FT_101) pro pseudo-ST. */
const idOf = (s) => (s || "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
/** Výraz vstupu prvku grafu PLCopen (inVariable / inline / reference), NOT podle `negated`. */
function plcExprOf(byId, id) {
    const el = id ? byId.get(id) : undefined;
    if (!el)
        return "";
    if (el.name === "inVariable" || el.name === "inOutVariable") {
        const e = xmlText(xmlChild(el, "expression")).trim();
        return (el.attrs.negated === "true" ? "NOT " : "") + idOf(e.split(/\s/)[0] === e ? e : e).replace(/^_+/, "");
    }
    return "";
}
/**
 * SFC (PLCopen) → pseudo-ST stavový automat `CASE sfcStep_<pou> OF …` (kroky, akce s kvalifikátory
 * N/S/R/P/L/D, přechody, skoky). Hlavní větev; paralelní / výběrové větve postupně. Rozbor sekvence
 * pak dělá stejná heuristika jako u cizího ST (`conf: "guess"`).
 */
function sfcToSt(sfc, pouName, actionsByName) {
    const byId = new Map();
    for (const el of sfc.children)
        if (el.attrs.localId !== undefined)
            byId.set(el.attrs.localId, el);
    const preds = (el) => xmlAll(el, "connection").filter(c => !xmlAll(xmlChild(el, "condition") || { name: "", attrs: {}, children: [], text: "", pos: 0 }, "connection").includes(c)).map(c => c.attrs.refLocalId);
    const succ = new Map();
    for (const el of byId.values()) {
        if (el.name === "actionBlock" || el.name === "inVariable" || el.name === "outVariable")
            continue;
        const ins = xmlChild(el, "connectionPointIn");
        for (const c of ins ? xmlAll(ins, "connection") : [])
            (succ.get(c.attrs.refLocalId) || succ.set(c.attrs.refLocalId, []).get(c.attrs.refLocalId)).push(el);
        /* divergence / convergence mají víc vstupů */
        for (const cp of el.children.filter(x => x.name === "connectionPointIn" && x !== ins))
            for (const c of xmlAll(cp, "connection"))
                (succ.get(c.attrs.refLocalId) || succ.set(c.attrs.refLocalId, []).get(c.attrs.refLocalId)).push(el);
    }
    void preds;
    const steps = [...byId.values()].filter(e => e.name === "step");
    if (!steps.length)
        return "";
    const init = steps.find(s => s.attrs.initialStep === "true") || steps[0];
    /* pořadí kroků: průchod od počátečního kroku */
    const order = [];
    const nextSteps = (from, depth = 0) => {
        const out = [];
        for (const n of succ.get(from.attrs.localId) || []) {
            if (n.name === "transition") {
                const after = (succ.get(n.attrs.localId) || []);
                for (const a of after.length ? after : [undefined]) {
                    let tgt = a, guard = 0;
                    while (tgt && /Convergence|Divergence/.test(tgt.name) && guard++ < 10)
                        tgt = (succ.get(tgt.attrs.localId) || [])[0];
                    out.push({ tr: n, to: tgt && tgt.name === "step" ? tgt : undefined, jump: tgt && tgt.name === "jumpStep" ? tgt.attrs.targetName : undefined });
                }
            }
            else if (/Divergence|Convergence/.test(n.name) && depth < 10)
                out.push(...nextSteps(n, depth + 1));
        }
        return out;
    };
    const queue = [init];
    while (queue.length) {
        const s = queue.shift();
        if (order.includes(s))
            continue;
        order.push(s);
        for (const x of nextSteps(s))
            if (x.to && !order.includes(x.to))
                queue.push(x.to);
    }
    for (const s of steps)
        if (!order.includes(s))
            order.push(s);
    const num = new Map(order.map((s, i) => [s.attrs.name, (i + 1) * 10]));
    const v = "sfcStep_" + idOf(pouName);
    const L = ["(* SFC -> ST: " + pouName + " *)", "CASE " + v + " OF"];
    for (const s of order) {
        L.push("    " + num.get(s.attrs.name) + ": (* SFC " + s.attrs.name + " *)");
        for (const ab of [...byId.values()].filter(e => e.name === "actionBlock" && xmlAll(e, "connection").some(c => c.attrs.refLocalId === s.attrs.localId))) {
            for (const a of ab.children.filter(c => c.name === "action")) {
                const q = (a.attrs.qualifier || "N").toUpperCase();
                const ref = xmlChild(a, "reference")?.attrs.name;
                const inl = xmlText(xmlChild(a, "inline")).trim();
                if (inl) {
                    L.push(...inl.split("\n").map(l => "        " + l.trim()));
                    continue;
                }
                if (!ref)
                    continue;
                if (actionsByName.has(ref)) {
                    L.push(...actionsByName.get(ref).split("\n").map(l => "        " + l.trim()));
                    continue;
                }
                L.push("        " + idOf(ref) + " := " + (q === "R" ? "FALSE" : "TRUE") + ";" + (q !== "N" ? " (* " + q + (a.attrs.duration ? " " + a.attrs.duration : "") + " *)" : ""));
            }
        }
        for (const x of nextSteps(s)) {
            const tr = x.tr;
            const cond = xmlChild(tr, "condition");
            let c = xmlText(xmlChild(xmlChild(cond, "inline"), "ST")).trim() || xmlText(xmlChild(cond, "inline")).trim();
            if (!c && xmlChild(cond, "reference"))
                c = xmlChild(cond, "reference").attrs.name;
            if (!c)
                c = xmlAll(cond || tr, "connection").map(k => plcExprOf(byId, k.attrs.refLocalId)).filter(Boolean).join(" AND ");
            const to = x.to ? num.get(x.to.attrs.name) : x.jump ? num.get(x.jump) : undefined;
            if (to === undefined)
                continue;
            L.push("        IF " + (c || "TRUE").replace(/;$/, "").replace(/\s+/g, " ") + " THEN " + v + " := " + to + "; END_IF;");
        }
    }
    L.push("END_CASE;");
    return L.join("\n");
}
/** FBD (PLCopen) → pseudo-ST vazeb instancí bloků: `inst.Param := výraz;` a `výraz := inst.Param;`. */
function plcFbdToSt(g) {
    const byId = new Map();
    for (const el of g.children)
        if (el.attrs.localId !== undefined)
            byId.set(el.attrs.localId, el);
    const out = [];
    for (const b of g.children.filter(c => c.name === "block" && c.attrs.instanceName)) {
        const inst = idOf(b.attrs.instanceName);
        for (const iv of xmlAll(xmlChild(b, "inputVariables") || b, "variable")) {
            const con = xmlAll(iv, "connection")[0];
            const e = plcExprOf(byId, con?.attrs.refLocalId);
            if (e && /^[A-Za-z_]/.test(e) && !/^NOT /.test(e))
                out.push(inst + "." + idOf(iv.attrs.formalParameter) + " := " + e + ";");
        }
    }
    for (const ov of g.children.filter(c => c.name === "outVariable" || c.name === "inOutVariable")) {
        const con = xmlAll(xmlChild(ov, "connectionPointIn") || ov, "connection")[0];
        const src = con ? byId.get(con.attrs.refLocalId) : undefined;
        const e = idOf(xmlText(xmlChild(ov, "expression")).trim());
        if (!e)
            continue;
        if (src && src.name === "block" && src.attrs.instanceName && con.attrs.formalParameter)
            out.push(e + " := " + idOf(src.attrs.instanceName) + "." + idOf(con.attrs.formalParameter) + ";");
        else if (src && (src.name === "inVariable")) {
            const x = plcExprOf(byId, src.attrs.localId);
            if (x)
                out.push(e + " := " + x + ";");
        }
    }
    return out.join("\n");
}
function exPLCopen(f, t, sink) {
    const doc = parseXml(t);
    let anyStar = false;
    const s0 = sink.signals.length;
    const dirHint = new Map(); // zapisované akcemi / cívkami → výstup, čtené → vstup
    const inclHint = new Set(); // proměnné použité v krocích SFC / kontaktech a cívkách LD
    const candidates = [];
    let sfcSteps = 0;
    for (const pou of xmlAll(doc, "pou")) {
        const iface = xmlChild(pou, "interface");
        const secs = [];
        for (const sec of iface?.children || []) {
            const kw = sec.name === "inputVars" ? "VAR_INPUT" : sec.name === "outputVars" ? "VAR_OUTPUT" : sec.name === "inOutVars" ? "VAR_IN_OUT" : "VAR";
            const vars = xmlAll(sec, "variable");
            if (pou.attrs.pouType === "program" && /^(localVars|externalVars|globalVars)$/.test(sec.name))
                for (const v of vars)
                    candidates.push({ v, scope: sec.name });
            secs.push(kw + "\n" + vars.map(v => {
                const init = xmlAll(v, "simpleValue")[0]?.attrs.value;
                return "    " + idOf(v.attrs.name) + " : " + idOf(plcTypeName(v)) + (init !== undefined ? " := " + init : "") + ";";
            }).join("\n") + "\nEND_VAR");
        }
        const body = xmlChild(pou, "body");
        const st = xmlChild(body, "ST"), sfc = xmlChild(body, "SFC"), fbd = xmlChild(body, "FBD"), ld = xmlChild(body, "LD");
        const actionsByName = new Map();
        for (const a of xmlAll(xmlChild(pou, "actions") || { name: "", attrs: {}, children: [], text: "", pos: 0 }, "action")) {
            const ast = xmlChild(xmlChild(a, "body"), "ST");
            if (ast && a.attrs.name)
                actionsByName.set(a.attrs.name, xmlText(ast).trim());
        }
        let code = st ? xmlText(st) : "";
        if (sfc) {
            code = sfcToSt(sfc, pou.attrs.name || "POU", actionsByName);
            sfcSteps += xmlAll(sfc, "step").length;
            for (const a of xmlAll(sfc, "reference"))
                dirHint.set(up(a.attrs.name), "DO");
            for (const iv of xmlAll(sfc, "inVariable")) {
                const e = xmlText(xmlChild(iv, "expression")).trim();
                if (/^[A-Za-z_]\w*$/.test(e) && !dirHint.has(up(e)))
                    dirHint.set(up(e), "DI");
            }
        }
        else if (fbd)
            code = plcFbdToSt(fbd);
        if (ld) {
            for (const c of xmlAll(ld, "coil")) {
                const e = xmlText(xmlChild(c, "variable")).trim();
                if (e)
                    dirHint.set(up(e), "DO");
            }
            for (const c of xmlAll(ld, "contact")) {
                const e = xmlText(xmlChild(c, "variable")).trim();
                if (e && !dirHint.has(up(e)))
                    dirHint.set(up(e), "DI");
            }
        }
        for (const k of dirHint.keys())
            inclHint.add(k);
        if (fbd)
            for (const ov of xmlAll(fbd, "outVariable")) {
                const e = xmlText(xmlChild(ov, "expression")).trim();
                if (/^[A-Za-z_]\w*$/.test(e) && !dirHint.has(up(e)))
                    dirHint.set(up(e), "DO");
            }
        const kind = pou.attrs.pouType === "program" ? "program" : pou.attrs.pouType === "function" ? "function" : "functionBlock";
        const lang = st ? "ST" : ld ? "LD" : fbd ? "FBD" : "other";
        sink.pous.push({
            name: pou.attrs.name || "POU", kind, lang,
            body: code + "\n" + secs.join("\n") + "\n", src: { file: f.name, line: lineAt(t, (st || sfc || fbd || ld || pou).pos) + (st ? 1 : 0) },
        });
    }
    /* globální proměnné (configuration / resource) */
    for (const g of xmlAll(doc, "globalVars"))
        for (const v of xmlAll(g, "variable"))
            candidates.push({ v, scope: "global:" + (g.attrs.name || "") });
    const located = candidates.some(c => c.v.attrs.address);
    const ioGvl = (scope) => /^global:.*io/i.test(scope);
    const seen = new Set();
    for (const { v, scope } of candidates) {
        const name = v.attrs.name || "";
        const at = v.attrs.address || "";
        if (!name || seen.has(up(name)))
            continue;
        if (at.includes("*"))
            anyStar = true;
        const dt = normDt(plcTypeName(v));
        if (!ATOMIC.test(dt) && dt !== "WORD")
            continue;
        /* I/O: s adresou; v GVL „…IO…" vše; bez adres v projektu jen jména ve stylu I/O nebo s vazbou v grafu */
        const global = scope.startsWith("global:");
        if (!at && !(global && (ioGvl(scope) || !located)) && !(!located && (IO_NAME.test(name) || /(_|^)(raw|ma|di|do|ai|ao)(_|$)/i.test(name) || inclHint.has(up(name)))))
            continue;
        if (!at && global && !ioGvl(scope) && !located && !(IO_NAME.test(name) || inclHint.has(up(name)) || /(_|^)(raw|ma|di|do|ai|ao)(_|$)/i.test(name)))
            continue;
        seen.add(up(name));
        const addr = canonAddr(at, "codesys");
        const cmt = xmlText(xmlChild(v, "documentation")).trim();
        const hint = dirHint.get(up(name));
        const analog = ANALOG_DT.test(dt) && !BOOL_DT.test(dt);
        const d = at.startsWith("%I*") ? (analog ? "AI" : "DI") : at.startsWith("%Q*") ? (analog ? "AO" : "DO")
            : addr ? dirOf(addr, dt, name) : hint ? (analog ? (hint === "DO" ? "AO" : "AI") : hint) : dirOf(addr, dt, name);
        addSig(sink, { tag: name, dt, addr, cmt, dir: d, src: { file: f.name, line: lineAt(t, v.pos), quote: quoteOf(name + (at ? " AT " + at : "")) } });
    }
    const pl = platFromText(sink.pous.map(p => p.body).join("\n")) || (anyStar ? "beckhoff" : undefined);
    if (pl)
        sink.plats.push(pl);
    else
        sink.weak.push("codesys");
    if (!sink.meta.name) {
        const n = xmlAll(doc, "contentHeader")[0]?.attrs.name;
        if (n && !/^(PLCdesk-Project|PLC-Studio-Project|Unnamed)$/.test(n))
            sink.meta.name = n;
    }
    return { fmt: "PLCopen XML (TC6)", note: sfcSteps ? tr("SFC: {n} kroků převedeno na sekvenci (odhad).", { n: sfcSteps }) : sink.signals.length === s0 ? tr("Žádné proměnné s vazbou na I/O.") : undefined };
}
/* ----------------------------------------------------------------- ST / SCL zdroje */
const POU_RE = /^[ \t]*(FUNCTION_BLOCK|PROGRAM|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE|INTERFACE)[ \t]+"?([^"\r\n:]+?)"?(?:[ \t]*:[ \t]*\w+)?[ \t]*$/gm;
function gvlVars(f, t, block, offset, plat, sink, gvlName, onlyAt = false) {
    const lines = block.split("\n");
    const decls = [];
    let pos = offset;
    for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z_]\w*)\s*(?:AT\s*(%[\w.*]+))?\s*:\s*"?([A-Za-z_][\w ]*?)"?\s*(?:\[[^\]]*\])?\s*(?::=[^;]*)?;\s*(?:\(\*\s*([\s\S]*?)\s*\*\)|\/\/\s*(.*))?/);
        if (m && !/^(VAR_GLOBAL|END_VAR|VAR|CONSTANT|RETAIN)$/i.test(m[1]))
            decls.push({ name: m[1], at: m[2] || "", dt: normDt(m[3]), cmt: (m[4] || m[5] || "").trim(), line: lineAt(t, pos), raw: line });
        pos += line.length + 1;
    }
    const anyAt = decls.some(d => d.at);
    const allIo = !onlyAt && (/io/i.test(gvlName) || !anyAt);
    let n = 0;
    for (const d of decls) {
        if (!allIo && !d.at)
            continue;
        if (/^%M/i.test(d.at))
            continue; // merker / paměť, ne I/O
        if (!ATOMIC.test(d.dt) && d.dt !== "WORD")
            continue;
        const p = plat ?? (/%[IQ]X|%[IQ]\*/.test(t) ? "codesys" : undefined);
        const addr = canonAddr(d.at, p);
        const dir = d.at.startsWith("%I*") ? (ANALOG_DT.test(d.dt) ? "AI" : "DI") : d.at.startsWith("%Q*") ? (ANALOG_DT.test(d.dt) ? "AO" : "DO") : dirOf(addr, d.dt, d.name);
        addSig(sink, { tag: d.name, dt: d.dt, addr, cmt: d.cmt, dir, src: { file: f.name, line: d.line, quote: quoteOf(d.raw) } });
        n++;
    }
    return n;
}
function exSTSource(f, t, sink) {
    const plat = platFromText(t) || (/AT\s*%[IQ]\*/.test(t) ? "beckhoff" : undefined);
    if (plat)
        sink.plats.push(plat);
    else if (/\{attribute\b|AT\s*%[IQ]X\d/.test(t))
        sink.weak.push("codesys");
    const heads = [];
    for (const m of t.matchAll(POU_RE))
        heads.push({ kw: m[1].toUpperCase(), name: m[2].trim(), pos: m.index });
    let sigs = 0;
    /* VAR_GLOBAL mimo POU (GVL) */
    for (const m of t.matchAll(/VAR_GLOBAL[\s\S]*?END_VAR/gi)) {
        const gName = (t.match(/\(\*\s*(GVL\w*)/) || [])[1] || f.name.replace(/\.\w+$/, "");
        sigs += gvlVars(f, t, m[0], m.index, plat === "siemens" ? "siemens" : plat, sink, gName);
    }
    /* proměnné s adresou v lokálních VAR programů (OpenPLC, CODESYS: x AT %IX0.0 : BOOL) */
    if (plat !== "siemens")
        for (const m of t.matchAll(/^\s*VAR\b(?!_GLOBAL)[\s\S]*?END_VAR/gm))
            if (/\bAT\s*%[IQ]/.test(m[0]))
                sigs += gvlVars(f, t, m[0], m.index, plat || (/%[IQ]X\d/.test(t) ? "codesys" : undefined), sink, "local", true);
    for (let i = 0; i < heads.length; i++) {
        const h = heads[i], end = i + 1 < heads.length ? heads[i + 1].pos : t.length;
        const body = t.slice(h.pos, end);
        if (h.kw === "DATA_BLOCK") {
            const ty = body.split("\n").slice(1).map(l => l.trim()).find(l => /^"?[A-Za-z_]\w*"?$/.test(l) && !/^(BEGIN|NON_RETAIN|VAR|END_DATA_BLOCK)$/i.test(l)) || "";
            if (ty)
                sink.pous.push({ name: h.name, kind: "routine", lang: "other", body: "VAR\n    " + h.name.replace(/\W/g, "_") + " : " + ty.replace(/"/g, "") + ";\nEND_VAR\n" + body.replace(/\b(VAR|END_VAR)\b/g, "$1_"), src: { file: f.name, line: lineAt(t, h.pos) } });
            continue;
        }
        if (h.kw === "TYPE" || h.kw === "INTERFACE")
            continue;
        const kind = h.kw === "FUNCTION_BLOCK" ? "functionBlock" : h.kw === "FUNCTION" ? "function" : "program";
        /* zdroj AWL/STL (NETWORK, CALL): tělo jen jako text + pseudo-ST volání FB */
        if (/^\s*NETWORK\b/m.test(body) || /^\s*CALL\s/m.test(body)) {
            const ps = stlCallsToSt(body);
            sink.pous.push({ name: h.name, kind, lang: "other", body: body.replace(/\bBEGIN\b[\s\S]*$/, "") + (ps.length ? "\n(* STL -> ST: vazby volání *)\n" + ps.join("\n") + "\n" : ""), src: { file: f.name, line: lineAt(t, h.pos) } });
            continue;
        }
        sink.pous.push({ name: h.name, kind, lang: plat === "siemens" ? "SCL" : "ST", body, src: { file: f.name, line: lineAt(t, h.pos) } });
    }
    const fmt = plat === "siemens" ? tr("SCL zdroj (TIA Portal)") : sigs && !heads.length ? tr("Globální proměnné (GVL)") : tr("ST / SCL zdroj");
    return { fmt };
}
/* ------------------------------------------------------------------ TwinCAT 3 */
/** Směr a typ podle svorky Beckhoff (EL1xxx DI, EL2xxx DO, EL3xxx AI, EL4xxx AO; KL/ES/EP obdobně). */
function beckhoffTerm(path) {
    const segs = path.split("^");
    const term = [...segs].reverse().find(s => /\((?:E[LSPJ]|KL|KM|EK|EM)\d{3,4}/.test(s)) || "";
    const m = term.match(/\((?:E[LSPJ]|KL|KM|EM)(\d)\d{2,3}/);
    let dir = m ? { "1": "DI", "2": "DO", "3": "AI", "4": "AO" }[m[1]] : undefined;
    if (!dir)
        dir = /\^Inputs?\b|\^Input$/i.test(path) ? "DI" : /\^Outputs?\b|\^Output$/i.test(path) ? "DO" : undefined;
    const chan = segs.slice(segs.indexOf(term) + 1).join(" ").replace(/\s+/g, " ").trim();
    return { dir, term: (term + (chan ? " " + chan : "")).trim() };
}
/**
 * Pragmy TcLinkTo v deklaracích (TwinCAT): `{attribute 'TcLinkTo' := '.člen := cesta; …'}` před
 * deklarací instance → signály `instance.člen` se zařízením = instance; bez členu = proměnná sama.
 * Volitelně `{attribute 'pytmc' := 'pv: …'}` jako popis.
 */
function tcLinks(f, t, decl, declLine, sink) {
    let n = 0;
    const re = /\{attribute\s+'TcLinkTo'\s*:=\s*'([^']*)'\s*\}/g;
    let m;
    while ((m = re.exec(decl))) {
        const rest = decl.slice(re.lastIndex);
        const dm = rest.match(/^(?:\s*\{[^}]*\}|\s*\/\/[^\n]*|\s*\(\*[\s\S]*?\*\))*\s*([A-Za-z_]\w*)\s*(?:AT\s*(%[\w.*]+))?\s*:\s*([\w.]+)/);
        if (!dm)
            continue;
        const name = dm[1];
        const before = decl.slice(Math.max(0, m.index - 300), m.index);
        const pv = ([...before.matchAll(/'pytmc'\s*:=\s*'[^']*?pv:\s*([^\s']+)/g)].pop() || [])[1] || "";
        for (const part of m[1].split(";").map(s => s.trim()).filter(Boolean)) {
            const lm = part.match(/^(\.[\w.]+)\s*:=\s*(.+)$/);
            const member = lm ? lm[1] : "";
            const path = (lm ? lm[2] : part).trim();
            if (member === "." || !path || path === ".")
                continue;
            const bt = beckhoffTerm(path);
            if (/\((?:E[LSP]|KL)[69]\d{2,3}/.test(bt.term))
                continue; // komunikační / systémové svorky (EL6xxx, EL9xxx)
            if (/WcState|SyncUnit|InfoData|DevState|\bState\b/i.test(member + " " + path))
                continue; // diagnostika sběrnice
            /* směr: konec cesty ^Input/^Output, pak předpona členu i_/q_, pak typ svorky; analog podle svorky / typu členu */
            const leaf = path.split("^").pop() || "";
            const lastMember = member.split(".").pop() || "";
            let io = /^Inputs?$/i.test(leaf) ? "I" : /^Outputs?$/i.test(leaf) ? "O" : undefined;
            if (!io)
                io = /^(i|in|inp)_|^i[A-Z]/.test(lastMember) ? "I" : /^(q|out)_|^q[A-Z]/.test(lastMember) ? "O" : undefined;
            if (!io && bt.dir)
                io = bt.dir === "DI" || bt.dir === "AI" ? "I" : "O";
            if (!io)
                io = (dm[2] || "").startsWith("%Q") ? "O" : "I";
            const isAnalog = bt.dir === "AI" || bt.dir === "AO" || /^(i|q)_[irn][A-Z]/.test(lastMember) || /Value$|^AI |^AO /i.test(leaf);
            const dir = isAnalog ? (io === "I" ? "AI" : "AO") : (io === "I" ? "DI" : "DO");
            const analog = dir === "AI" || dir === "AO";
            if (analog && member && /status|state|underrange|overrange|error|limit|txpdo|toggle/i.test(member + " " + path))
                continue; // diagnostika svorky
            const tag = name + member;
            const s = {
                tag, dt: analog ? "INT" : "BOOL", addr: "", cmt: [pv, bt.term].filter(Boolean).join(" — "), dir,
                src: { file: f.name, line: declLine + lineAt(decl, m.index) - 1, quote: quoteOf(tag + " := " + path) },
            };
            if (member) {
                s.dev = name;
            }
            addSig(sink, s);
            n++;
        }
    }
    void t;
    return n;
}
function exTwinCAT(f, t, sink) {
    const doc = parseXml(t);
    sink.plats.push("beckhoff");
    let sigs = 0, pous = 0;
    const declLine = (n) => n ? lineAt(t, n.pos) : 1;
    for (const g of xmlAll(doc, "GVL")) {
        const d = xmlChild(g, "Declaration");
        const decl = xmlText(d);
        const before = sink.signals.length;
        for (const m of decl.matchAll(/VAR_GLOBAL[\s\S]*?END_VAR/gi))
            gvlVars(f, decl, m[0], m.index, "beckhoff", sink, g.attrs.Name || "GVL");
        for (const s of sink.signals.slice(before))
            s.src.line = declLine(d) + (s.src.line || 1) - 1;
        sigs += sink.signals.length - before;
        sigs += tcLinks(f, t, decl, declLine(d), sink);
    }
    for (const p of xmlAll(doc, "POU")) {
        const d = xmlChild(p, "Declaration");
        const decl = xmlText(d);
        const impl = xmlChild(p, "Implementation");
        const st = xmlChild(impl, "ST");
        const kindKw = (decl.match(/^\s*(?:\{[^}]*\}\s*)*(PROGRAM|FUNCTION_BLOCK|FUNCTION|INTERFACE)\b/m) || [])[1] || "PROGRAM";
        const kind = kindKw === "FUNCTION_BLOCK" ? "functionBlock" : kindKw === "FUNCTION" ? "function" : "program";
        /* metody a akce sdílejí proměnné bloku — jejich kód patří k tělu */
        const extra = [...xmlAll(p, "Method"), ...xmlAll(p, "Action")].map(x => "\n(* " + x.name + " " + (x.attrs.Name || "") + " *)\n" + xmlText(xmlChild(x, "Declaration")) + "\n" + xmlText(xmlChild(xmlChild(x, "Implementation"), "ST"))).join("\n");
        const sfc = xmlChild(impl, "SFC");
        const lang = st ? "ST" : sfc ? "other" : impl?.children[0]?.name === "LD" ? "LD" : impl?.children[0]?.name === "FBD" ? "FBD" : "other";
        sink.pous.push({ name: p.attrs.Name || "POU", kind, lang, body: decl + "\n" + (st ? xmlText(st) : "") + extra + "\nEND_" + kindKw, src: { file: f.name, line: declLine(d) } });
        pous++;
        sigs += tcLinks(f, t, decl, declLine(d), sink);
    }
    const duts = xmlAll(doc, "DUT").length + xmlAll(doc, "Itf").length;
    return { fmt: tr("TwinCAT 3 (TcPOU / TcGVL / TcDUT)"), note: !sigs && !pous && duts ? tr("Datové typy — bez signálů.") : undefined };
}
/** TwinCAT .tsproj / .xti: svorky EtherCAT a vazby proměnných PLC na kanály (Mappings / Link). */
function exTcIo(f, t, sink) {
    const doc = parseXml(t);
    sink.plats.push("beckhoff");
    const boxes = xmlAll(doc, "Box").map(b => xmlText(xmlChild(b, "Name")).trim()).filter(Boolean);
    let n = 0;
    for (const oa of xmlAll(doc, "OwnerA")) {
        for (const ob of oa.children.filter(c => c.name === "OwnerB")) {
            for (const l of ob.children.filter(c => c.name === "Link")) {
                const [va, vb] = [l.attrs.VarA || "", l.attrs.VarB || ""];
                /* strana PLC je ta s „Inputs/Outputs^…" (VarA u OwnerA = PLC / úloha) */
                const plcSide = /PLC|Task|TIRT|TIPC/.test(oa.attrs.Name || "") ? va : vb;
                const ioSide = plcSide === va ? (ob.attrs.Name || "") + "^" + vb : (oa.attrs.Name || "") + "^" + va;
                let name = plcSide.split("^").pop() || "";
                const parts = name.split(".");
                if (parts.length > 1 && /^(GVL|MAIN|PRG|Global|G_)/i.test(parts[0]))
                    parts.shift();
                name = parts.join(".");
                if (!name)
                    continue;
                const bt = beckhoffTerm(ioSide);
                if (/\((?:E[LSP]|KL)[69]\d{2,3}/.test(bt.term) || /WcState|InfoData|DevState|SyncUnit|Toggle|TxPDO|Underrange|Overrange|^Status|Error$/i.test(vb + " " + va))
                    continue;
                const dir = bt.dir || (/Outputs?\^/i.test(plcSide) ? "DO" : "DI");
                const analog = dir === "AI" || dir === "AO";
                addSig(sink, { tag: name, dt: analog ? "INT" : "BOOL", addr: "", cmt: bt.term, dir, src: { file: f.name, line: lineAt(t, l.pos), quote: quoteOf(va + " <-> " + vb) } });
                n++;
            }
        }
    }
    return { fmt: tr("TwinCAT 3 — konfigurace I/O (tsproj / xti)"), note: boxes.length ? tr("{n} svorek / modulů: {list}", { n: boxes.length, list: boxes.slice(0, 6).join(", ") + (boxes.length > 6 ? ", …" : "") }) : undefined };
}
function exSTRoutine(f, t, sink) {
    const plat = /Unitronics|UniLogic/i.test(t) ? "unitronics" : /Logix 5000|TONR\(/.test(t) ? "rockwell" : platFromText(t);
    if (plat)
        sink.plats.push(plat);
    sink.pous.push({ name: f.name.replace(/\.\w+$/, ""), kind: "routine", lang: "ST", body: t, src: { file: f.name, line: 1 } });
    return { fmt: plat === "unitronics" ? tr("Unitronics ST (Machine.st)") : plat === "rockwell" ? tr("Rockwell ST rutina") : tr("ST kód bez deklarací") };
}
/* ------------------------------------------------------------------------ tabulky */
/** Role sloupců podle hlavičky (víc jazyků; GX Works3, TIA, Sysmac, Unitronics, Excel). */
const COL_SYN = [
    ["tag", /^(name|tag|tag ?name|label ?name|symbol|symbol ?name|symbolname|variable|variable ?name|n[aá]zev|jm[eé]no|n[aá]zev tagu|bezeichner|nombre|etiqueta|名称|变量名|变量|标签|标签名|ラベル名|名前|signal|sign[aá]l)$/i],
    ["addr", /^(address|logical ?address|adresa|adresse|operand|direcci[oó]n|i\/?o ?address|io ?address|i\/o address hint|assign.*|device|at|地址|割付.*|デバイス|absolute ?address|absolutadresse|e\/a|i\/o)$/i],
    ["dt", /^(data ?type|datatype|type|typ|datov[yý] typ|datentyp|tipo|tipo de dato|tipo de datos|数据类型|データ型|类型)$/i],
    ["cmt", /^(comment|description|popis|koment[aá][rř]|kommentar|beschreibung|comentario|descripci[oó]n|注释|说明|描述|コメント|text|funkce|function|funktion|.+\(display target\)|remark)$/i],
    ["dev", /^(device ?tag|equipment|za[rř][ií]zen[ií]|ger[aä]t|betriebsmittel|bmk|bmk ?\/ ?tag|equipo|设备|kks|component|komponenta)$/i],
    ["cls", /^(class|t[rř][ií]da|klasse|clase|类别)$/i],
    ["dir", /^(direction|sm[eě]r|richtung|direcci[oó]n i\/o|方向|io ?type|i\/o ?type|signal ?type|druh)$/i],
    ["group", /^(group|skupina|gruppe|grupo|分组)$/i],
];
function colRoles(cells) {
    const r = {};
    cells.forEach((c, i) => {
        const s = c.replace(/^﻿/, "").trim();
        for (const [role, re] of COL_SYN)
            if (!(role in r) && re.test(s)) {
                r[role] = i;
                break;
            }
    });
    return r;
}
function exTable(f, t, sink) {
    const rawLines = t.split(/\r?\n/);
    const nonEmpty = rawLines.filter(l => l.trim());
    if (!nonEmpty.length)
        return null;
    /* Rockwell CSV (Tags and Logic Comments) */
    if (/^(remark,|0\.3\s*$|TYPE,SCOPE,NAME)/m.test(t) && /^(TAG|ALIAS),/m.test(t)) {
        const rows = rawLines.map((l, i) => ({ c: splitDelimited(l, ","), line: i + 1, raw: l })).filter(r => /^(TAG|ALIAS)$/i.test(r.c[0] || ""));
        const unesc = (s) => s.replace(/\$Q/g, '"').replace(/\$N/g, "\n").replace(/\$'/g, "'").replace(/\$\$/g, "$");
        const isIo = (r) => up(r.c[0]) === "ALIAS" && /Local:|:[IO]\./.test(r.c[5] || "");
        const hasAlias = rows.some(isIo);
        const sigRows = rows.filter(r => hasAlias ? isIo(r) : !(r.c[1] || "") && ATOMIC.test(r.c[4] || ""));
        const ra = rockwellAddrs(sigRows.map(r => ({ tag: r.c[2], spec: r.c[5] || "" })).filter(x => x.spec));
        for (const r of sigRows) {
            const name = r.c[2];
            const d = ra.dir.get(name);
            const dt = normDt(r.c[4] || (d === "AI" || d === "AO" ? "REAL" : "BOOL"));
            const addr = ra.addr.get(name) || "";
            addSig(sink, { tag: name, dt, addr, cmt: unesc(r.c[3] || ""), dir: d || dirOf(addr, dt, name), ...(r.c[5] ? { raw: r.c[5] } : {}), src: { file: f.name, line: r.line, quote: quoteOf(r.raw) } });
        }
        const decl = rows.filter(r => !sigRows.includes(r)).map(r => "    " + r.c[2] + " : " + (r.c[4] || "BOOL") + ";");
        if (decl.length)
            sink.pous.push({ name: f.name + ":tags", kind: "routine", lang: "other", body: "VAR\n" + decl.join("\n") + "\nEND_VAR\n", src: { file: f.name, line: 1 } });
        sink.plats.push("rockwell");
        return { fmt: tr("Rockwell CSV export tagů") };
    }
    const delim = guessDelimiter(t);
    const rows = rawLines.map((l, i) => ({ c: splitDelimited(l, delim).map(x => x.replace(/^﻿/, "")), line: i + 1, raw: l })).filter(r => r.c.some(x => x));
    if (!rows.length)
        return null;
    /* hlavička: první řádek (z prvních 15), ve kterém se pozná aspoň tag/adresa + další sloupec */
    let hi = -1, roles = {};
    for (let i = 0; i < Math.min(15, rows.length); i++) {
        const r = colRoles(rows[i].c);
        if (Object.keys(r).length >= 2 && ("tag" in r || "addr" in r || "dev" in r)) {
            hi = i;
            roles = r;
            break;
        }
    }
    const head = hi >= 0 ? rows[hi].c.map(s => s.toLowerCase()) : [];
    let fmt = tr("I/O list (tabulka)");
    let plat;
    if (head.some(h => /label ?name|ラベル名/.test(h))) {
        fmt = tr("Mitsubishi GX Works3 — globální návěští (CSV)");
        plat = "mitsubishi";
    }
    else if (head.includes("i/o address hint") && head.includes("group")) {
        fmt = tr("Unitronics UniLogic — seznam tagů (CSV)");
        plat = "unitronics";
    }
    else if (head.includes("logical address")) {
        fmt = tr("Siemens TIA Portal — tabulka tagů (TSV/CSV)");
        plat = "siemens";
    }
    /* Sysmac Studio: řádky bez hlavičky, sloupce Name, Data Type, Initial Value, AT, Retain, Constant, Network Publish, Comment */
    if (hi < 0 && delim === "\t" && rows.length && rows.every(r => r.c.length >= 2 && /^[A-Za-z_][\w.]*$/.test(r.c[0]) && /^(BOOL|INT|DINT|UINT|WORD|REAL|LREAL|DWORD|SINT|BYTE|TIME|STRING.*|ARRAY.*)$/i.test(r.c[1]))) {
        fmt = tr("OMRON Sysmac Studio — proměnné (tabulka)");
        plat = "omron";
        for (const r of rows) {
            const dt = normDt(r.c[1]);
            if (!ATOMIC.test(dt) && dt !== "WORD")
                continue;
            const at = r.c[3] || "";
            const addr = canonAddr(at);
            addSig(sink, { tag: r.c[0], dt, addr, cmt: r.c[7] || r.c[r.c.length - 1] === r.c[0] ? (r.c[7] || "") : (r.c[7] || ""), dir: dirOf(addr, dt, r.c[0]), src: { file: f.name, line: r.line, quote: quoteOf(r.raw) } });
        }
        sink.plats.push(plat);
        return { fmt };
    }
    let n = 0;
    const cell = (r, role) => role in roles ? (r.c[roles[role]] || "").trim() : "";
    if (hi >= 0) {
        /* sloupec „Device"/„Assign" u Mitsubishi = adresa; jinak u neznámých sloupců rozhodnou hodnoty */
        for (const r of rows.slice(hi + 1)) {
            let tag = cell(r, "tag");
            const dev = cell(r, "dev");
            let rawAddr = cell(r, "addr");
            if (!rawAddr)
                rawAddr = r.c.find(x => canonAddr(x, plat)) || "";
            if (!tag && dev)
                tag = dev;
            if (!tag || /^(class|label name)$/i.test(tag))
                continue;
            if (plat === "unitronics" && !/^I\/O /i.test(cell(r, "group")))
                continue;
            if (/VAR_GLOBAL_CONSTANT/i.test(r.raw))
                continue;
            /* GX Works: lokální návěští POU (VAR, VAR_INPUT…) nejsou I/O stroje */
            if (plat === "mitsubishi" && /^VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP)?$/i.test(cell(r, "cls")))
                continue;
            if (isMemAddr(rawAddr))
                continue;
            const dt = /^(DI|DO|AI|AO)$/i.test(cell(r, "dt")) ? (/^A/i.test(cell(r, "dt")) ? "INT" : "BOOL") : normDt(cell(r, "dt"));
            if (dt && !ATOMIC.test(dt) && !/^(WORD|DWORD|BYTE|INT16|UINT16|FLOAT|DINT)$/i.test(dt))
                continue; // pole, struktury, FB
            const addr = canonAddr(rawAddr, plat);
            let dir;
            const dcell = cell(r, "dir") || (plat === "unitronics" ? cell(r, "group").replace(/^I\/O\s*/i, "") : "") || (/^(DI|DO|AI|AO)$/i.test(cell(r, "dt")) ? cell(r, "dt") : "");
            if (/^(DI|DO|AI|AO)$/i.test(dcell))
                dir = up(dcell);
            else if (/^(I|E|IN|INPUT|EINGANG|VSTUP|ENTRADA|输入|DIGITAL ?IN.*)$/i.test(dcell))
                dir = dt && !BOOL_DT.test(dt) ? "AI" : "DI";
            else if (/^(O|Q|A|OUT|OUTPUT|AUSGANG|V[YÝ]STUP|SALIDA|输出|DIGITAL ?OUT.*)$/i.test(dcell))
                dir = dt && !BOOL_DT.test(dt) ? "AO" : "DO";
            const cls = cell(r, "cls");
            const s = { tag, dt, addr, cmt: cell(r, "cmt"), dir: dir || dirOf(addr, dt, tag), src: { file: f.name, line: r.line, quote: quoteOf(r.raw) } };
            if (dev && dev !== tag)
                s.dev = dev;
            if (cls && /^(Motor|Ventil|AnalogIn|AnalogOut|DI|DO)$/.test(cls))
                s.cls = cls;
            addSig(sink, s);
            n++;
        }
    }
    else {
        /* bez hlavičky: řádek s buňkou-adresou (starší prostý I/O list Tag;Adresa;Zařízení;Třída;Komentář);
           adresy musí mít aspoň třetina řádků — jinak je to text, ne tabulka I/O */
        const withAddr = rows.filter(r => r.c.some(x => canonAddr(x, plat)));
        if (withAddr.length < Math.max(1, rows.length / 3))
            return null;
        for (const r of rows) {
            const ai = r.c.findIndex(x => canonAddr(x, plat));
            if (ai < 0)
                continue;
            const tag = r.c.find((x, i) => i !== ai && /^[A-Za-z_][\w.]*$/.test(x)) || "";
            if (!tag)
                continue;
            const addr = canonAddr(r.c[ai], plat);
            const cls = r.c.find(x => /^(Motor|Ventil|AnalogIn|AnalogOut|DI|DO)$/.test(x));
            const dev = r.c.length >= 4 && ai === 1 && /^[A-Za-z_]\w*$/.test(r.c[2] || "") ? r.c[2] : undefined;
            const cmt = r.c.length >= 5 ? r.c[4] : r.c.filter((x, i) => i !== ai && x !== tag && x !== cls && x !== dev).sort((a, b) => b.length - a.length)[0] || "";
            const s = { tag, dt: "", addr, cmt, dir: dirOf(addr, "", tag), src: { file: f.name, line: r.line, quote: quoteOf(r.raw) } };
            if (dev)
                s.dev = dev;
            if (cls)
                s.cls = cls;
            addSig(sink, s);
            n++;
        }
    }
    if (!n && !(hi >= 0 && plat))
        return null;
    if (plat)
        sink.plats.push(plat);
    return n ? { fmt } : { fmt, note: tr("Bez vstupů a výstupů (lokální nebo vnitřní proměnné).") };
}
/* -------------------------------------------------------------------- README */
function exReadme(t, sink) {
    /* první řádek: „PROJEKT: {name} · {tags} tagů · …" (v libovolném jazyce) */
    const m = t.match(/^[^:\n]{2,20}:\s*(.+?)\s+·\s+\d+\s/m);
    if (m && !sink.meta.name)
        sink.meta.name = m[1];
    return { fmt: tr("README generátoru PLCdesk") };
}
/* ========================================================= extrakce: rozcestník */
function isBinary(f) {
    if (f.text === undefined || f.text === null)
        return true;
    if (f.mime && /^(image|audio|video)\/|pdf|zip|octet|officedocument|msword|excel/i.test(f.mime))
        return true;
    if (/\.(pdf|png|jpe?g|gif|bmp|tiff?|webp|heic|xlsx|xls|docx|doc|zip|7z|ap1\d|ap\d\d|zap\d+|zal\d+|acd|rss|rsp|gx3|gxw|gpj|smc2|slr|vlp|ulpr|project|projectarchive|exe|rar|vsd|mes)$/i.test(f.name))
        return true;
    const s = f.text.slice(0, 4000);
    const ctl = (s.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
    return ctl > 4;
}
/** Binární projekty IDE: přesný parser je nečte — ohlásí se s doporučeným textovým exportem. */
function binaryKind(name) {
    const n = name.toLowerCase();
    if (/\.acd$/.test(n))
        return { fmt: tr("Rockwell Studio 5000 projekt (.ACD, binární)"), note: tr("Exportuj z Logix Designeru L5X (File → Save As → .L5X) nebo tagy CSV.") };
    if (/\.(rss|rsp)$/.test(n))
        return { fmt: tr("RSLogix 500 projekt (binární)"), note: tr("Exportuj z RSLogix 500 tagy a komentáře (CSV) nebo dokumentaci programu.") };
    if (/\.(zap\d+|ap\d+|zal\d+)$/.test(n))
        return { fmt: tr("TIA Portal projekt / archiv (binární)"), note: tr("Exportuj tabulku tagů (XML / XLSX) a bloky (zdroje SCL nebo Openness XML).") };
    if (/\.(gxw|gx3|gxw2|gpj)$/.test(n))
        return { fmt: tr("GX Works projekt (binární)"), note: tr("Exportuj návěští do CSV a programy jako ST / tisk.") };
    if (/\.(smc2|slr)$/.test(n))
        return { fmt: tr("Sysmac Studio projekt (binární)"), note: tr("Zkopíruj tabulku proměnných (Ctrl+C) a programy ST do textu.") };
    if (/\.(vlp|ulpr)$/.test(n))
        return { fmt: tr("Unitronics projekt (binární)"), note: tr("Exportuj seznam operandů / tagů a I/O list.") };
    if (/\.(project|projectarchive)$/.test(n))
        return { fmt: tr("CODESYS projekt (binární)"), note: tr("Exportuj PLCopen XML (Project → Export PLCopenXML).") };
    if (/\.(exe|zip|7z|rar)$/.test(n))
        return { fmt: tr("archiv (binární)"), note: tr("Rozbal archiv a přidej jednotlivé soubory.") };
    return undefined;
}
export function extractFiles(files) {
    const sink = { signals: [], pous: [], plats: [], weak: [], meta: {}, dirHints: new Map(), skipped: [] };
    const reports = [];
    const unparsed = [];
    for (const f of files) {
        if (isBinary(f)) {
            unparsed.push(f);
            const b = binaryKind(f.name);
            reports.push({ name: f.name, fmt: b ? b.fmt : tr("dokument / obrázek (zpracuje AI)"), ok: false, signals: 0, pous: 0, ...(b ? { note: b.note } : {}) });
            continue;
        }
        const t = (f.text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
        const s0 = sink.signals.length, p0 = sink.pous.length;
        let r = null;
        try {
            if (/<TcPlcObject[\s>]/.test(t))
                r = exTwinCAT(f, t, sink);
            else if (/<TcSmProject[\s>]|<TcSmItem[\s>]/.test(t))
                r = exTcIo(f, t, sink);
            else if (/\.plcproj$/i.test(f.name) && /<Project[\s>]/.test(t)) {
                sink.plats.push("beckhoff");
                r = { fmt: tr("TwinCAT 3 — projekt PLC (seznam souborů)"), note: tr("{n} objektů projektu", { n: (t.match(/<Compile Include=/g) || []).length }) };
            }
            else if (/<SW\.Tags\.PlcTagTable/.test(t))
                r = exSimaticTags(f, t, sink);
            else if (/<RSLogix5000Content/.test(t))
                r = exL5X(f, t, sink);
            else if (/^\s*(IE_VER\s*:=|CONTROLLER\s+\w+\s*\()/m.test(t) && /\bEND_CONTROLLER\b|\bEND_TAG\b/.test(t))
                r = exL5K(f, t, sink);
            else if (/plcopen\.org\/xml\/tc6|<project[\s>][\s\S]*<types>/.test(t))
                r = exPLCopen(f, t, sink);
            else if (/<SW\.(Blocks|Types|TechnologicalObjects)\./.test(t))
                r = exSimaticBlock(f, t, sink);
            else if (/\.sdf$/i.test(f.name))
                r = exSdf(f, t, sink);
            else if (/^README/i.test(f.name) && /PLCdesk|PLC Studio/.test(t))
                r = exReadme(t, sink);
            else if (/^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK)\s+\S/m.test(t) || /^\s*VAR_GLOBAL\b/m.test(t))
                r = exSTSource(f, t, sink);
            else if ((t.match(/:=[^;\n]*;/g) || []).length >= 3 && !/^\s*</.test(t))
                r = exSTRoutine(f, t, sink);
            else
                r = exTable(f, t, sink);
        }
        catch (e) {
            r = null;
        }
        if (!r) {
            unparsed.push(f);
            reports.push({ name: f.name, fmt: tr("neznámý formát (zpracuje AI)"), ok: false, signals: 0, pous: 0 });
            continue;
        }
        reports.push({ name: f.name, fmt: r.fmt, ok: true, signals: sink.signals.length - s0, pous: sink.pous.length - p0, ...(r.note ? { note: r.note } : {}) });
    }
    /* směr podle použití v LAD/FBD (cívka = výstup, kontakt = vstup) u signálů bez adresy */
    for (const s of sink.signals) {
        const h = sink.dirHints.get(up(s.tag));
        if (h && !s.addr && (s.dir === "DI" || s.dir === "DO"))
            s.dir = h;
    }
    /* platforma: většina hlasů souborů */
    const votes = new Map();
    for (const p of sink.plats)
        votes.set(p, (votes.get(p) || 0) + 1);
    for (const p of sink.weak)
        votes.set(p, (votes.get(p) || 0) + 0.4);
    const platform = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ex = { files: reports, signals: sink.signals, pous: sink.pous, unparsed };
    if (platform)
        ex.platform = platform;
    if (sink.meta.name)
        ex.meta = { name: sink.meta.name };
    if (sink.skipped.length)
        ex.skipped = sink.skipped;
    return ex;
}
/* ================================================ rozpoznání signálů podle jména */
const OUR_SIGS = new Set(["fbkRunning", "fault", "outRun", "fbkOpen", "fbkClosed", "outOpen", "raw", "in", "out"]);
const W_RUN = new Set(["run", "running", "runfb", "ein", "on", "start", "chod", "beh", "marcha", "lauf", "laeuft", "lauft", "betrieb", "motor", "运行", "fwd", "forward"]);
const W_FB = new Set(["fb", "fbk", "feedback", "rm", "rueckmeldung", "ruckmeldung", "ack", "hlaseni", "status", "sts", "st", "conf", "confirm", "zpetne", "rf"]);
const W_FAULT = new Set(["fault", "flt", "err", "error", "trip", "tripped", "ol", "overload", "thermal", "therm", "stoerung", "storung", "stor", "porucha", "fallo", "falla", "alm", "fail", "failure", "故障", "mss", "prot", "protection", "motorschutz", "overcurrent", "jistic", "ochrana", "disyuntor"]);
const W_OPEN = new Set(["open", "opened", "auf", "offen", "otevrit", "otevreno", "otev", "abrir", "abierto", "opn", "extend", "extended", "vor", "ausgefahren", "vysun", "vysunuto", "up", "nahoru", "upnuto", "clamp", "clamped"]);
const W_CLOSE = new Set(["close", "closed", "zu", "geschlossen", "zavrit", "zavreno", "cerrar", "cerrado", "cls", "retract", "retracted", "zurueck", "zuruck", "eingefahren", "zasun", "zasunuto", "down", "dolu", "unclamp"]);
const W_CMD = new Set(["cmd", "out", "q", "k", "km", "coil", "do", "output", "befehl", "povel", "ctrl", "control", "sol", "solenoid", "y", "drive", "set", "contactor", "schuetz", "stykac", "contactora", "cívka", "civka"]);
const W_ANALOG = new Set(["raw", "value", "val", "pv", "ai", "ao", "analog", "sp", "setpoint", "soll", "ist", "act", "actual", "ref", "in", "input"]);
const W_IO = new Set(["in", "di", "input", "out", "do", "output", "x", "i", "e", "a", "sig", "signal"]);
const isRoleWord = (w) => W_RUN.has(w) || W_FB.has(w) || W_FAULT.has(w) || W_OPEN.has(w) || W_CLOSE.has(w) || W_CMD.has(w) || W_ANALOG.has(w) || W_IO.has(w);
/** Slova jména (oddělovače _ . - mezera a camelCase), malými písmeny bez diakritiky. */
function words(s) {
    const out = [];
    for (const m of s.matchAll(/[A-Z]?[a-zÀ-ɏ]+|[A-Z]+(?![a-z])|\d+|[一-鿿]+/g))
        out.push({ w: stripDia(m[0]).toLowerCase(), at: m.index });
    return out;
}
/** Signál podle slov přípony a směru (cizí pojmenování). */
function foreignSig(ws, dir) {
    const has = (set) => ws.some(w => set.has(w));
    if (dir === "AI" || dir === "AO")
        return { sig: "raw", kind: "any" };
    if (dir === "DI") {
        if (has(W_FAULT))
            return { sig: "fault", kind: "motor" };
        if (has(W_CLOSE))
            return { sig: "fbkClosed", kind: "valve" };
        if (has(W_OPEN))
            return { sig: "fbkOpen", kind: "valve" };
        if (has(W_RUN) || has(W_FB))
            return { sig: "fbkRunning", kind: "motor" };
        return null;
    }
    if (has(W_FAULT))
        return null; // výstup poruchy = signálka (DO)
    if (has(W_CLOSE))
        return { sig: "outOpen", kind: "valve", close: true };
    if (has(W_OPEN))
        return { sig: "outOpen", kind: "valve" };
    if (has(W_RUN) || has(W_CMD))
        return { sig: "outRun", kind: "motor" };
    return null;
}
/**
 * Odhad zařízení a signálu z jména tagu: náš formát `<Zařízení>_<signál>` přesně,
 * jinak přípona ze slov rolí (M1_Ein, Pump1Fbk, Y1_Open, Motor_Run…).
 */
export function splitTag(tag, dir) {
    const m = tag.match(/^([A-Za-z][A-Za-z0-9_]*?)_(fbkRunning|fault|outRun|fbkOpen|fbkClosed|outOpen|raw|in|out)$/);
    if (m)
        return { dev: m[1], sig: m[2], sure: true };
    const ws = words(tag);
    for (let k = 1; k < ws.length; k++) {
        const suf = ws.slice(k).map(x => x.w);
        if (/^\d+$/.test(ws[k].w))
            continue;
        if (suf.every(w => isRoleWord(w) || /^\d+$/.test(w)) && suf.some(w => isRoleWord(w))) {
            /* maďarská notace CODESYS / TwinCAT (xPump1_Run, iLevel) — předpona typu do označení nepatří */
            const raw = tag.slice(0, ws[k].at).replace(/[_.\-\s]+$/, "");
            if (/^(I|O|DI|DO|AI|AO|In|Out|Inp|Outp|X|Y|Q|x|b|i)$/i.test(raw))
                continue; // jen předpona směru — přípona je kratší
            const dev = stripIoPrefix(raw.replace(/^(x|b|i|w|r|di|dw|q|bo|n|f|lr|ui|us|ud)(?=[A-Z])/, ""));
            if (!dev)
                break;
            const fs = dir ? foreignSig(suf, dir) : null;
            return { dev, sig: fs ? fs.sig : undefined, sure: false };
        }
    }
    /* poslední slovo slepené z rolí (OPENSOLENOID, INTLKSUMTRIP, RunFB): role jako předpona / přípona slova */
    const last = ws[ws.length - 1];
    if (ws.length > 1 && last && !/^\d+$/.test(last.w)) {
        const all = [W_RUN, W_FB, W_FAULT, W_OPEN, W_CLOSE, W_CMD].flatMap(s => [...s]).filter(w => w.length >= 4);
        const parts = all.filter(w => last.w.startsWith(w) || last.w.endsWith(w));
        if (parts.length) {
            const dev = stripIoPrefix(tag.slice(0, last.at).replace(/[_.\-\s]+$/, ""));
            if (dev && !/^(I|O|DI|DO|AI|AO|In|Out|X|Y|Q)$/i.test(dev)) {
                const fs = dir ? foreignSig(parts, dir) : null;
                return { dev, sig: fs ? fs.sig : undefined, sure: false };
            }
        }
    }
    return { dev: stripIoPrefix(tag) || tag, sure: false };
}
/** Předpona směru I/O (I_, O_, DI_, DO_, In_, Out_…) do označení zařízení nepatří. */
function stripIoPrefix(s) {
    return s.replace(/^(I|O|DI|DO|AI|AO|In|Out|Inp|Outp)_(?=[A-Za-z])/i, "");
}
/** Označení zařízení z cizího jména → platný identifikátor (max. 32 znaků, bez „__" a koncového „_"). */
function devIdent(s) {
    let t = sanitizeTag(s).replace(/_+$/, "");
    if (!/^[A-Za-z]/.test(t))
        t = "D_" + t;
    return t.slice(0, 32).replace(/_+$/, "") || "DEV";
}
/** Vymaže komentáře (zachová konce řádků) a vrátí je po řádcích. */
function stripComments(src) {
    const cmts = new Map();
    let out = "", line = 0, i = 0;
    const push = (l, c) => { const a = cmts.get(l) || []; a.push(c.trim()); cmts.set(l, a); };
    while (i < src.length) {
        const ch = src[i], nx = src[i + 1];
        if (ch === "(" && nx === "*") {
            let depth = 1, j = i + 2;
            while (j < src.length && depth) {
                if (src[j] === "(" && src[j + 1] === "*") {
                    depth++;
                    j += 2;
                    continue;
                }
                if (src[j] === "*" && src[j + 1] === ")") {
                    depth--;
                    j += 2;
                    continue;
                }
                j++;
            }
            const c = src.slice(i, j);
            push(line, c.replace(/^\(\*|\*\)$/g, ""));
            for (const x of c) {
                out += x === "\n" ? "\n" : " ";
                if (x === "\n")
                    line++;
            }
            i = j;
            continue;
        }
        if (ch === "/" && nx === "*") {
            const j = src.indexOf("*/", i + 2);
            const e = j < 0 ? src.length : j + 2;
            const c = src.slice(i, e);
            push(line, c.replace(/^\/\*|\*\/$/g, ""));
            for (const x of c) {
                out += x === "\n" ? "\n" : " ";
                if (x === "\n")
                    line++;
            }
            i = e;
            continue;
        }
        if (ch === "/" && nx === "/") {
            const j = src.indexOf("\n", i);
            const e = j < 0 ? src.length : j;
            push(line, src.slice(i + 2, e));
            out += " ".repeat(e - i);
            i = e;
            continue;
        }
        if (ch === "'") { // řetězec — komentáře uvnitř neplatí
            const j = src.indexOf("'", i + 1);
            const e = j < 0 ? src.length : j + 1;
            out += src.slice(i, e);
            i = e;
            continue;
        }
        if (ch === "\n")
            line++;
        out += ch;
        i++;
    }
    return { code: out, cmts };
}
function mkUnit(p, sigTags, instNames) {
    const { code: c0, cmts } = stripComments(p.body);
    let code = c0
        /* Rockwell: TONR nad FBD_TIMER → IEC tvar volání časovače */
        .replace(/(\w+)\.PRE\s*:=\s*(\d+)\s*;\s*\1\.TimerEnable\s*:=\s*([^;]+?)\s*;\s*TONR\s*\(\s*\1\s*\)\s*;/g, (all, t, ms, cond) => t + "(IN := " + cond + ", PT := T#" + ms + "MS);" + "\n".repeat((all.match(/\n/g) || []).length))
        .replace(/(\w+)\.TimerEnable\s*:=\s*([^;]+?)\s*;\s*\1\.PRE\s*:=\s*(\d+)\s*;\s*TONR\s*\(\s*\1\s*\)\s*;/g, (all, t, cond, ms) => t + "(IN := " + cond + ", PT := T#" + ms + "MS);" + "\n".repeat((all.match(/\n/g) || []).length))
        .replace(/\.DN\b/g, ".Q")
        /* Logix / CODESYS nerozlišují velikost klíčových slov (if … end_if) */
        .replace(/\b(if|then|else|elsif|end_if|case|of|end_case|and|or|not|xor|true|false|return)\b/gi, (k) => k.toUpperCase())
        .replace(/#(?=[A-Za-z_])/g, "")
        .replace(/"([A-Za-z_]\w*)"/g, "$1");
    /* kvalifikace GVL (GVL_IO.M1_run) pryč — jen u známých signálů, ne u členů instancí */
    code = code.replace(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g, (all, q, n) => sigTags.has(up(n)) && !instNames.has(up(q)) ? n : all);
    return { pou: p, code, lines: code.split("\n"), cmts, raw: p.body };
}
const lineNo = (u, off) => lineAt(u.code, off) - 1; // index řádku (0…)
const srcOf = (u, li) => ({
    file: u.pou.src.file, line: (u.pou.src.line || 1) + li, quote: quoteOf((u.raw.split("\n")[li] || "")),
});
const cmtAt = (u, li) => (u.cmts.get(li) || []).join(" ");
/** Deklarace `jméno : Typ;` ze všech bloků VAR (i Siemens "Typ"). */
function declsOf(text, out) {
    for (const blk of text.matchAll(/\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP|_STAT|_GLOBAL|_EXTERNAL)?\b([\s\S]*?)\bEND_VAR\b/g)) {
        for (const m of blk[1].matchAll(/^\s*([A-Za-z_]\w*)\s*(?:AT\s*\S+\s*)?:\s*"?([A-Za-z_][\w.]*)"?/gm)) {
            if (!/^(CONSTANT|RETAIN|PERSISTENT|NON_RETAIN)$/i.test(m[1]))
                out.set(up(m[1]), m[2]);
        }
    }
}
const TIMER_T = /^(TON|TOF|TP|TONR|TON_TIME|TOF_TIME|TP_TIME|FBD_TIMER|TIMER|R_TRIG|F_TRIG|CTU|CTD|CTUD|RS|SR|LTON|IEC_TIMER|COUNTER)$/i;
const OUR_FB = { FB_MOTOR: "Motor", FB_VENTIL: "Ventil", FB_ANALOGIN: "AnalogIn", FB_ANALOGOUT: "AnalogOut" };
const P_IN = {
    Motor: ["enable", "cmdStart", "cmdStop", "reset", "fbkRunning", "fault"],
    Ventil: ["enable", "cmdOpen", "cmdClose", "reset", "fbkOpen", "fbkClosed"],
    AnalogIn: ["rawValue", "rawMax", "scaleMin", "scaleMax", "limitHi", "limitLo"],
    AnalogOut: ["value", "rawMax", "scaleMin", "scaleMax"],
};
const P_OUT = {
    Motor: ["outRun", "busy", "error", "status"], Ventil: ["outOpen", "busy", "error", "status"],
    AnalogIn: ["value", "alarmHi", "alarmLo"], AnalogOut: ["rawValue"],
};
const ALL_IN = new Set(Object.values(P_IN).flat().map(up));
const FLAT_RE = /\b(inst[A-Za-z0-9]\w*?)_(enable|cmdStart|cmdStop|reset|resetIn|fbkRunning|fault|cmdOpen|cmdClose|fbkOpen|fbkClosed|rawValue|rawMax|scaleMin|scaleMax|limitHi|limitLo|value)\s*:=\s*([^;]*);/g;
function findInstances(units, types, sigTags) {
    const out = new Map();
    const isInst = (n) => {
        const t = types.get(up(n));
        if (t && TIMER_T.test(t))
            return false;
        if (/^tonSeq\d+$/i.test(n))
            return false;
        return !!t || /^inst[A-Z0-9]/.test(n);
    };
    const get = (u, name, li) => {
        let x = out.get(up(name));
        if (!x) {
            x = { name, type: types.get(up(name)) || "", unit: u, li, endLi: li, ins: {}, outs: {}, trail: "" };
            out.set(up(name), x);
        }
        return x;
    };
    for (const u of units) {
        const c = u.code;
        /* 1) volání instance s parametry: inst(a := x, b => y); */
        for (const m of c.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
            const name = m[1];
            if (!isInst(name) || types.get(up(name)) === undefined && !/^inst/.test(name))
                continue;
            let i = m.index + m[0].length, depth = 1;
            const parts = [{ s: "", at: i }];
            while (i < c.length && depth) {
                const ch = c[i];
                if (ch === "(")
                    depth++;
                else if (ch === ")") {
                    if (--depth === 0)
                        break;
                }
                else if (ch === "," && depth === 1) {
                    parts.push({ s: "", at: i + 1 });
                    i++;
                    continue;
                }
                else if (ch === ";" && depth === 1)
                    break;
                parts[parts.length - 1].s += ch;
                i++;
            }
            if (!parts.some(p => /:=|=>/.test(p.s)))
                continue;
            const li = lineNo(u, m.index), endLi = lineNo(u, i);
            const x = get(u, name, li);
            x.unit = u;
            x.li = li;
            x.endLi = endLi;
            for (const p of parts) {
                const pm = p.s.match(/^\s*([A-Za-z_]\w*)\s*(:=|=>)\s*([\s\S]*?)\s*$/);
                if (!pm)
                    continue;
                const pli = lineNo(u, p.at + (p.s.length - p.s.trimStart().length));
                const a = { expr: pm[3].replace(/\s+/g, " "), cmt: cmtAt(u, pli), li: pli };
                (pm[2] === ":=" ? x.ins : x.outs)[pm[1]] = a;
            }
            x.trail = cmtAt(u, endLi);
        }
        /* 2) členy instance (Rockwell AOI): inst.a := x;  y := inst.b;  FB_X(inst); */
        for (const m of c.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*:=\s*([^;]*);/g)) {
            if (!isInst(m[1]))
                continue;
            const li = lineNo(u, m.index);
            const x = get(u, m[1], li);
            if (!Object.keys(x.ins).length) {
                x.li = li;
                x.unit = u;
            }
            if (!(m[2] in x.ins))
                x.ins[m[2]] = { expr: m[3].trim().replace(/\s+/g, " "), cmt: cmtAt(u, li), li };
            x.endLi = Math.max(x.endLi, li);
        }
        for (const m of c.matchAll(/\b([A-Za-z_]\w*)\s*:=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*;/g)) {
            if (!isInst(m[2]) || /^(Q|ET|DN|ACC|PRE|EN|TT)$/.test(m[3]))
                continue;
            const li = lineNo(u, m.index);
            const x = get(u, m[2], li);
            x.outs[m[3]] = { expr: m[1], cmt: cmtAt(u, li), li };
            x.endLi = Math.max(x.endLi, li);
        }
        for (const m of c.matchAll(/^\s*([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;/gm)) {
            const x = out.get(up(m[2]));
            if (x) {
                if (!x.type)
                    x.type = m[1];
                const li = lineNo(u, m.index + m[0].indexOf(m[1]));
                x.trail = cmtAt(u, li);
                x.endLi = Math.max(x.endLi, li);
            }
            else if (types.get(up(m[2])) || /^inst/.test(m[2])) {
                const li = lineNo(u, m.index);
                const y = get(u, m[2], li);
                y.type = y.type || m[1];
                y.trail = cmtAt(u, li);
            }
        }
        /* 3) rozepsané bloky (Unitronics): instM1_cmdStart := …;  M1_outRun := instM1_outRun; */
        for (const m of c.matchAll(FLAT_RE)) {
            const pre = m[1];
            if (out.has(up(pre)) && out.get(up(pre)).unit !== u)
                continue;
            const li = lineNo(u, m.index);
            const x = get(u, pre, li);
            if (!(m[2] in x.ins))
                x.ins[m[2]] = { expr: m[3].trim().replace(/\s+/g, " "), cmt: cmtAt(u, li), li };
            x.li = Math.min(x.li, li);
        }
        for (const m of c.matchAll(/\b([A-Za-z_]\w*)\s*:=\s*(inst[A-Za-z0-9]\w*?)_(outRun|outOpen|rawValue)\s*;/g)) {
            if (!out.has(up(m[2])))
                continue;
            const li = lineNo(u, m.index);
            const x = out.get(up(m[2]));
            x.outs[m[3]] = { expr: m[1], cmt: cmtAt(u, li), li };
            x.endLi = Math.max(x.endLi, li);
        }
    }
    return [...out.values()].filter(x => Object.keys(x.ins).length + Object.keys(x.outs).length > 0);
}
/** Třída instance: náš typ přesně, jinak podle parametrů a jména typu. */
function instClass(x, sigDir) {
    const t = up(x.type || "");
    if (OUR_FB[t])
        return { cls: OUR_FB[t], sure: true };
    const ins = Object.keys(x.ins), outs = Object.keys(x.outs);
    const has = (l, n) => l.includes(n);
    if (has(ins, "cmdStart") || has(ins, "fbkRunning") || has(outs, "outRun"))
        return { cls: "Motor", sure: !x.type || /^inst/.test(x.name) };
    if (has(ins, "cmdOpen") || has(ins, "fbkOpen") || has(outs, "outOpen"))
        return { cls: "Ventil", sure: !x.type || /^inst/.test(x.name) };
    if (has(outs, "rawValue") || (has(ins, "value") && !has(ins, "limitHi")))
        return { cls: "AnalogOut", sure: /^inst/.test(x.name) };
    if (has(ins, "rawValue") && (has(ins, "limitHi") || has(ins, "scaleMin")))
        return { cls: "AnalogIn", sure: /^inst/.test(x.name) };
    const tn = stripDia(x.type || "").toLowerCase();
    if (/valve|ventil|cyl|zyl|valvula|cilindro|vent/.test(tn))
        return { cls: "Ventil", sure: false };
    if (/motor|pump|drive|conv|fan|antrieb|mot|bomba|cerpad|agitat|ruhrw/.test(tn))
        return { cls: "Motor", sure: false };
    if (/analog.?out|_ao\b|^ao|aout|scale_?out|unscale/.test(tn))
        return { cls: "AnalogOut", sure: false };
    if (/analog|_ai\b|^ai|ain|scale|measure|mess/.test(tn))
        return { cls: "AnalogIn", sure: false };
    /* podle slov parametrů zapojených na signály (OpnSw/ClsSw/Coil → ventil, RunFbk/Overload/Out → motor) */
    const wiredPars = [...Object.entries(x.ins), ...Object.entries(x.outs)].filter(([, a]) => sigDir(a.expr));
    const pw = wiredPars.flatMap(([p]) => words(p).map(w => w.w));
    if (pw.some(w => W_OPEN.has(w) || W_CLOSE.has(w)) && wiredPars.some(([, a]) => sigDir(a.expr) === "DO" || sigDir(a.expr) === "DI"))
        return { cls: "Ventil", sure: false };
    if (pw.some(w => W_RUN.has(w) || W_FB.has(w) || W_FAULT.has(w)) && wiredPars.some(([, a]) => sigDir(a.expr) === "DO"))
        return { cls: "Motor", sure: false };
    /* podle zapojených signálů */
    const dirs = [...Object.values(x.ins), ...Object.values(x.outs)].map(a => sigDir(a.expr)).filter(Boolean);
    if (dirs.includes("AI"))
        return { cls: "AnalogIn", sure: false };
    if (dirs.includes("AO"))
        return { cls: "AnalogOut", sure: false };
    return { cls: "", sure: false };
}
/** Označení zařízení z názvu instance (instM1 → M1, fbPump1 → Pump1, M1_FB → M1). */
function devNameOfInst(n) {
    let s = n.replace(/^inst(?=[A-Z0-9])/, "");
    if (s === n)
        s = n.replace(/^(i|fb|fbi|inst|in)_?(?=[A-Z])/, "").replace(/_(fb|inst|aoi|db|idb|hndl|handler|ctrl|ctl|ctrl_fb)$/i, "");
    return s || n;
}
/* ------------------------------------------------- texty komentářů ve všech jazycích */
const LANG_LIST = Object.keys(LANGS);
/** Odpovídá text šabloně `cs` v některém jazyce (bez diakritiky)? Vrací zástupné hodnoty. */
function matchTpl(text, cs) {
    const norm = (s) => stripDia(s).replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
    const t = norm(text);
    for (const l of LANG_LIST) {
        const tpl = norm(trIn(l, cs));
        const names = [];
        const re = new RegExp("^" + tpl.replace(/[.*+?^$()[\]\\|]/g, "\\$&").replace(/\\?\{(\w+)\\?\}|\{(\w+)\}/g, (_m, a, b) => { names.push(a || b); return "(.+?)"; }) + "$");
        const m = t.match(re);
        if (m) {
            const o = {};
            names.forEach((n, i) => o[n] = m[i + 1]);
            return o;
        }
    }
    return null;
}
const sameText = (a, cs) => LANG_LIST.some(l => stripDia(trIn(l, cs)).toLowerCase().trim() === stripDia(a).toLowerCase().trim());
/** Role DO — stejné klíče jako krátké popisky v komentářích generátoru (DO_ROLE_TECH). */
const ROLE_TECH = {
    run: N_("chod"), fault: N_("porucha"), ready: N_("připraveno"), stopped: N_("stop"), lock: N_("zámek krytů"), auto: N_("AUTO"),
};
const ESTOP_RE = /nouz|e-?stop|estop|not-?halt|nothalt|not-?aus|notaus|emergenc|emerg|paro de emergencia|parada de emergencia|parada|急停|紧急|nood|^nh\d|_nh\b|^es\d*$|_es\b/i;
export function inferProject(ex, base) {
    const prj = base ? clone(base) : blankProject();
    const evidence = {};
    const conflicts = [];
    const ev = (k, conf, src, note) => { evidence[k] = note ? { conf, src, note } : { conf, src }; };
    /* ---- 0) Rockwell: body modulů ze všech souborů najednou (jinak by se rozsahy modulů lišily soubor od souboru) */
    const rwSpecs = new Map();
    for (const s of ex.signals)
        if (s.raw && IO_ALIAS.test(s.raw) && !rwSpecs.has(up(s.tag)))
            rwSpecs.set(up(s.tag), s.raw);
    if (rwSpecs.size) {
        const analog = new Set([...ex.signals].filter(s => s.dir === "AI" || s.dir === "AO").map(s => up(s.tag)));
        const ra = rockwellAddrs([...rwSpecs].map(([tag, spec]) => ({ tag, spec })), analog);
        for (const s of ex.signals) {
            const a = ra.addr.get(up(s.tag));
            if (a && s.raw && IO_ALIAS.test(s.raw))
                s.addr = a;
        }
    }
    /* ---- 1) signály: sloučit soubory (tag bez ohledu na velikost), rozpory adres hlásit */
    const sigs = [];
    const byTag = new Map();
    for (const s of ex.signals) {
        const k = up(s.tag);
        const o = byTag.get(k);
        if (!o) {
            const n = { ...s, srcs: [s.src], conf: "sure" };
            byTag.set(k, n);
            sigs.push(n);
            continue;
        }
        o.srcs.push(s.src);
        if (s.addr && !o.addr)
            o.addr = s.addr;
        else if (s.addr && o.addr && s.addr !== o.addr)
            conflicts.push({ what: "io:" + o.tag, note: tr("Signál {tag}: adresa {a} × {b} v různých souborech.", { tag: o.tag, a: o.addr, b: s.addr }), src: [o.src, s.src] });
        if (!o.cmt && s.cmt)
            o.cmt = s.cmt;
        if (!o.dt && s.dt)
            o.dt = s.dt;
        if (!o.dev && s.dev) {
            o.dev = s.dev;
            o.sig = s.sig;
        }
        if (s.cls && !o.cls)
            o.cls = s.cls;
    }
    const sigTags = new Set(sigs.map(s => up(s.tag)));
    const sigOf = (expr) => /^[A-Za-z_]\w*$/.test(expr.trim()) ? byTag.get(up(expr.trim())) : undefined;
    /* ---- 2) program: deklarace, jednotky kódu, instance */
    const types = new Map();
    const pous = [];
    const seenPou = new Set();
    for (const p of ex.pous) { // stejný POU z víc souborů (MAIN.st + PLCopen) jen jednou
        const k = p.kind + ":" + up(p.name);
        if (seenPou.has(k))
            continue;
        seenPou.add(k);
        pous.push(p);
    }
    for (const p of pous)
        declsOf(p.body, types);
    const instNames = new Set([...types.entries()].filter(([, t]) => !TIMER_T.test(t)).map(([n]) => n));
    /* ST/SCL; LD/FBD jen s převedenými vazbami bloků (pseudo-ST „inst.Param := tag;") */
    const allUnits = pous.filter(p => p.lang === "ST" || p.lang === "SCL" || (/:=/.test(p.body) && (p.lang === "LD" || p.lang === "FBD" || /->\s*ST/.test(p.body)))).map(p => mkUnit(p, sigTags, instNames));
    /* bloky zařízení (typy instancí bez odkazu na globální signály) se neanalyzují jako program stroje */
    const fbTypes = new Set([...types.values()].map(up));
    const refsSig = (u) => { for (const m of u.code.matchAll(/\b[A-Za-z_]\w*\b/g))
        if (sigTags.has(up(m[0])))
            return true; return false; };
    const units = allUnits.filter(u => !(u.pou.kind === "functionBlock" && (OUR_FB[up(u.pou.name)] || (fbTypes.has(up(u.pou.name)) && !refsSig(u)))) && !OUR_FB[up(u.pou.name)]);
    const insts = findInstances(units, types, sigTags);
    const sigDir = (e) => sigOf(e)?.dir;
    const devs = [];
    const devByName = new Map();
    const addDev = (d) => { devs.push(d); devByName.set(up(d.name), d); return d; };
    const uniqName = (n) => { let s = devIdent(n), i = 2; while (devByName.has(up(s)))
        s = devIdent(n) + "_" + i++; return s; };
    for (const x of insts) {
        const { cls, sure } = instClass(x, sigDir);
        if (!cls)
            continue;
        const name = uniqName(devNameOfInst(x.name));
        const d = { name, cls, desc: "", conf: sure ? "sure" : "guess", src: [srcOf(x.unit, x.li)], sigs: {}, opt: {}, dev: {}, order: 1e9, inst: x };
        /* titulek „M1 – popis" na řádku před voláním */
        for (let li = x.li - 1; li >= Math.max(0, x.li - 3); li--) {
            const codeLine = x.unit.lines[li].trim(), c = cmtAt(x.unit, li);
            if (codeLine)
                break;
            const m = c.match(/^\s*([A-Za-z_]\w*)\s*(?:[–—-]\s*(.*))?$/);
            if (m && up(m[1]) === up(name)) {
                d.desc = (m[2] || "").trim();
                break;
            }
        }
        const our = OUR_FB[up(x.type)] || /^inst/.test(x.name);
        const bind = (param, a, sig, dir) => {
            if (!a)
                return undefined;
            const s = sigOf(a.expr);
            if (s) {
                s.owner = name;
                s.osig = sig;
                s.dir = dir;
                s.conf = our ? "sure" : "guess";
                d.sigs[sig] = s;
                return true;
            }
            if (/^(TRUE|1)$/i.test(a.expr.trim()))
                return false;
            if (/^(FALSE|0)$/i.test(a.expr.trim()))
                return false;
            return undefined;
        };
        if (our) {
            if (cls === "Motor") {
                d.opt.fbk = bind("fbkRunning", x.ins.fbkRunning, "fbkRunning", "DI") === true;
                d.opt.fault = bind("fault", x.ins.fault, "fault", "DI") === true;
                bind("outRun", x.outs.outRun, "outRun", "DO");
            }
            else if (cls === "Ventil") {
                d.opt.fbkOpen = bind("fbkOpen", x.ins.fbkOpen, "fbkOpen", "DI") === true;
                d.opt.fbkClosed = bind("fbkClosed", x.ins.fbkClosed, "fbkClosed", "DI") === true;
                bind("outOpen", x.outs.outOpen, "outOpen", "DO");
            }
            else if (cls === "AnalogIn") {
                bind("rawValue", x.ins.rawValue, "raw", "AI");
                const num = (a) => a && /^[-+]?\d/.test(a.expr) ? Number(a.expr.replace(/E\+?/i, "e")) : undefined;
                const mn = num(x.ins.scaleMin), mx = num(x.ins.scaleMax), hi = num(x.ins.limitHi), lo = num(x.ins.limitLo);
                if (mn !== undefined)
                    d.dev.rmin = mn;
                if (mx !== undefined)
                    d.dev.rmax = mx;
                if (hi !== undefined && Math.abs(hi) < 1e6)
                    d.dev.limHi = hi;
                if (lo !== undefined && Math.abs(lo) < 1e6)
                    d.dev.limLo = lo;
                const tc = x.trail.split(";")[0].trim();
                if (tc && !sameText(tc, "jednotky dle snímače") && !/^TODO/i.test(tc))
                    d.dev.unit = tc;
                const uc = matchTpl(cmtAt(x.unit, x.li - 1).replace(/^.*?\s{2,}/, ""), "hodnota v {unit}: {tag}");
                if (uc && uc.unit)
                    d.dev.unit = uc.unit;
            }
            else if (cls === "AnalogOut") {
                bind("rawValue", x.outs.rawValue, "raw", "AO");
                const num = (a) => a && /^[-+]?\d/.test(a.expr) ? Number(a.expr.replace(/E\+?/i, "e")) : undefined;
                const mn = num(x.ins.scaleMin), mx = num(x.ins.scaleMax), v = x.ins.value;
                if (mn !== undefined)
                    d.dev.rmin = mn;
                if (mx !== undefined)
                    d.dev.rmax = mx;
                if (v && num(v) !== undefined && !/TODO/.test(v.cmt))
                    d.dev.setpoint = num(v);
            }
        }
        else {
            /* cizí blok: parametry podle slov a směru zapojeného signálu */
            for (const [param, a] of [...Object.entries(x.ins).map(([p, a]) => [p, a, "in"]), ...Object.entries(x.outs).map(([p, a]) => [p, a, "out"])].map(z => [z[0], z[1]])) {
                const s = sigOf(a.expr);
                if (!s)
                    continue;
                const ws = words(param).map(w => w.w);
                let sig = cls === "AnalogIn" || cls === "AnalogOut" ? "raw" : foreignSig(ws, s.dir)?.sig;
                if (!sig)
                    continue;
                if (cls === "Motor" && !["fbkRunning", "fault", "outRun"].includes(sig))
                    sig = s.dir === "DO" ? "outRun" : "fbkRunning";
                if (cls === "Ventil" && !["fbkOpen", "fbkClosed", "outOpen"].includes(sig))
                    sig = s.dir === "DO" ? "outOpen" : "fbkOpen";
                if (d.sigs[sig])
                    continue;
                s.owner = name;
                s.osig = sig;
                s.conf = "guess";
                d.sigs[sig] = s;
            }
            if (cls === "Motor") {
                d.opt.fbk = !!d.sigs.fbkRunning;
                d.opt.fault = !!d.sigs.fault;
            }
            if (cls === "Ventil") {
                d.opt.fbkOpen = !!d.sigs.fbkOpen;
                d.opt.fbkClosed = !!d.sigs.fbkClosed;
            }
            d.note = tr("Blok {type} rozpoznán podle jmen parametrů — ověř přiřazení signálů.", { type: x.type || x.name });
            if (!Object.keys(d.sigs).length)
                continue; // instance bez vazby na I/O není zařízení stroje
        }
        addDev(d);
    }
    /* ---- 4) zbylé signály → zařízení podle jmen (náš formát přesně, cizí heuristicky) */
    const free = sigs.filter(s => !s.owner);
    const groups = new Map();
    for (const s of free) {
        const g = s.dev ? splitTag(s.tag, s.dir) : splitTag(s.tag, s.dir);
        const key = s.dev || g.dev;
        s.dev = key;
        if (!s.sig && g.sig)
            s.sig = g.sig;
        const sp = splitTag(s.tag, s.dir);
        if (sp.sure) {
            s.sig = sp.sig;
        }
        else if (s.sig === undefined || !OUR_SIGS.has(s.sig)) {
            const fs = foreignSig(words(s.tag.slice(key.length)).map(w => w.w), s.dir);
            s.sig = fs?.sig;
        }
        s.conf = sp.sure ? "sure" : "guess";
        (groups.get(up(key)) || groups.set(up(key), []).get(up(key))).push(s);
    }
    const single = (s, nameHint) => {
        const cls = s.dir === "AI" ? "AnalogIn" : s.dir === "AO" ? "AnalogOut" : s.dir === "DO" ? "DO" : "DI";
        const sig = cls === "AnalogIn" || cls === "AnalogOut" ? "raw" : cls === "DO" ? "out" : "in";
        const existing = devByName.get(up(devIdent(nameHint)));
        const name = existing ? uniqName(s.tag) : uniqName(nameHint);
        const sure = s.conf === "sure" && splitTag(s.tag, s.dir).sig === sig;
        s.owner = name;
        s.osig = sig;
        addDev({ name, cls, desc: "", conf: sure ? "sure" : "guess", src: s.srcs, sigs: { [sig]: s }, opt: {}, dev: {}, order: 1e9 });
    };
    for (const [, list] of groups) {
        const key = list[0].dev;
        const our = list.every(s => splitTag(s.tag, s.dir).sure);
        const clsHint = (list.find(s => s.cls)?.cls || "");
        const sigsOf = (n) => list.filter(s => s.sig === n);
        const hasDO = list.some(s => s.dir === "DO");
        const nk = stripDia(key).toLowerCase();
        let cls = clsHint;
        const valveWord = list.some(s => s.dir === "DO" && /solenoid|(^|_)sol(_|\d|$)|coil|valve|ventil|cyl|zyl|(^|_)y[vs]?\d/i.test(s.tag)
            && !/(^|_)(sum|status|sts|permit|fault|alarm|ok|ready|intlk|interlock|all)(_|$)/i.test(s.tag));
        /* signálky, majáky, houkačky: výstup, ne pohon */
        const lampy = list.filter(s => s.dir === "DO").every(s => /lamp|light|beacon|horn|siren|buzzer|led|signal|stack|indicator|leucht|hupe|majak|signalka|houkacka/i.test(stripDia(s.tag + " " + s.cmt)));
        if (!cls && !our && list.length === 1 && list[0].dir === "DO") {
            /* samotný výstup: povel motoru (Run / Ein / Contactor) nebo cívka ventilu bez zpětných hlášení */
            if (valveWord || list[0].sig === "outOpen")
                cls = "Ventil";
            else if ((list[0].sig === "outRun" || /pump|motor|fan(_|\d|$)|conveyor|mixer|agitat|compressor|blower|cerpad|pumpe|bomba|ventilat|stirrer|ruhrw/i.test(stripDia(list[0].tag))) && !lampy)
                cls = "Motor";
        }
        if (!cls && !our && lampy && !list.some(s => s.dir === "DI"))
            cls = "DO";
        if (!cls) {
            if (hasDO && valveWord && list.some(s => s.dir === "DI"))
                cls = "Ventil";
            else if (hasDO && (sigsOf("outOpen").length || sigsOf("fbkOpen").length || sigsOf("fbkClosed").length || /^(y|yv|mv|v|valve|ventil|cyl|zyl)\d/i.test(nk)))
                cls = "Ventil";
            else if ((sigsOf("outRun").length || ((sigsOf("fbkRunning").length || sigsOf("fault").length) && hasDO)) && hasDO)
                cls = "Motor";
            else if (/^(m|p|pump|motor|mot|conv|fan|km)\d/i.test(nk) && hasDO && list.some(s => s.dir === "DI"))
                cls = "Motor";
        }
        if (cls === "Motor" || cls === "Ventil") {
            const name = uniqName(key);
            const d = { name, cls, desc: "", conf: our ? "sure" : "guess", src: list.flatMap(s => s.srcs), sigs: {}, opt: {}, dev: {}, order: 1e9 };
            const want = cls === "Motor" ? ["outRun", "fbkRunning", "fault"] : ["outOpen", "fbkOpen", "fbkClosed"];
            /* nejdřív signály s rozpoznanou rolí, potom ostatní (výstup poruchy / součtu nesmí obsadit povel) */
            const ordered = [...list.filter(s => s.sig && want.includes(s.sig)), ...list.filter(s => !(s.sig && want.includes(s.sig)) && !/(^|_)(sum|trip|fault|alarm|status|sts|intlk|permit)/i.test(s.tag)), ...list.filter(s => !(s.sig && want.includes(s.sig)) && /(^|_)(sum|trip|fault|alarm|status|sts|intlk|permit)/i.test(s.tag))];
            for (const s of ordered) {
                let sig = s.sig && want.includes(s.sig) ? s.sig : undefined;
                if (!sig && s.dir === "DO")
                    sig = want[0];
                if (!sig && s.dir === "DI" && !our)
                    sig = cls === "Motor" ? (d.sigs.fbkRunning ? "fault" : "fbkRunning") : (d.sigs.fbkOpen ? "fbkClosed" : "fbkOpen");
                if (sig && !d.sigs[sig]) {
                    d.sigs[sig] = s;
                    s.owner = name;
                    s.osig = sig;
                }
            }
            if (cls === "Motor") {
                d.opt.fbk = !!d.sigs.fbkRunning;
                d.opt.fault = !!d.sigs.fault;
            }
            else {
                d.opt.fbkOpen = !!d.sigs.fbkOpen;
                d.opt.fbkClosed = !!d.sigs.fbkClosed;
            }
            if (!our)
                d.note = tr("Zařízení sestaveno podle jmen tagů — ověř třídu a signály.");
            addDev(d);
            for (const s of list) {
                if (s.owner)
                    continue;
                /* stejná role z jiného souboru (dva podklady ke stejnému zařízení) = rozpor, ne nové zařízení */
                const role = s.sig && want.includes(s.sig) ? s.sig : s.dir === "DO" ? want[0] : undefined;
                const holder = role ? d.sigs[role] : undefined;
                if (holder && holder.src.file !== s.src.file) {
                    conflicts.push({ what: "dev:" + name, note: tr("{dev}: signál {a} ({fa}) a {b} ({fb}) mají stejnou roli — převzat {a}.", { dev: name, a: holder.tag, fa: holder.src.file, b: s.tag, fb: s.src.file }), src: [holder.src, s.src] });
                    s.owner = name;
                    s.osig = "";
                    continue;
                }
                single(s, s.tag);
            }
        }
        else if (list.length === 1 && (!clsHint || clsHint === "DI" || clsHint === "DO" || clsHint === "AnalogIn" || clsHint === "AnalogOut")) {
            single(list[0], our ? key : (list[0].sig && !["in", "out", "raw"].includes(list[0].sig) ? list[0].tag : key));
        }
        else {
            for (const s of list)
                single(s, our ? (splitTag(s.tag, s.dir).dev) : s.tag);
        }
    }
    /* pořadí zařízení = první výskyt signálu v tabulce tagů (náš generátor: pořadí projektu) */
    sigs.forEach((s, i) => { const d = s.owner ? devByName.get(up(s.owner)) : undefined; if (d && d.order > i)
        d.order = i; });
    devs.forEach((d, i) => { if (d.order === 1e9)
        d.order = 1e6 + i; });
    devs.sort((a, b) => a.order - b.order);
    /* popis zařízení z komentáře signálu, když chybí titulek */
    for (const d of devs) {
        if (d.desc)
            continue;
        const first = Object.values(d.sigs)[0];
        if (!first || !first.cmt)
            continue;
        d.desc = d.cls === "DI" || d.cls === "DO" ? first.cmt : first.cmt.split(/\s+[–—-]\s+/)[0];
        if (d.cls === "AnalogIn" || d.cls === "AnalogOut") {
            const parts = first.cmt.split(/\s+[–—-]\s+/);
            if (parts.length > 1 && !d.dev.unit)
                d.dev.unit = parts[parts.length - 1];
        }
    }
    /* cizí analogy: rozsah a jednotka z popisu („Tlak 0–10 bar", „Level 0..2000 mm") — odhad */
    for (const d of devs) {
        if ((d.cls !== "AnalogIn" && d.cls !== "AnalogOut") || d.conf === "sure" || d.dev.rmin !== undefined)
            continue;
        const m = (d.desc + " " + Object.values(d.sigs).map(s => s.cmt).join(" ")).match(/(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|\.\.\.?|…|to|bis|až|a)\s*(-?\d+(?:[.,]\d+)?)\s*([A-Za-z°%µ][\w°%/³²µ]*)?/);
        if (!m)
            continue;
        const lo = +m[1].replace(",", "."), hi = +m[2].replace(",", ".");
        if (!(lo < hi))
            continue;
        d.dev.rmin = lo;
        d.dev.rmax = hi;
        if (m[3] && !d.dev.unit)
            d.dev.unit = m[3];
        d.note = tr("Rozsah {min}–{max} {unit} převzat z popisu signálu — ověř.", { min: lo, max: hi, unit: m[3] || "" });
    }
    /* ---- 5) projekt: zařízení a I/O */
    if (devs.length || !base) {
        prj.devices = [];
        prj.io = [];
        let id = 1;
        for (const d of devs) {
            const dev = { id: id++, name: d.name, cls: d.cls, desc: d.desc, opt: d.opt, unit: d.dev.unit || "", rmin: d.dev.rmin ?? 0, rmax: d.dev.rmax ?? 100 };
            if (d.dev.limHi !== undefined)
                dev.limHi = d.dev.limHi;
            if (d.dev.limLo !== undefined)
                dev.limLo = d.dev.limLo;
            if (d.dev.setpoint !== undefined)
                dev.setpoint = d.dev.setpoint;
            prj.devices.push(dev);
            ev("dev:" + d.name, d.conf, d.src.slice(0, 4), d.note);
        }
        prj.nextId = id;
        const noAddr = [];
        for (const dev of prj.devices) {
            const d = devByName.get(up(dev.name));
            for (const [sig, dir, lbl] of devSignals(dev)) {
                const s = d.sigs[sig];
                const tag = s ? s.tag : dev.name + "_" + sig;
                const e = {
                    key: dev.id + ":" + sig, devId: dev.id, sig, dir, tag, addr: s ? s.addr : "",
                    cmt: s ? s.cmt : [dev.desc, lbl].filter(Boolean).join(" – "), nc: false,
                };
                e.nc = dir === "DI" && (/\bNC\b/i.test(e.cmt || "") || /\bNC\b/i.test(dev.desc || ""));
                prj.io.push(e);
                /* jistota I/O = tag a adresa doslova z podkladů (přiřazení k zařízení hodnotí dev:<jméno>) */
                if (s)
                    ev("io:" + tag, s.addr ? "sure" : "guess", s.srcs.slice(0, 3), s.addr ? undefined : tr("Adresa v podkladech není — doplněna automaticky."));
                else
                    ev("io:" + tag, "missing", [], tr("Signál v podkladech není — doplněn podle třídy zařízení."));
                if (!e.addr)
                    noAddr.push(tag);
            }
        }
        autoAddr(prj, false);
        prj._noAddr = noAddr;
    }
    const devOfName = (n) => prj.devices.find(d => up(d.name) === up(n));
    const ownerDev = (s) => s && s.owner ? devOfName(s.owner) : undefined;
    /* ---- 6) uvolnění (E-stop, blokování) z výrazu enable — jen signály, žádná safety logika */
    prj.program = { modes: true, estop: "", seq: [], interlocks: [] };
    let enableFound = false;
    {
        let expr = "", cmt = "", src, our = false;
        for (const u of units) {
            const m = u.code.match(/^\s*enable\s*:=\s*([^;]*);/m);
            if (m && !/^\s*enableIn\s*$/i.test(m[1])) {
                const li = lineNo(u, m.index + m[0].indexOf("enable"));
                expr = m[1];
                cmt = cmtAt(u, li);
                src = srcOf(u, li);
                our = true;
                break;
            }
        }
        if (!expr)
            for (const p of pous) { // Siemens: volání v komentáři pro OB1
                const m = p.body.match(/enableIn\s*:=\s*([^\n]*?)\)\s*;[ \t]*(?:\n[ \t]*\/\/[ \t]*([^\n]*))?/);
                if (m) {
                    expr = m[1].replace(/"([A-Za-z_]\w*)"/g, "$1").replace(/\bGVL_IO\./g, "");
                    cmt = (m[2] || "").trim(); // poznámka E-stop / TODO pod voláním (od generátoru 2026-10)
                    src = { file: p.src.file, line: (p.src.line || 1) + lineAt(p.body, m.index) - 1, quote: quoteOf(m[0].split("\n")[0]) };
                    our = true;
                    break;
                }
            }
        if (!expr)
            for (const u of units) { // cizí kód: uvolnění / freigabe / permissive …
                const m = u.code.match(/^\s*(\w*(?:enable|release|freigabe|uvolneni|permissive|habilit\w*|safety_?ok|machine_?ok)\w*)\s*:=\s*([A-Za-z_][\w.]*(?:\s+AND\s+(?:NOT\s+)?[A-Za-z_][\w.]*)+)\s*;/im);
                if (m) {
                    const li = lineNo(u, m.index);
                    expr = m[2];
                    cmt = cmtAt(u, li);
                    src = srcOf(u, li);
                    break;
                }
            }
        if (expr) {
            enableFound = true;
            const tags = [...expr.matchAll(/\b([A-Za-z_]\w*)\b/g)].map(m => m[1]).filter(t => !/^(AND|NOT|TRUE|FALSE|OR)$/i.test(t));
            const ins = tags.map(t => sigOf(t)).filter((s) => !!s && s.dir === "DI");
            const dlist = ins.map(s => ownerDev(s)).filter((d) => !!d && d.cls === "DI");
            let estopIdx = -1;
            if (dlist.length) {
                if (our && cmt)
                    estopIdx = /^\s*TODO/i.test(cmt) ? -1 : 0;
                else
                    estopIdx = dlist.findIndex(d => ESTOP_RE.test(stripDia(d.name + " " + d.desc + " " + (prj.io.find(e => e.devId === d.id)?.tag || ""))));
            }
            const sureEs = our && !!cmt;
            dlist.forEach((d, i) => {
                if (i === estopIdx) {
                    prj.program.estop = d.id;
                    ev("estop", sureEs ? "sure" : "guess", src ? [src] : [], sureEs ? undefined : tr("E-stop určen podle názvu / popisu vstupu."));
                }
                else {
                    prj.program.interlocks.push(d.id);
                    ev("lock:" + d.name, our ? "sure" : "guess", src ? [src] : []);
                }
            });
        }
    }
    /* bez výrazu enable (jen tabulka I/O): E-stop odhadem podle názvu / popisu vstupu */
    if (!enableFound) {
        const es = prj.devices.find(d => d.cls === "DI" && ESTOP_RE.test(stripDia(d.name + " " + d.desc + " " + (prj.io.find(e => e.devId === d.id)?.tag || ""))));
        if (es) {
            prj.program.estop = es.id;
            ev("estop", "guess", evidence["dev:" + es.name]?.src || [], tr("E-stop určen podle názvu / popisu vstupu, v programu nenalezen."));
        }
    }
    /* ---- 7) role DO (vazba na stav stroje) */
    const hasSeqCode = units.some(u => /\bCASE\s+seqStep\s+OF/i.test(u.code));
    for (const d of prj.devices.filter(x => x.cls === "DO")) {
        const e = prj.io.find(x => x.devId === d.id);
        if (!e)
            continue;
        for (const u of units) {
            const re = new RegExp("^\\s*" + e.tag + "\\s*:=\\s*([^;]*);", "mi");
            const m = u.code.match(re);
            if (!m)
                continue;
            const li = lineNo(u, m.index + m[0].search(/\S/));
            const nx = (s) => s.replace(/\b1\b/g, "TRUE").replace(/\b0\b(?!\s*\))/g, (z) => z).replace(/\s+/g, " ").replace(/\(\s*|\s*\)/g, m2 => m2.trim()).trim().toUpperCase();
            const val = nx(m[1].replace(/^\s*(.*?)\s*$/, "$1")).replace(/^0$/, "FALSE");
            const cands = Object.keys(ROLE_TECH).filter(r => nx(roleExpr(r, hasSeqCode, v => v)) === val);
            if (!cands.length)
                break;
            let role = cands[0];
            if (cands.length > 1) {
                for (const one of [...(u.cmts.get(li) || []), ...(u.cmts.get(li - 1) || [])]) {
                    const c = matchTpl(one, "vazba na stav stroje: {role}");
                    const hit = c && cands.find(r => sameText(c.role, ROLE_TECH[r]));
                    if (hit) {
                        role = hit;
                        break;
                    }
                }
            }
            d.role = role;
            ev("dev:" + d.name, "sure", [...(evidence["dev:" + d.name]?.src || []), srcOf(u, li)].slice(0, 4));
            break;
        }
    }
    /* ---- 8) sekvence z CASE */
    const timers = new Map(); // jméno časovače / krok → sekundy
    const stepTimer = new Map(); // „PROMĚNNÁ:krok" → sekundy
    for (const u of units) {
        for (const m of u.code.matchAll(/\b([A-Za-z_]\w*)\s*\(\s*IN\s*:=\s*([^,]*?)\s*,\s*PT\s*:=\s*([^),]+?)\s*\)/g)) {
            const s = parseTimeLit(m[3]);
            if (s === undefined)
                continue;
            timers.set(up(m[1]), s);
            const st = m[2].match(/^\(?\s*([\w.]+)\s*=\s*(\d+)\s*\)?$/);
            if (st)
                stepTimer.set(up(st[1]) + ":" + st[2], s);
        }
    }
    const seqUnits = units.map(u => ({ u, cases: [...u.code.matchAll(/\bCASE\s+([A-Za-z_][\w.]*)\s+OF\b/g)] }));
    /* rozbor jednoho CASE: `our` = náš generátor (přesně), jinak heuristika pro cizí kód */
    const runCase = (u, at, v, our) => {
        const branches = caseBranches(u.code, at);
        const steps = [];
        const consts = new Map();
        for (const m of u.code.matchAll(/\b([A-Za-z_]\w*)\s*:\s*\w+\s*:=\s*(\d+)\s*;/g))
            consts.set(up(m[1]), +m[2]);
        const labelNum = (l, k) => /^\d+$/.test(l) ? +l : consts.get(up(l)) ?? (k + 1) * 10; // výčet (E_STATES.INIT) = pořadí
        branches.forEach((b, k) => {
            const n = labelNum(b.label, k);
            const body = b.body;
            const li = lineNo(u, b.at);
            const src = srcOf(u, li);
            const vre = v.replace(/\./g, "\\.");
            const trIf = body.match(new RegExp("\\bIF\\s+([\\s\\S]*?)\\s+THEN\\s+" + vre + "\\s*:=\\s*([\\w.]+)\\s*;"));
            const trBare = body.match(new RegExp("^\\s*" + vre + "\\s*:=\\s*([\\w.]+)\\s*;", "m"));
            const cond = trIf ? trIf[1].replace(/\s+/g, " ").replace(/^\((.*)\)$/, "$1").trim() : trBare ? "TRUE" : "";
            if (our) {
                if (n === 0)
                    return;
                const act = body.match(/\b(seqRun|seqOpen)_([A-Za-z]\w*)\s*:=\s*(TRUE|FALSE|1|0)\s*;/);
                const dev = act ? devOfName(act[2]) : undefined;
                const on = act ? /^(TRUE|1)$/.test(act[3]) : false;
                const tm = cond.match(/^(\w+)\.Q$/);
                const fb = cond.match(/^(NOT\s+)?([A-Za-z_]\w*)$/);
                const secs = (tm ? timers.get(up(tm[1])) : undefined) ?? stepTimer.get(up(v) + ":" + n);
                let step, note;
                if (dev && act) {
                    const a = dev.cls === "Motor" ? (on ? "start" : "stop") : (on ? "open" : "close");
                    if (tm)
                        step = { dev: dev.id, act: a, cond: "time", timeS: secs ?? 1 };
                    else if (fb && !/^TRUE|1$/.test(fb[2]))
                        step = { dev: dev.id, act: a, cond: "fbk", timeS: secs ?? 1 };
                    else {
                        step = { dev: dev.id, act: a, cond: "fbk", timeS: 5 };
                        note = tr("Krok bez zpětného hlášení — hlídací čas v programu není, nastaven 5 s.");
                    }
                }
                else if (tm)
                    step = { dev: 0, act: "wait", cond: "time", timeS: secs ?? 1 };
                else if (fb && !/^(TRUE|1)$/i.test(fb[2])) {
                    const s = sigOf(fb[2]), od = ownerDev(s);
                    step = { dev: od ? od.id : 0, act: fb[1] ? "waitOff" : "waitOn", cond: "fbk", timeS: secs ?? 1 };
                    if (!od)
                        note = tr("Vstup {tag} kroku nepatří žádnému zařízení.", { tag: fb[2] });
                }
                else {
                    step = { dev: 0, act: "wait", cond: "time", timeS: secs ?? 1 };
                    note = tr("Podmínka kroku nerozpoznána.");
                }
                steps.push({ step, conf: note ? "guess" : "sure", src, note });
                return;
            }
            /* cizí kód: akce = zápis TRUE/FALSE do výstupu pohonu, člen / metoda instance (Start, M_Set_OPN…),
               přechod = IF … THEN krok := … */
            const acts = [];
            const instDev = (iname) => {
                const x = insts.find(i => up(i.name) === up(iname));
                const od = devOfName(x ? devNameOfInst(x.name) : iname) || devOfName(devNameOfInst(iname));
                return od && (od.cls === "Motor" || od.cls === "Ventil") ? od : undefined;
            };
            const byWords = (od, par, val) => {
                const ws = words(par).map(w => w.w);
                if (ws.some(w => W_CLOSE.has(w) || w === "stop" || w === "off"))
                    acts.push({ dev: od, on: !val });
                else if (ws.some(w => W_RUN.has(w) || W_OPEN.has(w) || W_CMD.has(w) || w === "on"))
                    acts.push({ dev: od, on: val });
            };
            for (const m of body.matchAll(/\b([A-Za-z_][\w.]*)\s*(?::=\s*(TRUE|FALSE|1|0)\s*;|\(\s*(TRUE|FALSE|1|0)\s*\))/g)) {
                if (up(m[1]) === up(v))
                    continue;
                const val = /^(TRUE|1)$/.test(m[2] || m[3]);
                const s = sigOf(m[1]);
                if (s && s.dir === "DO") {
                    const od = ownerDev(s);
                    if (od && (od.cls === "Motor" || od.cls === "Ventil")) {
                        acts.push({ dev: od, on: val });
                        continue;
                    }
                }
                if (m[1].includes(".")) {
                    const parts = m[1].split(".");
                    const od = instDev(parts[0]);
                    if (od)
                        byWords(od, parts.slice(1).join("_"), val);
                }
            }
            const first = k === 0;
            if (!acts.length && (!cond || /start|auto|cmd/i.test(cond)) && first)
                return; // klid: čekání na start
            const tm = cond.match(/^([A-Za-z_]\w*)\.(Q|DN)$/);
            const fb = cond.match(/^(NOT\s+)?([A-Za-z_]\w*)$/);
            const secs = tm ? timers.get(up(tm[1])) : undefined;
            const note = tr("Krok odhadnut z cizího kódu — ověř akci a podmínku.");
            /* přechod na vstup jiného zařízení (snímač) = akce a za ní samostatný krok čekání */
            const waitDev = fb ? ownerDev(sigOf(fb[2])) : undefined;
            const extraWait = !!acts.length && !!waitDev && waitDev.cls === "DI";
            acts.forEach((a, i) => {
                const actName = a.dev.cls === "Motor" ? (a.on ? "start" : "stop") : (a.on ? "open" : "close");
                const last = i === acts.length - 1;
                const st = { dev: a.dev.id, act: actName, cond: last && tm ? "time" : "fbk", timeS: last && secs !== undefined ? secs : 5 };
                steps.push({ step: st, conf: "guess", src, note });
            });
            if (extraWait)
                steps.push({ step: { dev: waitDev.id, act: fb[1] ? "waitOff" : "waitOn", cond: "fbk", timeS: 10 }, conf: "guess", src, note });
            if (!acts.length) {
                if (tm)
                    steps.push({ step: { dev: 0, act: "wait", cond: "time", timeS: secs ?? 1 }, conf: "guess", src, note });
                else if (fb) {
                    const od = ownerDev(sigOf(fb[2]));
                    if (od && od.cls === "DI")
                        steps.push({ step: { dev: od.id, act: fb[1] ? "waitOff" : "waitOn", cond: "fbk", timeS: 10 }, conf: "guess", src, note });
                }
            }
        });
        return steps;
    };
    let steps = [];
    for (const { u, cases } of seqUnits)
        for (const c of cases)
            if (!steps.length && /^seqStep$/i.test(c[1]))
                steps = runCase(u, c.index, c[1], true);
    if (!steps.length) {
        /* cizí kód: ze všech stavových automatů ten s nejvíc kroky s akcí pohonu (ne komunikace / pomocné) */
        let best = 0;
        for (const { u, cases } of seqUnits)
            for (const c of cases) {
                if (/stat(e)?Step$/i.test(c[1]) && /^inst/i.test(c[1]))
                    continue;
                if (!/step|schritt|krok|state|seq|paso|zustand|stav|etapa|phase|faze|mode|status/i.test(c[1]))
                    continue;
                const st = runCase(u, c.index, c[1], false);
                const score = st.filter(x => x.step.act !== "wait" && x.step.act !== "waitOn" && x.step.act !== "waitOff").length * 2 + st.length;
                if (score > best && st.some(x => x.step.dev)) {
                    best = score;
                    steps = st;
                }
            }
    }
    const seqFound = steps.length > 0;
    if (seqFound) {
        prj.program.seq = steps.map(s => s.step);
        steps.forEach((s, i) => ev("seq:" + i, s.conf, [s.src], s.note));
    }
    /* ---- 9) meta: název, takt, platforma */
    const metaName = ex.meta?.name;
    if (metaName && !prj.meta.name)
        prj.meta.name = metaName;
    let taktSrc;
    for (const u of allUnits) {
        const m = u.code.match(/\b(takt\w*|cycle_?time\w*|cykl\w*|zyklus\w*|tcycle\w*)\s*(?::\s*\w+\s*)?:=\s*(T#[\w.]+|TIME#[\w.]+)/i);
        if (m) {
            const s = parseTimeLit(m[2]);
            if (s) {
                prj.meta.takt = s;
                taktSrc = srcOf(u, lineNo(u, m.index));
                break;
            }
        }
    }
    if (ex.platform && (!base || !base.platforms.length || !devs.length || true))
        prj.platforms = [ex.platform];
    ev("meta", metaName || taktSrc ? "sure" : "missing", taktSrc ? [taktSrc] : []);
    /* ---- 10) kontrola: duplicitní adresy, neplatné tagy */
    const seenAddr = new Map();
    for (const e of prj.io) {
        if (!e.addr)
            continue;
        const o = seenAddr.get(e.addr);
        if (o) {
            /* dva tagy na tentýž bod (alias navíc, rezerva…): adresu nechá první, druhý dostane volnou */
            conflicts.push({ what: "io:" + e.tag, note: tr("Adresa {addr} je u signálů {a} i {b}.", { addr: e.addr, a: o.tag, b: e.tag }), src: [...(evidence["io:" + o.tag]?.src || []), ...(evidence["io:" + e.tag]?.src || [])].slice(0, 4) });
            e.addr = "";
            const evd = evidence["io:" + e.tag];
            if (evd)
                evidence["io:" + e.tag] = { ...evd, conf: "guess", note: tr("Adresa obsazená jiným signálem — přidělena volná, ověř.") };
        }
        else
            seenAddr.set(e.addr, e);
    }
    if (prj.io.some(e => !e.addr))
        autoAddr(prj, false);
    for (const e of prj.io) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.tag) && !/__/.test(e.tag) && e.tag.length <= 40)
            continue;
        const old = e.tag;
        let t = sanitizeTag(old), i = 2;
        while (prj.io.some(x => x !== e && up(x.tag) === up(t)))
            t = sanitizeTag(old) + "_" + i++;
        e.tag = t;
        const evd = evidence["io:" + old];
        if (evd) {
            delete evidence["io:" + old];
            evidence["io:" + t] = { ...evd, note: tr("Tag {old} přejmenován na platný identifikátor {tag}.", { old, tag: t }) };
        }
    }
    const noAddr = prj._noAddr || [];
    delete prj._noAddr;
    const missing = computeMissing(prj, evidence, { noAddr, enableFound, seqFound, hasCode: pous.length > 0, unparsed: ex.unparsed.map(f => f.name), skipped: ex.skipped });
    return { prj, evidence, conflicts, missing };
}
/** Rozdělí tělo CASE na větve (návěští, tělo, pozice). */
function caseBranches(code, at) {
    const start = code.indexOf("OF", at) + 2;
    let depth = 1, end = code.length;
    const re = /\b(END_CASE|CASE)\b/g;
    re.lastIndex = start;
    let m;
    while ((m = re.exec(code))) {
        if (m[1] === "CASE")
            depth++;
        else if (--depth === 0) {
            end = m.index;
            break;
        }
    }
    const text = code.slice(start, end);
    const out = [];
    /* návěští jen na úrovni tohoto CASE (vnořené CASE přeskočit) */
    const labRe = /^[ \t]*([A-Za-z_][\w.]*|\d+(?:\s*(?:,|\.\.)\s*\d+)*)\s*:(?!=)/gm;
    let nest = 0, lastPos = 0;
    const marks = [];
    for (const lm of text.matchAll(labRe)) {
        const before = text.slice(lastPos, lm.index);
        nest += (before.match(/\bCASE\b/g) || []).length - (before.match(/\bEND_CASE\b/g) || []).length;
        lastPos = lm.index;
        if (nest > 0)
            continue;
        if (/^(ELSE|ELSIF|THEN|IF|END_IF|OF|DO)$/i.test(lm[1]))
            continue;
        marks.push({ label: (/^\d/.test(lm[1]) ? lm[1].split(/[,.]/)[0] : lm[1]).trim(), pos: lm.index, end: lm.index + lm[0].length });
    }
    const elseM = text.match(/^[ \t]*ELSE\b/m);
    marks.forEach((mk, k) => {
        let e = k + 1 < marks.length ? marks[k + 1].pos : text.length;
        if (elseM && elseM.index > mk.pos && elseM.index < e)
            e = elseM.index;
        out.push({ label: mk.label, body: text.slice(mk.end, e), at: start + mk.pos });
    });
    return out;
}
/** Co v podkladech chybí — přeložené texty (z hotového projektu a evidence). */
function computeMissing(prj, evidence, o) {
    const out = [];
    if (!prj.devices.length)
        out.push(tr("V podkladech nejsou žádné signály ani zařízení."));
    const noAddr = o.noAddr ?? prj.io.filter(e => !e.addr).map(e => e.tag);
    if (noAddr.length)
        out.push(tr("Adresy I/O chybí u {n} signálů ({list}) — doplněny automaticky, ověř je podle HW.", { n: noAddr.length, list: noAddr.slice(0, 8).join(", ") + (noAddr.length > 8 ? ", …" : "") }));
    /* po zařízeních; u víc položek jedním řádkem se seznamem (velké projekty) */
    const list = (a) => a.slice(0, 8).join(", ") + (a.length > 8 ? ", …" : "");
    const noFbk = [], noLs = [], noRange = [];
    for (const d of prj.devices) {
        const e = evidence["dev:" + d.name];
        if (e && e.conf === "sure")
            continue;
        if (d.cls === "Motor" && !d.opt.fbk)
            noFbk.push(d.name);
        if (d.cls === "Ventil" && !d.opt.fbkOpen && !d.opt.fbkClosed)
            noLs.push(d.name);
        if (d.cls === "AnalogIn" && d.rmin === 0 && d.rmax === 100 && !d.unit)
            noRange.push(d.name);
    }
    if (noFbk.length === 1)
        out.push(tr("{dev}: zpětné hlášení běhu v podkladech není.", { dev: noFbk[0] }));
    else if (noFbk.length)
        out.push(tr("Zpětné hlášení běhu v podkladech není u {n} pohonů: {list}.", { n: noFbk.length, list: list(noFbk) }));
    if (noLs.length === 1)
        out.push(tr("{dev}: koncové snímače polohy v podkladech nejsou.", { dev: noLs[0] }));
    else if (noLs.length)
        out.push(tr("Koncové snímače polohy v podkladech nejsou u {n} ventilů: {list}.", { n: noLs.length, list: list(noLs) }));
    if (noRange.length === 1)
        out.push(tr("{dev}: měřicí rozsah a jednotka v podkladech nejsou.", { dev: noRange[0] }));
    else if (noRange.length)
        out.push(tr("Měřicí rozsah a jednotka v podkladech nejsou u {n} analogů: {list}.", { n: noRange.length, list: list(noRange) }));
    const miss = Object.entries(evidence).filter(([k, e]) => k.startsWith("io:") && e.conf === "missing").map(([k]) => k.slice(3));
    if (miss.length === 1)
        out.push(tr("{tag}: signál v podkladech chybí, doplněn podle třídy zařízení.", { tag: miss[0] }));
    else if (miss.length)
        out.push(tr("Signály doplněné podle třídy zařízení (v podkladech nejsou): {n} — {list}.", { n: miss.length, list: list(miss) }));
    if (o.skipped && o.skipped.length)
        out.push(tr("Tagy bez vazby na I/O (vnitřní, diagnostické, systémové) nejsou převzaty jako zařízení: {n} — {list}.", { n: o.skipped.length, list: list(o.skipped) }));
    if (prj.devices.length && prj.program.estop === "")
        out.push(tr("E-stop v podkladech není — doplň vstup nouzového zastavení (v programu je jen informativní signál)."));
    if (prj.devices.length && !prj.program.seq.length)
        out.push(o.hasCode === false
            ? tr("Program v podkladech není — sekvenci (funkci stroje) doplň podle popisu.")
            : tr("Sekvence v programu nenalezena — funkci stroje doplň podle popisu."));
    if (!prj.meta.takt)
        out.push(tr("Takt (požadovaná doba cyklu) v podkladech není."));
    if (o.unparsed && o.unparsed.length)
        out.push(tr("Soubory pro AI vrstvu (PDF, obrázky, neznámý text): {list}", { list: o.unparsed.join(", ") }));
    return out;
}
/* =============================================================== mergeProposals */
/**
 * Sloučí přesný návrh `a` (jádro) s návrhem `b` (AI): přesné údaje mají přednost, AI doplní
 * chybějící zařízení, signály, adresy, popisy, E-stop, sekvenci a meta; rozpory jdou do
 * `conflicts`. Zařízení se párují podle označení.
 */
export function mergeProposals(a, b) {
    const prj = clone(a.prj);
    const evidence = clone(a.evidence);
    const conflicts = [...a.conflicts, ...b.conflicts];
    const confOf = (p, k) => p.evidence[k]?.conf;
    const srcs = (k) => [...(a.evidence[k]?.src || []), ...(b.evidence[k]?.src || [])].slice(0, 4);
    const byName = (p, n) => p.devices.find(d => up(d.name) === up(n));
    const idMap = new Map(); // id v b → id ve výsledku
    /* adresa od AI platí jen s doložením (evidence io:<tag> se zdrojem) — jinak ji AI vrstva jen doplnila autoAddr */
    const bAddr = (e) => { const v = b.evidence["io:" + e.tag]; return v && (v.conf === "sure" || v.conf === "guess") && v.src && v.src.length ? e.addr : ""; };
    for (const bd of b.prj.devices) {
        const ad = byName(prj, bd.name);
        if (!ad) {
            const nd = { ...clone(bd), id: prj.nextId++ };
            prj.devices.push(nd);
            idMap.set(bd.id, nd.id);
            evidence["dev:" + nd.name] = b.evidence["dev:" + bd.name] || { conf: "guess", src: [] };
            for (const e of b.prj.io.filter(x => x.devId === bd.id)) {
                if (prj.io.some(x => up(x.tag) === up(e.tag)))
                    continue;
                prj.io.push({ ...e, key: nd.id + ":" + e.sig, devId: nd.id, addr: bAddr(e) });
                evidence["io:" + e.tag] = b.evidence["io:" + e.tag] || { conf: "guess", src: [] };
            }
            continue;
        }
        idMap.set(bd.id, ad.id);
        const k = "dev:" + ad.name;
        const aSure = confOf(a, k) === "sure";
        if (ad.cls !== bd.cls) {
            conflicts.push({ what: k, note: tr("{dev}: třída {a} (podklady) × {b} (AI).", { dev: ad.name, a: ad.cls, b: bd.cls }), src: srcs(k) });
            if (!aSure && confOf(b, k) === "sure") {
                ad.cls = bd.cls;
                ad.opt = clone(bd.opt);
                evidence[k] = b.evidence[k];
            }
        }
        else if (!aSure) {
            for (const [o, v] of Object.entries(bd.opt || {}))
                if (v && !ad.opt[o])
                    ad.opt[o] = true;
        }
        if (!ad.desc && bd.desc)
            ad.desc = bd.desc;
        if (!ad.unit && bd.unit)
            ad.unit = bd.unit;
        if (ad.cls === "AnalogIn" || ad.cls === "AnalogOut") {
            if (ad.rmin === 0 && ad.rmax === 100 && (bd.rmin !== 0 || bd.rmax !== 100)) {
                ad.rmin = bd.rmin;
                ad.rmax = bd.rmax;
            }
            for (const f of ["limHi", "limLo", "setpoint"]) {
                if (ad[f] === undefined && bd[f] !== undefined)
                    ad[f] = bd[f];
                else if (ad[f] !== undefined && bd[f] !== undefined && ad[f] !== bd[f])
                    conflicts.push({ what: k, note: tr("{dev}: {field} {a} (podklady) × {b} (AI).", { dev: ad.name, field: f, a: ad[f], b: bd[f] }), src: srcs(k) });
            }
        }
        if (ad.cls === "DO" && !ad.role && bd.role)
            ad.role = bd.role;
    }
    /* I/O: chybějící signály a adresy doplnit, rozpory adres hlásit */
    const keep = new Map(prj.io.map(e => [e.key, e]));
    const fresh = [];
    for (const d of prj.devices) {
        const bd = b.prj.devices.find(x => idMap.get(x.id) === d.id);
        for (const [sig, dir, lbl] of devSignals(d)) {
            const key = d.id + ":" + sig;
            let e = keep.get(key);
            const be = bd ? b.prj.io.find(x => x.devId === bd.id && x.sig === sig) : undefined;
            if (!e)
                e = be ? { ...be, key, devId: d.id, addr: bAddr(be) } : { key, devId: d.id, sig, dir, tag: d.name + "_" + sig, addr: "", cmt: [d.desc, lbl].filter(Boolean).join(" – "), nc: false };
            else if (be) {
                const ka = "io:" + e.tag;
                const aSure = confOf(a, ka) === "sure";
                const ba = bAddr(be);
                if (ba && !e.addr)
                    e.addr = ba;
                else if (ba && e.addr && ba !== e.addr) {
                    if (aSure)
                        conflicts.push({ what: ka, note: tr("Signál {tag}: adresa {a} (podklady) × {b} (AI).", { tag: e.tag, a: e.addr, b: ba }), src: srcs(ka) });
                    else {
                        e.addr = ba;
                        evidence[ka] = b.evidence["io:" + be.tag] || evidence[ka];
                    }
                }
                if (!e.cmt && be.cmt)
                    e.cmt = be.cmt;
            }
            fresh.push(e);
        }
    }
    prj.io = fresh;
    const usedTags = new Set();
    for (const e of prj.io) { // duplicitní tagy po sloučení
        let t = e.tag, i = 2;
        while (usedTags.has(up(t)))
            t = e.tag + "_" + i++;
        e.tag = t;
        usedTags.add(up(t));
    }
    /* adresa z AI obsazená přesným signálem → uvolnit (doplní se) a nahlásit */
    const aKeys = new Set(a.prj.io.map(e => e.tag.toUpperCase()));
    const taken = new Map();
    for (const e of prj.io)
        if (e.addr && aKeys.has(up(e.tag)))
            taken.set(e.addr, e.tag);
    for (const e of prj.io) {
        if (!e.addr || aKeys.has(up(e.tag)))
            continue;
        const o = taken.get(e.addr);
        if (o) {
            conflicts.push({ what: "io:" + e.tag, note: tr("Adresa {addr} z AI u {tag} je v podkladech obsazená signálem {other} — přidělena jiná.", { addr: e.addr, tag: e.tag, other: o }), src: srcs("io:" + e.tag) });
            e.addr = "";
        }
        else
            taken.set(e.addr, e.tag);
    }
    autoAddr(prj, false);
    /* E-stop, blokování */
    const mapId = (id) => idMap.get(id);
    if (prj.program.estop === "" && b.prj.program.estop !== "") {
        const id = mapId(b.prj.program.estop);
        if (id) {
            prj.program.estop = id;
            evidence.estop = b.evidence.estop || { conf: "guess", src: [] };
        }
    }
    else if (prj.program.estop !== "" && b.prj.program.estop !== "" && mapId(b.prj.program.estop) !== prj.program.estop)
        conflicts.push({ what: "estop", note: tr("E-stop: podklady a AI určily různé vstupy."), src: srcs("estop") });
    const locks = new Set(prj.program.interlocks || []);
    for (const id of b.prj.program.interlocks || []) {
        const m = mapId(id);
        if (m && m !== prj.program.estop && !locks.has(m)) {
            locks.add(m);
            const d = prj.devices.find(x => x.id === m);
            const bd = b.prj.devices.find(x => x.id === id);
            evidence["lock:" + d.name] = b.evidence["lock:" + bd.name] || { conf: "guess", src: [] };
        }
    }
    prj.program.interlocks = [...locks];
    /* sekvence: přesná má přednost; jinak AI */
    const aSeqSure = a.prj.program.seq.length && a.prj.program.seq.some((_s, i) => a.evidence["seq:" + i]?.conf === "sure");
    if (!prj.program.seq.length || (!aSeqSure && b.prj.program.seq.length)) {
        if (prj.program.seq.length && b.prj.program.seq.length)
            conflicts.push({ what: "seq", note: tr("Sekvence odhadnutá z kódu nahrazena sekvencí z AI — porovnej."), src: [] });
        prj.program.seq = b.prj.program.seq.map(s => ({ ...s, dev: s.dev ? (mapId(s.dev) ?? 0) : 0 }));
        for (const k of Object.keys(evidence))
            if (k.startsWith("seq:"))
                delete evidence[k];
        b.prj.program.seq.forEach((_s, i) => { evidence["seq:" + i] = b.evidence["seq:" + i] || { conf: "guess", src: [] }; });
    }
    else if (b.prj.program.seq.length && b.prj.program.seq.length !== prj.program.seq.length)
        conflicts.push({ what: "seq", note: tr("Sekvence: program má {a} kroků, AI navrhla {b}.", { a: prj.program.seq.length, b: b.prj.program.seq.length }), src: [] });
    /* meta */
    if (!prj.meta.name && b.prj.meta.name)
        prj.meta.name = b.prj.meta.name;
    if (!prj.meta.desc && b.prj.meta.desc)
        prj.meta.desc = b.prj.meta.desc;
    if (!prj.meta.takt && b.prj.meta.takt) {
        prj.meta.takt = b.prj.meta.takt;
        evidence.meta = b.evidence.meta || { conf: "guess", src: [] };
    }
    else if (prj.meta.takt && b.prj.meta.takt && prj.meta.takt !== b.prj.meta.takt)
        conflicts.push({ what: "meta", note: tr("Takt: {a} s (podklady) × {b} s (AI).", { a: prj.meta.takt, b: b.prj.meta.takt }), src: srcs("meta") });
    if ((!prj.platforms || !prj.platforms.length) && b.prj.platforms?.length)
        prj.platforms = [...b.prj.platforms];
    for (const [k, e] of Object.entries(b.evidence))
        if (!(k in evidence))
            evidence[k] = e;
    const missing = computeMissing(prj, evidence, {});
    for (const m of b.missing || [])
        if (!missing.includes(m))
            missing.push(m);
    return { prj, evidence, conflicts, missing };
}
