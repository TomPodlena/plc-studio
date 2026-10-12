/* PLCdesk — nápověda ve webové aplikaci: panel ke kroku (tlačítko ? a F1), obsah a hledání v kroku
   Nápověda, úvodní průvodce. Obsah je jen v jádře (packages/core/src/help.ts) — tady se jen vykresluje. */
import {
  helpChapter, helpChapters, helpForStep, searchHelp, helpTour, helpSiteUrl, helpFold, HELP_UI, HELP_GROUPS,
  tr, escHtml as esc,
} from "../../../packages/core/dist/index.js";
import { openFeedback } from "./feedback.js";

const CLIENT = "web";
const TOUR_KEY = "plcstudio.tour";

/** Text kapitoly → HTML: escapování a `**tučně**` → <b>. */
export const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

const onlyChip = x => x.only ? " <span class='helponly'>" + esc(tr(x.only === "web" ? HELP_UI.only_web : HELP_UI.only_desktop)) + "</span>" : "";

/** Tělo kapitoly (shrnutí, postup, tipy, chyby, související) — sdílí panel i krok Nápověda. */
export function chapterHtml(ch) {
  let h = "<p class='helpsum'>" + md(ch.summary) + "</p>";
  if (ch.steps.length) {
    h += "<h4>" + esc(tr(ch.id === "faq" ? HELP_UI.faq : HELP_UI.steps)) + "</h4>"
      + (ch.id === "zkratky" ? "<ul>" : "<ol>") + ch.steps.map(x => "<li>" + md(x.text) + onlyChip(x) + "</li>").join("") + (ch.id === "zkratky" ? "</ul>" : "</ol>");
  }
  if (ch.tips.length) h += "<h4>" + esc(tr(HELP_UI.tips)) + "</h4><ul>" + ch.tips.map(x => "<li>" + md(x.text) + onlyChip(x) + "</li>").join("") + "</ul>";
  if (ch.issues.length) {
    h += "<h4>" + esc(tr(ch.id === "faq" ? HELP_UI.faq : HELP_UI.issues)) + "</h4><dl class='helpissues'>"
      + ch.issues.map(x => "<dt>" + md(x.problem) + "</dt><dd>" + md(x.fix) + "</dd>").join("") + "</dl>";
  }
  if (ch.see.length) {
    h += "<p class='helpsee'><b>" + esc(tr(HELP_UI.see)) + ":</b> " + ch.see.map(id => {
      const c = helpChapter(id, undefined, CLIENT);
      return c ? "<button type='button' class='linkbtn' data-help-see='" + esc(id) + "'>" + esc(c.title) + "</button>" : "";
    }).join(" · ") + "</p>";
  }
  return h;
}

/* ---------------------------------------------------------------- panel ke kroku */

/**
 * Panel nápovědy ke kroku (vpravo, na úzkém displeji přes celou šířku). Nemodální — aplikace pod ním
 * zůstává ovladatelná; Esc nebo × ho zavře a fokus se vrátí na prvek, ze kterého se otevřel.
 * ctx = { S, gotoStep(step), openFull(id) }.
 */
