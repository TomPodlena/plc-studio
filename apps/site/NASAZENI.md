# Web PLCdesk — nasazení krok za krokem

Web i licenční API běží jako **jeden Cloudflare Worker** (`worker/index.js`): statické stránky
z `dist/` obsluhuje Cloudflare přímo, Worker řeší jen `/api/*`. Postup je rozdělený na dvě části:

- **A. Start zdarma** — vše na free tarifech, bez platební karty, bez vlastní domény.
  Web poběží na `https://plcdesk.<účet>.workers.dev`.
- **B. Placené kroky později** — doména, e-mail z vlastní domény, platby, podpis aplikace.
  Každý je volitelný a dá se udělat zvlášť. **Ceny jsou orientační, před nákupem ověřit.**

Příkazy spouštějte ve složce `apps/site`. Potřebujete jen Node 22+ (Wrangler se stáhne přes `npx`).

---

## Lokálně (bez účtu, nic nestojí)

```bash
node scripts/ukazka-pdf.js     # ukázková PDF z jádra (packages/core/dist) přes headless Edge
node scripts/build.js          # web do dist/, musí skončit „0 varovani“
node scripts/serve.js          # http://localhost:4173 — web i API (SQLite v paměti, bez e-mailů)
node scripts/shots.js          # snímky 320/390/768/1440 px do _shots/, při přetečení skončí chybou
node scripts/preview.js        # celý web do jednoho HTML (preview.html) ke schválení
node scripts/test-preview.js   # proklikání náhledu i lokálního webu ve všech jazycích
node test/api.test.js          # testy API proti SQLite (Node 22.5+)
node scripts/cms-config.js     # po změně struktury textů přegenerovat admin/config.yml
```

Texty jsou jen v `content/{cs,en,de}.json` (čeština je zdroj pravdy, struktura shodná).
Název značky, adresa webu a kontakt jsou jen v `content/site.json`; v textech se píší jako `{{site.brand}}`.

---

## A. Start zdarma

### A1. Účet Cloudflare — zdarma
1. Založte účet na <https://dash.cloudflare.com/sign-up> (e-mail a heslo, karta se nezadává).
2. V sekci **Workers & Pages** si při prvním otevření zvolíte subdoménu účtu `<účet>.workers.dev`.
   Volí se jednou pro celý účet — vyberte neutrální název (např. `plcdesk`).
3. Doplňte adresu webu na **dvě** místa (musí sedět):
   - `content/site.json` → `"url": "https://plcdesk.<účet>.workers.dev"`
   - `wrangler.toml` → `PUBLIC_SITE = "https://plcdesk.<účet>.workers.dev"`
4. Přihlaste Wrangler: `npx wrangler@4 login` (otevře prohlížeč).

### A2. Databáze D1 — zdarma
```bash
npx wrangler@4 d1 create plcdesk          # vypíše database_id
```
`database_id` vložte do `wrangler.toml` místo `PLACEHOLDER_ID_…`. Pak tabulky:
```bash
npx wrangler@4 d1 execute plcdesk --remote --file=schema.sql
```

### A3. Ochrana formuláře Turnstile — zdarma
1. Dashboard → **Turnstile** → *Add widget*, hostname `plcdesk.<účet>.workers.dev`, režim *Managed*.
2. **Site key** (veřejný) se předává buildu: proměnná `TURNSTILE_SITEKEY` (v GitHubu jako
   *Variable*, lokálně `TURNSTILE_SITEKEY=… node scripts/build.js`). Bez ní web běží na testovacím
   klíči, který pustí kohokoli — build to vypíše jako POZOR.
3. **Secret key**: `npx wrangler@4 secret put TURNSTILE_SECRET`.
   Bez něj je formulář **zavřený** (503) — záměrně, chybějící nastavení nikdy nevypne ochranu.

### A4. Licenční klíče a správa — zdarma
```bash
node tools/keygen.js                          # vypíše soukromý a veřejný klíč Ed25519
npx wrangler@4 secret put LICENSE_PRIVATE_KEY # vložit soukromý klíč
npx wrangler@4 secret put ADMIN_TOKEN         # dlouhý náhodný řetězec pro ruční vystavení licencí
```
Soukromý klíč si zálohujte mimo repozitář (správce hesel). Když se ztratí, vydané licence nepůjde
ověřit novou verzí aplikace. Veřejný klíč patří do aplikace (až bude licencování v aplikaci).

