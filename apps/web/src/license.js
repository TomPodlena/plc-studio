/* PLCdesk — licence ve webové aplikaci (tarif Free / Pro / Firma).

   Ověření podpisu, stav, tarify a brána projektu jsou v jádře (packages/core license.ts); tady je jen
   úložiště, síť a UI:
   - licence v localStorage `plcstudio.license` = { text (podepsaný soubor), key, remote, checkedAt, ioLimit },
     ID instalace `plcstudio.deviceId` (náhodné, bez osobních údajů) = otisk zařízení pro aktivaci,
   - aktivace klíče POST /api/license/activate, kontrola stavu POST /api/license/check nejvýš 1× denně
     (chyba sítě = beze změny; nová platnost po zaplacení = tichá re-aktivace → nový podepsaný soubor),
   - licenční soubor z e-mailu jde vložit i offline (bez sítě a bez CORS, ověří se jen podpisem),
   - brána stahování (`licenseFilter` volá util.downloadFile): nad limitem I/O bez licence a bez odemčení
     se nic nestáhne, DXF jen Pro / Firma, dokumenty a README ve Free s patičkou,
   - odemčení prvního projektu zdarma: server ho bere jen s Turnstile (POST /api/unlock), web PLCdesk
     formulář zatím nemá → aplikace otevře stránku Kontakt a připraví text žádosti s ID projektu. */
import {
  tr, esc, getLang, verifyLicense, readLicense, licenseState, projectGate, applyLicenseToFile, isLicenseKey, normLicenseKey,
  isLicenseFile, licenseSiteUrl, LICENSE_SITE, LICENSE_CHECK_EVERY_MS, FREE_IO_LIMIT, projectIoCount,
} from "../../../packages/core/dist/index.js";

const LS_LIC = "plcstudio.license";
const LS_DEV = "plcstudio.deviceId";
const TIMEOUT_MS = 8000;

let store = {};                  // uložená licence (viz hlavička)
let check = null;                // výsledek verifyLicense
let state = licenseState(null);  // LicenseState
let getProject = () => null;     // aktuální projekt (app.js)
let onChange = () => {};         // překreslení aplikace po změně licence

function readStore() {
  try { const s = JSON.parse(localStorage.getItem(LS_LIC) || "{}"); return s && typeof s === "object" ? s : {}; } catch { return {}; }
}
function writeStore() {
  try { localStorage.setItem(LS_LIC, JSON.stringify(store)); } catch { /* bez úložiště: licence platí do zavření stránky */ }
}
/** ID instalace (náhodné UUID) — otisk zařízení pro aktivaci; žádné údaje o počítači ani uživateli. */
export function deviceId() {
  let id = null;
  try { id = localStorage.getItem(LS_DEV); } catch { /* ignore */ }
  if (!id) {
    id = "web-" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    try { localStorage.setItem(LS_DEV, id); } catch { /* ignore */ }
  }
  return id;
}
const ioLimit = () => (Number.isInteger(store.ioLimit) && store.ioLimit > 0 ? store.ioLimit : FREE_IO_LIMIT);
let stateLang = "";
function recompute() { state = licenseState(check, Date.now(), store.remote || null, ioLimit()); stateLang = getLang(); }
/* texty stavu jsou v jazyce UI — po přepnutí jazyka přepočítat */
const fresh = () => { if (stateLang !== getLang()) recompute(); return state; };

/** Načte a ověří uloženou licenci; kontrolu na pozadí spustí, je-li na řadě. */
export async function initLicense(opts = {}) {
  if (opts.project) getProject = opts.project;
  if (opts.onChange) onChange = opts.onChange;
  store = readStore();
  check = store.text ? await verifyLicense(store.text) : null;
  recompute();
  if (opts.background !== false) setTimeout(() => backgroundCheck().catch(() => {}), 1500);
  return state;
}
export const licState = () => fresh();
/** Brána projektu (core projectGate) podle platné licence a odemčených projektů z licence. */
export function gateFor(prj) { fresh(); return prj ? projectGate(prj, state.ent, state.projects) : null; }
/** Aktuální projekt (předpona čísla projektu u stahovaných souborů — util.js). */
export function currentProject() { return getProject(); }

/* ---------------------------------------------------------------- síť */

