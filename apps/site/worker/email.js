// Transakcni e-maily (odkaz ke stazeni, licence, odemceni projektu) ve trech jazycich.
//
// Odesila se pres Resend (HTTP API). Cloudflare Email Routing umi jen prichozi
// preposilani. Resend posle cizim adresatum az z overene vlastni domeny - do te doby
// (free tarif bez domeny) bezi web v rezimu MAIL_MODE="direct": odkaz ke stazeni se
// ukaze rovnou na strance a zadny e-mail neodchazi.
//
// Rezimy (promenna MAIL_MODE ve wrangler.toml):
//   "resend"  ostry provoz, vyzaduje RESEND_API_KEY a MAIL_FROM z overene domeny
//   "direct"  zadne e-maily; /api/lead vrati odkaz ke stazeni primo v odpovedi
// Vyvojovy rezim se zapina VYSLOVNE pres DEV_MODE (jen vypis do logu), nikdy tim,
// ze chybi klic - zapomenuty secret v ostrem provozu by jinak maily tise zahazoval.

const T = {
  cs: {
    dl_subject: "Váš odkaz ke stažení {app}",
    dl_body: `Dobrý den,

odkaz ke stažení je níž. Aplikace se neinstaluje: rozbalte a spusťte, práva správce nepotřebujete.

{url}

Dvě rady, které šetří čas:
- Začněte menším strojem, který znáte nazpaměť. Hned uvidíte, jestli vám výstupy sedí.
- Máte-li existující projekt, zkuste nejdřív import. Ušetří vám klikání.

Narazíte-li na cokoli, odepište přímo na tento e-mail.

{sig}
{site}

Odkaz platí 7 dní. Další e-maily vám nepošleme, pokud si je nevyžádáte.`,
    lic_subject: "Licence {app} {plan}",
    lic_body: `Dobrý den,

licence je aktivní. Vložte ji v aplikaci přes Nápověda → Licence → Vložit licenci.

Licenční klíč: {key}

Licenční soubor (zkopírujte celý řádek včetně tečky uprostřed):

{file}

Licence funguje offline. Online spojení potřebuje aplikace jen při prvním vložení a pak občas na pozadí. Když nejste online, nic se nezamkne.

Potřebujete fakturu nebo máte dotaz? Odepište na tento e-mail.

{sig}
{site}`,
    beta_subject: "Přihláška do beta testu {app}",
    beta_body: `Dobrý den,

děkujeme za přihlášku do beta testu {app}. Přihlásili jste se k ověření platforem: {platforms} ({ide}).

Co bude dál:
- Přihlášku si osobně projdeme a odpovíme na tuto adresu, obvykle do dvou pracovních dnů.
- Po potvrzení si stáhnete aplikaci, v kroku Platformy uložíte „Balík k ověření“, naimportujete ho a přeložíte ve svém IDE a vyplníte PROTOKOL.md.
- Podmínky (například licenci Pro po dobu testu) vám potvrdíme e-mailem spolu s přijetím přihlášky.

Údaje z přihlášky používáme jen pro beta test. Když si to rozmyslíte, stačí odepsat a přihlášku smažeme.

{sig}
{site}`,
    beta_notice_subject: "Nová přihláška beta testera ({platforms})",
    beta_notice_body: `Nová přihláška do beta testu.

Platformy: {platforms}
IDE: {ide}
Jazyk: {locale}

Detail a vyřízení ve správě: {url}
`,
    un_subject: "Projekt odemčen",
    un_body: `Dobrý den,

projekt jsme odemkli. Generování i exporty v něm fungují bez omezení velikosti{io}. V aplikaci stačí projekt zavřít a znovu otevřít.

Platí to pro tento jeden projekt. Další stroje nad {limit} I/O potřebují tarif Pro.

{sig}
{site}`,
  },
  en: {
    dl_subject: "Your {app} download link",
    dl_body: `Hello,

your download link is below. Nothing to install: unzip and run, no administrator rights needed.

{url}

Two tips that save time:
- Start with a smaller machine you know by heart. You will see straight away whether the outputs suit you.
- If you have an existing project, try the import first. It saves a lot of clicking.

If anything comes up, just reply to this e-mail.

{sig}
{site}

The link is valid for 7 days. We will not send you further e-mails unless you ask for them.`,
    lic_subject: "{app} {plan} licence",
    lic_body: `Hello,

your licence is active. Paste it in the application via Help → Licence → Enter licence.

Licence key: {key}

Licence file (copy the whole line including the dot in the middle):

{file}

The licence works offline. The application only needs a connection when you first enter it and occasionally in the background. Nothing locks when you are offline.

Need an invoice or have a question? Just reply to this e-mail.

{sig}
{site}`,
    beta_subject: "Your {app} beta test application",
    beta_body: `Hello,

thank you for applying to the {app} beta test. You signed up to verify these platforms: {platforms} ({ide}).

What happens next:
- We will review your application personally and reply to this address, usually within two working days.
- Once confirmed, you download the application, save the "Verification pack" in the Platforms step, import and compile it in your IDE and fill in PROTOKOL.md.
- We will confirm the terms (for example a Pro licence for the duration of the test) by e-mail together with accepting your application.

We use the data from your application only for the beta test. If you change your mind, just reply and we will delete your application.

{sig}
{site}`,
    beta_notice_subject: "New beta tester application ({platforms})",
    beta_notice_body: `New beta test application.

Platforms: {platforms}
IDE: {ide}
Language: {locale}

Details in the admin: {url}
`,
    un_subject: "Project unlocked",
    un_body: `Hello,

we have unlocked your project. Generation and exports work without size limits{io}. Just close and reopen the project in the application.

This applies to this one project. Further machines above {limit} I/O need the Pro plan.

{sig}
{site}`,
  },
  de: {
    dl_subject: "Ihr Download-Link für {app}",
    dl_body: `Guten Tag,

der Download-Link steht unten. Keine Installation nötig: entpacken und starten, ohne Administratorrechte.

{url}

Zwei Tipps, die Zeit sparen:
- Beginnen Sie mit einer kleineren Maschine, die Sie gut kennen. So sehen Sie sofort, ob die Ergebnisse passen.
- Haben Sie ein bestehendes Projekt, probieren Sie zuerst den Import. Das spart viele Klicks.

Bei Fragen antworten Sie einfach auf diese E-Mail.

{sig}
{site}

Der Link ist 7 Tage gültig. Weitere E-Mails erhalten Sie nur, wenn Sie sie anfordern.`,
    lic_subject: "{app}-Lizenz {plan}",
    lic_body: `Guten Tag,

Ihre Lizenz ist aktiv. Fügen Sie sie in der Anwendung unter Hilfe → Lizenz → Lizenz eingeben ein.

Lizenzschlüssel: {key}

Lizenzdatei (die ganze Zeile einschließlich des Punktes in der Mitte kopieren):

{file}

Die Lizenz funktioniert offline. Eine Verbindung braucht die Anwendung nur beim ersten Eingeben und gelegentlich im Hintergrund. Offline wird nichts gesperrt.

Brauchen Sie eine Rechnung oder haben Sie eine Frage? Antworten Sie einfach auf diese E-Mail.

{sig}
{site}`,
    beta_subject: "Ihre Anmeldung zum {app}-Betatest",
    beta_body: `Guten Tag,

vielen Dank für Ihre Anmeldung zum Betatest von {app}. Sie möchten folgende Plattformen prüfen: {platforms} ({ide}).

Wie es weitergeht:
- Wir sehen uns Ihre Anmeldung persönlich an und antworten an diese Adresse, meist innerhalb von zwei Arbeitstagen.
- Nach der Bestätigung laden Sie die Anwendung herunter, speichern im Schritt Plattformen das „Prüfpaket“, importieren und übersetzen es in Ihrer IDE und füllen PROTOKOL.md aus.
- Die Bedingungen (zum Beispiel eine Pro-Lizenz für die Dauer des Tests) bestätigen wir Ihnen per E-Mail zusammen mit der Annahme der Anmeldung.

Die Angaben aus der Anmeldung verwenden wir nur für den Betatest. Wenn Sie es sich anders überlegen, antworten Sie einfach, und wir löschen Ihre Anmeldung.

{sig}
{site}`,
    beta_notice_subject: "Neue Betatester-Anmeldung ({platforms})",
    beta_notice_body: `Neue Anmeldung zum Betatest.

Plattformen: {platforms}
IDE: {ide}
Sprache: {locale}

Details in der Verwaltung: {url}
`,
    un_subject: "Projekt freigeschaltet",
    un_body: `Guten Tag,

wir haben Ihr Projekt freigeschaltet. Generierung und Exporte funktionieren ohne Größenbeschränkung{io}. Schließen Sie das Projekt in der Anwendung und öffnen Sie es erneut.

Das gilt für dieses eine Projekt. Weitere Maschinen über {limit} E/A benötigen den Tarif Pro.

{sig}
{site}`,
  },
};

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
const lang = (l) => (T[l] ? l : "cs");
const prefix = (l) => (l === "cs" ? "" : `/${l}`);

