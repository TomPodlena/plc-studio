/**
 * PLCdesk — HMI: SVG náhledy obrazovek, JSON popis obrazovek a samostatné webové HMI.
 *
 * Jedna geometrie (`HmiScreen.elems` z hmi.ts) → SVG náhled (výkres v dokumentaci, desktop,
 * web) i webové HMI: stránka obsahuje tytéž SVG a skript jen mění barvy / hodnoty prvků
 * označených `data-k` / `data-r` podle hodnot tagů. Prvky nesou `data-dev`, `data-tag`,
 * `data-screen`, `data-step` a popis v `<title>` (jako schémata v drawing.ts).
 */
import { esc } from "./model.js";
import { tr, getLang } from "./i18n.js";
import { buildHmi, alarmClassLabel } from "./hmi.js";
/* ================================================================ SVG */
const C = {
    bg: "#d9dcdf", panel: "#eef0f1", line: "#8a949c", text: "#1d2329", mute: "#5b6670",
    head: "#2b3540", headText: "#ffffff", idle: "#9aa3ab", run: "#2e9e4f", busy: "#e3b505", err: "#d23b2f", blue: "#2f6fb5",
};
const LAMP = { green: C.run, red: C.err, yellow: C.busy, blue: C.blue };
const CLS_COLOR = { fault: C.err, stop: C.busy, warning: C.blue };
function trunc(s, n) {
    const t = String(s ?? "");
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
const R = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${C.line}" stroke-width="1"${extra}/>`;
const Tx = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 12}" text-anchor="${o.anchor || "start"}" fill="${o.fill || C.text}"${o.bold ? ' font-weight="bold"' : ""}${o.r ? ` data-r="${o.r}"` : ""}>${esc(s)}</text>`;
const tagsAttr = (e) => e.tags && Object.keys(e.tags).length ? ` data-tags="${esc(JSON.stringify(e.tags))}"` : "";
const tagAttr = (e) => {
    const t = e.tags && (e.tags.cmd || e.tags.on || e.tags.value || e.tags.run || e.tags.open);
    return t ? ` data-tag="${esc(t)}"` : "";
};
function elemSVG(e) {
    const { x, y, w, h } = e;
    const g = (body, title) => `<g data-k="${e.k}"${e.dev ? ` data-dev="${esc(e.dev)}"` : ""}${tagAttr(e)}${e.screen ? ` data-screen="${esc(e.screen)}"` : ""}${e.cmd ? ` data-cmd="${e.cmd}"` : ""}${tagsAttr(e)}><title>${esc(title)}</title>${body}</g>`;
    const devTitle = (e.label || "") + (e.sub ? " — " + e.sub : "");
    switch (e.k) {
        case "header": {
            let b = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.head}"/>` +
                Tx(x + 12, y + 30, trunc(e.label, 30), { size: 16, fill: C.headText, bold: true }) +
                Tx(x + 330, y + 30, e.sub || "", { size: 15, fill: C.headText });
            let lx = 520;
            const lamp = (role, label, color) => {
                b += `<circle cx="${lx}" cy="${y + 24}" r="8" fill="${C.idle}" stroke="#000" stroke-width="0.5" data-r="${role}" data-on="${color}"/>` + Tx(lx + 12, y + 28, label, { size: 11, fill: C.headText });
                lx += 96;
            };
            if (e.tags?.enable)
                lamp("enable", tr("Uvolnění"), C.run);
            if (e.tags?.auto)
                lamp("auto", "AUTO", C.blue);
            if (e.tags?.fault)
                lamp("fault", tr("Porucha"), C.err);
            if (e.tags?.step)
                b += Tx(lx, y + 28, tr("Krok") + ": —", { size: 11, fill: C.headText, r: "step" });
            return g(b, (e.label || "") + " — " + (e.sub || ""));
        }
        case "nav":
            return g(R(x, y, w, h, C.panel, ' rx="4"') + Tx(x + w / 2, y + h / 2 + 5, trunc(e.label, 22), { size: 13, anchor: "middle", bold: true }), e.label || "");
        case "motor":
            return g(R(x, y, w, h, C.panel) +
                `<circle cx="${x + 28}" cy="${y + 34}" r="18" fill="${C.idle}" stroke="${C.text}" stroke-width="1.5" data-r="sym"/>` +
                Tx(x + 28, y + 40, "M", { size: 16, anchor: "middle", bold: true }) +
                Tx(x + 54, y + 24, e.label || "", { size: 13, bold: true }) +
                Tx(x + 54, y + 42, "—", { size: 10, fill: C.mute, r: "state" }) +
                Tx(x + 6, y + 70, trunc(e.sub, 19), { size: 10, fill: C.mute }), devTitle);
        case "valve": {
            const cx = x + 28, cy = y + 34;
            return g(R(x, y, w, h, C.panel) +
                `<path d="M${cx - 18},${cy - 12} L${cx + 18},${cy + 12} L${cx + 18},${cy - 12} L${cx - 18},${cy + 12} Z" fill="${C.idle}" stroke="${C.text}" stroke-width="1.5" data-r="sym"/>` +
                `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 20}" stroke="${C.text}" stroke-width="1.5"/>` +
                `<rect x="${cx - 8}" y="${cy - 28}" width="16" height="8" fill="${C.panel}" stroke="${C.text}"/>` +
                Tx(x + 54, y + 24, e.label || "", { size: 13, bold: true }) +
                Tx(x + 54, y + 42, "—", { size: 10, fill: C.mute, r: "state" }) +
                Tx(x + 6, y + 70, trunc(e.sub, 19), { size: 10, fill: C.mute }), devTitle);
        }
        case "analog":
        case "aout": {
            const lim = [Number.isFinite(e.limLo) ? "min " + e.limLo : "", Number.isFinite(e.limHi) ? "max " + e.limHi : ""].filter(Boolean).join(" · ");
            return g(R(x, y, w, h, C.panel) +
                Tx(x + 6, y + 16, e.label || "", { size: 13, bold: true }) +
                Tx(x + w - 6, y + 16, e.k === "aout" ? "SP" : "PV", { size: 10, anchor: "end", fill: C.mute }) +
                R(x + 6, y + 22, w - 12, 24, "#ffffff", ' data-r="box"') +
                Tx(x + w - 10, y + 39, "—", { size: 13, anchor: "end", bold: true, r: "val" }) +
                Tx(x + 10, y + 39, trunc(e.unit, 6), { size: 10, fill: C.mute }) +
                `<rect x="${x + 6}" y="${y + 50}" width="${w - 12}" height="6" fill="#ffffff" stroke="${C.line}" stroke-width="0.5"/>` +
                `<rect x="${x + 6}" y="${y + 50}" width="0" height="6" fill="${C.blue}" data-r="bar"/>` +
                Tx(x + 6, y + 70, trunc(lim || e.sub, 19), { size: 10, fill: C.mute }) +
                Tx(x + 6, y + 82, trunc(lim ? e.sub : "", 19), { size: 10, fill: C.mute }), devTitle);
        }
        case "di":
        case "do": {
            const on = e.k === "di" ? (e.role ? C.run : C.blue) : (LAMP[e.color || "yellow"]);
            return g(R(x, y, w, h, C.panel) +
                `<circle cx="${x + 24}" cy="${y + 32}" r="13" fill="${C.idle}" stroke="${C.text}" stroke-width="1.2" data-r="sym" data-on="${on}"/>` +
                (e.role === "estop" ? `<circle cx="${x + 24}" cy="${y + 32}" r="17" fill="none" stroke="${C.busy}" stroke-width="3"/>` : "") +
                Tx(x + 46, y + 24, e.label || "", { size: 13, bold: true }) +
                Tx(x + 46, y + 42, e.k === "di" ? "DI" : "DO", { size: 10, fill: C.mute }) +
                Tx(x + 6, y + 70, trunc(e.sub, 19), { size: 10, fill: C.mute }), devTitle);
        }
        case "button":
            return g(R(x, y, w, h, "#f7f8f9", ' rx="5" data-r="btn"') + Tx(x + w / 2, y + h / 2 + 5, e.label || "", { size: 13, anchor: "middle", bold: true }), (e.label || "") + (e.tags?.cmd ? " → " + e.tags.cmd : ""));
        case "lamp":
            return g(R(x, y, w, h, C.panel, ' rx="4"') +
                `<circle cx="${x + 18}" cy="${y + h / 2}" r="9" fill="${C.idle}" stroke="${C.text}" data-r="sym" data-on="${LAMP[e.color || "green"]}"/>` +
                Tx(x + 34, y + h / 2 + 4, e.label || "", { size: 12 }), (e.label || "") + (e.tags?.on ? " ← " + e.tags.on : ""));
        case "value":
            return g(R(x, y, w, h, C.panel) + Tx(x + 8, y + h / 2 + 4, e.label || "", { size: 12 }) +
                R(x + w * 0.45, y + 3, w * 0.55 - 4, h - 6, "#ffffff") + Tx(x + w * 0.45 + 8, y + h / 2 + 4, "—", { size: 12, bold: true, r: "val" }), (e.label || "") + " ← " + (e.tags?.value || ""));
        case "text":
            return `<g data-k="text">${Tx(x, y + 16, e.label || "", { size: 12, fill: C.mute })}</g>`;
        case "steps":
            return g((e.steps || []).map((s, i) => `<g data-step="${s.value}"><title>${esc(s.text + " — " + s.sub)}</title>` +
                R(x, y + i * 25, w, 23, C.panel, ' data-r="row"') +
                Tx(x + 6, y + i * 25 + 16, trunc(s.text, 34), { size: 12, bold: true }) +
                Tx(x + w - 6, y + i * 25 + 16, trunc(s.sub, 30), { size: 10, anchor: "end", fill: C.mute }) + "</g>").join(""), tr("Kroky sekvence"));
        case "alarmview": {
            let b = R(x, y, w, h, "#ffffff") + `<rect x="${x}" y="${y}" width="${w}" height="24" fill="${C.head}"/>` +
                Tx(x + 8, y + 17, tr("Č."), { size: 12, fill: C.headText, bold: true }) +
                Tx(x + 60, y + 17, tr("Třída"), { size: 12, fill: C.headText, bold: true }) +
                Tx(x + 240, y + 17, tr("Text alarmu"), { size: 12, fill: C.headText, bold: true }) +
                `<g data-r="list">`;
            (e.alarms || []).forEach((a, i) => {
                const yy = y + 26 + i * 24;
                b += `<g opacity="0.55"><rect x="${x + 2}" y="${yy}" width="6" height="20" fill="${CLS_COLOR[a.cls]}"/>` +
                    Tx(x + 14, yy + 15, String(a.id), { size: 11 }) + Tx(x + 60, yy + 15, trunc(alarmClassLabel(a.cls), 24), { size: 11 }) +
                    Tx(x + 240, yy + 15, trunc(a.text, 100), { size: 11 }) + "</g>";
            });
            return g(b + "</g>", e.label || "");
        }
        case "table": {
            const cols = e.cols || [];
            let b = "", cx = x;
            (e.head || []).forEach((hd, i) => { b += R(cx, y, cols[i], 26, C.head) + Tx(cx + 6, y + 17, hd, { size: 12, fill: C.headText, bold: true }); cx += cols[i]; });
            (e.rows || []).forEach((row, ri) => {
                cx = x;
                const yy = y + 26 * (ri + 1);
                row.forEach((c, i) => {
                    if ("tag" in c)
                        b += `<g data-k="value" data-tag="${esc(c.tag)}" data-tags="${esc(JSON.stringify({ value: c.tag }))}">` + R(cx, yy, cols[i], 26, "#ffffff") + Tx(cx + 6, yy + 17, "—", { size: 12, bold: true, r: "val" }) + "</g>";
                    else
                        b += R(cx, yy, cols[i], 26, C.panel) + Tx(cx + 6, yy + 17, trunc(c.t, Math.floor(cols[i] / 7)), { size: 12 });
                    cx += cols[i];
                });
            });
            return `<g data-k="table">${b}</g>`;
        }
        case "manrow":
            return g(R(x, y, w, h, C.panel) +
                `<circle cx="${x + 18}" cy="${y + h / 2}" r="9" fill="${C.idle}" stroke="${C.text}" data-r="sym"/>` +
                Tx(x + 34, y + 15, e.label || "", { size: 13, bold: true }) +
                Tx(x + 34, y + 30, trunc(e.sub, 30), { size: 10, fill: C.mute }) +
                Tx(x + 290, y + 23, "—", { size: 11, fill: C.mute, r: "state" }) +
                `<g data-k="button" data-cmd="toggle"${e.tags?.cmd ? ` data-tag="${esc(e.tags.cmd)}" data-tags="${esc(JSON.stringify({ cmd: e.tags.cmd }))}"` : ""}>` +
                R(x + w - 104, y + 4, 98, h - 8, "#f7f8f9", ' rx="5" data-r="btn"') + Tx(x + w - 55, y + h / 2 + 5, tr("ZAP / VYP"), { size: 12, anchor: "middle", bold: true }) + "</g>", devTitle + (e.tags?.cmd ? " → " + e.tags.cmd : ""));
    }
    return "";
}
/** SVG náhled obrazovky (klidový stav: vše šedé, hodnoty „—"). */
export function hmiScreenSVG(s) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.W} ${s.H}" width="${s.W}" height="${s.H}" font-family="Segoe UI, Arial, sans-serif" data-screen-id="${esc(s.id)}">` +
        `<title>${esc(s.title + (s.pages > 1 ? " " + s.page + "/" + s.pages : ""))}</title>` +
        `<rect x="0" y="0" width="${s.W}" height="${s.H}" fill="${C.bg}"/>` +
        s.elems.map(elemSVG).join("") + "</svg>";
}
/* ================================================================ JSON */
export const HMI_JSON_FORMAT = "plcdesk-hmi";
/** JSON popis HMI (tagy, alarmy, obrazovky) pro budoucí runtime. */
export function hmiJson(prj, m = buildHmi(prj)) {
    return JSON.stringify({
        format: HMI_JSON_FORMAT, version: 1, lang: getLang(), project: m.project,
        note: tr("Návrh HMI k revizi (PLCdesk). Tagy odkazují na proměnné generovaného programu; cesty pro platformy viz 16_hmi.md."),
        tags: m.tags, alarms: m.alarms, screens: m.screens,
    }, null, 1);
}
/* ================================================================ webové HMI */
/**
 * Samostatná statická stránka webového HMI (bez závislostí): SVG obrazovky, navigace,
 * živý seznam alarmů, tlačítka. Připojení: režim „demo" (lokální hodnoty) nebo WebSocket
 * s jednoduchým JSON protokolem — stub pro bránu OPC UA ↔ WebSocket (prohlížeč OPC UA
 * binárně neumí). Protokol: klient → `{op:"subscribe",tags:[…]}`, `{op:"write",tag,value}`;
 * server → `{op:"update",values:{tag:value,…}}`.
 */
