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
      // obchodni kanban
      nav_leads: "Leady", crm_h: "Leady", crm_total: "{n} karta|{n} karty|{n} karet", crm_shown: "zobrazeno {n} z {t}", crm_new: "Nový lead", crm_import: "Import JSON",
      crm_export: "Export CSV", crm_q: "Hledat firmu, město, web, e-mail, další krok", crm_segment: "Segment", crm_country: "Země",
      crm_all_segments: "Všechny segmenty", crm_all_countries: "Všechny země", crm_filter: "Filtrovat", crm_reset: "Zrušit filtr",
      crm_synced: "Z formuláře ke stažení přibylo karet: {n}.", crm_more: "a dalších {n} — zužte filtr",
      crm_hint: "Přetáhněte kartu do jiného sloupce, nebo použijte šipky na kartě (s fokusem na kartě také Alt+← / Alt+→). Zájemci z formuláře ke stažení se sem přidávají sami ve sloupci Nový.",
      crm_hint_mob: "Sloupec vyberte nahoře, fázi karty změníte výběrem na kartě. Zájemci z formuláře ke stažení přibývají sami ve sloupci Nový.",
      crm_board: "Obchodní kanban", crm_col_show: "Zobrazit sloupec", crm_empty_col: "Prázdné", crm_collapse: "Sbalit", crm_expand: "Rozbalit ztracené",
      stage_prospect: "Prospekce", stage_new: "Nový", stage_contacted: "Kontaktován", stage_trial: "Zkouší", stage_offer: "Nabídka",
      stage_won: "Zákazník", stage_lost: "Ztracen",
      seg_integrator: "Integrátor", seg_strojirna: "Strojírna", seg_vyrobce: "Výrobce", seg_jine: "Jiné",
      src_web_form: "Formulář", src_research: "Průzkum", src_manual: "Ručně", src_import: "Import",
      crm_move_to: "Přesunout do: {s}", crm_move_label: "Fáze", crm_moved: "{c}: přesunuto do „{s}“.", crm_overdue: "po termínu",
      crm_today: "dnes", crm_suggest: "Má aktivní licenci", crm_suggest_btn: "Přesunout do Zákazník", crm_next: "Další krok",
      crm_lost_h: "Označit jako ztracený", crm_lost_p: "{c} — důvod pomůže při dalším oslovení (nepovinné, max. 300 znaků).", crm_lost_reason: "Důvod",
      crm_lost_ok: "Přesunout do Ztracen",
      // detail karty
      ld_back: "← Leady", ld_new_h: "Nový lead", ld_fields: "Údaje o firmě", ld_contact: "Kontakt (jen ručně)", ld_sales: "Obchod",
      ld_company: "Firma", ld_segment: "Segment", ld_website: "Web", ld_country: "Země (kód, např. CZ)", ld_city: "Město",
      ld_source_url: "Zdroj (odkaz)", ld_email: "E-mail", ld_contact_name: "Kontaktní osoba", ld_phone: "Telefon",
      ld_value_czk: "Odhad hodnoty (Kč / rok)", ld_value_note: "Poznámka k hodnotě", ld_next_action: "Další krok", ld_next_date: "Termín",
      ld_owner: "Kdo má na starosti", ld_lost_reason: "Důvod ztráty", ld_stage: "Fáze", ld_save: "Uložit", ld_create: "Založit",
      ld_saved: "Uloženo.", ld_unchanged: "Beze změny.", ld_created: "Karta založena.",
      ld_personal: "Jméno, telefon a e-mail kontaktní osoby doplňujte jen ručně a jen pro obchodní komunikaci s firmou (B2B). Firmy z průzkumu nesou jen firemní údaje. Při námitce kartu smažte.",
      ld_info: "Původ", ld_source: "Zdroj", ld_created_at: "Založeno", ld_updated_at: "Změněno", ld_open_web: "Otevřít web",
      ld_open_source: "Otevřít zdroj", ld_customer: "Zákazník ve správě", ld_customer_link: "Otevřít detail zákazníka",
      ld_history: "Historie", ld_no_events: "Zatím bez událostí.", ld_note: "Poznámka", ld_contact_ev: "Kontakt (hovor, e-mail, schůzka)",
      ld_note_ph: "Co se stalo, na čem jste se domluvili (max. 2000 znaků)", ld_note_add: "Zapsat", ld_note_saved: "Zapsáno.",
      ld_delete: "Smazat kartu", ld_delete_h: "Smazat kartu?", ld_delete_p: "{c} se smaže i s historií. Pokud karta nese e-mail, synchronizace z formuláře ji znovu nezaloží. Akce se zapíše do auditu.",
      ld_deleted: "Karta smazána.", ld_dup_email: "Karta se stejným e-mailem už existuje: {c}.", ld_dup_domain: "Firma se stejnou doménou už v kanbanu je: {c}.",
      ld_dup_open: "Otevřít existující", ld_dup_save: "Přesto uložit (pobočka, divize)",
      ev_create: "Založeno ručně", ev_import_web_form: "Z formuláře ke stažení", ev_import_research: "Import z průzkumu", ev_edit: "Upraveno: {f}",
      ev_stage: "Fáze: {a} → {b}", ev_contact: "Kontakt", ev_note: "Poznámka",
      // import
      im_h: "Import ze souboru průzkumu", im_file: "Soubor {f}: {n} řádek|Soubor {f}: {n} řádky|Soubor {f}: {n} řádků", im_new: "Nové", im_dup: "Duplicity", im_invalid: "Neplatné",
      im_personal: "Řádků s vynechaným jménem nebo telefonem: {n} (z průzkumu jen firemní údaje).", im_go: "Importovat {n}", im_cancel: "Zrušit",
      im_done: "Importováno karet: {n} (sloupec Prospekce).", im_none: "Nic nového k importu.", im_dup_rows: "Duplicity (řádek, firma, důvod)",
      im_invalid_rows: "Neplatné řádky", im_by_email: "stejný e-mail", im_by_domain: "stejná doména", im_by_file: "opakuje se v souboru",
      im_bad_file: "Soubor není platný JSON se seznamem firem (pole objektů, nebo {\"leads\": [...]}).", im_too_big: "Soubor je příliš velký (max. 700 kB).",
      im_too_many: "Najednou jde importovat nejvýš {n} řádků — soubor rozdělte.",
      im_hint: "JSON: pole objektů s poli company (povinné), website, segment, country, city, source_url, note. Deduplikace podle domény webu a e-mailu. Jména a telefony se z průzkumu neimportují.",
      bad_company: "Vyplňte název firmy (max. 200 znaků).", bad_website: "Neplatný web (jen http/https nebo doména).", bad_source_url: "Neplatný odkaz na zdroj (jen http/https).",
      bad_segment: "Neznámý segment.", bad_country: "Země jako dvoupísmenný kód (CZ, DE, SK…).", bad_next_date: "Neplatné datum.",
      bad_value_czk: "Hodnota jako celé číslo v Kč.", bad_phone: "Neplatný telefon.", bad_stage: "Neznámá fáze.", bad_contact_name: "Jméno je příliš dlouhé.",
      bad_city: "Město je příliš dlouhé.", bad_value_note: "Poznámka k hodnotě je příliš dlouhá.", bad_next_action: "Další krok je příliš dlouhý.",
      bad_owner: "Příliš dlouhé.", bad_lost_reason: "Důvod je příliš dlouhý (max. 300 znaků).", bad_row: "není objekt", bad_leads: "Prázdný seznam.",
      too_many: "Příliš mnoho řádků.", too_large: "Požadavek je příliš velký.",
      a_crm_sync: "leady z formuláře", a_crm_view: "zobrazení leadu", a_crm_lead_create: "nový lead", a_crm_lead_update: "úprava leadu",
      a_crm_move: "přesun leadu", a_crm_note: "poznámka k leadu", a_crm_delete: "smazání leadu", a_crm_import: "import leadů",
      // interni dokumenty (obsah jen v D1)
      nav_docs: "Dokumenty", dc_h: "Dokumenty", dc_total: "{n} dokument|{n} dokumenty|{n} dokumentů", dc_none: "Zatím žádný dokument.",
      dc_hint: "Interní dokumenty provozovatele. Obsah je uložený jen v databázi správy (ne v repozitáři ani na veřejném webu) a čte ho jen přihlášený provozovatel.",
      dc_new_h: "Nový dokument", dc_slug: "Označení v adrese (a–z, 0–9, pomlčka)", dc_title: "Název", dc_create: "Založit",
      dc_exists: "Dokument s tímto označením už existuje.", dc_open: "Otevřít", col_title: "Název", col_updated: "Změněno", col_by: "Kdo",
      col_size: "Velikost", dc_back: "← Dokumenty", dc_edit: "Upravit", dc_save: "Uložit", dc_cancel: "Zrušit", dc_saved: "Uloženo (verze {v}).",
      dc_unchanged: "Beze změny.", dc_meta: "Verze {v} · změněno {t} · {w}", dc_empty: "Dokument je prázdný — doplňte ho tlačítkem Upravit.",
      dc_conflict: "Dokument mezitím změnil někdo jiný (verze {v}, {w}). Vaše úpravy nejsou uložené — zkopírujte si je, načtěte aktuální verzi a změny zapracujte znovu.",
      dc_reload: "Načíst aktuální verzi", dc_task_conflict: "Dokument mezitím změnil někdo jiný — načetla se aktuální verze, zkuste to znovu.",
      dc_discard_h: "Zahodit úpravy?", dc_discard_p: "Neuložené změny dokumentu se ztratí.", dc_discard_ok: "Zahodit",
      dc_md_help: "Markdown: # nadpis, **tučně**, *kurzíva*, `kód`, [odkaz](https://…), - odrážka, 1. seznam, - [ ] úkol, | tabulka |, ``` kód, > citace, --- čára.",
      dc_size: "{k} kB z 256 kB", dc_task_label: "Úkol hotový", dc_link: "odkaz",
      bad_slug: "Označení jen malá písmena bez diakritiky, číslice a pomlčka (max. 64 znaků).", bad_title: "Vyplňte název (max. 200 znaků).",
      bad_index: "Úkol v dokumentu nenalezen — načtěte dokument znovu.", bad_version: "Neplatná verze dokumentu.",
      a_doc_save: "uložení dokumentu", a_doc_task: "úkol v dokumentu",
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
      nav_leads: "Leads", crm_h: "Leads", crm_total: "{n} card|{n} cards", crm_shown: "showing {n} of {t}", crm_new: "New lead", crm_import: "Import JSON",
      crm_export: "Export CSV", crm_q: "Search company, city, website, e-mail, next step", crm_segment: "Segment", crm_country: "Country",
      crm_all_segments: "All segments", crm_all_countries: "All countries", crm_filter: "Filter", crm_reset: "Clear filter",
      crm_synced: "New cards from the download form: {n}.", crm_more: "and {n} more — narrow the filter",
      crm_hint: "Drag a card to another column, or use the arrows on the card (with focus on a card also Alt+← / Alt+→). Download-form leads are added automatically to the New column.",
      crm_hint_mob: "Pick the column above, change a card's stage with the select on the card. Download-form leads are added automatically to the New column.",
      crm_board: "Sales kanban", crm_col_show: "Show column", crm_empty_col: "Empty", crm_collapse: "Collapse", crm_expand: "Expand lost",
      stage_prospect: "Prospect", stage_new: "New", stage_contacted: "Contacted", stage_trial: "Trial", stage_offer: "Offer",
      stage_won: "Customer", stage_lost: "Lost",
      seg_integrator: "Integrator", seg_strojirna: "Machine builder", seg_vyrobce: "Manufacturer", seg_jine: "Other",
      src_web_form: "Form", src_research: "Research", src_manual: "Manual", src_import: "Import",
      crm_move_to: "Move to: {s}", crm_move_label: "Stage", crm_moved: "{c}: moved to “{s}”.", crm_overdue: "overdue",
      crm_today: "today", crm_suggest: "Has an active licence", crm_suggest_btn: "Move to Customer", crm_next: "Next step",
      crm_lost_h: "Mark as lost", crm_lost_p: "{c} — a reason helps next time (optional, max. 300 characters).", crm_lost_reason: "Reason",
      crm_lost_ok: "Move to Lost",
      ld_back: "← Leads", ld_new_h: "New lead", ld_fields: "Company", ld_contact: "Contact (manual only)", ld_sales: "Sales",
      ld_company: "Company", ld_segment: "Segment", ld_website: "Website", ld_country: "Country (code, e.g. CZ)", ld_city: "City",
      ld_source_url: "Source (link)", ld_email: "E-mail", ld_contact_name: "Contact person", ld_phone: "Phone",
      ld_value_czk: "Estimated value (CZK / year)", ld_value_note: "Value note", ld_next_action: "Next step", ld_next_date: "Due",
      ld_owner: "Owner", ld_lost_reason: "Reason lost", ld_stage: "Stage", ld_save: "Save", ld_create: "Create",
      ld_saved: "Saved.", ld_unchanged: "No changes.", ld_created: "Card created.",
      ld_personal: "Add the contact person's name, phone and e-mail manually and only for business communication with the company (B2B). Researched companies carry company data only. Delete the card on objection.",
      ld_info: "Origin", ld_source: "Source", ld_created_at: "Created", ld_updated_at: "Changed", ld_open_web: "Open website",
      ld_open_source: "Open source", ld_customer: "Customer in admin", ld_customer_link: "Open customer details",
      ld_history: "History", ld_no_events: "No events yet.", ld_note: "Note", ld_contact_ev: "Contact (call, e-mail, meeting)",
      ld_note_ph: "What happened, what was agreed (max. 2000 characters)", ld_note_add: "Add", ld_note_saved: "Added.",
      ld_delete: "Delete card", ld_delete_h: "Delete card?", ld_delete_p: "{c} will be deleted with its history. If the card has an e-mail, the download-form sync will not create it again. The action is audited.",
      ld_deleted: "Card deleted.", ld_dup_email: "A card with the same e-mail already exists: {c}.", ld_dup_domain: "A company with the same domain is already on the board: {c}.",
      ld_dup_open: "Open existing", ld_dup_save: "Save anyway (branch, division)",
      ev_create: "Created manually", ev_import_web_form: "From the download form", ev_import_research: "Imported from research", ev_edit: "Edited: {f}",
      ev_stage: "Stage: {a} → {b}", ev_contact: "Contact", ev_note: "Note",
      im_h: "Import from research file", im_file: "File {f}: {n} row|File {f}: {n} rows", im_new: "New", im_dup: "Duplicates", im_invalid: "Invalid",
      im_personal: "Rows with name or phone left out: {n} (research carries company data only).", im_go: "Import {n}", im_cancel: "Cancel",
      im_done: "Cards imported: {n} (Prospect column).", im_none: "Nothing new to import.", im_dup_rows: "Duplicates (row, company, reason)",
      im_invalid_rows: "Invalid rows", im_by_email: "same e-mail", im_by_domain: "same domain", im_by_file: "repeated in the file",
      im_bad_file: "The file is not valid JSON with a list of companies (array of objects, or {\"leads\": [...]}).", im_too_big: "The file is too large (max. 700 kB).",
      im_too_many: "At most {n} rows can be imported at once — split the file.",
      im_hint: "JSON: array of objects with company (required), website, segment, country, city, source_url, note. Deduplicated by website domain and e-mail. Names and phone numbers are not imported from research.",
      bad_company: "Enter the company name (max. 200 characters).", bad_website: "Invalid website (http/https or a domain only).", bad_source_url: "Invalid source link (http/https only).",
      bad_segment: "Unknown segment.", bad_country: "Country as a two-letter code (CZ, DE, SK…).", bad_next_date: "Invalid date.",
      bad_value_czk: "Value as a whole number in CZK.", bad_phone: "Invalid phone number.", bad_stage: "Unknown stage.", bad_contact_name: "The name is too long.",
      bad_city: "The city is too long.", bad_value_note: "The value note is too long.", bad_next_action: "The next step is too long.",
      bad_owner: "Too long.", bad_lost_reason: "The reason is too long (max. 300 characters).", bad_row: "not an object", bad_leads: "Empty list.",
      too_many: "Too many rows.", too_large: "The request is too large.",
      a_crm_sync: "leads from form", a_crm_view: "lead viewed", a_crm_lead_create: "new lead", a_crm_lead_update: "lead edited",
      a_crm_move: "lead moved", a_crm_note: "lead note", a_crm_delete: "lead deleted", a_crm_import: "leads imported",
      nav_docs: "Documents", dc_h: "Documents", dc_total: "{n} document|{n} documents", dc_none: "No documents yet.",
      dc_hint: "Internal operator documents. The content is stored only in the admin database (not in the repository or on the public website) and only the signed-in operator can read it.",
      dc_new_h: "New document", dc_slug: "Address name (a–z, 0–9, hyphen)", dc_title: "Title", dc_create: "Create",
      dc_exists: "A document with this name already exists.", dc_open: "Open", col_title: "Title", col_updated: "Changed", col_by: "By",
      col_size: "Size", dc_back: "← Documents", dc_edit: "Edit", dc_save: "Save", dc_cancel: "Cancel", dc_saved: "Saved (version {v}).",
      dc_unchanged: "No changes.", dc_meta: "Version {v} · changed {t} · {w}", dc_empty: "The document is empty — fill it in with Edit.",
      dc_conflict: "Someone else changed the document in the meantime (version {v}, {w}). Your edits are not saved — copy them, load the current version and apply your changes again.",
      dc_reload: "Load current version", dc_task_conflict: "Someone else changed the document in the meantime — the current version was loaded, please try again.",
      dc_discard_h: "Discard edits?", dc_discard_p: "Unsaved changes to the document will be lost.", dc_discard_ok: "Discard",
      dc_md_help: "Markdown: # heading, **bold**, *italic*, `code`, [link](https://…), - bullet, 1. list, - [ ] task, | table |, ``` code, > quote, --- rule.",
      dc_size: "{k} kB of 256 kB", dc_task_label: "Task done", dc_link: "link",
      bad_slug: "Name may contain lowercase letters without accents, digits and hyphens only (max. 64 characters).", bad_title: "Enter a title (max. 200 characters).",
      bad_index: "Task not found in the document — reload the document.", bad_version: "Invalid document version.",
      a_doc_save: "document saved", a_doc_task: "document task",
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
      for (const a of ["type", "min", "max", "step", "maxlength"]) input[a] != null ? inp.setAttribute(a, input[a]) : inp.removeAttribute(a);
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
    // rozepsany dokument (docs): odchod jinam nebo prepnuti jazyka jen po potvrzeni
    if (docDirty && !(await leaveDirtyOk())) {
      if (location.hash !== docDirty) history.replaceState(null, "", docDirty);
      return;
    }
    const r = parseHash();
    const navName = r.name === "zakaznik" ? "zakaznici" : r.name === "lead" ? "leady" : r.name === "dokument" ? "dokumenty" : r.name;
    document.querySelectorAll("#nav a").forEach((a) => (a.dataset.view === navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const my = ++seq;
    view.replaceChildren(msg(t("loading")));
    const render = { prehled: vOverview, zakaznici: vCustomers, zakaznik: vCustomer, nova: vNew, audit: vAudit, leady: vLeads, lead: vLead, dokumenty: vDocs, dokument: vDoc }[r.name] || vOverview;
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

  // ------------------------------------------------------------ obchodni kanban leadu
  const STAGES = ["prospect", "new", "contacted", "trial", "offer", "won", "lost"];
  const SEGMENTS = ["integrator", "strojirna", "vyrobce", "jine"];
  const IMPORT_MAX = 500;
  const IMPORT_FILE_MAX = 700 * 1024;
  let lastBoardHash = "#/leady";

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* bez uloziste */ } };
  // tvary podle cisla: klic nese tvary oddelene | (cs 1 / 2-4 / 5+, en 1 / ostatni)
  const tn = (k, n, v = {}) => { const f = t(k, { ...v, n }).split("|"); const i = lang === "cs" ? (n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2) : n === 1 ? 0 : 1; return f[Math.min(i, f.length - 1)]; };
  const stageName = (s) => t("stage_" + s);
  const segName = (s) => (I18N.cs["seg_" + s] ? t("seg_" + s) : s || "—");
  const srcName = (s) => (I18N.cs["src_" + s] ? t("src_" + s) : s || "—");
  let regionNames = null;
  const countryName = (cc) => {
    if (!cc) return "";
    try {
      if (!regionNames || regionNames.lang !== lang) regionNames = { lang, dn: new Intl.DisplayNames([fmtLocale()], { type: "region" }) };
      return regionNames.dn.of(cc) || cc;
    } catch { return cc; }
  };
  const fmtCzk = (n) => new Intl.NumberFormat(fmtLocale(), { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(n);
  const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fmtDay = (s) => (s ? new Intl.DateTimeFormat(fmtLocale(), { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(`${s}T12:00:00`)) : "");
  // odkaz jen na http(s) - jine schema (javascript: aj.) se jako odkaz nevykresli
  const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const extLink = (u, text) => { const href = safeHref(u); return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", text: text || hostOf(u) }) : h("span", { text: u || "—" }); };

  // Presun karty na serveru (+ dotaz na duvod u "Ztracen"). Vraci true, kdyz se presun provedl.
  async function crmMove(card, stage, sayFn) {
    if (stage === card.stage) return false;
    const body = { id: card.id, stage };
    if (stage === "lost") {
      const reason = await ask({ title: t("crm_lost_h"), text: t("crm_lost_p", { c: card.company }), ok: t("crm_lost_ok"),
        input: { label: t("crm_lost_reason"), type: "text", maxlength: 300, value: "" } });
      if (reason == null) return false;
      if (reason.trim()) body.lost_reason = reason.trim();
    }
    const x = await api("POST", "/api/admin/crm/move", body);
    if (!x.ok) { sayFn(errText(x), "err"); return false; }
    return true;
  }

  async function vLeads(r) {
    const q = r.params.get("q") || "", segment = r.params.get("segment") || "", country = r.params.get("country") || "";
    lastBoardHash = location.hash || "#/leady";
    const res = await api("GET", `/api/admin/crm?${new URLSearchParams({ q, segment, country })}`);
    const live = h("p", { class: "adm-msg", role: "status", "aria-live": "polite" });
    const say = (text, cls = "") => { live.className = `adm-msg ${cls}`; live.textContent = text; };

    // filtr
    const qIn = h("input", { type: "search", name: "q", value: q, maxlength: 100, autocomplete: "off", spellcheck: "false" });
    const segSel = h("select", { name: "segment" }, h("option", { value: "", text: t("crm_all_segments") }), SEGMENTS.map((s) => h("option", { value: s, text: segName(s), selected: s === segment })));
    const ccSel = h("select", { name: "country" }, h("option", { value: "", text: t("crm_all_countries") }));
    const filterHash = () => `#/leady?${new URLSearchParams(Object.fromEntries(Object.entries({ q: qIn.value.trim(), segment: segSel.value, country: ccSel.value }).filter(([, v]) => v)))}`;
    const form = h("form", { class: "adm-filter", role: "search", onsubmit: (e) => { e.preventDefault(); go(filterHash()); } },
      h("label", { class: "adm-field" }, h("span", { text: t("crm_q") }), qIn),
      h("label", { class: "adm-field narrow" }, h("span", { text: t("crm_segment") }), segSel),
      h("label", { class: "adm-field narrow" }, h("span", { text: t("crm_country") }), ccSel),
      h("button", { class: "btn btn-sm", type: "submit", text: t("crm_filter") }),
      q || segment || country ? h("a", { class: "btn btn-ghost btn-sm", href: "#/leady", text: t("crm_reset") }) : null);
    segSel.addEventListener("change", () => form.requestSubmit());
    ccSel.addEventListener("change", () => form.requestSubmit());

    // import
    const importBox = h("div", { "aria-live": "polite" });
    const fileIn = h("input", { type: "file", accept: ".json,application/json", class: "crm-file", tabindex: "-1", "aria-hidden": "true" });
    const importBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("crm_import"), onclick: () => fileIn.click() });
    fileIn.addEventListener("change", () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ""; if (f) importPreview(f, importBox, say); });

    const head = h("div", { class: "adm-title" },
      h("h1", { text: t("crm_h") }),
      h("div", { class: "adm-actions" },
        res.ok ? h("span", { class: "adm-count", text: res.data.shown < res.data.total && (q || segment || country) ? t("crm_shown", { n: res.data.shown, t: res.data.total }) : tn("crm_total", res.data.total) }) : null,
        h("a", { class: "btn btn-sm", href: "#/lead/new", text: t("crm_new") }), importBtn, fileIn,
        h("a", { class: "btn btn-ghost btn-sm", href: "/api/admin/crm/export.csv", download: "", text: t("crm_export") })));
    if (!res.ok) return h("div", {}, head, form, msg(errText(res), "err"));
    const d = res.data;
    for (const cc of d.countries) ccSel.append(h("option", { value: cc, text: `${countryName(cc)} (${cc})`, selected: cc === country }));
    if (country && !d.countries.includes(country)) ccSel.append(h("option", { value: country, text: country, selected: true }));
    if (d.synced) say(t("crm_synced", { n: d.synced }), "ok");

    // stav tabule (presuny se promitnou lokalne, bez noveho nacteni a ztraty posunu)
    const cols = d.columns;
    let lostOpen = lsGet("plcstudio.admin.crmLost") === "open";
    let mobileStage = lsGet("plcstudio.admin.crmStage");
    if (!STAGES.includes(mobileStage)) mobileStage = STAGES.find((s) => cols[s].count) || "new";
    let dragId = null;
    const today = todayLocal();
    const board = h("div", { class: "crm-board", role: "region", "aria-label": t("crm_board") });
    const stagePick = h("select", { "aria-label": t("crm_col_show") });
    stagePick.addEventListener("change", () => { mobileStage = stagePick.value; lsSet("plcstudio.admin.crmStage", mobileStage); render(); });
    const pickWrap = h("label", { class: "adm-field crm-pick" }, h("span", { text: t("crm_col_show") }), stagePick);

    const findCard = (id) => { for (const s of STAGES) { const i = cols[s].cards.findIndex((c) => c.id === id); if (i >= 0) return { s, i, card: cols[s].cards[i] }; } return null; };
    async function move(id, stage, focusAfter) {
      const f = findCard(id);
      if (!f || f.s === stage) return;
      if (!(await crmMove(f.card, stage, say))) return;
      cols[f.s].cards.splice(f.i, 1);
      cols[f.s].count--; cols[f.s].value_czk -= Number(f.card.value_czk) || 0;
      f.card.stage = stage;
      if (stage === "won") f.card.suggest = null;
      cols[stage].cards.unshift(f.card);
      cols[stage].count++; cols[stage].value_czk += Number(f.card.value_czk) || 0;
      if (stage === "lost" && !lostOpen && focusAfter) lostOpen = true;
      if (window.matchMedia("(max-width: 760px)").matches && focusAfter) mobileStage = stage;
      render();
      say(t("crm_moved", { c: f.card.company, s: stageName(stage) }), "ok");
      if (focusAfter) { const el = board.querySelector(`[data-id="${CSS.escape(id)}"] .crm-card-title`); if (el) el.focus(); }
    }

    function cardEl(c) {
      const idx = STAGES.indexOf(c.stage);
      const overdue = c.next_date && c.next_date < today && c.stage !== "won" && c.stage !== "lost";
      const isToday = c.next_date === today;
      const arrow = (dir) => {
        const to = STAGES[idx + dir];
        return h("button", { type: "button", class: "crm-arrow", disabled: !to, "aria-label": to ? t("crm_move_to", { s: stageName(to) }) : null,
          title: to ? t("crm_move_to", { s: stageName(to) }) : null, text: dir < 0 ? "←" : "→", onclick: () => to && move(c.id, to, true) });
      };
      const sel = h("select", { class: "crm-move-sel", "aria-label": t("crm_move_label") }, STAGES.map((s) => h("option", { value: s, text: stageName(s), selected: s === c.stage })));
      sel.addEventListener("change", () => { const v = sel.value; sel.value = c.stage; move(c.id, v, true); });
      const place = [c.city, c.country].filter(Boolean).join(", ");
      const el = h("li", { class: `crm-card${overdue ? " overdue" : ""}`, draggable: "true", "data-id": c.id },
        h("a", { class: "crm-card-title", draggable: "false", href: `#/lead/${encodeURIComponent(c.id)}`, text: c.company }),
        h("div", { class: "crm-card-meta" },
          h("span", { class: `crm-seg seg-${c.segment}`, text: segName(c.segment) }),
          place ? h("span", { text: place }) : null,
          h("span", { class: "crm-src", text: srcName(c.source) })),
        c.next_action || c.next_date ? h("p", { class: "crm-next" },
          c.next_date ? h("span", { class: `crm-date${overdue ? " is-overdue" : isToday ? " is-today" : ""}` },
            fmtDay(c.next_date), overdue || isToday ? " · " : "", overdue || isToday ? h("span", { class: "crm-flag", text: t(overdue ? "crm_overdue" : "crm_today") }) : null) : null,
          c.next_action ? h("span", { class: "crm-next-text", text: c.next_action }) : null) : null,
        c.value_czk ? h("p", { class: "crm-value", text: fmtCzk(c.value_czk) }) : null,
        c.suggest === "won" ? h("div", { class: "crm-suggest" }, h("span", { text: t("crm_suggest") }),
          h("button", { type: "button", class: "btn btn-ghost btn-xs", text: t("crm_suggest_btn"), onclick: () => move(c.id, "won", true) })) : null,
        h("div", { class: "crm-card-move" }, arrow(-1), arrow(1), sel));
      el.addEventListener("dragstart", (e) => {
        dragId = c.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", c.id);
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => { dragId = null; el.classList.remove("dragging"); board.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target")); });
      el.addEventListener("keydown", (e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        const to = STAGES[idx + (e.key === "ArrowRight" ? 1 : -1)];
        if (to) { e.preventDefault(); move(c.id, to, true); }
      });
      return el;
    }

    function columnEl(s) {
      const col = cols[s];
      // na mobilu je videt jen vybrany sloupec - sbaleni tam nedava smysl
      const collapsed = s === "lost" && !lostOpen && !window.matchMedia("(max-width: 760px)").matches;
      const sum = col.value_czk ? h("span", { class: "crm-sum", text: fmtCzk(col.value_czk) }) : null;
      const head = s === "lost"
        ? h("button", { type: "button", class: "crm-col-head crm-col-toggle", "aria-expanded": String(!collapsed),
            title: collapsed ? t("crm_expand") : t("crm_collapse"), onclick: () => { lostOpen = !lostOpen; lsSet("plcstudio.admin.crmLost", lostOpen ? "open" : "closed"); render(); } },
            h("span", { class: "crm-col-name", text: stageName(s) }), h("span", { class: "crm-badge", text: String(col.count) }), collapsed ? null : sum,
            h("span", { class: "crm-chev", "aria-hidden": "true", text: collapsed ? "›" : "‹" }))
        : h("div", { class: "crm-col-head" }, h("h2", { class: "crm-col-name", text: stageName(s) }), h("span", { class: "crm-badge", text: String(col.count) }), sum);
      const list = collapsed ? null : col.cards.length
        ? h("ul", { class: "crm-cards", "aria-label": stageName(s) }, col.cards.map(cardEl))
        : h("p", { class: "crm-empty", text: t("crm_empty_col") });
      const sec = h("section", { class: `crm-col st-col-${s}${collapsed ? " collapsed" : ""}${s === mobileStage ? " is-current" : ""}`, "data-stage": s },
        head, list, !collapsed && col.count > col.cards.length ? h("p", { class: "crm-more", text: t("crm_more", { n: col.count - col.cards.length }) }) : null);
      sec.addEventListener("dragover", (e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; sec.classList.add("drop-target"); });
      sec.addEventListener("dragleave", (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove("drop-target"); });
      sec.addEventListener("drop", (e) => {
        e.preventDefault();
        sec.classList.remove("drop-target");
        const id = dragId || e.dataTransfer.getData("text/plain");
        dragId = null;
        if (id) move(id, s, false);
      });
      return sec;
    }

    function render() {
      stagePick.replaceChildren(...STAGES.map((s) => h("option", { value: s, text: `${stageName(s)} (${cols[s].count})`, selected: s === mobileStage })));
      board.classList.toggle("lost-open", lostOpen);
      board.replaceChildren(...STAGES.map(columnEl));
    }
    render();

    return h("div", { class: "crm" }, head, h("p", { class: "adm-hint crm-hint-desk", text: t("crm_hint") }), h("p", { class: "adm-hint crm-hint-mob", text: t("crm_hint_mob") }), form, importBox, live, pickWrap, board);
  }

  // Import: soubor -> nahled (dry_run) -> potvrzeni
  async function importPreview(file, box, say) {
    const fail = (text) => box.replaceChildren(msg(text, "err"));
    if (file.size > IMPORT_FILE_MAX) return fail(t("im_too_big"));
    let data;
    try { data = JSON.parse(await file.text()); } catch { return fail(t("im_bad_file")); }
    const list = Array.isArray(data) ? data : Array.isArray(data?.leads) ? data.leads : Array.isArray(data?.items) ? data.items : null;
    if (!list || !list.length) return fail(t("im_bad_file"));
    if (list.length > IMPORT_MAX) return fail(t("im_too_many", { n: IMPORT_MAX }));
    box.replaceChildren(msg(t("loading")));
    const pre = await api("POST", "/api/admin/crm/import", { leads: list, dry_run: true });
    if (!pre.ok) return fail(pre.data?.error === "too many" ? t("im_too_many", { n: IMPORT_MAX }) : errText(pre));
    const p = pre.data;
    const byText = (b) => t("im_by_" + b);
    const card = (label, n, cls) => h("div", { class: `adm-card ${cls || ""}` }, h("b", { text: String(n) }), h("span", { text: label }));
    const goBtn = h("button", { class: "btn btn-sm", type: "button", disabled: !p.new, text: p.new ? t("im_go", { n: p.new }) : t("im_none") });
    const cancel = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("im_cancel"), onclick: () => box.replaceChildren() });
    goBtn.addEventListener("click", async () => {
      goBtn.disabled = true;
      const x = await api("POST", "/api/admin/crm/import", { leads: list });
      if (!x.ok) { goBtn.disabled = false; return fail(errText(x)); }
      box.replaceChildren();
      await route();
      const live = view.querySelector(".crm .adm-msg[role=status]");
      if (live) { live.className = "adm-msg ok"; live.textContent = t("im_done", { n: x.data.imported }); }
    });
    box.replaceChildren(h("section", { class: "adm-panel crm-import" },
      h("h2", {}, t("im_h")),
      h("p", { class: "adm-hint", text: tn("im_file", p.total, { f: file.name }) }),
      h("div", { class: "adm-cards" }, card(t("im_new"), p.new, p.new ? "good" : ""), card(t("im_dup"), p.duplicates), card(t("im_invalid"), p.invalid, p.invalid ? "warn" : "")),
      p.personal_ignored ? h("p", { class: "adm-note-box", text: t("im_personal", { n: p.personal_ignored }) }) : null,
      p.duplicate_rows.length ? h("details", { class: "crm-details" }, h("summary", { text: `${t("im_dup_rows")} · ${p.duplicates}` }),
        h("ul", {}, p.duplicate_rows.map((x) => h("li", {}, `${x.row}: ${x.company} — ${byText(x.by)}`,
          x.id ? h("span", {}, " (", h("a", { href: `#/lead/${encodeURIComponent(x.id)}`, text: x.existing }), ")") : null)))) : null,
      p.invalid_rows.length ? h("details", { class: "crm-details" }, h("summary", { text: `${t("im_invalid_rows")} · ${p.invalid}` }),
        h("ul", {}, p.invalid_rows.map((x) => h("li", { text: `${x.row}: ${I18N.cs[x.error.replace(/\s+/g, "_")] ? t(x.error.replace(/\s+/g, "_")) : x.error}` })))) : null,
      h("p", { class: "adm-hint", text: t("im_hint") }),
      h("div", { class: "adm-actions" }, goBtn, cancel)));
    say("");
    goBtn.focus();
  }

  // ------------------------------------------------------------ detail / novy lead
  const LEAD_FIELDS = [
    // [pole, typ, sekce, atributy]
    ["company", "text", "fields", { maxlength: 200, required: true }], ["segment", "segment", "fields"],
    ["website", "url", "fields", { maxlength: 300, placeholder: "https://" }], ["country", "text", "fields", { maxlength: 2, pattern: "[A-Za-z]{2}", autocapitalize: "characters" }],
    ["city", "text", "fields", { maxlength: 100 }], ["source_url", "url", "fields", { maxlength: 500, placeholder: "https://" }],
    ["contact_name", "text", "contact", { maxlength: 120, autocomplete: "off" }], ["email", "email", "contact", { maxlength: 253, autocomplete: "off", spellcheck: "false" }],
    ["phone", "tel", "contact", { maxlength: 40, autocomplete: "off" }],
    ["next_action", "text", "sales", { maxlength: 200, wide: true }], ["next_date", "date", "sales"], ["owner", "text", "sales", { maxlength: 100 }],
    ["value_czk", "number", "sales", { min: 0, max: 1000000000, step: 1 }], ["value_note", "text", "sales", { maxlength: 200 }],
    ["lost_reason", "text", "sales", { maxlength: 300, wide: true, lostOnly: true }],
  ];

  function eventText(e) {
    if (e.type === "create") return t("ev_create");
    if (e.type === "import") return I18N.cs["ev_import_" + e.text] ? t("ev_import_" + e.text) : e.text;
    if (e.type === "edit") return t("ev_edit", { f: String(e.text || "").split(",").map((f) => (I18N.cs["ld_" + f] ? t("ld_" + f).replace(/\s*\(.*\)$/, "") : f)).join(", ") });
    if (e.type === "stage_change") {
      const [move, ...reason] = String(e.text || "").split("\n");
      const [a, b] = move.split(">");
      return t("ev_stage", { a: STAGES.includes(a) ? stageName(a) : a, b: STAGES.includes(b) ? stageName(b) : b }) + (reason.length ? ` — ${reason.join(" ")}` : "");
    }
    return e.text || "";
  }

  async function vLead(r) {
    const isNew = r.arg === "new";
    const back = h("a", { href: lastBoardHash, class: "btn btn-ghost btn-sm", text: t("ld_back") });
    let d = { lead: { segment: "jine", stage: "new" }, events: [], customer: false, licensed: false, suggest: null };
    if (!isNew) {
      const res = await api("GET", `/api/admin/crm/lead?${new URLSearchParams({ id: r.arg })}`);
      if (!res.ok) return h("div", {}, h("div", { class: "adm-actions adm-back" }, back), msg(errText(res), "err"));
      d = res.data;
    }
    const L = d.lead;
    const flash = h("div", { "aria-live": "polite" });
    const say = (text, cls) => flash.replaceChildren(typeof text === "string" ? msg(text, cls) : text);
    const reload = async (after) => { const node = await vLead(r); view.replaceChildren(node); if (after) after(node); };
    const flashAfter = (text, cls) => (node) => { const f = node.querySelector(".crm-flash"); if (f) f.replaceChildren(msg(text, cls)); };

    // formular
    const inputs = {};
    const stageSel = h("select", { name: "stage" }, STAGES.map((s) => h("option", { value: s, text: stageName(s), selected: s === L.stage })));
    const field = ([name, type, , a = {}]) => {
      let el;
      if (type === "segment") el = h("select", { name }, SEGMENTS.map((s) => h("option", { value: s, text: segName(s), selected: s === L.segment })));
      else el = h("input", { type, name, value: L[name] ?? "", maxlength: a.maxlength, min: a.min, max: a.max, step: a.step, pattern: a.pattern,
        placeholder: a.placeholder, required: a.required, autocomplete: a.autocomplete || "off", spellcheck: a.spellcheck, autocapitalize: a.autocapitalize });
      inputs[name] = el;
      const wrap = h("label", { class: `adm-field${a.wide ? " wide" : ""}` }, h("span", { text: t("ld_" + name) }), el);
      if (a.lostOnly) { wrap.classList.add("crm-lost-only"); wrap.hidden = !isNew ? L.stage !== "lost" : stageSel.value !== "lost"; }
      return wrap;
    };
    const section = (key) => LEAD_FIELDS.filter((f) => f[2] === key).map(field);
    const saveBtn = h("button", { class: "btn btn-sm", type: "submit", text: isNew ? t("ld_create") : t("ld_save") });
    const collect = () => {
      const body = {};
      for (const [name, type] of LEAD_FIELDS) {
        const el = inputs[name];
        if (!el || el.closest("[hidden]")) continue;
        body[name] = type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value.trim();
      }
      return body;
    };
    async function save(extra = {}) {
      const body = { ...collect(), ...extra };
      if (isNew) body.stage = stageSel.value; else body.id = L.id;
      saveBtn.disabled = true;
      const x = await api("POST", "/api/admin/crm/lead", body);
      saveBtn.disabled = false;
      if (x.status === 409 && x.data.error === "duplicate") {
        const openBtn = h("a", { class: "btn btn-ghost btn-xs", href: `#/lead/${encodeURIComponent(x.data.id)}`, text: t("ld_dup_open") });
        return say(h("div", { class: "adm-banner" }, h("p", { text: t(x.data.by === "email" ? "ld_dup_email" : "ld_dup_domain", { c: x.data.company }) }),
          h("div", { class: "adm-actions" }, openBtn, x.data.by === "domain" ? h("button", { class: "btn btn-ghost btn-xs", type: "button", text: t("ld_dup_save"), onclick: () => save({ allow_duplicate: true }) }) : null)));
      }
      if (!x.ok) return say(errText(x), "err");
      if (isNew) { location.hash = `#/lead/${encodeURIComponent(x.data.id)}`; return; }
      await reload(flashAfter(x.data.unchanged ? t("ld_unchanged") : t("ld_saved"), "ok"));
    }
    const form = h("form", { class: "crm-form", novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      h("fieldset", {}, h("legend", { text: t("ld_fields") }), h("div", { class: "adm-form-grid" }, section("fields"))),
      h("fieldset", {}, h("legend", { text: t("ld_contact") }), h("p", { class: "adm-hint", text: t("ld_personal") }), h("div", { class: "adm-form-grid" }, section("contact"))),
      h("fieldset", {}, h("legend", { text: t("ld_sales") }), h("div", { class: "adm-form-grid" },
        isNew ? h("label", { class: "adm-field" }, h("span", { text: t("ld_stage") }), stageSel) : null, section("sales"))),
      h("div", { class: "adm-actions" }, saveBtn));
    if (isNew) stageSel.addEventListener("change", () => form.querySelectorAll(".crm-lost-only").forEach((w) => { w.hidden = stageSel.value !== "lost"; }));

    if (isNew) {
      return h("div", { class: "crm-lead" }, h("div", { class: "adm-actions adm-back" }, back), h("h1", { text: t("ld_new_h") }),
        h("div", { class: "crm-flash" }, flash), h("section", { class: "adm-panel" }, form));
    }

    // faze (presun hned po zmene)
    stageSel.setAttribute("aria-label", t("ld_stage"));
    stageSel.addEventListener("change", async () => {
      const to = stageSel.value;
      stageSel.value = L.stage;
      if (await crmMove(L, to, say)) await reload(flashAfter(t("crm_moved", { c: L.company, s: stageName(to) }), "ok"));
    });

    // historie a poznamka
    const noteTa = h("textarea", { maxlength: 2000, rows: 3, placeholder: t("ld_note_ph"), "aria-label": t("ld_note") });
    const typeNote = h("input", { type: "radio", name: "evtype", value: "note", checked: true });
    const typeContact = h("input", { type: "radio", name: "evtype", value: "contact" });
    const noteMsg = h("p", { class: "adm-msg", role: "status" });
    const noteForm = h("form", { class: "adm-form", onsubmit: async (e) => {
      e.preventDefault();
      const text = noteTa.value.trim();
      if (!text) return;
      const x = await api("POST", "/api/admin/crm/note", { id: L.id, text, type: typeContact.checked ? "contact" : "note" });
      if (!x.ok) { noteMsg.className = "adm-msg err"; noteMsg.textContent = errText(x); return; }
      await reload(flashAfter(t("ld_note_saved"), "ok"));
    } },
      h("div", { class: "crm-radio", role: "radiogroup" },
        h("label", { class: "adm-check" }, typeNote, h("span", { text: t("ld_note") })),
        h("label", { class: "adm-check" }, typeContact, h("span", { text: t("ld_contact_ev") }))),
      noteTa, h("div", { class: "adm-actions" }, h("button", { class: "btn btn-sm", type: "submit", text: t("ld_note_add") })), noteMsg);
    const histPanel = panel([t("ld_history"), h("span", { class: "adm-count", text: String(d.events.length) })],
      noteForm,
      d.events.length ? h("ul", { class: "adm-notes crm-events" }, d.events.map((e) => h("li", { class: `ev-${e.type}` },
        e.type === "note" || e.type === "contact" ? h("strong", { class: "crm-ev-type", text: t(e.type === "note" ? "ev_note" : "ev_contact") }) : null,
        h("p", { text: eventText(e) }), h("small", { text: `${fmtDT(e.at)} · ${e.actor}` }))))
        : h("p", { class: "adm-empty", text: t("ld_no_events") }));

    // puvod, odkazy, smazani
    const del = h("button", { class: "btn btn-danger btn-xs", type: "button", text: t("ld_delete"), onclick: async () => {
      const ok = await ask({ title: t("ld_delete_h"), text: t("ld_delete_p", { c: L.company }), ok: t("ld_delete"), danger: true });
      if (!ok) return;
      const x = await api("POST", "/api/admin/crm/delete", { id: L.id });
      if (!x.ok) return say(errText(x), "err");
      go(lastBoardHash);
    } });
    const infoPanel = panel(t("ld_info"),
      h("dl", { class: "adm-dl" },
        h("dt", { text: t("ld_source") }), h("dd", { text: srcName(L.source) }),
        L.website ? [h("dt", { text: t("ld_website") }), h("dd", {}, extLink(L.website))] : null,
        L.source_url ? [h("dt", { text: t("ld_source_url") }), h("dd", {}, extLink(L.source_url, t("ld_open_source")))] : null,
        d.customer ? [h("dt", { text: t("ld_customer") }), h("dd", {}, h("a", { href: `#/zakaznik/${encodeURIComponent(L.email)}`, text: t("ld_customer_link") }))] : null,
        h("dt", { text: t("ld_created_at") }), h("dd", { text: fmtDT(L.created_at) }),
        h("dt", { text: t("ld_updated_at") }), h("dd", { text: fmtDT(L.updated_at) })),
      h("div", { class: "adm-actions crm-del" }, del));

    return h("div", { class: "crm-lead" },
      h("div", { class: "adm-actions adm-back" }, back),
      h("div", { class: "adm-title" },
        h("h1", { text: L.company }),
        h("div", { class: "adm-actions" },
          h("span", { class: `crm-seg seg-${L.segment}`, text: segName(L.segment) }),
          h("label", { class: "crm-stage-pick" }, h("span", { text: t("ld_stage") }), stageSel))),
      d.suggest === "won" ? h("div", { class: "adm-banner crm-suggest-banner" }, h("span", { text: t("crm_suggest") }),
        h("button", { class: "btn btn-sm", type: "button", text: t("crm_suggest_btn"), onclick: async () => {
          if (await crmMove(L, "won", say)) await reload(flashAfter(t("crm_moved", { c: L.company, s: stageName("won") }), "ok"));
        } })) : null,
      h("div", { class: "crm-flash" }, flash),
      h("div", { class: "crm-lead-grid" },
        h("section", { class: "adm-panel" }, form),
        h("div", {}, histPanel, infoPanel)));
  }

  // ------------------------------------------------------------ interni dokumenty (#/dokumenty, #/dokument/<slug>)
  // Obsah dokumentu je jen v D1 (API /api/admin/doc*), tady jen zobrazeni a editor.
  // Markdown se vykresluje vlastnim parserem do DOM pres h() - zadne vkladani HTML, odkazy jen http(s).
  const SLUG_RE = /^[a-z0-9-]{1,64}$/;
  const DOC_MAX = 256 * 1024;
  // Radky ukolu - STEJNE jako worker/docs.js (taskLines): "- [ ]" / "* [x]" / "+ [X]", mimo bloky ```
  const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\](?:\s|$))/;
  const FENCE_RE = /^\s*```/;
  function taskLines(lines) {
    const idx = [];
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (FENCE_RE.test(lines[i])) { fence = !fence; continue; }
      if (!fence && TASK_RE.test(lines[i])) idx.push(i);
    }
    return idx;
  }
  function toggleTaskLocal(body, n, done) {
    const lines = body.split("\n");
    const at = taskLines(lines)[n];
    if (at === undefined) return body;
    lines[at] = lines[at].replace(TASK_RE, (m, a, b, c) => a + (done ? "x" : " ") + c);
    return lines.join("\n");
  }

  // --- inline: `kod`, **tucne**, *kurziva* / _kurziva_, [text](url), <url> a hole http(s) adresy, \escape
  const INLINE_RE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"[^"\n]*")?\s*\)|<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])|(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])|(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)|\\([\\`*_[\]()#|>!-])/g;
  function mdInline(text, noLinks) {
    const res = [];
    let last = 0;
    for (const m of text.matchAll(INLINE_RE)) {
      if (m.index > last) res.push(text.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[1]) res.push(h("code", { text: m[2].replace(/^ (.*) $/, "$1") }));
      else if (m[3] != null) res.push(h("strong", {}, mdInline(m[3], noLinks)));
      else if (m[4] != null) {
        const href = noLinks ? null : safeHref(m[5]);
        res.push(href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, mdInline(m[4], true)) : h("span", {}, mdInline(m[4], true), ` (${m[5]})`));
      } else if (m[6] || m[7]) {
        const u = m[6] || m[7];
        const href = noLinks ? null : safeHref(u);
        res.push(href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", text: u }) : u);
      } else if (m[8] != null || m[9] != null) res.push(h("em", {}, mdInline(m[8] ?? m[9], noLinks)));
      else if (m[10]) res.push(m[10]);
    }
    if (last < text.length) res.push(text.slice(last));
    return res;
  }

  // --- bloky
  const RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
  const RE_TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const isTableRow = (l) => /\|/.test(l) && l.trim() !== "";
  const isTableStart = (l, next) => isTableRow(l) && next != null && RE_TSEP.test(next) && /\|/.test(next);
  function splitRow(l) {
    let s = l.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; } else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; } else cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }
  const blockStart = (l, next) => RE_HEAD.test(l) || RE_HR.test(l) || FENCE_RE.test(l) || RE_QUOTE.test(l) || RE_LIST.test(l) || isTableStart(l, next);

  // lines = radky, base = cislo radku prvniho z nich v dokumentu (null = ukoly jen ke cteni, napr. v citaci),
  // ctx = { tasks: Map(cislo radku -> index ukolu), onTask(index, done, input) }
  function mdBlocks(lines, base, ctx) {
    const res = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (FENCE_RE.test(l)) {
        const lang = l.trim().slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !FENCE_RE.test(lines[i])) buf.push(lines[i++]);
        i++;
        res.push(h("pre", { class: "md-pre" }, h("code", { "data-lang": lang || null, text: buf.join("\n") })));
        continue;
      }
      const hm = RE_HEAD.exec(l);
      if (hm) {
        res.push(h("h" + Math.min(hm[1].length + 1, 4), { class: "md-h" }, mdInline(hm[2]))); // # dokumentu = h2 (h1 je nazev)
        i++;
        continue;
      }
      if (RE_HR.test(l)) { res.push(h("hr", { class: "md-hr" })); i++; continue; }
      if (RE_QUOTE.test(l)) {
        const buf = [];
        while (i < lines.length && lines[i].trim() && RE_QUOTE.test(lines[i])) buf.push(RE_QUOTE.exec(lines[i++])[1]);
        res.push(h("blockquote", { class: "md-quote" }, mdBlocks(buf, null, ctx)));
        continue;
      }
      if (isTableStart(l, lines[i + 1])) {
        const head = splitRow(l);
        const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : null));
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
        const cell = (tag, txt, k) => h(tag, { class: align[k] ? "md-" + align[k] : null, scope: tag === "th" ? "col" : null }, mdInline(txt));
        res.push(h("div", { class: "md-table-wrap" }, h("table", { class: "md-table" },
          h("thead", {}, h("tr", {}, head.map((c, k) => cell("th", c, k)))),
          h("tbody", {}, rows.map((r) => h("tr", {}, head.map((_, k) => cell("td", r[k] ?? "", k))))))));
        continue;
      }
      if (RE_LIST.test(l)) {
        // polozky s odsazenim -> vnorene seznamy, pokracovaci radky se pripoji k posledni polozce
        const roots = [];
        const stack = []; // {indent, ordered, el, li}
        while (i < lines.length) {
          const cur = lines[i];
          if (!cur.trim()) {
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && RE_LIST.test(lines[j])) { i = j; continue; }
            break;
          }
          const lm = RE_LIST.exec(cur);
          if (!lm) {
            if (stack.length && !blockStart(cur, lines[i + 1])) { stack.at(-1).li.querySelector(".md-li-text").append(" ", ...mdInline(cur.trim())); i++; continue; }
            break;
          }
          const indent = lm[1].replace(/\t/g, "    ").length;
          const ordered = /\d/.test(lm[2]);
          while (stack.length && stack.at(-1).indent > indent) stack.pop();
          let top = stack.at(-1);
          if (!top || indent > top.indent || top.ordered !== ordered) {
            if (top && indent <= top.indent) stack.pop();
            const parent = stack.at(-1);
            const n0 = parseInt(lm[2], 10);
            const el = h(ordered ? "ol" : "ul", { class: "md-list", start: ordered && n0 !== 1 ? n0 : null });
            if (parent) parent.li.append(el); else roots.push(el);
            top = { indent, ordered, el, li: null };
            stack.push(top);
          }
          const li = h("li", {});
          const tm = ordered ? null : /^\[([ xX])\](?:\s+|$)(.*)$/.exec(lm[3]);
          if (tm) {
            const no = base == null ? null : base + i;
            const idx = no != null && ctx.tasks.has(no) ? ctx.tasks.get(no) : null;
            const cb = h("input", { type: "checkbox", checked: tm[1] !== " ", disabled: idx == null, "aria-label": t("dc_task_label") });
            if (idx != null) cb.addEventListener("change", () => ctx.onTask(idx, cb.checked, cb));
            li.className = tm[1] !== " " ? "md-task done" : "md-task";
            li.append(h("label", {}, cb, h("span", { class: "md-li-text" }, mdInline(tm[2]))));
          } else li.append(h("span", { class: "md-li-text" }, mdInline(lm[3])));
          top.el.append(li);
          top.li = li;
          i++;
        }
        res.push(...roots);
        continue;
      }
      // odstavec (radky spojene mezerou, dve mezery nebo \ na konci = zalomeni)
      const raw = [l];
      i++;
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i], lines[i + 1])) raw.push(lines[i++]);
      const p = h("p", {});
      raw.forEach((ln, k) => {
        if (k) p.append(/ {2,}$|\\$/.test(raw[k - 1]) ? h("br") : " ");
        p.append(...mdInline(ln.trim().replace(/\\$/, "")));
      });
      res.push(p);
    }
    return res;
  }
  function renderMd(body, onTask) {
    const lines = body.split("\n");
    const tasks = new Map(taskLines(lines).map((ln, k) => [ln, k]));
    return h("div", { class: "md" }, mdBlocks(lines, 0, { tasks, onTask }));
  }

  // --- neulozene upravy: odchod z editoru (jiny pohled, zavreni okna) se potvrzuje
  let docDirty = null; // hash editovaneho dokumentu, kdyz ma neulozene zmeny
  window.addEventListener("beforeunload", (e) => { if (docDirty) { e.preventDefault(); e.returnValue = ""; } });
  async function leaveDirtyOk() {
    if (!docDirty) return true;
    const ok = await ask({ title: t("dc_discard_h"), text: t("dc_discard_p"), ok: t("dc_discard_ok"), danger: true });
    if (ok) docDirty = null;
    return !!ok;
  }

  async function vDocs() {
    const res = await api("GET", "/api/admin/docs");
    const slugIn = h("input", { type: "text", name: "slug", maxlength: 64, required: true, pattern: "[a-z0-9\\-]{1,64}", autocomplete: "off", spellcheck: "false", autocapitalize: "none" });
    const titleIn = h("input", { type: "text", name: "title", maxlength: 200, required: true, autocomplete: "off" });
    const say = msg("");
    // nazev -> navrh oznaceni (bez diakritiky, mala pismena, pomlcky), dokud oznaceni nikdo neprepsal
    let slugTouched = false;
    slugIn.addEventListener("input", () => { slugTouched = true; });
    titleIn.addEventListener("input", () => {
      if (slugTouched) return;
      slugIn.value = titleIn.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    });
    const form = h("form", { class: "adm-form-grid", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const slug = slugIn.value.trim(), title = titleIn.value.trim();
      say.className = "adm-msg err";
      if (!title) { say.textContent = t("bad_title"); return; }
      if (!SLUG_RE.test(slug)) { say.textContent = t("bad_slug"); return; }
      const btn = e.submitter;
      if (btn) btn.disabled = true;
      const r = await api("POST", "/api/admin/doc", { slug, title, body: `# ${title}\n`, version: 0 });
      if (btn) btn.disabled = false;
      if (r.ok) { go(`#/dokument/${encodeURIComponent(slug)}?edit=1`); return; }
      if (r.status === 409) say.replaceChildren(t("dc_exists") + " ", h("a", { href: `#/dokument/${encodeURIComponent(slug)}`, text: t("dc_open") }));
      else say.textContent = errText(r);
    } },
      h("label", { class: "adm-field" }, h("span", { text: t("dc_title") }), titleIn),
      h("label", { class: "adm-field" }, h("span", { text: t("dc_slug") }), slugIn),
      h("div", { class: "adm-actions wide" }, h("button", { class: "btn btn-sm", type: "submit", text: t("dc_create") }), say));
    const kb = (n) => (n == null ? "—" : `${(n / 1024).toLocaleString(fmtLocale(), { maximumFractionDigits: 1 })} kB`);
    return h("div", {},
      h("div", { class: "adm-title" }, h("h1", { text: t("dc_h") }), res.ok ? h("span", { class: "adm-count", text: tn("dc_total", res.data.docs.length) }) : null),
      h("p", { class: "adm-hint", text: t("dc_hint") }),
      res.ok
        ? table(
          [{ label: t("col_title") }, { label: t("col_updated") }, { label: t("col_by") }, { label: t("col_size"), cls: "num" }],
          res.data.docs,
          (d) => [h("span", {}, h("a", { href: `#/dokument/${encodeURIComponent(d.slug)}`, text: d.title }), " ", h("span", { class: "adm-mono adm-muted", text: d.slug })), fmtDT(d.updated_at), d.updated_by, kb(d.size)],
          { empty: t("dc_none"), onRow: (d) => go(`#/dokument/${encodeURIComponent(d.slug)}`) })
        : msg(errText(res), "err"),
      panel(t("dc_new_h"), form));
  }

  async function vDoc(r) {
    const slug = r.arg;
    const back = h("p", { class: "adm-back" }, h("a", { href: "#/dokumenty", text: t("dc_back") }));
    if (!SLUG_RE.test(slug)) return h("div", {}, back, msg(t("bad_slug"), "err"));
    const res = await api("GET", `/api/admin/doc?${new URLSearchParams({ slug })}`);
    if (!res.ok) return h("div", {}, back, msg(errText(res), "err"));
    const doc = res.data.doc;
    const hash = `#/dokument/${encodeURIComponent(slug)}`;
    const root = h("div", { class: "doc" });
    const meta = () => t("dc_meta", { v: doc.version, t: fmtDT(doc.updated_at), w: doc.updated_by });
    const reloadWith = async (note) => {
      await route();
      const f = $(".doc-flash");
      if (f && note) f.replaceChildren(msg(note, "err"));
    };

    function showRead(note, cls) {
      docDirty = null;
      const flash = h("div", { class: "doc-flash" }, note ? msg(note, cls) : null);
      const metaEl = h("span", { class: "adm-count", text: meta() });
      const onTask = async (index, done, cb) => {
        cb.disabled = true;
        const r2 = await api("POST", "/api/admin/doc/task", { slug, index, done, version: doc.version });
        cb.disabled = false;
        if (r2.ok) {
          Object.assign(doc, { version: r2.data.version, updated_at: r2.data.updated_at, updated_by: r2.data.updated_by, body: toggleTaskLocal(doc.body, index, done) });
          cb.closest("li").classList.toggle("done", done);
          metaEl.textContent = meta();
          flash.replaceChildren();
          return;
        }
        cb.checked = !done;
        if (r2.status === 409 || r2.data?.error === "bad index") { reloadWith(t("dc_task_conflict")); return; }
        flash.replaceChildren(msg(errText(r2), "err"));
      };
      root.replaceChildren(
        back,
        h("div", { class: "adm-title" }, h("h1", { text: doc.title }),
          h("div", { class: "adm-actions" }, metaEl, h("button", { class: "btn btn-sm", type: "button", onclick: () => showEdit(), text: t("dc_edit") }))),
        flash,
        h("article", { class: "adm-panel doc-body" }, doc.body.trim() ? renderMd(doc.body, onTask) : h("p", { class: "adm-empty", text: t("dc_empty") })));
    }

    function showEdit() {
      const titleIn = h("input", { type: "text", maxlength: 200, value: doc.title });
      const ta = h("textarea", { class: "doc-src", rows: 24, spellcheck: "true", "aria-label": doc.title });
      ta.value = doc.body;
      const size = h("span", { class: "adm-count" });
      const flash = h("div", { class: "doc-flash" });
      const upd = () => {
        const n = new TextEncoder().encode(ta.value).length;
        size.textContent = t("dc_size", { k: (n / 1024).toLocaleString(fmtLocale(), { maximumFractionDigits: 1 }) });
        size.classList.toggle("over", n > DOC_MAX);
        docDirty = ta.value !== doc.body || titleIn.value.trim() !== doc.title ? hash : null;
      };
      ta.addEventListener("input", upd);
      titleIn.addEventListener("input", upd);
      const saveBtn = h("button", { class: "btn btn-sm", type: "submit", text: t("dc_save") });
      const form = h("form", { class: "doc-edit", onsubmit: async (e) => {
        e.preventDefault();
        const title = titleIn.value.trim();
        if (!title) { flash.replaceChildren(msg(t("bad_title"), "err")); return; }
        if (new TextEncoder().encode(ta.value).length > DOC_MAX) { flash.replaceChildren(msg(t("too_large"), "err")); return; }
        saveBtn.disabled = true;
        const r2 = await api("POST", "/api/admin/doc", { slug, title, body: ta.value, version: doc.version });
        saveBtn.disabled = false;
        if (r2.ok) {
          Object.assign(doc, { title, body: ta.value.replace(/\r\n?/g, "\n"), version: r2.data.version, updated_at: r2.data.updated_at, updated_by: r2.data.updated_by });
          showRead(r2.data.unchanged ? t("dc_unchanged") : t("dc_saved", { v: doc.version }), "ok");
          return;
        }
        if (r2.status === 409) {
          flash.replaceChildren(h("div", { class: "doc-conflict" },
            msg(t("dc_conflict", { v: r2.data.version ?? "?", w: r2.data.updated_by || "?" }), "err"),
            h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("dc_reload"), onclick: async () => { if (await leaveDirtyOk()) route(); } })));
          return;
        }
        flash.replaceChildren(msg(errText(r2), "err"));
      } },
        h("label", { class: "adm-field" }, h("span", { text: t("dc_title") }), titleIn),
        h("p", { class: "adm-hint", text: t("dc_md_help") }),
        ta,
        h("div", { class: "adm-actions" }, saveBtn,
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("dc_cancel"), onclick: async () => { if (await leaveDirtyOk()) showRead(); } }),
          size));
      root.replaceChildren(back, h("div", { class: "adm-title" }, h("h1", { text: doc.title }), h("span", { class: "adm-count", text: meta() })), flash, h("section", { class: "adm-panel" }, form));
      upd();
      ta.focus();
    }

    if (r.params.get("edit") === "1") { history.replaceState(null, "", hash); showEdit(); } else showRead();
    return root;
  }

  applyStatic();
  start();
})();
