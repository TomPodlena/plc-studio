/* PLCdesk web — projektová složka na disku přes File System Access API (Edge / Chrome).

   Chování jako desktop (apps/desktop/plc_studio/datadir.py):
   - kořenový adresář projektů vybere uživatel (`showDirectoryPicker`, čtení i zápis); handle se ukládá
     do IndexedDB (localStorage handle neumí). Po načtení stránky prohlížeč přístup obvykle vrátí na
     „prompt“ → tlačítko „Obnovit přístup ke složce“ (`requestPermission` jen na gesto uživatele);
   - návrh čísla nového projektu z podsložek kořene „RRNNNN_*“ (core nextProjectNumber, přetoková řada
     RR+50); bez kořene historie čísel z localStorage (util.js suggestNumber);
   - „Uložit vše do složky projektu“ = core projectBundle (stejný obsah a struktura jako desktop a ZIP:
     licence, předpona čísla, výjimka TwinCAT) do <kořen>/<číslo>_<Název>/… — projektová složka se pod
     kořenem vytvoří bez dotazu, kořen nikdy (vybírá ho uživatel); před přepsáním jeden dotaz;
     zápis po dávkách s průběhem a Zrušit, na konci přehled po podsložkách;
   - „Otevřít projekt…“ = výběr .plcstudio.json (startIn = kořen), bez API <input type=file>.
   Prohlížeč bez API (Firefox, Safari, zakázané politikou, stránka mimo secure context) tlačítka kořene
   a zápisu nevidí — jen nápovědu a Stáhnout projekt (ZIP).

   `fsLayer` = jediné místo, které sahá na API prohlížeče. Test (headless Edge) ho podvrhne:
   kořen = OPFS `navigator.storage.getDirectory()` místo pickeru, nebo `supported = () => false`. */
import { tr, N_, nextProjectNumber, projectBundle, projectFolderName } from "../../../packages/core/dist/index.js";
import { idbStore } from "./idb.js";
import { gateFor, explainBulkBlocked } from "./license.js";
import { suggestNumber } from "./util.js";
import { trn } from "./plural.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tick = () => new Promise(r => setTimeout(r, 0));

/** Přístup k API prohlížeče (podvrhnutelný testem — žádné testovací větve v kódu aplikace). */
export const fsLayer = {
  /** File System Access je k dispozici (Chromium v secure contextu: https / localhost). */
  supported: () => typeof window.showDirectoryPicker === "function" && window.isSecureContext !== false,
  /** Výběr kořenového adresáře (čtení i zápis). Zrušení = výjimka AbortError. */
  pickDirectory: () => window.showDirectoryPicker({ id: "plcdesk-root", mode: "readwrite" }),
  /** Výběr souboru projektu (startIn = kořen, je-li); vrací File. Zrušení = AbortError. */
  async pickProjectFile(startIn) {
    const [h] = await window.showOpenFilePicker({
      id: "plcdesk-open", multiple: false, ...(startIn ? { startIn } : {}),
      types: [{ description: tr("Projekt PLCdesk"), accept: { "application/json": [".json"] } }],
    });
    return h.getFile();
  },
  /** Stav oprávnění ke čtení i zápisu ('granted' | 'prompt' | 'denied'); `request` = požádat (gesto). */
  async permission(h, request = false) {
    const f = request ? h.requestPermission : h.queryPermission;
    return typeof f === "function" ? f.call(h, { mode: "readwrite" }) : "granted";
  },
};

const handles = idbStore("plcstudio-dirs", "handles");
const ROOT_KEY = "projectsRoot";
/** Stav kořene: handle, oprávnění, průběh ukládání, poslední hláška (přežije překreslení kroku). */
const D = { root: null, perm: null, job: null, msg: null };

