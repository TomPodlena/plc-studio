/**
 * PLCdesk — plán a protokol oživení.
 *
 * `commissioningPlan(prj)` navrhne kroky oživení po fázích: rozvaděč a napájení, smyčkový test
 * každého I/O signálu, pohony, analogy, E-stop a blokování (jen jako signály standardního
 * programu), ruční režim, automatická sekvence krok po kroku, vybrané poruchové stavy z matice
 * stavů, takt a parametry a bezpečnostní validace (dodá bezpečnostní modul přes
 * `registerCommissioningProvider`; bez něj zůstane otevřený bod, který je potřeba doložit).
 *
 * Výsledky kroků jsou v `Project.commissioning` (ok / nok / na, kdo, kdy, poznámka, naměřeno).
 * Plán i uzavření oživení jsou položky ke schválení (provider „commission“ v approval.ts).
 * Simulace ani generátor se tu nemění — plán z nich jen čte (seqCond, ověření, matice stavů).
 */
import { devById, ioOf, interlockDevs, enableInputs, modules, addrOrd, isMotionClass, devSp, tolOf, tolTicksOf } from "./model.js";
import { seqCond, manVarOf } from "./codegen.js";
import { stepTitle, stepCondText, stepWatchdog, T_MOTOR_FBK, T_VALVE_TRAVEL, T_POS_ACK, T_POS_MOVE } from "./sim.js";
import { tr, N_, today, formatDateTime } from "./i18n.js";
import { contentHash, registerApprovalProvider, approvalStamp, verifyDesign, verifyDesignCached, isVerified, APPROVAL_FILE } from "./approval.js";
/** Fáze oživení (klíče překladu). */
export const COMMISSION_PHASES = {
    1: N_("Rozvaděč a napájení"),
    2: N_("Smyčkový test I/O"),
    3: N_("Pohony"),
    4: N_("Analogové signály"),
    5: N_("E-stop a blokování (signály standardního programu)"),
    6: N_("Ruční režim"),
    7: N_("Automatická sekvence"),
    8: N_("Poruchové stavy"),
    9: N_("Takt a parametry"),
    10: N_("Bezpečnostní validace"),
};
const providers = [];
/**
 * Přihlásí zdroj dalších kroků oživení (bezpečnostní modul → fáze 10: validace bezpečnostních
 * funkcí). Kroky se zařadí do své fáze za vestavěné kroky. Dokud žádný zdroj nedodá krok fáze 10,
 * plán v ní má otevřený bod „Validace bezpečnostních funkcí“. Stejné `name` nahradí dřívější
 * zdroj; vrací funkci pro odhlášení.
 */
export function registerCommissioningProvider(fn, name) {
    const nm = name || "provider-" + providers.length + "-" + Date.now();
    const at = providers.findIndex(p => p.name === nm);
    if (at >= 0)
        providers[at] = { name: nm, fn };
    else
        providers.push({ name: nm, fn });
    return () => { const i = providers.findIndex(p => p.name === nm && p.fn === fn); if (i >= 0)
        providers.splice(i, 1); };
}
export function commissioningProviders() { return providers.map(p => p.name); }
/* ------------------------------------------------------------ plán */
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
/** Nejkratší hlídací čas kroků sekvence, které zařízení `d` dávají akci `acts` (a číslo kroku). */
function stepWd(prj, d, acts) {
    let best = null;
    prj.program.seq.forEach((s, i) => {
        if (s.dev !== d.id || !acts.includes(s.act))
            return;
        const wd = stepWatchdog(prj, s);
        if (wd !== null && (!best || wd < best.wd))
            best = { wd, n: i + 1 };
    });
    return best;
}
/** Text limitu doby akce: 80 % hlídacího času kroku, nejvýš 80 % timeoutu bloku. */
function limitText(w, T) {
    if (w && 0.8 * w.wd < 0.8 * T) {
        const lim = r1(0.8 * w.wd);
        return { lim, text: tr("do {lim} s (hlídací čas kroku {n} je {wd} s, rezerva 20 %; timeout bloku {T} s)", { lim, n: w.n, wd: w.wd, T }) };
    }
    const lim = r1(0.8 * T);
    return { lim, text: tr("do {lim} s (timeout bloku {T} s, rezerva 20 %)", { lim, T }) };
}
function ioStep(prj, e, role) {
    const d = devById(prj, e.devId);
    const dn = d ? d.name : "?";
    const base = { id: "io:" + dn + "." + e.sig, phase: 2, title: e.tag + " (" + (e.addr || "—") + ")" + (e.cmt ? " — " + e.cmt : ""), signals: [e.tag], devId: d?.id, data: { tag: e.tag, addr: e.addr || "", dir: e.dir, nc: !!e.nc } };
    const p = { tag: e.tag, dev: dn, desc: d?.desc || dn };
    if (e.dir === "DI") {
        const expectNC = tr("PLC čte {tag} = TRUE v klidu (rozpínací kontakt) a FALSE při aktivaci.", p);
        const expectNO = tr("PLC čte {tag} = FALSE v klidu a TRUE při aktivaci (kontrolka vstupu na modulu svítí).", p);
        if (d?.cls === "Motor" && e.sig === "fbkRunning")
            return { ...base, how: tr("Bez spuštění pohonu sepni pomocný kontakt stykače / hlášení chodu měniče {dev} (ručně na stykači bez zátěže nebo propojkou na svorce).", p), expect: tr("PLC čte {tag} = TRUE jen po dobu sepnutí.", p) };
        if (d?.cls === "Motor" && e.sig === "fault")
            return { ...base, how: tr("Vybav jistič motoru / vyvolej poruchu měniče {dev}.", p), expect: tr("PLC čte {tag} = TRUE při poruše a FALSE po resetu jističe.", p) };
        if (d?.cls === "Ventil") {
            const pos = e.sig === "fbkClosed" ? tr("zavřeno") : tr("otevřeno");
            return { ...base, how: tr("Přestav válec {dev} ručně (ruční ovládání na ventilu, zajištěné okolí) do polohy {pos}.", { ...p, pos }), expect: tr("PLC čte {tag} = TRUE jen v koncové poloze {pos}.", { ...p, pos }) };
        }
        const how = role.estop ? tr("Stiskni a uvolni tlačítko nouzového zastavení {dev}.", p)
            : role.lock ? tr("Otevři / přeruš {desc} a vrať do provozní polohy.", p)
                : tr("Aktivuj signál na stroji (snímač, tlačítko, kontakt): {desc}.", p);
        return { ...base, how, expect: e.nc ? expectNC : expectNO };
    }
    if (e.dir === "DO") {
        const how = tr("Vynuť výstup {tag} z PLC (tabulka sledování / force) krátkým pulsem; mechanika odpojená nebo zajištěná.", p);
        if (d?.cls === "Motor")
            return { ...base, how, expect: tr("Sepne stykač / povel měniče {dev}; po zrušení vynucení odpadne.", p) };
        if (d?.cls === "Ventil")
            return { ...base, how, expect: tr("Sepne cívka ventilu {dev} (LED na konektoru) a válec přejede do polohy otevřeno; po zrušení se vrátí.", p) };
        return { ...base, how, expect: tr("Sepne {desc}; po zrušení vynucení vypne.", p) };
    }
    const span = d ? d.rmax - d.rmin : 0;
    const v = (k) => d ? r3(d.rmin + k * span) : k * 100;
    const q = { ...p, v0: v(0), v50: v(0.5), v100: v(1), unit: d?.unit || "" };
    if (e.dir === "AI")
        return { ...base, how: tr("Místo snímače připoj kalibrátor a nastav 0 %, 50 % a 100 % rozsahu signálu.", q), expect: tr("PLC ukáže {v0}, {v50} a {v100} {unit} (surová hodnota 0 / 13824 / 27648).", q), data: { ...base.data, range: [d?.rmin, d?.rmax] } };
    return { ...base, how: tr("Zapiš z PLC 0 %, 50 % a 100 % rozsahu ({v0} / {v50} / {v100} {unit}).", q), expect: tr("Na svorce změřeno 0 / 50 / 100 % signálu; akční člen reaguje odpovídajícím směrem.", q), data: { ...base.data, range: [d?.rmin, d?.rmax] } };
}
/**
 * Plán oživení: kroky po fázích 1–10 (vestavěné + ze zdrojů v registru). Fáze 7 (doby ze
 * simulace) a 8 (výběr z matice stavů) potřebují ověření simulací; `{ cheap: true }` ho
 * nespouští — bez spočítaného ověření pak fáze 8 chybí a doby jsou „—“ (jen náhled, ne pro otisk).
 */
