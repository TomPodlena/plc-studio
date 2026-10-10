/**
 * PLCdesk — schvalování návrhu a návrhy ladění.
 *
 * Aplikace navrhuje, odpovědná osoba schvaluje: každá položka návrhu (zařízení, tabulka I/O,
 * sekvence, E-stop a blokování, takt a hlídací časy, výsledek ověření simulací, plán oživení…)
 * se schvaluje jménem, datem a poznámkou. Nic se neschvaluje automaticky.
 *
 * Schválení platí pro OBSAH v okamžiku schválení — ukládá se jeho otisk (`hash`). Otisk je
 * FNV-1a (64 bit) nad kanonickým JSON (seřazené klíče) jen toho, co položka schvaluje:
 *   - žádné popisy, komentáře ani přeložené texty (přejmenování popisu zařízení nebo přepnutí
 *     jazyka schválení nezneplatní),
 *   - ale vše, co mění chování stroje nebo programu (třída, volby, meze, časy, tagy, adresy…).
 * Liší-li se uložený otisk od aktuálního, je stav „stale“ (změněno po schválení).
 *
 * Další moduly (bezpečnostní modul, oživení) přidávají položky přes `registerApprovalProvider`
 * — bez zásahu do tohoto souboru. Bezpečnostní funkce tady nejsou: E-stop a blokování jsou
 * položkou jen jako signály standardního programu (jako v generátoru).
 */
