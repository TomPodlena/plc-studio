/**
 * PLCdesk — revize projektu a změnové řízení.
 *
 * Revize (`Project.revisions`) je zmrazený stav návrhu: označení (A, B, C… nebo 01, 02…), datum,
 * kdo ji vydal, popis změny, kanonický obsah projektu (bez revizí, schválení, výsledků oživení
 * a stavu UI) a stav schválení v okamžiku vydání (`approvalsAt` — záznamy s otiskem a příznakem,
 * zda byly v tu chvíli platné).
 *
 * `diffProjects(a, b)` porovná dva stavy po položkách — zařízení, I/O, sekvence, program
 * (režimy, E-stop, blokování), takt a model stroje, platformy, bezpečnostní funkce (PLr,
 * architektura…), kusovník, koncept — a každou změnu:
 *   - popíše (tr) a naváže na klíče položek schvalování (approval.ts), jejichž otisk se mění,
 *   - zařadí: kosmetická (popis, komentář — schválení nezneplatní), funkční (logika, časy,
 *     signály) nebo bezpečnostní (mění položku „safety:*“ / bezpečnostní data).
 * Dotčené položky se počítají ze SKUTEČNÝCH otisků položek schvalování obou stavů — klasifikace
 * tak odpovídá tomu, co approval.ts označí jako „změněno po schválení“. Levný výpočet (výchozí)
 * nespouští ověření simulací: položky na něm závislé jsou v `maybe` (možná dotčené); `exact`
 * spustí ověření a výsledek je přesný.
 *
 * `retestScope()` z rozdílu odvodí doporučený rozsah opakovaných zkoušek: body FAT, kroky plánu
 * oživení (commission.ts) a validaci dotčených bezpečnostních funkcí (fáze 10). Je to NÁVRH —
 * rozsah potvrzuje odpovědná osoba. Zpráva `17_zmeny.md` (přes `registerDocProvider`) a sloupec
 * revize v popisovém poli výkresů (`setSheetRevision` v drawing.ts) se přihlašují samy.
 */