/* popisky podsložek v přehledu po uložení (názvy = core PROJECT_DIRS; stejné klíče jako desktop) */
const DIR_LABELS = {
  "01_Dokumentace": N_("dokumentace"), "02_Vykresy": N_("výkresy"), "03_Program_PLC": N_("kód PLC"),
  "04_HMI": N_("HMI"), "05_Bezpecnost": N_("bezpečnost"), "06_Kusovnik": N_("kusovník"),
  "07_Oziveni_a_FAT": N_("oživení a FAT"), "08_Schvaleni_a_revize": N_("schválení a revize"),
  "09_Exporty": N_("exporty (EPLAN)"), "99_Interni": N_("interní — nepředávat zákazníkovi"),
};

export const dirSupported = () => { try { return !!fsLayer.supported(); } catch { return false; } };
/** Kořen je vybraný a přístupný (oprávnění udělené). */
export const hasRoot = () => !!D.root && D.perm === "granted";

/** Při startu aplikace: handle kořene z IndexedDB a stav oprávnění (bez dotazu — ten jen na gesto). */
export async function initProjectDir() {
  if (!dirSupported()) return;
  try {
    const h = await handles.get(ROOT_KEY);
    if (h && h.kind === "directory") { D.root = h; D.perm = await fsLayer.permission(h); }
  } catch { D.root = null; D.perm = null; }
}

/** Výběr kořenového adresáře (gesto uživatele). true = vybráno. */
export async function chooseRoot() {
  let h;
  try { h = await fsLayer.pickDirectory(); } catch (e) { if (e && e.name === "AbortError") return false; throw e; }
  D.root = h;
  D.perm = await fsLayer.permission(h);
  if (D.perm !== "granted") D.perm = await fsLayer.permission(h, true);
  try { await handles.put(h, ROOT_KEY); } catch { /* bez IndexedDB: kořen platí do zavření stránky */ }
  return D.perm === "granted";
}

/** „Obnovit přístup ke složce“ (gesto uživatele). */
export async function restoreAccess() {
  if (!D.root) return false;
  try { D.perm = await fsLayer.permission(D.root, true); } catch { D.perm = "denied"; }
  return D.perm === "granted";
}

/** Názvy podsložek kořene (pro návrh čísla); bez přístupu []. */
export async function rootFolderNames() {
  if (!hasRoot()) return [];
  const out = [];
  try { for await (const h of D.root.values()) if (h.kind === "directory") out.push(h.name); } catch { /* složka zmizela */ }
  return out;
}

/** Návrh čísla nového projektu: ze složek kořene (jako desktop), bez kořene z historie prohlížeče. */
export async function suggestNumberAsync(extra = []) {
  if (!hasRoot()) return suggestNumber(extra);
  return nextProjectNumber([...(await rootFolderNames()), ...extra]);
}

/* ---------------------------------------------------------------- zápis projektové složky */

/** Podsložka (cesta s „/“) pod `base`; `create` = založit chybějící. Neexistující bez create = null. */
function dirResolver(base, create) {
  const cache = new Map([["", Promise.resolve(base)]]);
  const get = path => {
    if (cache.has(path)) return cache.get(path);
    const at = path.lastIndexOf("/");
    const p = get(at < 0 ? "" : path.slice(0, at)).then(parent => parent
      ? parent.getDirectoryHandle(path.slice(at + 1), { create }).catch(e => { if (create) throw e; return null; })
      : null);
    cache.set(path, p);
    return p;
  };
  return get;
}
const split = path => { const at = path.lastIndexOf("/"); return [at < 0 ? "" : path.slice(0, at), path.slice(at + 1)]; };

/** Projde `items` po dávkách `size` (souběžně v dávce), mezi dávkami vrátí řízení prohlížeči. */
async function batched(items, size, fn, onBatch) {
  for (let i = 0; i < items.length; i += size) {
    if (D.job && D.job.cancel) throw Object.assign(new Error("cancel"), { name: "AbortError" });
    await Promise.all(items.slice(i, i + size).map(fn));
    if (onBatch) onBatch(Math.min(i + size, items.length));
    await tick();
  }
}