export function makeHelpPanel(ctx) {
  let el = null, cur = null, back = null;
  const hist = [];

  function ensure() {
    if (el) return el;
    el = document.createElement("aside");
    el.id = "helpPanel";
    el.className = "helppanel";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "helpPanelTitle");
    el.tabIndex = -1;
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.helpSee) { hist.push(cur); show(b.dataset.helpSee); }
      else if (b.dataset.hp === "close") close();
      else if (b.dataset.hp === "back") { const id = hist.pop(); if (id) show(id); }
      else if (b.dataset.hp === "full") { const id = cur; close(false); ctx.openFull(id); }
      else if (b.dataset.hp === "step") { const st = +b.dataset.step; close(false); ctx.gotoStep(st); }
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "Tab") {         // fokus zůstává v panelu, dokud je otevřený a fokus v něm
        const f = [...el.querySelectorAll("button, a[href]")].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    return el;
  }

  function show(id) {
    const ch = helpChapter(id, undefined, CLIENT) || helpChapter("start", undefined, CLIENT);
    cur = ch.id;
    const p = ensure();
    const stepBtn = typeof ch.step === "number" && ch.step !== ctx.S.step
      ? "<button type='button' class='small' data-hp='step' data-step='" + ch.step + "'>" + esc(tr(HELP_UI.goStep)) + " " + (ch.step + 1) + " →</button>" : "";
    p.innerHTML = "<div class='hphead'><span class='hpkicker'>" + esc(tr(HELP_UI.panelTitle)) + "</span>"
      + "<button type='button' class='hpclose' data-hp='close' aria-label='" + esc(tr(HELP_UI.close)) + "' title='" + esc(tr(HELP_UI.close)) + " (Esc)'>×</button></div>"
      + "<h3 id='helpPanelTitle'>" + esc(ch.title) + "</h3>"
      + "<div class='hpbody'>" + chapterHtml(ch) + "</div>"
      + "<div class='hpfoot'>" + (hist.length ? "<button type='button' class='small' data-hp='back'>← " + esc(tr(HELP_UI.tourPrev)) + "</button>" : "")
      + stepBtn
      + "<button type='button' class='small' data-hp='full'>" + esc(tr(HELP_UI.full)) + "</button>"
      + "<a class='small btnlink' href='" + esc(helpSiteUrl(ch.id)) + "' target='_blank' rel='noopener'>" + esc(tr(HELP_UI.web)) + " ↗</a></div>";
    p.hidden = false;
    document.body.classList.add("helppanel-open");
    p.scrollTop = 0;
    p.focus({ preventScroll: true });
  }

  function open(id, from) {
    if (from !== undefined) back = from;
    else if (!el || el.hidden) back = document.activeElement;
    hist.length = 0;
    show(id);
  }
  function close(restore = true) {
    if (!el || el.hidden) return;
    el.hidden = true;
    document.body.classList.remove("helppanel-open");
    cur = null;
    if (restore && back && back.isConnected) try { back.focus(); } catch { /* ignore */ }
    back = null;
  }
  /** F1: panel k aktuálnímu kroku (když už je otevřený k tomuto kroku, zavře ho). */
  function toggleForStep(step) {
    const id = helpForStep(step);
    if (isOpen() && cur === id) close(); else open(id);
  }
  const isOpen = () => !!el && !el.hidden;
  /** Po přepnutí jazyka / kroku: otevřený panel překreslit (v novém jazyce). */
  function refresh() { if (isOpen()) show(cur); }
  return { open, close, toggleForStep, isOpen, refresh, current: () => cur };
}