import { PLAT, CLS, DO_ROLES, blankProject, devById, interlockDevs, enableInputs, isMotionClass } from "./model.js";
import { tr, N_, formatDate, today } from "./i18n.js";
import { canonicalJson, fnv1a64, approvalItems, designView, noGuid, motionContent } from "./approval.js";
import { commissioningPlan, COMMISSION_PHASES } from "./commission.js";
import { proposeSafety, safetyModuleRegistered } from "./safety.js";
import { stepTitle } from "./sim.js";
import { axisCfgOf } from "./axis.js";
import { registerDocProvider } from "./docs.js";
import { setSheetRevision } from "./drawing.js";
/** Části projektu, které revize zachycuje (bez revizí, schválení, výsledků oživení a stavu UI). */
const CONTENT_KEYS = ["meta", "platforms", "devices", "io", "program", "nextId", "sim", "bom", "concept", "safety", "library"];
/** Kanonický obsah projektu pro revizi a porovnání (hluboká kopie, seřazené klíče, bez `undefined`). */
export function revisionContent(prj) {
    const o = {};
    for (const k of CONTENT_KEYS)
        if (prj[k] !== undefined)
            o[k] = prj[k];
    /* GUID (guid.ts) je identita objektu, ne obsah: doplnění při migraci není změna projektu */
    if (Array.isArray(o.devices))
        o.devices = o.devices.map(noGuid);
    if (Array.isArray(o.io))
        o.io = o.io.map(noGuid);
    /* složka dat projektu (desktop) je místo na disku konkrétního PC, ne obsah: změna není změna projektu */
    if (o.meta && typeof o.meta === "object" && "dataDir" in o.meta) {
        const { dataDir: _d, ...rest } = o.meta;
        o.meta = rest;
    }
    return JSON.parse(canonicalJson(o));
}
const contentKey = (prj) => canonicalJson(revisionContent(prj));
const fromLetters = (s) => [...s.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
function toLetters(n) {
    let s = "";
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}
/** Další označení revize: po písmenech A → B … Z → AA, po číslech 01 → 02 (schéma podle poslední revize). */
export function nextRevisionId(prj, scheme) {
    const revs = prj.revisions || [];
    const last = revs[revs.length - 1];
    const sch = scheme ?? (last && /^\d+$/.test(last.id) ? "number" : "letter");
    const ids = new Set(revs.map(r => r.id.toUpperCase()));
    if (sch === "number") {
        const nums = revs.filter(r => /^\d+$/.test(r.id));
        const width = Math.max(2, ...nums.map(r => r.id.length));
        let n = nums.reduce((m, r) => Math.max(m, +r.id), 0) + 1;
        while (ids.has(String(n).padStart(width, "0")))
            n++;
        return String(n).padStart(width, "0");
    }
    const lets = revs.filter(r => /^[A-Za-z]+$/.test(r.id));
    let n = lets.reduce((m, r) => Math.max(m, fromLetters(r.id)), 0) + 1;
    while (ids.has(toLetters(n)))
        n++;
    return toLetters(n);
}
/**
 * Vydá revizi: zmrazí obsah projektu a stav schválení a připojí ji na konec `prj.revisions`.
 * Jméno je povinné. Revize nic neschvaluje — jen zaznamenává, co v tu chvíli platilo.
 */
export function createRevision(prj, by, note = "", opts = {}) {
    if (!by || !by.trim())
        throw new Error("revision: name of the responsible person is required");
    const id = (opts.id ?? nextRevisionId(prj, opts.scheme)).trim();
    if (!/^[A-Za-z0-9._-]{1,12}$/.test(id))
        throw new Error("revision: bad revision id " + id);
    const revs = prj.revisions || [];
    if (revs.some(r => r.id.toUpperCase() === id.toUpperCase()))
        throw new Error("revision: duplicate revision id " + id);
    const snapshot = contentKey(prj);
    const items = opts.items ?? approvalItems(prj, { cheap: true });
    const byKey = new Map(items.map(i => [i.key, i]));
    const approvalsAt = {};
    for (const [k, r] of Object.entries(prj.approvals || {})) {
        const it = byKey.get(k);
        const valid = !it ? false : it.unverified ? undefined : r.state === "approved" && r.hash === it.hash;
        approvalsAt[k] = { state: r.state, by: r.by, at: r.at, hash: r.hash, ...(r.note ? { note: r.note } : {}), ...(valid !== undefined ? { valid } : {}) };
    }
    const req = items.filter(i => i.required);
    const rec = {
        id, date: opts.at || new Date().toISOString(), by: by.trim(), note: note || "",
        hash: fnv1a64(snapshot), snapshot, approvalsAt,
        approved: { valid: req.filter(i => approvalsAt[i.key]?.valid === true).length, required: req.length },
    };
    prj.revisions = [...revs, rec];
    return rec;
}
/** Revize projektu od nejstarší; `classify` = doplnit klasifikaci změn proti předchozí revizi (levný výpočet). */
export function listRevisions(prj, opts = {}) {
    const revs = prj.revisions || [];
    return revs.map((r, i) => {
        const info = { id: r.id, date: r.date, by: r.by, note: r.note, hash: r.hash, ...(r.approved ? { approved: r.approved } : {}) };
        if (opts.classify) {
            if (!i)
                info.cls = null;
            else {
                const d = cachedRevDiff(prj, revs[i - 1], r);
                info.cls = d.cls ?? "none";
            }
        }
        return info;
    });
}
function findRevision(prj, id) {
    const r = (prj.revisions || []).find(x => x.id === id) || (prj.revisions || []).find(x => x.id.toUpperCase() === String(id).toUpperCase());
    if (!r)
        throw new Error("revision: unknown revision " + id);
    return r;
}
/** Poslední revize, nebo null. */
export function latestRevision(prj) {
    const revs = prj.revisions || [];
    return revs.length ? revs[revs.length - 1] : null;
}
/**
 * Projekt ve stavu revize `id`: obsah revize a schválení, jak platila při vydání
 * (`approvals` = `approvalsAt` bez příznaku platnosti). Nový objekt — nic nesdílí s `prj`.
 */
export function revisionSnapshot(prj, id) {
    return snapshotOf(findRevision(prj, id));
}
function snapshotOf(r) {
    /* poškozený zmrazený obsah (ručně upravený soubor) = prázdný projekt — dokumentace nesmí spadnout
       (test odolnosti 2026-10-08); platný JSON beze změny */
    let p;
    try {
        const v = JSON.parse(r.snapshot);
        p = v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.devices) && Array.isArray(v.io) && v.program && typeof v.program === "object"
            ? v : blankProject();
    }
    catch {
        p = blankProject();
    }
    p.approvals = {};
    for (const [k, a] of Object.entries(r.approvalsAt || {}))
        p.approvals[k] = { state: a.state, by: a.by, at: a.at, hash: a.hash, ...(a.note ? { note: a.note } : {}) };
    return p;
}
/** Změnil se obsah projektu od poslední revize? (Bez revize false.) */
export function modifiedSinceRevision(prj) {
    const last = latestRevision(prj);
    return !!last && contentKey(prj) !== last.snapshot;
}
/** Označení revize pro výkresy a hlavičky: „B“, rozpracovaný stav po revizi „B*“, bez revize "". */
export function revisionLabel(prj) {
    const last = latestRevision(prj);
    return last ? last.id + (modifiedSinceRevision(prj) ? "*" : "") : "";
}
/** Popisky klasifikace (klíče překladu). */
export const CHANGE_CLASSES = {
    cosmetic: N_("kosmetická"),
    functional: N_("funkční"),
    safety: N_("bezpečnostní"),
};
export function changeClassLabel(c) { return tr(CHANGE_CLASSES[c]); }
/** Popisky oblastí (klíče překladu). */
export const CHANGE_AREAS = {
    project: N_("Projekt"),
    platform: N_("Platformy"),
    device: N_("Zařízení"),
    io: N_("I/O"),
    seq: N_("Sekvence"),
    program: N_("Program"),
    interlock: N_("E-stop a blokování"),
    model: N_("Model stroje"),
    safety: N_("Bezpečnost"),
    bom: N_("Kusovník"),
    concept: N_("Koncept"),
};
const CLASS_RANK = { cosmetic: 0, functional: 1, safety: 2 };
const maxClass = (a, b) => (CLASS_RANK[a] >= CLASS_RANK[b] ? a : b);
const fin = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const same = (x, y) => canonicalJson(x) === canonicalJson(y);
const uniq = (xs) => [...new Set(xs)];
/** Kandidáti funkční změny: vždy i ověření simulací a plán oživení. */
const F = (...keys) => [...keys, "verify", "commission:*"];
/** Klíč položky zařízení — stejně jako approval.ts (duplicitní označení + „#id“). */
function devKey(prj, d) {
    return "dev:" + d.name + (prj.devices.filter(x => x.name === d.name).length > 1 ? "#" + d.id : "");
}
function devView(d) {
    const o = d.opt || {};
    const an = d.cls === "AnalogIn" || d.cls === "AnalogOut";
    return {
        name: d.name, cls: d.cls, desc: d.desc || "",
        opt: d.cls === "Motor" ? [o.fbk !== false ? "fbk" : "", o.fault ? "fault" : ""].filter(Boolean)
            : d.cls === "Ventil" ? [o.fbkOpen !== false ? "fbkOpen" : "", o.fbkClosed ? "fbkClosed" : ""].filter(Boolean) : null,
        unit: an ? d.unit || "" : null,
        range: an ? [fin(d.rmin), fin(d.rmax)] : null,
        limLo: d.cls === "AnalogIn" ? fin(d.limLo) : null,
        limHi: d.cls === "AnalogIn" ? fin(d.limHi) : null,
        setpoint: d.cls === "AnalogOut" ? fin(d.setpoint) : null,
        role: d.cls === "DO" ? d.role ?? null : null,
        /* pohony fáze 2a: volby, rozsah, žádaná, rampa, tolerance, záznamy (shodně s otiskem schvalování) */
        motion: isMotionClass(d.cls) ? motionContent(d) : null,
        /* servoosa: konfigurace s výchozími hodnotami (jen u osy — ostatní zařízení pole nemají) */
        ...(d.cls === "Axis" ? { axis: { unit: d.unit || "", ...axisCfgOf(d) } } : {}),
    };
}
const DEV_FIELDS = [
    ["name", "functional", F("io", "seq", "interlocks", "safety:*")],
    ["cls", "functional", F("io", "seq", "interlocks", "limits", "safety:*")],
    ["desc", "cosmetic", []],
    ["opt", "functional", F("io", "seq", "interlocks", "limits", "safety:*")],
    ["unit", "functional", F()],
    ["range", "functional", F()],
    ["limLo", "functional", F()],
    ["limHi", "functional", F()],
    ["setpoint", "functional", F()],
    ["role", "functional", F("safety:*")],
    ["motion", "functional", F("io", "seq")],
    ["axis", "functional", F("seq")],
];
const IO_FIELDS = [
    ["tag", "functional", F("io", "seq", "interlocks", "safety:*")],
    ["addr", "functional", F("io", "safety:*")],
    ["nc", "functional", F("io", "interlocks", "safety:*")],
    ["cmt", "cosmetic", []],
];
/** Pole funkce, která se porovnávají na návrhu (ne na úpravách uživatele) — úpravy se v nich neopakují. */
const SF_DERIVED_CFG = new Set(["off", "S", "F", "P", "plr", "stopCat", "cat", "inputs", "acts"]);
const SF_PARAMS = ["iso13855", "dop", "hop", "missionYears", "logic", "target"];
/** Párování zařízení: stejné id (a stejné označení nebo třída), zbytek podle označení. */
function matchDevices(x, y) {
    const xy = new Map(), usedY = new Set();
    const yById = new Map(y.devices.map(d => [d.id, d]));
    for (const dx of x.devices) {
        const dy = yById.get(dx.id);
        if (dy && !usedY.has(dy.id) && (dy.name === dx.name || dy.cls === dx.cls)) {
            xy.set(dx.id, dy.id);
            usedY.add(dy.id);
        }
    }
    for (const dx of x.devices) {
        if (xy.has(dx.id))
            continue;
        const dy = y.devices.find(d => !usedY.has(d.id) && d.name === dx.name);
        if (dy) {
            xy.set(dx.id, dy.id);
            usedY.add(dy.id);
        }
    }
    const pairs = [];
    for (const dx of x.devices)
        pairs.push([dx, xy.has(dx.id) ? yById.get(xy.get(dx.id)) : undefined]);
    for (const dy of y.devices)
        if (!usedY.has(dy.id))
            pairs.push([undefined, dy]);
    return { pairs, xy };
}
/** Zarovnání kroků sekvence (nejdelší společná podposloupnost podle zařízení a akce). */
function alignSeq(sx, sy, xy) {
    const kx = sx.map(s => s.act === "wait" ? "wait" : s.act + "@" + (xy.has(s.dev) ? xy.get(s.dev) : "x" + s.dev));
    const ky = sy.map(s => s.act === "wait" ? "wait" : s.act + "@" + s.dev);
    const n = kx.length, m = ky.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            L[i][j] = kx[i] === ky[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (kx[i] === ky[j])
            out.push([i++, j++]);
        else if (L[i + 1][j] >= L[i][j + 1])
            out.push([i++, undefined]);
        else
            out.push([undefined, j++]);
    }
    while (i < n)
        out.push([i++, undefined]);
    while (j < m)
        out.push([undefined, j++]);
    return out;
}
function devSide(prj, d) { return { ref: "dev:" + d.name, name: d.name, cls: d.cls, unit: d.unit || "" }; }
/** Surový rozdíl x → y (bez textů a dotčených položek). */
function rawDiff(x, y) {
    const out = [];
    const push = (r) => out.push(r);
    const { pairs, xy } = matchDevices(x, y);
    const ioOfDev = (p, id) => p.io.filter(e => e.devId === id);
    /* projekt */
    const mx = x.meta || { name: "", desc: "" }, my = y.meta || { name: "", desc: "" };
    /* název, popis, číslo projektu, zákazník a datum zahájení = metadata → kosmetická změna (nic dalšího neovlivní) */
    for (const f of ["name", "desc", "number", "customer", "startDate"])
        if ((mx[f] || "") !== (my[f] || ""))
            push({ area: "project", op: "change", field: "meta." + f, before: mx[f] || "", after: my[f] || "", a: { ref: "meta." + f }, b: { ref: "meta." + f }, floor: "cosmetic", cand: [], devs: [], tags: [] });
    if (fin(mx.takt) !== fin(my.takt))
        push({ area: "project", op: "change", field: "takt", before: fin(mx.takt), after: fin(my.takt), a: { ref: "meta.takt" }, b: { ref: "meta.takt" }, floor: "functional", cand: F("limits"), devs: [], tags: [] });
    /* platformy */
    const px = new Set(x.platforms || []), py = new Set(y.platforms || []);
    for (const k of [...(x.platforms || []), ...(y.platforms || [])].filter((k, i, a) => a.indexOf(k) === i)) {
        if (px.has(k) === py.has(k))
            continue;
        const s = { ref: "platform:" + k, name: PLAT[k]?.name || k };
        push({ area: "platform", op: py.has(k) ? "add" : "remove", ...(py.has(k) ? { b: s } : { a: s }), floor: "functional", cand: F("safety:*"), devs: [], tags: [] });
    }
    /* bezpečnostní návrh obou stavů (s modulem, nebo když projekt bezpečnostní data má) */
    const useSafety = safetyModuleRegistered() || !!x.safety || !!y.safety;
    let propX = null, propY = null;
    if (useSafety) {
        try {
            propX = proposeSafety(x);
        }
        catch {
            propX = null;
        }
        try {
            propY = proposeSafety(y);
        }
        catch {
            propY = null;
        }
    }
    const fx = propX ? propX.fns : [], fy = propY ? propY.fns : [];
    const enableNames = new Set([...enableInputs(x), ...enableInputs(y)].map(e => e.dev.name));
    /** Bezpečnostní položky, které se zařízení týkají: funkce, kde je vstupem nebo ve skupině výstupů; nebezpečí; program; E-stop / blokování. */
    const sfDev = (names) => {
        const out = ["safety:hazards", "safety:program"];
        if (names.some(n => enableNames.has(n)))
            out.push("safety:external");
        for (const p of [propX, propY])
            if (p)
                for (const f of p.fns) {
                    const outs = p.groups.filter(g => f.acts.includes(g.id)).flatMap(g => g.devs);
                    if (f.inputs.some(n => names.includes(n)) || outs.some(n => names.includes(n)))
                        out.push("safety:" + f.id, "safety:" + f.id + ":design");
                }
        return uniq(out);
    };
    const withSf = (cand, names) => cand.flatMap(c => (c === "safety:*" ? sfDev(names) : [c]));
    /* zařízení a jejich signály */
    for (const [dx, dy] of pairs) {
        if (!dx || !dy) {
            const d = (dx || dy), p = dx ? x : y;
            const s = devSide(p, d);
            push({ area: "device", op: dy ? "add" : "remove", ...(dy ? { b: s } : { a: s }), floor: "functional",
                cand: F(devKey(p, d), "io", "seq", "interlocks", "limits", ...sfDev([d.name])), devs: [d.name], tags: ioOfDev(p, d.id).map(e => e.tag) });
            continue;
        }
        const vx = devView(dx), vy = devView(dy);
        const keys = uniq([devKey(x, dx), devKey(y, dy)]);
        const names = uniq([dx.name, dy.name]);
        const tags = uniq([...ioOfDev(x, dx.id), ...ioOfDev(y, dy.id)].map(e => e.tag));
        for (const [f, floor, cand] of DEV_FIELDS) {
            if (same(vx[f], vy[f]))
                continue;
            push({ area: "device", op: "change", field: f, before: vx[f], after: vy[f], a: devSide(x, dx), b: devSide(y, dy), floor,
                cand: cand.length ? [...keys, ...withSf(cand, names)] : [], devs: names, tags: floor === "cosmetic" ? [] : tags });
        }
        const ix = new Map(ioOfDev(x, dx.id).map(e => [e.sig, e])), iy = new Map(ioOfDev(y, dy.id).map(e => [e.sig, e]));
        for (const sig of uniq([...iy.keys(), ...ix.keys()])) {
            const ex = ix.get(sig), ey = iy.get(sig);
            const side = (p, d, e) => ({ ref: "io:" + e.tag, tag: e.tag, name: d.name });
            if (!ex || !ey) {
                const e = (ex || ey);
                push({ area: "io", op: ey ? "add" : "remove", ...(ey ? { b: side(y, dy, e) } : { a: side(x, dx, e) }), floor: "functional",
                    cand: F("io", "seq", "interlocks", ...sfDev(names), ...keys), devs: [dy.name], tags: [e.tag] });
                continue;
            }
            const v = (e) => ({ tag: e.tag, addr: e.addr || "", nc: e.dir === "DI" ? !!e.nc : null, cmt: e.cmt || "" });
            const wx = v(ex), wy = v(ey);
            for (const [f, floor, cand] of IO_FIELDS) {
                if (same(wx[f], wy[f]))
                    continue;
                /* rozsah zkoušek: jen dotčený signál (ne všechny kroky zařízení) */
                push({ area: "io", op: "change", field: f, before: wx[f], after: wy[f], a: side(x, dx, ex), b: side(y, dy, ey), floor, cand: withSf(cand, names),
                    devs: [], tags: floor === "cosmetic" ? [] : uniq([ex.tag, ey.tag]) });
            }
        }
    }
    /* sekvence */
    const sx = x.program?.seq || [], sy = y.program?.seq || [];
    const stepSide = (p, s, i) => ({ ref: "seq:" + (i + 1), n: i, title: stepTitle(p, s) });
    for (const [i, j] of alignSeq(sx, sy, xy)) {
        if (i === undefined || j === undefined) {
            const k = (i ?? j), s = (i === undefined ? sy : sx)[k];
            /* rozsah zkoušek: kroky sekvence (stepA / stepB), ne celé zařízení */
            push({ area: "seq", op: i === undefined ? "add" : "remove", ...(i === undefined ? { b: stepSide(y, s, k) } : { a: stepSide(x, s, k) }), floor: "functional",
                cand: F("seq", "limits"), devs: [], tags: [] });
            continue;
        }
        const a = sx[i], b = sy[j];
        const dn = [];
        if (a.cond !== b.cond)
            push({ area: "seq", op: "change", field: "cond", before: a.cond, after: b.cond, a: stepSide(x, a, i), b: stepSide(y, b, j), floor: "functional", cand: F("seq", "limits"), devs: dn, tags: [] });
        if (fin(a.timeS) !== fin(b.timeS))
            push({ area: "seq", op: "change", field: "timeS", before: fin(a.timeS), after: fin(b.timeS), a: stepSide(x, a, i), b: stepSide(y, b, j), floor: "functional", cand: F("seq", "limits"), devs: dn, tags: [] });
        /* krok servoosy: cíl (poloha / pojmenovaná poloha / dráha / rychlost) a dynamika */
        const axp = (q) => [fin(q.pos) ?? null, q.posRef ?? null, fin(q.vel) ?? null, fin(q.acc) ?? null, fin(q.dec) ?? null];
        const axTxt = (q) => [q.posRef ?? fin(q.pos), fin(q.vel), fin(q.acc), fin(q.dec)].map(v => v ?? "—").join(" / ");
        if (JSON.stringify(axp(a)) !== JSON.stringify(axp(b)))
            push({ area: "seq", op: "change", field: "axisMove", before: axTxt(a), after: axTxt(b), a: stepSide(x, a, i), b: stepSide(y, b, j), floor: "functional", cand: F("seq", "limits"), devs: dn, tags: [] });
    }
    /* program: režimy, E-stop, blokování */
    if (!!x.program?.modes !== !!y.program?.modes)
        push({ area: "program", op: "change", field: "modes", before: !!x.program?.modes, after: !!y.program?.modes, a: { ref: "program.modes" }, b: { ref: "program.modes" }, floor: "functional", cand: F("seq"), devs: [], tags: [] });
    const ex = devById(x, x.program?.estop ?? ""), ey = devById(y, y.program?.estop ?? "");
    const idX = ex ? (xy.has(ex.id) ? String(xy.get(ex.id)) : "x" + ex.id) : "", idY = ey ? String(ey.id) : "";
    if (idX !== idY)
        push({ area: "program", op: "change", field: "estop", before: ex ? ex.name : null, after: ey ? ey.name : null, a: { ref: "program.estop" }, b: { ref: "program.estop" }, floor: "functional",
            cand: F("interlocks", "safety:*"), devs: [ex?.name, ey?.name].filter(Boolean), tags: [] });
    const lx = interlockDevs(x), ly = interlockDevs(y);
    const lxIds = new Set(lx.map(d => (xy.has(d.id) ? String(xy.get(d.id)) : "x" + d.id))), lyIds = new Set(ly.map(d => String(d.id)));
    for (const d of lx)
        if (!lyIds.has(xy.has(d.id) ? String(xy.get(d.id)) : "x" + d.id))
            push({ area: "interlock", op: "remove", a: { ref: "interlock:" + d.name, name: d.name }, floor: "functional", cand: F("interlocks", "safety:*"), devs: [d.name], tags: ioOfDev(x, d.id).map(e => e.tag) });
    for (const d of ly)
        if (!lxIds.has(String(d.id)))
            push({ area: "interlock", op: "add", b: { ref: "interlock:" + d.name, name: d.name }, floor: "functional", cand: F("interlocks", "safety:*"), devs: [d.name], tags: ioOfDev(y, d.id).map(e => e.tag) });
    /* model stroje */
    for (const f of ["motorDelay", "valveTravel"]) {
        const a = fin(x.sim?.[f]), b = fin(y.sim?.[f]);
        if (a !== b)
            push({ area: "model", op: "change", field: f, before: a, after: b, a: { ref: "sim." + f }, b: { ref: "sim." + f }, floor: "functional", cand: F("limits"), devs: [], tags: [] });
    }
    /* bezpečnost: parametry, úpravy funkcí a návrh (PLr, architektura) */
    const cx = x.safety || {}, cy = y.safety || {};
    for (const f of SF_PARAMS) {
        const a = cx[f] ?? null, b = cy[f] ?? null;
        if (!same(a, b))
            push({ area: "safety", op: "change", field: f, before: a, after: b, a: { ref: "safety." + f }, b: { ref: "safety." + f }, floor: "safety", cand: ["safety:*", "commission:*"], devs: [], tags: [] });
    }
    const sfOf = (fns, ref) => fns.find(f => f.ref === ref);
    const sfSide = (f, ref) => ({ ref: "safety:" + ref, sf: f ? f.id : ref, title: f ? f.title : ref });
    const sfCand = (ref) => {
        const ids = uniq([sfOf(fx, ref)?.id, sfOf(fy, ref)?.id].filter(Boolean));
        return [...ids.flatMap(id => ["safety:" + id, "safety:" + id + ":design"]), "safety:hazards", "safety:program", "commission:*"];
    };
    const addX = new Map((cx.add || []).map(a => [a.ref, a])), addY = new Map((cy.add || []).map(a => [a.ref, a]));
    const fnX = cx.fn || {}, fnY = cy.fn || {};
    for (const ref of uniq([...Object.keys(fnY), ...Object.keys(fnX)])) {
        const a = (fnX[ref] || {}), b = (fnY[ref] || {});
        for (const f of uniq([...Object.keys(b), ...Object.keys(a)])) {
            if (SF_DERIVED_CFG.has(f) && useSafety)
                continue;
            if (same(a[f] ?? null, b[f] ?? null))
                continue;
            push({ area: "safety", op: "change", field: "cfg." + f, before: a[f] ?? null, after: b[f] ?? null, a: sfSide(sfOf(fx, ref), ref), b: sfSide(sfOf(fy, ref), ref), floor: "safety", cand: sfCand(ref), devs: [], tags: [] });
        }
    }
    /* funkce doplněné uživatelem bez bezpečnostního modulu (s modulem je pokryje porovnání návrhu) */
    if (!useSafety)
        for (const ref of uniq([...addY.keys(), ...addX.keys()])) {
            if (addX.has(ref) && addY.has(ref) && same(addX.get(ref), addY.get(ref)))
                continue;
            const op = !addX.has(ref) ? "add" : !addY.has(ref) ? "remove" : "change";
            push({ area: "safety", op, ...(op === "change" ? { field: "cfg.add" } : {}), ...(op !== "remove" ? { b: sfSide(undefined, ref) } : {}), ...(op !== "add" ? { a: sfSide(undefined, ref) } : {}), floor: "safety", cand: sfCand(ref), devs: [], tags: [] });
        }
    if (useSafety) {
        const view = (f) => ({
            off: f.off, plr: f.risk.plr, sfp: f.risk.S + "/" + f.risk.F + "/" + f.risk.P, stopCat: f.stopCat,
            cat: f.design?.cat ?? null, channels: f.design ? f.design.channels : null, edm: f.design ? f.design.edm : null, pl: f.design?.pl ?? null,
            distS: f.distance ? f.distance.S : null, inputs: [...f.inputs], acts: [...f.acts],
        });
        for (const ref of uniq([...fy.map(f => f.ref), ...fx.map(f => f.ref)])) {
            const a = sfOf(fx, ref), b = sfOf(fy, ref);
            const devs = uniq([...(a?.inputs || []), ...(b?.inputs || [])]);
            if (!a || !b) {
                push({ area: "safety", op: b ? "add" : "remove", ...(b ? { b: sfSide(b, ref) } : { a: sfSide(a, ref) }), floor: "safety", cand: sfCand(ref), devs, tags: [] });
                continue;
            }
            const va = view(a), vb = view(b);
            for (const f of Object.keys(vb)) {
                if (same(va[f], vb[f]))
                    continue;
                push({ area: "safety", op: "change", field: f, before: va[f], after: vb[f], a: sfSide(a, ref), b: sfSide(b, ref), floor: "safety", cand: sfCand(ref), devs, tags: [] });
            }
        }
    }
    /* kusovník (volby uživatele) */
    const bx = x.bom || {}, by = y.bom || {};
    if ((bx.plat ?? null) !== (by.plat ?? null))
        push({ area: "bom", op: "change", field: "plat", before: bx.plat ?? null, after: by.plat ?? null, a: { ref: "bom.plat" }, b: { ref: "bom.plat" }, floor: "cosmetic", cand: [], devs: [], tags: [] });
    for (const c of uniq([...Object.keys(by.brand || {}), ...Object.keys(bx.brand || {})])) {
        const a = bx.brand?.[c] ?? null, b = by.brand?.[c] ?? null;
        if (a !== b)
            push({ area: "bom", op: "change", field: "brand." + c, before: a, after: b, a: { ref: "bom.brand." + c }, b: { ref: "bom.brand." + c }, floor: "cosmetic", cand: [], devs: [], tags: [] });
    }
    for (const id of uniq([...Object.keys(by.lines || {}), ...Object.keys(bx.lines || {})])) {
        const a = (bx.lines?.[id] || {}), b = (by.lines?.[id] || {});
        for (const f of uniq([...Object.keys(b), ...Object.keys(a)])) {
            if (same(a[f] ?? null, b[f] ?? null))
                continue;
            push({ area: "bom", op: "change", field: "line." + id + "." + f, before: a[f] ?? null, after: b[f] ?? null, a: { ref: "bom.line." + id }, b: { ref: "bom.line." + id }, floor: "cosmetic", cand: [], devs: [], tags: [] });
        }
    }
    /* firemní knihovna (šablony bloků mění generovaný kód) */
    const libX = x.library ?? null, libY = y.library ?? null;
    /* čitelně: název a verze knihovny (při změně obsahu téže verze „upraveno“) */
    const libTxt = (l, other) => {
        if (!l)
            return null;
        const o = l;
        const t = [o.name || tr("knihovna"), o.version ? "v" + o.version : ""].filter(Boolean).join(" ");
        const p = (other || {});
        return other && p.name === o.name && p.version === o.version && !same(l, other) ? t + " (" + tr("upraveno") + ")" : t;
    };
    if (!same(libX, libY))
        push({ area: "project", op: "change", field: "library", before: libTxt(libX, null), after: libTxt(libY, libX), a: { ref: "library" }, b: { ref: "library" }, floor: "functional", cand: F(), devs: [], tags: [] });
    /* koncept */
    if (!same(x.concept ?? null, y.concept ?? null))
        push({ area: "concept", op: "change", field: "concept", before: x.concept ? x.concept.nazev || "✓" : null, after: y.concept ? y.concept.nazev || "✓" : null, a: { ref: "concept" }, b: { ref: "concept" }, floor: "cosmetic", cand: [], devs: [], tags: [] });
    return out;
}
const invert = (r) => ({
    ...r, op: r.op === "add" ? "remove" : r.op === "remove" ? "add" : "change",
    before: r.after, after: r.before, a: r.b, b: r.a,
});
/* ------------------------------------------------------------ dotčené položky schvalování */
/** Vstup ověření simulací bez textů (popisy a komentáře nemění výsledek ověření, jen jeho texty). */
function simKey(p) {
    const v = designView(p);
    return canonicalJson({ ...v, devices: v.devices.map(d => ({ ...d, desc: "" })), io: v.io.map(e => ({ ...e, cmt: "" })) });
}
/**
 * Položky ke schválení, které změna a → b dotkne: otisk se liší, nebo položka přibyla / zanikla.
 * Levně (bez ověření simulací) jsou položky čekající na ověření v `maybe`, pokud se změnil vstup
 * simulace; plán oživení se porovná i bez ověření (fáze bez simulace). Návrhy ladění se nepočítají.
 */
