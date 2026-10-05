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
