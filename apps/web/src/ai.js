/* AI návrhář — klient Anthropic Messages API (klíč uživatele, volání přímo z prohlížeče).
   Pozn.: přímé volání z prohlížeče vyžaduje hlavičku anthropic-dangerous-direct-browser-access;
   v produkční verzi půjde dotaz přes vlastní backend.
   Modul importuje i desktopový most v Node — při importu nesmí sahat na DOM ani localStorage. */
import { CLS, DO_ROLES, devById, tr, N_, getLang, LANGS } from "../../../packages/core/dist/index.js";

const LS_KEY = "plcstudio.ai";

export function aiSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
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

/** Akce kroku, které návrh smí použít (zbytek → výdrž). */
const AI_ACTS = ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow", "moveAbs", "moveRel", "velocity", "halt", "waitInPos"];
/** Třídy zařízení, které akce kroku ovládá / na které čeká. */
const ACT_CLS = { start: ["Motor", "Vfd"], stop: ["Motor", "Vfd"], open: ["Ventil"], close: ["Ventil"], waitOn: ["DI"], waitOff: ["DI"],
  home: ["PosDrive", "Axis"], posRecord: ["PosDrive"], setPressure: ["PropValve"], setFlow: ["PropValve"],
  moveAbs: ["Axis"], moveRel: ["Axis"], velocity: ["Axis"], halt: ["Axis"], waitInPos: ["Axis"] };
/** Číselná pole konfigurace servoosy, která návrh smí vrátit. */
const AXIS_KEYS = ["vMax", "aMax", "dMax", "jerk", "vDef", "limNeg", "limPos", "homePos", "posTol", "followMax", "jogVel", "startPos"];
/** Číslo z odpovědi, nebo undefined (null / "" / nesmysl = nezadáno). */
const optNum = v => (v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v))) ? undefined : Number(v);

export function aiNorm(r) {
  const out = { questions: [], devices: [], estop: "", interlocks: [], seq: [], takt: null, note: "" };
  if (!r || typeof r !== "object") return out;
  out.questions = Array.isArray(r.questions) ? r.questions.map(String).slice(0, 3) : [];
  const names = new Set();
  out.devices = (Array.isArray(r.devices) ? r.devices : []).filter(d => d && CLS[d.cls]).filter(d => {
    // duplicitní označení: platí první výskyt (druhý by dal duplicitní tagy)
    const n = String(d.name || "").trim();
    if (n && names.has(n)) return false;
    names.add(n); return true;
  }).map(d => {
    const nd = {
      name: String(d.name || "").trim(), cls: d.cls, desc: String(d.desc || "").trim(),
      // jen volby, které třída zná (jako boolean) — neznámé klíče by UI i generátor jen mátly
      opt: (d.opt && typeof d.opt === "object") ? Object.fromEntries(Object.entries(d.opt).filter(([k]) => k in CLS[d.cls].opts).map(([k, v]) => [k, !!v])) : {},
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
  out.interlocks = [...new Set((Array.isArray(r.interlocks) ? r.interlocks : []).map(String))].filter(n => n && n !== out.estop && clsOf(n) === "DI");
  out.seq = (Array.isArray(r.seq) ? r.seq : []).filter(s => s && typeof s === "object").map(s => {
    const act = AI_ACTS.includes(s.act) ? s.act : "wait";
    const wait = act === "waitOn" || act === "waitOff";   // čekání na DI: přechod vždy zpětné hlášení
    return {
      dev: act === "wait" ? "" : String(s.dev || ""), act,
      cond: wait ? "fbk" : act === "wait" || s.cond === "time" ? "time" : "fbk",
      timeS: Number(s.timeS) > 0 ? Number(s.timeS) : (wait ? 10 : 3),
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
  }).filter(s => s.act === "wait" || (ACT_CLS[s.act] || []).includes(clsOf(s.dev)));   // akce musí patřit třídě zařízení
  const takt = optNum(r.takt);
  out.takt = takt !== undefined && takt > 0 ? takt : null;
  out.note = String(r.note || "");
  return out;
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
