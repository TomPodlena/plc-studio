/* PLCdesk — krok Generovat, záložka HMI: náhledy obrazovek, tagy, alarmy a exporty pro panely.
   Vše počítá jádro (hmi.ts, hmi_view.ts, hmi_export.ts): buildHmi → obrazovky (SVG s data-dev),
   tagy a alarmy; hmiFiles / hmiSiemensWorkbook → exporty výrobců se stavem ověření (hmiExportSpec);
   hmiWebHtml → samostatné webové HMI. Desktop má totéž v steps/hmi.py (operace mostu hmi*). */
import {
  PLAT, CLS, esc, tr, N_, syncIO, buildHmi, hmiScreenSVG, hmiFiles, hmiExportSpec, hmiStatusLabel,
  hmiSiemensWorkbook, hmiWebHtml, hmiPlcPath, alarmClassLabel, stepTitle, HMI_DOC_FILE,
} from "../../../packages/core/dist/index.js";
import { card, downloadFile, downloadFiles } from "./util.js";
import { trn } from "./plural.js";

/** Skupiny tagů HMI (HmiGroup) → popisek. */
export const HMI_GROUPS = { ctrl: N_("řízení stroje"), dev: N_("blok zařízení"), seq: N_("sekvence"), ana: N_("analog"), io: N_("signál I/O"), par: N_("parametr") };
/** Spouštěč alarmu slovy. */
export function triggerText(tg) {
  if (!tg) return "";
  return tg.tag + " = " + (tg.kind === "bit" ? "TRUE" : tg.kind === "bitOff" ? "FALSE" : String(tg.value));
}
/** Třída CSS stavu ověření exportu (unverified / reference / stub). */
export const STATUS_CLS = { unverified: "st-stale", reference: "st-wait", stub: "st-rej" };
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const SIEMENS_XLSX = "hmi_siemens.xlsx";

/** Panel zařízení (web): popis, signály a kroky programu s odkazy na kroky Zařízení / I/O / Schéma. */
export function devicePanelHtml(p, d) {
  if (!d) return "<p class='hint' style='margin:0'>" + tr("Klikni na prvek obrazovky se zařízením — zobrazí se jeho popis, signály a kroky programu.") + "</p>";
  const io = p.io.filter(e => e.devId === d.id);
  const steps = p.program.seq.map((s, i) => ({ s, i })).filter(x => x.s.dev === d.id);
  return "<h3 style='margin-top:0'>" + esc(d.name) + "</h3>" +
    "<p class='hint' style='margin:0'>" + esc(tr(CLS[d.cls]?.label || d.cls)) + (d.desc ? " · " + esc(d.desc) : "") + "</p>" +
    "<h4>" + tr("Signály") + "</h4>" +
    (io.length ? "<ul class='plain'>" + io.map(e => "<li><span class='dir" + e.dir + "'>" + e.dir + "</span> <code>" + esc(e.tag) + "</code> <span class='hint' style='margin:0'>" + esc(e.addr) + "</span></li>").join("") + "</ul>" : "<p class='hint' style='margin:0'>—</p>") +
    "<h4>" + tr("Kroky programu") + "</h4>" +
    (steps.length ? "<ul class='plain'>" + steps.map(x => "<li>" + tr("Krok {n}", { n: x.i + 1 }) + ": " + esc(stepTitle(p, x.s)) + "</li>").join("") + "</ul>" : "<p class='hint' style='margin:0'>" + tr("V sekvenci se nepoužívá.") + "</p>") +
    "<div class='row' style='margin-top:10px'><button class='small' data-go='3'>" + tr("Zařízení") + " ↗</button><button class='small' data-go='4'>" + tr("I/O") + " ↗</button><button class='small' data-go='5'>" + tr("Schéma") + " ↗</button></div>";
}

