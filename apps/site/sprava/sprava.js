// PLCdesk - sprava zakazniku (klient). Bez knihoven, bez inline skriptu (CSP script-src 'self').
// Data z API se do stranky vkladaji jen jako text (textContent), nikdy jako HTML.
"use strict";

(() => {
  // ------------------------------------------------------------ texty (cs = zdroj, en)
  const I18N = {
    cs: {
      title: "Správa zákazníků — PLCdesk", tag: "Správa", lang_label: "Jazyk", nav_label: "Správa", logout: "Odhlásit",
      nav_overview: "Přehled", nav_customers: "Zákazníci", nav_new: "Nová licence", nav_audit: "Audit",
      login_h: "Přihlášení do správy", login_p: "Jen pro provozovatele. Přihlaste se tokenem správy (secret ADMIN_TOKEN).",
      login_token: "Token správy", login_btn: "Přihlásit", login_wrong: "Token nesouhlasí. Pokus byl zaznamenán.",
      login_many: "Příliš mnoho neúspěšných pokusů. Zkuste to znovu za {n} min.", login_closed: "Přihlášení tokenem není na serveru nastavené.",
      login_forbidden: "Požadavek byl odmítnut (jiný původ stránky).", login_empty: "Zadejte token.",
      who_token: "přihlášeno tokenem · do {t}", who_access: "Cloudflare Access · {e}",
      cancel: "Zpět", loading: "Načítám…", err_server: "Chyba serveru. Zkuste to prosím znovu.", err_net: "Server neodpovídá.",
      err_forbidden: "Přístup odmítnut.", err_closed: "Správa není na serveru nastavená (ADMIN_TOKEN ani Cloudflare Access).",
      ov_h: "Přehled", ov_leads7: "Zájemci za 7 dní", ov_leads30: "Zájemci za 30 dní", ov_leads_total: "celkem {n}, stáhlo {d}",
      ov_active: "Aktivní licence", ov_past_due: "Po splatnosti", ov_expired: "Propadlé", ov_canceled: "Zrušené",
      ov_devices: "Aktivní počítače", ov_payments: "Platební události za 30 dní", ov_unlocks: "Odemčené projekty",
      ov_export_h: "Export", ov_export_p: "CSV se středníkem a BOM pro český Excel. Každý export se zapisuje do auditu.",
      ex_customers: "Zákazníci", ex_licenses: "Licence", ex_leads: "Zájemci", ov_generated: "Stav k {t}",
      cu_h: "Zákazníci", cu_q: "Hledat e-mail nebo licenční klíč", cu_status: "Stav", cu_all: "Všechny stavy", cu_search: "Hledat",
      cu_none: "Nic nenalezeno.", cu_total: "{n} zákazníků", page: "Strana {p} z {n}", prev: "← Předchozí", next: "Další →",
      col_email: "E-mail", col_status: "Stav", col_plan: "Tarif", col_valid: "Platí do", col_devices: "Počítače", col_lic: "Licence",
      col_last: "Poslední aktivita", col_key: "Klíč", col_seats: "Míst", col_provider: "Platba", col_note: "Poznámka", col_actions: "Akce",
      col_device: "Počítač", col_hash: "Otisk", col_seen: "Naposledy", col_created: "Aktivováno", col_released: "Uvolněno",
      col_type: "Událost", col_at: "Kdy", col_sub: "Předplatné", col_actor: "Kdo", col_via: "Cesta", col_action: "Akce",
      col_target: "Cíl", col_detail: "Podrobnosti", col_ip: "IP", col_project: "Projekt", col_io: "I/O",
      st_active: "Aktivní", st_past_due: "Po splatnosti", st_expired: "Propadlá", st_canceled: "Zrušená", st_downloaded: "Stáhl",
      st_lead: "Zájemce", st_revoked: "Uvolněno",
      de_back: "← Zákazníci", de_new_lic: "Nová licence", de_lead_h: "Zájem o stažení", de_no_lead: "Formulář ke stažení nevyplnil.",
      de_lead_at: "Vyplnil formulář", de_terms: "Souhlas s podmínkami", de_first_dl: "Poprvé stáhl", de_links: "Odkazy / stažení",
      de_locale: "Jazyk", de_source: "Zdroj", de_unsub: "Odhlášen z e-mailů", yes: "ano", no: "ne",
      de_lic_h: "Licence", de_no_lic: "Žádná licence.", de_dev_h: "Počítače", de_no_dev: "Žádná aktivace.",
      de_pay_h: "Platby", de_no_pay: "Žádné platební události.", de_pay_hint: "Platební události se k zákazníkovi evidují od nasazení správy.",
      de_unl_h: "Odemčené projekty", de_notes_h: "Poznámky", de_no_notes: "Zatím bez poznámek.", de_note_add: "Přidat poznámku",
      de_note_ph: "Poznámka jen pro provozovatele (max. 2000 znaků)", de_note_saved: "Poznámka uložena.",
      act_extend: "Prodloužit", act_cancel: "Zrušit", act_release: "Uvolnit",
      dlg_extend_h: "Prodloužit licenci", dlg_extend_p: "Licence {k} pro {e}. Prodlouží se od pozdějšího z: dnes, dosavadní konec platnosti ({d}).",
      dlg_days: "O kolik dní", dlg_extend_ok: "Prodloužit",
      dlg_cancel_h: "Zrušit licenci?", dlg_cancel_p: "Licence {k} pro {e} se zamkne: aplikace ji při příští kontrole přestane přijímat. Akce se zapíše do auditu.",
      dlg_cancel_ok: "Zrušit licenci", dlg_release_h: "Uvolnit počítač?",
      dlg_release_p: "Počítač „{l}“ přestane zabírat místo licence {k}. Pokud se aplikace na něm znovu aktivuje, místo si opět vezme (je-li volné).",
      dlg_release_ok: "Uvolnit",
      ok_extended: "Licence prodloužena do {d}. Nový licenční soubor je níže.", ok_canceled: "Licence zrušena.",
      ok_canceled_sub: "Licence zrušena. Předplatné u {p} tím NEKONČÍ — zrušte ho i v administraci poskytovatele plateb.",
      ok_released: "Počítač uvolněn.", already: "Už bylo provedeno.",
      nl_h: "Nová licence", nl_email: "E-mail zákazníka", nl_plan: "Tarif", nl_days: "Platnost (dní)", nl_until: "nebo platí do (datum)",
      nl_seats: "Počet počítačů", nl_note: "Poznámka (max. 200 znaků)", nl_send: "Poslat licenci zákazníkovi e-mailem",
      nl_send_direct: "E-maily jsou vypnuté (MAIL_MODE = direct) — licenci předejte sami.", nl_submit: "Vystavit licenci",
      nl_confirm_h: "Vystavit licenci?", nl_confirm_p: "{plan} pro {e}, {s} počítač(e), platí do {d}.", nl_ok: "Licence vystavena.",
      nl_hint: "Licenční soubor je podepsaný (Ed25519) a aplikace ho ověří offline. Klíč i soubor se ukážou jen teď — ve správě zůstane klíč, soubor jde kdykoli vystavit znovu prodloužením.",
      plan_pro: "Pro", plan_firma: "Firma", "plan_trial": "Zkušební (trial)", "plan_free-unlock": "Free – odemčení",
      res_key: "Licenční klíč", res_file: "Licenční soubor", copy: "Kopírovat", copied: "Zkopírováno.", res_sent: "Odesláno e-mailem.", res_mail_error: "E-mail se nepodařilo odeslat — licence je vystavená, předejte ji zákazníkovi sami.",
      au_h: "Audit", au_q: "Hledat (kdo, akce, cíl, IP)", au_none: "Žádné záznamy.", au_total: "{n} záznamů",
      au_hint: "Kdo, kdy a co ve správě udělal. Licenční klíče jsou zkrácené. Neúspěšná přihlášení se mažou po 30 dnech, ostatní záznamy po 3 letech.",
      a_login: "přihlášení", a_login_failed: "neúspěšné přihlášení", a_logout: "odhlášení", a_customer_view: "zobrazení zákazníka",
      a_license_issue: "vystavení licence", a_license_extend: "prodloužení licence", a_license_cancel: "zrušení licence",
      a_activation_release: "uvolnění počítače", a_note_add: "poznámka", a_export: "export",
      bad_email: "Neplatný e-mail.", bad_days: "Neplatný počet dní (1–3650).", bad_valid_until: "Neplatné datum (budoucí, nejvýš 10 let).",
      bad_seats: "Neplatný počet počítačů (1–100).", bad_plan: "Neznámý tarif.", bad_body: "Poznámka je prázdná nebo delší než 2000 znaků.",
      not_found: "Nenalezeno.", canceled_err: "Zrušenou licenci nejde prodloužit — vystavte novou.",
    },
    en: {
      title: "Customer admin — PLCdesk", tag: "Admin", lang_label: "Language", nav_label: "Admin", logout: "Sign out",
      nav_overview: "Overview", nav_customers: "Customers", nav_new: "New licence", nav_audit: "Audit",
      login_h: "Sign in to admin", login_p: "Operator only. Sign in with the admin token (secret ADMIN_TOKEN).",
      login_token: "Admin token", login_btn: "Sign in", login_wrong: "Wrong token. The attempt has been logged.",
      login_many: "Too many failed attempts. Try again in {n} min.", login_closed: "Token sign-in is not configured on the server.",
      login_forbidden: "Request refused (different page origin).", login_empty: "Enter the token.",
      who_token: "signed in with token · until {t}", who_access: "Cloudflare Access · {e}",
      cancel: "Back", loading: "Loading…", err_server: "Server error. Please try again.", err_net: "The server is not responding.",
      err_forbidden: "Access denied.", err_closed: "Admin is not configured on the server (neither ADMIN_TOKEN nor Cloudflare Access).",
      ov_h: "Overview", ov_leads7: "Leads, last 7 days", ov_leads30: "Leads, last 30 days", ov_leads_total: "{n} total, {d} downloaded",
      ov_active: "Active licences", ov_past_due: "Past due", ov_expired: "Expired", ov_canceled: "Cancelled",
      ov_devices: "Active computers", ov_payments: "Payment events, 30 days", ov_unlocks: "Unlocked projects",
      ov_export_h: "Export", ov_export_p: "Semicolon CSV with BOM (Excel). Every export is written to the audit log.",
      ex_customers: "Customers", ex_licenses: "Licences", ex_leads: "Leads", ov_generated: "As of {t}",
      cu_h: "Customers", cu_q: "Search e-mail or licence key", cu_status: "Status", cu_all: "All statuses", cu_search: "Search",
      cu_none: "Nothing found.", cu_total: "{n} customers", page: "Page {p} of {n}", prev: "← Previous", next: "Next →",
      col_email: "E-mail", col_status: "Status", col_plan: "Plan", col_valid: "Valid until", col_devices: "Computers", col_lic: "Licences",
      col_last: "Last activity", col_key: "Key", col_seats: "Seats", col_provider: "Payment", col_note: "Note", col_actions: "Actions",
      col_device: "Computer", col_hash: "Fingerprint", col_seen: "Last seen", col_created: "Activated", col_released: "Released",
      col_type: "Event", col_at: "When", col_sub: "Subscription", col_actor: "Who", col_via: "Via", col_action: "Action",
      col_target: "Target", col_detail: "Details", col_ip: "IP", col_project: "Project", col_io: "I/O",
      st_active: "Active", st_past_due: "Past due", st_expired: "Expired", st_canceled: "Cancelled", st_downloaded: "Downloaded",
      st_lead: "Lead", st_revoked: "Released",
      de_back: "← Customers", de_new_lic: "New licence", de_lead_h: "Download request", de_no_lead: "Did not use the download form.",
      de_lead_at: "Form submitted", de_terms: "Terms accepted", de_first_dl: "First download", de_links: "Links / downloads",
      de_locale: "Language", de_source: "Source", de_unsub: "Unsubscribed", yes: "yes", no: "no",
      de_lic_h: "Licences", de_no_lic: "No licence.", de_dev_h: "Computers", de_no_dev: "No activation.",
      de_pay_h: "Payments", de_no_pay: "No payment events.", de_pay_hint: "Payment events are linked to customers since the admin was deployed.",
      de_unl_h: "Unlocked projects", de_notes_h: "Notes", de_no_notes: "No notes yet.", de_note_add: "Add note",
      de_note_ph: "Operator-only note (max. 2000 characters)", de_note_saved: "Note saved.",
      act_extend: "Extend", act_cancel: "Cancel", act_release: "Release",
      dlg_extend_h: "Extend licence", dlg_extend_p: "Licence {k} for {e}. Extended from the later of: today, current end of validity ({d}).",
      dlg_days: "By how many days", dlg_extend_ok: "Extend",
      dlg_cancel_h: "Cancel licence?", dlg_cancel_p: "Licence {k} for {e} will be locked: the app stops accepting it at its next check. The action is audited.",
      dlg_cancel_ok: "Cancel licence", dlg_release_h: "Release computer?",
      dlg_release_p: "Computer “{l}” will no longer take a seat of licence {k}. If the app activates on it again, it takes a seat again (if free).",
      dlg_release_ok: "Release",
      ok_extended: "Licence extended until {d}. The new licence file is below.", ok_canceled: "Licence cancelled.",
      ok_canceled_sub: "Licence cancelled. The subscription at {p} does NOT end by this — cancel it in the payment provider's dashboard too.",
      ok_released: "Computer released.", already: "Already done.",
      nl_h: "New licence", nl_email: "Customer e-mail", nl_plan: "Plan", nl_days: "Validity (days)", nl_until: "or valid until (date)",
      nl_seats: "Number of computers", nl_note: "Note (max. 200 characters)", nl_send: "Send the licence to the customer by e-mail",
      nl_send_direct: "E-mails are off (MAIL_MODE = direct) — hand over the licence yourself.", nl_submit: "Issue licence",
      nl_confirm_h: "Issue licence?", nl_confirm_p: "{plan} for {e}, {s} computer(s), valid until {d}.", nl_ok: "Licence issued.",
      nl_hint: "The licence file is signed (Ed25519) and verified offline by the app. Key and file are shown only now — the key stays in the admin, a new file can be issued any time by extending.",
      plan_pro: "Pro", plan_firma: "Firma", "plan_trial": "Trial", "plan_free-unlock": "Free – unlock",
      res_key: "Licence key", res_file: "Licence file", copy: "Copy", copied: "Copied.", res_sent: "Sent by e-mail.", res_mail_error: "The e-mail could not be sent — the licence is issued, hand it over to the customer yourself.",
      au_h: "Audit", au_q: "Search (who, action, target, IP)", au_none: "No entries.", au_total: "{n} entries",
      au_hint: "Who did what and when in the admin. Licence keys are shortened. Failed sign-ins are deleted after 30 days, other entries after 3 years.",
      a_login: "sign-in", a_login_failed: "failed sign-in", a_logout: "sign-out", a_customer_view: "customer viewed",
      a_license_issue: "licence issued", a_license_extend: "licence extended", a_license_cancel: "licence cancelled",
      a_activation_release: "computer released", a_note_add: "note", a_export: "export",
      bad_email: "Invalid e-mail.", bad_days: "Invalid number of days (1–3650).", bad_valid_until: "Invalid date (future, at most 10 years).",
      bad_seats: "Invalid number of computers (1–100).", bad_plan: "Unknown plan.", bad_body: "The note is empty or longer than 2000 characters.",
      not_found: "Not found.", canceled_err: "A cancelled licence cannot be extended — issue a new one.",
    },
  };
  const STATES = ["active", "past_due", "expired", "canceled", "downloaded", "lead"];
  const PLANS = ["pro", "firma", "trial", "free-unlock"];
  const PLAN_DEFAULTS = { pro: { days: 365, seats: 1 }, firma: { days: 365, seats: 5 }, trial: { days: 14, seats: 1 }, "free-unlock": { days: 365, seats: 1 } };

  let lang = "cs";
  try { if (localStorage.getItem("plcstudio.admin.lang") === "en") lang = "en"; } catch { /* bez uloziste */ }
  const t = (k, v = {}) => String(I18N[lang][k] ?? I18N.cs[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (v[x] ?? m));

  // ------------------------------------------------------------ DOM
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const view = $("#view");
  const fmtLocale = () => (lang === "cs" ? "cs-CZ" : "en-GB");
  const fmtDT = (s) => (s ? new Intl.DateTimeFormat(fmtLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(s)) : "—");
  const fmtD = (s) => (s ? new Intl.DateTimeFormat(fmtLocale(), { dateStyle: "medium" }).format(new Date(s)) : "—");
  const shortKey = (k) => (k && k.length > 13 ? `${k.slice(0, 9)}…${k.slice(-4)}` : k || "");
  const stamp = (st) => h("span", { class: `stamp st-${st}`, text: t("st_" + st) });
  const planName = (p) => (I18N[lang]["plan_" + p] ? t("plan_" + p) : p || "—");

  function table(cols, rows, rowFn, opts = {}) {
    if (!rows.length) return h("p", { class: "adm-empty", text: opts.empty || "—" });
    return h("table", { class: "adm-table" },
      h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col", class: c.cls, text: c.label })))),
      h("tbody", {}, rows.map((r) => {
        const cells = rowFn(r);
        const tr = h("tr", { class: opts.rowClass ? opts.rowClass(r) : null },
          cols.map((c, i) => h("td", { "data-label": c.label, class: c.cls }, cells[i])));
        if (opts.onRow) {
          tr.classList.add("click");
          tr.addEventListener("click", (e) => { if (!e.target.closest("a, button")) opts.onRow(r); });
        }
        return tr;
      })));
  }
  const panel = (title, ...kids) => h("section", { class: "adm-panel" }, h("h2", {}, ...[].concat(title)), ...kids);

  // ------------------------------------------------------------ API
  async function api(method, path, body) {
    let r;
    try {
      r = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body === undefined ? { "X-Requested-With": "plcdesk-admin" } : { "Content-Type": "application/json", "X-Requested-With": "plcdesk-admin" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, data: { error: "network" } };
    }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/api/admin/login") { showLogin(); }
    return { ok: r.ok, status: r.status, data };
  }
  function errText(res) {
    const e = res.data?.error || "";
    if (res.status === 0) return t("err_net");
    if (res.status === 503) return t("err_closed");
    if (res.status === 403) return t("err_forbidden");
    if (res.status === 404) return t("not_found");
    if (e === "canceled") return t("canceled_err");
    const k = e.replace(/\s+/g, "_");
    return I18N.cs[k] ? t(k) : t("err_server");
  }
  const msg = (text, cls = "") => h("p", { class: `adm-msg ${cls}`, role: "status", text });

  // ------------------------------------------------------------ dialog
  function ask({ title, text, ok, danger, input }) {
    const dlg = $("#dlg");
    $("#dlg-h").textContent = title;
    $("#dlg-p").textContent = text;
    const okBtn = $("#dlg-ok");
    okBtn.textContent = ok;
    okBtn.className = danger ? "btn btn-sm btn-danger" : "btn btn-sm";
    const field = $("#dlg-field"), inp = $("#dlg-input");
    field.hidden = !input;
    if (input) {
      $("#dlg-label").textContent = input.label;
      for (const a of ["type", "min", "max", "step"]) input[a] != null ? inp.setAttribute(a, input[a]) : inp.removeAttribute(a);
      inp.value = input.value ?? "";
    }
    return new Promise((resolve) => {
      const done = (v) => { dlg.removeEventListener("close", onClose); resolve(v); };
      const onClose = () => done(dlg.returnValue === "ok" ? (input ? inp.value : true) : null);
      dlg.addEventListener("close", onClose);
      $("#dlg-cancel").onclick = () => dlg.close("cancel");
      dlg.returnValue = "";
      dlg.showModal();
      (input ? inp : $("#dlg-cancel")).focus();
    });
  }

  // ------------------------------------------------------------ stav a hlavicka
  let me = null;

  function applyStatic() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll("[data-t-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tAria)));
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    const who = $("#who");
    if (me) {
      who.hidden = false;
      who.textContent = me.via === "access" ? t("who_access", { e: me.actor }) : t("who_token", { t: me.expires_at ? new Intl.DateTimeFormat(fmtLocale(), { timeStyle: "short" }).format(new Date(me.expires_at)) : "?" });
    } else who.hidden = true;
  }

  function showLogin(message) {
    me = null;
    $("#nav").hidden = true;
    $("#logout").hidden = true;
    $("#access-logout").hidden = true;
    view.hidden = true;
    view.replaceChildren();
    $("#login").hidden = false;
    applyStatic();
    const m = $("#login-msg");
    m.textContent = message || "";
    m.className = "adm-msg" + (message ? " err" : "");
    $("#token").focus();
  }

  async function start() {
    const r = await api("GET", "/api/admin/me");
    if (!r.ok) {
      showLogin(r.status === 503 ? t("err_closed") : r.status === 403 ? t("err_forbidden") : r.status === 401 ? "" : errText(r));
      return;
    }
    me = r.data;
    $("#login").hidden = true;
    $("#nav").hidden = false;
    view.hidden = false;
    $("#logout").hidden = me.via !== "token";
    const al = $("#access-logout");
    al.hidden = me.via !== "access";
    if (me.via === "access") al.setAttribute("href", "/cdn-cgi/access/logout");
    applyStatic();
    route();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("#token").value;
    const m = $("#login-msg");
    if (!token) { m.textContent = t("login_empty"); m.className = "adm-msg err"; return; }
    const btn = e.submitter || $("#login-form button[type=submit]");
    btn.disabled = true;
    const r = await api("POST", "/api/admin/login", { token });
    btn.disabled = false;
    if (r.ok) { $("#token").value = ""; m.textContent = ""; start(); return; }
    m.className = "adm-msg err";
    m.textContent = r.status === 401 ? t("login_wrong")
      : r.status === 429 ? t("login_many", { n: Math.max(1, Math.ceil((r.data.retry_after || 900) / 60)) })
      : r.status === 503 ? t("login_closed") : r.status === 403 ? t("login_forbidden") : errText(r);
  });

  $("#logout").addEventListener("click", async () => {
    await api("POST", "/api/admin/logout", {});
    showLogin();
  });

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    lang = b.dataset.lang;
    try { localStorage.setItem("plcstudio.admin.lang", lang); } catch { /* bez uloziste */ }
    applyStatic();
    if (me) route();
  }));

  // ------------------------------------------------------------ smerovani (#/pohled?parametry)
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [p, qs] = raw.split("?");
    const parts = p.split("/").map((x) => { try { return decodeURIComponent(x); } catch { return ""; } });
    return { name: parts[0] || "prehled", arg: parts[1] || "", params: new URLSearchParams(qs || "") };
  }
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  window.addEventListener("hashchange", () => { if (me) route(); });

  let seq = 0;
  async function route() {
    const r = parseHash();
    const navName = r.name === "zakaznik" ? "zakaznici" : r.name;
    document.querySelectorAll("#nav a").forEach((a) => (a.dataset.view === navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const my = ++seq;
    view.replaceChildren(msg(t("loading")));
    const render = { prehled: vOverview, zakaznici: vCustomers, zakaznik: vCustomer, nova: vNew, audit: vAudit }[r.name] || vOverview;
    const node = await render(r);
    if (my === seq && node) { view.replaceChildren(node); window.scrollTo(0, 0); }
  }

  // ------------------------------------------------------------ prehled
  async function vOverview() {
    const r = await api("GET", "/api/admin/summary");
    if (!r.ok) return msg(errText(r), "err");
    const s = r.data;
    const plans = Object.entries(s.licenses.active).map(([p, n]) => `${planName(p)} ${n}`).join(" · ");
    const card = (label, n, small, cls) => h("div", { class: `adm-card ${cls || ""}` }, h("b", { text: String(n) }), h("span", { text: label }), small ? h("small", { text: small }) : null);
    const exp = (type) => h("a", { class: "btn btn-ghost btn-sm", href: `/api/admin/export.csv?type=${type}`, download: "" }, t("ex_" + type));
    return h("div", {},
      h("div", { class: "adm-title" }, h("h1", { text: t("ov_h") }), h("span", { class: "adm-muted", text: t("ov_generated", { t: fmtDT(s.generated_at) }) })),
      h("div", { class: "adm-cards" },
        card(t("ov_leads7"), s.leads.d7),
        card(t("ov_leads30"), s.leads.d30, t("ov_leads_total", { n: s.leads.total, d: s.leads.downloaded })),
        card(t("ov_active"), s.licenses.active_total, plans || null, "good"),
        card(t("ov_past_due"), s.licenses.past_due, null, s.licenses.past_due ? "warn" : ""),
        card(t("ov_expired"), s.licenses.expired, null, s.licenses.expired ? "warn" : ""),
        card(t("ov_canceled"), s.licenses.canceled),
        card(t("ov_devices"), s.activations),
        card(t("ov_payments"), s.payments_30d),
        card(t("ov_unlocks"), s.unlocks)),
      panel(t("ov_export_h"), h("p", { class: "adm-hint", text: t("ov_export_p") }), h("div", { class: "adm-actions" }, exp("customers"), exp("licenses"), exp("leads"))));
  }

  // ------------------------------------------------------------ zakaznici
  async function vCustomers(r) {
    const q = r.params.get("q") || "", status = r.params.get("status") || "", page = Number(r.params.get("page")) || 1;
    const res = await api("GET", `/api/admin/customers?${new URLSearchParams({ q, status, page })}`);
    const qIn = h("input", { type: "search", name: "q", value: q, maxlength: 100, autocomplete: "off", spellcheck: "false" });
    const sel = h("select", { name: "status" }, h("option", { value: "", text: t("cu_all") }), STATES.map((s) => h("option", { value: s, text: t("st_" + s), selected: s === status })));
    const form = h("form", { class: "adm-filter", role: "search", onsubmit: (e) => { e.preventDefault(); go(`#/zakaznici?${new URLSearchParams({ q: qIn.value.trim(), status: sel.value })}`); } },
      h("label", { class: "adm-field" }, h("span", { text: t("cu_q") }), qIn),
      h("label", { class: "adm-field narrow" }, h("span", { text: t("cu_status") }), sel),
      h("button", { class: "btn btn-sm", type: "submit", text: t("cu_search") }));
    sel.addEventListener("change", () => form.requestSubmit());
    if (!res.ok) return h("div", {}, h("h1", { text: t("cu_h") }), form, msg(errText(res), "err"));
    const d = res.data;
    const open = (c) => go(`#/zakaznik/${encodeURIComponent(c.email)}`);
    const pg = (p) => go(`#/zakaznici?${new URLSearchParams({ q, status, page: p })}`);
    return h("div", {},
      h("div", { class: "adm-title" }, h("h1", { text: t("cu_h") }), h("span", { class: "adm-count", text: t("cu_total", { n: d.total }) })),
      form,
      table(
        [{ label: t("col_email") }, { label: t("col_status") }, { label: t("col_plan") }, { label: t("col_valid") }, { label: t("col_devices"), cls: "num" }, { label: t("col_last") }],
        d.customers,
        (c) => [h("a", { href: `#/zakaznik/${encodeURIComponent(c.email)}`, text: c.email }), stamp(c.status), c.plan ? planName(c.plan) : "—", fmtD(c.valid_until), String(c.devices), fmtDT(c.last_activity || null)],
        { empty: t("cu_none"), onRow: open }),
      d.pages > 1 ? h("div", { class: "adm-pager" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: d.page <= 1, onclick: () => pg(d.page - 1), text: t("prev") }),
        h("span", { text: t("page", { p: d.page, n: d.pages }) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: d.page >= d.pages, onclick: () => pg(d.page + 1), text: t("next") })) : null);
  }

  // ------------------------------------------------------------ detail zakaznika
  function licenseResult(key, file, sent, mailError) {
    const ta = h("textarea", { readonly: true, rows: 4, spellcheck: "false", "aria-label": t("res_file") });
    ta.value = file;
    const copyBtn = (getText) => {
      const b = h("button", { class: "btn btn-ghost btn-xs", type: "button", text: t("copy") });
      b.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(getText()); b.textContent = t("copied"); } catch { ta.select(); }
      });
      return b;
    };
    return h("div", { class: "adm-result" },
      h("div", { class: "adm-copy" }, h("strong", { text: t("res_key") + ":" }), h("span", { class: "adm-mono", text: key }), copyBtn(() => key)),
      h("div", { class: "adm-copy" }, h("strong", { text: t("res_file") + ":" }), copyBtn(() => file)),
      ta,
      sent ? h("p", { class: "adm-hint", text: t("res_sent") }) : null,
      mailError ? h("p", { class: "adm-msg err", text: t("res_mail_error") }) : null);
  }

  async function vCustomer(r) {
    const email = r.arg;
    const res = await api("GET", `/api/admin/customer?${new URLSearchParams({ email })}`);
    const back = h("a", { href: "#/zakaznici", class: "btn btn-ghost btn-sm", text: t("de_back") });
    if (!res.ok) return h("div", {}, h("div", { class: "adm-actions" }, back), msg(errText(res), "err"));
    const d = res.data;
    const flash = h("div", { "aria-live": "polite" });
    const say = (text, cls) => flash.replaceChildren(msg(text, cls));
    const reload = async (after) => { const node = await vCustomer(r); view.replaceChildren(node); if (after) after(node); };

    const best = d.licenses.find((l) => l.status === "active" && l.valid_until >= new Date().toISOString()) || d.licenses[0];
    const status = best ? (best.status === "active" && best.valid_until < new Date().toISOString() ? "expired" : best.status) : d.lead?.confirmed_at ? "downloaded" : "lead";

    // lead
    const yn = (v) => (v ? t("yes") : t("no"));
    const leadPanel = panel(t("de_lead_h"), d.lead
      ? h("dl", { class: "adm-dl" },
          h("dt", { text: t("de_lead_at") }), h("dd", { text: fmtDT(d.lead.created_at) }),
          h("dt", { text: t("de_terms") }), h("dd", { text: fmtDT(d.lead.terms_accepted_at) }),
          h("dt", { text: t("de_first_dl") }), h("dd", { text: fmtDT(d.lead.confirmed_at) }),
          h("dt", { text: t("de_links") }), h("dd", { text: `${d.lead.links} / ${d.lead.downloads}` }),
          h("dt", { text: t("de_locale") }), h("dd", { text: d.lead.locale || "—" }),
          h("dt", { text: t("de_source") }), h("dd", { text: d.lead.source || "—" }),
          h("dt", { text: t("de_unsub") }), h("dd", { text: yn(d.lead.unsubscribed) }))
      : h("p", { class: "adm-empty", text: t("de_no_lead") }),
      d.unlocks.length ? h("div", {}, h("h2", { text: t("de_unl_h") }),
        table([{ label: t("col_project") }, { label: t("col_io"), cls: "num" }, { label: t("col_at") }], d.unlocks,
          (u) => [h("span", { class: "adm-mono", text: u.project_id }), u.io_count == null ? "—" : String(u.io_count), fmtDT(u.granted_at)])) : null);

    // licence
    const extendLic = async (l) => {
      const days = await ask({ title: t("dlg_extend_h"), text: t("dlg_extend_p", { k: shortKey(l.key), e: d.email, d: fmtD(l.valid_until) }),
        ok: t("dlg_extend_ok"), input: { label: t("dlg_days"), type: "number", min: 1, max: 3650, step: 1, value: l.plan === "trial" ? 14 : 365 } });
      if (days == null) return;
      const x = await api("POST", "/api/admin/license", { action: "extend", key: l.key, days: Number(days) });
      if (!x.ok) return say(errText(x), "err");
      await reload(() => { const f = $("#flash"); if (f) f.replaceChildren(msg(t("ok_extended", { d: fmtD(x.data.valid_until) }), "ok"), licenseResult(x.data.key, x.data.license, x.data.sent, x.data.mail_error)); });
    };
    const cancelLic = async (l) => {
      const ok = await ask({ title: t("dlg_cancel_h"), text: t("dlg_cancel_p", { k: shortKey(l.key), e: d.email }), ok: t("dlg_cancel_ok"), danger: true });
      if (!ok) return;
      const x = await api("POST", "/api/admin/license", { action: "cancel", key: l.key });
      if (!x.ok) return say(errText(x), "err");
      const text = x.data.already ? t("already") : x.data.subscription_provider ? t("ok_canceled_sub", { p: x.data.subscription_provider }) : t("ok_canceled");
      await reload(() => { const f = $("#flash"); if (f) f.replaceChildren(msg(text, x.data.subscription_provider ? "err" : "ok")); });
    };
    const licPanel = panel([t("de_lic_h"), h("span", { class: "adm-count", text: String(d.licenses.length) })],
      table(
        [{ label: t("col_key") }, { label: t("col_plan") }, { label: t("col_status") }, { label: t("col_valid") }, { label: t("col_seats"), cls: "num" }, { label: t("col_provider") }, { label: t("col_note") }, { label: t("col_actions") }],
        d.licenses,
        (l) => {
          const st = l.status === "active" && l.valid_until < new Date().toISOString() ? "expired" : l.status;
          return [h("span", { class: "adm-mono", text: l.key }), planName(l.plan), stamp(st), fmtD(l.valid_until), String(l.seats),
            l.payment_provider ? `${l.payment_provider}${l.sub_id ? " · " + l.sub_id : ""}` : "—", l.note || "—",
            l.status === "canceled" ? "—" : h("div", { class: "adm-actions" },
              h("button", { class: "btn btn-ghost btn-xs", type: "button", onclick: () => extendLic(l), text: t("act_extend") }),
              h("button", { class: "btn btn-danger btn-xs", type: "button", onclick: () => cancelLic(l), text: t("act_cancel") }))];
        },
        { empty: t("de_no_lic") }));

    // pocitace
    const release = async (a) => {
      const ok = await ask({ title: t("dlg_release_h"), text: t("dlg_release_p", { l: a.device_label || a.device_hash, k: shortKey(a.license_key) }), ok: t("dlg_release_ok"), danger: true });
      if (!ok) return;
      const x = await api("POST", "/api/admin/activation/release", { id: a.id });
      if (!x.ok) return say(errText(x), "err");
      await reload(() => { const f = $("#flash"); if (f) f.replaceChildren(msg(x.data.already ? t("already") : t("ok_released"), "ok")); });
    };
    const devPanel = panel([t("de_dev_h"), h("span", { class: "adm-count", text: String(d.activations.filter((a) => !a.revoked_at).length) })],
      table(
        [{ label: t("col_device") }, { label: t("col_key") }, { label: t("col_hash") }, { label: t("col_seen") }, { label: t("col_created") }, { label: t("col_actions") }],
        d.activations,
        (a) => [a.device_label || "—", h("span", { class: "adm-mono", text: shortKey(a.license_key) }), h("span", { class: "adm-mono", text: a.device_hash + "…" }),
          fmtDT(a.last_seen_at), fmtDT(a.created_at),
          a.revoked_at ? h("span", {}, stamp("revoked"), " ", fmtD(a.revoked_at))
            : h("button", { class: "btn btn-danger btn-xs", type: "button", onclick: () => release(a), text: t("act_release") })],
        { empty: t("de_no_dev"), rowClass: (a) => (a.revoked_at ? "revoked" : null) }));

    // platby
    const payPanel = panel(t("de_pay_h"),
      table([{ label: t("col_at") }, { label: t("col_provider") }, { label: t("col_type") }, { label: t("col_sub") }], d.payments,
        (p) => [fmtDT(p.received_at), p.provider, h("span", { class: "adm-mono", text: p.type || "—" }), h("span", { class: "adm-mono", text: p.sub_id || "—" })],
        { empty: t("de_no_pay") }),
      h("p", { class: "adm-note-box", text: t("de_pay_hint") }));

    // poznamky
    const ta = h("textarea", { maxlength: 2000, rows: 3, placeholder: t("de_note_ph"), "aria-label": t("de_note_add") });
    const noteMsg = h("p", { class: "adm-msg", role: "status" });
    const noteForm = h("form", { class: "adm-form", onsubmit: async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      const x = await api("POST", "/api/admin/note", { email: d.email, body });
      if (!x.ok) { noteMsg.className = "adm-msg err"; noteMsg.textContent = errText(x); return; }
      await reload(() => { const f = $("#flash"); if (f) f.replaceChildren(msg(t("de_note_saved"), "ok")); });
    } }, ta, h("div", { class: "adm-actions" }, h("button", { class: "btn btn-sm", type: "submit", text: t("de_note_add") })), noteMsg);
    const notesPanel = panel([t("de_notes_h"), h("span", { class: "adm-count", text: String(d.notes.length) })],
      d.notes.length ? h("ul", { class: "adm-notes" }, d.notes.map((n) => h("li", {}, h("p", { text: n.body }), h("small", { text: `${fmtDT(n.created_at)} · ${n.author}` }))))
        : h("p", { class: "adm-empty", text: t("de_no_notes") }),
      noteForm);

    flash.id = "flash";
    return h("div", {},
      h("div", { class: "adm-actions adm-back" }, back),
      h("div", { class: "adm-title" },
        h("h1", { text: d.email }),
        h("div", { class: "adm-actions" }, stamp(status), h("a", { class: "btn btn-sm", href: `#/nova?${new URLSearchParams({ email: d.email })}`, text: t("de_new_lic") }))),
      flash,
      licPanel,
      devPanel,
      h("div", { class: "adm-grid2" }, leadPanel, notesPanel),
      payPanel);
  }

  // ------------------------------------------------------------ nova licence
  async function vNew(r) {
    const mailDirect = me?.mail_mode === "direct";
    const email = h("input", { type: "email", name: "email", required: true, maxlength: 253, autocomplete: "off", spellcheck: "false", value: r.params.get("email") || "" });
    const plan = h("select", { name: "plan" }, PLANS.map((p) => h("option", { value: p, text: planName(p) })));
    const days = h("input", { type: "number", name: "days", min: 1, max: 3650, step: 1, value: PLAN_DEFAULTS.pro.days });
    const until = h("input", { type: "date", name: "valid_until" });
    const seats = h("input", { type: "number", name: "seats", min: 1, max: 100, step: 1, value: PLAN_DEFAULTS.pro.seats });
    const note = h("input", { type: "text", name: "note", maxlength: 200 });
    const send = h("input", { type: "checkbox", name: "send", disabled: mailDirect });
    plan.addEventListener("change", () => { const dft = PLAN_DEFAULTS[plan.value]; days.value = dft.days; seats.value = dft.seats; });
    const out = h("div", { "aria-live": "polite" });
    const submit = h("button", { class: "btn", type: "submit", text: t("nl_submit") });
    const form = h("form", { class: "adm-form-grid", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const body = { action: "issue", email: email.value.trim().toLowerCase(), plan: plan.value, seats: Number(seats.value), note: note.value.trim() || undefined, send: send.checked };
      if (until.value) body.valid_until = until.value; else body.days = Number(days.value);
      const vuText = until.value ? fmtD(until.value + "T12:00:00Z") : fmtD(new Date(Date.now() + Number(days.value) * 864e5).toISOString());
      const ok = await ask({ title: t("nl_confirm_h"), text: t("nl_confirm_p", { plan: planName(body.plan), e: body.email, s: body.seats, d: vuText }), ok: t("nl_submit") });
      if (!ok) return;
      submit.disabled = true;
      const x = await api("POST", "/api/admin/license", body);
      submit.disabled = false;
      if (!x.ok) { out.replaceChildren(msg(errText(x), "err")); return; }
      out.replaceChildren(msg(t("nl_ok"), "ok"), licenseResult(x.data.key, x.data.license, x.data.sent, x.data.mail_error),
        h("a", { class: "btn btn-ghost btn-sm", href: `#/zakaznik/${encodeURIComponent(body.email)}`, text: body.email + " →" }));
      note.value = "";
    } },
      h("label", { class: "adm-field wide" }, h("span", { text: t("nl_email") }), email),
      h("label", { class: "adm-field" }, h("span", { text: t("nl_plan") }), plan),
      h("label", { class: "adm-field" }, h("span", { text: t("nl_seats") }), seats),
      h("label", { class: "adm-field" }, h("span", { text: t("nl_days") }), days),
      h("label", { class: "adm-field" }, h("span", { text: t("nl_until") }), until),
      h("label", { class: "adm-field wide" }, h("span", { text: t("nl_note") }), note),
      h("div", { class: "adm-field wide" },
        h("label", { class: "adm-check" }, send, h("span", { text: t("nl_send") })),
        mailDirect ? h("p", { class: "adm-hint", text: t("nl_send_direct") }) : null),
      h("div", { class: "wide adm-actions" }, submit));
    return h("div", {}, h("h1", { text: t("nl_h") }), h("p", { class: "adm-hint", text: t("nl_hint") }), h("section", { class: "adm-panel" }, form), out);
  }

  // ------------------------------------------------------------ audit
  async function vAudit(r) {
    const q = r.params.get("q") || "", page = Number(r.params.get("page")) || 1;
    const res = await api("GET", `/api/admin/audit?${new URLSearchParams({ q, page })}`);
    const qIn = h("input", { type: "search", value: q, maxlength: 100, autocomplete: "off", spellcheck: "false" });
    const form = h("form", { class: "adm-filter", role: "search", onsubmit: (e) => { e.preventDefault(); go(`#/audit?${new URLSearchParams({ q: qIn.value.trim() })}`); } },
      h("label", { class: "adm-field" }, h("span", { text: t("au_q") }), qIn), h("button", { class: "btn btn-sm", type: "submit", text: t("cu_search") }));
    if (!res.ok) return h("div", {}, h("h1", { text: t("au_h") }), form, msg(errText(res), "err"));
    const d = res.data;
    const pg = (p) => go(`#/audit?${new URLSearchParams({ q, page: p })}`);
    const actName = (a) => (I18N.cs["a_" + a] ? t("a_" + a) : a);
    return h("div", {},
      h("div", { class: "adm-title" }, h("h1", { text: t("au_h") }), h("span", { class: "adm-count", text: t("au_total", { n: d.total }) })),
      h("p", { class: "adm-hint", text: t("au_hint") }),
      form,
      table(
        [{ label: t("col_at") }, { label: t("col_actor") }, { label: t("col_via") }, { label: t("col_action") }, { label: t("col_target") }, { label: t("col_detail") }, { label: t("col_ip") }],
        d.entries,
        (a) => [fmtDT(a.at), a.actor, a.via, actName(a.action), h("span", { class: "adm-mono", text: a.target || "—" }), a.detail || "—", h("span", { class: "adm-mono", text: a.ip || "—" })],
        { empty: t("au_none") }),
      d.pages > 1 ? h("div", { class: "adm-pager" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: d.page <= 1, onclick: () => pg(d.page - 1), text: t("prev") }),
        h("span", { text: t("page", { p: d.page, n: d.pages }) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: d.page >= d.pages, onclick: () => pg(d.page + 1), text: t("next") })) : null);
  }

  applyStatic();
  start();
})();
