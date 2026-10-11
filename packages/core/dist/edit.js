/**
 * PLCdesk — ruční úpravy návrhu (kroky 4–7: Zařízení, I/O, Schéma, Program).
 *
 * Jediné místo s logikou úprav: web i desktop (přes most) volají tytéž funkce, klienti jen
 * sbírají hodnoty z polí a ukazují výsledek. Každá funkce mění projekt na místě a vrací
 * `EditResult` — `ok: false` + `error` (text pro uživatele) znamená, že se nic nezměnilo.
 *
 * Pravidla:
 * - vazby programu (kroky, E-stop, blokování) jdou přes `Device.id` — přejmenování je nemění;
 * - VÝCHOZÍ texty (tag `<označení>_<signál>`, komentář `<popis> – <popisek signálu>` přesně jako
 *   `syncIO`, v kterémkoli jazyce UI) se při změně zařízení přepíšou, ručně změněné zůstanou;
 * - GUID a adresy (připnutí v sestavě hardwaru) se nemění; schválení se zneplatní samo otiskem.
 */
import { tr, N_, withLang, LANGS } from "./i18n.js";
import { PLAT, CLS, ACTS_FOR, DO_ROLES, devById, devSignals, syncIO, autoAddr, hasRange, maxRecord, validateProject, nextName, sanitizeTag, parseRecordsChecked, limitsRangeProblem, oneLine, lineSafe, canonIoAddr, MIN_STEP_S, REAL_MAX, } from "./model.js";
import { axisCfgOf, parseAxisPositionsChecked } from "./axis.js";
import { AXIS_FIELDS } from "./axis_gen.js";
import { canonAddr } from "./importers.js";
import { hwPlatform } from "./hardware.js";
import { reservedNameProblem, deviceGeneratedNames, instName } from "./names.js";
const fail = (error) => ({ ok: false, error });
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Kanonické adresy (Siemens notace) podle směru — stejně jako `validateProject`. */
const ADDR_RE = { DI: /^%I\d+\.[0-7]$/, DO: /^%Q\d+\.[0-7]$/, AI: /^%IW\d+$/, AO: /^%QW\d+$/ };
const ADDR_EX = { DI: "%I0.0", DO: "%Q0.0", AI: "%IW64", AO: "%QW64" };
const clone = (v) => JSON.parse(JSON.stringify(v));
const ioOfDev = (prj, id) => prj.io.filter(e => e.devId === id);
const issuesFor = (prj, where) => validateProject(prj).filter(i => where.has(i.where));
/* ------------------------------------------------------------------ výchozí texty */
/** Výchozí tag signálu (jako `syncIO`). */
export function defaultTag(d, sig) {
    return d.name + "_" + sig;
}
/** Výchozí komentář signálu v aktuálním jazyce (jako `syncIO`): „popis – popisek signálu“. */
export function defaultCmt(d, sig) {
    const s = devSignals(d).find(x => x[0] === sig);
    return lineSafe([d.desc, s ? s[2] : ""].filter(Boolean).join(" – "));
}
/** Výchozí komentáře signálu ve všech jazycích UI (komentář vzniká v jazyce platném při založení). */
function defaultCmts(d, sig) {
    const out = new Set();
    for (const l of Object.keys(LANGS))
        out.add(withLang(l, () => defaultCmt(d, sig)));
    return out;
}
/** Výchozí NC (rozpínací) vstupu podle popisu zařízení (jako `syncIO`). */
const defaultNc = (d, dir) => dir === "DI" && /\bNC\b/i.test(d.desc || "");
/**
 * Po změně zařízení (popis, jednotka) přepíše výchozí komentáře (a výchozí NC) jeho signálů
 * na výchozí podle nového stavu; ručně změněné nechá a vrátí jejich tagy.
 */
function refreshDefaultTexts(prj, before, after) {
    const kept = [];
    for (const e of ioOfDev(prj, after.id)) {
        if (defaultCmts(before, e.sig).has(e.cmt || ""))
            e.cmt = defaultCmt(after, e.sig);
        else
            kept.push(e.tag);
        const ncB = defaultNc(before, e.dir), ncA = defaultNc(after, e.dir);
        if (ncB !== ncA && !!e.nc === ncB)
            e.nc = ncA;
    }
    return kept;
}
/* ------------------------------------------------------------------ zařízení */
/**
 * Proč označení zařízení nejde použít (`null` = v pořádku). Stejná pravidla jako `validateProject`:
 * identifikátor IEC, nejvýš 32 znaků, bez „__“ a „_“ na konci, jedinečné bez ohledu na velikost písmen.
 */
