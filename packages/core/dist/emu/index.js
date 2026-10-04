import { PLAT } from "../model.js";
import { genFor } from "../codegen.js";
import { getLang, tr, withLang } from "../i18n.js";
import { loadPlatform } from "./load.js";
import { compile } from "./compile.js";
import { runPlatforms } from "./run.js";
import { bindEmuApi } from "./doc.js";
export { DIALECTS as EMU_DIALECTS, RULES as EMU_RULES, SRC as EMU_SRC } from "./dialects.js";
export { emuScenarios } from "./run.js";
/** Rozsah surové hodnoty analogu, se kterým počítá kód platformy (rawMax ve volání bloku; Siemens 27648). */
function detectRawMax(files) {
    for (const [n, b] of Object.entries(files)) {
        if (n === "README.txt" || /Library/.test(n))
            continue;
        const m = /\brawMax\s*:=\s*([0-9]+(?:\.[0-9]+)?)/.exec(b);
        if (m)
            return +m[1];
    }
    return 27648;
}
const compileCache = new Map();
const CACHE_MAX = 64;
const put = (m, k, v) => { m.set(k, v); if (m.size > CACHE_MAX)
    m.delete(m.keys().next().value); };
/** Otisk přeloženého programu (JS + počáteční stav) — nezávisí na komentářích a jazyku textů. */
function fingerprint(prog, files) {
    let h = 2166136261 >>> 0;
    const mix = (s) => { for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    } };
    if (prog) {
        mix(prog.src);
        mix(Array.from(prog.init).join(","));
    }
    else
        mix(Object.keys(files).sort().map(n => n + "=" + files[n]).join("\n"));
    return h.toString(16) + ":" + (prog ? prog.src.length : 0);
}
/** Přeloží soubory jedné platformy (bez cache) — pro testy a vlastní soubory. */
export function emulateFiles(prj, platform, files) {
    const ld = loadPlatform(prj, platform, files);
    const findings = [...ld.findings];
    let prog;
    if (ld.input) {
        prog = compile(ld.input);
        findings.push(...prog.findings);
    }
    const seen = new Set();
    const uniq = findings.filter(f => { const k = f.rule + "|" + f.file + "|" + f.line + "|" + f.col + "|" + f.msg; if (seen.has(k))
        return false; seen.add(k); return true; })
        .map(f => ({ ...f, platform }));
    const order = { error: 0, warn: 1, info: 2 };
    uniq.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
    const ok = !uniq.some(f => f.level === "error");
    return { res: { platform, files: Object.keys(files), findings: uniq, ok }, prog: ok && prog && prog.ok ? prog : undefined };
}
function compileEntry(prj, platform, lang = getLang()) {
    const key = JSON.stringify([prj, platform, lang]);
    const hit = compileCache.get(key);
    if (hit)
        return hit;
    /* soubory (komentáře, hlášení) v žádaném jazyce — klíč cache nese jazyk */
    const { files, r } = withLang(lang, () => { const files = genFor(prj, platform); return { files, r: emulateFiles(prj, platform, files) }; });
    const e = { res: r.res, prog: r.prog, fp: fingerprint(r.prog, files), rawMax: detectRawMax(files) };
    put(compileCache, key, e);
    return e;
}
/** Emulace překladu vygenerovaného kódu jedné platformy. */
export function emulateCompile(prj, platform, lang) {
    return compileEntry(prj, platform, lang || getLang()).res;
}
const runCache = new Map();
/** Emulace běhu: přeložený kód scan po scanu proti modelu stroje, porovnání s návrhem. */
export function emulateRun(prj, platform, opts = {}) {
    return emulateRunMany(prj, [platform], opts)[platform];
}
/** Běh více platforem v jednom průchodu (sdílený simulátor návrhu). */
export function emulateRunMany(prj, platforms, opts = {}) {
    const out = {};
    const todo = [];
    for (const plat of platforms) {
        const c = compileEntry(prj, plat);
        const key = JSON.stringify([prj, plat, c.fp, opts.scope || "full", opts.dt || 0]);
        const hit = runCache.get(key);
        if (hit) {
            out[plat] = hit;
            continue;
        }
        if (!c.prog) {
            out[plat] = { platform: plat, scenarios: [], diffs: [], ok: false, skipped: tr("Kód se nepřeložil — běh nelze emulovat (viz nálezy překladu)."), ms: 0, scans: 0 };
            continue;
        }
        todo.push({ plat, prog: c.prog, key, rawMax: c.rawMax });
    }
    if (todo.length) {
        const res = runPlatforms(prj, todo.map(t => ({ plat: t.plat, prog: t.prog, rawMax: t.rawMax })), opts);
        for (const t of todo) {
            out[t.plat] = res[t.plat];
            put(runCache, t.key, res[t.plat]);
        }
    }
    return out;
}
/** Běh kódu ze zadaných souborů (testy, vlastní úpravy kódu) — bez cache. */
export function emulateRunFiles(prj, platform, files, opts = {}) {
    const r = emulateFiles(prj, platform, files);
    if (!r.prog)
        return { platform, scenarios: [], diffs: [], ok: false, skipped: tr("Kód se nepřeložil — běh nelze emulovat (viz nálezy překladu)."), ms: 0, scans: 0 };
    return runPlatforms(prj, [{ plat: platform, prog: r.prog, rawMax: detectRawMax(files) }], opts)[platform];
}
/** Překlad i běh všech platforem projektu (výchozí: všech 8). */
export function emulateAll(prj, opts = {}) {
    const t0 = Date.now();
    const plats = opts.platforms || Object.keys(PLAT);
    const compileRes = {};
    for (const p of plats)
        compileRes[p] = emulateCompile(prj, p);
    const run = emulateRunMany(prj, plats, opts);
    const ok = plats.every(p => compileRes[p].ok && run[p].ok);
    return { compile: compileRes, run, ok, ms: Date.now() - t0 };
}
export { emuDocMd, EMU_DOC_FILE, registerEmuModule, unregisterEmuModule, emuModuleRegistered } from "./doc.js";
bindEmuApi({ emulateAll });