/** Tlačítko ? do záhlaví prvního karty kroku (h2). */
export function addStepHelpButton(view, step, onClick) {
  const h = view.querySelector("section.card h2");
  if (!h || h.querySelector(".helpq")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "helpq";
  b.textContent = "?";
  b.title = tr(HELP_UI.open);
  b.setAttribute("aria-label", tr(HELP_UI.open));
  b.dataset.helpStep = String(step);
  b.addEventListener("click", () => onClick(b));
  h.appendChild(b);
}

/* ---------------------------------------------------------------- krok Nápověda */

let query = "";
/**
 * Hledání + obsah kapitol (do karty `c`, nad stávající „Školu PLC“). `focus` = id kapitoly, která se
 * má otevřít a ukázat (z panelu „Celá nápověda“).
 */
export function helpContentsHtml() {
  const chapters = helpChapters(undefined, CLIENT);
  let h = "<div class='helpsearch'><input type='search' id='helpQ' placeholder='" + esc(tr(HELP_UI.search)) + "' aria-label='" + esc(tr(HELP_UI.search)) + "' value='" + esc(query) + "' autocomplete='off'>"
    + "<button type='button' class='small' id='helpTour'>" + esc(tr(HELP_UI.tourStart)) + "</button>"
    + "<button type='button' class='small' id='helpFeedback'>" + esc(tr("Zpětná vazba")) + "</button></div>"
    + "<div id='helpResults' aria-live='polite'></div>"
    + "<h3>" + esc(tr(HELP_UI.contents)) + "</h3>";
  for (const g of Object.keys(HELP_GROUPS)) {
    const list = chapters.filter(c => c.group === g);
    if (!list.length) continue;
    h += "<h4 class='helpgroup'>" + esc(tr(HELP_GROUPS[g])) + "</h4>";
    for (const ch of list) {
      h += "<details class='help helpch' id='help-" + esc(ch.id) + "' data-ch='" + esc(ch.id) + "'><summary>"
        + (typeof ch.step === "number" ? "<span class='helpnum'>" + (ch.step + 1) + "</span>" : "") + esc(ch.title) + "</summary>"
        + "<div class='body'>" + chapterHtml(ch)
        + "<p><a href='" + esc(helpSiteUrl(ch.id)) + "' target='_blank' rel='noopener'>" + esc(tr(HELP_UI.web)) + " ↗</a></p></div></details>";
    }
  }
  return h;
}

/** Napojí hledání, odkazy mezi kapitolami a průvodce v kroku Nápověda. */
export function wireHelpContents(root, { focus, startTour, gotoStep }) {
  const res = root.querySelector("#helpResults"), q = root.querySelector("#helpQ");
  const openCh = id => {
    const d = root.querySelector("#help-" + CSS.escape(id));
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: "start" });
    const s = d.querySelector("summary");
    if (s) s.focus({ preventScroll: true });
  };
  const run = () => {
    query = q.value;
    const hits = searchHelp(query, undefined, CLIENT);
    if (!query.trim()) { res.innerHTML = ""; return; }
    const words = helpFold(query).split(/[\s,;]+/).filter(Boolean);
    const mark = s => {      // zvýraznění shody v úryvku (bez diakritiky)
      const f = helpFold(s);
      let out = "", i = 0;
      const marks = [];
      for (const w of words) { let k = f.indexOf(w); while (k >= 0 && w) { marks.push([k, k + w.length]); k = f.indexOf(w, k + w.length); } }
      marks.sort((a, b) => a[0] - b[0]);
      for (const [a, b] of marks) { if (a < i) continue; out += esc(s.slice(i, a)) + "<mark>" + esc(s.slice(a, b)) + "</mark>"; i = b; }
      return out + esc(s.slice(i));
    };
    res.innerHTML = "<h3>" + esc(tr(HELP_UI.results)) + "</h3>" + (hits.length
      ? "<ul class='helphits'>" + hits.map(h => "<li><button type='button' class='linkbtn' data-help-see='" + esc(h.id) + "'>" + esc(h.title) + "</button><div class='hint'>" + mark(h.snippet) + "</div></li>").join("") + "</ul>"
      : "<p class='hint'>" + esc(tr(HELP_UI.noResults)) + "</p>");
  };
  q.addEventListener("input", run);
  q.addEventListener("keydown", e => {
    if (e.key === "Enter") { const first = res.querySelector("[data-help-see]"); if (first) { e.preventDefault(); openCh(first.dataset.helpSee); } }
    else if (e.key === "Escape" && q.value) { q.value = ""; run(); }
  });
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-help-see]");
    if (b && root.contains(b)) { e.preventDefault(); openCh(b.dataset.helpSee); }
  });
  root.querySelector("#helpTour").addEventListener("click", () => startTour());
  root.querySelector("#helpFeedback").addEventListener("click", () => openFeedback());
  if (query) run();
  if (focus) setTimeout(() => openCh(focus), 0);
  void gotoStep;
}

/* ---------------------------------------------------------------- úvodní průvodce */

export function tourSeen() {
  try { return !!localStorage.getItem(TOUR_KEY); } catch { return true; }   // bez úložiště průvodce nevnucovat
}
function tourRemember(v) { try { localStorage.setItem(TOUR_KEY, v); } catch { /* ignore */ } }

/**
 * Překryv se zvýrazněním prvku (tlačítko kroku v liště, výběr příkladů, Nápověda) a kartou s textem;
 * Další / Zpět / Přeskočit, Esc = přeskočit. Projekt nemění. Zapamatuje se v localStorage `plcstudio.tour`.
 */