import { CLS, DO_ROLES, devById, interlockDevs, enableInputs, isDiWait, isMotionClass, isAxisAct, tolOf, tolTicksOf, maxRecord, } from "./model.js";
import { seqCond } from "./codegen.js";
import { axisCfgOf } from "./axis.js";
import { verifyProject, primeVerifyCache, stepWatchdog, stepTitle, T_MOTOR_FBK, T_VALVE_TRAVEL } from "./sim.js";
import { tr, N_, getLang, formatDate, formatDateTime } from "./i18n.js";
/** Popisky skupin (klíče překladu) — pro tabulky a UI. */
export const APPROVAL_GROUPS = {
    design: N_("Návrh zařízení a I/O"),
    program: N_("Program"),
    verify: N_("Ověření simulací"),
    safety: N_("Bezpečnost"),
    commission: N_("Oživení"),
    tuning: N_("Návrhy ladění"),
};
const STATUS_LABEL = {
    approved: N_("schváleno"),
    rejected: N_("zamítnuto"),
    stale: N_("změněno po schválení"),
    missing: N_("neschváleno"),
    proposed: N_("čeká na rozhodnutí"),
    unverified: N_("čeká na ověření"),
};
/** Přeložený popisek stavu položky. */
export function approvalStatusLabel(s) { return tr(STATUS_LABEL[s]); }
/** Filtry seznamu položek ke schválení (web i desktop): vše, k rozhodnutí, podle stavu. */
export const APPROVAL_FILTERS = ["all", "open", "stale", "rejected", "approved"];
/** Přeložený popisek filtru. */
export function approvalFilterLabel(f) {
    return f === "all" ? tr("vše") : f === "open" ? tr("k rozhodnutí (čeká, změněno po schválení)") : approvalStatusLabel(f);
}
/** Projde položka se stavem `st` filtrem `f`? „k rozhodnutí“ = neschváleno, čeká, změněno po schválení. */
export function approvalFilterPass(st, f) {
    if (f === "all" || !APPROVAL_FILTERS.includes(f))
        return true;
    if (f === "open")
        return st === "missing" || st === "proposed" || st === "stale";
    return st === f;
}
/* ------------------------------------------------------------ otisk */
/** Kanonický JSON: klíče objektů seřazené, `undefined` vynechané, nekonečna a NaN jako null. */
export function canonicalJson(v) {
    if (v === null || v === undefined)
        return "null";
    if (typeof v === "number")
        return Number.isFinite(v) ? JSON.stringify(v) : "null";
    if (typeof v === "string" || typeof v === "boolean")
        return JSON.stringify(v);
    if (Array.isArray(v))
        return "[" + v.map(x => x === undefined ? "null" : canonicalJson(x)).join(",") + "]";
    if (typeof v === "object") {
        const o = v;
        return "{" + Object.keys(o).filter(k => o[k] !== undefined).sort()
            .map(k => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
    }
    return "null";
}
const FNV_OFFSET = 0xcbf29ce484222325n, FNV_PRIME = 0x100000001b3n, MASK64 = 0xffffffffffffffffn;
/** FNV-1a 64 bit nad UTF-8 bajty textu → 16 hex znaků. */
export function fnv1a64(s) {
    let h = FNV_OFFSET;
    for (const b of new TextEncoder().encode(s))
        h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK64;
    return h.toString(16).padStart(16, "0");
}
/** Otisk obsahu položky: deterministický, nezávislý na pořadí klíčů objektů a na jazyku. */
export function contentHash(content) { return fnv1a64(canonicalJson(content)); }
/* ------------------------------------------------------------ obsah položek (= co se schvaluje) */
const fin = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const devName = (prj, id) => (devById(prj, id) || { name: "" }).name;
/**
 * Návrh tak, jak ho čte ověření simulací: jen zařízení, I/O, program, model stroje, platformy
 * a takt. Bez názvu a popisu projektu, konceptu, kusovníku, schválení, výsledků oživení
 * a dat dalších modulů (bezpečnost) — jejich změna tak ověření (desítky sekund u velkého
 * stroje) znovu nespouští. Popisy zařízení a komentáře I/O zůstávají: jsou v textech nálezů
 * ověření a jejich změna má texty obnovit.
 */
/** Kopie objektu bez pole `guid` (GUID není obsah návrhu — otisky, revize a ověření ho ignorují). */
export function noGuid(o) {
    if (!o || o.guid === undefined)
        return o;
    const { guid: _g, ...rest } = o;
    return rest;
}
export function designView(prj) {
    return {
        meta: { name: "", desc: "", takt: prj.meta.takt },
        /* bez GUID (guid.ts): identita objektů, ne obsah — doplnění GUID nesmí spouštět ověření znovu */
        platforms: prj.platforms, devices: prj.devices.map(noGuid), io: prj.io.map(noGuid), program: prj.program,
        nextId: prj.nextId, sim: prj.sim,
    };
}
/* Vlastní cache ověření: klíč = návrh (designView) × jazyk. Verze v sim.ts je klíčovaná celým
   projektem, tahle přežije přejmenování projektu i zápis schválení a umí odpovědět „není
   spočítáno“ bez výpočtu (levný souhrn pro odznak). */
const verifyMemo = new Map();
const verifyKey = (prj) => getLang() + "\u0000" + JSON.stringify(designView(prj));
/** Ověření simulací nad návrhem (sdílená cache s dokumentací a s levným souhrnem). */
export function verifyDesign(prj) {
    const k = verifyKey(prj);
    const hit = verifyMemo.get(k);
    if (hit)
        return hit;
    const v = verifyProject(designView(prj));
    verifyMemo.set(k, v);
    if (verifyMemo.size > 8)
        verifyMemo.delete(verifyMemo.keys().next().value);
    return v;
}
/**
 * Převezme výsledek `verifyDesign(prj)` spočítaný jinde (web Worker klienta nad týmž jádrem, v aktuálním
 * jazyce) do cache ověření — kroky Schválení / Oživení / Dokumentace pak simulaci znovu nespouštějí.
 */
export function seedVerifyDesign(prj, v) {
    verifyMemo.set(verifyKey(prj), v);
    if (verifyMemo.size > 8)
        verifyMemo.delete(verifyMemo.keys().next().value);
    primeVerifyCache(designView(prj), v);
}
/** Ověření z cache, nebo null — nic nespouští. */
export function verifyDesignCached(prj) {
    return verifyMemo.get(verifyKey(prj)) ?? null;
}
/** Je ověření návrhu už spočítané (v aktuálním jazyce)? */
export function isVerified(prj) { return verifyMemo.has(verifyKey(prj)); }
/**
 * Zařízení: označení, třída, volby, které mění signály a logiku bloku, rozsah a jednotka analogu,
 * meze, žádaná hodnota, vazba výstupu. NE popis (`desc`) ani interní id.
 */
function deviceContent(d) {
    const o = d.opt || {};
    const an = d.cls === "AnalogIn" || d.cls === "AnalogOut";
    return {
        name: d.name, cls: d.cls,
        opt: d.cls === "Motor" ? { fbk: o.fbk !== false, fault: !!o.fault }
            : d.cls === "Ventil" ? { fbkOpen: o.fbkOpen !== false, fbkClosed: !!o.fbkClosed } : undefined,
        unit: an ? d.unit || "" : undefined,
        range: an ? [fin(d.rmin), fin(d.rmax)] : undefined,
        lim: d.cls === "AnalogIn" ? [fin(d.limLo), fin(d.limHi)] : undefined,
        sp: d.cls === "AnalogOut" ? fin(d.setpoint) : undefined,
        role: d.cls === "DO" ? d.role ?? null : undefined,
        /* pohony fáze 2a: volby signálů a parametry, které mění kód bloku nebo sekvenci (u ostatních tříd chybí → otisk beze změny) */
        motion: isMotionClass(d.cls) ? motionContent(d) : undefined,
        /* servoosa: celá konfigurace (s výchozími hodnotami) — změna dynamiky, limitů nebo poloh = znovu ke schválení */
        axis: d.cls === "Axis" ? { unit: d.unit || "", ...axisCfgOf(d) } : undefined,
    };
}
/** Parametry pohonu fáze 2a do otisku / porovnání revizí (rozsah, žádaná, rampa, tolerance, záznamy, model jízdy). */
export function motionContent(d) {
    const o = d.opt || {};
    const dflt = new Set(["fbk", "ready", "fault"]);
    const opt = {};
    for (const k of Object.keys(CLS[d.cls].opts).sort())
        opt[k] = dflt.has(k) ? o[k] !== false : !!o[k];
    return {
        opt, unit: d.cls === "PosDrive" ? undefined : d.unit || "", range: d.cls === "PosDrive" ? undefined : [fin(d.rmin), fin(d.rmax)],
        sp: d.cls === "PosDrive" ? undefined : fin(d.setpoint), rampS: d.cls === "PosDrive" ? undefined : fin(d.rampS) ?? 0,
        tol: d.cls === "PropValve" ? fin(d.tol) : undefined, tolTimeS: d.cls === "PropValve" ? fin(d.tolTimeS) : undefined,
        selBits: d.cls === "PosDrive" ? fin(d.selBits) : undefined, travelS: d.cls === "PosDrive" ? fin(d.travelS) : undefined,
        records: d.cls === "PosDrive" ? (d.records || []).map(r => [r.no, r.name || "", fin(r.pos) ?? null]) : undefined,
    };
}
/** Tabulka I/O: zařízení.signál, směr, tag, adresa, NC. NE komentář (`cmt`). */
function ioContent(prj) {
    return prj.io.map(e => ({ dev: devName(prj, e.devId), sig: e.sig, dir: e.dir, tag: e.tag, addr: e.addr || "", nc: e.dir === "DI" ? !!e.nc : undefined }))
        .sort((a, b) => (a.dev + "." + a.sig < b.dev + "." + b.sig ? -1 : a.dev + "." + a.sig > b.dev + "." + b.sig ? 1 : 0));
}
/** Sekvence: pořadí kroků, zařízení, akce, druh přechodu (jak ho generuje `seqCond`) a časy; režimy. */
function seqContent(prj) {
    return {
        modes: !!prj.program.modes,
        steps: prj.program.seq.map(s => {
            const c = seqCond(prj, s);
            return { dev: s.act === "wait" ? "" : devName(prj, s.dev), act: s.act, cond: s.cond, kind: c.kind, sig: c.io ? c.io.tag : undefined, neg: c.neg || undefined, t: fin(s.timeS),
                /* krok servoosy: cíl a dynamika (u ostatních kroků chybí → otisk beze změny) */
                ...(isAxisAct(s.act) || (s.act === "home" && devById(prj, s.dev)?.cls === "Axis") ? { pos: fin(s.pos), posRef: s.posRef, vel: fin(s.vel), acc: fin(s.acc), dec: fin(s.dec) } : {}) };
        }),
    };
}
/** E-stop a blokování jako vstupy `enable` standardního programu: zařízení, tag, NC. */
function interlockContent(prj) {
    return {
        inputs: enableInputs(prj).map(x => ({ dev: x.dev.name, tag: x.io.tag, nc: !!x.io.nc, estop: x.estop })),
        estopSet: !!devById(prj, prj.program.estop),
    };
}
/** Takt, hlídací časy a časy kroků, model stroje pro simulaci, timeouty bloků z generátoru. */
function limitsContent(prj) {
    return {
        takt: fin(prj.meta.takt),
        steps: prj.program.seq.map((s, i) => ({ i, wd: stepWatchdog(prj, s), t: seqCond(prj, s).kind === "time" ? fin(s.timeS) : undefined })),
        model: { motor: fin(prj.sim?.motorDelay), valve: fin(prj.sim?.valveTravel) },
        blocks: { motor: T_MOTOR_FBK, valve: T_VALVE_TRAVEL },
    };
}
/** Výsledek ověření bez textů: úroveň, scénář, krok a zařízení nálezů, doba cyklu, matice stavů. */
function verifyContent(prj, v) {
    return {
        ok: v.ok,
        cycle: v.nominal ? v.nominal.cycleTime : null,
        checks: v.checks.map(c => [c.level, c.scenario ?? "", c.step ?? -1, c.dev !== undefined ? devName(prj, c.dev) : ""]),
        matrix: { cols: v.matrix.cols.map(c => c.id), rows: v.matrix.rows.map(r => [r.step, v.matrix.cols.map(c => r.cells[c.id] ? r.cells[c.id].ok : null)]) },
    };
}
const providers = [];
/**
 * Přihlásí zdroj dalších položek ke schválení (bezpečnostní modul, oživení…). Stejné `name`
 * nahradí dříve přihlášený zdroj (opakované načtení modulu). Vrací funkci pro odhlášení.
 * Klíče položek musí být jedinečné — doporučená předpona podle skupiny („safety:…“).
 */
export function registerApprovalProvider(fn, name) {
    const nm = name || "provider-" + providers.length + "-" + Date.now();
    const at = providers.findIndex(p => p.name === nm);
    if (at >= 0)
        providers[at] = { name: nm, fn };
    else
        providers.push({ name: nm, fn });
    return () => { const i = providers.findIndex(p => p.name === nm && p.fn === fn); if (i >= 0)
        providers.splice(i, 1); };
}
/** Názvy přihlášených zdrojů položek (diagnostika, testy). */
export function approvalProviders() { return providers.map(p => p.name); }
function deviceSummary(d) {
    const c = CLS[d.cls];
    const onByDefault = (k) => k === "fbk" || k === "fbkOpen" || (isMotionClass(d.cls) && (k === "ready" || k === "fault"));
    const opts = Object.keys(c.opts).filter(k => onByDefault(k) ? d.opt?.[k] !== false : !!d.opt?.[k]).map(k => tr(c.opts[k]));
    const parts = [tr(c.label)];
    if (opts.length)
        parts.push(opts.join(", "));
    if (d.cls === "AnalogIn" || d.cls === "AnalogOut")
        parts.push(tr("rozsah {min}–{max} {unit}", { min: d.rmin, max: d.rmax, unit: d.unit || "" }).trim());
    if (d.cls === "AnalogIn")
        parts.push(Number.isFinite(d.limLo) || Number.isFinite(d.limHi)
            ? tr("meze {lo} / {hi}", { lo: fin(d.limLo) ?? "—", hi: fin(d.limHi) ?? "—" }) : tr("bez mezí"));
    if (d.cls === "AnalogOut")
        parts.push(Number.isFinite(d.setpoint) ? tr("žádaná hodnota {sp}", { sp: d.setpoint }) : tr("bez žádané hodnoty"));
    if (d.cls === "DO")
        parts.push(d.role ? tr("vazba: {role}", { role: tr(DO_ROLES[d.role]) }) : tr("bez vazby na stav stroje"));
    if (d.cls === "Vfd" || d.cls === "PropValve") {
        parts.push(tr("rozsah {min}–{max} {unit}", { min: d.rmin, max: d.rmax, unit: d.unit || "" }).trim());
        parts.push(Number.isFinite(d.setpoint) ? tr("žádaná hodnota {sp}", { sp: d.setpoint }) : tr("bez žádané hodnoty"));
        parts.push(Number(d.rampS) > 0 ? tr("rampa {t} s", { t: d.rampS }) : tr("bez rampy v PLC"));
    }
    if (d.cls === "PropValve" && d.opt?.fbk !== false)
        parts.push(tr("tolerance ± {tol} po {t} s", { tol: tolOf(d), t: tolTicksOf(d) / 10 }));
    if (d.cls === "PosDrive")
        parts.push(tr("záznamy 1–{max}", { max: maxRecord(d) }) + ((d.records || []).length ? ": " + (d.records || []).map(r => r.no + " " + (r.name || "")).join(", ") : ""));
    if (d.cls === "Axis") {
        const a = axisCfgOf(d), u = d.unit || "";
        parts.push(tr("max. {v} {unit}/s, zrychlení {a} {unit}/s²", { v: a.vMax, a: a.aMax, unit: u }));
        if (a.limNeg !== undefined && a.limPos !== undefined)
            parts.push(tr("SW limity {lo} až {hi} {unit}", { lo: a.limNeg, hi: a.limPos, unit: u }).trim());
        parts.push(tr("polohy: {list}", { list: a.positions.map(x => x.name + " @ " + x.pos).join("; ") || "—" }));
    }
    return parts.join("; ");
}
/** Položky návrhu a programu (vždy přítomné). */
function coreItems(prj, opts = {}) {
    const out = [];
    const names = new Map();
    for (const d of prj.devices)
        names.set(d.name, (names.get(d.name) || 0) + 1);
    for (const d of prj.devices) {
        const key = "dev:" + d.name + ((names.get(d.name) || 0) > 1 ? "#" + d.id : "");
        out.push({
            key, group: "design", required: true,
            title: d.desc ? tr("Zařízení {dev} ({desc})", { dev: d.name, desc: d.desc }) : tr("Zařízení {dev}", { dev: d.name }),
            summary: deviceSummary(d), hash: contentHash(deviceContent(d)),
        });
    }
    const n = (dir) => prj.io.filter(e => e.dir === dir).length;
    out.push({
        key: "io", group: "design", required: true, title: tr("Tabulka I/O"),
        summary: tr("{n} signálů (DI {di}, DO {do}, AI {ai}, AO {ao}): tagy, adresy, rozpínací kontakty", { n: prj.io.length, di: n("DI"), do: n("DO"), ai: n("AI"), ao: n("AO") }),
        hash: contentHash(ioContent(prj)),
    });
    const seq = prj.program.seq;
    out.push({
        key: "seq", group: "program", required: true, title: tr("Automatická sekvence"),
        summary: seq.length ? tr("{n} kroků: pořadí, akce, přechody a jejich časy; režimy AUTO / ručně", { n: seq.length })
            : tr("bez automatické sekvence — jen ruční režim"),
        hash: contentHash(seqContent(prj)),
    });
    const es = devById(prj, prj.program.estop), locks = interlockDevs(prj);
    out.push({
        key: "interlocks", group: "program", required: true, title: tr("E-stop a blokování (signály standardního programu)"),
        summary: tr("E-stop: {estop}; blokování: {locks}. Vstupy centrálního uvolnění standardního programu — bezpečnostní funkce sem nepatří.", {
            estop: es ? es.name : tr("nezvolen"), locks: locks.map(d => d.name).join(", ") || "—",
        }),
        hash: contentHash(interlockContent(prj)),
    });
    const wds = seq.filter(s => stepWatchdog(prj, s) !== null).length;
    out.push({
        key: "limits", group: "program", required: true, title: tr("Takt a hlídací časy"),
        summary: tr("takt {takt}; {n} hlídacích časů kroků; timeouty bloků: motor {motor} s, ventil {valve} s", {
            takt: prj.meta.takt ? prj.meta.takt + " s" : tr("nezadán"), n: wds, motor: T_MOTOR_FBK, valve: T_VALVE_TRAVEL,
        }),
        hash: contentHash(limitsContent(prj)),
    });
    const v = opts.cheap ? verifyDesignCached(prj) : verifyDesign(prj);
    if (!v) {
        out.push({ key: "verify", group: "verify", required: true, title: tr("Výsledek ověření simulací"),
            summary: tr("ověření simulací zatím neproběhlo"), hash: "", unverified: true });
        return out;
    }
    const errs = v.checks.filter(c => c.level === "error").length, warns = v.checks.filter(c => c.level === "warn").length;
    out.push({
        key: "verify", group: "verify", required: true, title: tr("Výsledek ověření simulací"),
        summary: (v.ok ? tr("bez chyb") : tr("{n} chyb", { n: errs })) + "; " + tr("{n} upozornění", { n: warns })
            + (v.nominal && v.nominal.cycleTime !== null ? "; " + tr("cyklus {t} s", { t: v.nominal.cycleTime }) : "")
            + (v.matrix.total ? "; " + tr("matice stavů {ok}/{total}", { ok: v.matrix.total - v.matrix.failed, total: v.matrix.total }) : ""),
        hash: contentHash(verifyContent(prj, v)),
    });
    return out;
}
/**
 * Bezpečnostní funkce: dokud se nepřihlásí bezpečnostní modul s vlastními položkami (skupina
 * „safety“), je tu jedna povinná položka — odpovědná osoba potvrdí, kdo a čím bezpečnostní funkce
 * řeší. Program je nenavrhuje; otisk = vstupy, které standardní program bere jako E-stop / blokování.
 */
function safetyPlaceholder(prj) {
    return {
        key: "safety:external", group: "safety", required: true, title: tr("Bezpečnostní funkce"),
        summary: tr("Bezpečnostní funkce v projektu navrženy nejsou (bezpečnostní modul není zapojen). Schválením odpovědná osoba potvrzuje, že je řeší posouzení rizik a bezpečnostní obvod mimo tento program — do poznámky uveď čím (dokument, revize)."),
        hash: contentHash({ external: true, inputs: enableInputs(prj).map(x => x.io.tag) }),
    };
}
/**
 * Všechny položky projektu ke schválení: návrh, program, ověření, bezpečnost, zdroje z registru,
 * návrhy ladění. `{ cheap: true }` nespouští ověření simulací: bez něj spočítaného má položka
 * „verify“ (a položky zdrojů, které na něm závisí) `unverified: true` a návrhy ladění chybí.
 */
export function approvalItems(prj, opts = {}) {
    const out = coreItems(prj, opts);
    const extra = [];
    for (const p of providers)
        extra.push(...p.fn(prj, opts));
    if (!extra.some(i => i.group === "safety"))
        out.push(safetyPlaceholder(prj));
    out.push(...extra);
    for (const t of (opts.cheap && !isVerified(prj) ? [] : tuningProposals(prj))) {
        out.push({ key: t.approvalKey, group: "tuning", required: false, title: t.title, summary: t.why, hash: t.hash });
    }
    /* duplicitní označení zařízení (import / AI) hlásí validateProject jako chybu — položka pak dostane
       příponu, aby kroky Dokumentace / Schválení / Oživení nespadly; bez duplicit = porušení invariantu */
    const names = prj.devices.map(d => d.name.toUpperCase());
    const dupNames = new Set(names).size !== names.length;
    const seen = new Set();
    for (const i of out) {
        if (seen.has(i.key)) {
            if (!dupNames)
                throw new Error("approval: duplicate item key " + i.key);
            let k = 2;
            while (seen.has(i.key + "#" + k))
                k++;
            i.key = i.key + "#" + k;
        }
        seen.add(i.key);
    }
    return out;
}
/** Stav položky: schváleno / zamítnuto / čeká; „stale“ = schváleno, ale obsah se od té doby změnil. */
export function approvalStatus(prj, item) {
    if (item.unverified)
        return "unverified";
    const rec = prj.approvals?.[item.key];
    if (!rec)
        return "missing";
    if (rec.hash !== item.hash)
        return rec.state === "approved" ? "stale" : "proposed"; // změna po zamítnutí = nový návrh
    return rec.state;
}
function findItem(prj, key) {
    const it = approvalItems(prj).find(i => i.key === key);
    if (!it)
        throw new Error("approval: unknown item " + key);
    return it;
}
function record(prj, item, state, by, note, at) {
    if (!by || !by.trim())
        throw new Error("approval: name of the responsible person is required");
    prj.approvals = prj.approvals || {};
    prj.approvals[item.key] = { state, by: by.trim(), at: at || new Date().toISOString(), hash: item.hash, ...(note ? { note } : {}) };
}
/** Schválí položku (aktuální obsah). Jméno je povinné; položku s `ready === false` schválit nelze. */
export function approve(prj, key, by, note, at) {
    const it = findItem(prj, key);
    if (it.ready === false)
        throw new Error("approval: " + key + " is not ready — " + (it.notReady || ""));
    record(prj, it, "approved", by, note, at);
}
/** Zamítne položku (důvod do poznámky). */
export function reject(prj, key, by, note, at) {
    record(prj, findItem(prj, key), "rejected", by, note, at);
}
/**
 * Hromadné schválení vybraných položek — výslovná akce uživatele nad seznamem klíčů (např.
 * „schválit celou skupinu“ po potvrzení). Každá položka dostane vlastní záznam se svým otiskem,
 * jménem, okamžikem a poznámkou; nic dalšího se neschvaluje. Položky se počítají jednou.
 */
export function approveMany(prj, keys, by, note, at) {
    if (!by || !by.trim())
        throw new Error("approval: name of the responsible person is required");
    const items = new Map(approvalItems(prj).map(i => [i.key, i]));
    const when = at || new Date().toISOString();
    const res = { approved: [], skipped: [] };
    for (const key of [...new Set(keys)]) {
        const it = items.get(key);
        if (!it)
            res.skipped.push({ key, reason: "unknown" });
        else if (it.ready === false)
            res.skipped.push({ key, reason: it.notReady || "not ready" });
        else {
            record(prj, it, "approved", by, note, when);
            res.approved.push(key);
        }
    }
    return res;
}
/** Zruší rozhodnutí o položce (záznam se odstraní). */
export function resetApproval(prj, key) {
    if (prj.approvals)
        delete prj.approvals[key];
}
/**
 * Souhrn stavů. Druhý argument: hotové položky (`approvalItems`), nebo volby — `{ cheap: true }`
 * nespouští ověření simulací (odznak v hlavičce); pak `partial` = true, pokud ověření chybí.
 */
export function approvalSummary(prj, arg = {}) {
    const items = Array.isArray(arg) ? arg : approvalItems(prj, arg);
    const s = { total: items.length, approved: 0, stale: 0, rejected: 0, unverified: 0, partial: false, pending: 0, blocking: [], ok: false };
    for (const it of items) {
        const st = approvalStatus(prj, it);
        if (st === "unverified") {
            s.unverified++;
            s.partial = true;
        }
        else if (st === "approved")
            s.approved++;
        else if (st === "stale")
            s.stale++;
        else if (st === "rejected")
            s.rejected++;
        else
            s.pending++;
        if (it.required && st !== "approved")
            s.blocking.push(it);
    }
    s.ok = !s.blocking.length;
    return s;
}
/** Záznamy schválení, ke kterým už položka neexistuje (smazané zařízení, uplatněný návrh ladění). */
export function approvalOrphans(prj, items = approvalItems(prj)) {
    const keys = new Set(items.map(i => i.key));
    return Object.keys(prj.approvals || {}).filter(k => !keys.has(k));
}
/**
 * Razítko stavu skupin položek: SCHVÁLENO (kdo, kdy) / ZMĚNĚNO PO SCHVÁLENÍ / NESCHVÁLENO.
 * `groups` = které skupiny dokument pokrývá (prázdné = všechny povinné položky).
 */
export function approvalStamp(prj, groups = [], items = approvalItems(prj)) {
    const its = items.filter(i => groups.length ? groups.includes(i.group) && (i.required || i.group === "commission") : i.required);
    if (!its.length)
        return { state: "none", text: "", md: "" };
    const st = its.map(i => ({ i, s: approvalStatus(prj, i) }));
    const list = (xs) => {
        const names = xs.slice(0, 6).map(x => x.i.title + (x.s === "rejected" ? " (" + approvalStatusLabel("rejected") + ")" : ""));
        return names.join(", ") + (xs.length > 6 ? ", … (+" + (xs.length - 6) + ")" : "");
    };
    let state, head, rest;
    const stale = st.filter(x => x.s === "stale"), open = st.filter(x => x.s !== "approved");
    if (!open.length) {
        const recs = its.map(i => prj.approvals[i.key]);
        const who = [...new Set(recs.map(r => r.by))].join(", ");
        const at = formatDate(recs.map(r => r.at).sort().pop());
        state = "approved";
        head = tr("SCHVÁLENO");
        rest = tr("{who}, {date} ({n} položek)", { who, date: at, n: its.length });
    }
    else if (stale.length) {
        state = "stale";
        head = tr("ZMĚNĚNO PO SCHVÁLENÍ");
        rest = tr("obsah se po schválení změnil: {list}. Schválení neplatí — je potřeba schválit znovu (viz {file}).", { list: list(stale), file: APPROVAL_FILE });
    }
    else {
        state = "unapproved";
        head = tr("NESCHVÁLENO");
        rest = tr("chybí schválení {n} z {total} položek: {list}. Návrh k revizi — bez schválení nepoužívat jako podklad (viz {file}).", { n: open.length, total: its.length, list: list(open), file: APPROVAL_FILE });
    }
    return { state, text: head + " — " + rest, md: "> **" + head + "** — " + rest };
}
/** Dokument se schválením položek. */
export const APPROVAL_FILE = "11_schvaleni.md";
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
/** Dokument `11_schvaleni.md`: souhrn a tabulka položek po skupinách (stav, kdo, kdy, poznámka, otisk). */
export function approvalsMd(prj, items = approvalItems(prj)) {
    const s = approvalSummary(prj, items);
    const L = [
        "# " + tr("Schválení projektu"),
        "",
        approvalStamp(prj, [], items).md,
        "",
        tr("**Projekt:** {name}", { name: prj.meta.name || "—" }),
        "",
        tr("PLCdesk navrhuje, odpovědná osoba schvaluje. Každá položka se schvaluje jménem, datem a poznámkou a schválení platí pro obsah v okamžiku schválení (otisk). Když se obsah položky změní, stav se změní na „změněno po schválení“ a položku je potřeba schválit znovu. Nic se neschvaluje automaticky."),
        "",
        tr("**Stav:** {approved} schváleno · {stale} změněno po schválení · {rejected} zamítnuto · {pending} čeká — celkem {total} položek", { ...s }),
        "",
    ];
    if (s.blocking.length) {
        L.push("**" + tr("Povinné položky bez platného schválení ({n})", { n: s.blocking.length }) + "**");
        for (const it of s.blocking)
            L.push("- " + it.title + " — " + approvalStatusLabel(approvalStatus(prj, it)));
    }
    else
        L.push("**" + tr("Všechny povinné položky jsou schválené.") + "**");
    L.push("");
    let sec = 1;
    for (const g of Object.keys(APPROVAL_GROUPS)) {
        const its = items.filter(i => i.group === g);
        if (!its.length)
            continue;
        L.push("## " + sec++ + ". " + tr(APPROVAL_GROUPS[g]), "", tr("| Položka | Co se schvaluje | Povinná | Stav | Kdo | Kdy | Poznámka | Otisk |"), "|---|---|---|---|---|---|---|---|");
        for (const it of its) {
            const rec = prj.approvals?.[it.key];
            const st = approvalStatus(prj, it);
            L.push("| " + [cell(it.title), cell(it.summary), it.required ? tr("ano") : tr("ne"), "**" + approvalStatusLabel(st) + "**",
                cell(rec ? rec.by : ""), rec ? formatDateTime(rec.at) : "", cell(rec?.note || ""), "`" + it.hash.slice(0, 8) + "`"].join(" | ") + " |");
        }
        L.push("");
    }
    const orphans = approvalOrphans(prj, items);
    if (orphans.length) {
        L.push("**" + tr("Záznamy schválení bez položky (položka zrušena nebo návrh uplatněn)") + "**");
        for (const k of orphans) {
            const r = prj.approvals[k];
            L.push("- `" + k + "` — " + approvalStatusLabel(r.state) + ", " + r.by + ", " + formatDateTime(r.at));
        }
        L.push("");
    }
    L.push(tr("Otisk = kontrolní součet obsahu položky (FNV-1a nad kanonickým JSON). Nezahrnuje popisy a komentáře — jejich úprava schválení nezneplatní."));
    return L.join("\n");
}
const clone = (p) => JSON.parse(JSON.stringify(p));
const ceilTo = (x, q) => Math.ceil(x / q - 1e-9) * q;
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
/**
 * Návrhy úprav z ověření simulací a kontroly konceptu: malá rezerva hlídacího času, nesplněný takt,
 * analog bez mezí, nevyužité vstupy, výstupy bez povelu, pohony mimo cyklus, ✖ v matici stavů.
 * Každý návrh je položka ke schválení; uplatnění (`apply`) nic neschvaluje a vrací nový projekt.
 */
export function tuningProposals(prj) {
    const out = [];
    const mk = (id, kind, title, why, change, apply, ref = {}, changes = [], affects = []) => {
        out.push({ id, kind, title, why, apply, approvalKey: "tuning:" + id, hash: contentHash({ id, kind, change }), ...ref, changes, affects });
    };
    const TIME_AFFECTS = ["seq", "limits", "verify", "commission:plan", "commission:close"];
    const seq = prj.program.seq;
    const v = verifyDesign(prj);
    const nominal = v.nominal;
    /* 1) rezerva hlídacího času < 20 % → hlídací čas = doba akce / 0,7 (rezerva ≥ 30 %), na 0,5 s nahoru */
    if (nominal) {
        const dur = new Map();
        for (const r of nominal.steps)
            if (r.tEnd !== null)
                dur.set(r.i, Math.max(dur.get(r.i) ?? 0, r3(r.tEnd - r.tStart)));
        for (const [i, d] of dur) {
            const st = seq[i], wd = stepWatchdog(prj, st);
            if (wd === null || d <= 0.8 * wd)
                continue;
            const to = Math.max(ceilTo(d / 0.7, 0.5), wd + 0.5);
            const dn = devName(prj, st.dev);
            mk("wd-" + i, "watchdog", tr("Krok {n} ({title}): prodloužit hlídací čas {from} s → {to} s", { n: i + 1, title: stepTitle(prj, st), from: wd, to }), tr("Akce v simulaci trvá {d} s, hlídací čas {wd} s má rezervu jen {pct} % (požadováno ≥ 20 %). Navržená hodnota dává rezervu {pct2} %. Po oživení ji porovnej se změřenou dobou.", {
                d, wd, pct: Math.round((1 - d / wd) * 100), pct2: Math.round((1 - d / to) * 100),
            }), { step: i, dev: dn, act: st.act, from: wd, to }, p => {
                const q = clone(p), s = q.program.seq[i];
                if (s && s.act === st.act && devName(q, s.dev) === dn)
                    s.timeS = to;
                return q;
            }, { step: i, dev: st.dev || undefined }, [{ key: "seq", field: "program.seq[" + i + "].timeS", before: wd, after: to, note: tr("Krok {n} ({title}): hlídací čas", { n: i + 1, title: stepTitle(prj, st) }) }], TIME_AFFECTS);
        }
    }
    /* 2) takt nesplněn → nejdelší krok; zkrácení nejdelší výdrže, pokud stačí */
    const takt = prj.meta.takt;
    if (nominal && nominal.finished && nominal.cycleTime !== null && takt && takt > 0 && nominal.cycleTime > takt + 1e-9) {
        const miss = r1(ceilTo(nominal.cycleTime - takt, 0.1));
        const runs = nominal.steps.filter(r => r.tEnd !== null).map(r => ({ i: r.i, d: r3(r.tEnd - r.tStart) })).sort((a, b) => b.d - a.d);
        const top = runs[0];
        const waits = seq.map((s, i) => ({ s, i })).filter(x => seqCond(prj, x.s).kind === "time" && (x.s.timeS || 1) - miss >= 0.5)
            .sort((a, b) => (b.s.timeS || 1) - (a.s.timeS || 1));
        const w = waits[0];
        const slow = runs.slice(0, 3).map(x => tr("krok {n} ({title}) {t} s", { n: x.i + 1, title: stepTitle(prj, seq[x.i]), t: x.d })).join(", ");
        const to = w ? r1((w.s.timeS || 1) - miss) : null;
        mk("takt", "takt", tr("Takt {takt} s nesplněn — nejdelší je krok {n} ({title}, {t} s)", { takt, n: top.i + 1, title: stepTitle(prj, seq[top.i]), t: top.d }), tr("Cyklus trvá {t} s, chybí {miss} s. Nejdelší kroky: {slow}.", { t: nominal.cycleTime, miss, slow }) + " "
            + (w ? tr("Návrh: zkrátit krok {n} ({title}) z {from} s na {to} s — ověř, že to technologie dovolí.", { n: w.i + 1, title: stepTitle(prj, w.s), from: w.s.timeS || 1, to })
                : tr("Žádná časová výdrž nestačí na zkrácení — zrychli pohyby, sluč kroky, nebo uprav takt.")), { cycle: nominal.cycleTime, takt, step: w ? w.i : null, to }, w ? p => {
            const q = clone(p), s = q.program.seq[w.i];
            if (s && s.act === w.s.act)
                s.timeS = to;
            return q;
        } : undefined, { step: top.i }, w ? [{ key: "seq", field: "program.seq[" + w.i + "].timeS", before: w.s.timeS || 1, after: to, note: tr("Krok {n} ({title}): výdrž", { n: w.i + 1, title: stepTitle(prj, w.s) }) }] : [], w ? TIME_AFFECTS : []);
    }
    /* 3) kontrola konceptu: analog bez mezí (návrh z rozsahu), nevyužité vstupy, výstupy bez povelu */
    const used = new Set(enableInputs(prj).map(x => x.dev.id));
    for (const s of seq)
        if (isDiWait(s))
            used.add(s.dev);
    const inSeq = new Set(seq.filter(s => s.act !== "wait" && !isDiWait(s)).map(s => s.dev));
    for (const d of prj.devices) {
        const p = { dev: d.name, desc: d.desc || tr(CLS[d.cls].label) };
        if (d.cls === "AnalogIn" && !Number.isFinite(d.limHi) && !Number.isFinite(d.limLo) && Number.isFinite(d.rmin) && Number.isFinite(d.rmax) && d.rmin < d.rmax) {
            const span = d.rmax - d.rmin;
            const lo = r3(d.rmin + 0.05 * span), hi = r3(d.rmax - 0.05 * span);
            mk("limits-" + d.name, "limits", tr("Měření {dev} ({desc}): doplnit meze {lo} / {hi} {unit}", { ...p, lo, hi, unit: d.unit || "" }), tr("Program na hodnotu nereaguje (žádný alarm ani podmínka). Návrh z rozsahu {min}–{max} {unit}: 5 % od okrajů — vadný snímač nebo přerušený vodič pak vyhlásí poruchu. Uprav podle technologie (provozní meze bývají užší).", { min: d.rmin, max: d.rmax, unit: d.unit || "" }), { dev: d.name, lo, hi }, q0 => {
                const q = clone(q0), x = q.devices.find(z => z.name === d.name && z.cls === "AnalogIn");
                if (x) {
                    x.limLo = lo;
                    x.limHi = hi;
                }
                return q;
            }, { dev: d.id }, [{ key: "dev:" + d.name, field: "devices[" + d.name + "].limLo", before: null, after: lo, note: tr("{dev}: dolní mez", { dev: d.name }) },
                { key: "dev:" + d.name, field: "devices[" + d.name + "].limHi", before: null, after: hi, note: tr("{dev}: horní mez", { dev: d.name }) }], ["dev:" + d.name, "verify", "commission:plan", "commission:close"]);
        }
        else if (d.cls === "DI" && !used.has(d.id)) {
            mk("unused-in-" + d.name, "unused-in", tr("Vstup {dev} ({desc}) program nečte", p), tr("Rozhodni o jeho funkci: blokovací vstup (kryt, závora, tlak vzduchu — zařadit do blokování), podmínka kroku (čekat na vstup), nebo vlastní logika. Jinak ho z návrhu vyřaď."), { dev: d.name }, undefined, { dev: d.id });
        }
        else if (d.cls === "DO" && !d.role) {
            mk("unused-out-" + d.name, "unused-out", tr("Výstup {dev} ({desc}) program neovládá", p), tr("Výstup zůstává trvale FALSE. Navrhni vazbu na stav stroje (chod, porucha, připraveno, stop, zámek krytů, AUTO) nebo vlastní logiku."), { dev: d.name }, undefined, { dev: d.id });
        }
        else if (d.cls === "AnalogOut" && !Number.isFinite(d.setpoint)) {
            mk("setpoint-" + d.name, "setpoint", tr("Žádaná hodnota {dev} ({desc}) není zadána", p), tr("Bez žádané hodnoty zůstává výstup na 0. Zadej konstantu, nebo zdroj (HMI, receptura, regulace) doplň ručně."), { dev: d.name }, undefined, { dev: d.id });
        }
        else if ((d.cls === "Motor" || d.cls === "Ventil" || isMotionClass(d.cls) || d.cls === "Axis") && seq.length && !inSeq.has(d.id)) {
            mk("idle-drive-" + d.name, "idle-drive", tr("Zařízení {dev} ({desc}) automatický cyklus nepoužívá", p), tr("V AUTO stojí, ovládá se jen ručním povelem. Pokud má v cyklu pracovat, doplň krok sekvence; jinak to potvrď schválením."), { dev: d.name }, undefined, { dev: d.id });
        }
    }
    /* 4) matice stavů ✖ → popis (bez automatické úpravy) */
    for (const row of v.matrix.rows)
        for (const col of v.matrix.cols) {
            const c = row.cells[col.id];
            if (!c || c.ok !== false)
                continue;
            mk("matrix-" + (row.step >= 0 ? row.step : row.step === -1 ? "idle" : "manual") + "-" + col.id, "matrix", tr("{state} + {what}: neodpovídá konceptu", { state: row.title, what: col.label }), c.detail + " " + tr("Uprav sekvenci, blokování nebo hlídací časy tak, aby reakce odpovídala FDS; scénář lze přehrát v simulaci."), { step: row.step, col: col.id }, undefined, { step: row.step >= 0 ? row.step : undefined });
        }
    return out;
}
/** Najde návrh ladění podle id a uplatní ho (nový projekt). Bez `apply` vrací kopii beze změny. */
export function applyTuning(prj, id) {
    return applyTuningResult(prj, id).prj;
}
/** Jako `applyTuning`, navíc vrací seznam změn a dotčené položky ke schválení. Nic neschvaluje. */
export function applyTuningResult(prj, id) {
    const t = tuningProposals(prj).find(x => x.id === id);
    if (!t)
        throw new Error("tuning: unknown proposal " + id);
    return t.apply ? { prj: t.apply(prj), id, title: t.title, changes: t.changes, affects: t.affects }
        : { prj: clone(prj), id, title: t.title, changes: [], affects: [] };
}
