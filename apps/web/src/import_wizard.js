/* Průvodce „Import stávajícího zařízení" (web) — 4 kroky v modálním okně:
     1 Podklady   výběr souborů (programy a exporty z PLC, I/O listy, PDF, fotky, popis) + vložený text,
     2 Rozpoznáno přesné zpracování jádrem (extractFiles → inferProject),
     3 Analýza AI volitelná, s odhadem ceny; odešle se až tlačítkem (aiImport → mergeProposals),
     4 Revize     zařízení / I/O / E-stop / sekvence s jistotou a zdrojem, konflikty, chybějící,
                  odškrtnutí zařízení, převzetí jako projekt.
   Stav průvodce (krok, volby, výsledek AI) je v localStorage, obsah souborů v IndexedDB — po
   obnovení stránky se průvodce vrátí tam, kde byl. Přesná data a texty (formáty, „chybí")
   se počítají vždy znovu, takže se po změně jazyka přeloží. */
import {
  PLAT, CLS, DO_ROLES, esc, tr, N_, getLang, extractFiles, inferProject, mergeProposals, validateProject,
} from "../../../packages/core/dist/index.js";
import { aiSettings, saveAiSettings, AI_DEFAULT_MODEL, seedFromProject } from "./ai.js";
import { estimateImport, aiImport, importNorm, fileKind, modelInfo, IMPORT_MODELS, IMPORT_PRICES_DATE, IMPORT_PRICES_SRC } from "./import_ai.js";
import { normProject } from "./util.js";

const LS_KEY = "plcstudio.import";
const DB_NAME = "plcstudio-import";
const WSTEPS = [N_("Podklady"), N_("Rozpoznáno"), N_("Analýza AI"), N_("Kontrola a převzetí")];
const MAX_FILE = 50 * 1024 * 1024;
/** Binární soubory (čtou se jako base64 pro AI vrstvu, jádro je přeskočí). */
const BIN_EXT = /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?|heic|xlsx?|xlsm|docx?|pptx?|zip|7z|rar|gz|ap\d+|zap\d+|acd|gx3|gxw|smc2|project|tsproj|exe|dll)$/i;
const MIME_EXT = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/* ------------------------------------------------------------------ soubory */

function toB64(buf) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Text souboru: BOM (UTF-8 / UTF-16), jinak UTF-8, při chybě windows-1250 (české exporty z Excelu).
    null = binární obsah. */
function decodeText(buf) {
  let t;
  if (buf[0] === 0xff && buf[1] === 0xfe) t = new TextDecoder("utf-16le").decode(buf.subarray(2));
  else if (buf[0] === 0xfe && buf[1] === 0xff) t = new TextDecoder("utf-16be").decode(buf.subarray(2));
  else {
    try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch {
      try { t = new TextDecoder("windows-1250").decode(buf); } catch { t = new TextDecoder("latin1").decode(buf); }
    }
  }
  t = t.replace(/^﻿/, "");
  const head = t.slice(0, 4000);
  const ctl = (head.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
  return ctl > Math.max(4, head.length / 100) ? null : t;
}
let uid = 0;
const newId = () => Date.now().toString(36) + "-" + (++uid) + "-" + Math.random().toString(36).slice(2, 7);
async function readFile(file) {
  const ext = String(file.name).toLowerCase().split(".").pop();
  const mime = file.type || MIME_EXT[ext] || "";
  const base = { id: newId(), name: file.name, size: file.size, mime };
  const buf = new Uint8Array(await file.arrayBuffer());
  if (BIN_EXT.test(file.name) || /^(image|audio|video)\/|pdf|zip|officedocument|msword|excel/i.test(mime)) return { ...base, data: toB64(buf) };
  const text = decodeText(buf);
  return text === null ? { ...base, data: toB64(buf) } : { ...base, mime: mime || "text/plain", text };
}

/* IndexedDB: obsah souborů (localStorage má malý limit a PDF / fotky by se nevešly). */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction("files", mode);
      const out = fn(tx.objectStore("files"));
      tx.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } finally { db.close(); }
}
const idbPut = f => idbDo("readwrite", s => s.put(f));
const idbDel = id => idbDo("readwrite", s => s.delete(id));
const idbClear = () => idbDo("readwrite", s => s.clear());
const idbAll = () => idbDo("readonly", s => s.getAll());

const fmtSize = n => n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " kB" : (n / 1048576).toFixed(1) + " MB";
const NUM_LOCALE = { cs: "cs-CZ", en: "en-US", de: "de-DE", es: "es-ES", zh: "zh-CN" };
const fmtTok = n => Math.round(n).toLocaleString(NUM_LOCALE[getLang()] || "en-US");
const fmtUsd = v => "$" + (v < 0.01 ? v.toFixed(4) : v.toFixed(2));
const clone = x => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ průvodce */