/**
 * Uloží celou projektovou složku do <kořen>/<složka>. `confirmOverwrite(n, total, name)` → bool.
 * Vrací přehled { folder, dirs: {podsložka: počet}, total, nblocked, blocked: [důvody], project }
 * nebo null (zrušeno uživatelem). Chyba zápisu = výjimka (co se zapsalo, zůstává).
 */
export async function writeProjectFolder(prj, projectText, { confirmOverwrite, onProgress } = {}) {
  if (!hasRoot()) throw new Error("no root");
  onProgress && onProgress(0, 0, "prepare");
  await tick();                                    // ať se průběh vykreslí (výpočet sady je synchronní)
  const b = projectBundle(prj, { gate: gateFor(prj), projectText });
  const files = b.files.filter(f => !f.blocked && (f.body !== undefined || f.data));
  /* existující soubory: jen když projektová složka už je */
  let pdir = await D.root.getDirectoryHandle(b.folder).catch(() => null);
  if (pdir) {
    const look = dirResolver(pdir, false);
    let n = 0, first = "";
    await batched(files, 24, async f => {
      const [dir, name] = split(f.path);
      const d = await look(dir);
      if (d && await d.getFileHandle(name).then(() => true, () => false)) { n++; if (!first || f.path < first) first = f.path; }
    }, done => onProgress && onProgress(done, files.length, "check"));
    if (n && confirmOverwrite && !confirmOverwrite(n, files.length, first)) return null;
  } else pdir = await D.root.getDirectoryHandle(b.folder, { create: true });
  const mk = dirResolver(pdir, true);
  const dirs = {};
  await batched(files, 12, async f => {
    const [dir, name] = split(f.path);
    const d = await mk(dir);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(f.data || f.body);
    await w.close();
    if (dir) { const top = dir.split("/")[0]; dirs[top] = (dirs[top] || 0) + 1; }
  }, done => onProgress && onProgress(done, files.length, "write"));
  const blockedFiles = b.files.filter(f => f.blocked);
  return {
    folder: b.folder, dirs, total: files.length, project: b.projectFile,
    nblocked: blockedFiles.length, blocked: [...new Set(blockedFiles.map(f => f.blocked))],
  };
}

/**
 * Jen soubor projektu (Ctrl+S) do projektové složky: <kořen>/<číslo>_<Název>/<číslo>_<Název>.plcstudio.json
 * (stejné jméno a místo jako v „Uložit vše do složky projektu“). Bez přístupného kořene null (klient
 * pak soubor stáhne); jinak cesta pro hlášku. Chyba zápisu = výjimka.
 */