export function affectedApprovals(a, b, opts = {}) {
    const comm = b.commissioning;
    const a2 = { ...a, commissioning: comm }, b2 = { ...b, commissioning: comm };
    const items = (p, given) => (given ?? approvalItems(p, { cheap: !opts.exact })).filter(i => i.group !== "tuning");
    const ia = items(a2, opts.itemsA), ib = items(b2, opts.itemsB);
    const ma = new Map(ia.map(i => [i.key, i])), mb = new Map(ib.map(i => [i.key, i]));
    const titles = {};
    for (const i of [...ia, ...ib])
        titles[i.key] = i.title;
    let simChanged = null;
    const simDiff = () => (simChanged ??= simKey(a2) !== simKey(b2));
    let planChanged = null;
    const planDiff = () => {
        if (planChanged === null) {
            const h = (p) => canonicalJson(commissioningPlan(p, { cheap: true }).filter(s => s.phase !== 8)
                .map(s => ({ id: s.id, phase: s.phase, signals: s.signals, dev: s.devId !== undefined ? (devById(p, s.devId) || { name: "" }).name : undefined, data: s.id === "seq:dry" ? null : s.data })));
            planChanged = h(a2) !== h(b2);
        }
        return planChanged;
    };
    const affects = [], maybe = [];
    for (const k of uniq([...ma.keys(), ...mb.keys()])) {
        const x = ma.get(k), y = mb.get(k);
        if (!x || !y) {
            affects.push(k);
            continue;
        }
        if (!x.unverified && !y.unverified) {
            if (x.hash !== y.hash)
                affects.push(k);
            continue;
        }
        if (k.startsWith("commission:") && planDiff())
            affects.push(k);
        else if (simDiff())
            maybe.push(k);
    }
    return { affects, maybe, titles, itemsA: ia, itemsB: ib };
}
/* ------------------------------------------------------------ popis změn */
const FIELD = {
    name: N_("označení"), cls: N_("třída"), desc: N_("popis"), opt: N_("volby"), unit: N_("jednotka"), range: N_("rozsah"),
    limLo: N_("dolní mez"), limHi: N_("horní mez"), setpoint: N_("žádaná hodnota"), role: N_("vazba na stav stroje"),
    tag: N_("tag"), addr: N_("adresa"), nc: N_("rozpínací kontakt (NC)"), cmt: N_("komentář"),
    cond: N_("přechod"), timeS: N_("čas [s]"), axis: N_("konfigurace osy"), axisMove: N_("cíl / rychlost / zrychlení / zpomalení osy"),
    modes: N_("režimy AUTO / ručně"), estop: N_("E-stop"),
    "meta.name": N_("název projektu"), "meta.desc": N_("popis projektu"), takt: N_("takt [s]"),
    "meta.number": N_("číslo projektu"), "meta.customer": N_("zákazník"), "meta.startDate": N_("datum zahájení projektu"),
    motorDelay: N_("doba rozběhu motoru [s]"), valveTravel: N_("doba přestavení ventilu [s]"),
    sfp: N_("parametry rizika S/F/P"), stopCat: N_("kategorie zastavení"), cat: N_("kategorie"), channels: N_("počet kanálů"),
    pl: N_("dosažené PL"), distS: N_("bezpečná vzdálenost S [mm]"), off: N_("vyřazeno z návrhu"), inputs: N_("vstupní zařízení"), acts: N_("výstupy"),
    dop: N_("provozní dny za rok"), hop: N_("provozní hodiny za den"), missionYears: N_("doba mise [roky]"), logic: N_("bezpečnostní logika"), target: N_("cíl bezpečnostního programu"),
    plat: N_("platforma kusovníku"), concept: N_("zvolený koncept"), library: N_("firemní knihovna"),
};
/** Značky, které se nepřekládají. */
const FIELD_RAW = { plr: "PLr", edm: "EDM", iso13855: "ISO 13855" };
const COND = { fbk: N_("zpětné hlášení"), time: N_("čas") };
function fieldLabel(f) {
    if (FIELD_RAW[f])
        return FIELD_RAW[f];
    if (FIELD[f])
        return tr(FIELD[f]);
    if (f.startsWith("brand."))
        return tr("značka ({cat})", { cat: f.slice(6) });
    if (f.startsWith("line.")) {
        const k = f.lastIndexOf(".");
        return tr("řádek {id}: {field}", { id: f.slice(5, k), field: f.slice(k + 1) });
    }
    if (f.startsWith("cfg."))
        return tr("parametr {name}", { name: f.slice(4) });
    return f;
}
function fmt(field, v, side) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length))
        return "—";
    if (typeof v === "boolean")
        return v ? tr("ano") : tr("ne");
    if (field === "opt" && Array.isArray(v)) {
        const opts = side?.cls ? CLS[side.cls].opts : {};
        return v.map(k => (opts[String(k)] ? tr(opts[String(k)]) : String(k))).join(", ");
    }
    if (field === "range" && Array.isArray(v))
        return (v[0] ?? "—") + "–" + (v[1] ?? "—") + (side?.unit ? " " + side.unit : "");
    if (field === "role" && typeof v === "string" && DO_ROLES[v])
        return tr(DO_ROLES[v]);
    if (field === "cond" && typeof v === "string" && COND[v])
        return tr(COND[v]);
    if (Array.isArray(v))
        return v.map(x => fmt("", x)).join(", ");
    if (typeof v === "number")
        return String(v);
    if (typeof v === "string")
        return v.length > 60 ? v.slice(0, 59) + "…" : v;
    const s = canonicalJson(v);
    return s.length > 60 ? s.slice(0, 59) + "…" : s;
}
function whatOf(r) {
    const s = (r.b ?? r.a);
    switch (r.area) {
        case "device": return tr("Zařízení {dev}", { dev: s.name });
        case "io": return tr("Signál {tag}", { tag: s.tag });
        case "seq": return tr("Krok {n} ({title})", { n: (s.n ?? 0) + 1, title: s.title });
        case "program": return tr("Program");
        case "interlock": return tr("Blokování {dev}", { dev: s.name });
        case "project": return tr("Projekt");
        case "platform": return tr("Platforma {name}", { name: s.name });
        case "model": return tr("Model stroje pro simulaci");
        case "safety": return s.sf ? tr("Bezpečnostní funkce {sf} ({title})", { sf: s.sf, title: s.title }) : tr("Bezpečnostní parametry");
        case "bom": return tr("Kusovník");
        case "concept": return tr("Koncept řešení");
    }
}
function textOf(r, what) {
    if (r.op === "add")
        return tr("{what}: přidáno", { what });
    if (r.op === "remove")
        return tr("{what}: odebráno", { what });
    return tr("{what}: {field} {from} → {to}", { what, field: fieldLabel(r.field || ""), from: fmt(r.field || "", r.before, r.a), to: fmt(r.field || "", r.after, r.b) });
}
/* ------------------------------------------------------------ diffProjects */
/**
 * Strukturovaný rozdíl stavů `a` (starší) → `b` (novější). Výsledek je symetrický:
 * `diffProjects(b, a)` má tytéž změny s prohozeným přidáno / odebráno a před / po,
 * tytéž dotčené položky a klasifikaci (výpočet běží vždy v jednom kanonickém pořadí).
 */