export function makeImportWizard(ctx) {
  const { S, save, render } = ctx;
  const W = {
    open: false, step: 0, files: [], skip: [], ai: null, model: "", code: true, paste: "",
    busy: false, progress: "", err: "", confirm: false, loading: false, lost: false,
  };
  let ctl = null, cache = { key: "" }, propCache = { key: "" }, lastStep = -1;

  function persist() {
    const o = { open: W.open, step: W.step, files: W.files.map(f => ({ id: f.id, name: f.name, size: f.size, mime: f.mime })), skip: W.skip, ai: W.ai, model: W.model, code: W.code, paste: W.paste };
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* bez úložiště */ }
  }
  /** Obnoví průvodce po načtení stránky; soubory dočte z IndexedDB a překreslí. */
  function restore() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { /* poškozený stav */ }
    if (!o || typeof o !== "object") return;
    W.open = !!o.open; W.step = Number.isInteger(o.step) && o.step >= 0 && o.step < WSTEPS.length ? o.step : 0;
    W.skip = Array.isArray(o.skip) ? o.skip.map(String) : [];
    W.ai = o.ai && typeof o.ai === "object" && o.ai.raw ? o.ai : null;
    W.model = typeof o.model === "string" ? o.model : "";
    W.code = o.code !== false; W.paste = String(o.paste || "");
    const meta = Array.isArray(o.files) ? o.files.filter(f => f && f.id) : [];
    if (!meta.length) { if (W.step > 0) W.step = 0; return; }
    W.loading = true;
    idbAll().then(all => {
      const byId = new Map((all || []).map(f => [f.id, f]));
      W.files = meta.map(m => byId.get(m.id)).filter(Boolean);
      W.lost = W.files.length < meta.length;
    }).catch(() => { W.files = []; W.lost = true; }).finally(() => {
      W.loading = false;
      if (!W.files.length && W.step > 0) W.step = 0;
      persist();
      if (W.open) render();
    });
  }

  function openWizard() { W.open = true; W.err = ""; W.confirm = false; persist(); render(); }
  function close() {
    if (W.busy && ctl) ctl.abort();
    W.open = false; W.confirm = false; persist();
    document.getElementById("impModal")?.remove();
    document.body.classList.remove("modal-open");
  }
  function goto(i) { W.step = i; W.err = ""; W.confirm = false; persist(); render(); }
  /** Změna podkladů: výsledek AI a odškrtnutí platí jen pro původní sadu. */
  function filesChanged() { W.ai = null; W.skip = []; W.err = ""; cache = { key: "" }; persist(); }

  async function addFiles(list) {
    const errs = [];
    for (const file of list) {
      if (file.size > MAX_FILE) { errs.push(tr("{name}: soubor má {mb} MB, limit průvodce je 50 MB.", { name: file.name, mb: (file.size / 1048576).toFixed(1) })); continue; }
      let f;
      try { f = await readFile(file); } catch { errs.push(tr("{name}: soubor nejde přečíst.", { name: file.name })); continue; }
      const old = W.files.findIndex(x => x.name === f.name);   // stejný název = nová verze souboru
      if (old >= 0) { idbDel(W.files[old].id).catch(() => {}); W.files.splice(old, 1, f); } else W.files.push(f);
      idbPut(f).catch(() => {});
    }
    filesChanged();
    W.err = errs.join(" ");
    render();
  }
  function addPaste() {
    const t = W.paste.trim();
    if (!t) return;
    let n = 1;
    while (W.files.some(f => f.name === "vlozeny_text_" + n + ".txt")) n++;
    const f = { id: newId(), name: "vlozeny_text_" + n + ".txt", size: new Blob([t]).size, mime: "text/plain", text: t, pasted: true };
    W.files.push(f); idbPut(f).catch(() => {});
    W.paste = ""; filesChanged(); render();
  }
  function removeFile(id) {
    W.files = W.files.filter(f => f.id !== id);
    idbDel(id).catch(() => {});
    filesChanged(); render();
  }
  function clearAll() {
    W.files = []; idbClear().catch(() => {});
    W.step = 0; filesChanged(); render();
  }

  /* ---- výpočty (cache podle sady souborů a jazyka — texty jádra jsou přeložené) */
  const inputOf = f => f.text !== undefined ? { name: f.name, text: f.text, mime: f.mime, size: f.size } : { name: f.name, mime: f.mime, size: f.size, data: f.data };
  function exact() {
    const key = getLang() + "|" + W.files.map(f => f.id).join(",");
    if (cache.key !== key) {
      const ex = extractFiles(W.files.map(inputOf));
      cache = { key, ex, exact: inferProject(ex) };
    }
    return cache;
  }
  function proposal() {
    const { ex, exact: ex0, key } = exact();
    const k2 = key + "|" + (W.ai ? W.ai.at : "");
    if (propCache.key !== k2) {
      let prop = ex0, aiP = null;
      if (W.ai) {
        try { aiP = importNorm(W.ai.raw, ex, W.files); prop = mergeProposals(ex0, aiP); } catch { aiP = null; prop = ex0; }
      }
      propCache = { key: k2, prop, aiP };
    }
    return propCache;
  }

  /* ---- vykreslení */
  function renderModal() {
    if (!W.open) { document.getElementById("impModal")?.remove(); document.body.classList.remove("modal-open"); return; }
    let m = document.getElementById("impModal");
    const prevScroll = m && lastStep === W.step ? m.querySelector(".mbody")?.scrollTop || 0 : 0;
    if (!m) {
      m = document.createElement("div");
      m.id = "impModal"; m.className = "modal";
      document.body.appendChild(m);
    }
    document.body.classList.add("modal-open");
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="impTitle" tabindex="-1">
      <div class="mhead">
        <h2 id="impTitle">${tr("Import stávajícího zařízení")}</h2>
        <button class="small" id="impClose" title="${esc(tr("Zavřít — podklady zůstanou uložené v prohlížeči"))}" aria-label="${esc(tr("Zavřít"))}">×</button>
      </div>
      <nav class="wsteps">${WSTEPS.map((s, i) => `<button data-ws="${i}" class="${i === W.step ? "on" : i < W.step ? "done" : ""}" ${canGo(i) ? "" : "disabled"}>${i + 1} · ${tr(s)}</button>`).join("")}</nav>
      <div class="mbody" id="impBody"></div>
      <div class="mfoot" id="impFoot"></div>
    </div>`;
    m.querySelector("#impClose").addEventListener("click", close);
    m.querySelectorAll("[data-ws]").forEach(b => b.addEventListener("click", () => goto(+b.dataset.ws)));
    m.onkeydown = e => { if (e.key === "Escape" && !W.busy) close(); };
    const body = m.querySelector("#impBody"), foot = m.querySelector("#impFoot");
    if (W.loading) body.innerHTML = "<p class='hint'>" + tr("Načítám uložené podklady…") + "</p>";
    else [rFiles, rRecognized, rAi, rReview][W.step](body, foot);
    body.scrollTop = prevScroll;
    if (lastStep !== W.step || !m.contains(document.activeElement)) m.querySelector(".dialog").focus({ preventScroll: true });
    lastStep = W.step;
  }
  const canGo = i => i === 0 || (W.files.length > 0 && !W.loading && !W.busy);
  const errBox = () => W.err ? "<div class='errtxt' id='impErr'>" + esc(W.err) + "</div>" : "";
  const footBtns = (foot, back, next) => {
    foot.innerHTML = (back ? "<button id='impBack'>← " + tr("Zpět") + "</button>" : "<span></span>") + "<div class='row' style='margin:0'>" + next + "</div>";
    if (back) foot.querySelector("#impBack").addEventListener("click", () => goto(W.step - 1));
  };

  /* 1 Podklady */
  function rFiles(body, foot) {
    const kindTxt = f => {
      const k = fileKind({ name: f.name, mime: f.mime, text: f.text });
      return f.pasted ? tr("vložený text") : k === "pdf" ? "PDF" : k === "image" ? tr("obrázek") : k === "text" ? tr("text / export") : tr("binární (převeď do PDF nebo CSV)");
    };
    body.innerHTML = `
      <p class="hint" style="margin-top:0;max-width:80ch">${tr("Přidej všechno, co o stroji máš: exporty a programy z PLC (TIA Portal, Studio 5000 L5X, CODESYS / PLCopen XML, GX Works, Sysmac, výstupy PLCdesk), I/O listy (CSV), elektroschémata v PDF, fotky štítků a rozvaděče, popis funkce. Exporty a programy zpracuje přesně jádro; PDF, obrázky a neznámé texty může volitelně doplnit AI.")}</p>
      ${W.lost ? "<p class='warnbox'>" + tr("Některé dříve přidané soubory se nepodařilo obnovit — přidej je znovu.") + "</p>" : ""}
      <div class="drop" id="impDrop">
        <input type="file" id="impFiles" multiple aria-label="${esc(tr("Vybrat soubory"))}">
        <span class="hint" style="margin:0">${tr("…nebo soubory přetáhni sem.")}</span>
      </div>
      ${errBox()}
      ${W.files.length ? `<div class="tablewrap"><table><thead><tr><th>${tr("Soubor")}</th><th>${tr("Druh")}</th><th>${tr("Velikost")}</th><th></th></tr></thead><tbody>
        ${W.files.map(f => `<tr><td class="mono" style="white-space:normal;word-break:break-all">${esc(f.name)}</td><td style="font-size:.8rem">${esc(kindTxt(f))}</td><td class="mono">${fmtSize(f.size || 0)}</td><td><button class="small danger" data-rm="${esc(f.id)}" aria-label="${esc(tr("Odebrat {name}", { name: f.name }))}">×</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="row"><span class="stat">${tr("souborů <b>{n}</b>", { n: W.files.length })}</span><button class="small danger" id="impClear">${tr("Odebrat vše")}</button></div>`
      : "<p class='hint'>" + tr("Zatím žádné podklady.") + "</p>"}
      <h3>${tr("Vložit text")}</h3>
      <textarea id="impPaste" spellcheck="false" style="min-height:110px" placeholder="${esc(tr("Sem vlož obsah exportu (XML / ST / CSV), I/O list z Excelu nebo popis funkce stroje…"))}" aria-label="${esc(tr("Vložit text"))}">${esc(W.paste)}</textarea>
      <div class="row" style="margin-top:8px"><button class="small" id="impPasteAdd">${tr("Přidat text jako podklad")}</button></div>
      <p class="note">${tr("Nic se nepřepíše, dokud v posledním kroku nepotvrdíš převzetí. Bezpečnostní funkce se neodvozují — E-stop a kryty se převezmou jen jako signály.")}</p>`;
    const inp = body.querySelector("#impFiles");
    inp.addEventListener("change", () => { const l = [...inp.files]; inp.value = ""; if (l.length) addFiles(l); });
    const drop = body.querySelector("#impDrop");
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const l = [...(e.dataTransfer?.files || [])]; if (l.length) addFiles(l); });
    body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => removeFile(b.dataset.rm)));
    body.querySelector("#impClear")?.addEventListener("click", clearAll);
    const ta = body.querySelector("#impPaste");
    ta.addEventListener("input", () => { W.paste = ta.value; persist(); });
    body.querySelector("#impPasteAdd").addEventListener("click", addPaste);
    footBtns(foot, false, `<button class="primary" id="impNext" ${W.files.length ? "" : "disabled"}>${tr("Zpracovat podklady")} →</button>`);
    foot.querySelector("#impNext").addEventListener("click", () => goto(1));
  }

  /* 2 Rozpoznáno */
  function rRecognized(body, foot) {
    const { ex, exact: p0 } = exact();
    const p = p0.prj;
    const rows = ex.files.map(r => `<tr><td class="mono" style="white-space:normal;word-break:break-all">${esc(r.name)}</td><td style="font-size:.8rem">${esc(r.fmt)}</td>
      <td>${r.ok ? "<span class='conf sure'>" + tr("přesně") + "</span>" : "<span class='conf guess'>" + tr("→ AI") + "</span>"}</td>
      <td class="mono">${r.signals}</td><td class="mono">${r.pous}</td><td style="font-size:.78rem;color:var(--muted)">${esc(r.note || "")}</td></tr>`).join("");
    const unp = ex.unparsed.map(f => f.name);
    body.innerHTML = `
      <div class="tablewrap"><table><thead><tr><th>${tr("Soubor")}</th><th>${tr("Formát")}</th><th>${tr("Zpracování")}</th><th>${tr("Signálů")}</th><th>${tr("Programů")}</th><th>${tr("Poznámka")}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="stats">
        <span class="stat">${tr("platforma <b>{p}</b>", { p: esc(ex.platform && PLAT[ex.platform] ? PLAT[ex.platform].name : tr("nepoznána")) })}</span>
        <span class="stat">${tr("signálů <b>{n}</b>", { n: ex.signals.length })}</span>
        <span class="stat">${tr("zařízení <b>{n}</b>", { n: p.devices.length })}</span>
        <span class="stat">I/O <b>${p.io.length}</b></span>
        <span class="stat">${tr("kroků sekvence <b>{n}</b>", { n: p.program.seq.length })}</span>
        <span class="stat">E-stop <b>${p.program.estop !== "" ? "✓" : "—"}</b></span>
      </div>
      ${ex.meta && ex.meta.name ? "<p class='hint'>" + tr("Název stroje z podkladů: {name}", { name: "<b>" + esc(ex.meta.name) + "</b>" }) + "</p>" : ""}
      ${unp.length ? "<p class='warnbox'>" + tr("Přesný parser nerozpoznal: {list}. Tyto podklady může přečíst AI v dalším kroku (volitelné, placené).", { list: unp.map(n => "<code>" + esc(n) + "</code>").join(", ") }) + "</p>"
        : "<p class='oktxt'>" + tr("Všechny podklady zpracovalo jádro přesně.") + "</p>"}
      ${!p.devices.length ? "<p class='errtxt'>" + tr("Z přesného zpracování nevzniklo žádné zařízení — sestavu může navrhnout AI z PDF, obrázků a textů.") + "</p>" : ""}`;
    footBtns(foot, true, `<button id="impSkipAi">${tr("Přeskočit AI → Revize")}</button><button class="primary" id="impToAi">${tr("Analýza AI")} →</button>`);
    foot.querySelector("#impSkipAi").addEventListener("click", () => goto(3));
    foot.querySelector("#impToAi").addEventListener("click", () => goto(2));
  }

  /* 3 Analýza AI */
  function rAi(body, foot) {
    const { ex, exact: p0 } = exact();
    const cfg = aiSettings();
    if (!W.model) W.model = cfg.model || AI_DEFAULT_MODEL;
    const est = estimateImport(W.files, W.model, { ex, prj: p0.prj, code: W.code });
    const nothing = est.parts.every(pt => !pt.files.length);
    const models = [...new Set([...Object.keys(IMPORT_MODELS), W.model])];
    const done = W.ai ? (() => {
      const u = W.ai.usage || {}, m2 = modelInfo(W.ai.model);
      const usd = ((u.input_tokens || 0) * m2.in + (u.output_tokens || 0) * m2.out) / 1e6;
      return "<p class='oktxt' id='impAiDone'>" + tr("Analýza AI hotová ({model}, dotazů {n}): skutečně {in} vstupních a {out} výstupních tokenů ≈ {usd}.", { model: esc(W.ai.model), n: W.ai.parts || 1, in: fmtTok(u.input_tokens || 0), out: fmtTok(u.output_tokens || 0), usd: fmtUsd(usd) }) + "</p>";
    })() : "";
    body.innerHTML = `
      <p class="hint" style="margin-top:0;max-width:80ch">${tr("AI přečte podklady, kterým přesný parser nerozumí (PDF schémata, fotky, popis funkce), a doplní zařízení, signály, meze a sekvenci. U každé položky musí uvést zdroj; přesná data z exportů mají vždy přednost a rozpory se ukážou v revizi.")}</p>
      ${nothing ? "<p class='oktxt'>" + tr("Není co analyzovat — všechny podklady zpracovalo jádro přesně a nejsou v nich programy. Pokračuj na revizi.") + "</p>" : ""}
      ${cfg.key ? "" : `<div class="warnbox">${tr("Bez API klíče analýzu AI spustit nejde — návrh z přesného zpracování v revizi funguje i tak. Klíč můžeš zadat tady (uloží se jen v tomto prohlížeči, stejně jako v kroku AI návrh):")}
        <div class="row" style="margin-top:8px"><input type="password" id="impKey" placeholder="sk-ant-…" style="min-width:260px" aria-label="${esc(tr("API klíč"))}"><button class="small" id="impKeySave">${tr("Uložit klíč")}</button></div></div>`}
      <div class="grid g2" style="margin-top:12px">
        <label class="f">${tr("Model")}
          <select id="impModel">${models.map(m => `<option value="${esc(m)}" ${m === W.model ? "selected" : ""}>${esc(m)}${IMPORT_MODELS[m] ? " — $" + IMPORT_MODELS[m].in + " / $" + IMPORT_MODELS[m].out : ""}</option>`).join("")}</select>
        </label>
        ${ex.pous.length ? `<label class="chk" style="align-self:end"><input type="checkbox" id="impCode" ${W.code ? "checked" : ""}> ${tr("Poslat i těla programů ({n}) — AI doplní popisy a sekvenci", { n: ex.pous.length })}</label>` : "<span></span>"}
      </div>
      <p class="hint">${tr("Ceny v USD za 1M tokenů (vstup / výstup), ceník k {date}:", { date: esc(IMPORT_PRICES_DATE) })} <a href="${esc(IMPORT_PRICES_SRC)}" target="_blank" rel="noopener">${esc(IMPORT_PRICES_SRC.replace(/^https?:\/\//, ""))}</a></p>
      ${nothing ? "" : `
      <h3>${tr("Odhad před odesláním")}</h3>
      <div class="stats" id="impEst">
        <span class="stat">${tr("dotazů <b>{n}</b>", { n: est.parts.length })}</span>
        <span class="stat">${tr("vstup ≈ <b>{n}</b> tokenů", { n: fmtTok(est.inputTokens) })}</span>
        <span class="stat">${tr("výstup ≈ <b>{n}</b> tokenů", { n: fmtTok(est.outputTokens) })}</span>
        <span class="stat price">${tr("cena ≈ <b>{usd}</b>", { usd: fmtUsd(est.usd) })}</span>
      </div>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>${tr("Soubory")}</th><th>${tr("Vstup")}</th><th>${tr("Výstup")}</th></tr></thead><tbody>
        ${est.parts.map((pt, i) => `<tr><td class="mono">${i + 1}</td><td style="font-size:.8rem;word-break:break-all">${pt.files.map(esc).join(", ")}</td><td class="mono">${fmtTok(pt.inputTokens)}</td><td class="mono">${fmtTok(pt.outputTokens)}</td></tr>`).join("")}
      </tbody></table></div>
      ${est.warnings.length ? "<div class='warnbox'><ul style='margin:0;padding-left:18px'>" + est.warnings.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul></div>" : ""}
      ${est.skipped.length ? "<p class='hint'>" + tr("Přeskočeno: {list}", { list: est.skipped.map(s => "<code>" + esc(s.name) + "</code>").join(", ") }) + "</p>" : ""}
      <p class="warnbox">${tr("<b>Pozor:</b> soubory uvedené v tabulce se odešlou do Anthropic API (Claude) pod tvým klíčem a dotaz se účtuje. Neposílej podklady, které nesmí opustit firmu. Odhad je orientační — skutečnou cenu ukáže odpověď.")}</p>`}
      ${done}
      ${W.busy ? "<p class='hint' id='impProgress'>" + esc(W.progress) + "</p>" : ""}
      ${errBox()}`;
    body.querySelector("#impModel").addEventListener("change", e => { W.model = e.target.value; persist(); render(); });
    body.querySelector("#impCode")?.addEventListener("change", e => { W.code = e.target.checked; persist(); render(); });
    body.querySelector("#impKeySave")?.addEventListener("click", () => {
      const k = body.querySelector("#impKey").value.trim();
      if (!k) return;
      saveAiSettings({ ...aiSettings(), key: k }); render();
    });
    const runBtn = nothing ? "" : W.busy
      ? `<button class="small" id="impStop">${tr("Stop")}</button>`
      : `<button class="${W.ai ? "" : "primary"}" id="impRun" ${cfg.key ? "" : "disabled"}>${W.ai ? tr("Spustit znovu (placené)") : tr("Spustit analýzu (placené)")}</button>`;
    footBtns(foot, !W.busy, (W.ai && !W.busy ? `<button class="small danger" id="impAiDrop">${tr("Zahodit výsledek AI")}</button>` : "") + runBtn +
      `<button class="${W.ai || nothing ? "primary" : ""}" id="impToRev" ${W.busy ? "disabled" : ""}>${W.ai ? tr("Ke kontrole") : tr("Bez AI → ke kontrole")} →</button>`);
    foot.querySelector("#impToRev").addEventListener("click", () => goto(3));
    foot.querySelector("#impStop")?.addEventListener("click", () => { if (ctl) ctl.abort(); });
    foot.querySelector("#impAiDrop")?.addEventListener("click", () => { W.ai = null; W.skip = []; persist(); render(); });
    foot.querySelector("#impRun")?.addEventListener("click", runAi);
  }

  async function runAi() {
    if (W.busy) return;
    const { ex, exact: p0 } = exact();
    if (!aiSettings().key) { W.err = tr("Chybí API klíč — doplň ho výše."); render(); return; }
    W.busy = true; W.err = ""; W.progress = tr("Odesílám…"); render();
    ctl = new AbortController();
    try {
      const res = await aiImport(ex, W.files, {
        signal: ctl.signal, prj: p0.prj, model: W.model, code: W.code,
        onPart: (i, n) => { W.progress = n > 1 ? tr("Dotaz {i} z {n} — čekám na odpověď…", { i: i + 1, n }) : tr("Čekám na odpověď AI…"); const el = document.getElementById("impProgress"); if (el) el.textContent = W.progress; },
      });
      W.ai = { raw: res.raw, usage: res.usage, model: W.model, parts: res.parts, at: Date.now() };
      W.skip = [];
      /* chyba / Stop v pozdějším dotazu: nabídnout výsledek dosavadních dotazů */
      if (res.error) {
        W.ai.partial = true;
        W.err = aiErrText(res.error) + " " + tr("Použit výsledek prvních {done} z {n} dotazů — zkontroluj ho v revizi.", { done: res.partsDone, n: res.parts });
      }
    } catch (e) {
      W.err = aiErrText(e);
    } finally {
      W.busy = false; ctl = null; W.progress = ""; persist();
      if (W.open) render();
    }
  }
  function aiErrText(e) {
    if (!e) return tr("Analýza se nezdařila — zkus to znovu.");
    if (e.name === "AbortError") return tr("Analýza zastavena — nic se nezměnilo.");
    const d = e.detail ? String(e.detail) : "";
    switch (e.code) {
      case "no_key": return tr("Chybí API klíč — doplň ho výše.");
      case "bad_key": return tr("API klíč byl odmítnut (401) — zkontroluj ho.");
      case "rate_limited": return tr("Příliš mnoho dotazů (429) — zkus to za chvíli.");
      case "too_large": return tr("Dotaz je pro API příliš velký (413) — odeber nebo rozděl největší soubory.");
      case "truncated": return tr("Odpověď AI se nevešla do limitu — rozděl podklady na menší celky (méně souborů najednou).");
      case "refusal": return tr("Model odmítl podklady zpracovat — zkontroluj, co posíláš, případně zkus jiný model.");
      case "invalid_json": return tr("Odpověď AI se nepodařilo přečíst — zkus to znovu.");
      case "bad_request": return tr("API dotaz odmítlo (400): {detail}", { detail: d || e.message });
      default:
        if (/^API 400$/.test(e.message)) return tr("API dotaz odmítlo (400): {detail}", { detail: d || e.message });
        if (/^API \d+$/.test(e.message)) return d ? tr("Chyba API ({code}): {detail}", { code: e.message.slice(4), detail: d }) : tr("Chyba API ({code}) — zkus to znovu.", { code: e.message.slice(4) });
        if (e instanceof TypeError) return tr("Spojení s Anthropic API selhalo — zkontroluj připojení k internetu.");
        return tr("Analýza se nezdařila: {detail}", { detail: d || e.message || String(e) });
    }
  }

  /* 4 Revize */
  const CONF_TXT = { sure: N_("jistě"), guess: N_("odhad"), missing: N_("chybí") };
  const confChip = ev => ev ? "<span class='conf " + ev.conf + "'" + (ev.note ? " title='" + esc(ev.note) + "'" : "") + ">" + tr(CONF_TXT[ev.conf] || CONF_TXT.missing) + "</span>" : "<span class='hint' style='margin:0'>—</span>";
  const refTxt = s => s.file + (s.page ? " · " + tr("str. {n}", { n: s.page }) : "") + (s.line ? " · " + tr("ř. {n}", { n: s.line }) : "");
  let srcList = [];
  const srcCell = refs => (refs || []).slice(0, 3).map(s => { srcList.push(s); return "<button class='srcref' data-src='" + (srcList.length - 1) + "' title='" + esc(s.quote ? "„" + s.quote + "“" : refTxt(s)) + "'>" + esc(refTxt(s)) + "</button>"; }).join(" ");
  function devOpts(d) {
    const out = Object.entries(d.opt || {}).filter(([, v]) => v).map(([k]) => CLS[d.cls].opts[k] ? tr(CLS[d.cls].opts[k]) : k);
    if (d.cls === "AnalogIn" || d.cls === "AnalogOut") out.push((d.unit ? d.unit + " " : "") + d.rmin + "–" + d.rmax);
    const u = v => v + (d.unit ? " " + d.unit : "");
    if (Number.isFinite(d.limLo)) out.push(tr("min {v}", { v: u(d.limLo) }));
    if (Number.isFinite(d.limHi)) out.push(tr("max {v}", { v: u(d.limHi) }));
    if (Number.isFinite(d.setpoint)) out.push(tr("žádaná {v}", { v: u(d.setpoint) }));
    if (d.role && DO_ROLES[d.role]) out.push(tr(DO_ROLES[d.role]));
    return out.join(", ");
  }
  function rReview(body, foot) {
    const { ex } = exact();
    const { prop, aiP } = proposal();
    const p = prop.prj, evd = prop.evidence;
    const skip = new Set(W.skip);
    const nameOf = id => (p.devices.find(d => d.id === id) || { name: "?" }).name;
    srcList = [];
    const devRows = p.devices.map(d => {
      const e = evd["dev:" + d.name];
      return `<tr class="${skip.has(d.name) ? "off" : ""}"><td><input type="checkbox" data-take="${esc(d.name)}" ${skip.has(d.name) ? "" : "checked"} aria-label="${esc(tr("Převzít {name}", { name: d.name }))}"></td>
        <td class="mono"><b>${esc(d.name)}</b></td><td>${tr(CLS[d.cls].label)}</td><td style="font-size:.8rem">${esc(d.desc)}</td>
        <td style="font-size:.76rem;color:var(--muted)">${esc(devOpts(d))}</td><td>${confChip(e)}</td><td>${srcCell(e && e.src)}</td></tr>`;
    }).join("");
    const ioRows = p.io.map(io => {
      const d = p.devices.find(x => x.id === io.devId), e = evd["io:" + io.tag];
      return `<tr class="${d && skip.has(d.name) ? "off" : ""}"><td class="mono">${esc(io.tag)}</td><td class="mono">${esc(io.addr)}</td><td class="mono dir${io.dir}">${io.dir}</td><td class="mono">${esc(d ? d.name : "?")}</td>
        <td style="font-size:.76rem;color:var(--muted)">${esc(io.cmt)}</td><td>${confChip(e)}</td><td>${srcCell(e && e.src)}</td></tr>`;
    }).join("");
    const acts = { start: tr("start"), stop: tr("stop"), open: tr("otevřít"), close: tr("zavřít") };
    const seqRows = p.program.seq.map((s, i) => {
      const e = evd["seq:" + i], dn = s.dev ? nameOf(s.dev) : "";
      const act = s.act === "wait" ? tr("výdrž {t} s", { t: s.timeS }) : s.act === "waitOn" ? tr("čekat na {dev}", { dev: dn }) : s.act === "waitOff" ? tr("čekat na {dev} = FALSE", { dev: dn }) : dn + " " + (acts[s.act] || s.act);
      const cond = s.act === "wait" ? "—" : s.cond === "time" ? tr("čas {t} s", { t: s.timeS }) : tr("zpětné hlášení (hlídací čas {t} s)", { t: s.timeS });
      return `<tr class="${dn && skip.has(dn) ? "off" : ""}"><td class="mono">${i + 1}</td><td>${esc(act)}</td><td style="font-size:.8rem">${esc(cond)}</td><td>${confChip(e)}</td><td>${srcCell(e && e.src)}</td></tr>`;
    }).join("");
    const estop = p.program.estop !== "" ? nameOf(p.program.estop) : "";
    const locks = (p.program.interlocks || []).map(nameOf);
    const missing = [...new Set([...(prop.missing || []), ...((aiP && aiP.missing) || [])])];
    const conflicts = prop.conflicts || [];
    const taken = p.devices.filter(d => !skip.has(d.name)).length;
    const scrollBox = (rows, cols, n) => n ? `<div class="tablewrap${n > 14 ? " scrolly" : ""}"><table><thead><tr>${cols.map(c => "<th>" + c + "</th>").join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : "<p class='hint'>" + tr("nic") + "</p>";
    body.innerHTML = `
      <div class="stats">
        <span class="stat">${tr("zařízení <b>{n}</b> (převzít {m})", { n: p.devices.length, m: taken })}</span>
        <span class="stat">I/O <b>${p.io.length}</b></span>
        <span class="stat">${tr("kroků sekvence <b>{n}</b>", { n: p.program.seq.length })}</span>
        <span class="stat">${tr("konfliktů <b>{n}</b>", { n: conflicts.length })}</span>
        <span class="stat">${tr("chybí <b>{n}</b>", { n: missing.length })}</span>
        <span class="stat">${W.ai ? tr("zdroj: přesné zpracování + AI") : tr("zdroj: přesné zpracování")}</span>
      </div>
      <p class="hint">${tr("Jistota:")} <span class="conf sure">${tr("jistě")}</span> ${tr("výslovně v podkladu")} · <span class="conf guess">${tr("odhad")}</span> ${tr("odvozeno (z názvu, kontextu)")} · <span class="conf missing">${tr("chybí")}</span> ${tr("podklad to nedokládá — doplň")}. ${tr("Klik na zdroj ukáže citaci.")}</p>
      <div class="quote" id="impQuote" hidden></div>
      <h3>${tr("Zařízení")}</h3>
      ${p.devices.length ? `<div class="row" style="margin-top:0"><button class="small" id="impAll">${tr("Vybrat vše")}</button><button class="small" id="impNone">${tr("Zrušit výběr")}</button><span class="hint" style="margin:0">${tr("Odškrtnutá zařízení se nepřevezmou (ani jejich I/O a kroky sekvence).")}</span></div>` : ""}
      ${scrollBox(devRows, ["", tr("Označení"), tr("Třída"), tr("Popis"), tr("Volby"), tr("Jistota"), tr("Zdroj")], p.devices.length)}
      <h3>${tr("I/O")}</h3>
      ${scrollBox(ioRows, [tr("Tag"), tr("Adresa"), tr("Směr"), tr("Zařízení"), tr("Komentář"), tr("Jistota"), tr("Zdroj")], p.io.length)}
      <h3>${tr("E-stop a blokování")}</h3>
      <ul class="plain">
        <li>E-stop: ${estop ? "<b class='mono'>" + esc(estop) + "</b> " + confChip(evd.estop) + " " + srcCell(evd.estop && evd.estop.src) : "<span class='conf missing'>" + tr("chybí") + "</span>"}</li>
        <li>${tr("Blokování:")} ${locks.length ? locks.map(n => "<b class='mono'>" + esc(n) + "</b> " + confChip(evd["lock:" + n]) + " " + srcCell(evd["lock:" + n] && evd["lock:" + n].src)).join(" · ") : "—"}</li>
        ${p.meta.takt ? "<li>" + tr("Takt: {t} s", { t: p.meta.takt }) + " " + confChip(evd.meta) + "</li>" : ""}
      </ul>
      <p class="hint">${tr("E-stop a blokování jsou v programu jen signály — bezpečnostní funkce řeší safety technika podle posouzení rizik. Návrh k revizi.")}</p>
      <h3>${tr("Sekvence")}</h3>
      ${scrollBox(seqRows, ["#", tr("Akce"), tr("Přechod"), tr("Jistota"), tr("Zdroj")], p.program.seq.length)}
      <h3>${tr("Konflikty")} (${conflicts.length})</h3>
      ${conflicts.length ? "<ul class='plain issues" + (conflicts.length > 12 ? " scrolly" : "") + "'>" + conflicts.map(c => "<li><code>" + esc(c.what) + "</code> — " + esc(c.note) + " " + srcCell(c.src) + "</li>").join("") + "</ul>" : "<p class='hint'>" + tr("Žádné rozpory mezi podklady.") + "</p>"}
      <h3>${tr("Chybí v podkladech")} (${missing.length})</h3>
      ${missing.length ? "<ul class='plain issues warnlist'>" + missing.map(t => "<li>" + esc(t) + "</li>").join("") + "</ul>" : "<p class='hint'>" + tr("nic") + "</p>"}
      ${aiP && (aiP.questions.length || aiP.note) ? `<h3>${tr("Otázky a poznámka AI")}</h3>
        ${aiP.questions.length ? "<ul class='plain'>" + aiP.questions.map(q => "<li>" + esc(q) + "</li>").join("") + "</ul>" : ""}
        ${aiP.note ? "<p class='note'>" + esc(aiP.note) + "</p>" : ""}` : ""}
      ${W.confirm ? `<div class="warnbox confirm" id="impConfirm"><b>${tr("Převzetí nahradí aktuální návrh")}</b> (${esc(S.prj.meta.name || tr("bez názvu"))}, ${tr("zařízení: {n}", { n: S.prj.devices.length })}) ${tr("včetně konverzace v kroku AI návrh. Pokračovat?")}
        <div class="row" style="margin-top:8px"><button class="primary" id="impYes">${tr("Ano, nahradit návrh")}</button><button id="impNo">${tr("Zrušit")}</button></div></div>` : ""}
      ${errBox()}`;
    body.querySelectorAll("[data-take]").forEach(cb => cb.addEventListener("change", () => {
      const set = new Set(W.skip);
      if (cb.checked) set.delete(cb.dataset.take); else set.add(cb.dataset.take);
      W.skip = [...set]; persist(); render();
    }));
    body.querySelector("#impAll")?.addEventListener("click", () => { W.skip = []; persist(); render(); });
    body.querySelector("#impNone")?.addEventListener("click", () => { W.skip = p.devices.map(d => d.name); persist(); render(); });
    const qb = body.querySelector("#impQuote");
    body.querySelectorAll("[data-src]").forEach(b => b.addEventListener("click", () => {
      const s = srcList[+b.dataset.src];
      qb.hidden = false;
      qb.innerHTML = "<b>" + esc(refTxt(s)) + "</b>" + (s.quote ? "<div class='mono'>„" + esc(s.quote) + "“</div>" : "<div class='hint' style='margin:0'>" + tr("bez citace") + "</div>");
      qb.scrollIntoView({ block: "nearest" });
    }));
    body.querySelector("#impYes")?.addEventListener("click", () => take(prop, ex));
    body.querySelector("#impNo")?.addEventListener("click", () => { W.confirm = false; render(); });
    footBtns(foot, true, `<button class="primary" id="impTake" ${taken ? "" : "disabled"}>${tr("Převzít jako projekt")}</button>`);
    foot.querySelector("#impTake").addEventListener("click", () => {
      W.confirm = true; render();
      setTimeout(() => document.getElementById("impConfirm")?.scrollIntoView({ block: "nearest" }), 0);
    });
  }

  function take(prop, ex) {
    const P = clone(prop.prj);
    const skip = new Set(W.skip);
    const gone = new Set(P.devices.filter(d => skip.has(d.name)).map(d => d.id));
    P.devices = P.devices.filter(d => !gone.has(d.id));
    P.io = P.io.filter(e => !gone.has(e.devId));
    P.program.seq = P.program.seq.filter(s => s.act === "wait" || (s.dev && !gone.has(s.dev)));
    if (gone.has(P.program.estop)) P.program.estop = "";
    P.program.interlocks = (P.program.interlocks || []).filter(id => !gone.has(id));
    if (!P.meta.name && ex.meta && ex.meta.name) P.meta.name = ex.meta.name;
    if ((!P.platforms || !P.platforms.length) && ex.platform) P.platforms = [ex.platform];
    let prjNew;
    try { prjNew = normProject(P); } catch { W.err = tr("Návrh se nepodařilo převzít."); render(); return; }
    const names = W.files.map(f => f.name);
    S.prj = prjNew;
    S.ai = seedFromProject(prjNew,
      tr("Stávající zařízení načtené z podkladů: {files}.", { files: names.join(", ") }),
      W.ai ? tr("Návrh převzatý z importu stávajícího zařízení (souborů: {n}, s analýzou AI) — zkontroluj nejisté položky a pokračuj úpravami: napiš, co změnit.", { n: names.length })
        : tr("Návrh převzatý z importu stávajícího zařízení (souborů: {n}) — zkontroluj nejisté položky a pokračuj úpravami: napiš, co změnit.", { n: names.length }));
    const issues = validateProject(prjNew);
    const nErr = issues.filter(i => i.level === "error").length, nWarn = issues.length - nErr;
    S.notice = {
      step: 3, level: nErr ? "err" : nWarn ? "warn" : "ok",
      text: tr("Import převzat: zařízení {n}, I/O {io}, kroků sekvence {seq}. Kontrola návrhu: chyb {err}, varování {warn} — podrobnosti v kroku I/O.", { n: prjNew.devices.length, io: prjNew.io.length, seq: prjNew.program.seq.length, err: nErr, warn: nWarn }),
    };
    S.step = 3;
    // průvodce hotový: podklady z prohlížeče smazat
    W.open = false; W.step = 0; W.files = []; W.skip = []; W.ai = null; W.paste = ""; W.confirm = false; W.err = "";
    cache = { key: "" }; propCache = { key: "" };
    idbClear().catch(() => {});
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    save(); render();
  }

  restore();
  return { open: openWizard, render: renderModal, get state() { return W; } };
}