export function hmiWebHtml(prj, m = buildHmi(prj)) {
    const L = {
        title: tr("HMI — {name}", { name: m.project || "PLCdesk" }),
        demo: tr("Demo (bez PLC)"), connect: tr("Připojit"), url: tr("Adresa brány WebSocket"),
        off: tr("odpojeno"), on: tr("připojeno"), demoOn: tr("demo režim"),
        none: tr("Žádné aktivní alarmy"), note: tr("Návrh HMI k revizi — neověřeno na cílovém HMI; připojení k PLC přes bránu OPC UA / WebSocket je kostra k doplnění."),
        ok: tr("v pořádku"), busy: tr("přestavuje / rozbíhá"), err: tr("porucha"), runS: tr("běží / otevřeno"), idleS: tr("stojí / zavřeno"),
        step: tr("Krok"),
    };
    const data = JSON.stringify({ tags: m.tags, alarms: m.alarms, screens: m.screens.map(s => ({ id: s.id, kind: s.kind, title: s.title })), L })
        .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    const screens = m.screens.map((s, i) => `<section class="scr" id="scr-${esc(s.id)}"${i ? " hidden" : ""}>${hmiScreenSVG(s)}</section>`).join("\n");
    return `<!doctype html>
<html lang="${getLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L.title)}</title>
<style>
:root{--bg:#c9cdd1;--fg:#1d2329;--bar:#2b3540}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Segoe UI",Arial,sans-serif}
header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 12px;background:var(--bar);color:#fff;font-size:13px}
header input{min-width:220px;padding:3px 6px}
header button{padding:3px 10px;cursor:pointer}
main{padding:8px;display:flex;justify-content:center}
.scr svg{max-width:100%;height:auto;display:block;box-shadow:0 2px 8px #0004}
[data-k=nav],[data-k=button]{cursor:pointer}
[data-k=button]:active [data-r=btn]{fill:#cfd8e3}
.note{font-size:12px;text-align:center;padding:4px 12px 12px;color:#39434c}
@keyframes blink{50%{opacity:.35}}
.blink{animation:blink 1s step-start infinite}
</style>
</head>
<body>
<header><strong>${esc(L.title)}</strong>
<label>${esc(L.url)} <input id="url" value="ws://localhost:8080/hmi"></label>
<button id="btnConnect">${esc(L.connect)}</button><button id="btnDemo">${esc(L.demo)}</button>
<span id="conn">${esc(L.off)}</span></header>
<main>
${screens}
</main>
<p class="note">${esc(L.note)}</p>
<script type="application/json" id="hmi-model">${data}</script>
<script>
"use strict";
(function () {
  var M = JSON.parse(document.getElementById("hmi-model").textContent), L = M.L;
  var V = {}, byName = {};
  M.tags.forEach(function (t) { byName[t.name] = t; V[t.name] = t.type === "BOOL" ? false : 0; });
  var COL = { idle: "#9aa3ab", run: "#2e9e4f", busy: "#e3b505", err: "#d23b2f", blue: "#2f6fb5" };
  var conn = null, demo = false;

  /* --- connection: WebSocket gateway (stub) or demo --- */
  function setConn(t) { document.getElementById("conn").textContent = t; }
  function write(tag, value) {
    var t = byName[tag];
    if (!t || t.access !== "RW") return;
    if (conn && conn.readyState === 1) conn.send(JSON.stringify({ op: "write", tag: tag, value: value }));
    if (demo || !conn) { V[tag] = value; demoScan(); render(); }
  }
  document.getElementById("btnConnect").onclick = function () {
    try {
      if (conn) conn.close();
      demo = false;
      conn = new WebSocket(document.getElementById("url").value);
      conn.onopen = function () { setConn(L.on); conn.send(JSON.stringify({ op: "subscribe", tags: Object.keys(byName) })); };
      conn.onclose = function () { setConn(L.off); };
      conn.onmessage = function (ev) {
        try { var m = JSON.parse(ev.data); if (m && m.op === "update" && m.values) { for (var k in m.values) if (k in V) V[k] = m.values[k]; render(); } } catch (e) { }
      };
    } catch (e) { setConn(L.off + " (" + e.message + ")"); }
  };
  document.getElementById("btnDemo").onclick = function () { if (conn) conn.close(); conn = null; demo = true; V.enable = true; setConn(L.demoOn); demoScan(); render(); };

  /* --- demo: manual commands go straight to block outputs (screen preview only) --- */
  function demoScan() {
    if (!demo) return;
    M.tags.forEach(function (t) {
      var m = /^(manRun|manOpen)_(\\w+)$/.exec(t.name);
      if (!m) return;
      var inst = "inst" + m[2], out = inst + (m[1] === "manRun" ? "_outRun" : "_outOpen");
      if (out in V) V[out] = !!V[t.name] && !V.modeAuto && !!V.enable;
    });
    if (V.cmdAck) { V.machineFault = false; }
  }

  /* --- rendering --- */
  function num(v) { return typeof v === "number" ? (Math.round(v * 100) / 100).toString() : String(v); }
  function stateText(t, v) {
    if (t && t.states) for (var i = 0; i < t.states.length; i++) if (t.states[i].value === v) return t.states[i].text;
    return num(v);
  }
  function tagsOf(g) { try { return JSON.parse(g.getAttribute("data-tags") || "{}"); } catch (e) { return {}; } }
  function part(g, r) { return g.querySelector('[data-r="' + r + '"]'); }
  function active() { var s = document.querySelector(".scr:not([hidden])"); return s || document.body; }
  function render() {
    var root = active();
    root.querySelectorAll("g[data-k]").forEach(function (g) {
      var k = g.getAttribute("data-k"), T = tagsOf(g), sym = part(g, "sym");
      if (k === "motor" || k === "valve" || k === "manrow") {
        var run = !!V[T.run], busy = !!V[T.busy], err = !!V[T.err];
        var c = err ? COL.err : busy ? COL.busy : run ? COL.run : COL.idle;
        if (sym) { sym.setAttribute("fill", c); sym.classList.toggle("blink", busy); }
        var st = part(g, "state");
        if (st) st.textContent = err ? L.err : busy ? L.busy : run ? L.runS : L.idleS;
      } else if (k === "di" || k === "do" || k === "lamp") {
        if (sym) sym.setAttribute("fill", V[T.on] ? sym.getAttribute("data-on") : COL.idle);
      } else if (k === "analog" || k === "aout") {
        var t = byName[T.value], v = V[T.value], val = part(g, "val"), bar = part(g, "bar"), box = part(g, "box");
        if (val) val.textContent = num(v);
        if (bar && t && t.max > t.min) bar.setAttribute("width", String(Math.max(0, Math.min(1, (v - t.min) / (t.max - t.min))) * 108));
        if (box) box.setAttribute("fill", V[T.hi] || V[T.lo] ? "#f6c9c4" : "#ffffff");
      } else if (k === "value") {
        var vv = part(g, "val");
        if (vv) vv.textContent = stateText(byName[T.value], V[T.value]);
      } else if (k === "button") {
        var b = part(g, "btn");
        if (b && g.getAttribute("data-cmd") === "toggle") b.setAttribute("fill", V[T.cmd] ? "#bfe3c8" : "#f7f8f9");
      } else if (k === "steps") {
        g.querySelectorAll("[data-step]").forEach(function (s) {
          var row = s.querySelector('[data-r="row"]');
          if (row) row.setAttribute("fill", +s.getAttribute("data-step") === V[T.step] ? "#bfe3c8" : "#eef0f1");
        });
      } else if (k === "header") {
        [["enable", COL.run], ["auto", COL.blue], ["fault", COL.err]].forEach(function (p) {
          var e = part(g, p[0]); if (e) e.setAttribute("fill", V[T[p[0]]] ? p[1] : COL.idle);
        });
        var s = part(g, "step"); if (s) s.textContent = L.step + ": " + (T.step ? stateText(byName[T.step], V[T.step]) : "—");
      } else if (k === "alarmview") {
        var list = part(g, "list"); if (!list) return;
        var y0 = +part(g, "list").parentNode.querySelector("rect").getAttribute("y") + 26, x0 = +part(g, "list").parentNode.querySelector("rect").getAttribute("x");
        var act = M.alarms.filter(function (a) {
          var tv = V[a.trigger.tag];
          return a.trigger.kind === "bit" ? !!tv : a.trigger.kind === "bitOff" ? (demo || conn) && !tv : tv === a.trigger.value && tv !== 0;
        });
        var ns = "http://www.w3.org/2000/svg", html = "";
        act.slice(0, 16).forEach(function (a, i) {
          var y = y0 + i * 24, c = a.cls === "fault" ? COL.err : a.cls === "stop" ? COL.busy : COL.blue;
          html += '<rect x="' + (x0 + 2) + '" y="' + y + '" width="6" height="20" fill="' + c + '"/><text x="' + (x0 + 14) + '" y="' + (y + 15) + '" font-size="11">' + a.id + '</text><text x="' + (x0 + 240) + '" y="' + (y + 15) + '" font-size="11"></text>';
        });
        list.innerHTML = html || '<text x="' + (x0 + 14) + '" y="' + (y0 + 15) + '" font-size="12" fill="#5b6670"></text>';
        var texts = list.querySelectorAll("text");
        if (!act.length) texts[0].textContent = L.none;
        else act.slice(0, 16).forEach(function (a, i) { texts[i * 2 + 1].textContent = a.text; });
        void ns;
      }
    });
  }

  /* --- operation: navigation and buttons --- */
  document.addEventListener("click", function (ev) {
    var nav = ev.target.closest && ev.target.closest('[data-k="nav"]');
    if (nav) {
      var id = nav.getAttribute("data-screen");
      document.querySelectorAll(".scr").forEach(function (s) { s.hidden = s.id !== "scr-" + id; });
      render(); return;
    }
    var b = ev.target.closest && ev.target.closest('[data-k="button"]');
    if (b && b.getAttribute("data-cmd") === "toggle") { var t = tagsOf(b).cmd; if (t) write(t, !V[t]); }
  });
  function momentary(ev, val) {
    var b = ev.target.closest && ev.target.closest('[data-k="button"]');
    if (b && b.getAttribute("data-cmd") === "momentary") { var t = tagsOf(b).cmd; if (t) write(t, val); }
  }
  document.addEventListener("pointerdown", function (ev) { momentary(ev, true); });
  document.addEventListener("pointerup", function (ev) { momentary(ev, false); });
  render();
})();
</script>
</body>
</html>
`;
}