// Hlavicky nesmi obsahovat konec radku
const oneLine = (s) => String(s).replace(/[\r\n\t]+/g, " ").trim();

export function downloadUrl(env, token, locale) {
  return `${env.PUBLIC_SITE}${prefix(lang(locale))}/stazeni/?t=${encodeURIComponent(token)}`;
}

function common(env) {
  return { app: env.APP_NAME || "PLCdesk", sig: env.MAIL_SIGNATURE || env.APP_NAME || "PLCdesk", site: env.PUBLIC_SITE };
}

async function send(env, { to, subject, text }) {
  if (env.DEV_MODE) {
    console.log(`[DEV] e-mail pro ${to}: ${subject}\n${text}`);
    return { ok: true, dev: true };
  }
  if (env.MAIL_MODE === "direct") return { ok: true, skipped: true };
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    throw new Error("RESEND_API_KEY nebo MAIL_FROM neni nastaveny - e-mail nelze odeslat");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: oneLine(subject),
      text,
      reply_to: env.MAIL_REPLY_TO || undefined,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export function sendDownloadLink(env, { to, token, locale }) {
  const t = T[lang(locale)];
  const v = { ...common(env), url: downloadUrl(env, token, locale) };
  return send(env, { to, subject: fill(t.dl_subject, v), text: fill(t.dl_body, v) });
}

// Nazvy tarifu v predmetu e-mailu (trial a free-unlock vystavuje jen sprava zakazniku)
const PLAN_NAMES = { pro: "Pro", firma: "Firma", trial: "Trial", "free-unlock": "Free Unlock" };

export function sendLicense(env, { to, key, file, plan, locale }) {
  const t = T[lang(locale)];
  const v = { ...common(env), key, file, plan: PLAN_NAMES[plan] || "Pro" };
  return send(env, { to, subject: fill(t.lic_subject, v), text: fill(t.lic_body, v) });
}

export function sendUnlockConfirmation(env, { to, ioCount, locale }) {
  const t = T[lang(locale)];
  const v = { ...common(env), io: ioCount ? ` (${ioCount} I/O)` : "", limit: env.FREE_IO_LIMIT ?? 64 };
  return send(env, { to, subject: fill(t.un_subject, v), text: fill(t.un_body, v) });
}

// Beta test: potvrzeni zadateli (jazyk prihlasky) a upozorneni provozovateli (cesky, bez osobnich udaju -
// e-mail, jmeno a firma jsou jen ve sprave). Platformy a IDE jsou cisty text (Worker vycistil vstup).
export function sendBetaConfirmation(env, { to, locale, platforms, ide }) {
  const t = T[lang(locale)];
  const v = { ...common(env), platforms, ide };
  return send(env, { to, subject: fill(t.beta_subject, v), text: fill(t.beta_body, v) });
}

export function sendBetaNotice(env, { to, id, platforms, ide, locale }) {
  const t = T.cs;
  const v = { ...common(env), platforms, ide, locale, url: `${env.PUBLIC_SITE}/sprava/#/beta/${encodeURIComponent(id)}` };
  return send(env, { to, subject: fill(t.beta_notice_subject, v), text: fill(t.beta_notice_body, v) });
}
