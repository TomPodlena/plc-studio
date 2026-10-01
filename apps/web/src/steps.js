/* Renderery kroků workflow. ctx = { S, save, render } — stav vlastní app.js. */
import {
  PLAT, CLS, esc, blankProject, devById, nextName, syncIO, autoAddr, modules,
  validateProject, sanitizeTag, genFor, allProjectFiles,
  detectAndParse, buildDevicesFromTags,
  svgBlock, sheetSVG, sheetDXF, svorkyCSV,
  sampleSmall, sampleComplex,
} from "../../../packages/core/dist/index.js";
import { $, card, copyText, downloadFile } from "./util.js";
import { aiSettings, saveAiSettings, aiCall, extractJson, aiNorm, seedFromProject, SAMPLE_DESC, AI_EXAMPLE } from "./ai.js";

export function makeSteps(ctx) {
  const { S, save, render } = ctx;
  const prj = () => S.prj;

  /* ---------------------------------------------------------- 1 Projekt */
  function rProjekt(el) {
    const p = prj();
    const c = card(el, "01", "Projekt", `
    <div class="grid g2">
      <label class="f">Název projektu / stroje
        <input type="text" id="pName" value="${esc(p.meta.name)}" placeholder="např. Temperační stanice TS-02">
      </label>
      <label class="f">Popis
        <input type="text" id="pDesc" value="${esc(p.meta.desc)}" placeholder="co stroj dělá, pro koho">
      </label>
    </div>
    <div class="row">
      <button class="small" id="bSample">Ukázka: malá stanice</button>
      <button class="small" id="bSample2">Ukázka: složitá linka</button>
      <button class="small" id="bExport">Export návrhu (JSON)</button>
      <button class="small" id="bImportJson">Načíst návrh (JSON)</button>
      <button class="small danger" id="bReset">Nový prázdný projekt</button>
    </div>
    <textarea id="jsonBox" hidden style="margin-top:12px;min-height:120px" spellcheck="false" aria-label="JSON návrhu"></textarea>
    <div class="row" id="jsonRow" hidden>
      <button class="small" id="bJsonCopy">Kopírovat JSON</button>
      <button class="small" id="bJsonDl">Stáhnout JSON</button>
      <button class="small primary" id="bJsonLoad">Načíst z textu</button>
    </div>
    <p class="note">Projdi kroky zleva doprava — návrh se průběžně ukládá v prohlížeči a mezi kroky se můžeš kdykoli vracet a vstupy upřesňovat; výstupy se vždy přepočítají. Nejrychlejší start: popiš stroj v kroku <b>AI návrh</b>. Existující projekt převezmeš vedlejší volbou <b>Import</b> dole v kroku Zařízení. Pokud s PLC začínáš, otevři <b>Nápovědu</b> (tlačítko vpravo v liště kroků).</p>`);
    c.querySelector("#pName").addEventListener("input", e => { p.meta.name = e.target.value; save(); $("projName").textContent = p.meta.name ? "— " + p.meta.name : ""; });
    c.querySelector("#pDesc").addEventListener("input", e => { p.meta.desc = e.target.value; save(); });
    c.querySelector("#bSample").addEventListener("click", () => {
      S.prj = sampleSmall();
      S.ai = seedFromProject(S.prj, SAMPLE_DESC.small, "Ukázkový návrh malé stanice — předvyplněno jako příklad práce AI návrháře.");
      S.step = 0; save(); render();
    });
    c.querySelector("#bSample2").addEventListener("click", () => {
      S.prj = sampleComplex();
      S.ai = seedFromProject(S.prj, SAMPLE_DESC.complex, "Ukázkový návrh složité linky — předvyplněno jako příklad práce AI návrháře.");
      S.step = 0; save(); render();
    });
    c.querySelector("#bReset").addEventListener("click", () => { S.prj = blankProject(); S.ai = { turns: [], last: null, draft: "" }; save(); render(); });
    const jb = c.querySelector("#jsonBox"), jr = c.querySelector("#jsonRow");
    const payload = () => JSON.stringify({ prj: S.prj, ai: S.ai }, null, 1);
    c.querySelector("#bExport").addEventListener("click", () => { jb.hidden = false; jr.hidden = false; jb.value = payload(); });
    c.querySelector("#bImportJson").addEventListener("click", () => { jb.hidden = false; jr.hidden = false; jb.value = ""; jb.placeholder = "Vlož dříve exportovaný JSON návrhu…"; jb.focus(); });
    c.querySelector("#bJsonCopy").addEventListener("click", () => copyText(jb.value || payload(), c.querySelector("#bJsonCopy")));
    c.querySelector("#bJsonDl").addEventListener("click", () => downloadFile((p.meta.name || "plc-projekt") + ".plcstudio.json", jb.value || payload()));
    c.querySelector("#bJsonLoad").addEventListener("click", () => {
      try {
        const d = JSON.parse(jb.value);
        S.prj = Object.assign(blankProject(), d.prj || d);
        S.ai = d.ai || { turns: [], last: null, draft: "" };
        save(); render();
      } catch { alertRow(c, "Neplatný JSON."); }
    });
  }
  function alertRow(c, msg) {
    let d = c.querySelector(".errtxt");
    if (!d) { d = document.createElement("div"); d.className = "errtxt"; c.appendChild(d); }
    d.textContent = msg;
  }

  /* ---------------------------------------------------------- 2 AI návrh */
  let aiBusy = false, aiCtl = null;
  function aiTurnView(t) {
    if (t.role === "user") return '<div class="msg u"><span class="who">Ty</span>' + esc(t.content) + "</div>";
    let r = null;
    try { r = aiNorm(JSON.parse(t.content)); } catch { /* text */ }
    if (!r) return '<div class="msg a"><span class="who">AI</span>' + esc(t.content.slice(0, 300)) + "</div>";
    let h = '<div class="msg a"><span class="who">AI návrhář</span>';
    if (r.questions.length) h += "<b>Potřebuji upřesnit:</b><ul style='margin:4px 0;padding-left:18px'>" + r.questions.map(q => "<li>" + esc(q) + "</li>").join("") + "</ul>";
    if (r.devices.length) h += "Navrženo <b>" + r.devices.length + " zařízení</b>" + (r.seq.length ? " a sekvence o " + r.seq.length + " krocích" : "") + ".";
    if (r.note) h += '<div class="hint" style="margin-top:4px">' + esc(r.note) + "</div>";
    return h + "</div>";
  }
  function aiApply() {
    const pr = S.ai.last;
    if (!pr || !pr.devices.length) return;
    const p = prj();
    p.devices = []; p.io = []; p.nextId = 1;
    const byName = {};
    for (const d of pr.devices) {
      const name = d.name || nextName(p, d.cls);
      const nd = { id: p.nextId++, name, cls: d.cls, desc: d.desc, opt: d.opt, unit: d.unit, rmin: d.rmin, rmax: d.rmax };
      p.devices.push(nd); byName[name] = nd;
    }
    syncIO(p);
    p.program.estop = (byName[pr.estop] || {}).id || "";
    p.program.seq = pr.seq
      .map(s => ({ dev: (byName[s.dev] || {}).id || 0, act: ["start", "stop", "open", "close", "wait"].includes(s.act) ? s.act : "wait", cond: s.cond, timeS: s.timeS }))
      .filter(s => s.act === "wait" || s.dev);
    S.step = 3; save(); render();
  }
  function rAI(el) {
    const cfg = aiSettings();
    const c = card(el, "02", "AI návrh systému", `
    <p class="hint" style="margin-top:0;max-width:75ch">Popiš stroj vlastními slovy — co dělá, jaké má pohony, válce, co se měří a hlídá. AI navrhne sestavu zařízení, případně se nejdřív doptá na detaily. Návrh převezmeš a doladíš v dalších krocích; AI zná i tvou aktuální sestavu, takže můžeš kdykoli psát jen úpravy.</p>
    <details class="help"${cfg.key ? "" : " open"}><summary>Nastavení AI (Anthropic API klíč)</summary><div class="body">
      <div class="grid g2" style="margin-top:8px">
        <label class="f">API klíč (uloží se jen v tomto prohlížeči)
          <input type="password" id="aiKey" value="${esc(cfg.key || "")}" placeholder="sk-ant-…">
        </label>
        <label class="f">Model
          <select id="aiModel">
            ${["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "claude-opus-5-5"].map(m => `<option${(cfg.model || "claude-sonnet-5-5") === m ? " selected" : ""}>${m}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="hint">Klíč získáš na console.anthropic.com. Dotazy jdou přímo z prohlížeče na Anthropic API; v produkční verzi půjdou přes server PLC Studia.</p>
    </div></details>
    <div class="chat" id="aiChat">${S.ai.turns.map(aiTurnView).join("")}</div>
    <textarea id="aiInput" style="margin-top:12px;min-height:90px" placeholder="Popiš stroj… (nebo klikni na Vložit příklad)">${esc(S.ai.draft || "")}</textarea>
    <div class="row">
      <button class="primary" id="aiSend" ${aiBusy ? "disabled" : ""}>${S.ai.turns.length ? "Odeslat upřesnění" : "Navrhnout zařízení"}</button>
      <button class="small" id="aiExample" ${S.ai.turns.length ? "hidden" : ""}>Vložit příklad</button>
      <button class="small" id="aiStop" ${aiBusy ? "" : "hidden"}>Stop</button>
      <button class="small danger" id="aiClear" ${S.ai.turns.length ? "" : "hidden"}>Nová konverzace</button>
      <span class="hint" style="margin:0" id="aiStatus"></span>
    </div>
    <div class="stream" id="aiStream" hidden></div>
    <div id="aiProposal"></div>`);
    const status = c.querySelector("#aiStatus"), ta = c.querySelector("#aiInput");
    c.querySelector("#aiKey").addEventListener("change", e => saveAiSettings({ ...aiSettings(), key: e.target.value.trim() }));
    c.querySelector("#aiModel").addEventListener("change", e => saveAiSettings({ ...aiSettings(), model: e.target.value }));
    ta.addEventListener("input", () => { S.ai.draft = ta.value; save(); });
    const pr = S.ai.last;
    if (pr && pr.devices.length) {
      const rows = pr.devices.map(d => "<tr><td class='mono'><b>" + esc(d.name) + "</b></td><td>" + CLS[d.cls].label + "</td><td style='font-size:.8rem'>" + esc(d.desc) + "</td><td style='font-size:.76rem;color:var(--muted)'>" + esc(Object.entries(d.opt).filter(([, v]) => v).map(([k]) => k).join(", ") + (d.cls.startsWith("Analog") ? (" " + d.unit + " " + d.rmin + "–" + d.rmax) : "")) + "</td></tr>").join("");
      c.querySelector("#aiProposal").innerHTML =
        "<h3>Navržená sestava</h3><div class='tablewrap'><table><thead><tr><th>Označení</th><th>Třída</th><th>Popis</th><th>Volby</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
        (pr.seq.length ? "<p class='hint'>Sekvence: " + esc(pr.seq.map((s, i) => (i + 1) + ". " + (s.act === "wait" ? ("výdrž " + s.timeS + " s") : (s.dev + " " + s.act))).join(" → ")) + "</p>" : "") +
        "<div class='row'><button class='primary' id='aiApplyBtn'>Převzít návrh (nahradí zařízení)</button><span class='hint' style='margin:0'>Nesedí? Napiš upřesnění a odešli znovu.</span></div>";
      c.querySelector("#aiApplyBtn").addEventListener("click", aiApply);
    }
    c.querySelector("#aiExample").addEventListener("click", () => { ta.value = AI_EXAMPLE; S.ai.draft = AI_EXAMPLE; save(); ta.focus(); status.textContent = ""; });
    c.querySelector("#aiClear").addEventListener("click", () => { S.ai = { turns: [], last: null, draft: "" }; save(); render(); });
    c.querySelector("#aiStop").addEventListener("click", () => { if (aiCtl) aiCtl.abort(); });
    c.querySelector("#aiSend").addEventListener("click", async () => {
      const msg = ta.value.trim();
      if (aiBusy) return;
      if (!msg) { status.textContent = "Nejdřív popiš stroj (nebo klikni na Vložit příklad)."; ta.focus(); return; }
      if (!aiSettings().key) { status.textContent = "Doplň API klíč v Nastavení AI výše."; return; }
      aiBusy = true;
      c.querySelector("#aiSend").disabled = true; c.querySelector("#aiStop").hidden = false;
      const sBox = c.querySelector("#aiStream"); sBox.hidden = false; sBox.textContent = "Přemýšlím…";
      status.textContent = "";
      S.ai.turns.push({ role: "user", content: msg }); S.ai.draft = ""; save();
      aiCtl = new AbortController();
      try {
        const text = await aiCall(S.ai.turns, prj(), { signal: aiCtl.signal });
        sBox.textContent = text;
        const res = extractJson(text);
        S.ai.turns.push({ role: "assistant", content: JSON.stringify(res) });
        const pr2 = aiNorm(res);
        if (pr2.devices.length) S.ai.last = pr2;
        save();
      } catch (e) {
        S.ai.turns.pop(); S.ai.draft = msg; save();
        const msgs = {
          no_key: "Doplň API klíč v Nastavení AI.", bad_key: "API klíč byl odmítnut (401).",
          rate_limited: "Příliš mnoho dotazů — zkus to za chvíli.",
          invalid_json: "Odpověď se nepodařilo přečíst — zkus to znovu.",
          AbortError: "",
        };
        status.textContent = (e && (msgs[e.code] ?? msgs[e.name])) ?? ("Nepodařilo se získat odpověď" + (e.detail ? ": " + e.detail : " — zkus to znovu."));
      } finally {
        aiBusy = false; aiCtl = null; render();
      }
    });
  }

  /* ---------------------------------------------------------- 3 Platformy */
  function rPlat(el) {
    const p = prj();
    const c = card(el, "03", "Cílové platformy", `
    <p class="hint" style="margin-top:0">Vyber jednu nebo víc platforem — program se vygeneruje pro každou zvlášť. Logika je stejná (IEC 61131-3 ST), liší se dialekt, soubor s tagy a postup importu.</p>
    <div class="platgrid">${Object.entries(PLAT).map(([k, pf]) => `
      <div class="plat ${p.platforms.includes(k) ? "on" : ""}" data-k="${k}" role="button" tabindex="0" aria-pressed="${p.platforms.includes(k)}">
        <b>${pf.name}</b><span>${pf.ide} · ${pf.cpu}</span><span class="lng">${pf.lang} · ${pf.imp}</span>
      </div>`).join("")}
    </div>`);
    c.querySelectorAll(".plat").forEach(d => {
      const toggle = () => {
        const k = d.dataset.k;
        p.platforms = p.platforms.includes(k) ? p.platforms.filter(x => x !== k) : [...p.platforms, k];
        save(); render();
      };
      d.addEventListener("click", toggle);
      d.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
  }

  /* ---------------------------------------------------------- 4 Zařízení */
  function rDev(el) {
    const p = prj();
    const c = card(el, "04", "Návrh zařízení stroje", `
    <div class="grid g3">
      <label class="f">Třída
        <select id="dCls">${Object.entries(CLS).map(([k, v]) => '<option value="' + k + '">' + v.label + "</option>").join("")}</select>
      </label>
      <label class="f">Označení
        <input type="text" id="dName" value="${esc(nextName(p, "Motor"))}">
      </label>
      <label class="f">Popis
        <input type="text" id="dDesc" placeholder="např. Čerpadlo hydrauliky">
      </label>
    </div>
    <div class="row" id="dOpts"></div>
    <div class="row"><button class="primary" id="bAdd">Přidat zařízení</button></div>
    <div id="dList"></div>
    <p class="note">Třídy Motor / Ventil / Analog dostanou hotový funkční blok (stavový automat, timeouty, status). Třídy DI/DO jsou volné signály pro vlastní logiku.</p>`);
    const clsSel = c.querySelector("#dCls"), nameIn = c.querySelector("#dName"), optRow = c.querySelector("#dOpts");
    const renderOpts = () => {
      const k = clsSel.value; const o = CLS[k].opts;
      let html = Object.entries(o).map(([ok, ol]) => "<label style='display:flex;gap:5px;align-items:center;font-size:.8rem'><input type='checkbox' id='opt_" + ok + "' " + (ok === "fbk" || ok === "fbkOpen" ? "checked" : "") + "> " + ol + "</label>").join("");
      if (k === "AnalogIn" || k === "AnalogOut") html += "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>jednotka <input type='text' id='dUnit' style='width:70px' placeholder='bar'></label>" +
        "<label class='f' style='flex-direction:row;gap:6px;align-items:center'>rozsah <input type='number' id='dMin' value='0' style='width:80px'> až <input type='number' id='dMax' value='100' style='width:80px'></label>";
      optRow.innerHTML = html || "<span class='hint' style='margin:0'>— bez voleb</span>";
    };
    clsSel.addEventListener("change", () => { nameIn.value = nextName(p, clsSel.value); renderOpts(); });
    renderOpts();
    c.querySelector("#bAdd").addEventListener("click", () => {
      const k = clsSel.value;
      const opt = {};
      for (const ok of Object.keys(CLS[k].opts)) { const cb = c.querySelector("#opt_" + ok); if (cb) opt[ok] = cb.checked; }
      p.devices.push({
        id: p.nextId++, name: nameIn.value.trim() || nextName(p, k), cls: k,
        desc: c.querySelector("#dDesc").value.trim(), opt,
        unit: (c.querySelector("#dUnit") || {}).value || "",
        rmin: +((c.querySelector("#dMin") || {}).value || 0),
        rmax: +((c.querySelector("#dMax") || {}).value || 100),
      });
      syncIO(p); save(); render();
    });
    const list = c.querySelector("#dList");
    if (p.devices.length) {
      let html = "<div class='tablewrap'><table><thead><tr><th>Označení</th><th>Třída</th><th>Popis</th><th>Volby</th><th></th></tr></thead><tbody>";
      for (const d of p.devices) {
        const opts = Object.entries(d.opt || {}).filter(([, v]) => v).map(([k]) => CLS[d.cls].opts[k]).join(", ") + (d.cls.startsWith("Analog") ? ((d.unit ? " " + d.unit : "") + " " + d.rmin + "–" + d.rmax) : "");
        html += "<tr><td class='mono'><b>" + esc(d.name) + "</b></td><td>" + CLS[d.cls].label + "</td>" +
          "<td><input type='text' data-id='" + d.id + "' data-f='desc' value='" + esc(d.desc) + "'></td>" +
          "<td style='font-size:.76rem;color:var(--muted)'>" + esc(opts || "—") + "</td>" +
          "<td><button class='small danger' data-del='" + d.id + "'>×</button></td></tr>";
      }
      list.innerHTML = html + "</tbody></table></div>";
      list.querySelectorAll("input[data-f=desc]").forEach(i => i.addEventListener("change", e => { const d = devById(p, +e.target.dataset.id); if (d) { d.desc = e.target.value; syncIO(p); save(); } }));
      list.querySelectorAll("button[data-del]").forEach(b => b.addEventListener("click", () => {
        p.devices = p.devices.filter(d => d.id !== +b.dataset.del);
        p.program.seq = p.program.seq.filter(s => s.act === "wait" || devById(p, s.dev));
        if (p.program.estop && !devById(p, p.program.estop)) p.program.estop = "";
        syncIO(p); save(); render();
      }));
    } else list.innerHTML = "<p class='hint'>Zatím žádná zařízení — přidej je výše, načti ukázku v kroku Projekt, nech si je navrhnout v kroku AI návrh, nebo použij Import níže.</p>";
    importBlock(el);
  }

  /* Import existujícího projektu — vedlejší volba. */
  function importBlock(el) {
    const c = document.createElement("details");
    c.className = "help";
    c.innerHTML = `<summary>Vedlejší volba: Import existujícího projektu (reverse engineering)</summary><div class="body">
    <p class="hint" style="margin-top:0;max-width:75ch">Vlož export z existujícího projektu a PLC Studio z něj zpětně sestaví zařízení a I/O — klidně pro migraci na jinou platformu. Formáty se poznají automaticky: SimaticML XML, Rockwell L5X/CSV, GVL/ST, tabulky labelů (CSV/tab), prostý I/O list <code>Tag;Adresa;Zařízení;Třída;Komentář</code>.</p>
    <div class="row"><input type="file" id="impFile" multiple style="font-size:.8rem"></div>
    <textarea id="impText" placeholder="…nebo sem vlož obsah souboru (XML / ST / CSV)" spellcheck="false" aria-label="Import"></textarea>
    <div class="row">
      <button class="primary" id="bAnalyze">Analyzovat</button>
      <span class="hint" style="margin:0">Analýza nic nepřepíše — nejdřív uvidíš náhled.</span>
    </div>
    <div id="impResult"></div>
    <p class="warnbox"><b>Co se přenese:</b> tagy, adresy, komentáře, odhad zařízení a tříd. <b>Co ne:</b> logika bloků (jen inventář), HW konfigurace, safety a komunikace — logiku generuje PLC Studio znovu ze šablon.</p>
    </div>`;
    el.appendChild(c);
    c.querySelector("#impFile").addEventListener("change", async e => {
      let txt = "";
      for (const f of e.target.files) { try { txt += await f.text() + "\n"; } catch { /* ignore */ } }
      c.querySelector("#impText").value = txt;
    });
    c.querySelector("#bAnalyze").addEventListener("click", () => {
      const res = detectAndParse(c.querySelector("#impText").value);
      const box = c.querySelector("#impResult");
      if (!res.tags.length && !res.blocks.length) { box.innerHTML = "<div class='errtxt'>Formát se nepodařilo rozpoznat nebo neobsahuje žádné tagy.</div>"; return; }
      const built = buildDevicesFromTags(res.tags);
      let html = "<div class='oktxt'>Rozpoznaný formát: <b>" + esc(res.fmt) + "</b> · " + res.tags.length + " tagů · " + built.devices.length + " zařízení</div>";
      if (res.blocks.length) html += "<p class='hint'>Nalezené bloky (jen inventář): " + res.blocks.slice(0, 12).map(esc).join(", ") + (res.blocks.length > 12 ? " …" : "") + "</p>";
      html += "<div class='tablewrap'><table><thead><tr><th>Zařízení</th><th>Třída</th><th>Tagy</th></tr></thead><tbody>";
      for (const d of built.devices) {
        const tags = built.io.filter(e => e.devId === d.id).map(e => e.tag);
        html += "<tr><td class='mono'><b>" + esc(d.name) + "</b></td><td>" + esc(d.cls) + "</td><td class='mono' style='white-space:normal'>" + tags.map(esc).join(", ") + "</td></tr>";
      }
      html += "</tbody></table></div><div class='row'><button class='primary' id='bApply'>Převzít do návrhu (nahradí současná zařízení)</button></div>";
      box.innerHTML = html;
      box.querySelector("#bApply").addEventListener("click", () => {
        const p = prj();
        p.devices = built.devices; p.io = built.io; p.nextId = built.nextId;
        autoAddr(p, false);
        save(); render();
      });
    });
  }

  /* ---------------------------------------------------------- 5 I/O */
  function rIO(el) {
    const p = prj();
    syncIO(p);
    const dup = {};
    for (const e of p.io) { if (e.addr) dup[e.addr] = (dup[e.addr] || 0) + 1; dup["t:" + e.tag] = (dup["t:" + e.tag] || 0) + 1; }
    let rows = "";
    for (const e of p.io) {
      const d = devById(p, e.devId);
      rows += "<tr><td class='mono'>" + esc(d ? d.name : "?") + "</td>" +
        "<td class='mono dir" + e.dir + "'>" + e.dir + "</td>" +
        "<td><input type='text' data-k='" + e.key + "' data-f='tag' value='" + esc(e.tag) + "' class='" + (dup["t:" + e.tag] > 1 ? "dup" : "") + "'></td>" +
        "<td><input type='text' data-k='" + e.key + "' data-f='addr' value='" + esc(e.addr) + "' class='" + (e.addr && dup[e.addr] > 1 ? "dup" : "") + "' style='min-width:70px'></td>" +
        "<td style='text-align:center'>" + (e.dir === "DI" ? "<input type='checkbox' data-k='" + e.key + "' data-f='nc' " + (e.nc ? "checked" : "") + " aria-label='NC'>" : "—") + "</td>" +
        "<td><input type='text' data-k='" + e.key + "' data-f='cmt' value='" + esc(e.cmt) + "' style='min-width:160px'></td></tr>";
    }
    const issues = validateProject(p);
    const issuesHtml = issues.length
      ? "<div class='warnbox'><b>Kontrola návrhu (" + issues.length + "):</b><ul style='margin:6px 0;padding-left:18px'>" +
        issues.slice(0, 12).map(i => "<li style='color:var(--" + (i.level === "error" ? "err" : "warn") + ")'><code>" + esc(i.where) + "</code> — " + esc(i.msg) + "</li>").join("") +
        (issues.length > 12 ? "<li>… a dalších " + (issues.length - 12) + "</li>" : "") + "</ul>" +
        "<button class='small' id='bFixTags'>Opravit tagy automaticky (ASCII)</button></div>"
      : "<p class='oktxt'>Kontrola návrhu: bez nálezů ✓</p>";
    const c = card(el, "05", "I/O mapování", `
    <div class="stats">
      <span class="stat">tagů <b>${p.io.length}</b></span>
      ${["DI", "DO", "AI", "AO"].map(d => "<span class='stat'>" + d + " <b>" + p.io.filter(e => e.dir === d).length + "</b></span>").join("")}
    </div>
    <div class="tablewrap"><table><thead><tr><th>Zařízení</th><th>Směr</th><th>Tag</th><th>Adresa</th><th>NC</th><th>Komentář</th></tr></thead><tbody>${rows || "<tr><td colspan='6' class='hint'>žádná zařízení</td></tr>"}</tbody></table></div>
    <div class="row"><button class="small" id="bRenum">Přečíslovat adresy od nuly</button><span class="hint" style="margin:0">Adresy v Siemens notaci — pro ostatní platformy se převedou automaticky. NC = rozpínací kontakt (promítne se do schématu). Duplicity červeně.</span></div>
    ${issuesHtml}`);
    c.querySelectorAll("input[data-k]").forEach(i => i.addEventListener("change", e => {
      const en = p.io.find(x => x.key === e.target.dataset.k);
      if (!en) return;
      if (e.target.type === "checkbox") en.nc = e.target.checked;
      else en[e.target.dataset.f] = e.target.value.trim();
      save(); render();
    }));
    c.querySelector("#bRenum").addEventListener("click", () => { for (const e of p.io) e.addr = ""; autoAddr(p, true); save(); render(); });
    const fix = c.querySelector("#bFixTags");
    if (fix) fix.addEventListener("click", () => {
      const used = new Set();
      for (const e of p.io) {
        let t = sanitizeTag(e.tag), tt = t, n = 2;
        while (used.has(tt)) tt = t + "_" + n++;
        used.add(tt); e.tag = tt;
      }
      save(); render();
    });
  }

  /* ---------------------------------------------------------- 6 Schéma */
  function rSchema(el) {
    const p = prj();
    syncIO(p);
    if (!p.io.length) { card(el, "06", "Schéma", "<p class='hint'>Nejdřív přidej zařízení (krok 4), nebo si je nech navrhnout v kroku AI návrh.</p>"); return; }
    const mods = modules(p);
    const bd = svgBlock(p, mods);
    const c1 = card(el, "06", "Blokové schéma systému",
      "<div class='tablewrap'><figure style='margin:0'>" + bd + "<figcaption class='hint'>Zdroje signálů → moduly PLC → akční členy; moduly navrženy z počtu I/O (DI16 / DO16 / AI8 / AO4).</figcaption></figure></div>" +
      "<div class='row'><button class='small' id='cpBd'>Kopírovat SVG</button><button class='small' id='dlBd'>Stáhnout SVG</button></div>");
    c1.querySelector("#cpBd").addEventListener("click", () => copyText(bd, c1.querySelector("#cpBd")));
    c1.querySelector("#dlBd").addEventListener("click", () => downloadFile("00_blokove_schema.svg", bd));
    let inner = "";
    mods.forEach((m, i) => {
      const s = sheetSVG(p, m, i + 1, i + 1, mods.length);
      inner += "<h3>" + m.dir + m.idx + " — svorkovnice X" + (i + 1) + "</h3>" +
        "<div class='tablewrap'><figure style='margin:0'>" + s + "</figure></div>" +
        "<div class='row'><button class='small' data-svg='" + i + "'>Stáhnout SVG</button><button class='small' data-dxf='" + i + "'>Stáhnout DXF</button></div>";
    });
    const c2 = card(el, "·", "Elektrické zapojení I/O", inner +
      "<p class='warnbox'><b>Pozor:</b> NC/NO kontakty dle sloupce NC v kroku I/O; čísla vodičů -W1xx dle potenciálových řad. Jištění, průřezy, relé na výstupech s větší zátěží a stínění analogů doplní projektant elektro — toto je podklad, ne výrobní dokumentace. DXF otevře EPLAN / AutoCAD / LibreCAD.</p>");
    c2.querySelectorAll("[data-svg]").forEach(b => b.addEventListener("click", () => {
      const i = +b.dataset.svg;
      downloadFile(String(i + 1).padStart(2, "0") + "_" + mods[i].dir + mods[i].idx + "_X" + (i + 1) + ".svg", sheetSVG(p, mods[i], i + 1, i + 1, mods.length));
    }));
    c2.querySelectorAll("[data-dxf]").forEach(b => b.addEventListener("click", () => {
      const i = +b.dataset.dxf;
      downloadFile(String(i + 1).padStart(2, "0") + "_" + mods[i].dir + mods[i].idx + "_X" + (i + 1) + ".dxf", sheetDXF(p, mods[i], i + 1, i + 1, mods.length));
    }));
    let rowsHtml = "";
    mods.forEach((m, mi) => m.ch.forEach((e, i) => {
      const d = devById(p, e.devId) || {};
      rowsHtml += "<tr><td class='mono'><b>X" + (mi + 1) + ":" + (i + 1) + "</b></td><td class='mono'>" + m.dir + m.idx + "</td><td class='mono'>" + i + "</td><td class='mono'>" + esc(e.addr) + "</td><td class='mono'>" + esc(e.tag) + "</td><td style='color:var(--muted);font-size:.78rem'>" + esc((d.name ? d.name + " · " : "") + (e.cmt || "")) + "</td></tr>";
    }));
    const c3 = card(el, "·", "Svorkovnice",
      "<div class='tablewrap'><table><thead><tr><th>Svorka</th><th>Modul</th><th>Kanál</th><th>Adresa</th><th>Tag</th><th>Zařízení / komentář</th></tr></thead><tbody>" + rowsHtml + "</tbody></table></div>" +
      "<div class='row'><button class='small' id='bCsv'>Stáhnout svorkovnici (CSV)</button><span class='hint' style='margin:0'>Podklad pro projektanta elektro.</span></div>");
    c3.querySelector("#bCsv").addEventListener("click", () => downloadFile("03_svorkovnice.csv", svorkyCSV(p)));
  }

  /* ---------------------------------------------------------- 7 Program */
  function rProg(el) {
    const p = prj();
    const diDevs = p.devices.filter(d => d.cls === "DI");
    const actDevs = p.devices.filter(d => d.cls === "Motor" || d.cls === "Ventil");
    const c = card(el, "07", "Logika programu", `
    <div class="grid g2">
      <label class="f">Centrální uvolnění (E-stop / bezpečnostní vstup)
        <select id="pEstop"><option value="">— žádný (doplníš ručně) —</option>${diDevs.map(d => "<option value='" + d.id + "' " + (p.program.estop === d.id ? "selected" : "") + ">" + esc(d.name + " – " + d.desc) + "</option>").join("")}</select>
      </label>
      <div class="f" style="justify-content:end"><span class="hint" style="margin:0">Signál se zapojí do <code>enable</code> všech bloků. Skutečnou bezpečnost řeší safety technika, ne program — viz Nápověda.</span></div>
    </div>
    <h3>Automatická sekvence (volitelné)</h3>
    <p class="hint" style="margin-top:0">Kroky se provedou po řadě v režimu AUTO; generuje se z nich stavový automat (CASE). Přechod = zpětné hlášení, nebo čas.</p>
    <div id="seqList"></div>
    <div class="row">
      <select id="sDev">${actDevs.map(d => "<option value='" + d.id + "'>" + esc(d.name + " – " + d.desc) + "</option>").join("")}<option value="0">— čekání (bez zařízení) —</option></select>
      <select id="sAct"></select>
      <select id="sCond"><option value="fbk">přechod: zpětné hlášení</option><option value="time">přechod: čas</option></select>
      <input type="number" id="sTime" value="3" min="1" style="width:70px" aria-label="čas s"> s
      <button class="primary small" id="bAddStep">Přidat krok</button>
    </div>`);
    const sDev = c.querySelector("#sDev"), sAct = c.querySelector("#sAct");
    const refreshActs = () => {
      const d = devById(p, +sDev.value);
      sAct.innerHTML = !d ? "<option value='wait'>čekat</option>" :
        d.cls === "Motor" ? "<option value='start'>start</option><option value='stop'>stop</option>"
          : "<option value='open'>otevřít</option><option value='close'>zavřít</option>";
    };
    sDev.addEventListener("change", refreshActs); refreshActs();
    c.querySelector("#pEstop").addEventListener("change", e => { p.program.estop = +e.target.value || ""; save(); });
    c.querySelector("#bAddStep").addEventListener("click", () => {
      const d = devById(p, +sDev.value);
      p.program.seq.push({ dev: d ? d.id : 0, act: d ? sAct.value : "wait", cond: d ? c.querySelector("#sCond").value : "time", timeS: +c.querySelector("#sTime").value || 1 });
      save(); render();
    });
    const list = c.querySelector("#seqList");
    if (p.program.seq.length) {
      list.innerHTML = p.program.seq.map((s, i) => {
        const d = devById(p, s.dev);
        const txt = s.act === "wait" ? "výdrž " + s.timeS + " s" : (d ? d.name : "?") + " " + ({ start: "start", stop: "stop", open: "otevřít", close: "zavřít" }[s.act] || s.act) + " → " + (s.cond === "time" ? ("čas " + s.timeS + " s") : "zpětné hlášení");
        return "<div class='seqrow'><span class='k'>Krok " + (i + 1) + "</span><span style='flex:1;font-size:.86rem'>" + esc(txt) + "</span>" +
          "<button class='small' data-up='" + i + "' " + (i === 0 ? "disabled" : "") + ">↑</button><button class='small' data-dn='" + i + "' " + (i === p.program.seq.length - 1 ? "disabled" : "") + ">↓</button><button class='small danger' data-rm='" + i + "'>×</button></div>";
      }).join("");
      list.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.up; [p.program.seq[i - 1], p.program.seq[i]] = [p.program.seq[i], p.program.seq[i - 1]]; save(); render(); }));
      list.querySelectorAll("[data-dn]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.dn; [p.program.seq[i + 1], p.program.seq[i]] = [p.program.seq[i], p.program.seq[i + 1]]; save(); render(); }));
      list.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { p.program.seq.splice(+b.dataset.rm, 1); save(); render(); }));
    } else list.innerHTML = "<p class='hint'>Bez sekvence se vygenerují jen instance zařízení s TODO povely pro ruční režim.</p>";
  }

  /* ---------------------------------------------------------- 8 Generovat */
  let outerTab = 0, innerTab = 0;
  function rGen(el) {
    const p = prj();
    syncIO(p);
    if (!p.devices.length) { card(el, "08", "Generování", "<p class='hint'>Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku AI návrh, nebo použij volbu Import.</p>"); return; }
    if (!p.platforms.length) { card(el, "08", "Generování", "<p class='hint'>Vyber aspoň jednu platformu (krok 3).</p>"); return; }
    const cache = {};
    for (const pl of p.platforms) cache[pl] = genFor(p, pl);
    const plats = p.platforms;
    if (outerTab >= plats.length) outerTab = 0;
    const files = Object.keys(cache[plats[outerTab]]);
    if (innerTab >= files.length) innerTab = 0;
    const c = card(el, "08", "Generované zdroje", `
    <div class="tabs outer" role="tablist">${plats.map((pl, i) => "<button role='tab' aria-selected='" + (i === outerTab) + "' data-o='" + i + "'>" + PLAT[pl].name + "</button>").join("")}</div>
    <div class="tabs" role="tablist" style="margin-top:8px">${files.map((f, i) => "<button role='tab' aria-selected='" + (i === innerTab) + "' data-f='" + i + "'>" + f + "</button>").join("")}</div>
    <div class="codebox"><pre class="code" id="genCode"></pre><button class="copybtn" id="bCopyGen">Kopírovat</button></div>
    <div class="row"><button class="small primary" id="bDlGen">Stáhnout zobrazený soubor</button><button class="small" id="bDlAllGen">Stáhnout všechny soubory platformy</button></div>
    <p class="note">Postup importu pro danou platformu je v záložce <b>README.txt</b>. Výstup je výchozí kostra — TODO komentáře označují místa k doplnění.</p>`);
    const cur = () => { const fs = Object.keys(cache[plats[outerTab]]); return { name: fs[innerTab], body: cache[plats[outerTab]][fs[innerTab]] }; };
    const show = () => { c.querySelector("#genCode").textContent = cur().body; };
    show();
    c.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => { outerTab = +b.dataset.o; innerTab = 0; render(); }));
    c.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { innerTab = +b.dataset.f; c.querySelectorAll("[data-f]").forEach(x => x.setAttribute("aria-selected", x === b)); show(); }));
    c.querySelector("#bCopyGen").addEventListener("click", () => copyText(cur().body, c.querySelector("#bCopyGen")));
    c.querySelector("#bDlGen").addEventListener("click", () => downloadFile(plats[outerTab] + "_" + cur().name, cur().body));
    c.querySelector("#bDlAllGen").addEventListener("click", () => {
      const pl = plats[outerTab];
      for (const [n, b] of Object.entries(cache[pl])) downloadFile(pl + "_" + n, b);
    });
  }

  /* ---------------------------------------------------------- 9 Dokumentace */
  let docSel = 0;
  function rDocs(el) {
    const p = prj();
    syncIO(p);
    if (!p.devices.length) { card(el, "09", "Dokumentace", "<p class='hint'>Nejdřív navrhni zařízení (kroky 2–4).</p>"); return; }
    const files = allProjectFiles(p);
    if (docSel >= files.length) docSel = 0;
    const groups = [...new Set(files.map(f => f.group))];
    let listHtml = "";
    for (const g of groups) {
      listHtml += "<h4>" + esc(g) + "</h4>";
      files.forEach((f, i) => { if (f.group === g) listHtml += "<button data-d='" + i + "' aria-selected='" + (i === docSel) + "'>" + esc(f.name) + "</button>"; });
    }
    const c = card(el, "09", "Dokumentace projektu", `
    <p class="hint" style="margin-top:0;max-width:78ch">Z návrhu se generuje dokumentace běžného automatizačního projektu: FDS, I/O list, svorkovnice, seznam alarmů, FAT protokol, návod k obsluze, SW dokumentace, schémata (SVG + DXF) a zdrojové kódy platforem. Vyber soubor vlevo, prohlédni a ulož, kam potřebuješ.</p>
    <div class="docgrid">
      <div class="doclist" role="tablist">${listHtml}</div>
      <div style="min-width:0">
        <div class="row" style="margin:0 0 10px">
          <button class="primary" id="bDocSave">Stáhnout soubor</button>
          <button class="small" id="bDocAll">Stáhnout vše (po souborech)</button>
          <button class="small" id="bDocCopy">Kopírovat</button>
          <span class="hint" style="margin:0;font-family:var(--font-mono);font-size:.72rem" id="docName"></span>
        </div>
        <div id="docPane"></div>
      </div>
    </div>
    <p class="note">Soubory platforem se ukládají s předponou platformy (např. <code>siemens_Gen_Main.scl</code>), ať se v jednom adresáři nepletou. „Stáhnout vše" uloží každý soubor zvlášť — prohlížeč se může zeptat na povolení více stahování.</p>`);
    const pane = c.querySelector("#docPane"), nameEl = c.querySelector("#docName");
    const show = () => {
      const f = files[docSel];
      nameEl.textContent = "→ " + f.save;
      if (f.kind === "svg") pane.innerHTML = "<div class='svgprev'>" + f.body + "</div>";
      else if (f.kind === "dxf") pane.innerHTML = "<p class='hint' style='margin:0 0 8px'>Náhled výkresu — uloží se jako DXF pro EPLAN / AutoCAD / LibreCAD.</p><div class='svgprev'>" + f.prev + "</div>";
      else { pane.innerHTML = "<div class='codebox'><pre class='code' style='border-radius:8px;max-height:520px'></pre></div>"; pane.querySelector("pre").textContent = f.body; }
      c.querySelectorAll("[data-d]").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.d === docSel)));
    };
    show();
    c.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => { docSel = +b.dataset.d; show(); }));
    c.querySelector("#bDocCopy").addEventListener("click", () => copyText(files[docSel].body, c.querySelector("#bDocCopy")));
    c.querySelector("#bDocSave").addEventListener("click", () => downloadFile(files[docSel].save, files[docSel].body));
    c.querySelector("#bDocAll").addEventListener("click", () => { for (const f of files) downloadFile(f.save, f.body); });
  }

  /* ---------------------------------------------------------- Nápověda */
  function rHelp(el) {
    const H = (t, b) => "<details class='help'><summary>" + t + "</summary><div class='body'>" + b + "</div></details>";
    const c = document.createElement("section");
    c.className = "card";
    c.innerHTML = "<h2><span class='n'>?</span>Škola PLC — nápověda pro začátečníky</h2>"
      + H("Co je PLC a jak funguje", `
      <p>PLC (programovatelný logický automat) je průmyslový počítač, který řídí stroj: čte vstupy (tlačítka, snímače), vyhodnotí program a nastaví výstupy (stykače, ventily, signálky). Na rozdíl od běžného PC je stavěný na nepřetržitý provoz, rušení a teploty v rozvaděči.</p>
      <p><b>Scan cyklus</b>: <b>1)</b> načti vstupy, <b>2)</b> vykonej program odshora dolů, <b>3)</b> zapiš výstupy — opakuje se každých 1–10 ms. Program nikdy „nečeká" uvnitř; stav do dalšího cyklu musí být v proměnné.</p>
      <p>Typický projekt = <b>HW konfigurace</b> + <b>tagy</b> + <b>program</b> (bloky).</p>`)
      + H("Vstupy a výstupy (DI / DO / AI / AO)", `
      <ul>
        <li><b>DI</b> — digitální vstup 24 V DC: tlačítko, koncák, čidlo.</li>
        <li><b>DO</b> — digitální výstup: stykač, ventil, signálka; větší zátěž přes relé.</li>
        <li><b>AI</b> — analogový vstup 0–10 V / 4–20 mA; surové číslo se škáluje na jednotky (FB_AnalogIn). 4–20 mA pozná přerušený vodič.</li>
        <li><b>AO</b> — analogový výstup: měnič, proporcionální ventil.</li>
      </ul>
      <p><b>NC vs. NO:</b> bezpečnostní signály se zapojují NC — TRUE = v pořádku, přerušený vodič = zastavení. Proto E-stop = TRUE znamená „můžeš jet".</p>`)
      + H("Jazyky IEC 61131-3 — kterým psát", `
      <ul>
        <li><b>LAD</b> — žebříček; čte ho údržba, ideální na blokování.</li>
        <li><b>FBD</b> — grafické bloky, analogová logika.</li>
        <li><b>ST / SCL</b> — text jako Pascal; výpočty, automaty, data. <b>Tímto generuje PLC Studio</b> — je přenositelný.</li>
        <li><b>SFC/GRAPH</b> — velké sekvence. <b>IL/STL</b> — jen údržba starého kódu.</li>
      </ul>`)
      + H("Stavební bloky programu (FB, FC, DB, instance)", `
      <ul>
        <li><b>FC</b> — bez paměti; výpočty.</li>
        <li><b>FB</b> — má instanci (paměť). Jeden FB_Motor, deset motorů = deset instancí.</li>
        <li><b>DB / globální proměnné</b> — data; <b>UDT</b> — vlastní typy.</li>
        <li><b>OB / task</b> — vstupní body; u Siemens doplnit OB82/86/121/122, jinak CPU při poruše periferie stopne.</li>
      </ul>
      <p>Pravidlo: žádné magické bity a absolutní adresy — vše symbolicky, zařízení jako instance FB.</p>`)
      + H("Stavové automaty a časovače", `
      <p>Každé zařízení i sekvence je <b>stavový automat</b>: proměnná krok + CASE; každý čekací krok má timeout do chybového stavu. Kostra: <code>CASE statStep OF 0: klid … 10: rozběh (timeout!) … 20: běh … 90: porucha END_CASE</code>.</p>
      <p><b>TON</b> = zpožděné sepnutí; <b>hrana</b>: <code>trig := sig AND NOT lastSig; lastSig := sig;</code></p>`)
      + H("Bezpečnost — co NIKDY neřešit jen programem", `
      <p>Nouzové zastavení, kryty, dvouruční ovládání jsou <b>bezpečnostní funkce</b> dle ISO 13849 / IEC 62061 — musí je zajistit bezpečnostní relé nebo safety PLC dle posouzení rizik. Běžný program s bezpečnostním signálem jen pracuje (zastaví sekvenci) — nesmí být jediné, co člověka chrání. V EU je to součást CE (nařízení 2023/1230).</p>`)
      + H("Přehled platforem", `
      <div class='tablewrap'><table><thead><tr><th>Výrobce</th><th>IDE</th><th>CPU</th><th>Jazyk</th><th>Import z PLC Studio</th></tr></thead><tbody>
      ${Object.values(PLAT).map(pf => "<tr><td><b>" + pf.name + "</b></td><td>" + pf.ide + "</td><td>" + pf.cpu + "</td><td class='mono'>" + pf.lang + "</td><td style='font-size:.78rem'>" + pf.imp + "</td></tr>").join("")}
      </tbody></table></div>`)
      + H("Blokové a elektrické schéma — jak je číst", `
      <p><b>Blokové schéma</b>: vlevo zdroje signálů, uprostřed PLC (zdroj 24 V, CPU, moduly z počtu I/O), vpravo akční členy; čára = signál.</p>
      <p><b>Elektrické zapojení</b>: DI od L+ přes kontakt na svorku; DO ze svorky přes zátěž na M (0 V); analogy smyčka 4–20 mA. Rámeček s referencemi, popisové pole, značení <code>-M1</code> (IEC 81346), čísla vodičů <code>-W1xx</code>, NC/NO dle IEC 60617. Každý list jde stáhnout i jako <b>DXF</b> pro EPLAN/AutoCAD.</p>
      <p>Je to <i>podklad</i>, ne výrobní dokumentace — jištění, průřezy a dispozici řeší projektant elektro.</p>`)
      + H("Migrace projektu mezi platformami", `
      <p><b>1)</b> exportuj tagy/GVL ze zdrojové platformy, <b>2)</b> volba Import v kroku Zařízení, <b>3)</b> zkontroluj třídy a adresy, <b>4)</b> vyber cílovou platformu a vygeneruj. Přenese se struktura, tagy, komentáře; HW, safety, komunikace a specifická logika jsou ruční práce.</p>`)
      + H("Slovníček", `
      <ul>
        <li><b>Tag</b> — pojmenovaný signál. <b>Instance</b> — paměť jednoho použití FB.</li>
        <li><b>Scan</b> — průchod programu. <b>Interlock</b> — blokovací podmínka.</li>
        <li><b>HMI</b> — operátorský panel. <b>Retain</b> — proměnná přežívající vypnutí.</li>
        <li><b>Openness / L5X / PLCopen XML</b> — formáty pro strojovou výměnu projektů.</li>
        <li><b>PLCSIM, Logix Echo, GX Simulator…</b> — simulátory CPU.</li>
      </ul>`)
      + H("Jak pracovat s PLC Studio", `
      <ol style='padding-left:20px'>
        <li><b>Projekt</b> — pojmenuj; nebo načti ukázku.</li>
        <li><b>AI návrh</b> — popiš stroj, AI navrhne zařízení a sekvenci (API klíč v nastavení kroku).</li>
        <li><b>Platformy</b> — vyber cílové systémy.</li>
        <li><b>Zařízení</b> — dolaď sestavu; Import existujícího projektu je vedlejší volba dole.</li>
        <li><b>I/O</b> — tagy, adresy, NC; kontrola návrhu hlídá duplicity a přenositelnost tagů.</li>
        <li><b>Schéma</b> — blokové schéma, elektrické zapojení (SVG/DXF), svorkovnice.</li>
        <li><b>Program</b> — E-stop a automatická sekvence.</li>
        <li><b>Generovat</b> — kód po platformách, README s postupem importu.</li>
        <li><b>Dokumentace</b> — FDS, FAT a spol. po souborech ke stažení.</li>
      </ol>`);
    el.appendChild(c);
  }

  return { rProjekt, rAI, rPlat, rDev, rIO, rSchema, rProg, rGen, rDocs, rHelp };
}