export function diffProjects(a, b, opts = {}) {
    const ka = contentKey(a), kb = contentKey(b);
    const raws = ka === kb ? [] : ka < kb ? rawDiff(a, b) : rawDiff(b, a).map(invert);
    const aff = affectedApprovals(a, b, opts);
    const all = new Set([...aff.affects, ...aff.maybe]);
    const expand = (cand, pool) => {
        const out = new Set();
        for (const c of cand) {
            if (c.endsWith(":*")) {
                const pre = c.slice(0, -1);
                for (const k of pool)
                    if (k.startsWith(pre))
                        out.add(k);
            }
            else if (pool.includes(c))
                out.add(c);
        }
        return [...out];
    };
    const attributed = new Set();
    const changes = raws.map(r => {
        const affects = expand(r.cand, aff.affects), maybe = expand(r.cand, aff.maybe);
        for (const k of [...affects, ...maybe])
            attributed.add(k);
        let cls = r.floor;
        const keys = [...affects, ...maybe];
        if (keys.some(k => k.startsWith("safety:")))
            cls = maxClass(cls, "safety");
        else if (keys.length)
            cls = maxClass(cls, "functional");
        const what = whatOf(r);
        const s = (r.b ?? r.a);
        return {
            area: r.area, op: r.op, ref: s.ref, ...(r.field !== undefined ? { field: r.field } : {}),
            ...(r.op === "change" ? { before: r.before, after: r.after } : {}),
            cls, affects, maybe, what, text: textOf(r, what), devs: r.devs, tags: r.tags,
            ...(r.area === "seq" && r.a?.n !== undefined ? { stepA: r.a.n } : {}),
            ...(r.area === "seq" && r.b?.n !== undefined ? { stepB: r.b.n } : {}),
            ...(r.area === "safety" && s.ref.startsWith("safety:") ? { sf: s.ref.slice(7) } : {}),
        };
    });
    const counts = { cosmetic: 0, functional: 0, safety: 0 };
    let cls = null;
    for (const c of changes) {
        counts[c.cls]++;
        cls = cls ? maxClass(cls, c.cls) : c.cls;
    }
    const approvals = opts.approvals ?? a.approvals ?? {};
    const ma = new Map(aff.itemsA.map(i => [i.key, i]));
    const invalidates = [...all].filter(k => {
        const rec = approvals[k], it = ma.get(k);
        return !!rec && rec.state === "approved" && !!it && (it.unverified || rec.hash === it.hash);
    });
    /* odvozené položky bez konkrétní změny: klasifikace celku podle nich */
    const unattributed = [...all].filter(k => !attributed.has(k));
    if (unattributed.length && changes.length) {
        const c = unattributed.some(k => k.startsWith("safety:")) ? "safety" : "functional";
        cls = cls ? maxClass(cls, c) : c;
    }
    const added = aff.itemsB.filter(i => i.required && !ma.has(i.key)).map(i => i.key);
    return {
        changes, cls, counts, affects: aff.affects, maybe: aff.maybe, invalidates, unattributed, added, titles: aff.titles,
        empty: !changes.length, exact: !!opts.exact,
    };
}
/** Rozdíl mezi dvěma revizemi; `to` = "current" (výchozí) porovná s aktuálním stavem projektu. */
export function diffRevisions(prj, from, to = "current", opts = {}) {
    const a = snapshotOf(findRevision(prj, from));
    const b = to === "current" ? prj : snapshotOf(findRevision(prj, to));
    return diffProjects(a, b, { ...opts, itemsB: to === "current" ? opts.itemsB : undefined });
}
/** Změny od revize `id` (výchozí poslední) do aktuálního stavu; bez revize null. */
export function changesSinceRevision(prj, id, opts = {}) {
    const r = id ? findRevision(prj, id) : latestRevision(prj);
    return r ? diffRevisions(prj, r.id, "current", opts) : null;
}
/* Klasifikace v tabulce revizí: rozdíl dvou zmrazených revizí se nemění — cache podle otisků. */
const revDiffMemo = new Map();
function cachedRevDiff(prj, a, b) {
    const k = a.hash + ":" + b.hash + ":" + (safetyModuleRegistered() ? 1 : 0) + ":" + tr("kosmetická");
    const hit = revDiffMemo.get(k);
    if (hit)
        return hit;
    const d = diffProjects(snapshotOf(a), snapshotOf(b));
    revDiffMemo.set(k, d);
    if (revDiffMemo.size > 32)
        revDiffMemo.delete(revDiffMemo.keys().next().value);
    void prj;
    return d;
}
/**
 * Doporučený rozsah opakovaných zkoušek po změně (`diff` = rozdíl předchozí → `prj`):
 * kosmetická změna → bez zkoušek; funkční → dotčené body FAT, kroky oživení (smyčky dotčených
 * signálů, pohony, analogy, E-stop a blokování, kroky sekvence, poruchové stavy, takt), znovu
 * ověření simulací; bezpečnostní → navíc validace dotčených bezpečnostních funkcí (fáze 10).
 */