async function api(path, body) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : 0;
  try {
    const r = await fetch(LICENSE_SITE + path, body === undefined ? { signal: ctl?.signal } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl?.signal,
    });
    let data = null;
    try { data = await r.json(); } catch { /* bez JSON */ }
    return { status: r.status, data: data || {} };
  } finally { clearTimeout(timer); }
}

/** Kontrola na pozadí: nejvýš jednou denně; bez sítě (i CORS) se nic nemění. */
export async function backgroundCheck(force = false) {
  const now = Date.now();
  if (!force && store.checkedAt && now - Date.parse(store.checkedAt) < LICENSE_CHECK_EVERY_MS) return false;
  store.checkedAt = new Date(now).toISOString();
  writeStore();
  try {
    const cfg = await api("/api/config");
    if (cfg.status === 200 && Number.isInteger(cfg.data.free_io_limit) && cfg.data.free_io_limit > 0) store.ioLimit = cfg.data.free_io_limit;
  } catch { /* bez sítě */ }
  const claims = store.text ? readLicense(store.text) : null;
  if (claims && claims.key) {
    try {
      const r = await api("/api/license/check", { key: claims.key, device_hash: deviceId() });
      if (r.status === 200 && r.data.status) {
        store.remote = { status: String(r.data.status), plan: r.data.plan, valid_until: r.data.valid_until, checkedAt: store.checkedAt };
        /* zaplaceno dál → nový podepsaný soubor (nepodepsané valid_until samo nic neprodlouží) */
        if (r.data.status === "active" && r.data.valid_until && Date.parse(r.data.valid_until) > Date.parse(claims.exp)) {
          const a = await api("/api/license/activate", { key: claims.key, device_hash: deviceId(), device_label: "PLCdesk web", locale: getLang() });
          if (a.status === 200 && a.data.license) {
            const c = await verifyLicense(a.data.license);
            if (c.ok) { store.text = a.data.license; check = c; }
          }
        }
      }
    } catch { /* bez sítě: beze změny */ }
  }
  writeStore();
  const before = state.state + state.plan;
  recompute();
  if (before !== state.state + state.plan) onChange();
  return true;
}

/**
 * Vloží licenci: licenční soubor (ověří se offline) nebo klíč PLCD-… (aktivace přes internet).
 * Vrací { ok, message }.
 */
export async function insertLicense(input) {
  const t = String(input || "").trim();
  if (isLicenseFile(t)) {
    const c = await verifyLicense(t);
    if (!c.ok) return { ok: false, message: licenseState(c).message };
    store = { ...store, text: t, key: c.claims.key, remote: null };
    check = c; writeStore(); recompute(); onChange();
    return { ok: true, message: state.message };
  }
  if (!isLicenseKey(t)) return { ok: false, message: tr("Vložte licenční klíč (PLCD-XXXX-XXXX-XXXX-XXXX) nebo celý licenční soubor z e-mailu.") };
  let r;
  try {
    r = await api("/api/license/activate", { key: normLicenseKey(t), device_hash: deviceId(), device_label: "PLCdesk web", locale: getLang() });
  } catch {
    return { ok: false, message: tr("Server licencí se nepodařilo zastihnout. Bez internetu vložte místo klíče licenční soubor z e-mailu (dlouhý řádek s tečkou uprostřed).") };
  }
  if (r.status !== 200 || !r.data.license) return { ok: false, message: r.data.error ? String(r.data.error) : tr("Aktivace se nezdařila (HTTP {status}).", { status: r.status }) };
  const c = await verifyLicense(r.data.license);
  if (!c.ok) return { ok: false, message: licenseState(c).message };
  store = { ...store, text: r.data.license, key: c.claims.key, remote: null, checkedAt: new Date().toISOString() };
  check = c; writeStore(); recompute(); onChange();
  return { ok: true, message: state.message };
}

export function removeLicense() {
  store = { ioLimit: store.ioLimit };
  check = null; writeStore(); recompute(); onChange();
}

/* ---------------------------------------------------------------- brána stahování */

/**
 * Soubor ke stažení podle licence: vrací text (s patičkou ve Free) nebo null, když se stáhnout nesmí
 * (pak ukáže okno s vysvětlením). `quiet` = jen výsledek bez okna (hromadné stahování).
 */