### A5. Soubor ke stažení — zdarma (GitHub Releases)
R2 (úložiště Cloudflare) vyžaduje kartu, proto se na startu stahuje z **GitHub Releases**:
1. V repozitáři *Releases → Draft a new release*, nahrajte `PLCdesk-<verze>-portable.zip`.
2. Odkaz na soubor vložte do `wrangler.toml` → `DOWNLOAD_URL`, verzi do `RELEASE_VERSION`.

Formulář na stránce Ke stažení ukáže odkaz rovnou (`MAIL_MODE = "direct"`) — bez vlastní domény
nejde posílat e-maily cizím adresátům. Adresa zájemce se i tak uloží do D1.
Pozor: soubor v Releases veřejného repozitáře je dohledatelný i bez formuláře.

### A6. První nasazení — zdarma
```bash
npx wrangler@4 deploy        # build proběhne sám; když build hlásí varování, nasazení se zastaví
```
Kontrola: otevřít web, projít jazyky, odeslat formulář na Ke stažení (má se ukázat odkaz),
`https://plcdesk.<účet>.workers.dev/api/config` vrátí `{"free_io_limit":64,…}`.

### A7. Automatické nasazení po pushi — zdarma
Workflow `.github/workflows/deploy-site.yml` při pushi do `main` (změny v `apps/site/**`) spustí
kontrolu syntaxe, testy API, build a nasazení. Bez tokenu jen testuje a nasazení přeskočí.
GitHub → *Settings → Secrets and variables → Actions*:
- **Secrets:** `CLOUDFLARE_API_TOKEN` (Cloudflare → *My Profile → API Tokens → Create Token →*
  šablona *Edit Cloudflare Workers*, přidat oprávnění *D1 Edit*), `CLOUDFLARE_ACCOUNT_ID`
  (Dashboard → Workers & Pages, pravý sloupec).
- **Variables:** `SITE_URL`, `TURNSTILE_SITEKEY`.

### A8. Úpravy textů přes administraci (Sveltia CMS) — zdarma
`/admin/` je Sveltia CMS; uložení = commit do `main` = nové nasazení.
1. GitHub → *Settings → Developer settings → OAuth Apps → New OAuth App*
   (Homepage `https://plcdesk.<účet>.workers.dev`, callback doplníte v kroku 2).
2. Nasaďte přihlašovací Worker podle <https://github.com/sveltia/sveltia-cms-auth>
   (tlačítko *Deploy to Cloudflare*, zdarma). Do něj secrets `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET` a `ALLOWED_DOMAINS=plcdesk.<účet>.workers.dev`. Callback URL OAuth
   aplikace je `https://sveltia-cms-auth.<účet>.workers.dev/callback`.
3. Adresu přihlašovacího Workeru vložte do `scripts/cms-config.js` (`base_url`) a spusťte
   `node scripts/cms-config.js`. (`admin/config.yml` je generovaný, ručně ho neupravovat.)

### A9. Návštěvnost — zdarma, volitelné
Dashboard → *Analytics & Logs → Web Analytics* → přidat web. Bez cookies, do kódu se nic nepřidává.

### Limity free tarifů a co se stane při překročení

| Služba | Zdarma | Při překročení |
|---|---|---|
| Workers Free | 100 000 požadavků na Worker denně, 10 ms CPU na požadavek; statické stránky se nepočítají | `/api/*` vrací chybu do půlnoci UTC; stránky běží dál. Řešení: Workers Paid (B6) |
| D1 Free | 5 GB, 5 mil. čtených a 100 000 zapsaných řádků denně | dotazy selhávají do půlnoci UTC (formulář, aktivace licencí) |
| Turnstile | zdarma, bez limitu ověření pro běžný web | — |
| GitHub Actions | veřejné repo bez limitu, soukromé 2 000 minut měsíčně (jeden běh ≈ 1 min) | další běhy čekají do dalšího měsíce; nasadit jde ručně (A6) |
| GitHub Releases | soubory do 2 GB, bez limitu stahování | — |
| Sveltia CMS + auth Worker | zdarma (auth Worker se vejde do Workers Free) | — |

Hodnoty odpovídají ceníkům ke dni psaní (říjen 2026) — před spuštěním ověřte na
<https://developers.cloudflare.com/workers/platform/pricing/> a
<https://developers.cloudflare.com/d1/platform/pricing/>.

