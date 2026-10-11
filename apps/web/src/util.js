/* Drobné UI utility. */
import {
  tr, N_, normalizeProject, projectTitle,
  withFilePrefix, prefixProjectFiles, projectBundle, projectZip, nextProjectNumber, PREFIX_EXEMPT,
} from "../../../packages/core/dist/index.js";
import { aiNorm } from "./ai.js";
import { normSafety } from "./safety_view.js";
import { normBiz } from "./biz_view.js";
import { licenseFilter, currentProject, gateFor, explainBulkBlocked, licenseReason } from "./license.js";
import { trn } from "./plural.js";

/** Vlastní klíč tabulky (ne „toString“ / „constructor“ z prototypu — cizí JSON by s ním prošel přes `in`). */
export const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
/**
 * Projekt z načteného JSON (import / localStorage) v bezpečném tvaru: model normalizuje jádro
 * (`normalizeProject`, project_norm.ts — stejné pravidlo jako desktop: typově ověří každou hodnotu,
 * vadné položky zahodí, jednořádková pole vyčistí); tady jen bezpečnostní data a revize / nabídka /
 * knihovna (`normSafety`, `normBiz`). Nejde-li o projekt, vyhodí chybu.
 */
export function normProject(raw) {
  const p = normalizeProject(raw);
  const sf = normSafety(raw.safety);
  if (sf) p.safety = sf;
  normBiz(raw, p);
  return p;
}

export const $ = (id) => document.getElementById(id);

/** Záhlaví stránky a titulek karty prohlížeče: „číslo · název · zákazník“ (jen vyplněné části). */
export function setProjectHeader(prj) {
  const t = projectTitle(prj);
  const el = $("projName");
  if (el) { el.textContent = t ? "— " + t : ""; el.title = t; }
  document.title = t ? "PLCdesk — " + t : "PLCdesk";
}

/** AI konverzace z úložiště / importu v bezpečném tvaru. */
export function normAi(a) {
  const ok = a && typeof a === "object" && Array.isArray(a.turns);
  return ok ? { turns: a.turns.filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string"), last: a.last && typeof a.last === "object" && Array.isArray(a.last.devices) ? aiNorm(a.last) : null, draft: String(a.draft || "") }
    : { turns: [], last: null, draft: "" };
}

/* ---------------------------------------------------------------- dlouhé seznamy
   Velký projekt (stovky zařízení) má tisíce řádků svorkovnice, kusovníku a kroků oživení — vykreslit
   je najednou blokuje hlavní vlákno přes sekundu (forenzní test 2026-10-10, N5). Vykreslí se prvních
   PAGE řádků a zbytek na tlačítko; počet zobrazených drží `pageLimit` pro klíč seznamu (přežije překreslení). */
export const PAGE = 100;
const pageLimits = new Map();
/** Kolik řádků seznamu `key` vykreslit; `need` = index řádku, který musí být vidět (odkaz, zvýraznění). */
export function pageLimit(key, need = -1, page = PAGE) {
  let n = pageLimits.get(key) || page;
  if (need >= n) { n = Math.ceil((need + 1) / page) * page; pageLimits.set(key, n); }
  return n;
}
/** Tlačítka pod zkráceným seznamem („Zobrazit dalších N“, „Zobrazit vše“) + počet; prázdné, když je vidět vše. */
export function moreHtml(key, shown, total, page = PAGE) {
  if (shown >= total) return "";
  return "<div class='row'><button class='small' data-more-key='" + escAttr(key) + "' data-more-step='" + page + "'>" + tr("Zobrazit dalších {n}", { n: Math.min(page, total - shown) }) + "</button>"
    + "<button class='small' data-more-key='" + escAttr(key) + "' data-more-step='all'>" + tr("Zobrazit vše ({n})", { n: total }) + "</button>"
    + "<span class='hint' style='margin:0'>" + tr("zobrazeno {n} z {m}", { n: shown, m: total }) + "</span></div>";
}
/** Napojí tlačítka `moreHtml` v `root`; po kliknutí `rerender()` (vykreslí se s novým limitem). */
export function wireMore(root, rerender, page = PAGE) {
  root.querySelectorAll("[data-more-key]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.moreKey;
    pageLimits.set(k, b.dataset.moreStep === "all" ? Infinity : (pageLimits.get(k) || page) + page);
    rerender();
  }));
}
const escAttr = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function card(el, num, title, inner) {
  const c = document.createElement("section");
  c.className = "card";
  c.innerHTML = '<h2><span class="n">' + num + "</span>" + title + "</h2>" + inner;
  el.appendChild(c);
  return c;
}

export function copyText(txt, btn) {
  const done = () => {
    if (!btn) return;
    const t = btn.textContent;
    btn.textContent = tr("Zkopírováno");
    setTimeout(() => (btn.textContent = t), 1500);
  };
  try { navigator.clipboard.writeText(txt).then(done).catch(() => {}); } catch { /* bez clipboardu */ }
}

const MIME = {
  svg: "image/svg+xml", dxf: "application/dxf", csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8", xml: "application/xml", json: "application/json",
};
/** Jméno staženého souboru s předponou čísla projektu „<číslo>_“ (core withFilePrefix; bez čísla beze změny). */
export function prefixedName(name) {
  const prj = currentProject();
  return prj && !PREFIX_EXEMPT.test(name) ? withFilePrefix(prj, name) : name;   // objekty TwinCAT bez předpony
}
/** Stažení souboru přes bránu licence (license.js): ve Free s patičkou, zamčené = okno s vysvětlením a false.
 *  Jméno dostane předponu čísla projektu (stejně jako v projektové složce). */