export function makeHmiTab(ctx) {
  const { S, save, render } = ctx;
  /* pohled (drží se mezi překresleními): obrazovka, podzáložka, platforma exportu, vybraný soubor, zařízení */
  const view = { screen: 0, sub: "screens", plat: null, file: null, dev: null };
  const go = i => { S.step = i; save(); render(); };

  function render_(el) {
    const p = S.prj;
    syncIO(p);
    if (!p.devices.length) { card(el, "08", tr("HMI"), "<p class='hint'>" + tr("Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku AI návrh, nebo použij volbu Import.") + "</p>"); return; }
    const m = buildHmi(p);
    if (view.screen >= m.screens.length) view.screen = 0;
    const plats = [...p.platforms, ...Object.keys(PLAT).filter(k => !p.platforms.includes(k))];
    if (!view.plat || !PLAT[view.plat]) view.plat = p.platforms[0] || "siemens";
    const subs = [["screens", tr("Obrazovky")], ["tags", trn(m.tags.length, N_("{n} tag|{n} tagy|{n} tagů"))], ["alarms", trn(m.alarms.length, N_("{n} alarm|{n} alarmy|{n} alarmů"))], ["export", tr("Export pro panel")]];
    const c = card(el, "08", tr("HMI — obrazovky, tagy, alarmy a export"), `
      <p class="hint" style="margin-top:0;max-width:86ch">${tr("Návrh obsluhy z téhož modelu jako program: tagy ukazují na proměnné, které program deklaruje, alarmy mají stejné kódy a texty jako seznam alarmů. Návrh k revizi — neověřeno na cílovém HMI.")}</p>
      <div class="row" style="margin-top:6px">
        <span class="stat">${trn(m.screens.length, N_("{n} obrazovka|{n} obrazovky|{n} obrazovek"))}</span>
        <span class="stat">${trn(m.tags.length, N_("{n} tag|{n} tagy|{n} tagů"))}</span>
        <span class="stat">${trn(m.alarms.length, N_("{n} alarm|{n} alarmy|{n} alarmů"))}</span>
        <button class="small primary" id="hmiWebOpen">${tr("Otevřít webové HMI")}</button>
        <button class="small" id="hmiWebDl">${tr("Stáhnout webové HMI")}</button>
      </div>
      <div class="tabs outer" role="tablist" style="margin-top:12px">${subs.map(([k, l]) => "<button role='tab' data-hsub='" + k + "' aria-selected='" + (view.sub === k) + "'>" + esc(l) + "</button>").join("")}</div>
      <div id="hmiBody" style="margin-top:12px"></div>
      <p class="note">${tr("Dokument {file} a soubory HMI jsou i v kroku Dokumentace. Webové HMI běží v prohlížeči v režimu demo; připojení k PLC přes bránu OPC UA / WebSocket je kostra k doplnění.", { file: "<code>" + HMI_DOC_FILE + "</code>" })}</p>`);
    c.querySelectorAll("[data-hsub]").forEach(b => b.addEventListener("click", () => { view.sub = b.dataset.hsub; render(); }));
    c.querySelector("#hmiWebOpen").addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([hmiWebHtml(p, m)], { type: "text/html;charset=utf-8" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
    c.querySelector("#hmiWebDl").addEventListener("click", () => downloadFile("hmi_web.html", hmiWebHtml(p, m)));
    const body = c.querySelector("#hmiBody");

    if (view.sub === "screens") {
      const s = m.screens[view.screen];
      const dev = p.devices.find(d => d.name === view.dev);
      body.innerHTML =
        "<div class='tabs' role='tablist'>" + m.screens.map((x, i) => "<button role='tab' data-hscr='" + i + "' aria-selected='" + (i === view.screen) + "'>" + esc(x.title + (x.pages > 1 ? " " + x.page + "/" + x.pages : "")) + "</button>").join("") + "</div>" +
        "<div class='hmigrid'><div class='svgprev hmiprev' id='hmiSvg'>" + hmiScreenSVG(s) + "</div><aside class='devpanel' id='hmiPanel'>" + devicePanelHtml(p, dev) + "</aside></div>" +
        "<div class='row'><button class='small' id='hmiSvgDl'>" + tr("Stáhnout SVG") + "</button><span class='hint' style='margin:0'>" + tr("Klik na motor, ventil, měření nebo řádek ručního režimu = zařízení vpravo.") + "</span></div>";
      body.querySelectorAll("[data-hscr]").forEach(b => b.addEventListener("click", () => { view.screen = +b.dataset.hscr; render(); }));
      body.querySelector("#hmiSvgDl").addEventListener("click", () => downloadFile("hmi_" + s.id + ".svg", hmiScreenSVG(s)));
      const svg = body.querySelector("#hmiSvg");
      const mark = () => svg.querySelectorAll("[data-dev]").forEach(g => g.classList.toggle("sel", g.getAttribute("data-dev") === view.dev));
      mark();
      svg.addEventListener("click", e => {
        const g = e.target.closest("[data-dev]");
        if (!g) return;
        view.dev = g.getAttribute("data-dev");
        body.querySelector("#hmiPanel").innerHTML = devicePanelHtml(p, p.devices.find(d => d.name === view.dev));
        wirePanel();
        mark();
      });
      const wirePanel = () => body.querySelectorAll("#hmiPanel [data-go]").forEach(b => b.addEventListener("click", () => go(+b.dataset.go)));
      wirePanel();
    } else if (view.sub === "tags") {
      const pl = view.plat;
      body.innerHTML = "<div class='row' style='margin-top:0'><label class='f' style='flex-direction:row;align-items:center;gap:8px'>" + tr("Cesta v PLC pro platformu") +
        " <select id='hmiTagPlat'>" + plats.map(k => "<option value='" + k + "'" + (k === pl ? " selected" : "") + ">" + esc(PLAT[k].name) + "</option>").join("") + "</select></label></div>" +
        "<div class='tablewrap scrolly'><table class='hmitable'><thead><tr><th>" + tr("Tag") + "</th><th>" + tr("Typ") + "</th><th>" + tr("Přístup") + "</th><th>" + tr("Skupina") + "</th><th>" + tr("Zařízení") + "</th><th>" + tr("Popis") + "</th><th>" + tr("Cesta v PLC") + "</th></tr></thead><tbody>" +
        m.tags.map(t => "<tr><td class='mono'>" + esc(t.name) + "</td><td class='mono'>" + t.type + "</td><td class='mono'>" + t.access + (t.cmd ? " · " + (t.cmd === "momentary" ? tr("tlačítko") : tr("přepínač")) : "") + "</td><td>" + esc(tr(HMI_GROUPS[t.group] || t.group)) + "</td><td class='mono'>" + esc(t.dev || "") + "</td><td>" + esc(t.desc) + (t.unit ? " [" + esc(t.unit) + "]" : "") + "</td><td class='mono'>" + esc(hmiPlcPath(pl, t, p)) + "</td></tr>").join("") +
        "</tbody></table></div>";
      body.querySelector("#hmiTagPlat").addEventListener("change", e => { view.plat = e.target.value; render(); });
    } else if (view.sub === "alarms") {
      body.innerHTML = "<div class='tablewrap scrolly'><table class='hmitable'><thead><tr><th>#</th><th>" + tr("Alarm") + "</th><th>" + tr("Zařízení") + "</th><th>" + tr("Text") + "</th><th>" + tr("Třída") + "</th><th>" + tr("Spouští") + "</th><th>" + tr("Kvitace") + "</th></tr></thead><tbody>" +
        m.alarms.map(a => "<tr><td class='mono'>" + a.id + "</td><td class='mono'>" + esc(a.name) + (a.codes.length > 1 ? "<div class='hint' style='margin:0'>" + esc(a.codes.join(", ")) + "</div>" : "") + "</td><td class='mono'>" + esc(a.dev) + "</td><td>" + esc(a.text) + (a.cause ? "<div class='hint' style='margin:0'>" + esc(a.cause) + "</div>" : "") + "</td><td><span class='st " + (a.cls === "fault" ? "st-rej" : a.cls === "stop" ? "st-stale" : "st-wait") + "'>" + esc(alarmClassLabel(a.cls)) + "</span></td><td class='mono'>" + esc(triggerText(a.trigger)) + "</td><td>" + esc(a.ack) + "</td></tr>").join("") +
        "</tbody></table></div>";
    } else {
      const pl = view.plat;
      const spec = hmiExportSpec(pl);
      const files = hmiFiles(p, pl, m);
      const names = Object.keys(files);
      if (!names.includes(view.file)) view.file = names[0] || null;
      let h = "<div class='row' style='margin-top:0'><label class='f' style='flex-direction:row;align-items:center;gap:8px'>" + tr("Platforma exportu") +
        " <select id='hmiExpPlat'>" + plats.map(k => "<option value='" + k + "'" + (k === pl ? " selected" : "") + ">" + esc(PLAT[k].name) + (p.platforms.includes(k) ? "" : " · " + tr("mimo projekt")) + "</option>").join("") + "</select></label>" +
        (spec ? "<span class='stat'>" + tr("HMI: <b>{product}</b>", { product: esc(spec.product) }) + "</span>" : "") + "</div>";
      if (!spec || !names.length) {
        h += "<p class='warnbox'>" + tr("Pro tuto platformu PLCdesk export HMI nemá — panel navrhni v IDE výrobce podle dokumentu {file} (tagy a alarmy), nebo použij webové HMI.", { file: "<code>" + HMI_DOC_FILE + "</code>" }) + "</p>";
        body.innerHTML = h;
      } else {
        h += "<div class='tablewrap'><table class='hmitable' id='hmiExpTable'><thead><tr><th>" + tr("Soubor") + "</th><th>" + tr("Formát") + "</th><th>" + tr("Stav ověření") + "</th><th>" + tr("Zdroje formátu") + "</th><th></th></tr></thead><tbody>" +
          spec.files.filter(f => files[f.name] !== undefined).map(f => "<tr data-file='" + esc(f.name) + "'" + (f.name === view.file ? " class='sel'" : "") + "><td class='mono'><button class='linkbtn' data-show='" + esc(f.name) + "'>" + esc(f.name) + "</button></td><td>" + esc(tr(f.format)) + "</td><td><span class='st " + STATUS_CLS[f.status] + "' data-status='" + f.status + "'>" + esc(hmiStatusLabel(f.status)) + "</span></td><td>" +
            (f.sources.length ? f.sources.map((u, i) => "<a href='" + esc(u) + "' target='_blank' rel='noopener'>[" + (i + 1) + "]</a>").join(" ") : "—") + "</td><td><button class='small' data-dl='" + esc(f.name) + "'>" + tr("Stáhnout") + "</button></td></tr>").join("") +
          (pl === "siemens" ? "<tr><td class='mono'>" + SIEMENS_XLSX + "</td><td>" + tr("sešit Excel s listy Hmi Tags, DiscreteAlarms a AnalogAlarms pro import v TIA Portal") + "</td><td><span class='st st-stale' data-status='unverified'>" + esc(hmiStatusLabel("unverified")) + "</span></td><td>—</td><td><button class='small' id='hmiXlsx'>" + tr("Stáhnout") + "</button></td></tr>" : "") +
          "</tbody></table></div>" +
          "<div class='row'><button class='small primary' id='hmiDlAll'>" + tr("Stáhnout všechny soubory exportu") + "</button><span class='hint' style='margin:0'>" + tr("Stav „neověřeno importem“: formát podle dokumentace a veřejných příkladů výrobce, import v IDE zatím nikdo nevyzkoušel — první import zkontroluj (postup v README_HMI.txt).") + "</span></div>" +
          "<div class='codebox' style='margin-top:10px'><pre class='code' id='hmiFile'></pre></div>";
        body.innerHTML = h;
        const show = () => {
          body.querySelector("#hmiFile").textContent = view.file ? files[view.file] : "";
          body.querySelectorAll("#hmiExpTable tr[data-file]").forEach(r => r.classList.toggle("sel", r.dataset.file === view.file));
        };
        show();
        body.querySelectorAll("[data-show]").forEach(b => b.addEventListener("click", () => { view.file = b.dataset.show; show(); }));
        body.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", () => downloadFile("hmi_" + pl + "_" + b.dataset.dl, files[b.dataset.dl])));
        const xl = body.querySelector("#hmiXlsx");
        if (xl) xl.addEventListener("click", () => downloadBytes(SIEMENS_XLSX, hmiSiemensWorkbook(p, m), XLSX_MIME));
        body.querySelector("#hmiDlAll").addEventListener("click", async () => {
          const btn = body.querySelector("#hmiDlAll");
          await downloadFiles(names.map(n => ["hmi_" + pl + "_" + n, files[n]]), btn);
          if (pl === "siemens") { await new Promise(r => setTimeout(r, 250)); downloadBytes(SIEMENS_XLSX, hmiSiemensWorkbook(p, m), XLSX_MIME); }
        });
      }
      body.querySelector("#hmiExpPlat").addEventListener("change", e => { view.plat = e.target.value; view.file = null; render(); });
    }
  }
  return { render: render_ };
}

/** Binární soubor (Uint8Array) ke stažení. */
export function downloadBytes(name, bytes, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