---

## B. Placené kroky později (volitelné)

| Krok | Proč | Orientační cena |
|---|---|---|
| **B1. Doména** | důvěryhodnější adresa než workers.dev, nutná pro e-maily | **[PLACENÉ]** `.eu` / `.cz` cca 150–400 Kč/rok; `.dev` / `.app` cca 300–400 Kč/rok; `.io` cca 1 000–1 500 Kč/rok |
| **B2. E-mail z domény** | odesílání odkazů a licencí (Resend), příjem pošty | **[PLACENÉ]** Resend zdarma do 3 000 e-mailů/měsíc (100 denně); příjem přes Cloudflare Email Routing zdarma. Platí se jen doména |
| **B3. R2 pro instalačky** | soubor ke stažení jen přes formulář | **[PLACENÉ]** 10 GB zdarma, ale vyžaduje kartu v účtu; nad limit cca 0,015 USD/GB měsíčně |
| **B4. Platby** | prodej tarifů Pro (990 Kč / 39 €) a Firma (2 990 Kč / 119 €) měsíčně — ceny schválené | **[PLACENÉ — poplatky z plateb]** Stripe nebo Paddle, viz srovnání níže; bez měsíčního paušálu |
| **B5. Podpis aplikace** | bez podpisu Windows ukazuje „neznámý vydavatel“ | **[PLACENÉ]** certifikát OV cca 7 000–15 000 Kč/rok (HW token nebo cloud HSM) |
| **B6. Workers Paid** | jen pokud nestačí free limity | **[PLACENÉ]** 5 USD/měsíc |
| **B7. Právník** | revize návrhů podmínek, ochrany údajů a cookies (texty jsou hotové jako návrh, provozovatel „TBC“) | **[PLACENÉ]** dle nabídky |

Postup po krocích:

- **B1 Doména.** Volné byly (ověřeno přes DNS/RDAP): `plcdesk.eu`, `.cz`, `.io`, `.app`, `.dev`,
  `.net`. `plcdesk.com` je na prodej u HugeDomains (cca 1 895 USD) — nekupovat.
  Po koupi: přidat doménu do Cloudflare, ve `wrangler.toml` doplnit
  `routes = [{ pattern = "plcdesk.eu", custom_domain = true }]`, změnit adresu na dvou místech
  (A1 bod 3), v Turnstile přidat hostname a v GitHubu změnit `SITE_URL`.
- **B2 E-mail.** Resend: ověřit subdoménu `mail.<doména>` (DNS záznamy přidá Cloudflare),
  `npx wrangler@4 secret put RESEND_API_KEY`, ve `wrangler.toml` `MAIL_MODE = "resend"`,
  `MAIL_FROM = "PLCdesk <noreply@mail.<doména>>"`, `MAIL_REPLY_TO`. Newsletter (pokud bude) držet
  na jiné subdoméně, ať výpadek doručitelnosti neshodí licence. Kontakt v `content/site.json`
  (`email`, nyní podlena.t@gmail.com) po koupi domény změnit na doménovou adresu.
- **B3 R2.** `npx wrangler@4 r2 bucket create plcdesk-releases`, odkomentovat `[[r2_buckets]]`,
  nahrát soubor a `latest.json` (`{"version":"…","assets":{"portable":{"key":"…","filename":"…"}}}`).
