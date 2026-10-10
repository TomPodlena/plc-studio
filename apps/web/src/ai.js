/* AI návrhář — klient Anthropic Messages API (klíč uživatele, volání přímo z prohlížeče).
   Pozn.: přímé volání z prohlížeče vyžaduje hlavičku anthropic-dangerous-direct-browser-access;
   v produkční verzi půjde dotaz přes vlastní backend.
   Modul importuje i desktopový most v Node — při importu nesmí sahat na DOM ani localStorage. */
import { CLS, DO_ROLES, devById, tr, N_, getLang, LANGS } from "../../../packages/core/dist/index.js";

const LS_KEY = "plcstudio.ai";

export function aiSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  /* poškozené / cizí úložiště: jen objekt, klíč a model jako text */
  if (!s || typeof s !== "object" || Array.isArray(s)) return {};
  for (const k of ["key", "model"]) if (s[k] !== undefined && typeof s[k] !== "string") delete s[k];
  if (s.models !== undefined) { if (Array.isArray(s.models)) s.models = s.models.filter(m => typeof m === "string"); else delete s.models; }
  return s;
}
export function saveAiSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function aiInstructions(prj) {
  let current = "";
  if (prj.devices.length) {
    current = "\nAKTUÁLNÍ SESTAVA (uživatel ji může chtít jen upravit — vracej vždy celou aktualizovanou):\n"
      + JSON.stringify(prj.devices.map(d => ({ name: d.name, cls: d.cls, desc: d.desc, opt: d.opt, unit: d.unit, rmin: d.rmin, rmax: d.rmax, limHi: d.limHi, limLo: d.limLo, setpoint: d.setpoint, role: d.role,
        rampS: d.rampS, tol: d.tol, tolTimeS: d.tolTimeS, selBits: d.selBits, records: d.records, axis: d.axis }))) + "\n"
      + (Number.isFinite(prj.meta.takt) ? "Požadovaný takt: " + prj.meta.takt + " s\n" : "");
  }
  /* Prompt je česky v každém jazyce UI; cizí jazyk jen přidá na konec pokyn, jak psát texty pro uživatele. */
  const l = getLang();
  const langNote = l === "cs" ? "" : '\nTexty určené uživateli (otázky "questions", poznámka "note", popisy zařízení "desc") piš v jazyce „' + LANGS[l] + '" — tento pokyn má přednost před pokynem psát popisy česky; označení zařízení, tagy a klíče JSON zůstávají beze změny.';
  return "Jsi zkušený návrhář průmyslové automatizace v nástroji PLCdesk. Z popisu stroje od uživatele navrhni sestavu zařízení pro řízení PLC.\n"
    + "Dostupné třídy zařízení (jiné neexistují):\n"
    + '- "Motor" (názvy M1, M2…): pohon/čerpadlo/dopravník; volby opt.fbk = zpětné hlášení běhu, opt.fault = vstup poruchy\n'
    + '- "Ventil" (Y1…): dvoupolohový ventil nebo pneumatický/hydraulický válec; volby opt.fbkOpen, opt.fbkClosed\n'
    + '- "AnalogIn" (B1…): analogové měření; pole unit, rmin, rmax; limLo / limHi = meze v jednotkách měření, jejichž překročení je porucha stroje\n'
    + '- "AnalogOut" (U1…): analogový výstup; unit, rmin, rmax; setpoint = žádaná hodnota v jednotkách, kterou program zapisuje\n'
    + '- "DI" (S1…): samostatný digitální vstup — tlačítko, závora, koncák krytu, snímač dílu, výsledek kontroly, E-stop\n'
    + '- "Vfd" (M…): pohon na frekvenčním měniči přes I/O (DO chod, analogová žádaná otáček); unit (Hz nebo %), rmin, rmax, setpoint = výchozí otáčky, rampS = rampa v PLC [s] (0 = rampa v měniči); volby opt.fbk = hlášení otáčky dosaženy, opt.ready, opt.fault, opt.rev = směr vzad, opt.act = analog skutečných otáček\n'
    + '- "PosDrive" (M…): elektrická polohovací osa se záznamy v řadiči (Festo CMMO/CMMT, SMC JXC přes I/O); selBits = počet bitů výběru záznamu (1–6), records = [{"no":1,"name":"…","pos":0}], volby opt.ready, opt.fault; před první jízdou krok "home"\n'
    + '- "Axis" (M…): servoosa — servoměnič se servomotorem po síti (PROFINET / EtherCAT / EtherNet/IP), řízená bloky PLCopen Motion Control; jen tam, kde je potřeba volné polohování (portál, manipulátor, posuv na libovolnou polohu); unit (typicky "mm"), axis = {"vMax","aMax","dMax","vDef","limNeg","limPos","homePos","posTol","followMax","jogVel","positions":[{"name":"vstup","pos":20}]}; před prvním absolutním pohybem krok "home". Nepodporují ji Mitsubishi, Schneider a Unitronics — tam použij PosDrive.\n'
    + '- "PropValve" (Y…): proporcionální ventil tlaku / průtoku (analogová žádaná, volitelně zpětná vazba); unit, rmin, rmax, setpoint, rampS, tol = povolená odchylka, tolTimeS = doba odchylky do poruchy; opt.fbk = analog skutečné hodnoty\n'
    + '- "DO" (H1…): samostatný digitální výstup — signálka, houkačka, zámek; role = vazba na stav stroje: "run" (chod — sekvence běží), "fault" (porucha stroje), "ready" (připraveno ke startu), "stopped" (stop / nouzové zastavení), "lock" (zámek krytů — zamčeno během cyklu), "auto" (režim AUTO)\n'
    + 'Pravidla: vždy přidej E-stop jako DI (typicky S1 "Nouzové zastavení (NC)") a jeho název vrať v "estop"; bezpečnostní logiku NEnavrhuj. Popisy česky a stručně. U analogů odhadni rozsah a jednotku.\n'
    + 'PRIORITA JE FUNKCE: návrh musí jako stroj skutečně fungovat — každý vstup, který má na chod vliv, musí program číst a reagovat na něj. Zkontroluj, že žádné zařízení nevisí bez účelu.\n'
    + '- Ochranné a uvolňovací prvky (koncák krytu, světelná závora, rohož, tlak vzduchu / hydrauliky OK, zámek dveří zavřen) přidej jako DI s popisem stavu, který znamená „v pořádku" (např. "Kryt zavřen (NC)", "Světelná závora volná"), a jejich názvy vrať v "interlocks": jejich ztráta zastaví stroj stejně jako E-stop (výstupy vypnout, sekvence do klidu, nový start až po obnovení). E-stop do "interlocks" nepatří. Je to funkční blokování, ne bezpečnostní funkce — tu řeší safety technika.\n'
    + '- Sekvence musí odpovídat technologii: pořadí kroků, každý pohyb s potvrzením koncákem nebo zpětným hlášením (cond "fbk"), čas jen tam, kde zpětná vazba není; na konci cyklu vrať akční členy do výchozího stavu (motory stop, válce zpět), pokud popis neříká jinak.\n'
    + '- Každý snímač dílu, výsledek kontroly a tlačítko obsluhy zapoj do cyklu jako krok čekání (act "waitOn" = čekat na TRUE, "waitOff" = čekat na FALSE) v logickém místě cyklu, s rozumným hlídacím časem v timeS (čekání na obsluhu nebo na díl delší než na pohyb).\n'
    + '- Každý DO dostane "role" podle významu (maják / signálka zelená = "run", červená a houkačka = "fault", zámek krytů = "lock", signálka Připraveno = "ready"…); bez role jen tam, kde žádná nesedí.\n'
    + '- Každé měření (AnalogIn) dostane meze "limLo" / "limHi" podle technologie; každý analogový výstup (AnalogOut) žádanou hodnotu "setpoint".\n'
    + '- Navrhni takt (požadovanou dobu cyklu v sekundách) a vrať ho v "takt".\n'
    + '- Na konci cyklu musí být stroj zase celý ve výchozím stavu (pohony stop, válce zpět, nic nečeká), aby šel další cyklus spustit znovu.\n'
    + '- Ovládací prvky obsluhy (dvouruční spouštění, tlačítka) a signalizaci navrhni podle popisu; pokud jejich funkci program nepokrývá (např. dvouruční spouštění), uveď to v "note" jako věc k doplnění.\n'
    + 'Automatický cyklus → "seq": kroky {"dev":"M1","act":"start|stop|open|close|wait|waitOn|waitOff|home|posRecord|setPressure|setFlow|moveAbs|moveRel|velocity|halt|waitInPos","cond":"fbk|time","timeS":číslo}; u Vfd act start/stop a "sp" = otáčky (volitelně "rev": true), u PosDrive act home / posRecord s "rec" = číslo záznamu, u PropValve act setPressure / setFlow s "sp" = žádaná hodnota, u Axis act home / moveAbs ("posRef" = název pojmenované polohy, nebo "pos" = cíl) / moveRel ("pos" = dráha se znaménkem) / velocity ("vel" = rychlost se znaménkem) / halt / waitInPos (čeká na dojetí předchozího pohybu té osy, který měl cond "time"), volitelně "vel" = rychlost pohybu; krok wait má dev:"" a cond:"time"; kroky waitOn / waitOff mají dev = název DI, cond "fbk" a timeS = hlídací čas. U cond "time" je timeS doba kroku; u cond "fbk" je timeS hlídací čas — nejdelší přípustná doba akce, po které program vyhlásí poruchu (zvol s rezervou, typicky 2–3× běžná doba; motor nejvýše 3 s, ventil/válec nejvýše 5 s).\n'
    + 'Chybí-li ZÁSADNÍ informace, polož nejvýše 3 otázky v "questions" a "devices" nech prázdné; jinak otázky prázdné a sestava kompletní.\n'
    + current
    + 'Odpověz POUZE jedním JSON objektem: {"questions":[],"devices":[{"name","cls","desc","opt":{},"unit","rmin","rmax","limLo","limHi","setpoint","role"}],"estop":"S1","interlocks":["S2"],"seq":[],"takt":30,"note":"shrnutí"}'
    + langNote;
}

