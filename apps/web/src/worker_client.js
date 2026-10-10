/* PLCdesk — klient výpočetního Workeru (core_worker.js), po vzoru desktopu (bridge.py DualBridge +
   app.fetch / Pending).

   - get(op, args, { slot, onDone }) → { value } hned (cache, nebo synchronní výpočet bez Workeru),
     nebo { pending } — krok vykreslí zástupný stav (pendingCard) a po výsledku se překreslí (onDone).
   - Cache: operace × jazyk × dokument 15 (emuGate) × přesný obsah argumentů (JSON) — nejvýš CACHE_MAX položek.
   - Worker počítá po jednom požadavku; nový požadavek téhož slotu vyřadí starší čekající a přeruší
     rozběhnutý zastaralý výpočet (stale / preempt — zastaralé výsledky se nedopočítávají). Zrušit = terminate a nový Worker při dalším požadavku (cache Workeru
     se tím ztratí, cache klienta zůstává).
   - Výsledek ověření simulací (verify) převezme cache jádra v hlavním vlákně (seedVerifyDesign) —
     kroky Schválení / Oživení a ukládání projektu ho pak nepočítají znovu.
   - Bez Workeru (file://, CSP, starý prohlížeč, chyba načtení modulu, ?worker=off) se počítá
     synchronně v hlavním vlákně jako dřív — stejné funkce jádra, stejný výsledek. */
import {
  tr, escHtml as esc, getLang, emuModuleRegistered, seedVerifyDesign, syncIO, licensedProjectFiles, verifyDesign,
  approvalSummary, genFor, emulateCompile, emulateRunMany,
} from "../../../packages/core/dist/index.js";
import { card } from "./util.js";

const CACHE_MAX = 6;

/* Tytéž operace synchronně (fallback bez Workeru) — zrcadlo OPS v core_worker.js; ověření se nevrací
   (spočítalo se rovnou v cache hlavního vlákna). */
const LOCAL = {
  docs: ({ prj, gate }) => { syncIO(prj); return { files: licensedProjectFiles(prj, gate), verify: null }; },
  verify: ({ prj }) => { syncIO(prj); verifyDesign(prj); return { verify: null }; },
  badge: ({ prj }) => { syncIO(prj); return { sum: approvalSummary(prj), verify: null }; },
  emu: ({ prj, plat, scope }) => {
    syncIO(prj);
    return { files: genFor(prj, plat), comp: emulateCompile(prj, plat), run: emulateRunMany(prj, [plat], { scope })[plat] };
  },
};

function forcedOff() {
  try { return new URLSearchParams(location.search).get("worker") === "off"; } catch { return false; }
}

let worker = null;          // Worker | null
let broken = forcedOff() || typeof Worker !== "function" || (typeof location !== "undefined" && location.protocol === "file:");
let seq = 0;
let inflight = null;        // { id, key, slot, op, json, lang, since, resolve, reject }
const queue = [];           // čekající požadavky (stejný tvar)
const cache = new Map();    // key → value
const waiting = new Map();  // key → požadavek (inflight nebo ve frontě) — sdílí ho opakované get()
const cancelled = new Set(); // klíče zrušené uživatelem — krok je sám znovu nespustí
const stats = { requests: 0, hits: 0, local: 0, lastMs: 0 };

const stateNow = () => ({ lang: getLang(), emu: emuModuleRegistered() });
const keyOf = (op, json, st) => op + "\u0000" + st.lang + "\u0000" + (st.emu ? 1 : 0) + "\u0000" + json;

function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function spawn() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL("./core_worker.js", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("worker: nelze spustit, výpočet v hlavním vlákně", e);
    broken = true; worker = null; return null;
  }
  worker.onmessage = onMessage;
  worker.onerror = ev => {
    /* chyba načtení modulu (CSP worker-src, starý prohlížeč bez module workerů) nebo pád — zbytek synchronně */
    console.warn("worker: chyba, výpočet v hlavním vlákně", ev && ev.message);
    if (ev && ev.preventDefault) ev.preventDefault();
    broken = true;
    try { worker.terminate(); } catch { /* ignore */ }
    worker = null;
    const all = [inflight, ...queue.splice(0)].filter(Boolean);
    inflight = null;
    for (const r of all) setTimeout(() => runLocal(r), 0);
  };
  worker.onmessageerror = worker.onerror;
  return worker;
}