export async function saveProjectFile(prj, projectText) {
  if (!hasRoot()) return null;
  const folder = projectFolderName(prj), name = folder + ".plcstudio.json";
  const dir = await D.root.getDirectoryHandle(folder, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(projectText);
  await w.close();
  return D.root.name + "/" + folder + "/" + name;
}

/** Přehled po uložení jako HTML (podsložky s popisky a počty, projekt, zamčené licencí). */
function summaryHtml(s) {
  const path = (D.root ? D.root.name + "/" : "") + s.folder;
  let h = "<b>" + esc(trn(s.total, N_("Uložen {n} soubor do {path}.|Uloženy {n} soubory do {path}.|Uloženo {n} souborů do {path}."), { path })) + "</b>";
  h += "<ul style='margin:6px 0 0;padding-left:18px'>";
  for (const d of Object.keys(s.dirs).sort()) {
    const label = DIR_LABELS[d] ? tr(DIR_LABELS[d]) : "";
    h += "<li><code>" + esc(d) + "/</code> — " + esc(label ? label + ": " : "") + s.dirs[d] + "</li>";
  }
  h += "<li><code>" + esc(s.project) + "</code> — " + esc(tr("projekt")) + "</li></ul>";
  if (s.nblocked) h += "<p style='margin:6px 0 0'>" + esc(trn(s.nblocked, N_("Neuloženo podle licence: {n} soubor.|Neuloženo podle licence: {n} soubory.|Neuloženo podle licence: {n} souborů."))) + " " + esc(s.blocked.join(" ")) + "</p>";
  return h;
}

/* ---------------------------------------------------------------- UI (kroky Projekt a Dokumentace) */

/**
 * Ovládání projektové složky do `host`. `opts`: { prj: () => projekt, payload: () => text projektu,
 * full: true v kroku Projekt (kořen, obnovení přístupu, návrh čísla), onNumber(n): použít navržené číslo,
 * rerender: překreslit krok }.
 */
export function mountFolderControls(host, opts) {
  if (!dirSupported()) {
    host.innerHTML = "<p class='hint' style='margin:4px 0 0'>" + esc(tr("Ukládání do složky umí Edge a Chrome; jinak Stáhnout projekt (ZIP).")) + "</p>";
    return;
  }
  const prj = opts.prj();
  const folder = projectFolderName(prj);
  const needRestore = D.root && D.perm !== "granted";
  let h = "<div class='row' style='align-items:center'>";
  h += "<button class='small' data-fd='save'>" + esc(tr("Uložit vše do složky projektu")) + "</button>";
  if (opts.full) h += "<button class='small' data-fd='root'>" + esc(tr("Vybrat kořenový adresář projektů…")) + "</button>";
  if (needRestore) h += "<button class='small primary' data-fd='restore'>" + esc(tr("Obnovit přístup ke složce")) + "</button>";
  h += "<span class='hint' data-fd='where'>";
  if (!D.root) h += esc(tr("Kořenový adresář projektů není vybraný — při prvním uložení se na něj aplikace zeptá."));
  else h += tr("Projektová složka: {path}", { path: "<code>" + esc(D.root.name + "/" + folder) + "</code>" })
    + (needRestore ? " — " + esc(tr("prohlížeč po načtení stránky vyžaduje znovu povolit přístup.")) : "");
  h += "</span></div>";
  if (opts.full) h += "<div class='row' data-fd='num' hidden></div>";
  h += "<div class='row' data-fd='prog' hidden style='align-items:center'><progress style='flex:1;max-width:320px'></progress><span class='hint' data-fd='progtxt'></span><button class='small' data-fd='cancel'>" + esc(tr("Zrušit")) + "</button></div>";
  h += "<div class='notice' data-fd='msg' hidden style='margin-top:8px'></div>";
  host.innerHTML = h;
  const q = k => host.querySelector("[data-fd='" + k + "']");
  const msg = q("msg");
  const showMsg = () => { msg.hidden = !D.msg; if (D.msg) { msg.className = "notice" + (D.msg.err ? " err" : ""); msg.innerHTML = D.msg.html; } };
  showMsg();
  const fail = e => { D.msg = { err: true, html: "<b>" + esc(tr("Uložení se nezdařilo")) + "</b> " + esc(e && e.message || String(e)) }; showMsg(); };

  /* průběh: běžící ukládání přežije překreslení kroku (tlačítka zablokovaná, průběh se ukáže) */
  const prog = q("prog"), bar = prog.querySelector("progress"), ptxt = q("progtxt");
  const setProg = (done, total, phase) => {
    prog.hidden = false;
    if (total) { bar.max = total; bar.value = done; } else bar.removeAttribute("value");
    ptxt.textContent = phase === "prepare" ? tr("Připravuji kód, dokumentaci, výkresy, kusovník a HMI…")
      : phase === "check" ? tr("Kontroluji existující soubory: {done} / {total}", { done, total })
      : tr("Ukládám: {done} / {total}", { done, total });
  };
  if (D.job) { setProg(D.job.done, D.job.total, D.job.phase); D.job.view = setProg; host.querySelectorAll("button:not([data-fd='cancel'])").forEach(b => (b.disabled = true)); }
  q("cancel").addEventListener("click", () => { if (D.job) D.job.cancel = true; });

  if (opts.full) q("root").addEventListener("click", async () => {
    try { if (await chooseRoot()) { D.msg = null; opts.rerender(); } } catch (e) { fail(e); }
  });
  const rb = q("restore");
  if (rb) rb.addEventListener("click", async () => { await restoreAccess(); opts.rerender(); });

  q("save").addEventListener("click", async () => {
    if (D.job) return;
    try {
      /* gesto uživatele: bez kořene ho vybrat, bez přístupu o něj požádat (projektová složka pak bez dotazu) */
      if (!D.root) { if (!await chooseRoot()) return; }
      else if (D.perm !== "granted" && !await restoreAccess()) { opts.rerender(); return; }
    } catch (e) { fail(e); return; }
    const job = D.job = { done: 0, total: 0, phase: "prepare", cancel: false, view: setProg };
    host.querySelectorAll("button:not([data-fd='cancel'])").forEach(b => (b.disabled = true));
    D.msg = null; showMsg();
    try {
      const s = await writeProjectFolder(opts.prj(), opts.payload(), {
        onProgress: (done, total, phase) => { Object.assign(job, { done, total, phase }); try { job.view(done, total, phase); } catch { /* krok překreslen */ } },
        confirmOverwrite: (n, total, name) => window.confirm(
          tr("Ve složce už existuje {n} z {total} souborů (např. {name}).", { n, total, name }) + "\n" + tr("Přepsat je?")),
      });
      D.msg = s ? { html: summaryHtml(s) } : { html: esc(tr("Ukládání do složky projektu zrušeno.")) };
      if (s && s.nblocked) explainBulkBlocked(s.blocked[0]);   // okno jen poprvé, dál řádek v souhrnu
    } catch (e) {
      if (e && e.name === "AbortError") D.msg = { html: esc(tr("Ukládání do složky projektu zrušeno.")) };
      else D.msg = { err: true, html: "<b>" + esc(tr("Uložení se nezdařilo")) + "</b> " + esc(e && e.message || String(e)) };
    } finally {
      D.job = null;
      opts.rerender();
    }
  });

  /* návrh čísla ze složek kořene: když číslo chybí nebo ho má jiná projektová složka */
  if (opts.full && hasRoot()) (async () => {
    const names = await rootFolderNames();
    const cur = String(prj.meta.number || "").trim();
    const clash = cur ? names.find(n => n.startsWith(cur + "_") && n !== folder) || (names.includes(cur) && cur !== folder ? cur : "") : "";
    const next = nextProjectNumber(names);
    const box = q("num");
    if (!box || (!clash && cur) || !next) return;
    box.innerHTML = "<span class='hint' style='margin:0'>" + (clash
      ? "⚠ " + tr("Číslo {n} už má jiná složka v kořeni ({folder}).", { n: esc(cur), folder: "<code>" + esc(clash) + "</code>" })
      : esc(tr("Další volné číslo podle složek v kořeni: {n}", { n: next }))) + "</span> <button class='small' data-fd='usenum'>"
      + esc(tr("Použít {n}", { n: next })) + "</button>";
    box.hidden = false;
    box.querySelector("[data-fd='usenum']").addEventListener("click", () => opts.onNumber(next));
  })();
}

/**
 * „Otevřít projekt…“: s API výběr souboru se startIn v kořeni, jinak <input type=file> (všechny
 * prohlížeče). Vrací text souboru, nebo null (zrušeno).
 */
export async function pickProjectText() {
  if (dirSupported()) {
    try {
      const f = await fsLayer.pickProjectFile(hasRoot() ? D.root : undefined);
      return f ? await f.text() : null;
    } catch (e) {
      if (e && e.name === "AbortError") return null;
      /* API selhalo jinak (zakázané politikou…) → záložní výběr souboru */
    }
  }
  return pickWithInput();
}
function pickWithInput() {
  return new Promise(res => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.style.display = "none";
    inp.addEventListener("change", async () => { const f = inp.files && inp.files[0]; inp.remove(); res(f ? await f.text() : null); });
    inp.addEventListener("cancel", () => { inp.remove(); res(null); });
    document.body.appendChild(inp);
    inp.click();
  });
}
