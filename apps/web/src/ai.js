/* AI návrhář — klient Anthropic Messages API (klíč uživatele, volání přímo z prohlížeče).
   Pozn.: přímé volání z prohlížeče vyžaduje hlavičku anthropic-dangerous-direct-browser-access;
   v produkční verzi půjde dotaz přes vlastní backend. */
import { CLS, devById } from "../../../packages/core/dist/index.js";

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
      + JSON.stringify(prj.devices.map(d => ({ name: d.name, cls: d.cls, desc: d.desc, opt: d.opt, unit: d.unit, rmin: d.rmin, rmax: d.rmax }))) + "\n";
  }
  return "Jsi zkušený návrhář průmyslové automatizace v nástroji PLC Studio. Z popisu stroje od uživatele navrhni sestavu zařízení pro řízení PLC.\n"
    + "Dostupné třídy zařízení (jiné neexistují):\n"
    + '- "Motor" (názvy M1, M2…): pohon/čerpadlo/dopravník; volby opt.fbk = zpětné hlášení běhu, opt.fault = vstup poruchy\n'
    + '- "Ventil" (Y1…): dvoupolohový ventil nebo pneumatický/hydraulický válec; volby opt.fbkOpen, opt.fbkClosed\n'
    + '- "AnalogIn" (B1…): analogové měření; pole unit, rmin, rmax\n'
    + '- "AnalogOut" (U1…): analogový výstup; unit, rmin, rmax\n'
    + '- "DI" (S1…): samostatný digitální vstup — tlačítko, závora, koncák krytu, E-stop\n'
    + '- "DO" (H1…): samostatný digitální výstup — signálka, houkačka, zámek\n'
    + 'Pravidla: vždy přidej E-stop jako DI (typicky S1 "Nouzové zastavení (NC)") a jeho název vrať v "estop"; bezpečnostní logiku NEnavrhuj. Popisy česky a stručně. U analogů odhadni rozsah a jednotku.\n'
    + 'Automatický cyklus → "seq": kroky {"dev":"M1","act":"start|stop|open|close|wait","cond":"fbk|time","timeS":číslo}; krok wait má dev:"" a cond:"time".\n'
    + 'Chybí-li ZÁSADNÍ informace, polož nejvýše 3 otázky v "questions" a "devices" nech prázdné; jinak otázky prázdné a sestava kompletní.\n'
    + current
    + 'Odpověz POUZE jedním JSON objektem: {"questions":[],"devices":[{"name","cls","desc","opt":{},"unit","rmin","rmax"}],"estop":"S1","seq":[],"note":"shrnutí"}';
}

export function aiNorm(r) {
  const out = { questions: [], devices: [], estop: "", seq: [], note: "" };
  if (!r || typeof r !== "object") return out;
  out.questions = Array.isArray(r.questions) ? r.questions.map(String).slice(0, 3) : [];
  out.devices = (Array.isArray(r.devices) ? r.devices : []).filter(d => d && CLS[d.cls]).map(d => ({
    name: String(d.name || "").trim(), cls: d.cls, desc: String(d.desc || "").trim(),
    opt: (d.opt && typeof d.opt === "object") ? d.opt : {},
    unit: String(d.unit || ""), rmin: Number(d.rmin) || 0,
    rmax: Number.isFinite(Number(d.rmax)) ? Number(d.rmax) : 100,
  }));
  out.estop = String(r.estop || "");
  out.seq = (Array.isArray(r.seq) ? r.seq : []).map(s => ({
    dev: String(s.dev || ""), act: String(s.act || ""),
    cond: s.cond === "time" ? "time" : "fbk", timeS: Number(s.timeS) || 3,
  }));
  out.note = String(r.note || "");
  return out;
}

/** Zavolá Anthropic API; vrací surový text odpovědi. */
export async function aiCall(turns, prj, { signal } = {}) {
  const cfg = aiSettings();
  if (!cfg.key) { const e = new Error("Chybí API klíč."); e.code = "no_key"; throw e; }
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
      model: cfg.model || "claude-sonnet-5-5",
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
  const e = new Error("Odpověď neobsahuje platný JSON."); e.code = "invalid_json"; e.text = text;
  throw e;
}

/** Předvyplnění AI konverzace z hotového návrhu (ukázkové projekty). */
export function seedFromProject(prj, popis, note) {
  const prop = {
    questions: [],
    devices: prj.devices.map(d => ({ name: d.name, cls: d.cls, desc: d.desc, opt: d.opt || {}, unit: d.unit || "", rmin: d.rmin ?? 0, rmax: d.rmax ?? 100 })),
    estop: (devById(prj, prj.program.estop) || { name: "" }).name,
    seq: prj.program.seq.map(s => ({ dev: (devById(prj, s.dev) || { name: "" }).name, act: s.act, cond: s.cond, timeS: s.timeS })),
    note,
  };
  return { turns: [{ role: "user", content: popis }, { role: "assistant", content: JSON.stringify(prop) }], last: prop, draft: "" };
}

export const SAMPLE_DESC = {
  small: "Hydraulická zkušební stanice: čerpadlo hydrauliky se zpětným hlášením běhu a poruchou jističe, upínací ventil s oběma koncáky, měření tlaku 0–250 bar a teploty oleje 0–100 °C, nouzové zastavení, koncák krytu, signálka Připraveno. Automatický cyklus: upnout → spustit čerpadlo → výdrž 5 s → stop → povolit.",
  complex: "Lisovací a značicí linka: vibrační podavač a vstupní pás dodávají díly, manipulátor s vakuovou přísavkou zakládá díl do hydraulického lisu, dva upínací válce, lisovací válec s měřením síly a polohy, značicí jednotka, výstupní pás s řízenou rychlostí. Hydraulický agregát s měřením tlaku, teploty oleje a průtoku chlazení, proporcionální ventil tlaku. Bezpečnost: E-stop, dva kryty, světelná závora, dvouruční spouštění, majáky, houkačka a zámek krytů. Automatický cyklus: podat díl → založit → upnout → lisovat 5 s → označit → uvolnit → odvézt.",
};
export const AI_EXAMPLE = "Jednoúčelový lis na zalisování pouzder. Hydraulický agregát s čerpadlem, lisovací válec s koncáky, upínací ventil, měření tlaku do 250 bar a teploty oleje, světelná závora, kryt s koncákem, signalizace stavu. Automatický cyklus: upnout → lisovat 5 s → povolit.";