/** Akce kroku, které návrh smí použít (krok s jinou se nepřevezme — notes "act"). */
const AI_ACTS = ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow", "moveAbs", "moveRel", "velocity", "halt", "waitInPos"];
/** Třídy zařízení, které akce kroku ovládá / na které čeká. */
const ACT_CLS = { start: ["Motor", "Vfd"], stop: ["Motor", "Vfd"], open: ["Ventil"], close: ["Ventil"], waitOn: ["DI"], waitOff: ["DI"],
  home: ["PosDrive", "Axis"], posRecord: ["PosDrive"], setPressure: ["PropValve"], setFlow: ["PropValve"],
  moveAbs: ["Axis"], moveRel: ["Axis"], velocity: ["Axis"], halt: ["Axis"], waitInPos: ["Axis"] };
/** Číselná pole konfigurace servoosy, která návrh smí vrátit. */
const AXIS_KEYS = ["vMax", "aMax", "dMax", "jerk", "vDef", "limNeg", "limPos", "homePos", "posTol", "followMax", "jogVel", "startPos"];
/** Číslo z odpovědi, nebo undefined (null / "" / nesmysl = nezadáno). */
const optNum = v => (v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v))) ? undefined : Number(v);

/** Druhy upozornění k návrhu (`notes` z aiNorm — co se nepřevezme nebo upraví; text aiNotesText). */
const NOTE_KINDS = ["dup", "cls", "act", "actDev", "time", "estop", "lock"];
/** Upozornění z dřívější normalizace (uložený návrh) v bezpečném tvaru: jen známé druhy a jednoduché hodnoty. */
const keepNotes = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === "object" && NOTE_KINDS.includes(x.kind))
  .map(x => Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))
    .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v])));

