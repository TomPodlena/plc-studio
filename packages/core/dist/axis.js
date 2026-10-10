/**
 * PLCdesk — servoosa (třída Axis, fáze 2b): konfigurace osy a JEDINÝ model „firmwaru osy“
 * (technologický objekt TIA, osa NC TwinCATu, osa SoftMotion, osa Sysmac, osa Logix) a pohonu.
 *
 * Model běží nad pamětí Float64Array (objekt osy + instance bloků MC) — tutéž funkci volá
 * simulátor návrhu (sim.ts, zrcadlo FB_Axis) i emulátor běhu (emu/compile.ts: bloky MC_* a instrukce
 * Logix jako standardní bloky dialektu nad pamětí přeloženého programu). Obě strany tak počítají
 * pohyb, hotovo, chyby i referování stejně a emulátor porovná jen chování KÓDU FB_Axis.
 *
 * Model (zjednodušení — uvádí ho i dokumentace):
 *  - lichoběžníkový profil (rychlost, zrychlení, zpomalení; ryv se neuvažuje), v poloze = žádaná
 *    poloha dosažena a skutečná v toleranci `posTol`;
 *  - pohon sleduje žádanou polohu přesně; zaseknutá mechanika (zásah frozen) = skutečná poloha
 *    stojí → chyba sledování nad `followMax` → porucha osy (odebrání povolení);
 *  - porucha pohonu a ztráta komunikace = porucha osy hned (ztráta komunikace zruší i referování);
 *  - referování = jízda na referenční polohu výchozí rychlostí, pak „referováno“;
 *  - odebrání povolení (MC_Power Enable = FALSE, MSF) zastaví osu okamžitě (skutečný pohon brzdí
 *    rampou podle StopMode / konfigurace);
 *  - softwarové limity platí jen u referované osy: cíl mimo limity = povel odmítnut, rychlostní
 *    pohyb na limitu = porucha osy.
 * Sémantika bloků podle PLCopen a manuálů výrobců (zdroje u šablon v axis_gen.ts): povel na
 * náběžnou hranu Execute, Done / Error / CommandAborted drží při Execute TRUE, jinak jeden cyklus,
 * nový povel jiné instance přeruší běžící (CommandAborted), opakovaná hrana na běžící instanci se
 * ignoruje (Tc2_MC2), MC_Stop blokuje další povely, dokud je Execute TRUE.
 */