export function licenseFilter(name, body, quiet = false) {
  const prj = getProject();
  if (typeof body !== "string") {   /* binární výstup (xlsx): jen brána, bez patičky */
    const g = gateFor(prj);
    if (g && g.over) { if (!quiet) openLicenseDialog(g.reason); return null; }
    return body;
  }
  const r = applyLicenseToFile(name, body, gateFor(prj));
  if (r.blocked) { if (!quiet) openLicenseDialog(r.blocked); return null; }
  return r.body;
}

/* ---------------------------------------------------------------- UI */

/** Odznak tarifu v hlavičce. */
export function renderLicenseBadge(btn) {
  if (!btn) return;
  const s = fresh();
  btn.textContent = s.planLabel + (s.state === "grace" ? " · " + tr("tolerance") : "");
  btn.title = s.message + " — " + tr("klikněte pro licenci");
  btn.classList.toggle("lic-paid", s.plan !== "free");
  btn.classList.toggle("lic-warn", s.state === "grace" || s.state === "invalid" || s.state === "canceled" || s.state === "expired");
}

/** Pás nad kroky Generovat / Dokumentace / Kusovník: nad limitem výrazně, ve Free stručně. */
export function licenseBanner(el, prj) {
  const g = gateFor(prj);
  if (!g) return;
  const b = document.createElement("div");
  b.id = "licBanner";
  if (g.over) {
    b.className = "notice err licbanner";
    b.setAttribute("role", "alert");
    b.innerHTML = "<b>" + esc(tr("Stažení výstupů je zamčené — projekt je nad limitem tarifu Free.")) + "</b> " + esc(g.reason)
      + "<div class='row' style='margin:8px 0 0'>"
      + "<button class='small primary' data-lic='insert'>" + esc(tr("Vložit licenci")) + "</button>"
      + "<button class='small' data-lic='unlock'>" + esc(tr("Odemknout první projekt zdarma")) + "</button>"
      + "<button class='small' data-lic='pricing'>" + esc(tr("Ceník")) + "</button></div>";
  } else if (g.plan === "free") {
    b.className = "notice licbanner";
    b.innerHTML = esc(tr("Tarif Free: projekt má {io} z {n} I/O. Dokumenty a README se stáhnou s patičkou PLCdesk, DXF je v tarifu Pro.", { io: g.io, n: g.limit ?? "∞" }))
      + " <button class='small' data-lic='insert'>" + esc(tr("Licence…")) + "</button>";
  } else return;
  b.querySelectorAll("[data-lic]").forEach(x => x.addEventListener("click", () => {
    if (x.dataset.lic === "pricing") openPricing();
    else openLicenseDialog("", x.dataset.lic === "unlock" ? "unlock" : "");
  }));
  el.appendChild(b);
}

export function openPricing() { window.open(licenseSiteUrl("cenik"), "_blank", "noopener"); }

function unlockText(prj) {
  return tr("Dobrý den, prosím o odemčení prvního projektu nad limit: {name}, {io} I/O, ID projektu {id}.", {
    name: prj?.meta?.name || tr("(bez názvu)"), io: prj ? projectIoCount(prj) : 0, id: prj?.guid || "?" });
}

