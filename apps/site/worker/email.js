// Transakcni e-maily (odkaz ke stazeni, licence, odemceni projektu) ve ctyrech jazycich (cs, en, de, zh).
//
// Odesila se pres Resend (HTTP API). Cloudflare Email Routing umi jen prichozi
// preposilani. Resend posle cizim adresatum az z overene vlastni domeny - do te doby
// (free tarif bez domeny) bezi web v rezimu MAIL_MODE="direct": odkaz ke stazeni se
// ukaze rovnou na strance a zadny e-mail neodchazi.
//
// Rezimy (promenna MAIL_MODE ve wrangler.toml):
//   "resend"  ostry provoz, vyzaduje RESEND_API_KEY a MAIL_FROM z overene domeny
//   "direct"  zadne e-maily; /api/lead vrati odkaz ke stazeni primo v odpovedi
//   "owner"   bez domeny: posila jen provozovateli (MAIL_OWNER = e-mail uctu Resend) z testovaciho
//             odesilatele Resend (onboarding@resend.dev smi jen na adresu majitele uctu); ostatnim nic,
//             zakaznikum se chova jako "direct" (customerMail = false). Vyzaduje RESEND_API_KEY.
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
- S přijetím přihlášky vám pošleme licenci PLCdesk Pro zdarma na 90 dní.

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
    fb_notice_subject: "Nová zpětná vazba z aplikace ({kind})",
    fb_notice_body: `Nová zpětná vazba z aplikace {app}.

Typ: {kind}
Klient: {client} {version}
Krok: {step}
Jazyk: {lang}
Přiložený projekt: {project}
E-mail pro odpověď: {email}

Text a vyřízení ve správě: {url}
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
- Together with accepting your application we will send you a free PLCdesk Pro licence for 90 days.

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
- Mit der Annahme der Anmeldung senden wir Ihnen eine kostenlose PLCdesk-Pro-Lizenz für 90 Tage.

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
  zh: {
    dl_subject: "您的 {app} 下载链接",
    dl_body: `您好，

下载链接如下。应用程序无需安装：解压后即可运行，不需要管理员权限。

{url}

两条节省时间的建议：
- 先从一台您了如指掌的较小机器开始，马上就能看出输出结果是否符合您的需要。
- 如果您已有现成的项目，请先尝试导入，可以省去很多点击操作。

如遇任何问题，请直接回复此邮件。

{sig}
{site}

链接有效期为 7 天。除非您主动索取，我们不会再向您发送其他邮件。`,
    lic_subject: "{app} {plan} 许可证",
    lic_body: `您好，

您的许可证已激活。请在应用程序中通过 帮助 → 许可证 → 输入许可证 填入。

许可证密钥：{key}

许可证文件（请复制整行，包括中间的点）：

{file}

许可证可离线使用。应用程序仅在首次输入时以及偶尔在后台需要联网。离线时不会锁定任何功能。

需要发票或有任何疑问？请直接回复此邮件。

{sig}
{site}`,
    beta_subject: "您的 {app} 测试版测试申请",
    beta_body: `您好，

感谢您申请参加 {app} 测试版测试。您报名验证以下平台：{platforms}（{ide}）。

接下来的步骤：
- 我们会亲自审阅您的申请，并回复到此邮箱，通常在两个工作日内。
- 确认后，请下载应用程序，在“平台”步骤中保存“验证包”，在您的 IDE 中导入并编译，然后填写 PROTOKOL.md。
- 申请获准时，我们会同时免费向您发送 90 天的 PLCdesk Pro 许可证。

申请中的信息仅用于测试版测试。如果您改变主意，只需回复此邮件，我们将删除您的申请。

{sig}
{site}`,
    un_subject: "项目已解锁",
    un_body: `您好，

我们已解锁您的项目。生成和导出功能均不再受规模限制{io}。只需在应用程序中关闭并重新打开该项目即可。

此解锁仅适用于这一个项目。超过 {limit} 个 I/O 的其他机器需要 Pro 版。

{sig}
{site}`,
  },
};

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
// cs / en / de / zh; jiny jazyk = anglicky, bez jazyka = cesky (puvodni chovani)
const lang = (l) => (typeof l === "string" && Object.hasOwn(T, l) ? l : l ? "en" : "cs");
const prefix = (l) => (l === "cs" ? "" : `/${l}`);

// Hlavicky nesmi obsahovat konec radku
const oneLine = (s) => String(s).replace(/[\r\n\t]+/g, " ").trim();

export function downloadUrl(env, token, locale) {
  return `${env.PUBLIC_SITE}${prefix(lang(locale))}/stazeni/?t=${encodeURIComponent(token)}`;
}

function common(env) {
  return { app: env.APP_NAME || "PLCdesk", sig: env.MAIL_SIGNATURE || env.APP_NAME || "PLCdesk", site: env.PUBLIC_SITE };
}

// Testovaci odesilatel Resend: bez overene domeny smi posilat jen na adresu majitele uctu.
const OWNER_FROM = "PLCdesk <onboarding@resend.dev>";

/** Chodi e-maily zakaznikum? Ne v rezimu "direct" ani "owner" (tam se odkaz / licence predava jinak). */
export const customerMail = (env) => env.MAIL_MODE !== "direct" && env.MAIL_MODE !== "owner";

async function send(env, { to, subject, text }) {
  if (env.DEV_MODE) {
    console.log(`[DEV] e-mail pro ${to}: ${subject}\n${text}`);
    return { ok: true, dev: true };
  }
  if (env.MAIL_MODE === "direct") return { ok: true, skipped: true };
  let from = env.MAIL_FROM;
  if (env.MAIL_MODE === "owner") {
    const owner = String(env.MAIL_OWNER || "").trim().toLowerCase();
    if (!owner || String(to).trim().toLowerCase() !== owner) return { ok: true, skipped: true };
    from = env.MAIL_FROM || OWNER_FROM;
  }
  if (!env.RESEND_API_KEY || !from) {
    throw new Error("RESEND_API_KEY nebo MAIL_FROM neni nastaveny - e-mail nelze odeslat");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
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

// Zpetna vazba z aplikace: upozorneni provozovateli (cesky). Bez textu zpravy a bez e-mailu odesilatele -
// jen typ, klient, verze, krok, jazyk, zda je prilozen projekt / adresa pro odpoved a odkaz do spravy.
const FB_KINDS = { bug: "chyba", idea: "námět", question: "dotaz" };
export function sendFeedbackNotice(env, { to, id, kind, client, version, step, lang, hasProject, hasEmail }) {
  const t = T.cs;
  const v = {
    ...common(env), kind: FB_KINDS[kind] || kind, client, version: version || "", step: step || "—", lang: lang || "—",
    project: hasProject ? "ano" : "ne", email: hasEmail ? "ano (ve správě)" : "ne (anonymně)",
    url: `${env.PUBLIC_SITE}/sprava/#/feedback/${encodeURIComponent(id)}`,
  };
  return send(env, { to, subject: fill(t.fb_notice_subject, v), text: fill(t.fb_notice_body, v) });
}