export function downloadFile(name, body, quiet = false) {
  body = licenseFilter(name, body, quiet);
  if (body == null) return false;
  name = prefixedName(name);
  const ext = (name.split(".").pop() || "").toLowerCase();
  const blob = new Blob([body], { type: MIME[ext] || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
/** Binární soubor ke stažení BEZ licenční brány — jen pro obsah, který není výstupem projektu
 *  uživatele (balík k ověření s pevnými vzory). Výstupy projektu jdou přes downloadFile / downloadBytes. */
export function saveBytesUngated(name, bytes, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/** Víc souborů po sobě: prohlížeč zahazuje stahování spuštěná v jednom okamžiku (ověřeno: z 28 jich došlo 9).
 *  Předpona čísla projektu jako v projektové složce (core prefixProjectFiles: odkazy v README a dokumentech
 *  přepsané na nová jména, kód PLC beze změny, objekty TwinCAT bez předpony). */
export async function downloadFiles(list, btn) {
  if (btn) btn.disabled = true;
  try {
    const num = (currentProject()?.meta?.number || "").trim();
    if (num) list = prefixProjectFiles(list.map(([path, body]) => ({ path, body })), num).map(f => [f.path, f.body]);
    /* licence: zamčené soubory (DXF ve Free, vše nad limitem) se přeskočí a okno s důvodem ukáže jednou */
    const ok = list.filter(([name, body]) => licenseFilter(name, body, true) != null);
    if (ok.length < list.length) {
      const [bn, bb] = list.find(f => !ok.includes(f));
      if (!ok.length) { licenseFilter(bn, bb); return; }     // nic nejde stáhnout → okno s důvodem vždy
      bulkBlockedNote(btn, list.length - ok.length, licenseReason(bn, bb), N_("{n} soubor se nestáhl podle licence — podrobnosti v okně Licence v hlavičce.|{n} soubory se nestáhly podle licence — podrobnosti v okně Licence v hlavičce.|{n} souborů se nestáhlo podle licence — podrobnosti v okně Licence v hlavičce."));
    }
    for (const [i, [name, body]] of ok.entries()) {
      if (i) await new Promise(r => setTimeout(r, 250));
      downloadFile(name, body, true);
    }
  } finally { if (btn) btn.disabled = false; }
}

/** Hromadné stažení s vynechanými soubory podle licence: okno jen poprvé za relaci (license.js
 *  explainBulkBlocked), vždy řádek u tlačítka s počtem vynechaných souborů. */
function bulkBlockedNote(btn, n, reason, forms) {
  explainBulkBlocked(reason);
  if (!btn || !btn.parentElement) return;
  let s = btn.parentElement.querySelector(".bulknote");
  if (!s) { s = document.createElement("span"); s.className = "hint bulknote"; s.style.margin = "0"; btn.after(s); }
  s.textContent = trn(n, forms);
}

/**
 * „Stáhnout projekt (ZIP)“: celá projektová složka ze jádra (core projectBundle — struktura
 * 01_Dokumentace … 99_Interni, předpona čísla projektu, licence před přejmenováním, sešit HMI Siemens,
 * soubor projektu `projectText`) jako jeden ZIP „<číslo>_<Název>.zip“. Zamčené soubory (DXF ve Free,
 * vše nad limitem kromě projektu) v archivu nejsou a okno licence s důvodem se ukáže jednou.
 */
export async function downloadProjectZip(prj, projectText, btn) {
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = tr("Připravuji ZIP…"); }
  await new Promise(r => setTimeout(r, 30));          // ať se stav tlačítka vykreslí (výpočet je synchronní)
  try {
    const b = projectBundle(prj, { gate: gateFor(prj), projectText });
    const bytes = projectZip(b);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    a.download = b.folder + ".zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    const blocked = b.files.filter(f => f.blocked);
    if (blocked.length) bulkBlockedNote(btn, blocked.length, blocked[0].blocked, N_("{n} soubor nešel do ZIP podle licence — podrobnosti v okně Licence v hlavičce.|{n} soubory nešly do ZIP podle licence — podrobnosti v okně Licence v hlavičce.|{n} souborů nešlo do ZIP podle licence — podrobnosti v okně Licence v hlavičce."));
    return b;
  } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

/* ---------------------------------------------------------------- číslo projektu */
const NUMBERS_KEY = "plcstudio.numbers";
/** Čísla projektů použitá v tomto prohlížeči (návrh dalšího čísla bez kořenového adresáře — project_dir.js). */
function usedNumbers() {
  try { const a = JSON.parse(localStorage.getItem(NUMBERS_KEY) || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
/** Zapamatuje číslo projektu (při uložení stavu); jen tvar RRNNNN, nejvýš 500 posledních. */
export function rememberNumber(n) {
  const v = String(n || "").trim();
  if (!/^\d{6}$/.test(v)) return;
  const list = usedNumbers().filter(x => x !== v);
  list.push(v);
  try { localStorage.setItem(NUMBERS_KEY, JSON.stringify(list.slice(-500))); } catch { /* bez úložiště */ }
}
/**
 * Návrh čísla nového projektu: další volné letošní řady podle čísel, která už tento prohlížeč použil
 * (core nextProjectNumber, přetoková řada RR+50); bez historie RR0001. Záloha bez kořenového adresáře
 * projektů — s ním návrh ze složek na disku (project_dir.js suggestNumberAsync), jako desktop.
 */
export function suggestNumber(extra = []) {
  return nextProjectNumber([...usedNumbers(), ...extra]);
}
