/**
 * Referenční (golden) výstupy generátoru — hlídač refaktoringu „beze změny výstupu".
 *
 * Pro každý projekt (příklady `samples/*.plcstudio.json` + `sampleSmall` + `sampleComplex`)
 * × 5 jazyků se vygenerují všechny soubory programu pro 8 platforem (`genFor`: zdroje, tagy,
 * L5X, Unitronics, PLCopen XML, README) a dokumentace (`docFiles`). Uloží se jen otisk
 * (SHA-256) a velikost každého souboru v `packages/core/test-data/golden/<projekt>.json`;
 * test `golden.test.ts` je porovná. Přegenerování (jen při VĚDOMÉ změně výstupu, se
 * zdůvodněním v commitu): `node scripts/golden.mjs --write`.
 *
 * Modul není součástí veřejného API (`index.ts` ho neexportuje) — používá ho skript a test.
 * Hash dodává volající (node:crypto), jádro tak zůstává bez závislostí na Node.
 */
/* celé jádro: moduly, které se přihlašují k dokumentaci při načtení (registerDocProvider),
   musí být načtené stejně ve skriptu i v testu — jinak by se sada dokumentů lišila */
import "./index.js";
import { PLAT, blankProject, syncIO } from "./model.js";
import { setLang, LANGS } from "./i18n.js";
import { genFor } from "./codegen.js";
import { docFiles } from "./docs.js";
import { sampleSmall, sampleComplex } from "./samples.js";
/** Pevný okamžik pro výstupy s datem (dokumentace, PLCopen XML): 2026-01-15 12:00 UTC. */
export const GOLDEN_TIME = Date.UTC(2026, 0, 15, 12, 0, 0);
export const GOLDEN_PLATFORMS = Object.keys(PLAT);
export const GOLDEN_LANGS = Object.keys(LANGS);
/** Vestavěné ukázky — vznikají v právě nastaveném jazyce, proto se tvoří pro každý jazyk znovu. */
export const GOLDEN_BUILTIN = { sampleSmall, sampleComplex };
/** Projekt z uloženého souboru (formát desktopu / exportu webu), se všemi platformami. */
export function goldenProject(raw) {
    const r = raw;
    const prj = Object.assign(blankProject(), (r && r.prj) || raw);
    prj.platforms = [...GOLDEN_PLATFORMS];
    syncIO(prj);
    return prj;
}
/**
 * Provede `fn` s pevným časem (`new Date()` / `Date.now()` = `GOLDEN_TIME`) a časovým pásmem UTC.
 * Výstup se tím nemění — jen se v testu odstraní závislost na dni a hodině běhu.
 */
export function withFixedClock(fn) {
    const G = globalThis;
    const Real = G.Date;
    const env = G.process?.env;
    const tz = env ? env.TZ : undefined;
    if (env)
        env.TZ = "UTC";
    class FixedDate extends Real {
        constructor(...a) {
            if (a.length)
                super(...a);
            else
                super(GOLDEN_TIME);
        }
        static now() { return GOLDEN_TIME; }
    }
    G.Date = FixedDate;
    try {
        return fn();
    }
    finally {
        G.Date = Real;
        if (env) {
            if (tz === undefined)
                delete env.TZ;
            else
                env.TZ = tz;
        }
    }
}
/** Všechny sledované soubory projektu v jazyce `lang` (nastaví jazyk; volat uvnitř `withFixedClock`). */
export function goldenFiles(make, lang, docs = true) {
    setLang(lang);
    const prj = make();
    const out = {};
    for (const p of GOLDEN_PLATFORMS) {
        for (const [n, b] of Object.entries(genFor(prj, p)))
            out["code/" + p + "/" + n] = b;
    }
    /* dokumentace obsahuje ověření simulací — u velkých příkladů desítky sekund na jazyk */
    if (docs)
        for (const f of docFiles(prj))
            out["docs/" + f.path] = f.body;
    return out;
}
/** Otisky souborů všech jazyků. `hash` = SHA-256 v hex (dodá volající). */
export function goldenSet(make, hash, opts = {}) {
    const enc = new TextEncoder();
    const res = {};
    const onFiles = opts.onFiles;
    try {
        withFixedClock(() => {
            for (const l of GOLDEN_LANGS) {
                const files = goldenFiles(make, l, opts.docs ? opts.docs(l) : true);
                if (onFiles)
                    onFiles(l, files);
                const m = {};
                for (const k of Object.keys(files).sort())
                    m[k] = { sha256: hash(files[k]), size: enc.encode(files[k]).length };
                res[l] = m;
            }
        });
    }
    finally {
        setLang("cs");
    }
    return res;
}
/**
 * Rozdíly dvou sad otisků (chybějící, přebývající a změněné soubory) jako čitelné řádky.
 * Když `got` v některém jazyce neobsahuje dokumentaci (vynechaná volbou `docs`), porovná
 * se v tom jazyce jen kód.
 */
export function goldenDiff(want, got) {
    const out = [];
    for (const l of new Set([...Object.keys(want), ...Object.keys(got)])) {
        const a = want[l] || {}, b = got[l] || {};
        const docs = Object.keys(b).some(k => k.startsWith("docs/"));
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (!docs && k.startsWith("docs/"))
                continue;
            if (!b[k])
                out.push(l + " " + k + ": chybí ve výstupu");
            else if (!a[k])
                out.push(l + " " + k + ": nový soubor (není v referenci)");
            else if (a[k].sha256 !== b[k].sha256)
                out.push(l + " " + k + ": změněn (" + a[k].size + " → " + b[k].size + " B)");
        }
    }
    return out;
}