export function deviceNameProblem(prj, name, skipId) {
    if (!NAME_RE.test(name))
        return tr("Označení zařízení musí být identifikátor — písmena bez diakritiky, číslice a _, na začátku písmeno (např. M1, Y2_A). Používá se v názvech instancí v kódu.");
    if (name.length > 32 || /__/.test(name) || /_$/.test(name))
        return tr("Označení zařízení může mít nejvýš 32 znaků, bez „__“ a bez „_“ na konci — vznikají z něj jména jako seqOpen_<označení> a Rockwell Logix povoluje 40 znaků.");
    const other = prj.devices.find(d => d.id !== skipId && d.name.toUpperCase() === name.toUpperCase());
    if (other)
        return tr("Označení {name} už má zařízení {other} — označení musí být jedinečné (velká a malá písmena se nerozlišují).", { name, other: other.name });
    /* jména odvozená z označení (instM1, seqRun_M1, manRun_M1…) nesmí kolidovat s tagem jiného signálu */
    const derived = new Set(Object.keys(CLS).flatMap(cls => deviceGeneratedNames({ name, cls })).map(n => n.toUpperCase()));
    const inst = instName({ name }).toUpperCase() + "_";
    const hit = prj.io.find(e => (derived.has(e.tag.toUpperCase()) || e.tag.toUpperCase().startsWith(inst)));
    if (hit)
        return tr("S označením {name} by generovaný program deklaroval jméno, které už má tag {tag} — změň tag nebo zvol jiné označení.", { name, tag: hit.tag });
    return null;
}
/** Nahradí označení `from` za `to` jako samostatné slovo klíče („drv:M1:dir“, „io:M1.fbk“, „STO_M1“). */
function renameToken(s, from, to) {
    const re = new RegExp("(^|[:_.#])" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[:.#])", "g");
    return s.replace(re, (_m, pre) => pre + to);
}
function renameKeys(rec, from, to) {
    if (!rec)
        return rec;
    const out = {};
    for (const [k, v] of Object.entries(rec))
        out[renameToken(k, from, to)] = v;
    return out;
}
/** Vstupy (označení DI) a skupiny výstupů („STO_M1“) bezpečnostní funkce; chybějící pole nezakládá. */
function renameRefs(f, from, to) {
    if (f.inputs)
        f.inputs = f.inputs.map(x => (x === from ? to : x));
    if (f.acts)
        f.acts = f.acts.map(a => renameToken(a, from, to));
}
/**
 * Přejmenuje zařízení. Výchozí tagy jeho signálů (`<staré>_<signál>`) dostanou nové označení,
 * ručně změněné zůstanou (vrací je v `keptTags`). GUID, adresy, kroky, E-stop a blokování
 * (vazby přes id) se nemění; výsledky oživení a úpravy bezpečnostních funkcí, které nesou
 * označení v klíči, se převedou na nové označení. Schválení se zneplatní samo (otisk obsahu).
 */
export function renameDevice(prj, devId, newName) {
    const d = devById(prj, devId);
    if (!d)
        return fail(tr("Zařízení nenalezeno."));
    const name = oneLine(newName);
    const old = d.name;
    if (name === old)
        return { ok: true, keptTags: [] };
    const problem = deviceNameProblem(prj, name, d.id);
    if (problem)
        return fail(problem);
    const mine = ioOfDev(prj, d.id);
    const keptTags = [];
    const renamed = new Map();
    for (const e of mine) {
        if (e.tag === defaultTag({ name: old }, e.sig))
            renamed.set(e, defaultTag({ name }, e.sig));
        else
            keptTags.push(e.tag);
    }
    /* nový výchozí tag nesmí kolidovat s tagem jiného signálu (velikost písmen se nerozlišuje) */
    const others = new Set(prj.io.filter(e => !renamed.has(e)).map(e => e.tag.toUpperCase()));
    for (const t of renamed.values())
        if (others.has(t.toUpperCase()))
            return fail(tr("Tag {tag} už v projektu je — přejmenování by vytvořilo duplicitní tag. Zvol jiné označení nebo nejdřív změň ten tag.", { tag: t }));
    for (const [e, t] of renamed)
        e.tag = t;
    d.name = name;
    prj.commissioning = renameKeys(prj.commissioning, old, name);
    const s = prj.safety;
    if (s) {
        if (s.fn) {
            s.fn = renameKeys(s.fn, old, name);
            for (const f of Object.values(s.fn || {}))
                renameRefs(f, old, name);
        }
        if (s.add)
            for (const f of s.add) {
                f.ref = renameToken(f.ref, old, name);
                renameRefs(f, old, name);
            }
    }
    return { ok: true, keptTags, issues: issuesFor(prj, new Set([name])) };
}
/** Změní popis zařízení; výchozí komentáře jeho signálů (a výchozí NC) se přepíšou, ruční zůstanou. */
export function setDeviceDesc(prj, devId, desc) {
    const d = devById(prj, devId);
    if (!d)
        return fail(tr("Zařízení nenalezeno."));
    const before = clone(d);
    d.desc = oneLine(desc); // popis zařízení je jednořádkový (komentáře I/O, kód, výkresy)
    const keptCmts = refreshDefaultTexts(prj, before, d);
    return { ok: true, keptCmts };
}
/** Volby zapnuté i bez zápisu v `Device.opt` (devSignals je bere jako `!== false`). */
const OPT_ON_BY_DEFAULT = {
    Motor: ["fbk"], Ventil: ["fbkOpen"], Vfd: ["ready", "fbk", "fault"], PosDrive: ["ready", "fault"], PropValve: ["fbk"],
};
/** Skutečný stav všech voleb třídy zařízení (chybějící klíč = výchozí podle `devSignals`). */
export function deviceOpts(d) {
    const out = {};
    const on = OPT_ON_BY_DEFAULT[d.cls] || [];
    for (const k of Object.keys(CLS[d.cls].opts)) {
        const v = (d.opt || {})[k];
        out[k] = v === undefined ? on.includes(k) : !!v;
    }
    return out;
}
/**
 * Změní volby zařízení (zpětná hlášení, vstup poruchy, směr…). Nové signály dostanou kanál
 * sestavy (`syncIO`), ostatní si adresu nechají; odebrané signály zmizí (`removed`). Kroky
 * zařízení s přechodem na zpětné hlášení, které přišly o vstup, vrací `affectedSteps`.
 */
export function setDeviceOpts(prj, devId, opt) {
    const d = devById(prj, devId);
    if (!d)
        return fail(tr("Zařízení nenalezeno."));
    const known = CLS[d.cls].opts;
    for (const k of Object.keys(opt || {}))
        if (!Object.prototype.hasOwnProperty.call(known, k))
            return fail(tr("Zařízení {dev} nemá volbu {opt}.", { dev: d.name, opt: k }));
    const before = ioOfDev(prj, d.id);
    const keysBefore = new Set(before.map(e => e.key));
    d.opt = { ...(d.opt || {}) };
    for (const [k, v] of Object.entries(opt || {}))
        d.opt[k] = !!v;
    syncIO(prj);
    const after = ioOfDev(prj, d.id);
    const keysAfter = new Set(after.map(e => e.key));
    const removedIo = before.filter(e => !keysAfter.has(e.key));
    const removed = removedIo.map(e => e.tag);
    const added = after.filter(e => !keysBefore.has(e.key)).map(e => e.tag);
    const affectedSteps = [];
    if (removedIo.some(e => e.dir === "DI" || e.dir === "AI"))
        prj.program.seq.forEach((s, i) => { if (s.dev === d.id && s.cond === "fbk" && s.act !== "wait")
            affectedSteps.push(i); });
    const where = new Set([d.name, ...affectedSteps.map(i => tr("krok {n}", { n: i + 1 }))]);
    return { ok: true, removed, added, affectedSteps, issues: issuesFor(prj, where) };
}
/**
 * Změní jednotku a rozsah analogového zařízení (analog, měnič, proporcionální ventil).
 * Výchozí komentáře signálů s jednotkou se přepíšou, ruční zůstanou.
 */
export function setDeviceRange(prj, devId, range) {
    const d = devById(prj, devId);
    if (!d)
        return fail(tr("Zařízení nenalezeno."));
    if (!hasRange(d.cls))
        return fail(tr("Zařízení {dev} nemá rozsah ani jednotku.", { dev: d.name }));
    const rmin = range.rmin === undefined ? d.rmin : Number(range.rmin);
    const rmax = range.rmax === undefined ? d.rmax : Number(range.rmax);
    const problem = rangeProblem(rmin, rmax) || (d.cls === "AnalogIn" ? limitsRangeProblem(d, rmin, rmax) : null);
    if (problem)
        return fail(problem);
    const before = clone(d);
    if (range.unit !== undefined)
        d.unit = oneLine(range.unit);
    d.rmin = rmin;
    d.rmax = rmax;
    const keptCmts = refreshDefaultTexts(prj, before, d);
    return { ok: true, keptCmts, issues: issuesFor(prj, new Set([d.name])) };
}
/* ------------------------------------------------------------------ kroky sekvence */
const NUM_FIELDS = ["sp", "rec", "pos", "vel", "acc", "dec"];
/**
 * Pole kroku, která akce zařízení používá (ostatní se zahodí — `normalizeProject` by je jinak měnil
 * mezi uložením a načtením; forenzní test 2026-10-10, N13). Bez známého zařízení = všechna pole.
 */
function stepFields(cls, act) {
    if (!cls)
        return [...NUM_FIELDS, "rev", "posRef"];
    if (cls === "Vfd")
        return act === "start" ? ["sp", "rev"] : [];
    if (cls === "PropValve")
        return ["sp"];
    if (cls === "PosDrive")
        return act === "posRecord" ? ["rec"] : [];
    if (cls === "Axis")
        return act === "waitInPos" ? [] : ["pos", "posRef", "vel", "acc", "dec"];
    return [];
}
/** Krok jen se známými poli (výdrž bez zařízení = dev 0, přechod časem); pole podle akce a třídy zařízení. */
function cleanStep(s, prj) {
    const dev = s.act === "wait" ? 0 : Number(s.dev) || 0;
    const out = dev ? { dev, act: s.act, cond: s.cond === "time" ? "time" : "fbk", timeS: Number(s.timeS) }
        : { dev: 0, act: "wait", cond: "time", timeS: Number(s.timeS) };
    if (!dev)
        return out;
    const keep = new Set(stepFields(prj ? devById(prj, dev)?.cls : undefined, out.act));
    for (const k of NUM_FIELDS)
        if (keep.has(k) && s[k] !== undefined && s[k] !== null && s[k] !== "")
            out[k] = Number(s[k]);
    if (out.rec !== undefined)
        out.rec = Math.round(out.rec);
    if (s.rev && keep.has("rev"))
        out.rev = true;
    if (s.posRef && keep.has("posRef"))
        out.posRef = oneLine(s.posRef);
    return out;
}
/**
 * Proč krok nejde uložit (`null` = v pořádku): zařízení existuje, akce patří jeho třídě, čas je
 * kladný (nejvýš 24 h), záznam pohonu v rozsahu, osa má cíl / dráhu / nenulovou rychlost.
 * Ostatní (rozsahy, limity os, platformy) hlásí kontrola návrhu.
 */
export function stepProblem(prj, step) {
    const s = cleanStep(step, prj);
    if (!(Number.isFinite(s.timeS) && s.timeS > 0 && s.timeS <= 86400))
        return tr("Čas kroku musí být kladné číslo sekund (nejvýš 86 400 s = 24 h).");
    if (s.timeS < MIN_STEP_S)
        return tr("Čas kroku musí být aspoň 0,01 s (jeden scan) — kratší čas kód zapíše jako T#0S.");
    if (s.act === "wait")
        return null;
    const d = devById(prj, s.dev);
    if (!d)
        return tr("Zařízení kroku nenalezeno.");
    const acts = ACTS_FOR[d.cls] || [];
    if (!acts.includes(s.act))
        return tr("Akce „{act}“ neplatí pro zařízení {dev} ({cls}).", { act: s.act, dev: d.name, cls: tr(CLS[d.cls].label) });
    if (d.cls === "DI" && s.cond !== "fbk")
        return tr("Krok čekání na vstup má vždy přechod na zpětné hlášení (vstup); čas je hlídací.");
    /* E-stop patří do uvolnění (enable) — čekání na něj by se v kódu a simulaci rozešlo (N4) */
    if (d.cls === "DI" && prj.program.estop === d.id)
        return tr("Krok nesmí čekat na vstup E-stopu {dev} — E-stop patří do uvolnění stroje, ne do sekvence.", { dev: d.name });
    if (d.cls === "PosDrive" && s.act === "posRecord" && !(Number.isInteger(s.rec) && s.rec >= 1 && s.rec <= maxRecord(d)))
        return tr("Číslo záznamu {dev} musí být 1 až {max} (záznam 0 = referenční poloha, jede se na ni akcí home).", { dev: d.name, max: maxRecord(d) });
    for (const k of NUM_FIELDS)
        if (s[k] !== undefined && !Number.isFinite(s[k]))
            return tr("Neplatné číslo v poli „{field}“.", { field: k });
    for (const k of NUM_FIELDS)
        if (s[k] !== undefined && Math.abs(s[k]) > REAL_MAX)
            return tr("Hodnota {par} je mimo rozsah REAL (±3,4E38) — PLC ji neuloží; zkontroluj jednotky.", { par: k });
    if (d.cls === "Axis") {
        if (s.act === "moveAbs" && s.posRef && !axisCfgOf(d).positions.some(x => x.name === s.posRef))
            return tr("Osa {dev} nemá pojmenovanou polohu „{name}“.", { dev: d.name, name: s.posRef });
        if ((s.act === "moveAbs" && !s.posRef || s.act === "moveRel") && s.pos === undefined)
            return tr("Zadej cílovou polohu / dráhu osy.");
        if (s.act === "velocity" && !(s.vel !== undefined && s.vel !== 0))
            return tr("Krok „rychlost“ osy {dev} potřebuje nenulovou rychlost (znaménko = směr).", { dev: d.name });
    }
    return null;
}
const stepWhere = (i) => new Set([tr("krok {n}", { n: i + 1 })]);
/**
 * Uloží změněný krok `index` (stejná kontrola jako při přidání). Krok s akcí (`act`) = celý nový krok
 * (formuláře posílají jen vyplněná pole); bez akce = částečná změna sloučená s původním krokem
 * (např. jen `{ timeS }` nebo `{ dev }` — akce zůstane a kontrola řekne, jestli ke zařízení patří).
 */
export function updateStep(prj, index, step) {
    const seq = prj.program.seq;
    if (!(Number.isInteger(index) && index >= 0 && index < seq.length))
        return fail(tr("Krok nenalezen."));
    if (step && step.act === undefined)
        step = { ...seq[index], ...step };
    const problem = stepProblem(prj, step);
    if (problem)
        return fail(problem);
    seq[index] = cleanStep(step, prj);
    return { ok: true, index, issues: issuesFor(prj, stepWhere(index)) };
}
/** Vloží krok za krok `afterIndex` (−1 = na začátek, za poslední / mimo = na konec). */
export function insertStep(prj, afterIndex, step) {
    const problem = stepProblem(prj, step);
    if (problem)
        return fail(problem);
    const seq = prj.program.seq;
    const at = Number.isInteger(afterIndex) && afterIndex >= -1 && afterIndex < seq.length ? afterIndex + 1 : seq.length;
    seq.splice(at, 0, cleanStep(step, prj));
    return { ok: true, index: at, issues: issuesFor(prj, stepWhere(at)) };
}
/** Zkopíruje krok `index` hned za něj. */
export function duplicateStep(prj, index) {
    const seq = prj.program.seq;
    if (!(Number.isInteger(index) && index >= 0 && index < seq.length))
        return fail(tr("Krok nenalezen."));
    seq.splice(index + 1, 0, clone(seq[index]));
    return { ok: true, index: index + 1, issues: issuesFor(prj, stepWhere(index + 1)) };
}
/* ------------------------------------------------------------------ I/O */
/** Změní tag signálu; prázdný = výchozí `<označení>_<signál>`. Nálezy (diakritika, duplicita) vrací v `issues`. */
export function setIoTag(prj, key, tag) {
    const e = prj.io.find(x => x.key === key);
    if (!e)
        return fail(tr("Signál nenalezen."));
    const d = devById(prj, e.devId);
    const t = oneLine(tag) || defaultTag({ name: d ? d.name : "IO" }, e.sig);
    /* klíčové slovo / standardní blok / operand PLC / jméno, které program deklaruje sám = kód se nepřeloží */
    const rp = reservedNameProblem(prj, t);
    if (rp)
        return fail(rp);
    e.tag = t;
    return { ok: true, value: e.tag, issues: issuesFor(prj, new Set([e.tag, e.tag.toUpperCase()])) };
}
/** Změní komentář signálu (prázdný = výchozí podle zařízení). */
export function setIoCmt(prj, key, cmt) {
    const e = prj.io.find(x => x.key === key);
    if (!e)
        return fail(tr("Signál nenalezen."));
    const d = devById(prj, e.devId);
    e.cmt = oneLine(cmt) || (d ? defaultCmt(d, e.sig) : ""); // komentář je jednořádkový (kód, CSV / TSV, XML)
    return { ok: true, value: e.cmt };
}
/**
 * Převede ruční adresu na kanonickou (Siemens notace) — přijme Siemens notaci (%I0.0, %Q1.7,
 * %IW64, %QW80; i bez % a německé E/A) a notaci platformy hardwaru, kterou jde jednoznačně
 * převést (CODESYS %IX0.0 / %QX0.0, Mitsubishi X10 / Y7). `%IW` / `%QW` se bere vždy jako Siemens
 * (bajtová adresa). Vrací `null`, když adresa nepasuje ke směru signálu.
 */
export function parseIoAddr(prj, dir, addr) {
    const a = String(addr ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!a)
        return "";
    const withPct = canonIoAddr(a.startsWith("%") ? a : "%" + a); // %Q00.1 → %Q0.1 (kontrola obsazenosti na kanonickém tvaru)
    if (ADDR_RE[dir].test(withPct))
        return withPct;
    const c = canonAddr(a, /^%[IQ]W/.test(a) ? undefined : hwPlatform(prj));
    return c && ADDR_RE[dir].test(canonIoAddr(c)) ? canonIoAddr(c) : null;
}
/**
 * Ruční adresa signálu: platná adresa kanál sestavy připne (adresa mimo sestavu zůstane
 * s upozorněním kontroly), prázdná = přidělit automaticky. Neplatný zápis nebo adresa, kterou
 * už má jiný signál, = chyba (projekt beze změny).
 */
export function setIoAddr(prj, key, addr) {
    const e = prj.io.find(x => x.key === key);
    if (!e)
        return fail(tr("Signál nenalezen."));
    const a = parseIoAddr(prj, e.dir, addr);
    if (a === null)
        return fail(tr("Adresa {addr} neodpovídá signálu {dir} — zapiš ji v Siemens notaci (např. {ex}) nebo v notaci platformy hardwaru {plat}.", { addr: String(addr).trim(), dir: e.dir, ex: ADDR_EX[e.dir], plat: PLAT[hwPlatform(prj)]?.name || hwPlatform(prj) }));
    if (a) {
        const m = /^%[IQ](W?)(\d+)/.exec(a);
        if (m && Number(m[2]) + (m[1] ? 1 : 0) > 65535)
            return fail(tr("Adresa {addr} leží mimo adresní prostor řídicích systémů (bajt nejvýš 65 535).", { addr: a }));
        const other = prj.io.find(x => x !== e && x.addr && canonIoAddr(x.addr) === a);
        if (other)
            return fail(tr("Adresu {addr} už má signál {tag}.", { addr: a, tag: other.tag }));
    }
    e.addr = a;
    autoAddr(prj, false);
    return { ok: true, value: e.addr, issues: issuesFor(prj, new Set([e.tag, e.addr])) };
}
/* ------------------------------------------------------------------ přidání, parametry a odebrání zařízení */
/** Proč rozsah analogu nejde použít (`null` = v pořádku): čísla, REAL, minimum < maximum. */
export function rangeProblem(rmin, rmax) {
    if (!Number.isFinite(rmin) || !Number.isFinite(rmax))
        return tr("Rozsah musí být číslo.");
    if (Math.abs(rmin) > REAL_MAX || Math.abs(rmax) > REAL_MAX)
        return tr("Meze rozsahu leží mimo rozsah REAL (±3,4E38) — PLC je neuloží; zkontroluj jednotky.");
    if (rmin >= rmax)
        return tr("Rozsah měření: minimum musí být menší než maximum.");
    return null;
}
/** Popisky číselných parametrů (klíče překladu). */
export const DEVICE_PARAM_LABEL = {
    limLo: N_("mez min"), limHi: N_("mez max"), setpoint: N_("žádaná hodnota"), rampS: N_("rampa [s]"),
    tol: N_("tolerance ±"), tolTimeS: N_("doba odchylky [s]"), selBits: N_("bity výběru záznamu"), travelS: N_("doba jízdy (model) [s]"),
};
/** Které číselné parametry třída má (pořadí = pořadí polí ve formuláři). */
export const DEVICE_PARAMS = {
    AnalogIn: ["limLo", "limHi"], AnalogOut: ["setpoint"], Vfd: ["setpoint", "rampS"],
    PropValve: ["setpoint", "rampS", "tol", "tolTimeS"], PosDrive: ["selBits", "travelS"],
};
const isSet = (v) => v !== undefined && v !== null && v !== "";
const noParam = (d, k) => tr("Zařízení {dev} nemá parametr {par}.", { dev: d.name || String(d.cls), par: k });
/**
 * Proč hodnoty parametrů zařízení nejdou uložit (`null` = v pořádku). Kontroluje jen klíče v `p`
 * (u mezí i druhou mez zařízení `d`): čísla a rozsah REAL, mez min < mez max, rampa 0–3600 s,
 * tolerance a doba odchylky ventilu, bity výběru záznamu 1–6, doba jízdy, role výstupu, pole osy.
 * Stejné meze jako kontrola návrhu (`validateProject`) — formuláře je hlásí hned při zadání.
 */
export function deviceParamsProblem(d, p) {
    p = p || {};
    const keys = DEVICE_PARAMS[d.cls] || [];
    for (const k of Object.keys(p)) {
        if (!isSet(p[k]))
            continue;
        if (k === "role") {
            if (d.cls !== "DO")
                return noParam(d, k);
            if (!Object.prototype.hasOwnProperty.call(DO_ROLES, p.role))
                return tr("Neznámá vazba výstupu na stav stroje: {role}.", { role: String(p.role) });
            continue;
        }
        if (k === "records") {
            if (d.cls !== "PosDrive" || !Array.isArray(p.records))
                return noParam(d, k);
            continue;
        }
        if (k === "unit") {
            if (d.cls !== "Axis" || typeof p.unit !== "string")
                return noParam(d, k);
            continue;
        }
        if (k === "axis") {
            if (d.cls !== "Axis" || typeof p.axis !== "object")
                return noParam(d, k);
            continue;
        }
        if (!keys.includes(k))
            return noParam(d, k);
        const v = p[k], label = tr(DEVICE_PARAM_LABEL[k]);
        if (typeof v !== "number" || !Number.isFinite(v))
            return tr("Neplatné číslo v poli „{field}“.", { field: label });
        if (Math.abs(v) > REAL_MAX)
            return tr("Hodnota {par} je mimo rozsah REAL (±3,4E38) — PLC ji neuloží; zkontroluj jednotky.", { par: label });
    }
    const val = (k) => k in p ? (isSet(p[k]) ? p[k] : undefined) : (Number.isFinite(d[k]) ? d[k] : undefined);
    const lo = val("limLo"), hi = val("limHi");
    if (("limLo" in p || "limHi" in p) && lo !== undefined && hi !== undefined && lo >= hi)
        return tr("Mez min musí být menší než mez max.");
    if (("limLo" in p || "limHi" in p) && d.cls === "AnalogIn") {
        const lp = limitsRangeProblem({ limLo: lo, limHi: hi }, Number(d.rmin), Number(d.rmax));
        if (lp)
            return lp;
    }
    const n = (k) => (isSet(p[k]) ? p[k] : undefined);
    const ramp = n("rampS"), tol = n("tol"), tolT = n("tolTimeS"), bits = n("selBits"), travel = n("travelS");
    if (ramp !== undefined && ramp < 0)
        return tr("Rampa musí být 0 (bez rampy) nebo kladný čas v sekundách.");
    if (ramp !== undefined && ramp > 3600)
        return tr("Rampa může být nejvýš 3600 s (delší rampa by ověření simulací zamrazila).");
    if (tol !== undefined && !(tol > 0))
        return tr("Povolená odchylka proporcionálního ventilu musí být kladná.");
    if (tolT !== undefined && !(tolT > 0 && tolT <= 3276.7))
        return tr("Doba odchylky proporcionálního ventilu musí být kladná a nejvýš 3 276,7 s (počítá se v taktech 0,1 s v proměnné INT).");
    if (bits !== undefined && !(Number.isInteger(bits) && bits >= 1 && bits <= 6))
        return tr("Počet bitů výběru záznamu musí být 1 až 6.");
    if (travel !== undefined && !(travel > 0 && travel <= 3600))
        return tr("Doba jízdy (model simulace) musí být kladná a nejvýš 3600 s.");
    if (isSet(p.axis)) {
        const ax = p.axis;
        for (const f of AXIS_FIELDS) {
            const v = ax[f.key];
            if (!isSet(v))
                continue;
            if (typeof v !== "number" || !Number.isFinite(v))
                return tr("Neplatné číslo v poli „{field}“.", { field: tr(f.label) });
            if (Math.abs(v) > REAL_MAX)
                return tr("Hodnota {par} je mimo rozsah REAL (±3,4E38) — PLC ji neuloží; zkontroluj jednotky.", { par: tr(f.label) });
        }
    }
    return null;
}
/** Zapíše parametry do zařízení (`null` / "" = odebrat klíč); osa se slučuje. Bez kontroly. */
function applyParams(d, p) {
    for (const [k, v] of Object.entries(p || {})) {
        if (v === undefined)
            continue;
        if (k === "axis") {
            if (!isSet(v)) {
                delete d.axis;
                continue;
            }
            const ax = { ...(d.axis || {}) };
            for (const [ak, av] of Object.entries(v)) {
                if (!isSet(av))
                    delete ax[ak];
                else
                    ax[ak] = ak === "drive" ? oneLine(String(av)) : clone(av);
            }
            d.axis = ax;
        }
        else if (k === "unit")
            d.unit = oneLine(String(v ?? "")) || "mm";
        else if (!isSet(v))
            delete d[k];
        else
            d[k] = clone(v);
    }
}
/**
 * Uloží parametry zařízení (meze, žádaná hodnota, rampa, tolerance, bity výběru záznamu, doba jízdy,
 * role výstupu, záznamy pohonu, konfigurace osy) po kontrole `deviceParamsProblem`. Změna bitů výběru
 * záznamu mění signály pohonu (`syncIO`, vrací `added` / `removed`).
 */
export function setDeviceParams(prj, devId, params) {
    const d = devById(prj, devId);
    if (!d)
        return fail(tr("Zařízení nenalezeno."));
    const problem = deviceParamsProblem(d, params || {});
    if (problem)
        return fail(problem);
    const before = ioOfDev(prj, d.id).map(e => e.tag);
    const bits = d.selBits;
    applyParams(d, params || {});
    if (d.cls !== "PosDrive" || d.selBits === bits)
        return { ok: true, issues: issuesFor(prj, new Set([d.name])) };
    syncIO(prj); // jiný počet bitů výběru záznamu = jiné signály pohonu
    const after = ioOfDev(prj, d.id).map(e => e.tag);
    return { ok: true, added: after.filter(t => !before.includes(t)), removed: before.filter(t => !after.includes(t)), issues: issuesFor(prj, new Set([d.name])) };
}
/**
 * Přidá zařízení po kontrole označení (`deviceNameProblem`), rozsahu (`rangeProblem`, jen třídy
 * s rozsahem) a parametrů (`deviceParamsProblem`). Dostane id, GUID a signály (`syncIO`); vrací `id`.
 */
export function addDevice(prj, nd) {
    if (!nd || !Object.prototype.hasOwnProperty.call(CLS, nd.cls))
        return fail(tr("Neznámá třída zařízení."));
    const { cls, name: rawName, desc, opt, unit, rmin: rawMin, rmax: rawMax, libType, ...params } = nd;
    const name = oneLine(rawName || "") || nextName(prj, cls);
    const nameErr = deviceNameProblem(prj, name);
    if (nameErr)
        return fail(nameErr);
    const ranged = hasRange(cls);
    const rmin = ranged ? Number(rawMin ?? 0) : 0, rmax = ranged ? Number(rawMax ?? 100) : cls === "Axis" ? 0 : 100;
    if (ranged) {
        const r = rangeProblem(rmin, rmax);
        if (r)
            return fail(r);
    }
    const d = {
        id: prj.nextId, name, cls, desc: oneLine(desc || ""),
        opt: Object.fromEntries(Object.entries(opt || {}).filter(([k]) => Object.prototype.hasOwnProperty.call(CLS[cls].opts, k)).map(([k, v]) => [k, !!v])),
        unit: ranged || cls === "Axis" ? oneLine(unit || "") || (cls === "Axis" ? "mm" : "") : "", rmin, rmax,
    };
    const problem = deviceParamsProblem(d, params);
    if (problem)
        return fail(problem);
    applyParams(d, params);
    if (typeof libType === "string" && libType)
        d.libType = libType;
    prj.nextId = d.id + 1;
    prj.devices.push(d);
    syncIO(prj); // signály, adresy ze sestavy a GUID
    return { ok: true, id: d.id, issues: issuesFor(prj, new Set([d.name])) };
}
/** Kde program zařízení používá: kroky sekvence (počet), vstup E-stop, blokovací vstup. */
export function deviceUsage(prj, devId) {
    const prog = prj.program;
    const steps = prog.seq.filter(s => s.act !== "wait" && s.dev === devId).length;
    const estop = prog.estop === devId, lock = (prog.interlocks || []).includes(devId);
    return { steps, estop, lock, used: steps > 0 || estop || lock };
}
/** Odebere zařízení i s jeho kroky sekvence, vazbou E-stop a blokováním; signály zmizí (`syncIO`). */
export function deleteDevice(prj, devId) {
    const d = devById(prj, devId);
    if (!d)
        return fail(tr("Zařízení nenalezeno."));
    const removed = ioOfDev(prj, devId).map(e => e.tag);
    prj.devices = prj.devices.filter(x => x.id !== devId);
    const prog = prj.program;
    prog.seq = prog.seq.filter(s => s.act === "wait" || !!devById(prj, s.dev));
    prog.interlocks = (prog.interlocks || []).filter(i => !!devById(prj, i));
    if (prog.estop !== "" && !devById(prj, prog.estop))
        prog.estop = "";
    syncIO(prj);
    return { ok: true, removed };
}
/** Text „nesrozumitelné části: …; duplicitní: …“ pro hlášku formuláře ("" = v pořádku). */
function parseProblems(bad, dup) {
    const out = [];
    if (bad.length)
        out.push(tr("nesrozumitelné části: {parts}", { parts: bad.slice(0, 5).join("; ") }));
    if (dup.length)
        out.push(tr("duplicitní: {items}", { items: dup.slice(0, 10).join(", ") }));
    return out.join("; ");
}
/** Záznamy pohonu z textu formuláře; nesrozumitelné části / duplicity = `error` (nic se tiše nezahodí). */
export function parseRecordsForm(text) {
    const r = parseRecordsChecked(text);
    const probs = parseProblems(r.bad, r.dup);
    return { records: r.records, error: probs ? tr("Záznamy pohonu nejsou uložené — {problems}. Zapiš je ve tvaru „1 = název @ poloha; 2 = …“.", { problems: probs }) : null };
}
/** Pojmenované polohy osy z textu formuláře; nesrozumitelné části / duplicity = `error`. */
export function parseAxisPositionsForm(text) {
    const r = parseAxisPositionsChecked(text);
    const probs = parseProblems(r.bad, r.dup);
    return { positions: r.positions, error: probs ? tr("Pojmenované polohy osy nejsou uložené — {problems}. Zapiš je ve tvaru „název @ poloha; …“.", { problems: probs }) : null };
}
/* ------------------------------------------------------------------ I/O hromadně */
/** Přečísluje adresy všech signálů od nuly podle sestavy hardwaru (ruční připnutí se zahodí). */
export function renumberIo(prj) {
    for (const e of prj.io)
        e.addr = "";
    autoAddr(prj, true);
    return { ok: true, count: prj.io.length };
}
/** Opraví tagy na přenositelné (ASCII identifikátor, `sanitizeTag`) a jedinečné; vrací počet změněných. */
export function fixIoTags(prj) {
    const used = new Set();
    let count = 0;
    for (const e of prj.io) {
        const base = sanitizeTag(e.tag);
        let t = base, n = 2;
        while (used.has(t))
            t = base + "_" + n++;
        used.add(t);
        if (t !== e.tag) {
            e.tag = t;
            count++;
        }
    }
    return { ok: true, count };
}
/* ------------------------------------------------------------------ model stroje (simulace) */
/** Výchozí časy modelu stroje (sim.ts): rozběh motoru, přestavení ventilu [s]. */
export const SIM_MODEL_DEFAULT = { motorDelay: 0.5, valveTravel: 1.0 };
/** Rozsah času modelu stroje zadaného v UI [s] (validace pustí nejvýš 3600 s; UI drží rozumnou mez). */
export const SIM_MODEL_RANGE = { min: 0.05, max: 600 };
/**
 * Časy modelu stroje `prj.sim` (rozběh motoru, přestavení ventilu) — ovlivňují ověření simulací,
 * takt a dokumenty. Web i desktop zadávají totéž: číslo 0,05…600 s (desetinná čárka i tečka);
 * prázdné / nezadané pole = beze změny.
 */
export function setSimModel(prj, model) {
    const cur = { motorDelay: prj.sim?.motorDelay ?? SIM_MODEL_DEFAULT.motorDelay, valveTravel: prj.sim?.valveTravel ?? SIM_MODEL_DEFAULT.valveTravel };
    const next = { ...cur };
    for (const k of ["motorDelay", "valveTravel"]) {
        const raw = model[k];
        if (raw === undefined || raw === null || String(raw).trim() === "")
            continue;
        const v = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
        if (!Number.isFinite(v) || v < SIM_MODEL_RANGE.min || v > SIM_MODEL_RANGE.max)
            return fail(tr("Čas modelu stroje zadej jako číslo {min} až {max} s.", { min: SIM_MODEL_RANGE.min, max: SIM_MODEL_RANGE.max }));
        next[k] = v;
    }
    if (next.motorDelay === cur.motorDelay && next.valveTravel === cur.valveTravel)
        return { ok: true, count: 0 };
    prj.sim = next;
    return { ok: true, count: 1 };
}
/* ------------------------------------------------------------------ projekt */
/**
 * Projekt bez obsahu (žádná zařízení, název ani popis) — jeho nahrazení (nový projekt, otevření
 * souboru, příklad) se neptá. Konverzaci kroku AI návrh (stav klienta) přidá klient.
 */
export function projectIsEmpty(prj) {
    return !(prj.devices || []).length && !String(prj.meta?.name || "").trim() && !String(prj.meta?.desc || "").trim();
}
const AI_ACTS = ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow",
    "moveAbs", "moveRel", "velocity", "halt", "waitInPos"];
/** Číselná pole návrhu AI podle třídy (aiNorm je pustí jen u správné třídy; tady ještě jednou). */
const AI_DEV_FIELDS = DEVICE_PARAMS;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
/** První volné označení třídy, které projde `deviceNameProblem` (jedinečné i bez ohledu na velikost písmen). */
function freeName(prj, cls) {
    const pre = CLS[cls].prefix;
    let n = 1;
    while (deviceNameProblem(prj, pre + n))
        n++;
    return pre + n;
}
/**
 * Převezme návrh AI do projektu (nahradí zařízení, E-stop, blokování a sekvenci; takt jen když ho
 * AI navrhla). Zařízení, které v návrhu zůstalo (stejné označení a třída), si nechá VŠECHNA svá pole
 * (GUID — identita pro export EPLAN —, knihovní typ, záznamy, konfiguraci osy…) a přepíšou se jen
 * hodnoty, které AI poslala; jeho signály si nechají adresu, komentář, NC a GUID (úpravy z kroku I/O),
 * změněný popis se propíše do komentáře. Duplicitní (i jen velikostí písmen) nebo neplatné označení
 * od AI dostane další volné (`renamed`). Kroky na neznámé zařízení se zahodí, čekání jen na třídu DI.
 * Vrací `issues` = chyby kontroly návrhu po převzetí.
 */
export function applyAiProposal(prj, pr) {
    if (!pr || !Array.isArray(pr.devices) || !pr.devices.some(a => a && Object.prototype.hasOwnProperty.call(CLS, a.cls)))
        return fail(tr("Návrh AI neobsahuje žádná zařízení."));
    const oldIo = prj.io;
    const oldByKey = new Map(prj.devices.map(d => [d.name + "|" + d.cls, d]));
    const oldById = new Map(prj.devices.map(d => [d.id, d]));
    prj.devices = [];
    prj.io = [];
    prj.nextId = 1;
    const byAiName = new Map(), byName = new Map();
    const renamed = [];
    for (const a of pr.devices) {
        if (!a || !Object.prototype.hasOwnProperty.call(CLS, a.cls))
            continue;
        const aiName = oneLine(String(a.name || ""));
        let name = aiName;
        if (!name || deviceNameProblem(prj, name)) {
            name = freeName(prj, a.cls);
            if (aiName)
                renamed.push({ from: aiName, to: name });
        }
        const od = oldByKey.get(name + "|" + a.cls);
        const nd = od ? clone(od) : {};
        Object.assign(nd, {
            id: prj.nextId++, name, cls: a.cls, desc: oneLine(String(a.desc || "")),
            opt: a.opt && typeof a.opt === "object" ? { ...a.opt } : {},
            unit: oneLine(String(a.unit || "")), rmin: finite(a.rmin) ? a.rmin : 0, rmax: finite(a.rmax) ? a.rmax : 100,
        });
        for (const f of AI_DEV_FIELDS[a.cls] || [])
            if (finite(a[f]))
                nd[f] = a[f];
        if (a.cls === "DO" && a.role && Object.prototype.hasOwnProperty.call(DO_ROLES, a.role))
            nd.role = a.role;
        if (a.cls === "PosDrive" && Array.isArray(a.records))
            nd.records = clone(a.records);
        if (typeof a.libType === "string" && a.libType)
            nd.libType = a.libType;
        /* konfigurace osy: pole, která AI neposlala (pohon, ryv…), zůstanou z původní */
        if (a.cls === "Axis" && a.axis && typeof a.axis === "object")
            nd.axis = { ...(nd.axis || {}), ...clone(a.axis) };
        prj.devices.push(nd);
        if (aiName && !byAiName.has(aiName))
            byAiName.set(aiName, nd);
        byName.set(name, nd);
    }
    /* I/O zařízení, které zůstalo (stejné označení a třída): převzít — jen nové id a klíč */
    prj.io = oldIo.flatMap(e => {
        const od = oldById.get(e.devId), nd = od && byName.get(od.name);
        if (!od || !nd || nd.cls !== od.cls)
            return [];
        const ne = { ...e, devId: nd.id, key: nd.id + ":" + e.sig };
        if (od.desc && nd.desc && nd.desc !== od.desc && typeof ne.cmt === "string" && ne.cmt.startsWith(od.desc))
            ne.cmt = nd.desc + ne.cmt.slice(od.desc.length);
        return [ne];
    });
    syncIO(prj);
    const dev = (n) => byAiName.get(oneLine(String(n || "")));
    const es = dev(pr.estop);
    prj.program.estop = es && es.cls === "DI" ? es.id : "";
    prj.program.interlocks = [...new Set((pr.interlocks || []).map(dev)
            .filter((d) => !!d && d.cls === "DI" && d.id !== prj.program.estop).map(d => d.id))];
    const dropped = [];
    prj.program.seq = (pr.seq || []).flatMap((s, i) => {
        if (!s || typeof s !== "object")
            return [];
        const act = AI_ACTS.includes(s.act) ? s.act : "wait";
        const d = dev(s.dev);
        if (act !== "wait" && !d) {
            dropped.push(tr("Krok {n} návrhu ({act}) odkazuje na neznámé zařízení {dev} — vynechán.", { n: i + 1, act, dev: oneLine(String(s.dev ?? "")) }));
            return [];
        }
        /* akce musí patřit třídě zařízení (start u analogu = prázdný krok; N6), čekání ne na E-stop (N4) */
        if (d && act !== "wait" && !(ACTS_FOR[d.cls] || []).includes(act)) {
            dropped.push(tr("Krok {n} návrhu: akce „{act}“ neplatí pro zařízení {dev} ({cls}) — vynechán.", { n: i + 1, act, dev: d.name, cls: tr(CLS[d.cls].label) }));
            return [];
        }
        if (d && act !== "wait" && d.id === prj.program.estop) {
            dropped.push(tr("Krok {n} návrhu čeká na vstup E-stopu {dev} — E-stop patří do uvolnění stroje, krok vynechán.", { n: i + 1, dev: d.name }));
            return [];
        }
        const wait = act === "waitOn" || act === "waitOff";
        const devId = act !== "wait" && d ? d.id : 0;
        const cond = wait ? "fbk" : act === "wait" ? "time" : s.cond === "time" ? "time" : "fbk";
        const st = { dev: devId, act, cond, timeS: finite(s.timeS) ? s.timeS : 1 };
        if (finite(s.sp))
            st.sp = s.sp;
        if (Number.isInteger(s.rec))
            st.rec = s.rec;
        if (s.rev === true)
            st.rev = true;
        if (typeof s.posRef === "string" && s.posRef)
            st.posRef = oneLine(s.posRef);
        for (const f of ["pos", "vel", "acc", "dec"])
            if (finite(s[f]))
                st[f] = s[f];
        return [cleanStep(st, prj)];
    });
    if (finite(pr.takt) && pr.takt > 0)
        prj.meta.takt = pr.takt;
    return { ok: true, renamed, dropped, issues: validateProject(prj).filter(i => i.level === "error") };
}
