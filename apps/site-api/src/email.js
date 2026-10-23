// Cloudflare neumí odesílat poštu — Email Routing je jen příchozí přeposílání.
// Transakční maily jdou přes Resend, a to z jiné subdomény než newsletter,
// aby výpadek doručitelnosti marketingu neshodil doručování licenčních klíčů.

async function send(env, { to, subject, text, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject,
      text,
      reply_to: replyTo ?? env.MAIL_REPLY_TO,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function sendDownloadLink(env, { to, token }) {
  const url = `${env.PUBLIC_SITE}/stazeni?t=${token}`;
  return send(env, {
    to,
    subject: 'Váš odkaz ke stažení PLCdesk',
    text: `Dobrý den,

odkaz ke stažení je níž. Nástroj se nemusí instalovat — rozbalte a spusťte,
nepotřebujete práva správce.

${url}

Než se do toho pustíte, dvě věci, které šetří čas:

Začněte menším strojem, který znáte nazpaměť. Uvidíte na výstupech hned,
jestli vám sedí.

Máte-li existující projekt, zkuste nejdřív import tagů — ušetří vám to klikání.

Narazíte-li na cokoli, odepište přímo na tenhle e-mail. Čtu to osobně.

Tomáš Podlena, PLCdesk
${env.PUBLIC_SITE}

Odkaz platí 7 dní. Žádné další e-maily vám nepřijdou, pokud si je nevyžádáte.`,
  });
}

export async function sendLicense(env, { to, key, file, plan }) {
  const planName = plan === 'firma' ? 'Firma' : 'Pro';
  return send(env, {
    to,
    subject: `Licence PLCdesk ${planName}`,
    text: `Dobrý den,

licence je aktivní. Vložte ji v aplikaci přes Nápověda → Licence → Vložit licenci.

Licenční klíč: ${key}

Licenční soubor (zkopírujte celý řádek včetně tečky uprostřed):

${file}

Licence funguje offline. Online spojení potřebuje aplikace jen při prvním
vložení a pak občas na pozadí; když nejste online, nic se nezamkne.

Potřebujete fakturu nebo máte dotaz? Odepište na tenhle e-mail.

Tomáš Podlena, PLCdesk
${env.PUBLIC_SITE}`,
  });
}

export async function sendUnlockConfirmation(env, { to, ioCount }) {
  return send(env, {
    to,
    subject: 'Projekt odemčen',
    text: `Dobrý den,

projekt jsme odemkli — generování i exporty v něm fungují bez omezení velikosti${
      ioCount ? ` (${ioCount} I/O)` : ''
    }. V aplikaci stačí zavřít a znovu otevřít projekt.

Platí to pro tenhle jeden projekt. Další stroje nad 64 I/O už potřebují tarif Pro.

Kdyby cokoli nefungovalo, odepište.

Tomáš Podlena, PLCdesk
${env.PUBLIC_SITE}`,
  });
}