function runLocal(r) {
  waiting.delete(r.key);
  try {
    const value = LOCAL[r.op](r.snap);
    stats.local++;
    remember(r.key, value);
    r.resolve(value);
  } catch (e) { r.reject(e); }
}

function pump() {
  if (inflight || !queue.length) return;
  const w = spawn();
  if (!w) { for (const r of queue.splice(0)) runLocal(r); return; }
  inflight = queue.shift();
  inflight.since = Date.now();
  w.postMessage({ id: inflight.id, op: inflight.op, args: inflight.snap, state: { lang: inflight.lang, emu: inflight.emu } });
}

function onMessage(e) {
  const m = e.data || {};
  if (m.ready) return;
  const r = inflight;
  if (!r || m.id !== r.id) return;
  inflight = null;
  waiting.delete(r.key);
  stats.lastMs = m.ms || 0;
  if (m.ok) {
    const v = m.value;
    /* ověření simulací do cache jádra hlavního vlákna — jen pro projekt a jazyk, pro které se počítalo */
    if (v && v.verify) {
      if (getLang() === r.lang) {
        try { seedVerifyDesign(r.snap.prj, v.verify); } catch (er) { console.warn("worker: seed", er); }
      }
      v.verify = null;
    }
    remember(r.key, v);
    r.resolve(v);
  } else r.reject(new Error(m.error));
  pump();
}

/**
 * Je rozběhnutý výpočet zastaralý vůči novému požadavku? Týž slot s jiným klíčem (projekt / jazyk se změnil)
 * a odznak nad jinou podobou projektu — jinak by nový výsledek čekal na výpočet, který už nikdo nepotřebuje
 * (ověření velkého projektu trvá minuty). Emulace běží po platformách za sebou, ta se nepřerušuje.
 */
function stale(cur, nw) {
  if (cur.slot === "emu") return false;
  return cur.slot === nw.slot || (cur.slot === "badge" && cur.prj !== nw.prj);
}
/** Přeruší rozběhnutý výpočet (terminate; nový Worker vznikne hned pro další požadavek). */
function preempt() {
  try { worker.terminate(); } catch { /* ignore */ }
  worker = null;
  const r = inflight;
  inflight = null;
  waiting.delete(r.key);
  stats.preempted = (stats.preempted || 0) + 1;
  r.reject(Object.assign(new Error("superseded"), { superseded: true }));
}

/**
 * Pošle požadavek (Promise s výsledkem). `slot` = skupina, ve které nový požadavek vyřadí starší čekající.
 * Bez Workeru se počítá synchronně (odloženě, ať volající stihne vykreslit).
 */
export function request(op, args, { slot = op } = {}) {
  const st = stateNow();
  const json = JSON.stringify(args);
  const key = keyOf(op, json, st);
  stats.requests++;
  if (cache.has(key)) { stats.hits++; return Promise.resolve(cache.get(key)); }
  const w = waiting.get(key);
  if (w) return w.promise;
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].slot === slot) {
    const [old] = queue.splice(i, 1);
    waiting.delete(old.key);
    old.reject(Object.assign(new Error("superseded"), { superseded: true }));
  }
  /* snímek argumentů z doby požadavku (projekt se ve frontě může dál měnit) — strukturovaný klon jako postMessage */
  const r = { id: ++seq, key, slot, op, snap: structuredClone(args), lang: st.lang, emu: st.emu, since: 0, prj: JSON.stringify(args.prj ?? null) };
  r.promise = new Promise((res, rej) => { r.resolve = res; r.reject = rej; });
  r.promise.catch(() => { /* zamítnutí řeší volající; tady jen bez „unhandled rejection“ */ });
  waiting.set(key, r);
  if (broken) { setTimeout(() => runLocal(r), 0); return r.promise; }
  if (inflight && worker && stale(inflight, r)) preempt();
  queue.push(r);
  pump();
  return r.promise;
}