export function commissioningPlan(prj, opts = {}) {
    const out = [];
    const add = (s) => out.push(s);
    const mods = modules(prj);
    const seq = prj.program.seq;
    const modList = mods.map(m => m.dir + m.idx).join(", ") || "—";
    /* 1) rozvaděč a napájení — obecné body */
    add({ id: "p1:visual", phase: 1, title: tr("Vizuální kontrola rozvaděče"), how: tr("Zkontroluj osazení a zapojení podle výkresů (moduly {mods}, svorkovnice X1…X{n}), utažení svorek, značení vodičů a krytí.", { mods: modList, n: mods.length }), expect: tr("Osazení a zapojení odpovídá dokumentaci; odchylky zapsané do skutečného provedení."), signals: [], data: { mods: modList } });
    add({ id: "p1:pe", phase: 1, title: tr("Ochranné pospojení a izolace"), how: tr("Bez zapnutého napájení změř ochranné pospojení a izolační odpor podle předpisů pro elektrickou výzbroj."), expect: tr("Hodnoty v mezích, zapsané v revizní zprávě."), signals: [] });
    add({ id: "p1:24v", phase: 1, title: tr("Napájení 24 V DC"), how: tr("Zapni přívod, změř napětí a polaritu 24 V na rozvodu a na I/O modulech, zkontroluj jištění okruhů."), expect: tr("24 V ±10 % na všech odběrech, jištění odpovídá výkresu."), signals: [] });
    add({ id: "p1:plc", phase: 1, title: tr("PLC a I/O moduly"), how: tr("Zapni PLC, nahraj HW konfiguraci a program (platformy: {plats}).", { plats: prj.platforms.join(", ") || "—" }), expect: tr("CPU v RUN bez chyb, moduly {mods} bez diagnostické chyby.", { mods: modList }), signals: [], data: { mods: modList } });
    add({ id: "p1:backup", phase: 1, title: tr("Výchozí záloha"), how: tr("Před oživením ulož zálohu programu a projektu."), expect: tr("Záloha s datem uložená."), signals: [] });
    /* 2) smyčkový test — každý signál */
    const es = devById(prj, prj.program.estop);
    const locks = new Set(interlockDevs(prj).map(d => d.id));
    for (const e of [...prj.io].sort((a, b) => (a.dir === b.dir ? addrOrd(a) - addrOrd(b) : ["DI", "DO", "AI", "AO"].indexOf(a.dir) - ["DI", "DO", "AI", "AO"].indexOf(b.dir)))) {
        add(ioStep(prj, e, { estop: !!es && e.devId === es.id, lock: locks.has(e.devId) }));
    }
    /* 3) pohony */
    for (const d of prj.devices) {
        const io = ioOf(prj, d), p = { dev: d.name, desc: d.desc || d.name };
        if (d.cls === "Motor") {
            add({ id: "drv:" + d.name + ":dir", phase: 3, devId: d.id, title: tr("{dev}: směr otáčení", p), how: tr("V ručním režimu krátce spusť {dev} (manRun_{dev}) s odpojenou nebo zajištěnou mechanikou.", p), expect: tr("Směr odpovídá technologii; při opačném směru prohoď fáze / parametr měniče."), signals: ["manRun_" + d.name, ...(io.outRun ? [io.outRun.tag] : [])] });
            if (io.fbkRunning) {
                const w = stepWd(prj, d, ["start"]), l = limitText(w, T_MOTOR_FBK);
                add({ id: "drv:" + d.name + ":fbk", phase: 3, devId: d.id, title: tr("{dev}: rozběh a hlášení chodu", p), how: tr("Spusť {dev} ručně a změř dobu od povelu {out} do hlášení {fbk}; pak zastav a ověř, že hlášení odpadne.", { ...p, out: io.outRun?.tag || "", fbk: io.fbkRunning.tag }), expect: tr("Hlášení chodu {when}. Naměřenou dobu zapiš.", { when: l.text }), signals: [io.outRun?.tag || "", io.fbkRunning.tag].filter(Boolean), data: { wd: w, T: T_MOTOR_FBK } });
            }
            if (io.fault)
                add({ id: "drv:" + d.name + ":fault", phase: 3, devId: d.id, title: tr("{dev}: porucha pohonu", p), how: tr("Za ručního chodu vybav jistič / poruchu měniče {dev}.", p), expect: tr("Blok {dev} v poruše (alarm A_{dev}_FAULT), výstup vypnutý; po resetu jističe a kvitaci (cmdAck) jde znovu spustit.", p), signals: [io.fault.tag, "cmdAck"] });
        }
        else if (d.cls === "Ventil") {
            const w = stepWd(prj, d, ["open", "close"]), l = limitText(w, T_VALVE_TRAVEL);
            const sig = [io.outOpen?.tag, io.fbkOpen?.tag, io.fbkClosed?.tag].filter(Boolean);
            add({ id: "drv:" + d.name + ":travel", phase: 3, devId: d.id, title: tr("{dev}: přestavení a koncové polohy", p), how: tr("V ručním režimu otevři a zavři {dev} (manOpen_{dev}) a změř dobu přestavení oběma směry.", p), expect: tr("Koncová poloha {when}; koncáky odpovídají skutečné poloze. Naměřené doby zapiš.", { when: l.text }), signals: ["manOpen_" + d.name, ...sig], data: { wd: w, T: T_VALVE_TRAVEL, sig } });
            if (io.fbkOpen)
                add({ id: "drv:" + d.name + ":hold", phase: 3, devId: d.id, title: tr("{dev}: hlídání držené polohy", p), how: tr("V poloze otevřeno krátce přeruš koncák {tag} (odpoj konektor snímače).", { tag: io.fbkOpen.tag }), expect: tr("Porucha bloku (alarm A_{dev}_POS), výstup vypnutý; po obnovení a kvitaci jde znovu ovládat.", p), signals: [io.fbkOpen.tag, "cmdAck"] });
        }
        else if (d.cls === "Vfd") {
            const q = { ...p, min: d.rmin, max: d.rmax, unit: d.unit || "", sp: devSp(d) };
            const sig = [io.outRun?.tag, io.rawSpeed?.tag, io.atSpeed?.tag].filter(Boolean);
            add({ id: "drv:" + d.name + ":param", phase: 3, devId: d.id, title: tr("{dev}: parametry měniče", p), how: tr("V měniči nastav povel ze svorek, žádanou z analogového vstupu ({min}–{max} {unit} = 0–100 % signálu), reléové výstupy připraven / porucha / otáčky dosaženy a rampy (s rampou v PLC krátké).", q), expect: tr("Parametry zapsané v protokolu měniče, záloha parametrů uložená."), signals: [] });
            add({ id: "drv:" + d.name + ":dir", phase: 3, devId: d.id, title: tr("{dev}: směr otáčení a žádaná", p), how: tr("V ručním režimu spusť {dev} (manRun_{dev}) s odpojenou nebo zajištěnou mechanikou.", p), expect: tr("Směr odpovídá technologii; měnič ukazuje {sp} {unit}, hlášení „otáčky dosaženy“ po doběhu rampy.", q), signals: ["manRun_" + d.name, ...sig] });
            if (io.fault)
                add({ id: "drv:" + d.name + ":fault", phase: 3, devId: d.id, title: tr("{dev}: porucha měniče", p), how: tr("Za ručního chodu vyvolej poruchu měniče {dev} (např. externí porucha parametrem / odpojení vstupu).", p), expect: tr("Blok {dev} v poruše (alarm A_{dev}_FAULT), chod vypnut; po odstranění a kvitaci (cmdAck) jde znovu spustit.", p), signals: [io.fault.tag, "cmdAck"] });
        }
        else if (d.cls === "PosDrive") {
            const recs = (d.records || []).map(r => r.no + " = " + (r.name || "?") + (Number.isFinite(r.pos) ? " (" + r.pos + ")" : "")).join(", ") || "—";
            add({ id: "drv:" + d.name + ":param", phase: 3, devId: d.id, title: tr("{dev}: tabulka záznamů v řadiči", p), how: tr("V konfiguračním programu řadiče nastav I/O režim (výběr záznamu bity, start, referování, HALT) a záznamy: {recs}.", { ...p, recs }), expect: tr("Záznamy a polarita HALT odpovídají projektu; záloha parametrů řadiče uložená."), signals: [] });
            add({ id: "drv:" + d.name + ":home", phase: 3, devId: d.id, title: tr("{dev}: referenční jízda", p), how: tr("V ručním režimu dej povel manHome_{dev} se zajištěným pracovním prostorem osy.", p), expect: tr("Osa najede na referenci, hlášení „referováno“ a „v poloze“; doba do {move} s.", { ...p, move: T_POS_MOVE }), signals: ["manHome_" + d.name, ...[io.homed?.tag, io.inPos?.tag].filter(Boolean)] });
            add({ id: "drv:" + d.name + ":records", phase: 3, devId: d.id, title: tr("{dev}: jízda na záznamy", p), how: tr("V automatickém cyklu krok po kroku (nebo z HMI servisně) projeď všechny záznamy a změř polohu.", p), expect: tr("Poloha každého záznamu odpovídá tabulce; start potvrzen do {ack} s, jízda bez poruchy.", { ack: T_POS_ACK }), signals: [io.outStart?.tag, io.inPos?.tag].filter(Boolean) });
            add({ id: "drv:" + d.name + ":halt", phase: 3, devId: d.id, title: tr("{dev}: přerušení jízdy (HALT)", p), how: tr("Za jízdy vypni AUTO (přerušení sekvence).", p), expect: tr("Výstup HALT sepne a osa zastaví; nová jízda až novým povelem."), signals: [io.outHalt?.tag, "modeAuto"].filter(Boolean) });
            if (io.fault)
                add({ id: "drv:" + d.name + ":fault", phase: 3, devId: d.id, title: tr("{dev}: porucha pohonu", p), how: tr("Vyvolej poruchu řadiče {dev} (např. odpojení motoru / chybový vstup).", p), expect: tr("Blok {dev} v poruše (alarm A_{dev}_FAULT); po odstranění a kvitaci (cmdAck) jde znovu ovládat.", p), signals: [io.fault.tag, "cmdAck"] });
        }
        else if (d.cls === "PropValve") {
            const q = { ...p, min: d.rmin, max: d.rmax, unit: d.unit || "", tol: tolOf(d), t: tolTicksOf(d) / 10 };
            add({ id: "drv:" + d.name + ":scale", phase: 3, devId: d.id, title: tr("{dev}: žádaná a skutečná hodnota", p), how: tr("V ručním režimu zapni {dev} (manOn_{dev}) a porovnej žádanou s manometrem / průtokoměrem ve 3 bodech rozsahu {min}–{max} {unit}.", q), expect: tr("Odchylka v toleranci ventilu; skutečná hodnota v PLC odpovídá měřidlu."), signals: ["manOn_" + d.name, ...[io.rawSp?.tag, io.rawAct?.tag].filter(Boolean)] });
            if (io.rawAct)
                add({ id: "drv:" + d.name + ":dev", phase: 3, devId: d.id, title: tr("{dev}: hlídání odchylky", p), how: tr("Při zapnutém ventilu zavři přívod vzduchu / média (nebo odpoj zpětnou vazbu).", p), expect: tr("Po {t} s porucha bloku (alarm A_{dev}_DEV), žádaná na minimum; po obnovení a kvitaci jde znovu zapnout.", q), signals: [io.rawAct.tag, "cmdAck"] });
        }
    }
    /* 4) analogy */
    for (const d of prj.devices) {
        const io = ioOf(prj, d), p = { dev: d.name, desc: d.desc || d.name, unit: d.unit || "", min: d.rmin, max: d.rmax };
        if (d.cls === "AnalogIn") {
            const tag = io.raw ? [io.raw.tag] : [];
            add({ id: "ana:" + d.name + ":scale", phase: 4, devId: d.id, title: tr("{dev}: měření proti referenci", p), how: tr("Porovnej hodnotu v PLC s referenčním měřidlem v provozu ve 2–3 bodech pracovního rozsahu.", p), expect: tr("Odchylka v toleranci snímače; rozsah {min}–{max} {unit} odpovídá štítku snímače.", p), signals: tag, data: { range: [d.rmin, d.rmax], unit: d.unit || "" } });
            const hi = Number.isFinite(d.limHi), lo = Number.isFinite(d.limLo);
            if (hi || lo) {
                const what = [hi ? tr("nad horní mez {v} {unit}", { v: d.limHi, unit: d.unit || "" }) : "", lo ? tr("pod dolní mez {v} {unit}", { v: d.limLo, unit: d.unit || "" }) : ""].filter(Boolean).join("; ");
                const al = [hi ? "A_" + d.name + "_HI" : "", lo ? "A_" + d.name + "_LO" : ""].filter(Boolean).join(", ");
                add({ id: "ana:" + d.name + ":limits", phase: 4, devId: d.id, title: tr("{dev}: hlídané meze", p), how: tr("Kalibrátorem nastav hodnotu {what}.", { what }), expect: tr("Porucha stroje (alarm {alarms}), sekvence zastavená; kvitace zabere až po návratu do mezí.", { alarms: al }), signals: [...tag, "machineFault"], data: { lo: lo ? d.limLo : null, hi: hi ? d.limHi : null } });
            }
            else {
                add({ id: "ana:" + d.name + ":nolimits", phase: 4, devId: d.id, title: tr("{dev}: meze nejsou nastavené", p), how: tr("S technologem rozhodni o mezích (viz návrhy ladění) a doplň je do projektu, nebo potvrď, že měření je jen informativní."), expect: tr("Rozhodnutí zapsané v poznámce."), signals: tag, data: { lim: null } });
            }
        }
        else if (d.cls === "AnalogOut") {
            const tag = io.raw ? [io.raw.tag] : [];
            if (Number.isFinite(d.setpoint))
                add({ id: "ana:" + d.name + ":sp", phase: 4, devId: d.id, title: tr("{dev}: žádaná hodnota", p), how: tr("V provozu zkontroluj hodnotu výstupu {dev}.", p), expect: tr("Výstup = {sp} {unit}, akční člen odpovídá.", { sp: d.setpoint, unit: d.unit || "" }), signals: tag, data: { sp: d.setpoint } });
            else
                add({ id: "ana:" + d.name + ":nosp", phase: 4, devId: d.id, title: tr("{dev}: žádaná hodnota není zadaná", p), how: tr("Doplň žádanou hodnotu nebo její zdroj (HMI, receptura, regulace) a ověř ho."), expect: tr("Výstup odpovídá zadání; rozhodnutí zapsané v poznámce."), signals: tag, data: { sp: null } });
        }
    }
    /* 5) E-stop a blokování — funkční zkouška signálů standardního programu */
    const stdNote = tr("Zkouší se signál standardního programu; validace bezpečnostní funkce je ve fázi 10.");
    if (es) {
        const e = enableInputs(prj).find(x => x.estop);
        add({ id: "lock:estop", phase: 5, devId: es.id, title: tr("E-stop {dev}: zastavení stroje", { dev: es.name }), how: tr("V ručním režimu spusť pohony, stiskni {dev} a po chvíli ho uvolni.", { dev: es.name }), expect: tr("enable = FALSE: výstupy bloků vypnuté, sekvence v kroku 0; po uvolnění se nic samo nerozběhne.") + " " + stdNote, signals: e ? [e.io.tag, "enable"] : ["enable"] });
        add({ id: "lock:estop-start", phase: 5, devId: es.id, title: tr("E-stop {dev}: blokování startu", { dev: es.name }), how: tr("V klidu stiskni {dev} a v AUTO dej START.", { dev: es.name }), expect: tr("Cyklus se nespustí."), signals: e ? [e.io.tag, "cmdAutoStart"] : ["cmdAutoStart"] });
    }
    else {
        add({ id: "lock:estop-missing", phase: 5, title: tr("E-stop není v programu zvolený"), how: tr("Zvol vstup E-stopu v kroku Program, nebo zapiš, proč ho standardní program nečte."), expect: tr("Rozhodnutí zapsané v poznámce."), signals: [] });
    }
    for (const x of enableInputs(prj)) {
        const p = { dev: x.dev.name, desc: x.dev.desc || x.dev.name, tag: x.io.tag };
        if (!x.estop)
            add({ id: "lock:" + x.dev.name, phase: 5, devId: x.dev.id, title: tr("Blokování {dev}: zastavení za chodu", p), how: tr("Za běhu cyklu v AUTO rozpoj {dev} ({desc}), pak ho obnov.", p), expect: tr("Stroj zastaví (výstupy bloků vypnuté, sekvence v kroku 0); po obnovení čeká na nový START.") + " " + stdNote, signals: [x.io.tag, "enable"] });
        add({ id: "lock:" + x.dev.name + ":wire", phase: 5, devId: x.dev.id, title: tr("{dev}: přerušení vodiče", p), how: tr("Odpoj vodič vstupu {tag} na svorce.", p),
            expect: x.io.nc ? tr("Program vidí FALSE a stroj zastaví — rozpínací kontakt hlídá přerušení vodiče.") : tr("Vstup není rozpínací — přerušený vodič stroj nezastaví. Změň na rozpínací kontakt (NC), nebo rozhodnutí zapiš do poznámky."),
            signals: [x.io.tag], data: { nc: !!x.io.nc } });
    }
    /* 6) ruční režim */
    const acts = prj.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil" || isMotionClass(d.cls));
    if (acts.length) {
        if (seq.length)
            add({ id: "man:mode", phase: 6, title: tr("Přepínání AUTO / RUČNĚ"), how: tr("Přepni modeAuto na HMI do obou poloh; v RUČNĚ dej START."), expect: tr("Režim se přepne; v RUČNĚ START cyklus nespustí."), signals: ["modeAuto", "cmdAutoStart"] });
        for (const d of acts) {
            const io = ioOf(prj, d), cmd = manVarOf(d);
            const fb = d.cls === "Motor" ? io.fbkRunning : d.cls === "Vfd" ? io.atSpeed : d.cls === "PosDrive" ? io.homed : io.fbkOpen;
            const fbk = fb ? " (" + fb.tag + ")" : "";
            add({ id: "man:" + d.name, phase: 6, devId: d.id, title: tr("Ruční povel {dev}", { dev: d.name }), how: tr("V režimu RUČNĚ dej z HMI povel {cmd} a pak ho zruš.", { cmd }),
                expect: d.cls === "Motor" || d.cls === "Vfd" ? tr("{dev} se rozběhne{fbk} a po zrušení povelu zastaví.", { dev: d.name, fbk })
                    : d.cls === "PosDrive" ? tr("{dev} provede referenční jízdu{fbk}; zrušení povelu za jízdy ji zastaví (HALT).", { dev: d.name, fbk })
                        : d.cls === "PropValve" ? tr("{dev} nastaví výchozí žádanou hodnotu a po zrušení povelu ji vrátí na minimum.", { dev: d.name })
                            : tr("{dev} se otevře{fbk} a po zrušení povelu zavře.", { dev: d.name, fbk }),
                signals: [cmd, ...(fb ? [fb.tag] : [])] });
        }
        if (seq.length)
            add({ id: "man:auto-block", phase: 6, title: tr("Ruční povely v AUTO"), how: tr("V režimu AUTO zkus dát ruční povel kterémukoli pohonu."), expect: tr("Povel je neúčinný."), signals: ["modeAuto"] });
    }
    /* 7) automatická sekvence: krok po kroku naprázdno, celý cyklus naprázdno a s materiálem */
    const v = !seq.length ? null : opts.cheap ? verifyDesignCached(prj) : verifyDesign(prj);
    const nominal = v ? v.nominal : null;
    seq.forEach((s, i) => {
        const d = devById(prj, s.dev), c = seqCond(prj, s), wd = stepWatchdog(prj, s);
        const run = nominal ? nominal.steps.find(r => r.i === i) : undefined;
        const t = run && run.tEnd !== null ? r3(run.tEnd - run.tStart) : null;
        const p = { n: i + 1, title: stepTitle(prj, s), cond: stepCondText(prj, s), t: t ?? "—", wd: wd ?? "" };
        add({
            id: "seq:" + (i + 1) + ":" + (s.act === "wait" ? "wait" : d ? d.name : "?") + ":" + s.act, phase: 7, devId: d?.id,
            title: tr("Krok {n}: {title}", p),
            how: tr("Cyklus naprázdno (bez materiálu) projdi krok po kroku; v kroku {n} sleduj akci a přechod.", p),
            expect: (wd !== null ? tr("{title}; přechod: {cond}, hlídací čas {wd} s (v simulaci {t} s).", p) : tr("{title}; přechod: {cond} (v simulaci {t} s).", p)),
            signals: c.io ? [c.io.tag] : [], data: { i, act: s.act, dev: d?.name ?? "", kind: c.kind, t: s.timeS },
        });
    });
    if (seq.length) {
        const ct = nominal && nominal.cycleTime !== null ? nominal.cycleTime : null;
        add({ id: "seq:dry", phase: 7, title: tr("Celý cyklus naprázdno"), how: tr("V AUTO spusť cyklus bez materiálu a změř dobu cyklu."), expect: tr("Cyklus doběhne bez poruchy za přibližně {t} s (simulace); na konci jsou akční členy ve výchozím stavu.", { t: ct ?? "—" }), signals: ["cmdAutoStart"], data: { ct } });
        add({ id: "seq:material", phase: 7, title: tr("Cyklus s materiálem"), how: tr("Spusť cyklus s materiálem / výrobkem — nejdřív jednotlivě, pak opakovaně."), expect: tr("Výrobek odpovídá zadání, žádná falešná porucha."), signals: ["cmdAutoStart"] });
        add({ id: "seq:repeat", phase: 7, title: tr("Opakované cykly"), how: tr("Nech proběhnout aspoň 10 cyklů po sobě."), expect: tr("Všechny cykly bez poruchy, doba cyklu stabilní."), signals: ["cmdAutoStart"] });
    }
    /* 8) poruchové stavy — z matice stavů jeden zástupce každého zásahu (první krok, kde má smysl) */
    if (v && v.matrix.rows.length) {
        for (const col of v.matrix.cols) {
            const row = v.matrix.rows.find(r => r.step >= 0 && r.cells[col.id] && r.cells[col.id].ok !== null);
            if (!row)
                continue;
            const cellv = row.cells[col.id], st = seq[row.step];
            const f = (cellv.scenario?.opts.faults || []).find(x => "dev" in x && x.dev !== undefined);
            const fd = f && f.dev !== undefined ? devById(prj, f.dev) : col.id === "fbk" ? devById(prj, st.dev) : undefined;
            const fio = fd ? ioOf(prj, fd) : {};
            const p = { n: row.step + 1, title: stepTitle(prj, st), dev: fd ? fd.name : "", desc: fd ? fd.desc || fd.name : "", sim: cellv.text };
            let how, expect;
            const sig = [];
            const stopExp = tr("Stroj zastaví do 3 scanů: výstupy bloků vypnuté, sekvence v kroku 0; po odeznění se sám nerozběhne a čeká na nový START.");
            const faultExp = tr("Porucha stroje (machineFault), stroj zastaven; START bez kvitace nezabere, po odstranění příčiny a kvitaci proběhne nový cyklus.");
            if (col.id === "estop") {
                how = tr("V kroku {n} ({title}) stiskni E-stop, po 1 s ho uvolni.", p);
                expect = stopExp;
            }
            else if (col.id.startsWith("lock-")) {
                how = tr("V kroku {n} ({title}) rozpoj {dev} ({desc}), po 1 s obnov.", p);
                expect = stopExp;
            }
            else if (col.id === "manual") {
                how = tr("V kroku {n} ({title}) přepni na RUČNĚ, po 1 s zpět na AUTO.", p);
                expect = stopExp;
                sig.push("modeAuto");
            }
            else if (col.id === "fbk") {
                const c = seqCond(prj, st);
                how = tr("V kroku {n} ({title}) zabraň zpětnému hlášení {tag} (odpoj snímač nebo bezpečně zablokuj pohyb).", { ...p, tag: c.io ? c.io.tag : "?" });
                expect = tr("Po hlídacím čase {wd} s porucha stroje (faultStep = {fs}), sekvence v kroku 0, povely vypnuté; START bez kvitace nezabere.", { wd: stepWatchdog(prj, st) ?? "—", fs: 10 + row.step * 10 });
                if (c.io)
                    sig.push(c.io.tag);
                sig.push("faultStep");
            }
            else if (col.id === "fault") {
                how = tr("V kroku {n} ({title}) vybav jistič / poruchu měniče {dev}.", p);
                expect = faultExp;
                if (fio.fault)
                    sig.push(fio.fault.tag);
            }
            else if (col.id === "lost") {
                how = tr("V kroku {n} ({title}) přeruš hlášení chodu {dev} (odpoj vodič na svorce).", p);
                expect = faultExp;
                if (fio.fbkRunning)
                    sig.push(fio.fbkRunning.tag);
            }
            else if (col.id === "lostv") {
                how = tr("V kroku {n} ({title}) přeruš koncák „otevřeno“ {dev} (odpoj konektor snímače).", p);
                expect = faultExp;
                if (fio.fbkOpen)
                    sig.push(fio.fbkOpen.tag);
            }
            else if (col.id === "limit") {
                how = tr("V kroku {n} ({title}) nastav kalibrátorem {dev} mimo hlídanou mez.", p);
                expect = faultExp;
                if (fio.raw)
                    sig.push(fio.raw.tag);
            }
            else {
                how = tr("V kroku {n} ({title}) vyvolej: {what}.", { ...p, what: col.label });
                expect = faultExp;
            }
            if (es && (col.id === "estop")) {
                const e = enableInputs(prj).find(x => x.estop);
                if (e)
                    sig.push(e.io.tag);
            }
            if (col.id.startsWith("lock-") && fd) {
                const e = enableInputs(prj).find(x => x.dev.id === fd.id);
                if (e)
                    sig.push(e.io.tag);
            }
            add({ id: "flt:" + (col.id.startsWith("lock-") && fd ? "lock-" + fd.name : col.id), phase: 8, devId: fd?.id,
                title: tr("{what} v kroku {n}", { what: col.label, n: row.step + 1 }), how, expect: expect + " " + tr("(simulace: {sim})", p),
                signals: sig, data: { col: col.id.startsWith("lock-") && fd ? "lock-" + fd.name : col.id, step: row.step, dev: fd?.name ?? "" } });
        }
        add({ id: "flt:recover", phase: 8, title: tr("Kvitace a nový cyklus"), how: tr("Po zkoušce poruchy odstraň příčinu, kvituj (cmdAck) a dej START."), expect: tr("Porucha zmizí až po kvitaci; nový cyklus proběhne od začátku."), signals: ["cmdAck", "cmdAutoStart", "machineFault"] });
    }
    /* 9) takt a parametry */
    if (seq.length) {
        const ct = nominal && nominal.cycleTime !== null ? nominal.cycleTime : "—";
        const takt = prj.meta.takt;
        add({ id: "par:takt", phase: 9, title: takt ? tr("Takt {takt} s", { takt }) : tr("Doba cyklu"), how: tr("Změř dobu cyklu v provozu (průměr z 10 cyklů)."),
            expect: takt ? tr("Cyklus ≤ {takt} s (simulace {t} s); naměřenou hodnotu zapiš.", { takt, t: ct }) : tr("Naměřená doba zapsaná (simulace {t} s); takt v projektu není zadaný — doplnit.", { t: ct }), signals: [], data: { takt: takt ?? null } });
        add({ id: "par:watchdog", phase: 9, title: tr("Hlídací časy podle naměřených dob"), how: tr("Porovnej naměřené doby kroků a pohonů s hlídacími časy."), expect: tr("Rezerva každého hlídacího času ≥ 20 %; úpravy zapsané do projektu a znovu schválené."), signals: [] });
    }
    if (acts.length)
        add({ id: "par:model", phase: 9, title: tr("Model stroje pro simulaci"), how: tr("Zapiš do projektu naměřenou dobu rozběhu motorů a přestavení ventilů a spusť ověření simulací znovu."), expect: tr("Ověření simulací bez chyb s reálnými časy."), signals: [] });
    add({ id: "par:backup", phase: 9, title: tr("Záloha a skutečné provedení"), how: tr("Ulož finální program, parametry a projekt PLCdesk; aktualizuj dokumentaci skutečného provedení."), expect: tr("Záloha a dokumentace předané zákazníkovi."), signals: [] });
    /* 10) bezpečnostní validace a další kroky ze zdrojů v registru */
    const extra = [];
    for (const p of providers)
        extra.push(...p.fn(prj));
    if (!extra.some(s => s.phase === 10)) {
        add({ id: "safety:validation", phase: 10, title: tr("Validace bezpečnostních funkcí"), how: tr("Bezpečnostní funkce tento projekt nenavrhuje (bezpečnostní modul není zapojený). Proveď validaci podle posouzení rizik a dokumentace bezpečnostního obvodu a do poznámky zapiš odkaz na protokol validace."), expect: tr("Validace bezpečnostních funkcí provedená a doložená — bez ní stroj nepředávat."), signals: [] });
    }
    const all = [...out, ...extra];
    const seen = new Set();
    for (const s of all) {
        if (seen.has(s.id))
            throw new Error("commissioning: duplicate step id " + s.id);
        seen.add(s.id);
    }
    /* stabilní řazení podle fáze (vestavěné kroky před kroky ze zdrojů téže fáze) */
    return all.map((s, k) => ({ s, k })).sort((a, b) => a.s.phase - b.s.phase || a.k - b.k).map(x => x.s);
}
/** Otisk plánu: id, fáze, signály, zařízení a kontrolované hodnoty kroků — bez textů. */
export function commissioningHash(plan, prj) {
    return contentHash(plan.map(s => ({ id: s.id, phase: s.phase, signals: s.signals, dev: s.devId !== undefined && prj ? (devById(prj, s.devId) || { name: "" }).name : undefined, data: s.data })));
}
/* ------------------------------------------------------------ výsledky */
/** Zapíše výsledek kroku. Neznámý krok nebo chybějící jméno = výjimka. */
export function setCommissionResult(prj, id, result, by, opts = {}, plan = commissioningPlan(prj)) {
    if (!plan.some(s => s.id === id))
        throw new Error("commissioning: unknown step " + id);
    if (!["ok", "nok", "na"].includes(result))
        throw new Error("commissioning: bad result " + result);
    if (!by || !by.trim())
        throw new Error("commissioning: name is required");
    prj.commissioning = prj.commissioning || {};
    prj.commissioning[id] = { result, by: by.trim(), at: opts.at || new Date().toISOString(), ...(opts.note ? { note: opts.note } : {}), ...(opts.measured ? { measured: opts.measured } : {}) };
}
export function clearCommissionResult(prj, id) {
    if (prj.commissioning)
        delete prj.commissioning[id];
}
export function commissioningSummary(prj, plan = commissioningPlan(prj)) {
    const s = { total: plan.length, ok: 0, nok: 0, na: 0, open: 0, done: false, openSteps: [] };
    for (const st of plan) {
        const r = prj.commissioning?.[st.id];
        if (!r) {
            s.open++;
            s.openSteps.push(st);
        }
        else {
            s[r.result]++;
            if (r.result === "nok")
                s.openSteps.push(st);
        }
    }
    s.done = !s.openSteps.length;
    return s;
}
/* ------------------------------------------------------------ položky ke schválení */
/** Položky „plán oživení“ (povinná) a „uzavření oživení“ (jde schválit, až jsou všechny kroky ok / na). */
export function commissioningApprovalItems(prj, opts = {}) {
    /* levný výpočet bez ověření: otisk plánu závisí na matici stavů (fáze 8) → „čeká na ověření“ */
    if (opts.cheap && prj.program.seq.length && !isVerified(prj)) {
        return [
            { key: "commission:plan", group: "commission", required: true, title: tr("Plán oživení"), summary: tr("ověření simulací zatím neproběhlo"), hash: "", unverified: true },
            { key: "commission:close", group: "commission", required: false, title: tr("Uzavření oživení"), summary: tr("ověření simulací zatím neproběhlo"), hash: "", unverified: true },
        ];
    }
    const plan = commissioningPlan(prj);
    const phases = new Set(plan.map(s => s.phase)).size;
    const ph = commissioningHash(plan, prj);
    const sum = commissioningSummary(prj, plan);
    const res = Object.keys(prj.commissioning || {}).filter(k => plan.some(s => s.id === k)).sort()
        .map(k => [k, prj.commissioning[k].result, prj.commissioning[k].measured ?? ""]);
    return [
        { key: "commission:plan", group: "commission", required: true, title: tr("Plán oživení"),
            summary: tr("{n} kroků v {p} fázích: rozvaděč, smyčkový test každého I/O signálu, pohony, analogy, E-stop a blokování, ruční režim, sekvence, poruchové stavy, takt, bezpečnostní validace", { n: plan.length, p: phases }),
            hash: ph },
        { key: "commission:close", group: "commission", required: false, title: tr("Uzavření oživení"),
            summary: tr("{ok} OK, {na} N/A, {nok} NOK, {open} bez výsledku z {total} kroků", { ...sum }),
            hash: contentHash({ plan: ph, res }), ready: sum.done,
            notReady: sum.done ? undefined : tr("{n} kroků není OK ani N/A", { n: sum.openSteps.length }) },
    ];
}
registerApprovalProvider(commissioningApprovalItems, "commission");
/* ------------------------------------------------------------ protokol */
export const COMMISSION_FILE_MD = "12_protokol_ozivovani.md";
export const COMMISSION_FILE_CSV = "12_protokol_ozivovani.csv";
const RESULT_LABEL = { ok: "OK", nok: "NOK", na: "N/A" };
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
/** Protokol oživení (Markdown): plán po fázích s výsledky, otevřené body, podpisy. */
export function commissioningMd(prj, plan = commissioningPlan(prj)) {
    const sum = commissioningSummary(prj, plan);
    const L = [
        "# " + tr("Protokol oživení"),
        "",
        approvalStamp(prj, ["commission"]).md,
        "",
        tr("**Projekt:** {name} · **Vytvořeno:** {date} · **Oživoval:** ………… · **Za zákazníka:** …………", { name: prj.meta.name || "—", date: today() }),
        "",
        tr("Plán oživení navrhl PLCdesk z projektu. Ke každému kroku se zapisuje výsledek OK / NOK / N/A, kdo a kdy ho zapsal a naměřená hodnota. Oživení je uzavřené, když jsou všechny kroky OK nebo N/A a uzavření schválí odpovědná osoba (viz {file}).", { file: APPROVAL_FILE }),
        "",
        tr("Fáze 5 zkouší E-stop a blokování jen jako signály standardního programu. Bezpečnostní funkce se validují ve fázi 10."),
        "",
        tr("**Stav:** {ok} OK · {nok} NOK · {na} N/A · {open} bez výsledku — celkem {total} kroků", { ...sum }),
        "",
    ];
    for (const ph of Object.keys(COMMISSION_PHASES).map(Number)) {
        const steps = plan.filter(s => s.phase === ph);
        if (!steps.length)
            continue;
        L.push("## " + ph + ". " + tr(COMMISSION_PHASES[ph]), "", tr("| ID | Krok | Postup | Očekávaný výsledek | Signály | Výsledek | Kdo / kdy | Naměřeno / poznámka |"), "|---|---|---|---|---|---|---|---|");
        for (const s of steps) {
            const r = prj.commissioning?.[s.id];
            L.push("| `" + s.id + "` | " + [cell(s.title), cell(s.how), cell(s.expect), cell(s.signals.join(", ")),
                r ? "**" + RESULT_LABEL[r.result] + "**" : "☐", r ? cell(r.by) + ", " + formatDateTime(r.at) : "",
                cell([r?.measured, r?.note].filter(Boolean).join(" — "))].join(" | ") + " |");
        }
        L.push("");
    }
    L.push("## " + tr("Otevřené body"), "");
    const noks = plan.filter(s => prj.commissioning?.[s.id]?.result === "nok");
    if (noks.length)
        for (const s of noks)
            L.push("- **NOK** `" + s.id + "` " + s.title + (prj.commissioning[s.id].note ? " — " + prj.commissioning[s.id].note : ""));
    if (sum.open)
        L.push("- " + tr("{n} kroků bez výsledku", { n: sum.open }));
    if (!noks.length && !sum.open)
        L.push("- " + tr("žádné — všechny kroky OK nebo N/A"));
    L.push("", tr("Podpisy: oživoval …………………… · za zákazníka …………………… · datum …………"));
    return L.join("\n");
}
const csvCell = (s) => { const t = String(s ?? "").replace(/\r?\n/g, " "); return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
/** Protokol oživení jako CSV (oddělovač „;“) — k tisku a vyplnění. */
export function commissioningCsv(prj, plan = commissioningPlan(prj)) {
    const l = [tr("Fáze;ID;Krok;Postup;Očekávaný výsledek;Signály;Výsledek;Kdo;Kdy;Naměřeno;Poznámka")];
    for (const s of plan) {
        const r = prj.commissioning?.[s.id];
        l.push([String(s.phase) + " " + tr(COMMISSION_PHASES[s.phase] || ""), s.id, s.title, s.how, s.expect, s.signals.join(", "),
            r ? RESULT_LABEL[r.result] : "", r ? r.by : "", r ? formatDateTime(r.at) : "", r?.measured || "", r?.note || ""].map(csvCell).join(";"));
    }
    return l.join("\n");
}