export function retestScope(prj, diff, opts = {}) {
    const ch = diff.changes.filter(c => c.cls !== "cosmetic");
    const scope = { cls: diff.cls, fat: [], commissioning: [], safety: [], approvals: [], notes: [] };
    scope.approvals = uniq([...diff.invalidates, ...diff.added]);
    if (diff.cls === null) {
        scope.notes.push(tr("Beze změny — opakované zkoušky nejsou potřeba."));
        return scope;
    }
    if (!ch.length && diff.cls === "cosmetic") {
        scope.notes.push(tr("Jen kosmetické změny (popisy, komentáře, kusovník) — opakované zkoušky nejsou potřeba; zkontroluj dokumentaci."));
        return scope;
    }
    const devs = new Set(ch.flatMap(c => c.devs));
    const tags = new Set(ch.flatMap(c => c.tags));
    const steps = new Set(ch.filter(c => c.area === "seq" && c.stepB !== undefined).map(c => c.stepB));
    const seqChanged = ch.some(c => c.area === "seq" || (c.area === "program" && c.field === "modes"));
    const timing = ch.some(c => (c.area === "seq" && (c.field === "timeS" || c.op !== "change")) || (c.area === "project" && c.field === "takt"));
    const model = ch.some(c => c.area === "model");
    const locks = ch.some(c => c.area === "interlock" || (c.area === "program" && c.field === "estop"));
    const plats = ch.some(c => c.area === "platform");
    const sfRefs = new Set(ch.filter(c => c.sf && !c.sf.includes(".")).map(c => c.sf));
    const safetyCls = diff.cls === "safety";
    const safetyParams = ch.some(c => c.area === "safety" && !c.sf);
    /* body FAT (sekce protokolu 05) */
    const secIo = tr("1. Kontrola I/O smyček (loop check)"), secDev = tr("2. Funkční testy zařízení"), secSeq = tr("3. Test automatické sekvence");
    for (const e of prj.io)
        if (tags.has(e.tag))
            scope.fat.push({ section: secIo, ref: "io:" + e.tag, text: e.tag + " (" + (e.addr || "—") + ")" });
    for (const d of prj.devices)
        if (devs.has(d.name) && (d.cls === "Motor" || d.cls === "Ventil" || d.cls === "AnalogIn" || d.cls === "AnalogOut"))
            scope.fat.push({ section: secDev, ref: "dev:" + d.name, text: d.name + (d.desc ? " — " + d.desc : "") });
    const seq = prj.program.seq;
    for (const i of [...steps].sort((x, y) => x - y))
        if (seq[i])
            scope.fat.push({ section: secSeq, ref: "seq:" + (i + 1), text: tr("Krok {n} ({title})", { n: i + 1, title: stepTitle(prj, seq[i]) }) });
    if (seq.length && (seqChanged || locks || timing))
        scope.fat.push({ section: secSeq, ref: "seq:all", text: tr("Celý cyklus včetně přerušení centrálního uvolnění, poruchy v kroku a kvitace") });
    /* kroky oživení */
    const plan = opts.plan ?? commissioningPlan(prj, { cheap: !opts.exact });
    const devName = (id) => (id !== undefined ? (devById(prj, id) || { name: "" }).name : "");
    const pick = (s) => {
        const n = devName(s.devId);
        if (s.phase >= 2 && s.phase <= 8 && n && devs.has(n))
            return true;
        if (s.phase >= 2 && s.phase <= 8 && s.signals.some(t => tags.has(t)))
            return true;
        if (s.phase === 7) {
            const m = /^seq:(\d+):/.exec(s.id);
            if (m && steps.has(+m[1] - 1))
                return true;
            if (seqChanged && /^seq:(dry|repeat)$/.test(s.id))
                return true;
        }
        if (s.phase === 8 && s.data && typeof s.data === "object" && steps.has(s.data.step ?? -1))
            return true;
        if (locks && (s.phase === 5 || /^flt:(estop|lock-)/.test(s.id)))
            return true;
        if (timing && /^par:(takt|watchdog)$/.test(s.id))
            return true;
        if (model && s.id === "par:model")
            return true;
        if (plats && s.id === "p1:plc")
            return true;
        if (s.id === "par:backup")
            return true;
        if (s.phase === 10) {
            if ([...sfRefs].some(r => s.id.startsWith("sf:" + r + ":")))
                return true;
            if ((sfRefs.size || safetyParams) && (s.id === "sf:config" || s.id === "sf:report"))
                return true;
            if (safetyCls && s.id === "safety:validation")
                return true;
        }
        return false;
    };
    scope.commissioning = plan.filter(pick);
    if (scope.commissioning.some(s => s.phase === 8)) {
        const r = plan.find(s => s.id === "flt:recover");
        if (r && !scope.commissioning.includes(r))
            scope.commissioning.push(r);
    }
    scope.commissioning.sort((x, y) => x.phase - y.phase || plan.indexOf(x) - plan.indexOf(y));
    /* validace bezpečnostních funkcí */
    if (sfRefs.size) {
        let fns = [];
        try {
            fns = proposeSafety(prj).fns;
        }
        catch {
            fns = [];
        }
        for (const ref of sfRefs) {
            const f = fns.find(x => x.ref === ref);
            const c = ch.find(x => x.sf === ref);
            scope.safety.push(f && !f.off
                ? { sf: f.id, ref, title: f.title, steps: plan.filter(s => s.id.startsWith("sf:" + ref + ":")).map(s => s.id) }
                : { sf: f ? f.id : ref, ref, title: f ? f.title : c.what, steps: [], removed: true });
        }
    }
    scope.notes.push(tr("Funkční změna: zopakuj dotčené body FAT a kroky oživení, znovu spusť ověření simulací a nech dotčené položky znovu schválit."));
    if (safetyCls)
        scope.notes.push(tr("Bezpečnostní změna: dotčené bezpečnostní funkce je potřeba znovu validovat (ISO 13849-2) a aktualizovat validační zprávu; validaci provádí a podepisuje člověk."));
    return scope;
}
/* ================================================================ dokumenty */
/** Zpráva o změnách. */
export const CHANGES_FILE = "17_zmeny.md";
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
/** Tabulka revizí (Markdown): označení, datum, kdo, popis, klasifikace proti předchozí, schválení. */
export function revisionTableMd(prj) {
    const revs = listRevisions(prj, { classify: true });
    if (!revs.length)
        return tr("Projekt zatím nemá žádnou revizi.");
    const L = [tr("| Rev | Datum | Vydal | Popis změny | Klasifikace | Schváleno |"), "|---|---|---|---|---|---|"];
    for (const r of revs) {
        const cls = r.cls === null ? tr("první vydání") : r.cls === "none" ? tr("beze změny") : r.cls ? changeClassLabel(r.cls) : "";
        L.push("| **" + cell(r.id) + "** | " + formatDate(r.date) + " | " + cell(r.by) + " | " + cell(r.note || "—") + " | " + cls + " | "
            + (r.approved ? r.approved.valid + " / " + r.approved.required : "—") + " |");
    }
    if (modifiedSinceRevision(prj))
        L.push("| " + revisionLabel(prj) + " | " + today() + " | — | " + tr("rozpracováno — obsah se od poslední revize změnil") + " | | |");
    return L.join("\n");
}
/** Řádek revize pod nadpis dokumentu (citace Markdownu); bez revize "". */
export function revisionHeaderMd(prj) {
    const last = latestRevision(prj);
    if (!last)
        return "";
    return "> " + tr("**Revize {rev}** z {date}, vydal {by}", { rev: last.id, date: formatDate(last.date), by: last.by })
        + (modifiedSinceRevision(prj) ? " — " + tr("rozpracováno: obsah se od revize změnil (viz {file})", { file: CHANGES_FILE }) : "");
}
/**
 * `17_zmeny.md`: tabulka revizí, porovnávané stavy, souhrn klasifikace, tabulka změn s dotčenými
 * položkami schvalování, zneplatněná schválení a doporučený rozsah opakovaných zkoušek.
 * Výchozí porovnání: poslední revize → aktuální stav; je-li stav beze změny, předchozí → poslední revize.
 */