/**
 * Výsledek pro vykreslení kroku: { value } z cache (nebo synchronně bez Workeru), jinak
 * { pending: true, since, cancelled, key } a po dokončení zavolá onDone(value).
 */
export function get(op, args, { slot = op, onDone } = {}) {
  const st = stateNow();
  const json = JSON.stringify(args);
  const key = keyOf(op, json, st);
  if (cache.has(key)) { stats.hits++; return { value: cache.get(key), key }; }
  if (broken) {   // dnešní chování: synchronně v hlavním vlákně
    const value = LOCAL[op](args);
    stats.local++;
    remember(key, value);
    return { value, key };
  }
  if (cancelled.has(key)) return { pending: true, cancelled: true, key, op };
  const p = request(op, args, { slot });
  p.then(v => onDone && onDone(v), e => { if (!e || !(e.superseded || e.cancelled)) console.warn("worker " + op + ":", e); });
  const r = waiting.get(key);
  return { pending: true, since: (r && r.since) || Date.now(), key, op };
}

/** Hotový výsledek z cache, nebo undefined — nic nespouští. */
export function peek(op, args) {
  return cache.get(keyOf(op, JSON.stringify(args), stateNow()));
}

/** Vyřadí výsledek z cache klienta (další get ho vyžádá znovu). */
export function forget(key) { cache.delete(key); }

/** Zruší všechny výpočty (terminate) — nový Worker vznikne při dalším požadavku. `key` = zrušený výpočet kroku. */
export function cancel(key) {
  if (key) cancelled.add(key);
  if (worker) { try { worker.terminate(); } catch { /* ignore */ } }
  worker = null;
  const all = [inflight, ...queue.splice(0)].filter(Boolean);
  inflight = null;
  for (const r of all) {
    waiting.delete(r.key);
    r.reject(Object.assign(new Error("cancelled"), { cancelled: true }));
  }
}
/** Povolí znovu spustit zrušený výpočet (tlačítko Spočítat znovu). */
export function retry(key) { cancelled.delete(key); }

/** Běží výpočty mimo hlavní vlákno? (false = fallback synchronně) */
export function workerActive() { return !broken; }
/** Stav pro testy a měření. */
export function workerStats() { return { ...stats, broken, cache: cache.size, busy: inflight ? inflight.op : null, queued: queue.length }; }

/**
 * Zástupný stav kroku, dokud výsledek počítá Worker: průběh (uplynulý čas) a Zrušit; po zrušení
 * „Spočítat znovu“. `rerender` = překreslení kroku (po Zrušit / Spočítat znovu).
 */
export function pendingCard(el, num, title, r, text, rerender) {
  if (r.cancelled) {
    const c = card(el, num, title, "<p class='warnbox' id='wkCancelled'>" + tr("Výpočet byl zrušen.") + "</p>" +
      "<div class='row'><button class='primary' id='wkRetry'>" + tr("Spočítat znovu") + "</button></div>");
    c.querySelector("#wkRetry").addEventListener("click", () => { retry(r.key); rerender(); });
    return c;
  }
  const c = card(el, num, title,
    "<div class='emuprog' id='wkPending' role='status' aria-live='polite'><progress aria-label='" + esc(tr("Průběh výpočtu")) + "'></progress> " +
    "<span>" + esc(text) + " <span class='mono' id='wkElapsed'></span></span>" +
    "<button class='small' id='wkCancel'>" + tr("Zrušit") + "</button></div>" +
    "<p class='hint'>" + tr("Výpočet běží na pozadí, aplikaci můžeš dál používat. Výsledek se zobrazí sám, jakmile bude hotový.") + "</p>");
  const t0 = r.since || Date.now();
  const el2 = c.querySelector("#wkElapsed");
  const tick = () => { el2.textContent = tr("{s} s", { s: Math.round((Date.now() - t0) / 1000) }); };
  tick();
  const timer = setInterval(() => { if (!c.isConnected) { clearInterval(timer); return; } tick(); }, 500);
  c.querySelector("#wkCancel").addEventListener("click", () => { clearInterval(timer); cancel(r.key); rerender(); });
  return c;
}
