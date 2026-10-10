/* PLCdesk — krok 13 Oživení: plán po fázích z jádra (commission.ts), zápis výsledků kroků,
   filtr, souhrn a export protokolu (MD, CSV). Výsledky žijí v projektu (Project.commissioning). */
import {
  escHtml as esc, tr, syncIO, approvalItems, approvalStatus,
  commissioningPlan, COMMISSION_PHASES, setCommissionResult, clearCommissionResult, commissioningSummary,
  commissioningMd, commissioningCsv, COMMISSION_FILE_MD, COMMISSION_FILE_CSV, APPROVAL_FILE,
} from "../../../packages/core/dist/index.js";
import { card, downloadFile } from "./util.js";
import { approverName, nameFieldHtml, wireNameField, fmtAt, statusChip } from "./approval_step.js";

export function makeCommissionStep(ctx) {
  const { S, save, render } = ctx;
  /* pohled: filtr, zavřené fáze, rozepsané hodnoty (naměřeno / poznámka) a chybové hlášky — drží se při překreslení */
  const view = { filter: "all", closed: {}, drafts: {}, err: {} };
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo({ top: y }); };
  const RES = () => ({ ok: tr("OK"), nok: tr("Nevyhovuje"), na: tr("N/A") });

  function stepHtml(p, s) {
    const r = p.commissioning?.[s.id];
    const d = view.drafts[s.id] || {};
    const name = !!approverName();
    const res = RES();
    const val = f => d[f] ?? r?.[f] ?? "";
    return "<div class='cmrow" + (r ? " cm-" + r.result : "") + "' data-id='" + esc(s.id) + "'>" +
      "<div class='cmhead'><code>" + esc(s.id) + "</code><b>" + esc(s.title) + "</b>" +
      (r ? "<span class='st st-" + ({ ok: "ok", nok: "rej", na: "wait" })[r.result] + "'>" + esc(res[r.result]) + "</span>" : "<span class='st st-wait'>" + tr("bez výsledku") + "</span>") + "</div>" +
      "<div class='cmgrid'><div><span class='cmlbl'>" + tr("Co udělat") + "</span>" + esc(s.how) + "</div><div><span class='cmlbl'>" + tr("Co se má stát") + "</span>" + esc(s.expect) + "</div></div>" +
      (s.signals.length ? "<div class='cmsig'><span class='cmlbl'>" + tr("Signály") + "</span>" + s.signals.map(x => "<code>" + esc(x) + "</code>").join(" ") + "</div>" : "") +
      "<div class='cmform'>" +
      "<span class='cmres' role='group' aria-label='" + esc(tr("Výsledek")) + "'>" + ["ok", "nok", "na"].map(k => "<button class='small' data-res='" + k + "' data-needname aria-pressed='" + (r?.result === k) + "'" + (name ? "" : " disabled") + ">" + esc(res[k]) + "</button>").join("") + "</span>" +
      "<input type='text' data-f='measured' maxlength='200' value='" + esc(val("measured")) + "' placeholder='" + esc(tr("naměřeno")) + "' aria-label='" + esc(tr("Naměřeno")) + "'>" +
      "<input type='text' data-f='note' maxlength='500' value='" + esc(val("note")) + "' placeholder='" + esc(tr("poznámka")) + "' aria-label='" + esc(tr("Poznámka")) + "'>" +
      "<span class='hint cmwho' style='margin:0'>" + (r ? esc(r.by) + ", " + fmtAt(r.at) : "") + "</span>" +
      (r ? "<button class='small danger' data-clear>" + tr("Smazat výsledek") + "</button>" : "") +
      "</div><div class='errtxt' data-err" + (view.err[s.id] ? "" : " hidden") + ">" + esc(view.err[s.id] || "") + "</div></div>";
  }

  function rCommission(el) {
    const p = S.prj;
    syncIO(p);
    const plan = commissioningPlan(p);
    const sum = commissioningSummary(p, plan);
    const items = approvalItems(p).filter(i => i.group === "commission");
    const nok = new Set(plan.filter(s => p.commissioning?.[s.id]?.result === "nok").map(s => s.id));
    const open = new Set(sum.openSteps.map(s => s.id));
    const pass = s => view.filter === "all" || (view.filter === "open" ? open.has(s.id) : nok.has(s.id));
    const res = RES();

    let phases = "";
    for (const ph of Object.keys(COMMISSION_PHASES).map(Number)) {
      const steps = plan.filter(s => s.phase === ph);
      if (!steps.length) continue;
      const shown = steps.filter(pass);
      if (!shown.length && view.filter !== "all") continue;
      const done = steps.filter(s => p.commissioning?.[s.id] && p.commissioning[s.id].result !== "nok").length;
      const bad = steps.filter(s => nok.has(s.id)).length;
      phases += "<details class='help cmphase' data-ph='" + ph + "'" + (view.closed[ph] ? "" : " open") + "><summary>" + ph + ". " + esc(tr(COMMISSION_PHASES[ph])) +
        " <span class='hint' style='margin:0'>" + tr("{done} z {n} hotovo", { done, n: steps.length }) + (bad ? " · <span class='st st-rej'>" + esc(res.nok) + " " + bad + "</span>" : "") + "</span></summary><div class='body cmbody'>" +
        shown.map(s => stepHtml(p, s)).join("") + "</div></details>";
    }
    if (!phases) phases = "<p class='hint'>" + tr("Žádný krok neodpovídá filtru.") + "</p>";

    const FILTERS = [["all", tr("vše")], ["open", tr("otevřené (bez výsledku nebo nevyhovuje)")], ["nok", tr("nevyhovuje")]];
    const c = card(el, "13", tr("Oživení"), `
    <p class="hint" style="margin-top:0;max-width:110ch">${tr("Plán oživení navrhl PLCdesk z projektu. Ke každému kroku se zapisuje výsledek OK / NOK / N/A, kdo a kdy ho zapsal a naměřená hodnota. Oživení je uzavřené, když jsou všechny kroky OK nebo N/A a uzavření schválí odpovědná osoba (viz {file}).", { file: APPROVAL_FILE })}</p>
    <p class="warnbox">${tr("Fáze 5 zkouší E-stop a blokování jen jako signály standardního programu. Bezpečnostní funkce se validují ve fázi 10.")}</p>
    <div class="grid g2">
      ${nameFieldHtml(tr("Jméno osoby, která zapisuje výsledky"))}
      <div class="f" style="justify-content:end"><span class="hint" style="margin:0">${tr("Stejné jméno jako ve Schválení; zapíše se ke každému výsledku.")}</span>
        <span class="errtxt" id="apNameWarn" style="margin:0">${tr("Bez jména nelze zapsat výsledek.")}</span></div>
    </div>
    <div class="stats">
      <span class="stat st-ok">${esc(res.ok)} <b>${sum.ok}</b></span><span class="stat st-rej">${esc(res.nok)} <b>${sum.nok}</b></span><span class="stat st-wait">${esc(res.na)} <b>${sum.na}</b></span>
      <span class="stat">${tr("bez výsledku")} <b>${sum.open}</b></span><span class="stat">${tr("celkem <b>{n}</b>", { n: sum.total })}</span>
    </div>
    ${sum.done ? "<p class='oktxt'>" + tr("Všechny kroky jsou OK nebo N/A — uzavření oživení lze schválit v kroku Schválení.") + " ✓</p>"
      : "<p class='hint'>" + tr("Otevřených kroků: {n} (bez výsledku nebo nevyhovuje).", { n: sum.openSteps.length }) + "</p>"}
    <div class="cmappr">${items.map(i => "<span class='cmapitem'>" + esc(i.title) + " " + statusChip(approvalStatus(p, i)) + "</span>").join("")}
      <button class="small" id="cmToAppr">${tr("Ke schválení")} →</button></div>
    <div class="row">
      <label class="f" style="flex-direction:row;gap:8px;align-items:center">${tr("Zobrazit")}
        <select id="cmFilter">${FILTERS.map(([v, l]) => "<option value='" + v + "'" + (v === view.filter ? " selected" : "") + ">" + esc(l) + "</option>").join("")}</select></label>
      <button class="small primary" id="cmMd">${tr("Stáhnout protokol (MD)")}</button>
      <button class="small" id="cmCsv">${tr("Stáhnout protokol (CSV)")}</button>
      <span class="hint" style="margin:0">${tr("CSV se středníky k tisku a vyplnění v Excelu.")}</span>
    </div>
    ${phases}`);
    wireNameField(c);
    c.querySelector("#cmFilter").addEventListener("change", e => { view.filter = e.target.value; rerender(); });
    c.querySelector("#cmMd").addEventListener("click", () => downloadFile(COMMISSION_FILE_MD, commissioningMd(p, plan)));
    c.querySelector("#cmCsv").addEventListener("click", () => downloadFile(COMMISSION_FILE_CSV, commissioningCsv(p, plan)));
    c.querySelector("#cmToAppr").addEventListener("click", () => { S.step = 11; save(); render(); });
    c.querySelectorAll("details.cmphase").forEach(d => d.addEventListener("toggle", () => { view.closed[d.dataset.ph] = !d.open; }));

    const rowOf = el2 => el2.closest(".cmrow");
    const fail = (row, msg) => { view.err[row.dataset.id] = msg; const d = row.querySelector("[data-err]"); d.textContent = msg; d.hidden = false; };
    const values = row => ({ measured: row.querySelector("input[data-f=measured]").value.trim(), note: row.querySelector("input[data-f=note]").value.trim() });
    const write = (row, result) => {
      const id = row.dataset.id, by = approverName();
      delete view.err[id];
      if (!by) { fail(row, tr("Nejdřív zadej jméno.")); c.querySelector("#apName").focus(); return false; }
      const v = values(row);
      try { setCommissionResult(p, id, result, by, { note: v.note || undefined, measured: v.measured || undefined }, plan); }
      catch (err) { fail(row, String(err && err.message || err)); return false; }
      delete view.drafts[id];
      save(); rerender();
      return true;
    };
    c.querySelectorAll("button[data-res]").forEach(b => b.addEventListener("click", () => write(rowOf(b), b.dataset.res)));
    c.querySelectorAll("button[data-clear]").forEach(b => b.addEventListener("click", () => {
      const id = rowOf(b).dataset.id;
      clearCommissionResult(p, id); delete view.drafts[id]; delete view.err[id];
      save(); rerender();
    }));
    c.querySelectorAll(".cmrow input[data-f]").forEach(inp => {
      inp.addEventListener("input", () => {
        const id = rowOf(inp).dataset.id;
        (view.drafts[id] ||= {})[inp.dataset.f] = inp.value;
      });
      /* u kroku s výsledkem se naměřená hodnota / poznámka uloží hned (výsledek zůstává); bez
         překreslení — jinak by se ztratil klik na tlačítko, který změnu pole vyvolal */
      inp.addEventListener("change", () => {
        const row = rowOf(inp), id = row.dataset.id, r = p.commissioning?.[id];
        if (!r) return;
        const by = approverName();
        if (!by) { fail(row, tr("Nejdřív zadej jméno.")); return; }
        const v = values(row);
        try { setCommissionResult(p, id, r.result, by, { note: v.note || undefined, measured: v.measured || undefined }, plan); }
        catch (err) { fail(row, String(err && err.message || err)); return; }
        delete view.drafts[id];
        const nr = p.commissioning[id];
        row.querySelector(".cmwho").textContent = nr.by + ", " + fmtAt(nr.at);
        save();
      });
    });
  }

  return { rCommission };
}