export function changesMd(prj, opts = {}) {
    const revs = prj.revisions || [];
    const L = ["# " + tr("Revize a změny"), "", tr("**Projekt:** {name} · generováno {date} nástrojem PLCdesk", { name: prj.meta.name || "—", date: today() }), ""];
    L.push("## " + tr("1. Revize projektu"), "", revisionTableMd(prj), "");
    if (!revs.length) {
        L.push(tr("Revize zmrazí stav návrhu a schválení. Po vydání první revize tu bude přehled změn a doporučený rozsah opakovaných zkoušek."));
        return L.join("\n");
    }
    const last = revs[revs.length - 1];
    let to = opts.to ?? (modifiedSinceRevision(prj) || revs.length < 2 ? "current" : last.id);
    let from = opts.from ?? (to === "current" ? last.id : revs[Math.max(0, revs.findIndex(r => r.id === to) - 1)].id);
    if (from === to) {
        to = "current";
        from = last.id;
    }
    const label = (id) => (id === "current" ? tr("aktuální stav (neuvolněno)") : tr("revize {rev}", { rev: id }));
    L.push(tr("**Porovnání:** {from} → {to}", { from: label(from), to: label(to) }), "");
    const b = to === "current" ? prj : snapshotOf(findRevision(prj, to));
    const diff = diffRevisions(prj, from, to, { ...opts, itemsB: to === "current" ? opts.items ?? opts.itemsB : undefined });
    const scope = retestScope(b, diff, { exact: opts.exact });
    L.push("## " + tr("2. Souhrn"), "");
    if (diff.empty)
        L.push(tr("Beze změny."), "");
    else {
        L.push(tr("**Klasifikace:** {cls} — {n} změn ({c} kosmetických, {f} funkčních, {s} bezpečnostních)", {
            cls: changeClassLabel(diff.cls), n: diff.changes.length, c: diff.counts.cosmetic, f: diff.counts.functional, s: diff.counts.safety,
        }), "");
        L.push(tr("Kosmetická změna (popis, komentář, kusovník) schválení nezneplatní. Funkční změna mění logiku, signály nebo časy programu. Bezpečnostní změna se dotýká bezpečnostních funkcí nebo jejich vstupů a výstupů."), "");
    }
    if (!diff.empty) {
        L.push("## " + tr("3. Změny"), "", tr("| # | Oblast | Změna | Klasifikace | Dotčená schválení |"), "|---|---|---|---|---|");
        diff.changes.forEach((c, i) => {
            const keys = [...c.affects.map(k => "`" + k + "`"), ...c.maybe.map(k => "`" + k + "`?")].join(", ");
            L.push("| " + (i + 1) + " | " + tr(CHANGE_AREAS[c.area]) + " | " + cell(c.text) + " | " + changeClassLabel(c.cls) + " | " + (keys || "—") + " |");
        });
        if (diff.maybe.length)
            L.push("", tr("`?` = položka závisí na ověření simulací, které se pro tuto zprávu nespouštělo — změní se, pokud změna ovlivní výsledek ověření."));
        if (diff.unattributed.length)
            L.push("", tr("Odvozené změny bez přímé vazby na položku návrhu: {list}.", { list: diff.unattributed.map(k => "`" + k + "`").join(", ") }));
        L.push("");
        L.push("## " + tr("4. Zneplatněná schválení"), "");
        if (diff.invalidates.length) {
            const appr = diffApprovals(prj, from);
            for (const k of diff.invalidates) {
                const r = appr[k];
                L.push("- " + cell(diff.titles[k] || k) + " (`" + k + "`)" + (r ? " — " + tr("schválil {by}, {date}", { by: r.by, date: formatDate(r.at) }) : ""));
            }
            L.push("", tr("Tyto položky je potřeba znovu posoudit a schválit (viz {file}).", { file: "11_schvaleni.md" }));
        }
        else
            L.push(tr("Změna nezneplatňuje žádné platné schválení."));
        L.push("");
        L.push("## " + tr("5. Rozsah opakovaných zkoušek"), "");
        for (const n of scope.notes)
            L.push("- " + n);
        L.push("");
        if (scope.fat.length) {
            L.push("### " + tr("Body FAT"), "");
            let sec = "";
            for (const f of scope.fat) {
                if (f.section !== sec) {
                    sec = f.section;
                    L.push("**" + sec + "**");
                }
                L.push("- " + cell(f.text) + " ☐");
            }
            L.push("");
        }
        if (scope.commissioning.length) {
            L.push("### " + tr("Kroky oživení"), "", tr("| ID | Fáze | Krok |"), "|---|---|---|");
            for (const s of scope.commissioning)
                L.push("| `" + s.id + "` | " + s.phase + ". " + tr(COMMISSION_PHASES[s.phase] || "") + " | " + cell(s.title) + " |");
            L.push("");
        }
        if (scope.safety.length) {
            L.push("### " + tr("Validace bezpečnostních funkcí"), "");
            for (const s of scope.safety)
                L.push("- **" + cell(s.sf) + "** " + cell(s.title) + " — "
                    + (s.removed ? tr("funkce vyřazena nebo zrušena: aktualizuj posouzení rizik a validační zprávu") : s.steps.length ? s.steps.map(x => "`" + x + "`").join(", ") : tr("validace podle plánu oživení, fáze 10")));
            L.push("");
        }
    }
    L.push(tr("Klasifikace změn a rozsah zkoušek navrhuje PLCdesk podle otisků položek schvalování. Rozsah opakovaných zkoušek potvrzuje odpovědná osoba."));
    return L.join("\n");
}
/** Schválení ve stavu `from` (revize) — pro výpis, kdo zneplatněnou položku schválil. */
function diffApprovals(prj, from) {
    return snapshotOf(findRevision(prj, from)).approvals || {};
}
/* ================================================================ registrace */
registerDocProvider("revision", {
    /* řádek revize pod nadpisem dokumentů (bez revize nic — výstup beze změny) */
    header: prj => revisionHeaderMd(prj),
    docs: (prj, items) => (prj.revisions && prj.revisions.length
        ? [{ path: CHANGES_FILE, tab: tr("Změny"), title: tr("revize projektu, změny od poslední revize a rozsah opakovaných zkoušek"), body: changesMd(prj, { items }) }]
        : []),
});
setSheetRevision(prj => revisionLabel(prj) || undefined);