/** Okno Licence: stav, vložení klíče / souboru, odemčení projektu, ceník. `reason` = proč se otevřelo. */
export function openLicenseDialog(reason = "", focus = "") {
  let m = document.getElementById("licModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "licModal"; m.className = "modal";
    document.body.appendChild(m);
  }
  document.body.classList.add("modal-open");
  const prj = getProject();
  const g = gateFor(prj);
  const s = fresh();
  const row = (k, v) => "<tr><th>" + esc(k) + "</th><td>" + esc(v) + "</td></tr>";
  m.innerHTML = `<div class="dialog licdialog" role="dialog" aria-modal="true" aria-labelledby="licTitle" tabindex="-1">
    <div class="mhead"><h2 id="licTitle">${esc(tr("Licence PLCdesk"))}</h2><button class="small" id="licClose" aria-label="${esc(tr("Zavřít"))}">×</button></div>
    <div class="mbody">
      ${reason ? "<div class='notice err' role='alert' id='licReason'>" + esc(reason) + "</div>" : ""}
      <h3>${esc(tr("Tarif"))}: <span id="licPlan">${esc(s.planLabel)}</span></h3>
      <p id="licMsg">${esc(s.message)}</p>
      ${s.key ? "<table class='lictab'>" + row(tr("Klíč"), s.key) + row(tr("E-mail"), s.email || "") + row(tr("Počet počítačů"), String(s.seats))
        + (s.exp ? row(tr("Platí do"), s.exp.slice(0, 10)) : "") + "</table>" : ""}
      <h3>${esc(tr("Vložit licenci"))}</h3>
      <p class="hint">${esc(tr("Licenční klíč (PLCD-…) se aktivuje přes internet. Bez internetu vložte celý licenční soubor z e-mailu — ověří se v aplikaci podpisem."))}</p>
      <textarea id="licInput" rows="3" spellcheck="false" style="width:100%;min-height:0;font-family:var(--font-mono);font-size:.78rem" placeholder="PLCD-XXXX-XXXX-XXXX-XXXX"></textarea>
      <div class="row"><button class="primary" id="licGo">${esc(tr("Aktivovat"))}</button>${s.key || store.text ? "<button class='small' id='licRemove'>" + esc(tr("Odebrat licenci")) + "</button>" : ""}
        <button class="small" id="licPricing">${esc(tr("Ceník"))}</button><span id="licOut" class="hint" role="status" style="margin:0"></span></div>
      ${s.ent.ioLimit == null ? "" : `<h3 id="licUnlockH">${esc(tr("Odemknout první projekt zdarma"))}</h3>
      <p class="hint">${esc(tr("Narazíte na limit u reálného stroje? První projekt nad limit odemkneme zdarma. Odešlete nám žádost přes stránku Kontakt — text s ID projektu se zkopíruje do schránky; odemčení přijde jako licenční klíč e-mailem."))}</p>
      ${prj ? "<p class='hint' id='licProj'>" + esc(tr("Tento projekt: {io} I/O (limit Free {n}), ID {id}", { io: g ? g.io : 0, n: s.ent.ioLimit ?? ioLimit(), id: prj.guid || "?" })) + "</p>" : ""}
      <div class="row"><button id="licUnlock">${esc(tr("Odemknout první projekt zdarma"))}</button></div>
      <p class="hint" id="licUnlockOut" role="status"></p>`}
    </div></div>`;
  const close = () => { m.remove(); document.body.classList.remove("modal-open"); };
  m.querySelector("#licClose").addEventListener("click", close);
  m.onkeydown = e => { if (e.key === "Escape") close(); };
  m.addEventListener("click", e => { if (e.target === m) close(); });
  const out = m.querySelector("#licOut");
  m.querySelector("#licGo").addEventListener("click", async () => {
    const btn = m.querySelector("#licGo");
    btn.disabled = true; out.textContent = tr("Ověřuji…");
    try {
      const r = await insertLicense(m.querySelector("#licInput").value);
      if (r.ok) { openLicenseDialog(); document.getElementById("licOut").textContent = "✓ " + r.message; }
      else { out.textContent = r.message; out.className = "errtxt"; }
    } finally { if (btn.isConnected) btn.disabled = false; }
  });
  const rm = m.querySelector("#licRemove");
  if (rm) rm.addEventListener("click", () => { if (confirm(tr("Odebrat licenci z tohoto prohlížeče? Aplikace pak poběží v tarifu Free."))) { removeLicense(); openLicenseDialog(); } });
  m.querySelector("#licPricing").addEventListener("click", openPricing);
  const ub = m.querySelector("#licUnlock");
  if (ub) ub.addEventListener("click", () => {
    const t = unlockText(prj);
    try { navigator.clipboard.writeText(t).catch(() => {}); } catch { /* bez schránky */ }
    window.open(licenseSiteUrl("kontakt"), "_blank", "noopener");
    m.querySelector("#licUnlockOut").textContent = tr("Text žádosti je ve schránce: {text}", { text: t });
  });
  const d = m.querySelector(".dialog");
  if (focus === "unlock" && m.querySelector("#licUnlockH")) m.querySelector("#licUnlockH").scrollIntoView({ block: "start" });
  d.focus({ preventScroll: focus === "unlock" });
}