/**
 * Odpověď AI → návrh pro převzetí (jádro `applyAiProposal`, web i desktop).
 * Nic se nezahazuje ani nemění potichu (forenzní test 2026-10-10, N3 / N4) — `notes` = co se stalo:
 *  - duplicitní označení se PŘEDÁ dál (jádro mu při převzetí přidělí další volné a vrátí `renamed`), `dup`;
 *  - zařízení neznámé třídy se nepřevezme (`devices` jen se třídami CLS — náhled desktopu i webu je
 *    kreslí podle CLS), `cls`;
 *  - krok s neznámou akcí se nepřevezme (dřív tichá výdrž 3 s), `act`; krok na neexistující zařízení
 *    nebo zařízení jiné třídy, `actDev`;
 *  - neplatný čas kroku (≤ 0, nečíslo) dostane výchozí (3 s, čekání na vstup 10 s), krok nese `timeBad: true`
 *    a `time` s původní hodnotou — uživatel ho zkontroluje v kroku Program;
 *  - E-stop / blokování, které není DI návrhu, `estop` / `lock`.
 * `notes` je pole objektů { kind, … } (jen řetězce a čísla); opakovaná normalizace uloženého návrhu je zachová.
 */
export function aiNorm(r) {
  const out = { questions: [], devices: [], estop: "", interlocks: [], seq: [], takt: null, note: "", notes: [] };
  if (!r || typeof r !== "object") return out;
  const notes = keepNotes(r.notes);
  out.questions = Array.isArray(r.questions) ? r.questions.map(String).slice(0, 3) : [];
  const names = new Set();
  const rawDevs = (Array.isArray(r.devices) ? r.devices : []).filter(d => d && typeof d === "object");
  for (const d of rawDevs) if (!(typeof d.cls === "string" && Object.prototype.hasOwnProperty.call(CLS, d.cls)))
    notes.push({ kind: "cls", name: String(d.name || "").trim().slice(0, 80), cls: String(d.cls ?? "").slice(0, 40) });
  out.devices = rawDevs.filter(d => typeof d.cls === "string" && Object.prototype.hasOwnProperty.call(CLS, d.cls)).filter(d => {
    /* duplicitní označení (i jen velikostí písmen): předat jádru — přejmenuje ho a ohlásí (renamed) */
    const n = String(d.name || "").trim();
    if (n && names.has(n.toLowerCase())) notes.push({ kind: "dup", name: n });
    names.add(n.toLowerCase()); return true;
  }).map(d => {
    const nd = {
      name: String(d.name || "").trim(), cls: d.cls, desc: String(d.desc || "").trim(),
      // jen volby, které třída zná (jako boolean) — neznámé klíče by UI i generátor jen mátly
      opt: (d.opt && typeof d.opt === "object") ? Object.fromEntries(Object.entries(d.opt).filter(([k]) => Object.prototype.hasOwnProperty.call(CLS[d.cls].opts, k)).map(([k, v]) => [k, !!v])) : {},
      unit: String(d.unit || ""), rmin: Number(d.rmin) || 0,
      rmax: Number.isFinite(Number(d.rmax)) ? Number(d.rmax) : 100,
    };
    // nová pole jen u tříd, kterým patří; neplatné hodnoty se zahodí
    if (d.cls === "AnalogIn") {
      const hi = optNum(d.limHi), lo = optNum(d.limLo);
      if (hi !== undefined) nd.limHi = hi;
      if (lo !== undefined && (hi === undefined || lo < hi)) nd.limLo = lo;
    }
    if ((d.cls === "AnalogOut" || d.cls === "Vfd" || d.cls === "PropValve") && optNum(d.setpoint) !== undefined) nd.setpoint = optNum(d.setpoint);
    /* pohony fáze 2a: rampa, tolerance, záznamy */
    if ((d.cls === "Vfd" || d.cls === "PropValve") && optNum(d.rampS) !== undefined && optNum(d.rampS) >= 0) nd.rampS = optNum(d.rampS);
    if (d.cls === "PropValve") { if (optNum(d.tol) > 0) nd.tol = optNum(d.tol); if (optNum(d.tolTimeS) > 0) nd.tolTimeS = optNum(d.tolTimeS); }
    if (d.cls === "PosDrive") {
      /* jen zadané hodnoty — chybějící doplní jádro (selBitsOf, travelOf); výchozí sem nepsat,
         jinak by převzetí návrhu bez úprav změnilo projekt */
      if (optNum(d.selBits) !== undefined) nd.selBits = Math.min(6, Math.max(1, Math.round(optNum(d.selBits))));
      if (optNum(d.travelS) > 0) nd.travelS = optNum(d.travelS);
      if (Array.isArray(d.records)) nd.records = d.records.filter(r => r && Number.isInteger(Number(r.no)) && Number(r.no) >= 1)
        .map(r => ({ ...r, no: Number(r.no), name: String(r.name || ""), ...(optNum(r.pos) !== undefined ? { pos: optNum(r.pos) } : {}) }));
    }
    if (d.cls === "DO" && Object.prototype.hasOwnProperty.call(DO_ROLES, d.role)) nd.role = d.role;
    if (typeof d.libType === "string" && d.libType) nd.libType = d.libType;   // typ z firemní knihovny
    /* servoosa: jen známá číselná pole a pojmenované polohy (název + číslo); chybějící doplní axisCfgOf */
    if (d.cls === "Axis") {
      const a = d.axis && typeof d.axis === "object" ? d.axis : {};
      /* neznámá jednoduchá pole (drive, budoucí klíče) se přenesou beze změny; číselná se jen ověří */
      nd.axis = Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== "positions" && !AXIS_KEYS.includes(k)
        && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")));
      for (const k of AXIS_KEYS) if (optNum(a[k]) !== undefined) nd.axis[k] = optNum(a[k]);
      nd.axis.positions = (Array.isArray(a.positions) ? a.positions : []).filter(x => x && String(x.name || "").trim() && optNum(x.pos) !== undefined)
        .map(x => ({ name: String(x.name).trim(), pos: optNum(x.pos) }));
      if (!nd.unit) nd.unit = "mm";
      nd.rmin = 0; nd.rmax = 0;
    }
    return nd;
  });
  const clsOf = n => (out.devices.find(d => d.name === n) || {}).cls;
  // E-stop a blokování jen na digitální vstup
  out.estop = clsOf(String(r.estop || "")) === "DI" ? String(r.estop) : "";
  if (r.estop && !out.estop) notes.push({ kind: "estop", name: String(r.estop).slice(0, 80) });
  const locks = [...new Set((Array.isArray(r.interlocks) ? r.interlocks : []).map(String))];
  out.interlocks = locks.filter(n => n && n !== out.estop && clsOf(n) === "DI");
  for (const n of locks) if (n && n !== out.estop && clsOf(n) !== "DI") notes.push({ kind: "lock", name: n.slice(0, 80) });
  const timeNotes = [];
  out.seq = (Array.isArray(r.seq) ? r.seq : []).filter(s => s && typeof s === "object").flatMap((s, k) => {
    const n = k + 1, devName = String(s.dev || "").slice(0, 80);
    /* neznámá akce: krok se nepřevezme (dřív se tiše změnil na výdrž 3 s) */
    if (!AI_ACTS.includes(s.act)) { notes.push({ kind: "act", n, act: String(s.act ?? "").slice(0, 40), dev: devName }); return []; }
    const act = s.act;
    /* akce musí patřit třídě zařízení (výdrž zařízení nemá) */
    if (act !== "wait" && !(ACT_CLS[act] || []).includes(clsOf(devName))) { notes.push({ kind: "actDev", n, act, dev: devName }); return []; }
    const wait = act === "waitOn" || act === "waitOff";   // čekání na DI: přechod vždy zpětné hlášení
    const tOk = Number(s.timeS) > 0 && Number.isFinite(Number(s.timeS));
    const o = {
      dev: act === "wait" ? "" : devName, act,
      cond: wait ? "fbk" : act === "wait" || s.cond === "time" ? "time" : "fbk",
      timeS: tOk ? Number(s.timeS) : (wait ? 10 : 3),
      /* neplatný čas od AI: výchozí hodnota, ale označená — náhled a souhrn převzetí ji ukážou */
      ...(!tOk || s.timeBad === true ? { timeBad: true } : {}),
      ...(optNum(s.sp) !== undefined ? { sp: optNum(s.sp) } : {}),
      ...(Number.isInteger(Number(s.rec)) && Number(s.rec) >= 1 ? { rec: Number(s.rec) } : {}),
      ...(s.rev === true ? { rev: true } : {}),
      /* servoosa: cíl (pojmenovaná poloha / číslo), rychlost, zrychlení, zpomalení */
      ...(typeof s.posRef === "string" && s.posRef.trim() ? { posRef: s.posRef.trim() } : {}),
      ...(optNum(s.pos) !== undefined ? { pos: optNum(s.pos) } : {}),
      ...(optNum(s.vel) !== undefined ? { vel: optNum(s.vel) } : {}),
      ...(optNum(s.acc) > 0 ? { acc: optNum(s.acc) } : {}),
      ...(optNum(s.dec) > 0 ? { dec: optNum(s.dec) } : {}),
    };
    if (!tOk && s.timeBad !== true) timeNotes.push({ o, value: String(s.timeS ?? "").slice(0, 40) });
    return [o];
  });
  /* čísla kroků podle převzaté sekvence (= náhled a krok Program) */
  for (const t of timeNotes) notes.push({ kind: "time", n: out.seq.indexOf(t.o) + 1, value: t.value, t: t.o.timeS });
  const takt = optNum(r.takt);
  out.takt = takt !== undefined && takt > 0 ? takt : null;
  out.note = String(r.note || "");
  const seen = new Set();
  out.notes = notes.filter(x => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}

/** Upozornění k návrhu AI (`aiNorm(…).notes`) jako věty pro uživatele — náhled návrhu i souhrn převzetí
 *  (web; desktop je může získat přes most stejně jako aiNorm). */
export function aiNotesText(notes) {
  return (Array.isArray(notes) ? notes : []).map(x => {
    if (x.kind === "dup") return tr("{name}: označení je v návrhu vícekrát — další výskyt dostane při převzetí volné označení.", { name: x.name });
    if (x.kind === "cls") return tr("{name}: neznámá třída „{cls}“ — zařízení se nepřevezme.", { name: x.name || "?", cls: x.cls });
    if (x.kind === "act") return tr("Krok {n} od AI: neznámá akce „{act}“ ({dev}) — krok se nepřevezme; doplň ho ručně v kroku Program.", { n: x.n, act: x.act, dev: x.dev || "—" });
    if (x.kind === "actDev") return tr("Krok {n} od AI: akce „{act}“ nepatří k zařízení {dev} (v návrhu není nebo je jiné třídy) — krok se nepřevezme.", { n: x.n, act: x.act, dev: x.dev || "—" });
    if (x.kind === "time" && !x.value) return tr("Krok {n}: čas od AI chybí — dosazeno {t} s, zkontroluj ho v kroku Program.", { n: x.n, t: x.t });
    if (x.kind === "time") return tr("Krok {n}: neplatný čas od AI ({value}) — dosazeno {t} s, zkontroluj ho v kroku Program.", { n: x.n, value: x.value || "—", t: x.t });
    if (x.kind === "estop") return tr("E-stop {name} není digitální vstup návrhu — nepřevezme se.", { name: x.name });
    if (x.kind === "lock") return tr("Blokování {name} není digitální vstup návrhu — nepřevezme se.", { name: x.name });
    return "";
  }).filter(Boolean);
}

/* Známé modely s popiskem (shodně s desktopem ai_client.KNOWN_MODELS); dostupné pro klíč
   načte aiListModels() — GET /v1/models nic negeneruje a neúčtuje se. */
export const AI_MODELS = {
  "claude-sonnet-5-5": N_("Sonnet 5.5 — vyvážený, doporučený"),
  "claude-opus-5-5": N_("Opus 5.5 — nejpečlivější, dražší"),
  "claude-fable-5-1": N_("Fable 5.1 — nejschopnější, nejdražší"),
  "claude-haiku-4-5-20251001": N_("Haiku 4.5 — rychlý a levný"),
};
export const AI_DEFAULT_MODEL = "claude-sonnet-5-5";

/** ID modelů dostupných pro klíč uživatele. */
export async function aiListModels(key) {
  if (!key) { const e = new Error(tr("Nejdřív zadej API klíč.")); e.code = "no_key"; throw e; }
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
  });
  if (!res.ok) {
    const e = new Error("API " + res.status);
    try { e.detail = (await res.json()).error?.message; } catch { /* ignore */ }
    throw e;
  }
  return ((await res.json()).data || []).map(m => m.id).filter(Boolean);
}

