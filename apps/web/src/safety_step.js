/* PLCdesk — krok 11 Bezpečnost: nebezpečí, bezpečnostní funkce (ISO 13849-1), návrh architektury
   a výpočet PL, bezpečná vzdálenost (ISO 13855), schvalování a bezpečnostní program.
   Návrh i výpočty dělá jádro (safety.ts, safety_prog.ts, safety_docs.ts); pohled skládá
   safety_view.js (stejný pro desktop). Úpravy se ukládají do prj.safety, rozhodnutí do prj.approvals
   (approval.ts). Pravidlo: navrhovat vše, platí jen schválené — nic se neschvaluje samo. */
import { esc, tr, approve, reject, resetApproval, approveMany } from "../../../packages/core/dist/index.js";
import { card, downloadFile } from "./util.js";
import { fmtAt, statusChip, nameFieldHtml, wireNameField, approverName } from "./approval_step.js";
import { safetyView, setFnCfg, resetFnCfg, setSafetyParam, addSafetyFn, removeSafetyFn, PLS, CATS, DEFAULT_CCF } from "./safety_view.js";

const ST_CLASS = { approved: "ok", stale: "stale", rejected: "rej", missing: "wait", proposed: "wait", unverified: "wait" };

/** PL vůči PLr barevně: dosaženo zeleně, nižší červeně, neurčeno šedě. */
function plChip(pl, plr) {
  if (!plr) return "<span class='st st-wait'>" + esc(pl ? "PL " + pl : "—") + "</span>";
  if (!pl) return "<span class='st st-rej' data-pl='none'>" + tr("PL neurčeno") + "</span>";
  const ok = PLS.indexOf(pl) >= PLS.indexOf(plr);
  return "<span class='st st-" + (ok ? "ok" : "rej") + "' data-pl='" + (ok ? "ok" : "low") + "'>PL " + esc(pl) + "</span>";
}
const plrChip = plr => plr ? "<span class='st sf-plr' data-plr='" + plr + "'>PLr " + esc(plr) + "</span>" : "<span class='st st-wait'>—</span>";
const num = v => v === undefined || v === null ? "" : String(v);
const opt = (v, label, cur) => "<option value='" + esc(String(v)) + "'" + (String(cur) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>";

export function makeSafetyStep(ctx) {
  const { S, save, render } = ctx;
  /* pohled (drží se mezi překresleními): vybraná funkce, cíl náhledu programu, soubor, rozepsané poznámky */
  const view = { sel: null, target: null, file: null, notes: {}, err: {}, addKind: "guard" };
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo({ top: y }); };
  const go = i => { S.step = i; save(); render(); };

  /* řádek položky ke schválení (stav, kdo/kdy, důvody, poznámka, tlačítka) */
  function apRow(it) {
    if (!it) return "";
    const name = !!approverName();
    const note = view.notes[it.key] ?? it.rec?.note ?? "";
    const blockedA = !it.canApprove;
    const btn = (a, label, blocked, cls = "small") => "<button class='" + cls + "' data-ap='" + a + "' data-needname data-blocked='" + (blocked ? 1 : 0) + "'" + (blocked || !name ? " disabled" : "") + ">" + label + "</button>";
    return "<tr data-key='" + esc(it.key) + "' class='ap-" + ST_CLASS[it.status] + "'>" +
      "<td class='aptitle'><b>" + esc(it.title) + "</b><div class='apsum'>" + esc(it.summary) + "</div>" +
      it.blockers.map(b => "<div class='apwarn' data-blocker>⚠ " + esc(b) + "</div>").join("") +
      "<div class='errtxt' data-err" + (view.err[it.key] ? "" : " hidden") + ">" + esc(view.err[it.key] || "") + "</div></td>" +
      "<td>" + statusChip(it.status) + "</td>" +
      "<td class='apwho'>" + (it.rec ? esc(it.rec.by) + "<br><span class='hint' style='margin:0'>" + fmtAt(it.rec.at) + "</span>" : "—") + "</td>" +
      "<td class='apnote'><input type='text' data-apnote maxlength='500' value='" + esc(note) + "' placeholder='" + esc(tr("poznámka")) + "' aria-label='" + esc(tr("Poznámka")) + "'></td>" +
      "<td class='apacts'>" + btn("approve", tr("Schválit"), blockedA, "small primary") + btn("reject", tr("Zamítnout"), it.status === "rejected", "small danger") +
      (it.rec ? "<button class='small' data-ap='reset'>" + tr("Zrušit rozhodnutí") + "</button>" : "") + "</td></tr>";
  }
  const apTable = rows => "<div class='tablewrap'><table class='aptable'><thead><tr><th>" + tr("Položka") + "</th><th>" + tr("Stav") + "</th><th>" + tr("Kdo / kdy") + "</th><th>" + tr("Poznámka") + "</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div>";

  /* ------------------------------------------------------------ detail funkce */
  function detailHtml(v, f) {
    const c = f.cfg, L = v.options.fields;
    const sel = (field, pairs, cur, auto) => "<select data-cfg='" + field + "'>" + (auto !== undefined ? opt("", auto, cur ?? "") : "") + pairs.map(([k, l]) => opt(k, l, cur ?? "")).join("") + "</select>";
    const inp = (field, label, cur, ph = "") => "<label class='f'>" + esc(label) + "<input type='text' inputmode='decimal' data-cfg='" + field + "' value='" + esc(num(cur)) + "' placeholder='" + esc(ph) + "'></label>";
    const txt = (field, label, cur, ph = "") => "<label class='f'>" + esc(label) + "<input type='text' data-cfg='" + field + "' maxlength='300' value='" + esc(cur || "") + "' placeholder='" + esc(ph) + "'></label>";
    const R = v.options.risk;
    const why = f.risk.why;
    let h = "<p class='hint' style='margin-top:0'>" + esc(f.catalogName) + " · <code>" + esc(f.ref) + "</code>" + (f.user ? " · " + tr("vlastní funkce") : "") + "</p>";
    h += "<p style='font-size:.85rem;margin:6px 0'><b>" + tr("Spouští:") + "</b> " + esc(f.trigger) + "<br><b>" + tr("Reakce:") + "</b> " + esc(f.reaction) + "<br><b>" + tr("Bezpečný stav:") + "</b> " + esc(f.safeState) + "</p>";
    if (f.hazards.length) h += "<p class='hint'>" + tr("Nebezpečí: {list}", { list: esc(f.hazards.join("; ")) }) + "</p>";
    h += "<h3>" + tr("Schválení funkce a návrhu") + "</h3>" + apTable(apRow(f.fnItem) + apRow(f.designItem));

    /* riziko */
    h += "<h3>" + tr("Riziko a požadovaná úroveň (PLr)") + "</h3><div class='grid g3'>" +
      "<label class='f'>" + tr("Závažnost zranění (S)") + sel("S", R.S, c.S ?? f.risk.S) + "<span class='hint' style='margin:0'>" + esc(why.S) + "</span></label>" +
      "<label class='f'>" + tr("Četnost a doba vystavení (F)") + sel("F", R.F, c.F ?? f.risk.F) + "<span class='hint' style='margin:0'>" + esc(why.F) + "</span></label>" +
      "<label class='f'>" + tr("Možnost vyhnutí se (P)") + sel("P", R.P, c.P ?? f.risk.P) + "<span class='hint' style='margin:0'>" + esc(why.P) + "</span></label></div>" +
      "<div class='stats'><span class='stat'>" + tr("graf rizik: PLr <b>{pl}</b>", { pl: esc(f.risk.graph) }) + "</span>" +
      (f.risk.min ? "<span class='stat'>" + tr("normová spodní mez: PL <b>{pl}</b>", { pl: esc(f.risk.min.pl) }) + "</span>" : "") +
      "<span class='stat' id='sfPlr'>" + tr("PLr <b>{pl}</b>", { pl: esc(f.risk.plr || "—") }) + "</span></div>" +
      (f.risk.min ? "<p class='hint'>" + esc(f.risk.min.why) + "</p>" : "") +
      "<div class='grid g3' style='margin-top:10px'>" +
      txt("reduce", tr("Snížení PLr o 1 úroveň — zdůvodnění"), c.reduce, tr("prázdné = bez snížení")) +
      "<label class='f'>" + tr("PLr z normy typu C") + sel("plr", PLS.map(x => [x, "PL " + x]), c.plr, tr("— podle grafu rizik —")) + "</label>" +
      txt("plrSource", tr("Zdroj PLr (norma, článek)"), c.plrSource) + "</div>" +
      "<div class='row'><label style='display:flex;gap:6px;align-items:center;font-size:.85rem'><input type='checkbox' data-cfg='off'" + (f.off ? " checked" : "") + "> " + tr("Vyřadit funkci z návrhu") + "</label></div>" +
      "<div class='grid g2'>" + txt("note", tr("Poznámka / zdůvodnění vyřazení"), c.note) + "</div>";
    if (f.off) return h;

    /* reakce */
    const DIs = v.options.devs;
    h += "<h3>" + tr("Reakce a vstupy") + "</h3><div class='grid g3'>" +
      "<label class='f'>" + tr("Kategorie zastavení (IEC 60204-1)") + sel("stopCat", v.options.stop, c.stopCat ?? f.stopCat) + "<span class='hint' style='margin:0'>" + esc(f.stopWhy) + "</span></label>" +
      (f.stopCat === 1 ? inp("ss1DelayMs", L.ss1DelayMs, c.ss1DelayMs, "1000") : "") +
      inp("demandS", L.demandS, c.demandS, String(f.demandS)) + "</div>" +
      "<div class='grid g2'><label class='f'>" + tr("Vstupní zařízení (označení, oddělit čárkou)") + "<input type='text' data-cfg='inputs' value='" + esc(f.inputs.join(", ")) + "' list='sfDevs'>" +
      "<span class='hint' style='margin:0'>" + tr("Dostupné: {list}", { list: esc(DIs.map(d => d.name).join(", ") || "—") }) + "</span></label>" +
      "<div class='f'><span style='font-size:.78rem;color:var(--muted)'>" + tr("Výstupy (skupiny)") + "</span>" +
      v.groups.map(g => "<label style='display:flex;gap:6px;align-items:baseline;font-size:.82rem'><input type='checkbox' data-act='" + esc(g.id) + "'" + (f.acts.includes(g.id) ? " checked" : "") + "> <b>" + esc(g.id) + "</b> " + esc(g.label) + "</label>").join("") + "</div></div>" +
      (f.missing.length ? "<ul class='plain warnlist'>" + f.missing.map(m => "<li>" + tr("Chybí: {what}", { what: esc(m) }) + "</li>").join("") + "</ul>" : "");

    if (!f.design) return h;
    const d = f.design;
    /* architektura */
    const ccf = c.ccf || DEFAULT_CCF;
    h += "<h3>" + tr("Architektura, komponenty a výpočet PL") + "</h3><div class='grid g3'>" +
      "<label class='f'>" + tr("Kategorie") + sel("cat", CATS.map(x => [x, tr("kategorie {cat}", { cat: x })]), c.cat, tr("návrh: kategorie {cat}", { cat: d.cat || "—" })) + "</label>" +
      inp("dcIn", L.dcIn, c.dcIn, String(d.subs.find(s => s.role === "I")?.dc ?? "")) +
      inp("dcOut", L.dcOut, c.dcOut, String(d.subs.find(s => s.role === "O")?.dc ?? "")) + "</div>";
    if (f.inOpts.length || f.outOpts.length) h += "<div class='grid g2' style='margin-top:10px'>" +
      (f.inOpts.length ? "<label class='f'>" + tr("Komponenta vstupu") + sel("compIn", f.inOpts.map(o => [o.id, o.label]), c.compIn, tr("návrh: {c}", { c: f.inOpts.find(o => o.id === f.compInId)?.label || f.compInId || "—" })) + "</label>" : "<span></span>") +
      (f.outOpts.length ? "<label class='f'>" + tr("Komponenta výstupu") + sel("compOut", f.outOpts.map(o => [o.id, o.label]), c.compOut, tr("návrh: {c}", { c: f.outOpts.find(o => o.id === f.compOutId)?.label || f.compOutId || "—" })) + "</label>" : "") + "</div>";
    h += "<div class='grid g3' style='margin-top:10px'>" + inp("b10dIn", L.b10dIn, c.b10dIn) + inp("mttfdIn", L.mttfdIn, c.mttfdIn) + "<span></span>" +
      inp("b10dOut", L.b10dOut, c.b10dOut) + inp("mttfdOut", L.mttfdOut, c.mttfdOut) + "</div>" +
      "<p class='hint'>" + tr("B10d / MTTFd z datasheetu přebíjí typické hodnoty; prázdné = návrh aplikace.") + "</p>";
    h += "<details class='help'><summary>" + tr("Opatření proti CCF: {p} bodů (min. {min})", { p: d.ccf.points, min: v.options.ccfMin }) + " " + (d.ccf.ok ? "<span class='st st-ok'>✓</span>" : "<span class='st st-rej'>✗</span>") + "</summary><div class='body'>" +
      v.options.ccf.map(m => "<label style='display:flex;gap:6px;align-items:baseline;font-size:.82rem;margin:3px 0'><input type='checkbox' data-ccf='" + m.id + "'" + (ccf.includes(m.id) ? " checked" : "") + "> " + esc(m.label) + " <span class='hint' style='margin:0'>(" + m.points + ")</span></label>").join("") + "</div></details>";
    h += "<div class='tablewrap'><table><thead><tr><th>" + tr("Subsystém") + "</th><th>" + tr("Komponenta") + "</th><th>" + tr("Kat.") + "</th><th>" + tr("Kanály") + "</th><th>nop</th><th>MTTFd</th><th>DC</th><th>PL</th></tr></thead><tbody>" +
      d.subs.map(s => "<tr><td><b>" + s.role + "</b> " + esc(s.label) + (s.notes.length ? "<div class='apsum'>" + s.notes.map(esc).join("<br>") + "</div>" : "") + "</td>" +
        "<td style='font-size:.78rem'>" + esc(s.comp ? [s.comp.brand, s.comp.series].filter(Boolean).join(" ") || s.comp.label : "—") + "</td>" +
        "<td class='mono'>" + esc(s.cat || "—") + "</td><td class='mono'>" + s.channels + "</td><td class='mono'>" + esc(s.nop ?? "—") + "</td><td class='mono'>" + esc(s.mttfd ?? "—") + "</td><td class='mono'>" + s.dc + " %</td>" +
        "<td>" + plChip(s.pl, f.risk.plr) + "</td></tr>").join("") +
      "</tbody><tfoot><tr><td colspan='7'><b>" + tr("Dosažené PL funkce") + "</b> " + tr("(kategorie {cat}, {ch} kanál(y), EDM {edm})", { cat: esc(d.cat || "—"), ch: d.channels, edm: d.edm ? tr("ano") : tr("ne") }) + "</td><td>" + plChip(d.pl, f.risk.plr) + "</td></tr></tfoot></table></div>";
    if (!f.plOk && f.risk.plr) h += "<p class='errtxt' id='sfLow'>" + (d.pl ? tr("Dosažené PL {pl} < PLr {plr} — omezuje: {subs}", { pl: esc(d.pl), plr: esc(f.risk.plr), subs: esc(f.limiting.join("; ") || "—") }) : tr("Dosažené PL nelze určit — omezuje: {subs}", { subs: esc(f.limiting.join("; ") || "—") })) + "</p>";
    if (d.problems.length) h += "<ul class='plain warnlist'>" + d.problems.map(p => "<li>" + esc(p) + "</li>").join("") + "</ul>";
    if (d.wiring.length) h += "<details class='help'><summary>" + tr("Zapojení a signály ({n})", { n: d.signals.length }) + "</summary><div class='body' style='max-width:none'><ul>" + d.wiring.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>" +
      "<table><thead><tr><th>" + tr("Signál") + "</th><th>" + tr("Směr") + "</th><th>" + tr("Význam") + "</th></tr></thead><tbody>" +
      d.signals.map(s => "<tr><td class='mono'>" + esc(s.tag) + "</td><td>" + (s.dir === "in" ? tr("vstup") : tr("výstup")) + "</td><td>" + esc(s.text) + "</td></tr>").join("") + "</tbody></table></div></details>";

    /* bezpečná vzdálenost */
    if (f.distFields.length) {
      const ds = f.distance;
      h += "<h3>" + tr("Bezpečná vzdálenost (ISO 13855:{ed})", { ed: v.params.edition }) + "</h3><div class='grid g3'>" +
        f.distFields.map(k => inp(k, L[k], c[k])).join("") + "</div>";
      if (ds) {
        h += "<div class='stats'><span class='stat' id='sfDist'>" + (ds.S !== null ? tr("S = <b>{s} mm</b>", { s: ds.S }) : tr("S = <b>—</b>")) + "</span><span class='stat'>" + esc(ds.formula) + "</span>" + (ds.T !== null ? "<span class='stat'>T = " + ds.T + " s</span>" : "") + "</div>";
        if (ds.steps.length) h += "<ul class='plain'>" + ds.steps.map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>";
        if (ds.missing.length) h += "<p class='errtxt'>" + tr("Chybí: {what}", { what: esc(ds.missing.join(", ")) }) + "</p>";
        if (ds.warnings.length) h += "<ul class='plain warnlist'>" + ds.warnings.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>";
      } else if (f.kind === "guard") h += "<p class='hint'>" + tr("U krytu se vzdálenost počítá, jen když zadáš dosah skrz kryt D_GT.") + "</p>";
      h += "<p class='hint'>" + tr("Bezpečná vzdálenost se počítá jen ze ZMĚŘENÉ doby doběhu stroje (měřič doběhu, nejhorší případ).") + "</p>";
    }
    if (f.tests.length) h += "<details class='help'><summary>" + tr("Zkoušky pro validaci ({n})", { n: f.tests.length }) + "</summary><div class='body'><ul>" + f.tests.map(t => "<li><b>" + esc(t.name) + "</b> — " + esc(t.expected) + "</li>").join("") + "</ul></div></details>";
    return h;
  }

  /* ------------------------------------------------------------ krok */
  function rSafety(el) {
    const p = S.prj;
    if (!p.devices.length) { card(el, "11", tr("Bezpečnost"), "<p class='hint'>" + tr("Nejdřív navrhni zařízení (kroky 2–4).") + "</p>"); return; }
    const v = safetyView(p, { target: view.target || undefined });
    const fns = v.fns;
    if (!fns.some(f => f.ref === view.sel)) view.sel = fns[0]?.ref || null;
    const f = fns.find(x => x.ref === view.sel) || null;
    const name = !!approverName();

    const rows = fns.map(x => "<tr data-ref='" + esc(x.ref) + "' class='" + (x.ref === view.sel ? "sfsel" : "") + (x.off ? " sfoff" : "") + "' style='cursor:pointer'>" +
      "<td class='mono'><b>" + esc(x.id) + "</b></td><td>" + esc(x.title) + (x.off ? " <span class='st st-wait'>" + tr("vyřazeno") + "</span>" : "") + "</td>" +
      "<td>" + (x.off ? "—" : plrChip(x.risk.plr)) + "</td><td>" + (x.off || !x.design ? "—" : plChip(x.design.pl, x.risk.plr)) + "</td>" +
      "<td>" + (x.fnItem ? statusChip(x.fnItem.status) : "—") + "</td><td>" + (x.designItem ? statusChip(x.designItem.status) : "—") + "</td>" +
      "<td class='apwho'>" + esc([x.fnItem?.rec, x.designItem?.rec].filter(Boolean).map(r => r.by + ", " + fmtAt(r.at)).slice(-1)[0] || "—") + "</td></tr>").join("");
    const hz = v.byKey["safety:hazards"];
    const ctn = v.counts;

    const c = card(el, "11", tr("Bezpečnost"), `
    <p class="hint" style="margin-top:0;max-width:110ch">${tr("PLCdesk navrhuje bezpečnostní funkce z návrhu stroje: nebezpečí, požadovanou úroveň vlastností (PLr) z grafu rizik, architekturu, komponenty a výpočet dosaženého PL, bezpečnou vzdálenost a zkoušky pro validaci. Každou položku schvaluje odpovědná osoba; bezpečnostní program vzniká až po schválení funkcí. Platí jen schválené.")}</p>
    <div class="warnbox" id="sfCaveats"><b>${tr("Výhrady")}</b><ul class="plain">
      <li>${tr("Výpočet PL je zjednodušený (sloupcový graf ISO 13849-1, typické hodnoty komponent) — ověř v SISTEMA nebo obdobném nástroji.")}</li>
      <li>${tr("L5X GuardLogix a F-program Siemens nejsou ověřené importem a překladem v cílovém IDE.")}</li>
      <li>${tr("Validaci bezpečnostních funkcí na stroji (ISO 13849-2) provádí a podepisuje člověk; aplikace ji jen plánuje (krok Oživení, fáze 10).")}</li>
      <li>${tr("Standardní program čte E-stop a blokování jen jako stavové signály (enable, kvitace) — bezpečnostní logika patří do bezpečnostního PLC / relé.")}</li></ul></div>
    <div class="grid g2">${nameFieldHtml(tr("Jméno schvalující osoby"))}
      <div class="f" style="justify-content:end"><span class="errtxt" id="apNameWarn" style="margin:0">${tr("Bez jména nelze schvalovat ani zamítat.")}</span></div></div>
    <div class="stats">
      <span class="stat">${tr("funkcí <b>{n}</b>", { n: ctn.fns })}</span>
      ${ctn.off ? "<span class='stat'>" + tr("vyřazeno <b>{n}</b>", { n: ctn.off }) + "</span>" : ""}
      <span class="stat st-rej" id="sfLowCount">${tr("PL < PLr <b>{n}</b>", { n: ctn.low })}</span>
      <span class="stat st-ok">${tr("schváleno <b>{n}</b> z {m}", { n: ctn.approved, m: ctn.total })}</span>
      <span class="stat">${tr("logika: {l}", { l: esc(v.logic.label) })}</span>
    </div>
    ${v.warnings.length ? "<ul class='plain warnlist'>" + v.warnings.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>" : ""}
    <div class="row">
      <button class="small primary" id="sfApproveReady" data-needname data-blocked="${ctn.ready ? 0 : 1}"${ctn.ready && name ? "" : " disabled"}>${tr("Schválit vše připravené ({n})", { n: ctn.ready })}</button>
      <button class="small" id="sfToAppr">${tr("Krok Schválení")} →</button>
      <button class="small" id="sfToComm">${tr("Plán oživení (validace)")} →</button>
    </div>
    <h3>${tr("Bezpečnostní funkce")}</h3>
    ${fns.length ? "<div class='tablewrap'><table class='aptable' id='sfTable'><thead><tr><th></th><th>" + tr("Funkce") + "</th><th>PLr</th><th>" + tr("PL dosažené") + "</th><th>" + tr("Funkce (PLr)") + "</th><th>" + tr("Návrh") + "</th><th>" + tr("Kdo / kdy") + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
        : "<p class='hint'>" + tr("Projekt nemá pohony ani akční členy, které by vyžadovaly bezpečnostní funkce.") + "</p>"}
    ${hz ? "<details class='help' id='sfHaz'><summary>" + tr("Nebezpečí ({n})", { n: v.hazards.length }) + " " + statusChip(hz.status) + "</summary><div class='body' style='max-width:none'>" +
      "<table><thead><tr><th>" + tr("Nebezpečí") + "</th><th>" + tr("Zařízení") + "</th><th>" + tr("Funkce") + "</th></tr></thead><tbody>" +
      v.hazards.map(h => "<tr><td>" + esc(h.text) + "</td><td class='mono'>" + esc(h.devs.join(", ") || "—") + "</td><td class='mono'>" + (h.fns.length ? esc(h.fns.join(", ")) : "<span class='st st-rej'>" + tr("bez funkce") + "</span>") + "</td></tr>").join("") +
      "</tbody></table>" + apTable(apRow(hz)) + "</div></details>" : ""}
    <datalist id="sfDevs">${v.options.devs.map(d => "<option value='" + esc(d.name) + "'>" + esc(d.desc) + "</option>").join("")}</datalist>`);

    /* detail vybrané funkce */
    let cd = null;
    if (f) {
      cd = card(el, "·", esc(f.id + " — " + f.title), detailHtml(v, f) +
        "<div class='row'><button class='small' id='sfReset'>" + tr("Vrátit návrh aplikace") + "</button>" +
        (f.user ? "<button class='small danger' id='sfRemove'>" + tr("Odebrat funkci") + "</button>" : "") + "</div>");
      cd.id = "sfDetail";
    }

    /* vlastní funkce */
    const ca = card(el, "·", tr("Přidat vlastní bezpečnostní funkci"), "<div class='grid g3'>" +
      "<label class='f'>" + tr("Druh funkce") + "<select id='sfAddKind'>" + v.options.kinds.map(k => opt(k.id, k.label, view.addKind)).join("") + "</select></label>" +
      "<label class='f'>" + tr("Název") + "<input type='text' id='sfAddTitle' maxlength='120'></label>" +
      "<label class='f'>" + tr("Vstupní zařízení (označení, oddělit čárkou)") + "<input type='text' id='sfAddInputs' list='sfDevs'></label></div>" +
      "<div class='row'><button class='small' id='sfAdd'>" + tr("Přidat funkci") + "</button><span class='hint' style='margin:0'>" + tr("Vlastní funkce dostane návrh rizika, architektury a zkoušek podle druhu; schvaluje se jako ostatní.") + "</span></div>");

    /* nastavení výpočtu */
    const L = v.options.fields, cf = v.cfg;
    const pinp = (k, ph) => "<label class='f'>" + esc(L[k]) + "<input type='text' inputmode='decimal' data-par='" + k + "' value='" + esc(num(cf[k])) + "' placeholder='" + esc(String(ph)) + "'></label>";
    const cs = card(el, "·", tr("Nastavení výpočtu a bezpečnostní logiky"), "<div class='grid g3'>" +
      pinp("dop", v.params.dop) + pinp("hop", v.params.hop) + pinp("missionYears", v.params.missionYears) +
      "<label class='f'>" + tr("Vydání ISO 13855") + "<select data-par='iso13855'>" + opt("", tr("2010 (harmonizované, výchozí)"), cf.iso13855) + opt("2024", tr("2024 (podle volných výkladů — ověřit)"), cf.iso13855) + "</select></label>" +
      "<label class='f'>" + tr("Bezpečnostní logika") + "<select data-par='logic'>" + opt("", tr("návrh: {l}", { l: v.logic.label }), cf.logic) + v.options.logic.map(o => opt(o.id, o.label, cf.logic)).join("") + "</select></label>" +
      "<label class='f'>" + tr("Cíl bezpečnostního programu") + "<select data-par='target'>" + opt("", tr("podle logiky: {t}", { t: v.targetLabel }), cf.target) + v.options.targets.map(o => opt(o.id, o.label, cf.target)).join("") + "</select></label>" +
      "</div><p class='hint'>" + tr("Provozní dny a hodiny určují počet vyžádání za rok (nop) a z něj MTTFd komponent z B10d. Změna parametrů změní návrh — schválené položky je pak potřeba schválit znovu.") + "</p>");

    /* bezpečnostní program */
    const pr = v.program;
    const fileNames = Object.keys(pr.files);
    if (!fileNames.includes(view.file)) view.file = fileNames[0] || null;
    const stLabel = pr.state === "approved" ? "<span class='st st-ok' id='sfProgState' data-state='approved'>" + tr("SCHVÁLENO") + "</span>"
      : pr.state === "draft" ? "<span class='st st-rej' id='sfProgState' data-state='draft'>" + tr("NESCHVÁLENO — návrh") + "</span>"
        : "<span class='st st-wait' id='sfProgState' data-state='pending'>" + tr("čeká na schválení funkcí") + "</span>";
    const cp = card(el, "·", tr("Bezpečnostní program"), "<div class='row' style='margin-top:0'>" +
      "<label class='f' style='flex-direction:row;gap:8px;align-items:center'>" + tr("Cíl") + "<select id='sfTarget'>" + v.options.targets.map(o => opt(o.id, o.label + (o.id === v.target ? " ✓" : ""), pr.target)).join("") + "</select></label>" + stLabel + "</div>" +
      (pr.state !== "approved" ? "<p class='warnbox confirm'><b>" + tr("NESCHVÁLENO") + "</b> — " + (pr.state === "pending" ? tr("bezpečnostní program se generuje až po schválení nebezpečí, funkcí a jejich návrhu.") : tr("návrh programu k revizi; před nahráním do bezpečnostní logiky ho musí přezkoumat a schválit odpovědná osoba, potom validace na stroji.")) + "</p>" : "") +
      (pr.target !== v.target ? "<p class='hint'>" + tr("Náhled pro jiný cíl, než je zvolený v návrhu ({t}) — schválení programu platí jen pro zvolený cíl.", { t: esc(v.targetLabel) }) + "</p>" : "") +
      (pr.item ? apTable(apRow(pr.item)) : "") +
      (fileNames.length ? "<div class='tabs' role='tablist' style='margin-top:12px'>" + fileNames.map(n => "<button role='tab' data-file='" + esc(n) + "' aria-selected='" + (n === view.file) + "'>" + esc(n) + "</button>").join("") + "</div>" +
        "<div class='codebox'><pre class='code' id='sfProgText'>" + esc(pr.files[view.file] || "") + "</pre></div>" +
        "<div class='row'><button class='small primary' id='sfDlFile'>" + tr("Stáhnout {file}", { file: esc(view.file) }) + "</button></div>"
        : "<p class='hint'>" + tr("Žádná funkce nemá blok v bezpečnostním programu.") + "</p>"));

    /* výkres */
    let cw = null;
    if (v.sheet) {
      cw = card(el, "·", tr("Výkres bezpečnostního okruhu"), "<div class='tablewrap'><figure style='margin:0' id='sfSheet'>" + v.sheet.svg + "</figure></div>" +
        "<p class='hint'>" + tr("Návrh k revizi — platí jen po schválení bezpečnostních funkcí; svorky podle návodu zvolené logiky.") + "</p>" +
        "<div class='row'><button class='small' id='sfDlSvg'>" + tr("Stáhnout SVG") + "</button><button class='small' id='sfDlDxf'>" + tr("Stáhnout DXF") + "</button></div>");
    }

    /* ---------------------------------------------- události */
    c.querySelector("#sfToAppr").addEventListener("click", () => go(11));
    c.querySelector("#sfToComm").addEventListener("click", () => go(12));
    c.querySelectorAll("#sfTable tbody tr").forEach(r => r.addEventListener("click", () => { view.sel = r.dataset.ref; rerender(); }));
    c.querySelector("#sfApproveReady").addEventListener("click", () => {
      const by = approverName();
      const keys = v.items.filter(i => i.canApprove).map(i => i.key);
      if (!by || !keys.length) return;
      if (!window.confirm(tr("Schválit {n} položek jménem {name}? Každá dostane vlastní záznam se svým otiskem a dnešním datem; nic dalšího se neschválí.", { n: keys.length, name: by }))) return;
      const r = approveMany(p, keys, by);
      S.notice = { step: S.step, level: r.skipped.length ? "warn" : "ok", text: tr("Schváleno položek: {n}", { n: r.approved.length }) + (r.skipped.length ? " · " + tr("přeskočeno: {n}", { n: r.skipped.length }) : "") };
      save(); rerender();
    });
    /* schvalování v kterékoli kartě */
    wireNameField(el);              // jméno v hlavní kartě přepíná tlačítka ve všech kartách kroku
    for (const root of [c, cd, cp].filter(Boolean)) {
      root.querySelectorAll("input[data-apnote]").forEach(inp => inp.addEventListener("input", () => { view.notes[inp.closest("tr").dataset.key] = inp.value; }));
      root.addEventListener("click", e => {
        const b = e.target.closest("button[data-ap]");
        if (!b || b.disabled) return;
        const row = b.closest("tr"), key = row.dataset.key, a = b.dataset.ap;
        const note = (row.querySelector("input[data-apnote]").value || "").trim();
        const fail = msg => { view.err[key] = msg; const d = row.querySelector("[data-err]"); d.textContent = msg; d.hidden = false; };
        delete view.err[key];
        try {
          if (a === "reset") resetApproval(p, key);
          else {
            const by = approverName();
            if (!by) { fail(tr("Nejdřív zadej jméno schvalující osoby.")); return; }
            if (a === "reject" && !note) { fail(tr("Při zamítnutí uveď důvod do poznámky.")); return; }
            if (a === "approve") approve(p, key, by, note || undefined); else reject(p, key, by, note);
          }
          delete view.notes[key];
        } catch (err) { fail(String(err && err.message || err)); return; }
        save(); rerender();
      });
    }
    /* úpravy funkce */
    if (cd) {
      const ref = f.ref;
      const edit = patch => { setFnCfg(p, ref, patch); save(); rerender(); };
      cd.querySelectorAll("[data-cfg]").forEach(inp => inp.addEventListener("change", () => {
        const k = inp.dataset.cfg;
        edit({ [k]: inp.type === "checkbox" ? inp.checked : inp.value });
      }));
      cd.querySelectorAll("[data-act]").forEach(cb => cb.addEventListener("change", () => {
        edit({ acts: [...cd.querySelectorAll("[data-act]")].filter(x => x.checked).map(x => x.dataset.act) });
      }));
      cd.querySelectorAll("[data-ccf]").forEach(cb => cb.addEventListener("change", () => {
        edit({ ccf: [...cd.querySelectorAll("[data-ccf]")].filter(x => x.checked).map(x => x.dataset.ccf) });
      }));
      cd.querySelector("#sfReset").addEventListener("click", () => { resetFnCfg(p, ref); save(); rerender(); });
      const rm = cd.querySelector("#sfRemove");
      if (rm) rm.addEventListener("click", () => {
        if (!window.confirm(tr("Odebrat vlastní funkci {sf}?", { sf: f.id }))) return;
        removeSafetyFn(p, ref); view.sel = null; save(); rerender();
      });
    }
    ca.querySelector("#sfAddKind").addEventListener("change", e => { view.addKind = e.target.value; });
    ca.querySelector("#sfAdd").addEventListener("click", () => {
      const ref = addSafetyFn(p, { kind: ca.querySelector("#sfAddKind").value, title: ca.querySelector("#sfAddTitle").value, inputs: ca.querySelector("#sfAddInputs").value });
      view.sel = ref; save(); rerender();
    });
    cs.querySelectorAll("[data-par]").forEach(inp => inp.addEventListener("change", () => { setSafetyParam(p, inp.dataset.par, inp.value); save(); rerender(); }));
    cp.querySelector("#sfTarget").addEventListener("change", e => { view.target = e.target.value === v.target ? null : e.target.value; view.file = null; rerender(); });
    cp.querySelectorAll("[data-file]").forEach(b => b.addEventListener("click", () => { view.file = b.dataset.file; rerender(); }));
    const dl = cp.querySelector("#sfDlFile");
    if (dl) dl.addEventListener("click", () => downloadFile("safety_" + view.file, pr.files[view.file]));
    if (cw) {
      cw.querySelector("#sfDlSvg").addEventListener("click", () => downloadFile("00_bezpecnostni_okruh.svg", v.sheet.svg));
      cw.querySelector("#sfDlDxf").addEventListener("click", () => downloadFile("00_bezpecnostni_okruh.dxf", v.sheet.dxf));
    }
  }

  return { rSafety };
}
