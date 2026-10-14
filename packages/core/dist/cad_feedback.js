import { stripDia } from "./model.js";
import { buildBom } from "./bom.js";
import { brandsFor, brandOptId } from "./catalog.js";
import { cadManifestJson } from "./cad.js";
import { tr, N_, getLang, setLang, LANGS } from "./i18n.js";
export const CAD_FEEDBACK_FORMAT = "plcdesk-cad-feedback";
export const CAD_FEEDBACK_VERSION = 1;
/** Obvyklé jméno souboru zpětné vazby (nástroje CAD ho tak ukládají). */
export const CAD_FEEDBACK_FILE = "PLCdesk_CAD_feedback.json";
export const CAD_FEEDBACK_KINDS = ["cabinet_too_small", "part_not_fitting", "qty_mismatch", "ambiguous_type",
    "missing_order_code", "model_mismatch", "other"];
/* ------------------------------------------------------------------ SHA-256 (synchronně, bez závislostí) */
const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** SHA-256 textu v UTF-8 (hex, malá písmena) — otisk manifestu pro CAD, jak ho počítá nástroj CAD ze souboru. */
export function sha256Text(text) {
    const data = new TextEncoder().encode(text);
    const len = data.length, nBlocks = ((len + 9 + 63) >> 6);
    const buf = new Uint8Array(nBlocks * 64);
    buf.set(data);
    buf[len] = 0x80;
    const bits = len * 8, dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(buf.length - 4, bits >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < buf.length; o += 64) {
        for (let i = 0; i < 16; i++)
            W[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 64; i++) {
            const a = W[i - 15], b = W[i - 2];
            W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        H[0] += a;
        H[1] += b;
        H[2] += c;
        H[3] += d;
        H[4] += e;
        H[5] += f;
        H[6] += g;
        H[7] += h;
    }
    return Array.from(H, x => x.toString(16).padStart(8, "0")).join("");
}
/** Otisk manifestu pro CAD, jak ho klient uloží (`cadManifestJson`, aktuální jazyk). */
export function cadManifestSha256(prj) {
    return sha256Text(cadManifestJson(prj));
}
/**
 * Odpovídá otisk zpětné vazby aktuálnímu manifestu? Popisy dílů manifestu jsou v jazyce UI při exportu,
 * proto se zkusí i ostatní jazyky (export v češtině, kontrola v angličtině není „zastaralá“).
 */
function manifestMatches(prj, sha) {
    const want = sha.toLowerCase();
    if (cadManifestSha256(prj) === want)
        return true;
    const cur = getLang();
    try {
        for (const l of Object.keys(LANGS)) {
            if (l === cur)
                continue;
            setLang(l);
            if (cadManifestSha256(prj) === want)
                return true;
        }
    }
    finally {
        setLang(cur);
    }
    return false;
}
/* ------------------------------------------------------------------ čtení a validace */
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/**
 * Načte a ověří zpětnou vazbu podle schématu verze 1. Při chybě `fb` = null a `errors` (přeložené věty
 * s cestou k položce). Neznámé klíče se ignorují (dopředná kompatibilita v rámci verze).
 */
export function parseCadFeedback(text) {
    const errors = [];
    let raw;
    try {
        raw = JSON.parse(String(text ?? "").replace(/^\uFEFF/, ""));
    }
    catch (e) {
        return { fb: null, errors: [tr("Soubor není platný JSON: {msg}", { msg: e.message })] };
    }
    if (!isObj(raw))
        return { fb: null, errors: [tr("Soubor není zpětná vazba z CAD (očekáván objekt JSON).")] };
    if (raw.format !== CAD_FEEDBACK_FORMAT)
        return { fb: null, errors: [tr("Soubor není zpětná vazba z CAD: format „{f}“, očekáván „{want}“.", { f: String(raw.format ?? ""), want: CAD_FEEDBACK_FORMAT })] };
    if (raw.version !== CAD_FEEDBACK_VERSION)
        return { fb: null, errors: [tr("Nepodporovaná verze zpětné vazby {v} — PLCdesk zná verzi {want}.", { v: String(raw.version ?? ""), want: CAD_FEEDBACK_VERSION })] };
    const need = (cond, path, what) => { if (!cond)
        errors.push(tr("{path}: {what}", { path, what })); };
    const T_STR = tr("chybí nebo není text");
    const T_TEXT = tr("chybí nebo je prázdný text");
    const T_NUM = tr("není číslo");
    need(isObj(raw.project) && isStr(raw.project.guid), "project.guid", T_STR);
    need(isObj(raw.manifest) && isStr(raw.manifest.sha256) && /^[0-9a-fA-F]{64}$/.test(raw.manifest.sha256), "manifest.sha256", tr("chybí otisk SHA-256 manifestu (64 šestnáctkových znaků)"));
    need(isStr(raw.created), "created", T_STR);
    need(isStr(raw.tool), "tool", T_STR);
    if (!Array.isArray(raw.issues)) {
        errors.push(tr("{path}: {what}", { path: "issues", what: tr("chybí seznam položek") }));
        return { fb: null, errors };
    }
    const ids = new Set();
    const issues = [];
    raw.issues.forEach((it, i) => {
        const p = "issues[" + i + "]";
        if (!isObj(it)) {
            need(false, p, tr("položka není objekt"));
            return;
        }
        const n0 = errors.length;
        need(isStr(it.id) && !!it.id.trim(), p + ".id", T_TEXT);
        if (isStr(it.id) && it.id.trim()) {
            need(!ids.has(it.id), p + ".id", tr("„{id}“ je v souboru dvakrát", { id: it.id }));
            ids.add(it.id);
        }
        need(CAD_FEEDBACK_KINDS.includes(it.kind), p + ".kind", tr("neznámý druh „{v}“ (povoleno: {list})", { v: String(it.kind ?? ""), list: CAD_FEEDBACK_KINDS.join(", ") }));
        need(it.severity === "error" || it.severity === "warn" || it.severity === "info", p + ".severity", tr("neznámá závažnost „{v}“ (povoleno: error, warn, info)", { v: String(it.severity ?? "") }));
        need(Array.isArray(it.parts) && it.parts.every(isStr), p + ".parts", tr("musí být seznam partId (text)"));
        need(isStr(it.message) && !!it.message.trim(), p + ".message", T_TEXT);
        if (it.measured !== undefined) {
            const m = it.measured;
            if (!isObj(m))
                need(false, p + ".measured", tr("není objekt"));
            else {
                need(isStr(m.what), p + ".measured.what", T_STR);
                need(isNum(m.value), p + ".measured.value", T_NUM);
                need(isStr(m.unit), p + ".measured.unit", T_STR);
                need(isStr(m.source) && !!m.source.trim(), p + ".measured.source", tr("chybí zdroj — zpětná vazba nese jen měřená / doložená fakta"));
            }
        }
        if (it.required !== undefined) {
            const r = it.required;
            if (!isObj(r))
                need(false, p + ".required", tr("není objekt"));
            else {
                need(isStr(r.what), p + ".required.what", T_STR);
                need(isStr(r.unit), p + ".required.unit", T_STR);
                for (const k of ["min", "max", "value"])
                    if (r[k] !== undefined)
                        need(isNum(r[k]), p + ".required." + k, T_NUM);
                if (r.basis !== undefined)
                    need(isStr(r.basis), p + ".required.basis", T_STR);
            }
        }
        if (it.suggestion !== undefined) {
            const s = it.suggestion;
            if (!isObj(s))
                need(false, p + ".suggestion", tr("není objekt"));
            else {
                need(isStr(s.partId) && !!s.partId, p + ".suggestion.partId", T_TEXT);
                if (s.line !== undefined) {
                    if (!isObj(s.line))
                        need(false, p + ".suggestion.line", tr("není objekt"));
                    else {
                        for (const k of ["type", "orderCode", "brand", "supplier", "note"])
                            if (s.line[k] !== undefined)
                                need(isStr(s.line[k]), p + ".suggestion.line." + k, T_STR);
                        if (s.line.qty !== undefined)
                            need(isNum(s.line.qty) && Number.isInteger(s.line.qty) && s.line.qty >= 0, p + ".suggestion.line.qty", tr("musí být celé číslo ≥ 0"));
                    }
                }
                if (s.alternatives !== undefined) {
                    if (!Array.isArray(s.alternatives))
                        need(false, p + ".suggestion.alternatives", tr("musí být seznam"));
                    else
                        s.alternatives.forEach((a, j) => {
                            const q = p + ".suggestion.alternatives[" + j + "]";
                            if (!isObj(a)) {
                                need(false, q, tr("není objekt"));
                                return;
                            }
                            for (const k of ["type", "orderCode", "brand", "why"])
                                if (a[k] !== undefined)
                                    need(isStr(a[k]), q + "." + k, T_STR);
                        });
                }
            }
        }
        if (errors.length === n0) {
            const s = it.suggestion;
            issues.push({
                id: it.id, kind: it.kind, severity: it.severity, parts: [...it.parts], message: it.message,
                ...(isObj(it.measured) ? { measured: { what: it.measured.what, value: it.measured.value, unit: it.measured.unit, source: it.measured.source } } : {}),
                ...(isObj(it.required) ? { required: { ...pick(it.required, ["min", "max", "value"]), what: it.required.what, unit: it.required.unit, basis: isStr(it.required.basis) ? it.required.basis : "" } } : {}),
                ...(isObj(s) ? { suggestion: {
                        partId: s.partId,
                        ...(isObj(s.line) ? { line: pick(s.line, ["type", "orderCode", "brand", "supplier", "qty", "note"]) } : {}),
                        ...(Array.isArray(s.alternatives) ? { alternatives: s.alternatives.map((a) => pick(a, ["type", "orderCode", "brand", "why"])) } : {}),
                    } } : {}),
            });
        }
    });
    if (errors.length)
        return { fb: null, errors };
    return {
        fb: { format: CAD_FEEDBACK_FORMAT, version: CAD_FEEDBACK_VERSION, project: { guid: raw.project.guid },
            manifest: { sha256: raw.manifest.sha256.toLowerCase() }, created: raw.created, tool: raw.tool, issues },
        errors: [],
    };
}
function pick(o, keys) {
    const r = {};
    for (const k of keys)
        if (o[k] !== undefined)
            r[k] = o[k];
    return r;
}
const SEV_ORDER = { error: 0, warn: 1, info: 2 };
const norm = (s) => stripDia(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
const codeNorm = (s) => String(s ?? "").toUpperCase().replace(/[\s.\-]/g, "");
function dimOf(what) {
    const t = norm(what);
    if (/hloub|depth|tiefe|profund|深/.test(t))
        return "d";
    if (/ploch|area|flache|superficie|面积/.test(t))
        return "area";
    if (/sir|width|breit|ancho|宽/.test(t))
        return "w";
    if (/vysk|height|hohe|alto|altura|高/.test(t))
        return "h";
    return "";
}
const DIM_LABEL = {
    d: N_("hloubka"), w: N_("šířka"), h: N_("výška"), area: N_("plocha montážní desky"),
};
/** Převod požadavku na mm (u plochy mm²); neznámá jednotka = NaN. */
function toMm(v, unit, area) {
    const u = String(unit || "").toLowerCase().replace("²", "2").replace(/\s/g, "");
    if (area)
        return u === "mm2" ? v : u === "cm2" ? v * 100 : u === "dm2" ? v * 1e4 : u === "m2" ? v * 1e6 : NaN;
    return u === "mm" ? v : u === "cm" ? v * 10 : u === "dm" ? v * 100 : u === "m" ? v * 1000 : NaN;
}
const dimValue = (b, k) => {
    const d = b.dims;
    return k === "area" ? (d.plateW && d.plateH ? d.plateW * d.plateH : d.w * d.h) : d[k];
};
function lineCfgOf(prj, id) { return { ...(prj.bom?.lines?.[id] || {}) }; }
/** Výběr položky katalogu pro řádek: volba = `brand` (optId), přepsané typ / kód / dodavatel se zahodí. */
function catalogProposal(prj, l, b, why, source, extra = {}) {
    const old = lineCfgOf(prj, l.id);
    const cfg = { brand: brandOptId(b) };
    if (old.qty !== undefined)
        cfg.qty = old.qty;
    if (extra.qty !== undefined)
        cfg.qty = extra.qty;
    const note = mergeNote(old.note, extra.note);
    if (note)
        cfg.note = note;
    return {
        source, brand: b.brand, type: b.typical ? tr(b.typical) : (b.series || []).map(x => tr(x)).join(" / "),
        orderCode: b.orderCode || "", qty: cfg.qty ?? l.qty, optId: brandOptId(b), why, cfg,
    };
}
function mergeNote(old, add) {
    const a = (old || "").trim(), b = (add || "").trim();
    if (!b)
        return a;
    if (!a)
        return b;
    return a.split("; ").includes(b) ? a : a + "; " + b;
}
/** Návrh z CAD (řádek nebo alternativa) → volba uživatele; shoda s katalogem = výběr položky katalogu. */
function cadProposal(prj, plat, l, line, why) {
    const brands = brandsFor(l.cat, plat);
    const code = codeNorm(line.orderCode);
    const brandOk = (b) => !line.brand || norm(b.brand) === norm(line.brand);
    const hit = (code ? brands.find(b => brandOk(b) && b.orderCode && codeNorm(b.orderCode) === code) : undefined)
        || (line.type ? brands.find(b => brandOk(b) && b.typical && (norm(b.typical) === norm(line.type) || norm(tr(b.typical)) === norm(line.type))) : undefined);
    const qty = line.qty !== undefined && line.qty !== l.qty ? line.qty : undefined;
    if (hit)
        return catalogProposal(prj, l, hit, why, "cad", { qty, note: line.note });
    /* mimo katalog: vlastní typ / kód (značka zůstává, pokud ji CAD neuvádí) */
    const cfg = lineCfgOf(prj, l.id);
    if (line.brand !== undefined && norm(line.brand) !== norm(l.brand)) {
        cfg.brand = line.brand;
        if (line.supplier === undefined)
            cfg.supplier = "";
    }
    if (line.type !== undefined)
        cfg.type = line.type;
    if (line.orderCode !== undefined)
        cfg.orderCode = line.orderCode;
    if (line.supplier !== undefined)
        cfg.supplier = line.supplier;
    if (qty !== undefined)
        cfg.qty = qty;
    const note = mergeNote(cfg.note, line.note);
    if (note)
        cfg.note = note;
    else
        delete cfg.note;
    return {
        source: "cad", brand: cfg.brand ?? l.brand, type: line.type ?? l.type, orderCode: line.orderCode ?? l.orderCode,
        qty: cfg.qty ?? l.qty, optId: "", why, cfg,
    };
}
/** Větší skříně z katalogu, které splní požadavek CAD (rozměr ≥ min) a nejsou menší než současná skříň. */
function cabinetCandidates(prj, plat, l, req) {
    const none = { list: [], ok: "" };
    if (!req || !isNum(req.min))
        return none;
    const k = dimOf(req.what);
    if (!k)
        return none;
    const min = toMm(req.min, req.unit, k === "area");
    if (!Number.isFinite(min))
        return none;
    const brands = brandsFor(l.cat, plat).filter(b => b.dims);
    const cur = brands.find(b => brandOptId(b) === l.optId);
    const unit = k === "area" ? "mm²" : "mm";
    /* současná skříň už požadavek splňuje (např. po přijetí návrhu) — nic dalšího nenavrhovat (idempotence) */
    if (cur && dimValue(cur, k) >= min)
        return { list: [], ok: tr("Současná skříň požadavek splňuje: {dim} {v} {unit} ≥ {min} {unit}.", { dim: tr(DIM_LABEL[k]), v: dimValue(cur, k), min: Math.ceil(min), unit }) };
    const cands = brands.filter(b => b !== cur && dimValue(b, k) >= min
        && (!cur?.dims || ["w", "h", "d"].every(x => b.dims[x] >= cur.dims[x])));
    const vol = (b) => b.dims.w * b.dims.h * b.dims.d;
    cands.sort((a, b) => (+(a.brand !== l.brand) - +(b.brand !== l.brand)) || vol(a) - vol(b));
    return { ok: "", list: cands.slice(0, 3).map(b => catalogProposal(prj, l, b, tr("Katalog PLCdesk: {dim} {v} {unit} ≥ požadováno {min} {unit} (vnější rozměr {w}×{h}×{d} mm, zdroj {src}); užitný rozměr ověř v CAD.", {
            dim: tr(DIM_LABEL[k]), v: dimValue(b, k), min: Math.ceil(min), unit, w: b.dims.w, h: b.dims.h, d: b.dims.d, src: b.dims.src,
        }), "catalog")) };
}
const sameCfg = (a, b) => {
    const ks = ["brand", "type", "orderCode", "supplier", "qty", "note"];
    return ks.every(k => (a?.[k] ?? undefined) === (b[k] ?? undefined));
};
const numText = (v) => String(Math.round(v * 100) / 100);
/**
 * Položky zpětné vazby k rozhodnutí. Pořadí = závažnost (chyby první), pak pořadí v souboru.
 * Stav: `invalid` = jiný projekt nebo partId, který v kusovníku není (nelze přijmout); `stale` = kusovník
 * se od exportu manifestu změnil (lze přijmout, s varováním); jinak `usable`.
 */
export function cadFeedbackReview(prj, fb) {
    const bom = buildBom(prj);
    const plat = bom.plat;
    const byId = new Map(bom.lines.map(l => [l.id, l]));
    const projectMatch = !!fb.project.guid && fb.project.guid === (prj.guid || "");
    const stale = !manifestMatches(prj, fb.manifest.sha256);
    const warnings = [];
    if (!projectMatch)
        warnings.push(tr("Zpětná vazba patří k jinému projektu (GUID {fb}, projekt {prj}) — nelze ji použít.", { fb: fb.project.guid || "—", prj: prj.guid || "—" }));
    else if (stale)
        warnings.push(tr("Zpětná vazba vychází ze starší verze exportu pro CAD (otisk manifestu nesedí) — kusovník se mezitím změnil. Návrhy posuď pečlivě, po použití exportuj znovu."));
    const hist = prj.bom?.cadFeedback || [];
    const items = fb.issues.map(it => {
        const parts = it.parts.map(id => {
            const l = byId.get(id);
            return l ? { id, known: true, tag: l.tag, item: l.item, brand: l.brand, type: l.type, orderCode: l.orderCode, qty: l.qty }
                : { id, known: false, tag: "", item: "", brand: "", type: "", orderCode: "", qty: 0 };
        });
        /* cílový řádek: návrh z CAD, u malé skříně skříň (v dílech, jinak skříň kusovníku) */
        let partId = it.suggestion?.partId || "";
        if (!partId && it.kind === "cabinet_too_small")
            partId = it.parts.find(id => byId.get(id)?.cat === "cabinet") || bom.lines.find(l => l.cat === "cabinet")?.id || "";
        if (!partId && it.kind !== "other" && it.parts.length === 1)
            partId = it.parts[0];
        const unknown = [...it.parts, ...(it.suggestion?.partId ? [it.suggestion.partId] : [])].filter(id => !byId.has(id));
        const l = partId ? byId.get(partId) : undefined;
        let proposal;
        let info = "";
        const alternatives = [];
        if (l && projectMatch && !unknown.length) {
            if (it.suggestion?.line && Object.keys(it.suggestion.line).length)
                proposal = cadProposal(prj, plat, l, it.suggestion.line, tr("Návrh z CAD"));
            for (const a of it.suggestion?.alternatives || [])
                if (a.type || a.orderCode)
                    alternatives.push(cadProposal(prj, plat, l, { type: a.type, orderCode: a.orderCode, brand: a.brand }, a.why || tr("Alternativa z CAD")));
            if (l.cat === "cabinet") {
                const cc = cabinetCandidates(prj, plat, l, it.required);
                info = cc.ok;
                const cat = cc.list.filter(c => ![proposal, ...alternatives].some(p => p && p.optId && p.optId === c.optId));
                if (!proposal && cat.length)
                    proposal = cat.shift();
                alternatives.push(...cat);
            }
        }
        const state = !projectMatch || unknown.length ? "invalid" : stale ? "stale" : "usable";
        const stateText = !projectMatch ? tr("neplatné — jiný projekt")
            : unknown.length ? tr("neplatné — v kusovníku chybí {list}", { list: unknown.join(", ") })
                : stale ? tr("zastaralé — export pro CAD se od kontroly změnil") : tr("použitelné");
        const m = it.measured, r = it.required;
        const rng = r ? [isNum(r.min) ? "≥ " + numText(r.min) : "", isNum(r.max) ? "≤ " + numText(r.max) : "", isNum(r.value) ? "= " + numText(r.value) : ""].filter(Boolean).join(", ") : "";
        const last = [...hist].reverse().find(h => h.id === it.id && h.manifest === fb.manifest.sha256 && h.created === fb.created);
        return {
            id: it.id, kind: it.kind, severity: it.severity, message: it.message,
            ...(m ? { measured: m } : {}), ...(r ? { required: r } : {}),
            measuredText: m ? m.what + ": " + numText(m.value) + " " + m.unit + " (" + m.source + ")" : "",
            requiredText: r ? (r.what + ": " + rng + " " + r.unit).trim() + (r.basis ? " (" + r.basis + ")" : "") : "",
            parts, partId: l ? partId : "", state, stateText,
            ...(proposal ? { proposal } : {}), alternatives,
            applied: proposal ? sameCfg(prj.bom?.lines?.[partId], proposal.cfg) : !!info, info,
            ...(last ? { decided: last.decision } : {}),
        };
    });
    items.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    const counts = { usable: 0, stale: 0, invalid: 0 };
    for (const i of items)
        counts[i.state]++;
    return { projectMatch, stale, warnings, items, counts };
}
/**
 * Použije rozhodnutí uživatele: `accepted` = id položek (hlavní návrh) nebo `id#n` (n-tá alternativa, od 0).
 * Ostatní použitelné položky se zapíšou jako odmítnuté (`opts.rejected` = jen tyto). Mění `prj` na místě:
 * `prj.bom.lines[partId]` (výběr katalogu / vlastní typ / množství) a historie `prj.bom.cadFeedback`.
 * Totéž rozhodnutí podruhé nic nezmění ani nepřidá (idempotence).
 */
export function applyCadFeedback(prj, fb, accepted, by, opts = {}) {
    const review = cadFeedbackReview(prj, fb);
    const res = { applied: [], acknowledged: [], rejected: [], skipped: [], bomChanged: false };
    const at = opts.at || new Date().toISOString();
    const acc = new Map();
    for (const a of accepted) {
        const m = /^(.*)#(\d+)$/.exec(a);
        if (m && review.items.some(i => i.id === m[1]))
            acc.set(m[1], Number(m[2]));
        else
            acc.set(a, -1);
    }
    const rejected = new Set(opts.rejected ?? review.items.filter(i => !acc.has(i.id)).map(i => i.id));
    const bomCfg = (prj.bom ||= {});
    const hist = (bomCfg.cadFeedback ||= []);
    const record = (it, decision, change) => {
        const r = {
            id: it.id, manifest: fb.manifest.sha256, created: fb.created, tool: fb.tool, at, by: String(by || "").trim(),
            decision, kind: it.kind, severity: it.severity, message: it.message, partId: it.partId, change,
        };
        /* totéž rozhodnutí o téže položce téhož souboru podruhé nic nepřidá (idempotence) */
        const last = [...hist].reverse().find(h => h.id === r.id && h.manifest === r.manifest && h.created === r.created);
        if (last && last.decision === r.decision)
            return;
        hist.push(r);
    };
    const fmt = (p) => [p.brand, p.type, p.type.includes(p.orderCode) ? "" : p.orderCode].filter(Boolean).join(" ") + " (" + tr("{n} ks", { n: p.qty }) + ")";
    for (const it of review.items) {
        if (acc.has(it.id)) {
            if (it.state === "invalid") {
                res.skipped.push({ id: it.id, why: it.stateText });
                continue;
            }
            const n = acc.get(it.id);
            const p = n < 0 ? it.proposal : it.alternatives[n];
            if (n >= 0 && !p) {
                res.skipped.push({ id: it.id + "#" + n, why: tr("alternativa {n} neexistuje", { n }) });
                continue;
            }
            if (!p) {
                record(it, "accepted", "");
                res.acknowledged.push(it.id);
                continue;
            }
            const part = it.parts.find(x => x.id === it.partId) || { brand: "", type: "", orderCode: "", qty: 0 };
            const lines = (bomCfg.lines ||= {});
            const change = it.partId + ": " + fmt(part) + " → " + fmt(p);
            if (sameCfg(lines[it.partId], p.cfg)) {
                record(it, "accepted", change);
                res.acknowledged.push(it.id);
                continue;
            }
            const cfg = {};
            for (const [k, v] of Object.entries(p.cfg))
                if (v !== undefined && v !== "" || k === "supplier" && v === "")
                    cfg[k] = v;
            if (Object.keys(cfg).length)
                lines[it.partId] = cfg;
            else
                delete lines[it.partId];
            record(it, "accepted", change);
            res.applied.push(n < 0 ? it.id : it.id + "#" + n);
            res.bomChanged = true;
        }
        else if (rejected.has(it.id) && it.state !== "invalid") {
            record(it, "rejected", "");
            res.rejected.push(it.id);
        }
    }
    if (!hist.length)
        delete bomCfg.cadFeedback;
    if (bomCfg.lines && !Object.keys(bomCfg.lines).length)
        delete bomCfg.lines;
    return res;
}
/** Popisy druhů a závažností položek zpětné vazby (klíče překladu) — web i desktop. */
export const CAD_FEEDBACK_KIND_LABEL = {
    cabinet_too_small: N_("skříň je malá"), part_not_fitting: N_("díl se nevejde"), qty_mismatch: N_("nesedí množství"),
    ambiguous_type: N_("nejednoznačný typ"), missing_order_code: N_("chybí objednací kód"), model_mismatch: N_("model nesedí s kusovníkem"),
    other: N_("jiné"),
};
export const CAD_FEEDBACK_SEVERITY_LABEL = {
    error: N_("chyba"), warn: N_("upozornění"), info: N_("informace"),
};
/** Text návrhu pro zobrazení: značka, typ, kód (není-li v typu), množství. */
export function cadFbProposalText(p) {
    return [p.brand, p.type, p.orderCode && !p.type.includes(p.orderCode) ? p.orderCode : ""].filter(Boolean).join(" · ")
        + " · " + tr("{n} ks", { n: p.qty });
}