export function startTour({ S } = {}) {
  const stops = helpTour();
  let i = 0;
  document.getElementById("tourOverlay")?.remove();
  const ov = document.createElement("div");
  ov.id = "tourOverlay";
  ov.className = "tour";
  ov.innerHTML = "<div class='tourhole'></div><div class='tourcard' role='dialog' aria-modal='true' aria-labelledby='tourTitle' aria-describedby='tourText' tabindex='-1'>"
    + "<div class='tourprog' id='tourProg'></div><h3 id='tourTitle'></h3><p id='tourText'></p>"
    + "<div class='row'><button type='button' class='small' id='tourSkip'></button><span style='flex:1'></span>"
    + "<button type='button' class='small' id='tourPrev'></button><button type='button' class='small primary' id='tourNext'></button></div></div>";
  document.body.appendChild(ov);
  const back = document.activeElement;
  const hole = ov.querySelector(".tourhole"), card = ov.querySelector(".tourcard");
  const target = s => {
    if (s.target === "help") return document.querySelector("#stepper button[data-help]");
    if (s.target === "samples") {
      const r = document.getElementById("sampleRow");
      if (r && !r.hidden && S && S.step === 0) return r;
      return document.querySelector("#stepper button[data-i='0']");
    }
    return document.querySelector("#stepper button[data-i='" + s.target + "']");
  };
  function place() {
    const t = target(stops[i]);
    const vw = document.documentElement.clientWidth;
    if (t) {
      t.scrollIntoView({ block: "nearest" });
      const r = t.getBoundingClientRect(), pad = 6;
      Object.assign(hole.style, { display: "block", left: (r.left - pad) + "px", top: (r.top - pad) + "px", width: (r.width + 2 * pad) + "px", height: (r.height + 2 * pad) + "px" });
      const cw = Math.min(380, vw - 32);
      card.style.width = cw + "px";
      card.style.left = Math.max(16, Math.min(vw - cw - 16, r.left)) + "px";
      const below = r.bottom + 14, ch = card.offsetHeight || 200;
      card.style.top = (below + ch < innerHeight - 8 ? below : Math.max(8, r.top - ch - 14)) + "px";
    } else {
      hole.style.display = "none";
      const cw = Math.min(380, vw - 32);
      Object.assign(card.style, { width: cw + "px", left: ((vw - cw) / 2) + "px", top: "20vh" });
    }
  }
  function draw() {
    const s = stops[i];
    ov.querySelector("#tourProg").textContent = tr(HELP_UI.tourOf, { n: i + 1, m: stops.length });
    ov.querySelector("#tourTitle").textContent = s.title;
    ov.querySelector("#tourText").textContent = s.text;
    ov.querySelector("#tourSkip").textContent = tr(HELP_UI.tourSkip);
    const prev = ov.querySelector("#tourPrev");
    prev.textContent = "← " + tr(HELP_UI.tourPrev);
    prev.disabled = i === 0;
    ov.querySelector("#tourNext").textContent = i === stops.length - 1 ? tr(HELP_UI.tourDone) : tr(HELP_UI.tourNext) + " →";
    ov.dataset.stop = s.id;
    place();
    ov.querySelector("#tourNext").focus();
  }
  function end(how) {
    tourRemember(how);
    removeEventListener("resize", place);
    ov.remove();
    if (back && back.isConnected) try { back.focus(); } catch { /* ignore */ }
  }
  ov.querySelector("#tourNext").addEventListener("click", () => { if (i < stops.length - 1) { i++; draw(); } else end("done"); });
  ov.querySelector("#tourPrev").addEventListener("click", () => { if (i > 0) { i--; draw(); } });
  ov.querySelector("#tourSkip").addEventListener("click", () => end("skipped"));
  ov.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end("skipped"); }
    else if (e.key === "ArrowRight" && !e.altKey) { e.preventDefault(); ov.querySelector("#tourNext").click(); }
    else if (e.key === "ArrowLeft" && !e.altKey) { e.preventDefault(); ov.querySelector("#tourPrev").click(); }
    else if (e.key === "Tab") {
      const f = [...card.querySelectorAll("button:not([disabled])")];
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  addEventListener("resize", place);
  draw();
  return { next: () => ov.querySelector("#tourNext").click(), prev: () => ov.querySelector("#tourPrev").click(), skip: () => end("skipped") };
}