const num = (v) => {
    const n = Number(v);
    return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? n : undefined;
};
/** Konfigurace osy s výchozími hodnotami (chybějící pole). */
export function axisCfgOf(d) {
    /* konfigurace ze souboru může být cokoli (řetězec, seznam) — pak výchozí (test odolnosti 2026-10-08) */
    const a = d && d.axis && typeof d.axis === "object" && !Array.isArray(d.axis) ? d.axis : {};
    const vMax = num(a.vMax) && num(a.vMax) > 0 ? num(a.vMax) : 500;
    const aMax = num(a.aMax) && num(a.aMax) > 0 ? num(a.aMax) : 2000;
    const dMax = num(a.dMax) && num(a.dMax) > 0 ? num(a.dMax) : aMax;
    const vDef = num(a.vDef) && num(a.vDef) > 0 ? Math.min(num(a.vDef), vMax) : vMax / 2;
    const homePos = num(a.homePos) ?? 0;
    const limNeg = num(a.limNeg), limPos = num(a.limPos);
    const span = limNeg !== undefined && limPos !== undefined ? limPos - limNeg : 400;
    const start = num(a.startPos) ?? homePos + Math.max(1, Math.abs(span) * 0.1);
    return {
        vMax, aMax, dMax, jerk: num(a.jerk) && num(a.jerk) > 0 ? num(a.jerk) : 0, vDef,
        ...(limNeg !== undefined ? { limNeg } : {}), ...(limPos !== undefined ? { limPos } : {}),
        homePos, posTol: num(a.posTol) && num(a.posTol) > 0 ? num(a.posTol) : 0.1,
        followMax: num(a.followMax) && num(a.followMax) > 0 ? num(a.followMax) : 5,
        jogVel: num(a.jogVel) && num(a.jogVel) > 0 ? Math.min(num(a.jogVel), vMax) : Math.max(vDef / 5, 1e-3),
        startPos: start,
        ...(a.drive ? { drive: String(a.drive) } : {}),
        positions: (Array.isArray(a.positions) ? a.positions : []).filter(p => p && typeof p === "object" && p.name && Number.isFinite(Number(p.pos))).map(p => ({ name: String(p.name), pos: Number(p.pos) })),
    };
}
/** Pojmenované polohy osy jako text pro formuláře: „název @ poloha; …“. */
export function axisPositionsText(ps) {
    return (ps || []).map(p => p.name + " @ " + p.pos).join("; ");
}
/** Zpět z textu (středníky / řádky „název @ poloha“). Neplatné části a duplicitní názvy přeskočí. */
export function parseAxisPositions(s) {
    return parseAxisPositionsChecked(s).positions;
}
/** Jako `parseAxisPositions`, navíc nesrozumitelné části (`bad`) a duplicitní názvy (`dup`, platí první). */
export function parseAxisPositionsChecked(s) {
    const out = [], bad = [], dup = [];
    for (const part of String(s || "").split(/[;\n]+/)) {
        if (!part.trim())
            continue;
        const m = part.match(/^\s*([^@]*?)\s*[@=:]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
        if (!m || !m[1]) {
            bad.push(part.replace(/[\x00-\x1F\x7F]+/g, " ").trim());
            continue;
        }
        if (!out.some(x => x.name === m[1]))
            out.push({ name: m[1], pos: +m[2].replace(",", ".") });
        else
            dup.push(m[1]);
    }
    return { positions: out, bad, dup };
}
/** Jméno objektu osy v kódu (technologický objekt, AXIS_REF, osa SoftMotion / Sysmac, tag osy Logix). */
export function axisObjName(dev) { return "Ax_" + dev.name; }
/* ================================================================ paměť objektu osy */
/**
 * Sloty objektu osy. Viditelné členy platformy (ActualPosition, StatusBits.HomingDone, Status.Error…)
 * jsou v emulátoru jen jiná jména týchž slotů (emu/compile.ts `AXIS_MEMBERS`).
 */
export const AX = {
    POS: 0, VEL: 1, SP: 2, SPV: 3, PWR: 4, HOMED: 5, ERR: 6, ERRID: 7, STILL: 8,
    KIND: 9, TGT: 10, V: 11, A: 12, D: 13, SER: 14, NEXT: 15, DONE: 16, INVEL: 17, ERRSER: 18, LOCK: 19,
    /** vstupy modelu stroje (zásahy): porucha pohonu, ztráta komunikace, zaseknutá mechanika */
    FAULT: 20, LOST: 21, STUCK: 22,
    /** viditelné: komunikace v pořádku, chyba sledování, stavové slovo S7-1500 */
    COMMOK: 23, FERR: 24, SW: 25,
    /** Tc2_MC2: Axis.Status (obnovuje jen ReadStatus) */
    TC_ERR: 26, TC_ERRID: 27, TC_HOMED: 28, TC_STILL: 29,
    /** povolení směrů (Tc2_MC2 Enable_Positive / Enable_Negative) */
    EPOS: 30, ENEG: 31,
    /** Logix: adresa MOTION_INSTRUCTION běžícího povelu (−1 = žádná), poslední zpomalení pohybu */
    MI: 32, LASTD: 33,
    /** konfigurace */
    VMAX: 34, AMAX: 35, DMAX: 36, VDEF: 37, LIMN: 38, LIMP: 39, HASN: 40, HASP: 41, HOME: 42, TOL: 43, FMAX: 44,
    /** vstup modelu stroje: pohon nepřipraven (STO aktivní, bez silového napájení) — regulace nenaběhne, chyba se nehlásí */
    NRDY: 45,
};
export const AX_SIZE = 46;
/** Druh povelu osy. */
export const KIND = { IDLE: 0, ABS: 1, VEL: 3, HALT: 4, HOME: 5 };
/** Příčina poruchy osy (ERRID; v kódu platformy jsou čísla výrobce — tady jen pro model a hlášení). */
export const AXERR = { DRIVE: 1, FOLLOW: 2, COMM: 3, LIMIT: 4 };
/** Kód odmítnutí povelu (chyba bloku MC). */
export const MCERR = { NOTREADY: 101, LOCKED: 102, PARAM: 103, LIMIT: 104, NOERROR: 105, ACTIVE: 106 };
const EPS = 1e-9;
/** Počáteční stav objektu osy (konfigurace, poloha po zapnutí, povolení směrů). */
export function axisInit(m, a, c) {
    for (let i = 0; i < AX_SIZE; i++)
        m[a + i] = 0;
    m[a + AX.POS] = c.startPos;
    m[a + AX.SP] = c.startPos;
    m[a + AX.COMMOK] = 1;
    m[a + AX.MI] = -1;
    m[a + AX.STILL] = 1;
    /* konfigurace ve float32 — FB_Axis ji předává jako REAL (cfgVel…), model ji bere z TO / osy: obojí stejně */
    const f = Math.fround;
    m[a + AX.VMAX] = f(c.vMax);
    m[a + AX.AMAX] = f(c.aMax);
    m[a + AX.DMAX] = f(c.dMax);
    m[a + AX.VDEF] = f(c.vDef);
    m[a + AX.LIMN] = f(c.limNeg ?? 0);
    m[a + AX.LIMP] = f(c.limPos ?? 0);
    m[a + AX.HASN] = c.limNeg !== undefined ? 1 : 0;
    m[a + AX.HASP] = c.limPos !== undefined ? 1 : 0;
    m[a + AX.HOME] = f(c.homePos);
    m[a + AX.TOL] = f(c.posTol);
    m[a + AX.FMAX] = f(c.followMax);
    m[a + AX.LASTD] = f(c.dMax);
    derive(m, a);
}
/** Odvozené viditelné stavy: klid, stavové slovo S7-1500 (bit 0 Enable, 1 Error, 5 HomingDone, 7 Standstill). */
function derive(m, a) {
    const still = Math.abs(m[a + AX.SPV]) < EPS && Math.abs(m[a + AX.VEL]) < EPS ? 1 : 0;
    m[a + AX.STILL] = still;
    m[a + AX.SW] = (m[a + AX.PWR] ? 1 : 0) | (m[a + AX.ERR] ? 2 : 0) | (m[a + AX.HOMED] ? 32 : 0) | (still ? 128 : 0);
}
/** Logix: běžící povel skončil / byl přerušen — bity MOTION_INSTRUCTION (IP dolů, PC při dokončení). */
function miEnd(m, a, completed) {
    const mi = m[a + AX.MI];
    if (mi >= 0) {
        m[mi + MI.IP] = 0;
        if (completed) {
            m[mi + MI.PC] = 1;
            m[mi + MI.DN] = 1;
        }
    }
    m[a + AX.MI] = -1;
}
function powerOff(m, a) {
    if (m[a + AX.KIND] !== KIND.IDLE)
        miEnd(m, a, false);
    m[a + AX.PWR] = 0;
    m[a + AX.KIND] = KIND.IDLE;
    m[a + AX.SER] = 0;
    m[a + AX.SPV] = 0;
    m[a + AX.SP] = m[a + AX.POS];
    m[a + AX.VEL] = 0;
}
/** Porucha osy: odebrání povolení (reakce „remove enable“ TO / NC), běžící povel končí chybou. */
function setErr(m, a, code) {
    if (m[a + AX.ERR])
        return;
    m[a + AX.ERR] = 1;
    m[a + AX.ERRID] = code;
    m[a + AX.ERRSER] = m[a + AX.SER];
    powerOff(m, a);
    if (code === AXERR.COMM) {
        m[a + AX.HOMED] = 0;
        m[a + AX.COMMOK] = 0;
    }
}
/**
 * Začátek povelu. Vrací číslo povelu (> 0), nebo zápornou chybu odmítnutí. `mi` = adresa
 * MOTION_INSTRUCTION u Logixu (bity IP / PC), jinak −1.
 */
function start(m, a, kind, tgt, v, acc, dec, mi = -1) {
    if (!m[a + AX.PWR] || m[a + AX.ERR])
        return -MCERR.NOTREADY;
    if (m[a + AX.LOCK] && kind !== KIND.HALT)
        return -MCERR.LOCKED;
    if (!(v > 0) && kind !== KIND.HALT && !(kind === KIND.VEL && v === 0))
        return -MCERR.PARAM;
    if (!(acc > 0) || !(dec > 0))
        return -MCERR.PARAM;
    if (kind === KIND.ABS && m[a + AX.HOMED]) {
        if ((m[a + AX.HASP] && tgt > m[a + AX.LIMP] + EPS) || (m[a + AX.HASN] && tgt < m[a + AX.LIMN] - EPS))
            return -MCERR.LIMIT;
    }
    if (m[a + AX.KIND] !== KIND.IDLE)
        miEnd(m, a, false);
    const ser = m[a + AX.NEXT] = m[a + AX.NEXT] + 1;
    m[a + AX.SER] = ser;
    m[a + AX.KIND] = kind;
    m[a + AX.TGT] = tgt;
    m[a + AX.V] = v;
    m[a + AX.A] = acc;
    m[a + AX.D] = dec;
    m[a + AX.INVEL] = 0;
    m[a + AX.MI] = mi;
    if (kind !== KIND.HALT)
        m[a + AX.LASTD] = dec;
    return ser;
}
/** Hotový povel. */
function complete(m, a) {
    m[a + AX.DONE] = m[a + AX.SER];
    if (m[a + AX.KIND] === KIND.HOME)
        m[a + AX.HOMED] = 1;
    m[a + AX.KIND] = KIND.IDLE;
    miEnd(m, a, true);
}
/**
 * Jeden takt modelu osy (po scanu programu, `dt` = perioda scanu): zásahy (porucha pohonu,
 * ztráta komunikace), profil žádané polohy, pohon (sleduje / zaseknutý), chyba sledování, limity.
 */
export function axisTick(m, a, dt) {
    if (m[a + AX.LOST] && !m[a + AX.ERR])
        setErr(m, a, AXERR.COMM);
    if (m[a + AX.FAULT] && !m[a + AX.ERR])
        setErr(m, a, AXERR.DRIVE);
    if (!m[a + AX.LOST])
        m[a + AX.COMMOK] = 1;
    if (!m[a + AX.PWR]) {
        m[a + AX.SPV] = 0;
        m[a + AX.SP] = m[a + AX.POS];
        m[a + AX.VEL] = 0;
        m[a + AX.FERR] = 0;
        derive(m, a);
        return;
    }
    const kind = m[a + AX.KIND];
    let sp = m[a + AX.SP], spv = m[a + AX.SPV];
    const toward0 = (dec) => { const s = Math.max(0, Math.abs(spv) - dec * dt); spv = spv < 0 ? -s : s; };
    if (kind === KIND.ABS || kind === KIND.HOME) {
        const tgt = m[a + AX.TGT], v = m[a + AX.V], acc = m[a + AX.A], dec = m[a + AX.D];
        const dist = tgt - sp, dir = dist >= 0 ? 1 : -1;
        if (spv * dir < -EPS) {
            toward0(dec);
            sp += spv * dt;
        }
        else {
            const vAllowed = Math.sqrt(2 * dec * Math.abs(dist));
            const vNew = Math.min(v, Math.abs(spv) + acc * dt, vAllowed);
            const step = vNew * dt;
            if (step >= Math.abs(dist) - EPS) {
                sp = tgt;
                spv = 0;
            }
            else {
                sp += dir * step;
                spv = dir * vNew;
            }
        }
    }
    else if (kind === KIND.VEL) {
        const vt = m[a + AX.TGT], acc = m[a + AX.A], dec = m[a + AX.D];
        /* zrychlení při růstu velikosti ve stejném směru, jinak zpomalení */
        const up = Math.abs(vt) > Math.abs(spv) && (spv === 0 || Math.sign(vt) === Math.sign(spv));
        const r = (up ? acc : dec) * dt;
        if (Math.abs(vt - spv) <= r + EPS)
            spv = vt;
        else
            spv += vt > spv ? r : -r;
        sp += spv * dt;
        if (spv === vt)
            m[a + AX.INVEL] = m[a + AX.SER];
    }
    else if (kind === KIND.HALT) {
        toward0(m[a + AX.D]);
        sp += spv * dt;
    }
    else
        spv = 0;
    /* softwarové limity referované osy (rychlostní pohyb, ruční pojezd, zastavování) */
    if (m[a + AX.HOMED] && (kind === KIND.VEL || kind === KIND.HALT)) {
        if ((m[a + AX.HASP] && sp > m[a + AX.LIMP]) || (m[a + AX.HASN] && sp < m[a + AX.LIMN])) {
            sp = Math.min(Math.max(sp, m[a + AX.HASN] ? m[a + AX.LIMN] : sp), m[a + AX.HASP] ? m[a + AX.LIMP] : sp);
            m[a + AX.SP] = sp;
            m[a + AX.SPV] = 0;
            if (!m[a + AX.STUCK]) {
                m[a + AX.POS] = sp;
                m[a + AX.VEL] = 0;
            }
            setErr(m, a, AXERR.LIMIT);
            derive(m, a);
            return;
        }
    }
    m[a + AX.SP] = sp;
    m[a + AX.SPV] = spv;
    if (!m[a + AX.STUCK]) {
        m[a + AX.POS] = sp;
        m[a + AX.VEL] = spv;
    }
    else
        m[a + AX.VEL] = 0;
    const ferr = Math.abs(sp - m[a + AX.POS]);
    m[a + AX.FERR] = ferr;
    if (ferr > m[a + AX.FMAX]) {
        setErr(m, a, AXERR.FOLLOW);
        derive(m, a);
        return;
    }
    /* hotovo: polohování / referování = žádaná v cíli a skutečná v okně; zastavení = klid */
    if ((kind === KIND.ABS || kind === KIND.HOME) && sp === m[a + AX.TGT] && spv === 0 && Math.abs(m[a + AX.POS] - m[a + AX.TGT]) <= m[a + AX.TOL] + EPS)
        complete(m, a);
    else if (kind === KIND.HALT && spv === 0)
        complete(m, a);
    derive(m, a);
}
/** Rozložení instance bloku v simulátoru (jedno pro všechny druhy bloků). */
export const MC_GEN = {
    axis: -1, exe: 0, en: 1, reg: 2, drv: 3, epos: -1, eneg: -1, pos: 6, vel: 7, acc: 8, dec: 9,
    done: 10, busy: 11, abort: 12, err: 13, errId: 14, status: 15, inVel: 16, prev: 17, ser: 18, st: 19, shown: 20,
};
export const MC_GEN_SIZE = 21;
const ST_IDLE = 0, ST_BUSY = 1, ST_DONE = 2, ST_ABORT = 3, ST_ERR = 4;
function rd(m, b, off, dflt = 0) { return off >= 0 ? m[b + off] : dflt; }
function wr(m, b, off, v) { if (off >= 0)
    m[b + off] = v; }
/** Rychlost / zrychlení / zpomalení povelu podle výkladu platformy (NaN = neplatné → odmítnout). */
function dyn(m, a, p, which, x) {
    const cfg = which === "v" ? m[a + AX.VDEF] : which === "a" ? m[a + AX.AMAX] : m[a + AX.DMAX];
    if (p === "s15")
        return x < 0 ? cfg : x > 0 ? x : NaN;
    if (p === "s12")
        return which === "v" ? (x > 0 ? x : NaN) : cfg;
    if (p === "tc") {
        if (which === "v")
            return x > 0 ? x : NaN;
        if (which === "dh")
            return x > 0 ? x : m[a + AX.LASTD];
        return x > 0 ? x : x === 0 ? cfg : NaN;
    }
    if (p === "om")
        return x > 0 ? x : which === "v" ? NaN : 1e12; // 0 = bez rampy (skok)
    return x > 0 ? x : NaN; // sm3 / sml: vždy kladné
}
/**
 * Jedno volání bloku MC (emulátor: blok dialektu, simulátor: zrcadlo FB_Axis). `b` = instance,
 * `a` = objekt osy (u emulátoru odkaz z členu Axis), `M` = rozložení instance.
 */
export function mcCall(kind, m, b, a, M, p) {
    if (kind === "readStatus") {
        m[a + AX.TC_ERR] = m[a + AX.ERR];
        m[a + AX.TC_ERRID] = m[a + AX.ERRID];
        m[a + AX.TC_HOMED] = m[a + AX.HOMED];
        m[a + AX.TC_STILL] = m[a + AX.STILL];
        return;
    }
    if (kind === "power") {
        const en = rd(m, b, M.en) !== 0 && (M.reg < 0 || rd(m, b, M.reg) !== 0) && (M.drv < 0 || rd(m, b, M.drv) !== 0);
        if (M.epos >= 0) {
            m[a + AX.EPOS] = rd(m, b, M.epos) ? 1 : 0;
            m[a + AX.ENEG] = rd(m, b, M.eneg) ? 1 : 0;
        }
        else {
            m[a + AX.EPOS] = 1;
            m[a + AX.ENEG] = 1;
        }
        if (en && !m[a + AX.PWR] && !m[a + AX.ERR] && !m[a + AX.LOST] && !m[a + AX.NRDY]) {
            m[a + AX.PWR] = 1;
            m[a + AX.SP] = m[a + AX.POS];
            m[a + AX.SPV] = 0;
        }
        if (!en && m[a + AX.PWR])
            powerOff(m, a);
        wr(m, b, M.status, m[a + AX.PWR] && en ? 1 : 0);
        wr(m, b, M.busy, en ? 1 : 0);
        wr(m, b, M.err, en && m[a + AX.ERR] ? 1 : 0);
        wr(m, b, M.errId, en && m[a + AX.ERR] ? m[a + AX.ERRID] : 0);
        derive(m, a);
        return;
    }
    const exe = rd(m, b, M.exe) !== 0, prev = m[b + M.prev] !== 0;
    m[b + M.prev] = exe ? 1 : 0;
    let st = m[b + M.st];
    if (kind === "stop")
        m[a + AX.LOCK] = exe ? 1 : 0;
    if (exe && !prev && st !== ST_BUSY) {
        m[b + M.shown] = 0;
        let r;
        if (kind === "reset") {
            if (!m[a + AX.ERR])
                r = p === "sml" ? -MCERR.NOERROR : 1;
            else if (m[a + AX.FAULT] || m[a + AX.LOST])
                r = -MCERR.ACTIVE;
            else {
                m[a + AX.ERR] = 0;
                m[a + AX.ERRID] = 0;
                m[a + AX.ERRSER] = 0;
                m[a + AX.COMMOK] = 1;
                m[a + AX.FERR] = 0;
                derive(m, a);
                r = 1;
            }
            st = r > 0 ? ST_DONE : ST_ERR;
            m[b + M.ser] = 0;
            wr(m, b, M.errId, r > 0 ? 0 : -r);
        }
        else {
            const pos = rd(m, b, M.pos, m[a + AX.HOME]);
            if (kind === "home")
                r = start(m, a, KIND.HOME, M.pos >= 0 ? pos : m[a + AX.HOME], m[a + AX.VDEF], m[a + AX.AMAX], m[a + AX.DMAX]);
            else if (kind === "halt" || kind === "stop")
                r = start(m, a, KIND.HALT, 0, 0, 1, dyn(m, a, p, "dh", rd(m, b, M.dec, -1)));
            else {
                const v = dyn(m, a, p, "v", rd(m, b, M.vel, -1)), acc = dyn(m, a, p, "a", rd(m, b, M.acc, -1)), dec = dyn(m, a, p, "d", rd(m, b, M.dec, -1));
                if (kind === "abs")
                    r = start(m, a, KIND.ABS, pos, v, acc, dec);
                else if (kind === "rel")
                    r = start(m, a, KIND.ABS, m[a + AX.SP] + rd(m, b, M.pos), v, acc, dec);
                else {
                    /* směr: pevná instance kladná / záporná (SoftMotion Light: znaménko rychlosti) */
                    const raw = rd(m, b, M.vel);
                    const vel = p === "sml" ? raw : kind === "velP" ? Math.abs(raw) : -Math.abs(raw);
                    const ok = vel >= 0 ? m[a + AX.EPOS] : m[a + AX.ENEG];
                    r = ok ? start(m, a, KIND.VEL, vel, Math.abs(vel), acc, dec) : -MCERR.NOTREADY;
                }
            }
            if (r > 0) {
                st = ST_BUSY;
                m[b + M.ser] = r;
                wr(m, b, M.errId, 0);
            }
            else {
                st = ST_ERR;
                m[b + M.ser] = 0;
                wr(m, b, M.errId, -r);
            }
        }
    }
    if (st === ST_BUSY) {
        const ser = m[b + M.ser];
        if (m[a + AX.DONE] === ser && (kind === "home" || kind === "abs" || kind === "rel" || kind === "halt" || kind === "stop"))
            st = ST_DONE;
        else if (m[a + AX.SER] !== ser)
            st = m[a + AX.ERRSER] === ser ? ST_ERR : m[a + AX.DONE] === ser ? ST_DONE : ST_ABORT;
    }
    /* výstupy Done / Error / CommandAborted: drží při Execute TRUE, jinak jeden cyklus */
    let show = st;
    if (!exe && st >= ST_DONE) {
        if (m[b + M.shown]) {
            st = ST_IDLE;
            show = ST_IDLE;
        }
        else
            m[b + M.shown] = 1;
    }
    m[b + M.st] = st;
    const ser = m[b + M.ser];
    wr(m, b, M.done, show === ST_DONE ? 1 : 0);
    wr(m, b, M.busy, show === ST_BUSY || (kind === "stop" && exe && show === ST_DONE) ? 1 : 0);
    wr(m, b, M.abort, show === ST_ABORT ? 1 : 0);
    wr(m, b, M.err, show === ST_ERR ? 1 : 0);
    if (show !== ST_ERR)
        wr(m, b, M.errId, 0);
    wr(m, b, M.inVel, show === ST_BUSY && (kind === "velP" || kind === "velN") && m[a + AX.INVEL] === ser && ser > 0 ? 1 : 0);
}
/* ================================================================ instrukce Logix */
/** Bity MOTION_INSTRUCTION (sloty struktury v emulátoru). */
export const MI = { EN: 0, DN: 1, ER: 2, PC: 3, IP: 4, ERR: 5, EXERR: 6 };
export const MI_SIZE = 7;
/**
 * Provedení instrukce pohybu Logix (MOTION-RM002): v ST se instrukce vykoná při každém
 * průchodu (proto ji kód volá jen na hranu). EN a DN / ER hned; IP běží; PC = proces dokončen
 * (nastaví model osy při dokončení). MAFR při trvající příčině vrací ER (model — příčinu
 * v manuálu „znovu zapůsobí“). Rychlost / zrychlení: jednotky 0 = j/s(²), 1 = % maxima.
 */
export function lxExec(name, m, a, mi, args) {
    m[mi + MI.EN] = 1;
    m[mi + MI.DN] = 0;
    m[mi + MI.ER] = 0;
    m[mi + MI.PC] = 0;
    m[mi + MI.IP] = 0;
    m[mi + MI.ERR] = 0;
    const err = (code) => { m[mi + MI.ER] = 1; m[mi + MI.ERR] = code; };
    const rate = (val, units, max) => units === 1 ? val / 100 * max : val;
    if (name === "MSO") {
        if (m[a + AX.ERR] || m[a + AX.LOST]) {
            err(20);
            return;
        }
        /* pohon nepřipraven (STO): model — instrukce doběhne, regulace se nezapne (AOI hlídá stav osy časem T#5S);
           skutečnou reakci Logix (ER s kódem pohonu) je nutné ověřit na hardwaru */
        if (!m[a + AX.PWR] && !m[a + AX.NRDY]) {
            m[a + AX.PWR] = 1;
            m[a + AX.SP] = m[a + AX.POS];
            m[a + AX.SPV] = 0;
        }
        m[a + AX.EPOS] = 1;
        m[a + AX.ENEG] = 1;
        m[mi + MI.DN] = 1;
        derive(m, a);
        return;
    }
    if (name === "MSF") {
        if (m[a + AX.PWR])
            powerOff(m, a);
        m[mi + MI.DN] = 1;
        derive(m, a);
        return;
    }
    if (name === "MAFR") {
        if (m[a + AX.ERR] && (m[a + AX.FAULT] || m[a + AX.LOST])) {
            err(20);
            return;
        }
        m[a + AX.ERR] = 0;
        m[a + AX.ERRID] = 0;
        m[a + AX.ERRSER] = 0;
        m[a + AX.COMMOK] = 1;
        m[a + AX.FERR] = 0;
        m[mi + MI.DN] = 1;
        derive(m, a);
        return;
    }
    let r;
    if (name === "MAH")
        r = start(m, a, KIND.HOME, m[a + AX.HOME], m[a + AX.VDEF], m[a + AX.AMAX], m[a + AX.DMAX], mi);
    else if (name === "MAM") {
        /* MAM(Axis, MI, MoveType, Position, Speed, SpeedUnits, AccelRate, AccelUnits, DecelRate, DecelUnits, …) */
        const [type, pos, spd, su, acc, au, dec, du] = args;
        const v = rate(spd, su, m[a + AX.VMAX]), ac = rate(acc, au, m[a + AX.AMAX]), dc = rate(dec, du, m[a + AX.DMAX]);
        r = type === 0 || type === 1 ? start(m, a, KIND.ABS, type === 0 ? pos : m[a + AX.SP] + pos, v, ac, dc, mi) : -MCERR.PARAM;
    }
    else if (name === "MAJ") {
        /* MAJ(Axis, MI, Direction, Speed, SpeedUnits, AccelRate, AccelUnits, DecelRate, DecelUnits, …) */
        const [dir, spd, su, acc, au, dec, du] = args;
        const v = rate(spd, su, m[a + AX.VMAX]);
        r = start(m, a, KIND.VEL, dir === 1 ? -v : v, v, rate(acc, au, m[a + AX.AMAX]), rate(dec, du, m[a + AX.DMAX]), mi);
    }
    else if (name === "MAS") {
        /* MAS(Axis, MI, StopType, ChangeDecel, DecelRate, DecelUnits, …): bez změny zpomalení = maximum osy */
        const [, chg, dec, du] = args;
        r = start(m, a, KIND.HALT, 0, 0, 1, chg ? rate(dec, du, m[a + AX.DMAX]) : m[a + AX.DMAX], mi);
    }
    else {
        err(13);
        return;
    }
    if (r < 0) {
        err(r === -MCERR.NOTREADY ? 5 : 13);
        return;
    }
    m[mi + MI.DN] = name === "MAH" ? 0 : 1;
    m[mi + MI.IP] = 1;
}