/** Zavolá Anthropic API; vrací surový text odpovědi. */
export async function aiCall(turns, prj, { signal } = {}) {
  const cfg = aiSettings();
  if (!cfg.key) { const e = new Error(tr("Chybí API klíč.")); e.code = "no_key"; throw e; }
  const messages = [{ role: "user", content: aiInstructions(prj) }, ...turns];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model || AI_DEFAULT_MODEL,
      max_tokens: 4000,
      messages,
    }),
  });
  if (!res.ok) {
    const e = new Error("API " + res.status);
    e.code = res.status === 401 ? "bad_key" : res.status === 429 ? "rate_limited" : "api_error";
    try { e.detail = (await res.json()).error?.message; } catch { /* ignore */ }
    throw e;
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

/** Tolerantní vytažení JSON objektu z textové odpovědi. */
export function extractJson(text) {
  try { return JSON.parse(text); } catch { /* dál */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* dál */ } }
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(text.slice(i, j + 1)); } catch { /* dál */ } }
  const e = new Error(tr("Odpověď neobsahuje platný JSON.")); e.code = "invalid_json"; e.text = text;
  throw e;
}

/** Předvyplnění AI konverzace z hotového návrhu (ukázkové projekty). */
export function seedFromProject(prj, popis, note) {
  const prop = {
    questions: [],
    devices: prj.devices.map(d => {
      /* všechna pole zařízení kromě identity (id, GUID) — převzetí návrhu bez úprav nesmí nic ztratit */
      const { id, guid, ...rest } = d;
      return JSON.parse(JSON.stringify({ ...rest, desc: d.desc || "", opt: d.opt || {}, unit: d.unit || "", rmin: d.rmin ?? 0, rmax: d.rmax ?? 100 }));
    }),
    estop: (devById(prj, prj.program.estop) || { name: "" }).name,
    interlocks: (prj.program.interlocks || []).map(id => (devById(prj, id) || { name: "" }).name).filter(Boolean),
    seq: prj.program.seq.map(s => {
      const o = { dev: (devById(prj, s.dev) || { name: "" }).name, act: s.act, cond: s.cond, timeS: s.timeS };
      for (const k of ["sp", "rec", "rev", "posRef", "pos", "vel", "acc", "dec"]) if (s[k] !== undefined) o[k] = s[k];
      return o;
    }),
    takt: Number.isFinite(prj.meta.takt) ? prj.meta.takt : null,
    note,
  };
  return { turns: [{ role: "user", content: popis }, { role: "assistant", content: JSON.stringify(prop) }], last: prop, draft: "" };
}