- **B4 Platby — Stripe, nebo Paddle (volí se jedním nastavením).** Worker umí oba; zapnutý je vždy jen
  jeden. Volba: `PAYMENT_PROVIDER` ve `wrangler.toml` (Worker, webhooky) a stejná hodnota
  v `content/site.json` → `payments.provider` (tlačítka na stránce Ceník). Prázdné = platby vypnuté,
  tlačítka Pro/Firma vedou na Kontakt a oba webhooky vrací 404. Bez secretu zvoleného poskytovatele
  webhook nepřijme nic (503).

  | | **Stripe** | **Paddle Billing** |
  |---|---|---|
  | Kdo je prodejce | vy | Paddle (Merchant of Record) |
  | DPH v EU (OSS), faktury | řešíte sami (registrace OSS, doklady) | řeší Paddle, vystavuje doklady |
  | Poplatky (orientačně, ověřit) | **[PLACENÉ]** cca 1,5 % + 0,25 € za kartu z EHP, + 0,7 % Stripe Billing za předplatné | **[PLACENÉ]** cca 5 % + 0,50 USD za transakci, vše v ceně |
  | Výplata | na váš účet, bez prostředníka | Paddle vyplácí po odečtení poplatků a daní |
  | Schválení účtu | rychlé | Paddle prověřuje produkt a web (podmínky, ceník, kontakt musí být hotové) |
  | Doporučení | víc práce s DPH, nižší poplatky | jednodušší start s prodejem do DE/EU |

  **Stripe:** ve Stripe založit produkty Pro a Firma (měsíční cena), ke každému *Payment Link*
  s metadaty `plan` = `pro` / `firma`. Odkazy do `content/site.json` → `payments.stripe_link_pro`,
  `stripe_link_firma` (web k nim připojí `client_reference_id=<jazyk>` pro jazyk e-mailu).
  Webhook na `https://<web>/api/stripe/webhook` s událostmi `checkout.session.completed`,
  `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`;
  `npx wrangler@4 secret put STRIPE_WEBHOOK_SECRET`; `PAYMENT_PROVIDER = "stripe"`.

  **Paddle:** v Paddle (nejdřív sandbox) založit produkty a měsíční ceny Pro a Firma → `pri_…`
  do `payments.paddle_price_pro` / `paddle_price_firma`, *client-side token* do
  `payments.paddle_client_token` (token `test_…` = sandbox). Web otevře Paddle checkout overlay
  a předá `customData` s tarifem a jazykem. *Notification destination* na
  `https://<web>/api/paddle/webhook` s událostmi `transaction.completed`,
  `subscription.activated`, `subscription.past_due`, `subscription.canceled`; její *secret key*
  → `npx wrangler@4 secret put PADDLE_WEBHOOK_SECRET`. Paddle ve webhooku neposílá e-mail
  zákazníka, proto také `npx wrangler@4 secret put PADDLE_API_KEY` (API klíč s právem číst
  zákazníky). `PAYMENT_PROVIDER = "paddle"`.

  Oba webhooky ověřují podpis (HMAC-SHA256, okno 5 minut), každou událost zpracují jen jednou
  (tabulka `payment_events`) a na jedno předplatné vydají nejvýš jednu licenci. Při změně
  `schema.sql` po prvním nasazení znovu spustit `d1 execute` (tabulky se zakládají `IF NOT EXISTS`).
- **B5 Podpis.** Bez podpisu cílovka aplikaci nespustí. Certifikát na firmu, podepisovat ZIP
  i spustitelný soubor. Přenosný ZIP má přednost před MSI (firemní notebooky bez práv správce).

---

## Provozovatel a právní texty

Stránky Obchodní a licenční podmínky, Ochrana osobních údajů a Cookies jsou hotové jako **návrh
k revizi právníkem** (štítek „Čeká na právníka“ zůstává viditelný). Údaje o provozovateli a datum
účinnosti jsou na jednom místě: `content/site.json` → `operator` (`name`, `id`, `address`) a
`legal_effective`, zatím „TBC“. Build to vypisuje jako POZOR (není to chyba ani varování buildu).
Po revizi: doplnit údaje, datum účinnosti a štítek z šablony `templates/legal.html` odebrat.

---

## Tajné hodnoty Workeru (souhrn)

| Název | Kdy | Bez něj |
|---|---|---|
| `TURNSTILE_SECRET` | A3 | formulář zavřený (503) |
| `LICENSE_PRIVATE_KEY` | A4 | aktivace licencí končí chybou |
| `ADMIN_TOKEN` | A4 | ruční vystavení licencí zavřené (503) |
| `RESEND_API_KEY` | B2 | v režimu `resend` formulář hlásí chybu (nic se tiše nezahodí) |
| `STRIPE_WEBHOOK_SECRET` | B4, Stripe | webhook nepřijme nic (503) |
| `PADDLE_WEBHOOK_SECRET` | B4, Paddle | webhook nepřijme nic (503) |
| `PADDLE_API_KEY` | B4, Paddle | licence se nevydá, když Paddle nepošle e-mail zákazníka (chyba v logu) |

Lokálně (`npx wrangler@4 dev --local`) jdou do souboru `.dev.vars` (je v `.gitignore`), např.
`DEV_MODE=1`. Vývojový režim se zapíná jen výslovně, nikdy chybějícím klíčem.
