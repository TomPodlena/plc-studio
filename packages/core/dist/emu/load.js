import { DIALECTS, SRC } from "./dialects.js";
import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import { xmlProblems } from "../logix.js";
import { isCodesysFamily } from "../model.js";
import { checkOopFiles } from "./oop_files.js";
import { tr } from "../i18n.js";
const P = (file, line = 0, col = 0) => ({ file, line, col });
/** Rozdělí řádek CSV (uvozovky, zdvojené uvozovky uvnitř). */
export function csvRow(line, sep = ",") {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                cur += c;
        }
        else if (c === '"')
            q = true;
        else if (c === sep) {
            out.push(cur);
            cur = "";
        }
        else
            cur += c;
    }
    out.push(cur);
    return out;
}
function parseCode(text, file, d, findings, statementsOnly = false) {
    const lx = lex(text, file, { nestedComments: d.nestedComments, scl: d.scl });
    const pr = parse(lx.toks, file, { scl: d.scl, statementsOnly: statementsOnly || d.statementsOnly });
    for (const e of [...lx.errors, ...pr.errors])
        findings.push({ ...e, source: d.src.syntax, platform: d.plat });
    if (d.endSemi !== "ok" && d.endSemi !== "info") {
        for (const s of pr.semi)
            findings.push({
                level: d.endSemi, rule: "end-semicolon", file, line: s.pos.line, col: s.pos.col, platform: d.plat, source: d.src.semi,
                msg: tr("Za {what} chybí středník — {plat} vyžaduje {what};", { what: s.what, plat: d.label }),
            });
    }
    return pr.unit;
}
/** Kontrola ASCII celého souboru: první výskyt (řádek:sloupec) a počet. */
function asciiCheck(name, text, d, level, out) {
    let line = 1, col = 1, first = null, n = 0, ch = "";
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 10) {
            line++;
            col = 1;
            continue;
        }
        if (c > 127 && !(i === 0 && c === 0xfeff)) {
            n++;
            if (!first) {
                first = P(name, line, col);
                ch = text[i];
            }
        }
        col++;
    }
    if (first)
        out.push({ level, rule: "ascii", file: name, line: first.line, col: first.col, platform: d.plat, source: d.src.ascii || d.src.syntax, msg: tr("Soubor obsahuje znaky mimo ASCII ({n}×, první {ch}) — platforma je jednobajtová", { n, ch: JSON.stringify(ch) }) });
}
/** Směr signálu podle návrhu (tag → DI/DO/AI/AO). */
const dirOf = (prj) => new Map(prj.io.map(e => [e.tag.toUpperCase(), e.dir]));
/* ------------------------------------------------------------------ Siemens */
function loadSiemens(prj, files, d, out) {
    const tags = [];
    const tsv = files["Gen_Tags.tsv"];
    if (tsv === undefined) {
        out.push({ level: "error", rule: "tag-table", file: "Gen_Tags.tsv", line: 0, col: 0, platform: d.plat, msg: tr("Chybí soubor {file}", { file: "Gen_Tags.tsv" }) });
        return;
    }
    const rows = tsv.replace(/^﻿/, "").split(/\r?\n/);
    if (!/^Name\tData Type\tLogical Address\tComment/.test(rows[0] || ""))
        out.push({ level: "error", rule: "tag-table", file: "Gen_Tags.tsv", line: 1, col: 1, platform: d.plat, source: SRC.sieGuide, msg: tr("Hlavička tabulky tagů neodpovídá formátu TIA (Name, Data Type, Logical Address, Comment)") });
    const addrs = new Map();
    const dirs = dirOf(prj);
    rows.slice(1).forEach((r, i) => {
        if (!r.trim())
            return;
        const [name, type, addr] = r.split("\t");
        const pos = P("Gen_Tags.tsv", i + 2, 1);
        tags.push({ name, type, pos, at: addr });
        const bit = /^%([IQM])(\d+)\.([0-7])$/.exec(addr || ""), word = /^%([IQM])W(\d+)$/.exec(addr || "");
        if (/^bool$/i.test(type) && !bit)
            out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: d.plat, source: SRC.sieGuide, msg: tr("Tag {name}: adresa {addr} neodpovídá typu Bool (%I/%Q bajt.bit 0–7)", { name, addr }) });
        if (/^int$/i.test(type) && !word)
            out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: d.plat, source: SRC.sieGuide, msg: tr("Tag {name}: adresa {addr} neodpovídá typu Int (%IW/%QW)", { name, addr }) });
        const dir = dirs.get(name.toUpperCase());
        const area = (bit || word || [])[1];
        if (dir && area && ((dir === "DI" || dir === "AI") !== (area === "I")))
            out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: d.plat, source: SRC.sieGuide, msg: tr("Tag {name}: {dir} na adrese {addr} (vstup patří do %I, výstup do %Q)", { name, dir, addr }) });
        if (addr) {
            if (addrs.has(addr))
                out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: d.plat, source: SRC.sieGuide, msg: tr("Adresa {addr} je použita dvakrát (také řádek {line})", { addr, line: addrs.get(addr) }) });
            else
                addrs.set(addr, pos.line);
        }
    });
    /* překryv slova s bity (%IW64 = %I64.0 … %I65.7) */
    for (const [a, line] of addrs) {
        const w = /^%([IQ])W(\d+)$/.exec(a);
        if (!w)
            continue;
        for (const [b] of addrs) {
            const m = /^%([IQ])(\d+)\.\d$/.exec(b);
            if (m && m[1] === w[1] && (+m[2] === +w[2] || +m[2] === +w[2] + 1))
                out.push({ level: "warn", rule: "address", file: "Gen_Tags.tsv", line, col: 1, platform: d.plat, source: SRC.sieGuide, msg: tr("Slovo {w} se překrývá s bitem {b}", { w: a, b }) });
        }
    }
    /* SimaticML × TSV */
    const xml = files["Gen_IO.xml"];
    if (xml !== undefined) {
        for (const e of xmlProblems(xml))
            out.push({ level: "error", rule: "xml", file: "Gen_IO.xml", line: 0, col: 0, platform: d.plat, msg: e });
        const xt = [...xml.matchAll(/<DataTypeName>([^<]*)<\/DataTypeName>\s*<LogicalAddress>([^<]*)<\/LogicalAddress>\s*<Name>([^<]*)<\/Name>/g)];
        const byName = new Map(tags.map(t => [t.name, t]));
        if (xt.length !== tags.length)
            out.push({ level: "error", rule: "tag-table", file: "Gen_IO.xml", line: 0, col: 0, platform: d.plat, msg: tr("Gen_IO.xml má {a} tagů, Gen_Tags.tsv {b}", { a: xt.length, b: tags.length }) });
        for (const m of xt) {
            const t = byName.get(m[3].replace(/&amp;/g, "&"));
            if (!t || t.type.toLowerCase() !== m[1].toLowerCase() || t.at !== m[2])
                out.push({ level: "error", rule: "tag-table", file: "Gen_IO.xml", line: 0, col: 0, platform: d.plat, msg: tr("Tag {name} v Gen_IO.xml neodpovídá Gen_Tags.tsv (typ / adresa)", { name: m[3] }) });
        }
    }
    const units = [];
    if (files["Gen_Library.scl"] !== undefined)
        units.push(parseCode(files["Gen_Library.scl"], "Gen_Library.scl", d, out));
    const main = files["Gen_Main.scl"];
    if (main === undefined) {
        out.push({ level: "error", rule: "syntax", file: "Gen_Main.scl", line: 0, col: 0, platform: d.plat, msg: tr("Chybí soubor {file}", { file: "Gen_Main.scl" }) });
        return;
    }
    units.push(parseCode(main, "Gen_Main.scl", d, out));
    /* volání v OB1 je v komentáři na konci souboru — přeloží se jako samostatný OB1 */
    const ob1 = /("[^"\n]+"\s*\(\s*enableIn\s*:=[^;\n]*\)\s*;)/.exec(main);
    let stmts;
    if (ob1) {
        const before = main.slice(0, ob1.index), line = before.split("\n").length, col = ob1.index - before.lastIndexOf("\n");
        const u = parseCode("\n".repeat(line - 1) + " ".repeat(col - 1) + ob1[1], "Gen_Main.scl", d, out, true);
        stmts = u.stmts || [];
    }
    else {
        out.push({ level: "warn", rule: "syntax", file: "Gen_Main.scl", line: 0, col: 0, platform: d.plat, msg: tr("Nenalezeno volání instance v OB1 (komentář na konci Gen_Main.scl) — emulace volá FB_Machine s enableIn = TRUE") });
        const db = /DATA_BLOCK\s+"([^"]+)"/.exec(main);
        stmts = parseCode('"' + (db ? db[1] : "InstMachine") + '"(enableIn := TRUE);', "OB1", d, out, true).stmts || [];
    }
    return { d, units, tags, entry: { stmts, file: "Gen_Main.scl" } };
}
/* ------------------------------------------------------------- IEC rodina */
function loadIec(prj, files, d, out) {
    const units = [];
    const tags = [];
    const dirs = dirOf(prj);
    const plat = d.plat;
    if (isCodesysFamily(plat)) {
        const gvl = files["GVL_IO.st"];
        if (gvl === undefined) {
            out.push({ level: "error", rule: "tag-table", file: "GVL_IO.st", line: 0, col: 0, platform: plat, msg: tr("Chybí soubor {file}", { file: "GVL_IO.st" }) });
            return;
        }
        const u = parseCode(gvl, "GVL_IO.st", d, out);
        units.push(u);
        const seen = new Map();
        for (const b of u.globals)
            for (const v of b.decls) {
                const at = (v.at || "").replace(/\s+/g, ""), pos = v.atPos || v.pos;
                if (!at)
                    continue;
                const dir = dirs.get(v.name.toUpperCase());
                const tn = v.type.k === "name" ? v.type.name.toUpperCase() : "";
                const isIn = dir === "DI" || dir === "AI";
                if (plat === "beckhoff") {
                    if (/^%[IQ]\*$/.test(at)) {
                        if (dir && (at === "%I*") !== isIn)
                            out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.tcAt, msg: tr("{name}: {dir} s AT {at} (vstup %I*, výstup %Q*)", { name: v.name, dir, at }) });
                    }
                    else
                        out.push({ level: "warn", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.tcAlloc, msg: tr("{name}: pevná adresa {at} — TwinCAT doporučuje AT %I* / %Q* a nalinkování", { name: v.name, at }) });
                    continue;
                }
                const bit = /^%([IQM])X(\d+)\.([0-7])$/.exec(at), word = /^%([IQM])W(\d+)$/.exec(at);
                if (!bit && !word) {
                    out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.cdsAddr, msg: tr("{name}: neplatná adresa {at} (CODESYS: %IX bajt.bit, %IW index slova)", { name: v.name, at }) });
                    continue;
                }
                if (bit && tn !== "BOOL")
                    out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.cdsAddr, msg: tr("{name}: bitová adresa {at} u typu {type}", { name: v.name, at, type: tn }) });
                if (word && !["INT", "UINT", "WORD"].includes(tn))
                    out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.cdsAddr, msg: tr("{name}: slovní adresa {at} u typu {type}", { name: v.name, at, type: tn }) });
                const area = (bit || word)[1];
                if (dir && (area === "I") !== isIn)
                    out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.cdsAddr, msg: tr("{name}: {dir} na adrese {at} (vstup %I, výstup %Q)", { name: v.name, dir, at }) });
                if (seen.has(at))
                    out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: pos.col, platform: plat, source: SRC.cdsAddr, msg: tr("Adresa {addr} je použita dvakrát (také řádek {line})", { addr: at, line: seen.get(at) }) });
                else
                    seen.set(at, pos.line);
            }
        /* %IWn = slovo n = bajty 2n, 2n+1 — překryv s %IXb.x */
        for (const [a, line] of seen) {
            const w = /^%([IQ])W(\d+)$/.exec(a);
            if (!w)
                continue;
            for (const [b] of seen) {
                const m = /^%([IQ])X(\d+)\.\d$/.exec(b);
                if (m && m[1] === w[1] && (+m[2] === 2 * +w[2] || +m[2] === 2 * +w[2] + 1))
                    out.push({ level: "warn", rule: "address", file: "GVL_IO.st", line, col: 1, platform: plat, source: SRC.cdsAddr, msg: tr("Slovo {w} se překrývá s bitem {b}", { w: a, b }) });
            }
        }
        const x = files["PLCopen_Import.xml"];
        if (x !== undefined)
            for (const e of xmlProblems(x))
                out.push({ level: "error", rule: "xml", file: "PLCopen_Import.xml", line: 0, col: 0, platform: plat, msg: e });
        /* styl OOP: soubory pro import (TcPOU / TcIO / TcGVL, PLCopen s rozšířením CODESYS) = ST výpis */
        for (const [n, t] of Object.entries(files))
            if (/\.Tc(POU|IO|GVL|DUT)$/i.test(n))
                for (const e of xmlProblems(t))
                    out.push({ level: "error", rule: "xml", file: n, line: 0, col: 0, platform: plat, msg: e });
        checkOopFiles(files, plat, out);
    }
    else if (plat === "mitsubishi") {
        const csv = files["GlobalLabels.csv"];
        if (csv === undefined) {
            out.push({ level: "error", rule: "tag-table", file: "GlobalLabels.csv", line: 0, col: 0, platform: plat, msg: tr("Chybí soubor {file}", { file: "GlobalLabels.csv" }) });
            return;
        }
        const rows = csv.split(/\r?\n/);
        const head = csvRow(rows[0] || "");
        const ix = (n) => head.indexOf(n);
        const iN = ix("Label Name"), iT = ix("Data Type"), iC = ix("Class"), iA = ix("Assign (Device/Label)"), iX = ix("Access from External Device");
        if (iN < 0 || iT < 0)
            out.push({ level: "error", rule: "tag-table", file: "GlobalLabels.csv", line: 1, col: 1, platform: plat, source: SRC.gxw3, msg: tr("Hlavička GlobalLabels.csv neodpovídá editoru návěští GX Works3 (Label Name, Data Type, Class, …)") });
        const seen = new Map();
        rows.slice(1).forEach((r, i) => {
            if (!r.trim())
                return;
            const c = csvRow(r), pos = P("GlobalLabels.csv", i + 2, 1);
            const name = c[iN], type = c[iT], assign = iA >= 0 ? c[iA] : "";
            /* GX Works3 OM (Exporting/importing a label): Access from External Device se v CSV zapisuje 1 / 0 */
            if (iX >= 0 && c[iX] !== "1" && c[iX] !== "0")
                out.push({ level: "error", rule: "tag-table", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.gxw3, msg: tr("{name}: Access from External Device musí být 1 nebo 0, ne „{v}“", { name, v: c[iX] ?? "" }) });
            if (iC >= 0 && c[iC] !== "VAR_GLOBAL" && c[iC] !== "VAR_GLOBAL_CONSTANT")
                out.push({ level: "error", rule: "tag-table", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.gxw3, msg: tr("{name}: třída {cls} není platná pro globální návěští", { name, cls: c[iC] }) });
            const t = /^bit$/i.test(type) ? "BOOL" : /^word \[signed\]$/i.test(type) ? "INT" : /^double word \[signed\]$/i.test(type) ? "DINT" : /^float/i.test(type) ? "REAL" : type;
            tags.push({ name, type: t, pos, at: assign });
            const dir = dirs.get(name.toUpperCase());
            if (assign) {
                const m = /^([XY])([0-9A-F]+)$/i.exec(assign);
                if (!m)
                    out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.fx5ins, msg: tr("{name}: operand {a} není X/Y", { name, a: assign }) });
                else {
                    if (/[89A-F]/i.test(m[2]))
                        out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.fx5ins, msg: tr("{name}: {a} — FX5 čísluje X/Y osmičkově (X0–X7, X10…), číslice 8, 9 ani A–F neexistují", { name, a: assign }) });
                    if (dir && (m[1].toUpperCase() === "X") !== (dir === "DI"))
                        out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.fx5ins, msg: tr("{name}: {dir} přiřazen na {a} (vstup X, výstup Y)", { name, dir, a: assign }) });
                    if (t !== "BOOL")
                        out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.fx5ins, msg: tr("{name}: bitový operand {a} u typu {type}", { name, a: assign, type }) });
                    if (seen.has(assign.toUpperCase()))
                        out.push({ level: "error", rule: "address", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.fx5ins, msg: tr("Adresa {addr} je použita dvakrát (také řádek {line})", { addr: assign, line: seen.get(assign.toUpperCase()) }) });
                    else
                        seen.set(assign.toUpperCase(), pos.line);
                }
            }
        });
        if (/[^\x00-\x7F]/.test(csv))
            asciiCheck("GlobalLabels.csv", csv, d, "warn", out);
    }
    else if (plat === "omron") {
        const txt = files["Variables.txt"];
        if (txt === undefined) {
            out.push({ level: "error", rule: "tag-table", file: "Variables.txt", line: 0, col: 0, platform: plat, msg: tr("Chybí soubor {file}", { file: "Variables.txt" }) });
            return;
        }
        txt.split(/\r?\n/).forEach((r, i) => {
            if (!r.trim())
                return;
            const c = r.split("\t"), pos = P("Variables.txt", i + 1, 1);
            if (c.length !== 8)
                out.push({ level: "error", rule: "tag-table", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.w504, msg: tr("Řádek má {n} sloupců — tabulka Global Variables má 8 (Name, Data Type, Initial Value, AT, Retain, Constant, Network Publish, Comment)", { n: c.length }) });
            if (/^name$/i.test(c[0]))
                out.push({ level: "error", rule: "tag-table", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.w504, msg: tr("Řádek hlavičky by se vložil jako proměnná „Name“") });
            /* W501 6-3-8: Network Publish = Do not publish / Publish Only / Input / Output (prázdné = nepublikovat) */
            if (c.length === 8 && !["", "Do not publish", "Publish Only", "Input", "Output"].includes(c[6]))
                out.push({ level: "error", rule: "tag-table", file: pos.file, line: pos.line, col: 1, platform: plat, source: SRC.w501, msg: tr("{name}: Network Publish „{v}“ — Sysmac zná Do not publish, Publish Only, Input, Output", { name: c[0], v: c[6] }) });
            tags.push({ name: c[0], type: c[1] || "BOOL", pos });
        });
    }
    const lib = files["Gen_Library.st"], main = files["MAIN.st"];
    if (lib !== undefined)
        units.push(parseCode(lib, "Gen_Library.st", d, out));
    /* další POU jako samostatné soubory (styl OOP: FB_Sequence.st) */
    for (const n of Object.keys(files).sort())
        if (/\.st$/i.test(n) && !["GVL_IO.st", "Gen_Library.st", "MAIN.st"].includes(n))
            units.push(parseCode(files[n], n, d, out));
    if (main === undefined) {
        out.push({ level: "error", rule: "syntax", file: "MAIN.st", line: 0, col: 0, platform: plat, msg: tr("Chybí soubor {file}", { file: "MAIN.st" }) });
        return;
    }
    units.push(parseCode(main, "MAIN.st", d, out));
    const prog = units.flatMap(u => u.pous).find(p => p.kind === "program");
    return { d, units, tags, entry: { program: prog ? prog.name : "MAIN" } };
}
/* ------------------------------------------------------------------ Rockwell */
function attrOf(tag, name) {
    const m = new RegExp("\\s" + name + '="([^"]*)"').exec(tag);
    return m ? m[1] : undefined;
}
/** Řádky rutiny z CDATA. */
function routineLines(xml) {
    return [...xml.matchAll(/<Line Number="\d+">((?:<!\[CDATA\[[\s\S]*?\]\]>)+)<\/Line>/g)]
        .map(m => [...m[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(c => c[1]).join("")).join("\n");
}
function defaultOf(block) {
    const m = /<DataValue[^>]*Value="([^"]*)"/.exec(block);
    return m ? Number(m[1]) : undefined;
}
function loadRockwell(prj, files, d, out) {
    const x = files["PLCdesk_Program.L5X"];
    const F = "PLCdesk_Program.L5X";
    if (x === undefined) {
        out.push({ level: "error", rule: "tag-table", file: F, line: 0, col: 0, platform: d.plat, msg: tr("Chybí soubor {file}", { file: F }) });
        return;
    }
    for (const e of xmlProblems(x))
        out.push({ level: "error", rule: "xml", file: F, line: 0, col: 0, platform: d.plat, source: SRC.rm014, msg: e });
    const lineOf = (idx) => x.slice(0, idx).split("\n").length;
    const tagsIn = (block, offset) => [...block.matchAll(/<Tag\s[^>]*>/g)].map(m => ({
        name: attrOf(m[0], "Name") || "", type: attrOf(m[0], "DataType") || "DINT", pos: P(F, lineOf(offset + (m.index || 0)), 1),
    }));
    const ctrlM = /<Tags Use="Context">([\s\S]*?)<\/Tags>/.exec(x);
    const tags = ctrlM ? tagsIn(ctrlM[1], ctrlM.index) : [];
    const progM = /<Program [^>]*>[\s\S]*?<Tags>([\s\S]*?)<\/Tags>/.exec(x);
    const progTags = progM ? tagsIn(progM[1], progM.index + progM[0].indexOf(progM[1])) : [];
    const aois = [];
    for (const m of x.matchAll(/<AddOnInstructionDefinition\s[^>]*>[\s\S]*?<\/AddOnInstructionDefinition>/g)) {
        const blk = m[0], at = m.index || 0, name = attrOf(blk.slice(0, blk.indexOf(">")), "Name") || "AOI";
        const params = [...blk.matchAll(/<Parameter\s([^>]*?)(\/>|>([\s\S]*?)<\/Parameter>)/g)].map(p => ({
            name: attrOf(" " + p[1], "Name") || "", type: attrOf(" " + p[1], "DataType") || "DINT",
            usage: (attrOf(" " + p[1], "Usage") || "Input"), def: p[3] ? defaultOf(p[3]) : undefined, pos: P(F, lineOf(at + (p.index || 0)), 1),
        }));
        const locals = [...blk.matchAll(/<LocalTag\s([^>]*?)(\/>|>([\s\S]*?)<\/LocalTag>)/g)].map(p => ({
            name: attrOf(" " + p[1], "Name") || "", type: attrOf(" " + p[1], "DataType") || "DINT", def: p[3] ? defaultOf(p[3]) : undefined, pos: P(F, lineOf(at + (p.index || 0)), 1),
        }));
        const rt = /<Routine Name="Logic" Type="ST">[\s\S]*?<\/Routine>/.exec(blk);
        if (!rt)
            out.push({ level: "error", rule: "syntax", file: F, line: lineOf(at), col: 1, platform: d.plat, source: SRC.pm010, msg: tr("AOI {name} nemá rutinu Logic (ST)", { name }) });
        const body = rt ? parseCode(routineLines(rt[0]), F + "/" + name, d, out, true).stmts || [] : [];
        aois.push({ name, pos: P(F, lineOf(at), 1), params, locals, body });
    }
    const mr = /<Routine Name="MainRoutine"[^>]*>[\s\S]*?<\/Routine>/.exec(x);
    if (!mr) {
        out.push({ level: "error", rule: "syntax", file: F, line: 0, col: 0, platform: d.plat, source: SRC.rm014, msg: tr("L5X: chybí rutina MainRoutine") });
        return;
    }
    const mainText = routineLines(mr[0]);
    if (files["MainRoutine.st"] !== undefined && files["MainRoutine.st"].replace(/\s+$/, "") !== mainText.replace(/\s+$/, ""))
        out.push({ level: "error", rule: "tag-table", file: "MainRoutine.st", line: 0, col: 0, platform: d.plat, msg: tr("MainRoutine.st se liší od rutiny v L5X") });
    const stmts = parseCode(mainText, F + "/MainRoutine", d, out, true).stmts || [];
    /* Tags.csv (náhradní cesta): hlavička, ALIAS na body modulů 5069, tagy shodné s L5X */
    const csv = files["Tags.csv"];
    if (csv !== undefined) {
        const rows = csv.split(/\r?\n/);
        if (!rows.includes("0.3") || !rows.some(r => r.startsWith("TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES")))
            out.push({ level: "error", rule: "tag-table", file: "Tags.csv", line: 1, col: 1, platform: d.plat, source: SRC.rm014, msg: tr("Tags.csv: chybí řádek verze 0.3 nebo hlavička TYPE,SCOPE,NAME,…") });
        const known = new Set([...tags, ...progTags].map(t => t.name.toUpperCase()));
        rows.forEach((r, i) => {
            if (!/^(TAG|ALIAS),/.test(r))
                return;
            const c = csvRow(r);
            if (!known.has((c[2] || "").toUpperCase()))
                out.push({ level: "error", rule: "tag-table", file: "Tags.csv", line: i + 1, col: 1, platform: d.plat, msg: tr("Tags.csv: tag {name} není v L5X", { name: c[2] }) });
            if (c[0] === "ALIAS" && !/^Local:\d+:[IO]\.(Pt|Ch)\d{2}\.Data$/.test(c[5] || ""))
                out.push({ level: "error", rule: "address", file: "Tags.csv", line: i + 1, col: 1, platform: d.plat, source: SRC.rm014, msg: tr("Tags.csv: alias {name} → {spec} není bod modulu 5069 (Local:slot:I.Ptnn.Data / Chnn.Data)", { name: c[2], spec: c[5] }) });
        });
    }
    for (const n of Object.keys(files))
        if (n !== "README.txt")
            asciiCheck(n, files[n], d, "error", out);
    return { d, units: [], tags, progTags, aois, entry: { stmts, file: F + "/MainRoutine" } };
}
/* ---------------------------------------------------------------- Unitronics */
function loadUnitronics(prj, files, d, out) {
    const csv = files["Tags.csv"], st = files["Machine.st"];
    if (csv === undefined || st === undefined) {
        out.push({ level: "error", rule: "tag-table", file: csv === undefined ? "Tags.csv" : "Machine.st", line: 0, col: 0, platform: d.plat, msg: tr("Chybí soubor {file}", { file: csv === undefined ? "Tags.csv" : "Machine.st" }) });
        return;
    }
    for (const n of ["Tags.csv", "Machine.st"])
        asciiCheck(n, files[n], d, "error", out);
    const rows = csv.split(/\r?\n/);
    const tags = [];
    const known = new Set(["BIT", "INT16", "UINT16", "INT32", "UINT32", "REAL", "TON", "TOF", "TP", "BOOL", "INT", "DINT", "UINT"]);
    rows.slice(1).forEach((r, i) => {
        if (!r.trim())
            return;
        const c = csvRow(r), pos = P("Tags.csv", i + 2, 1);
        if (!known.has((c[1] || "").toUpperCase()))
            out.push({ level: "error", rule: "tag-table", file: pos.file, line: pos.line, col: 1, platform: d.plat, source: SRC.ulDt, msg: tr("Tag {name}: datový typ {type} UniLogic nezná", { name: c[0], type: c[1] }) });
        tags.push({ name: c[0], type: c[1] || "BIT", pos });
    });
    const tn = tags.filter(t => /^(TON|TOF|TP)$/i.test(t.type));
    if (tn.length)
        out.push({ level: "warn", rule: "tag-table", file: "Tags.csv", line: tn[0].pos.line, col: 1, platform: d.plat, source: SRC.ulNew, msg: tr("{n} časovačů je globální tag typu TON — UniLogic uvádí v datových typech Timer; IEC TON v ST až od verze 05/2026, zda může být globálním tagem, je neověřeno", { n: tn.length }) });
    if (/\bFUNCTION_BLOCK\b/i.test(st.replace(/\(\*[\s\S]*?\*\)/g, "")))
        out.push({ level: "error", rule: "unitronics-fb", file: "Machine.st", line: 0, col: 0, platform: d.plat, source: SRC.ulSt, msg: tr("UniLogic ST funkce nemůže obsahovat FUNCTION_BLOCK") });
    const u = parseCode(st, "Machine.st", d, out, true);
    return { d, units: [], tags, entry: { stmts: u.stmts || [], file: "Machine.st" } };
}
/** Načte soubory platformy (výstup genFor) do vstupu překladače. */
export function loadPlatform(prj, plat, files) {
    const d = DIALECTS[plat];
    const findings = [];
    let input;
    if (plat === "siemens")
        input = loadSiemens(prj, files, d, findings);
    else if (plat === "rockwell")
        input = loadRockwell(prj, files, d, findings);
    else if (plat === "unitronics")
        input = loadUnitronics(prj, files, d, findings);
    else
        input = loadIec(prj, files, d, findings);
    return { input, findings };
}