/* Zadání ukázek a příklad jsou konstanty modulu: text je jen označený N_() a překládá se
   v místě použití (web: tr(SAMPLE_DESC.small), most desktopu: core.tr(…)). */
export const SAMPLE_DESC = {
  small: N_("Hydraulická zkušební stanice: čerpadlo hydrauliky se zpětným hlášením běhu a poruchou jističe, upínací ventil s oběma koncáky, měření tlaku 0–250 bar a teploty oleje 0–100 °C, nouzové zastavení, koncák krytu, signálka Připraveno. Automatický cyklus: upnout → spustit čerpadlo → výdrž 5 s → stop → povolit."),
  complex: N_("Lisovací a značicí linka: vibrační podavač a vstupní pás dodávají díly, manipulátor s vakuovou přísavkou zakládá díl do hydraulického lisu, dva upínací válce, lisovací válec s měřením síly a polohy, značicí jednotka, výstupní pás s řízenou rychlostí. Hydraulický agregát s měřením tlaku, teploty oleje a průtoku chlazení, proporcionální ventil tlaku. Bezpečnost: E-stop, dva kryty, světelná závora, dvouruční spouštění, majáky, houkačka a zámek krytů. Automatický cyklus: podat díl → založit → upnout → lisovat 5 s → označit → uvolnit → odvézt."),
};
export const AI_EXAMPLE = N_("Jednoúčelový lis na zalisování pouzder. Hydraulický agregát s čerpadlem, lisovací válec s koncáky, upínací ventil, měření tlaku do 250 bar a teploty oleje, světelná závora, kryt s koncákem, signalizace stavu. Automatický cyklus: upnout → lisovat 5 s → povolit.");
