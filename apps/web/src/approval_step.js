/* PLCdesk — krok 12 Schválení: položky návrhu ke schválení, návrhy ladění, export 11_schvaleni.md.
   Logika (položky, otisky, stavy, návrhy ladění) je celá v jádře (approval.ts) — tady jen pohled
   a zápis rozhodnutí. Pravidlo: navrhovat vše, platí jen schválené; nic se neschvaluje samo. */
import {
  escHtml as esc, tr, syncIO, approvalItems, approvalStatus, approvalStatusLabel, approve, reject, resetApproval,
  approvalSummary, approvalOrphans, tuningProposals, applyTuningResult, approveMany, approvalsMd, APPROVAL_GROUPS, APPROVAL_FILE,
  APPROVAL_FILTERS, approvalFilterLabel, approvalFilterPass, commissioningSummary,
} from "../../../packages/core/dist/index.js";
import { card, downloadFile } from "./util.js";
import { revisionAffected } from "./biz_view.js";

/* ---------------------------------------------------------------- společné (i pro Bezpečnost a Oživení) */

const NAME_KEY = "plcstudio.approver";
/** Jméno odpovědné osoby — zadá se jednou, pamatuje se v prohlížeči. */
export function approverName() {
  try { return (localStorage.getItem(NAME_KEY) || "").trim(); } catch { return ""; }
}
export function setApproverName(v) {
  try { if (v) localStorage.setItem(NAME_KEY, v); else localStorage.removeItem(NAME_KEY); } catch { /* bez úložiště */ }
}
/* Jména schvalovatelů z firemní knihovny projektu (app.js nastaví zdroj — biz_view.approverNames). */
let approverSource = () => [];
export function setApproverSource(fn) { approverSource = typeof fn === "function" ? fn : () => []; }
/** Pole se jménem (stejná hodnota ve Schválení i Oživení); s knihovnou i výběr schvalovatele. */
export function nameFieldHtml(label) {
  let names = [];
  try { names = approverSource() || []; } catch { names = []; }
  const cur = approverName();
  const pick = names.length ? "<select id='apPick' aria-label='" + esc(tr("Schvalovatel z firemní knihovny")) + "' title='" + esc(tr("Schvalovatel z firemní knihovny")) + "'><option value=''>" + esc(tr("— z knihovny —")) + "</option>" +
    names.map(n => "<option" + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>").join("") + "</select>" : "";
  return "<label class='f apname'>" + label + "<span class='apnamerow'><input type='text' id='apName' autocomplete='name' maxlength='80' value='" + esc(cur) + "' placeholder='" + esc(tr("jméno a příjmení")) + "'>" + pick + "</span></label>";
}
/**
 * Připojí pole se jménem: uloží ho a přepne tlačítka, která jméno potřebují
 * (`data-needname`; `data-blocked` = zakázané z jiného důvodu), bez překreslení.
 */
export function wireNameField(root) {
  const inp = root.querySelector("#apName");
  const sync = () => {
    const has = !!approverName();
    root.querySelectorAll("[data-needname]").forEach(b => { b.disabled = !has || b.dataset.blocked === "1"; });
    const w = root.querySelector("#apNameWarn");
    if (w) w.hidden = has;
  };
  inp.addEventListener("input", () => { setApproverName(inp.value.trim()); sync(); });
  const pick = root.querySelector("#apPick");
  if (pick) pick.addEventListener("change", () => { if (!pick.value) return; inp.value = pick.value; setApproverName(pick.value); sync(); });
  sync();
}
/** Okamžik záznamu v místním čase (YYYY-MM-DD HH:MM) — nezávislé na jazyku. */
export function fmtAt(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return esc(String(iso || "").slice(0, 16));
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
}
const ST_CLASS = { approved: "ok", stale: "stale", rejected: "rej", missing: "wait", proposed: "wait", unverified: "wait" };
/** Barevný štítek stavu položky (schváleno zeleně, změněno oranžově, zamítnuto červeně, čeká šedě). */
export function statusChip(st) {
  return "<span class='st st-" + ST_CLASS[st] + "' data-st='" + st + "'>" + esc(approvalStatusLabel(st)) + "</span>";
}

/* Odznak v hlavičce: souhrn se počítá jen při změně projektu (ověření simulací je drahé). */
let badgeKey = "", badgeSum = null;
/**
 * Souhrn pro odznak. `compute: false` = nepočítat znovu (velký projekt mimo kroky, které ověření
 * stejně potřebují) — vrátí poslední známý souhrn s `old: true`, nebo null.
 */
export function approvalBadge(prj, compute = true) {
  syncIO(prj);
  const key = JSON.stringify(prj);
  if (key === badgeKey && badgeSum) return badgeSum;
  /* bez výpočtu: levný souhrn — ověření simulací se nespouští, položky na něm závislé jsou
     „čeká na ověření“ a počet je jen dolní odhad (`old` → „?“) */
  if (!compute) { const items = approvalItems(prj, { cheap: true }), s = approvalSummary(prj, items); return badgeOf(prj, items, { ...s, old: s.partial }, key); }
  const items = approvalItems(prj);
  badgeSum = badgeOf(prj, items, approvalSummary(prj, items), key); badgeKey = key;
  return badgeSum;
}
/**
 * Souhrn odznaku + značky hotových kroků 11–13 (jako desktop „approval.badge“): bezpečnost = všechny
 * položky bezpečnosti schválené, schválení = povinné schválené, oživení = všechny kroky OK / N/A.
 * `key` = projekt, ke kterému souhrn patří (značky v liště kroků jen pro aktuální projekt).
 */
function badgeOf(prj, items, sum, key) {
  const safety = items.filter(i => i.group === "safety");
  return { ...sum, key,
    safetyOk: safety.length > 0 && safety.every(i => approvalStatus(prj, i) === "approved"),
    commissionDone: sum.partial ? null : commissioningSummary(prj).done };
}
function noteSummary(prj, items, sum) { badgeKey = JSON.stringify(prj); badgeSum = badgeOf(prj, items, sum, badgeKey); return badgeSum; }

/* ---------------------------------------------------------------- krok 12 */

export function makeApprovalStep(ctx) {
  const { S, save, render } = ctx;
  /* pohled (drží se mezi překresleními): filtr, otevřené skupiny, počet zobrazených návrhů ladění, rozepsané poznámky */
  const view = { filter: "all", open: {}, more: 50, notes: {}, err: {}, pick: new Set(), rev: { id: "", invalid: new Set() } };
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo({ top: y }); };
  /* filtry a jejich pravidlo z jádra (approval.ts) — stejně jako desktop */
  const FILTERS = () => APPROVAL_FILTERS.map(f => [f, approvalFilterLabel(f)]);
  const pass = st => approvalFilterPass(st, view.filter);

  function row(p, it, st, tuning) {
    const rec = p.approvals?.[it.key];
    const name = !!approverName();
    const note = view.notes[it.key] ?? rec?.note ?? "";
    const blockedA = it.ready === false || st === "approved";
    const blockedR = st === "rejected";
    const btn = (a, label, blocked, cls = "small") => "<button class='" + cls + "' data-a='" + a + "' data-needname data-blocked='" + (blocked ? 1 : 0) + "'" + (blocked || !name ? " disabled" : "") + ">" + label + "</button>";
    const pickable = st !== "approved" && it.ready !== false;
    const revChg = view.rev.invalid.has(it.key);
    return "<tr data-key='" + esc(it.key) + "' class='ap-" + ST_CLASS[st] + (revChg ? " ap-revchg" : "") + "'>" +
      "<td><input type='checkbox' data-pick aria-label='" + esc(tr("vybrat")) + "'" + (pickable ? "" : " disabled") + (pickable && view.pick.has(it.key) ? " checked" : "") + "></td>" +
      "<td class='aptitle'><b>" + esc(it.title) + "</b>" + (it.required ? "" : " <span class='hint' style='margin:0'>(" + tr("nepovinná") + ")</span>") +
      (revChg ? " <span class='st st-stale revchip' title='" + esc(tr("Při vydání revize {rev} byla položka platně schválená; změna od revize ji zneplatňuje (nebo může zneplatnit) — znovu posoudit a schválit.", { rev: view.rev.id })) + "'>" + esc(tr("dotčeno změnou od revize {rev}", { rev: view.rev.id })) + "</span>" : "") +
      "<div class='apsum'>" + esc(it.summary) + "</div>" +
      (it.ready === false ? "<div class='apwarn'>" + esc(it.notReady || tr("Položku zatím nelze schválit.")) + "</div>" : "") +
      "<div class='errtxt' data-err" + (view.err[it.key] ? "" : " hidden") + ">" + esc(view.err[it.key] || "") + "</div></td>" +
      "<td>" + statusChip(st) + "</td>" +
      "<td class='apwho'>" + (rec ? esc(rec.by) + "<br><span class='hint' style='margin:0'>" + fmtAt(rec.at) + "</span>" : "—") + "</td>" +
      "<td class='apnote'><input type='text' data-note maxlength='500' value='" + esc(note) + "' placeholder='" + esc(tr("poznámka")) + "' aria-label='" + esc(tr("Poznámka")) + "'></td>" +
      "<td class='apacts'>" + btn("approve", tr("Schválit"), blockedA, "small primary") + btn("reject", tr("Zamítnout"), blockedR, "small danger") +
      (rec ? "<button class='small' data-a='reset'>" + tr("Zrušit rozhodnutí") + "</button>" : "") +
      (tuning && tuning.apply ? "<button class='small' data-a='apply' data-id='" + esc(tuning.id) + "' title='" + esc(tr("Uplatní návrh v projektu — nic se tím neschvaluje.")) + "'>" + tr("Použít") + "</button>" : "") +
      "</td></tr>";
  }

  function rApproval(el) {
    const p = S.prj;
    syncIO(p);
    const items = approvalItems(p);
    const sum = approvalSummary(p, items);
    const badge = noteSummary(p, items, sum);
    if (ctx.showBadge) ctx.showBadge(badge);
    const status = new Map(items.map(i => [i.key, approvalStatus(p, i)]));
    const tun = new Map(tuningProposals(p).map(t => [t.approvalKey, t]));
    const orphans = approvalOrphans(p, items);
    /* položky dotčené změnou od poslední revize (revision.ts) — zvýraznit */
    let aff = { rev: "", invalid: [] };
    try { aff = revisionAffected(p, items); } catch (e) { console.warn("revision affected:", e); }
    view.rev = { id: aff.rev, invalid: new Set(aff.invalid) };

    const stat = (label, n, cls) => "<span class='stat st-" + cls + "'>" + esc(label) + " <b>" + n + "</b></span>";
    let blockHtml;
    if (sum.ok) blockHtml = "<p class='oktxt'>" + tr("Všechny povinné položky jsou schválené.") + " ✓</p>";
    else {
      const b = sum.blocking;
      blockHtml = "<div class='warnbox'><b>" + tr("Povinné položky bez platného schválení ({n})", { n: b.length }) + "</b><ul class='plain'>" +
        b.slice(0, 8).map(it => "<li>" + esc(it.title) + " — " + esc(approvalStatusLabel(status.get(it.key))) + "</li>").join("") +
        (b.length > 8 ? "<li>" + tr("… a dalších {n}", { n: b.length - 8 }) + "</li>" : "") + "</ul></div>";
    }

    let groupsHtml = "";
    for (const g of Object.keys(APPROVAL_GROUPS)) {
      const its = items.filter(i => i.group === g);
      if (!its.length) continue;
      const shown = its.filter(i => pass(status.get(i.key)));
      const nOk = its.filter(i => status.get(i.key) === "approved").length;
      const open = view.open[g] ?? its.length <= 60;
      const lim = g === "tuning" ? view.more : Infinity;
      const rows = shown.slice(0, lim).map(it => row(p, it, status.get(it.key), tun.get(it.key))).join("");
      const toDo = its.filter(i => status.get(i.key) !== "approved" && i.ready !== false).length;
      const head = "<thead><tr><th></th><th>" + tr("Položka") + "</th><th>" + tr("Stav") + "</th><th>" + tr("Kdo / kdy") + "</th><th>" + tr("Poznámka") + "</th><th></th></tr></thead>";
      groupsHtml += "<details class='help apgroup' data-g='" + g + "'" + (open ? " open" : "") + "><summary>" + esc(tr(APPROVAL_GROUPS[g])) +
        " <span class='hint' style='margin:0'>" + tr("{ok} z {n} schváleno", { ok: nOk, n: its.length }) + "</span></summary><div class='body apbody'>" +
        (g === "tuning" ? "<p class='hint' style='margin-top:0'>" + tr("Návrhy úprav z ověření simulací a kontroly konceptu. „Použít“ změnu provede v projektu, ale nic neschvaluje — dotčené položky je potom potřeba schválit znovu. Návrh, se kterým souhlasíš bez úpravy projektu, schval; nesouhlas zamítni s důvodem.") + "</p>" : "") +
        (toDo ? "<div class='row'><button class='small' data-group='" + g + "' data-needname" + (approverName() ? "" : " disabled") + ">" + tr("Schválit celou skupinu ({n})", { n: toDo }) + "</button></div>" : "") +
        (shown.length ? "<div class='tablewrap'><table class='aptable'>" + head + "<tbody>" + rows + "</tbody></table></div>"
          : "<p class='hint'>" + tr("Ve skupině není žádná položka odpovídající filtru.") + "</p>") +
        (shown.length > lim ? "<div class='row'><button class='small' data-more>" + tr("Zobrazit dalších {n}", { n: Math.min(50, shown.length - lim) }) + "</button><span class='hint' style='margin:0'>" + tr("zobrazeno {n} z {m}", { n: lim, m: shown.length }) + "</span></div>" : "") +
        "</div></details>";
    }

    const orphHtml = orphans.length ? "<h3>" + tr("Záznamy schválení bez položky (položka zrušena nebo návrh uplatněn)") + "</h3><ul class='plain' id='apOrphans'>" +
      orphans.map(k => { const r = p.approvals[k]; return "<li data-orphan='" + esc(k) + "'><code>" + esc(k) + "</code> — " + esc(approvalStatusLabel(r.state)) + ", " + esc(r.by) + ", " + fmtAt(r.at) + " <button class='small danger' data-a='orphan'>" + tr("Smazat záznam") + "</button></li>"; }).join("") +
      "</ul>" + (orphans.length > 1 ? "<div class='row'><button class='small danger' id='apOrphAll'>" + tr("Smazat všechny záznamy bez položky") + "</button></div>" : "") : "";

    const c = card(el, "12", tr("Schválení návrhu"), `
    <p class="hint" style="margin-top:0;max-width:110ch">${tr("PLCdesk navrhuje, odpovědná osoba schvaluje. Každá položka se schvaluje jménem, datem a poznámkou a schválení platí pro obsah v okamžiku schválení (otisk). Když se obsah položky změní, stav se změní na „změněno po schválení“ a položku je potřeba schválit znovu. Nic se neschvaluje automaticky.")}</p>
    <div class="grid g2">
      ${nameFieldHtml(tr("Jméno schvalující osoby"))}
      <div class="f" style="justify-content:end"><span class="hint" style="margin:0">${tr("Jméno se pamatuje v tomto prohlížeči a zapíše se ke každému rozhodnutí.")}</span>
        <span class="errtxt" id="apNameWarn" style="margin:0">${tr("Bez jména nelze schvalovat ani zamítat.")}</span></div>
    </div>
    <div class="stats">${stat(approvalStatusLabel("approved"), sum.approved, "ok")}${stat(approvalStatusLabel("stale"), sum.stale, "stale")}${stat(approvalStatusLabel("rejected"), sum.rejected, "rej")}${stat(approvalStatusLabel("proposed"), sum.pending, "wait")}<span class="stat">${tr("celkem <b>{n}</b>", { n: sum.total })}</span></div>
    ${blockHtml}
    ${view.rev.invalid.size ? "<p class='warnbox' id='apRevNote'>" + tr("Změna od revize {rev} se dotýká {n} položek, které byly při vydání revize platně schválené — jsou označené „dotčeno změnou od revize“. Přehled změn a rozsah opakovaných zkoušek je v kroku Projekt.", { rev: esc(view.rev.id), n: view.rev.invalid.size }) + "</p>" : ""}
    <div class="row">
      <label class="f" style="flex-direction:row;gap:8px;align-items:center">${tr("Zobrazit")}
        <select id="apFilter">${FILTERS().map(([v, l]) => "<option value='" + v + "'" + (v === view.filter ? " selected" : "") + ">" + esc(l) + "</option>").join("")}</select></label>
      <button class="small" id="apPicked" data-needname data-blocked="${view.pick.size ? 0 : 1}"${view.pick.size && approverName() ? "" : " disabled"}>${tr("Schválit vybrané ({n})", { n: view.pick.size })}</button>
      <button class="small primary" id="apExport">${tr("Stáhnout {file}", { file: APPROVAL_FILE })}</button>
      <span class="hint" style="margin:0">${tr("Zamítnutí vyžaduje důvod v poznámce. Poznámka se uloží se schválením i zamítnutím.")}</span>
    </div>
    ${groupsHtml}
    ${orphHtml}`);
    wireNameField(c);
    c.querySelector("#apFilter").addEventListener("change", e => { view.filter = e.target.value; view.more = 50; rerender(); });
    c.querySelector("#apExport").addEventListener("click", () => downloadFile(APPROVAL_FILE, approvalsMd(p, items)));
    c.querySelectorAll("details.apgroup").forEach(d => d.addEventListener("toggle", () => { view.open[d.dataset.g] = d.open; }));
    c.querySelectorAll("[data-more]").forEach(b => b.addEventListener("click", () => { view.more += 50; rerender(); }));
    c.querySelectorAll("input[data-note]").forEach(inp => inp.addEventListener("input", () => {
      view.notes[inp.closest("tr").dataset.key] = inp.value;
    }));
    /* hromadné schválení: výslovná akce nad vybranými položkami / skupinou, s potvrzením */
    const bulk = keys => {
      const by = approverName();
      if (!by || !keys.length) return;
      if (!window.confirm(tr("Schválit {n} položek jménem {name}? Každá dostane vlastní záznam se svým otiskem a dnešním datem; nic dalšího se neschválí.", { n: keys.length, name: by }))) return;
      const note = "";
      const r = approveMany(p, keys, by, note || undefined);
      view.pick.clear();
      S.notice = { step: S.step, level: r.skipped.length ? "warn" : "ok",
        text: tr("Schváleno položek: {n}", { n: r.approved.length }) + (r.skipped.length ? " · " + tr("přeskočeno: {n}", { n: r.skipped.length }) : "") };
      save(); rerender();
    };
    c.querySelectorAll("input[data-pick]").forEach(cb => cb.addEventListener("change", () => {
      const k = cb.closest("tr").dataset.key;
      if (cb.checked) view.pick.add(k); else view.pick.delete(k);
      const b = c.querySelector("#apPicked");
      b.textContent = tr("Schválit vybrané ({n})", { n: view.pick.size });
      b.dataset.blocked = view.pick.size ? "0" : "1";
      b.disabled = !view.pick.size || !approverName();
    }));
    c.querySelector("#apPicked").addEventListener("click", () => bulk([...view.pick].filter(k => status.get(k) && status.get(k) !== "approved")));
    c.querySelectorAll("button[data-group]").forEach(b => b.addEventListener("click", () =>
      bulk(items.filter(i => i.group === b.dataset.group && status.get(i.key) !== "approved" && i.ready !== false).map(i => i.key))));
    const all = c.querySelector("#apOrphAll");
    if (all) all.addEventListener("click", () => { for (const k of orphans) resetApproval(p, k); save(); rerender(); });

    c.addEventListener("click", e => {
      const b = e.target.closest("button[data-a]");
      if (!b || b.disabled) return;
      const a = b.dataset.a;
      if (a === "orphan") { resetApproval(p, b.closest("li").dataset.orphan); save(); rerender(); return; }
      const tr_ = b.closest("tr"), key = tr_.dataset.key;
      const note = (tr_.querySelector("input[data-note]").value || "").trim();
      const fail = msg => { view.err[key] = msg; const d = tr_.querySelector("[data-err]"); d.textContent = msg; d.hidden = false; };
      delete view.err[key];
      S.notice = null;
      try {
        if (a === "approve" || a === "reject") {
          const by = approverName();
          if (!by) { fail(tr("Nejdřív zadej jméno schvalující osoby.")); c.querySelector("#apName").focus(); return; }
          if (a === "reject" && !note) { fail(tr("Při zamítnutí uveď důvod do poznámky.")); tr_.querySelector("input[data-note]").focus(); return; }
          if (a === "approve") approve(p, key, by, note || undefined); else reject(p, key, by, note);
          delete view.notes[key];
        } else if (a === "reset") {
          resetApproval(p, key);
          delete view.notes[key];
        } else if (a === "apply") {
          applyProposal(p, items, b.dataset.id);
          return;
        }
      } catch (err) { fail(String(err && err.message || err)); return; }
      save(); rerender();
    });
  }

  /** Uplatní návrh ladění: nový projekt, zpráva co se změnilo. Nic se neschvaluje. */
  function applyProposal(p, before, id) {
    const titles = new Map(before.map(i => [i.key, i.title]));
    let r;
    try { r = applyTuningResult(p, id); } catch { return; }
    const np = r.prj;
    S.prj = np;
    syncIO(np);
    /* seznam změn dává jádro (návrh ví, co mění) — bez přepočtu otisků */
    const val = v => v === null || v === undefined ? "—" : String(v);
    const what = r.changes.map(ch => ch.note + ": " + val(ch.before) + " → " + val(ch.after)).join("; ");
    const was = k => p.approvals?.[k]?.state === "approved";
    const list = r.affects.filter(k => titles.has(k)).map(k => titles.get(k) + (was(k) ? " (" + approvalStatusLabel("stale") + ")" : "")).join(", ");
    S.notice = {
      step: S.step, level: r.affects.some(was) ? "warn" : "ok",
      text: tr("Použit návrh: {title}.", { title: r.title }) + (what ? " " + what + "." : "") + " " +
        (list ? tr("Změněné položky: {list}.", { list }) : tr("Obsah schvalovaných položek se nezměnil.")) + " " +
        tr("Nic se tím neschválilo — změněné položky zkontroluj a schval."),
    };
    save(); rerender();
  }

  return { rApproval };
}
