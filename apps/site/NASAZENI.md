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
ADMIN_TOKEN=lokalni node scripts/serve.js --demo   # + správa zákazníků /sprava/ se smyšlenými daty
node scripts/shots.js          # snímky 320/390/768/1440 px do _shots/, při přetečení skončí chybou
node scripts/preview.js        # celý web do jednoho HTML (preview.html) ke schválení
node scripts/test-preview.js   # proklikání náhledu i lokálního webu ve všech jazycích
node test/api.test.js          # testy API proti SQLite (Node 22.5+)
node scripts/cms-config.js     # po změně struktury textů přegenerovat admin/config.yml
```

### Snímky aplikace, animace a ilustrace

Obrázky aplikace na webu jsou **skutečné snímky** desktopové aplikace PLCdesk (a jeden snímek
webové verze), žádné fotobanky ani kreslené maketky. Přegenerují se po změně aplikace:

```bash
# z apps/site; Python 3.11 s Pillow, Node 22+, Edge, ffmpeg (jen pro animaci)
python scripts/app-shots.py                    # vše: cs, en, de (≈ 15 min, okna se otevírají a zavírají sama)
python scripts/app-shots.py --lang en --only ziva,schvaleni
python scripts/app-shots.py --only ziva-anim   # jen animace živé simulace
python scripts/app-shots.py --encode-only      # jen znovu převést uložené PNG (ořez, kvalita)
node scripts/iso.js                            # izometrické ilustrace -> templates/_iso-line.html, _spot-*.html
```

- Skript spustí pro každý jazyk **vlastní** proces aplikace (dočasný `PLCSTUDIO_HOME`, jazyk a okno
  1440×900 v `settings.json`), otevře ukázkovou linku LL-03, část položek schválí smyšlenou osobou
  (stejně jako ukázkové PDF), projde kroky a snímá **jen okno aplikace** přes PrintWindow
  (nevadí zamčená stanice ani jiná okna). Zavírá jen okna, která sám otevřel. Pracovní složka
  (PNG, domovská složka aplikace): `--work`, výchozí `%TEMP%/plcdesk-app-shots`.
- Výstup: `assets/img/app/<krok>-<jazyk>.webp` (1440 px) a `…-800.webp` (srcset), kvalita 80,
  každý pod 150 kB. Snímky, které skript už nedělá, z `assets/img/app/` smaže.
- Animace: jeden celý cyklus živé simulace (čas se krokuje po 0,1 s, 20 snímků/s = 2× rychleji),
  ořez na grafické schéma systému → `ziva-anim-<jazyk>.mp4` (H.264, ~0,3 MB) a plakát `.webp`.
  Bez JS nebo při `prefers-reduced-motion` zůstane plakát s ovládáním.
- Snímek importu používá veřejný projekt z `packages/core/test-data/real/` (licence BSD-2).
- V šablonách: `{{.shot|shot}}` / `{{.|shotwide}}` (objekt `{key, path, alt, cap?}` v obsahu)
  vloží okno se snímkem, `<picture>`, rozměry čte build z WebP a odkaz otevře lightbox.

Texty jsou jen v `content/{cs,en,de}.json` (čeština je zdroj pravdy, struktura shodná).
Název značky, adresa webu a kontakt jsou jen v `content/site.json`; v textech se píší jako `{{site.brand}}`.

**Stav ověření platforem** je jen v `data/verification.json` (kořen repozitáře, sdílí ho jádro i aplikace).
Build z něj bere počet platforem (`{{site.platform_count}}` v textech — číslo se nepíše natvrdo), „Stav k“
(nejnovější datum) a stav každého řádku tabulky na stránce Platformy. Řádek v `content/<jazyk>.json` nese
`key` (platforma) nebo `members` (sloučený řádek, dlaždice se rozvinou po platformách). Platforma bez řádku,
řádek bez platformy nebo jiný stav = varování buildu → nasazení se zastaví. Po ověření nové platformy proto
upravit `data/verification.json` (+ protokol v `docs/verification/`) a řádek ve všech třech jazycích.

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
npx wrangler@4 d1 execute plcdesk --remote --file=schema_admin.sql   # správa zákazníků (viz níže)
```

### A3. Ochrana formuláře Turnstile — zdarma
1. Dashboard → **Turnstile** → *Add widget*, hostname `plcdesk.<účet>.workers.dev`, režim *Managed*.
2. **Site key** (veřejný, není tajný) je v `content/site.json` → `turnstile_sitekey`
   (nyní `0x4AAAAAAFM-FbL-8dZLSk-N`). Přebít ho jde proměnnou `TURNSTILE_SITEKEY` při buildu
   (v GitHubu jako *Variable*). Bez obojího web běží na testovacím klíči, který pustí kohokoli —
   build to vypíše jako POZOR. Ostrý klíč platí jen pro doménu webu, proto `serve.js` a `preview.js`
   lokálně dosazují testovací klíč samy (`dist/` pro nasazení zůstává ostrý); `node scripts/build.js
   --test` postaví celý `dist/` s testovacím klíčem (nenasazovat).
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

## Správa zákazníků (/sprava)

Stránka **`https://<web>/sprava/`** je jen pro provozovatele: přehled (zájemci, licence podle tarifu,
po splatnosti, zrušené, aktivní počítače, platby), zákazníci s hledáním a filtrem stavu, detail
zákazníka (zájem o stažení, licence, počítače, platby, poznámky), vystavení / prodloužení / zrušení
licence, uvolnění počítače, export CSV (středník + BOM pro český Excel) a audit. Na webu na ni nevede
žádný odkaz, není v sitemapě a nese `noindex`. Kód: `worker/admin.js` (API `/api/admin/*`),
`worker/crm.js` (obchodní kanban), `sprava/` (stránka), tabulky `schema_admin.sql`.

### Migrace D1 — zdarma (jednou, před nasazením Workeru se správou)
```bash
npx wrangler@4 d1 execute plcdesk --remote --file=schema_admin.sql
```
Migrace je idempotentní (jen `CREATE … IF NOT EXISTS`), jde spustit opakovaně. Zakládá tabulky
`admin_attempts` (pokusy o přihlášení), `admin_sessions` (relace), `admin_audit`, `customer_notes`
a `payment_log` (platební události k zákazníkovi — evidují se od nasazení, starší v detailu nejsou).
Bez migrace přihlášení do správy končí chybou 500; webhooky plateb fungují dál.
Stejný příkaz zakládá i tabulky obchodního kanbanu `crm_leads`, `crm_events` a `crm_suppressed`
(viz níže). Kdo už správu nasadil, spustí ho po aktualizaci znovu — existující tabulky a data
zůstanou beze změny, jen přibudou nové. Bez toho záložka Leady končí chybou 500.

### Obchodní kanban leadů (záložka Leady)
`/sprava/#/leady`: sloupce **Prospekce → Nový → Kontaktován → Zkouší → Nabídka → Zákazník → Ztracen**
(ztracené jsou sbalené). Karta = firma: segment (integrátor / strojírna / výrobce / jiné), město, zdroj,
další krok s termínem (po termínu zvýrazněný), odhad hodnoty v Kč za rok (součet ve sloupci).
- **Přesun:** přetažením (HTML5 drag & drop), šipkami na kartě, s fokusem na kartě Alt+← / Alt+→,
  na mobilu výběrem fáze. Každý přesun jde do historie karty i do auditu; u „Ztracen“ se ptá na důvod.
- **Detail karty:** úprava údajů, změna fáze, historie (založení, úpravy, přesuny, poznámky, kontakty),
  zápis poznámky nebo kontaktu, odkaz na zákazníka ve správě (když e-mail karty odpovídá), smazání.
- **Formulář ke stažení:** zájemci z tabulky `leads` se při načtení tabule sami přidají do sloupce Nový
  (bez duplicit podle e-mailu). Má-li e-mail aktivní licenci, karta ukáže návrh „Přesunout do Zákazník“ —
  ručně nastavenou fázi nic samo nepřepisuje. Smazaná karta s e-mailem se znovu nezaloží
  (`crm_suppressed`); záznam v `leads` se maže zvlášť.
- **Import z průzkumu:** tlačítko *Import JSON* → soubor (max. 500 řádků, 700 kB): pole objektů nebo
  `{"leads": [...]}` s poli `company` (povinné), `website`, `segment`, `country`, `city`, `source_url`,
  `note`. Nejdřív náhled (nové / duplicity / neplatné), import až po potvrzení. Deduplikace podle domény
  webu (`www.` a cesta se ignorují) a e-mailu, proti kanbanu i uvnitř souboru. Karty jdou do Prospekce se
  zdrojem *Průzkum*. **Jména a telefony se z průzkumu neimportují** — kontaktní osobu, telefon a e-mail
  doplňuje provozovatel ručně, až s firmou jedná (oprávněný zájem, B2B; popsané v Ochraně osobních údajů,
  při námitce kartu smazat).
- **Export:** *Export CSV* (středník + BOM), zapisuje se do auditu.
- API (vše za přihlášením, změny s kontrolou Origin + X-Requested-With, audit): `GET /api/admin/crm`
  (`?segment=&country=&q=`), `GET /api/admin/crm/lead?id=`, `POST /api/admin/crm/lead` (bez `id` založí,
  s `id` upraví poslaná pole), `POST /api/admin/crm/move`, `POST /api/admin/crm/note`,
  `POST /api/admin/crm/delete`, `POST /api/admin/crm/import` (`dry_run: true` = náhled),
  `GET /api/admin/crm/export.csv`. Kód: `worker/crm.js`.

### Přihlášení tokenem — funguje hned, zdarma
Na `/sprava/` zadejte hodnotu secretu `ADMIN_TOKEN` (viz A4; dlouhý náhodný řetězec, např.
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
- Po přihlášení dostane prohlížeč cookie `__Host-plcdesk_admin` (HttpOnly, Secure, SameSite=Strict,
  platnost 8 h). Obsahuje jen podepsané (HMAC-SHA256, klíč odvozený z tokenu) id relace a konec
  platnosti; relace je i v D1, takže **Odhlásit** ji zneplatní i na serveru.
- 5 neúspěšných pokusů z jedné IP (u IPv6 z celé sítě /64) za 15 minut → 429 na zbytek okna.
  Každý neúspěch jde do logu Workeru a do auditu.
- Všechny změny vyžadují hlavičku `Origin` = `PUBLIC_SITE` a `X-Requested-With` (ochrana CSRF).
- Skripty: `POST /api/admin/license` s hlavičkou `X-Admin-Token: <token>` nebo
  `Authorization: Bearer <token>` funguje dál (jen vystavení licence; pokusy se počítají do limitu).

**Rotace tokenu** (únik, odchod člověka, jednou za čas):
```bash
npx wrangler@4 secret put ADMIN_TOKEN     # nový řetězec; platí okamžitě, bez nového nasazení
```
Klíč cookie je z tokenu odvozený — změnou tokenu se **odhlásí všechny relace**. Starý token
vyřaďte i ze skriptů a správce hesel.

### Volitelně: Cloudflare Access (přihlášení e-mailem, druhý faktor u Cloudflare)
Access ověří provozovatele dřív, než požadavek dojde k Workeru; Worker navíc ověří podepsaný JWT
(`Cf-Access-Jwt-Assertion`: RS256 proti klíčům týmu, `aud`, `iss`, `exp`) a e-mail proti `ADMIN_EMAILS`.
**[MOŽNÁ PLACENÉ]** Zero Trust Free (do 50 uživatelů) je zdarma, ale při aktivaci může chtít
platební kartu i pro Free plán — před zadáním karty ověřit, nic se nekupuje.
1. Dashboard → **Zero Trust** → při prvním otevření zvolte *team name* (např. `plcdesk`) a plán Free.
   Týmová doména je pak `plcdesk.cloudflareaccess.com`.
2. *Access → Applications → Add an application → Self-hosted*: název „PLCdesk správa“, doména
   `plcdesk.<účet>.workers.dev` s cestou `sprava`, druhá cílová cesta `api/admin` (obě v jedné aplikaci).
   Politika *Allow*: *Emails* = vaše adresa(y). Metoda přihlášení: jednorázový kód e-mailem (výchozí).
3. V aplikaci zkopírujte **Application Audience (AUD) Tag**.
4. Do `wrangler.toml` (`[vars]`) doplňte a nasaďte:
   ```toml
   ACCESS_TEAM_DOMAIN = "plcdesk"            # nebo plcdesk.cloudflareaccess.com
   ACCESS_AUD = "<AUD tag>"
   ADMIN_EMAILS = "vy@firma.cz"              # čárkami; prázdné = nikdo (fail-closed)
   ```
Pozor: Access na cestě `/api/admin` zablokuje i skripty s `X-Admin-Token` — pro ně v Access přidejte
*Service Token* (politika *Service Auth*) a posílejte `CF-Access-Client-Id` / `CF-Access-Client-Secret`,
nebo skripty pouštějte přes stránku správy. Přihlášení tokenem zůstává jako záložní cesta (za Access);
kdo chce jen Access, smaže secret `ADMIN_TOKEN` (`npx wrangler@4 secret delete ADMIN_TOKEN`).
Týmová doména musí končit `.cloudflareaccess.com`, jinak Worker Access nepovolí (klíče nestahuje odjinud).

### Bezpečnostní hlavičky a údaje
`/sprava` obsluhuje Worker (`run_worker_first` ve `wrangler.toml`) a přidá přísnou CSP
(`default-src 'self'; frame-ancestors 'none'`, žádné inline skripty), `X-Frame-Options: DENY`,
`Cache-Control: no-store`, `X-Robots-Tag: noindex`; totéž `no-store` / `DENY` u `/api/admin/*`.
Audit zapisuje kdo (e-mail z Access, nebo „token“), kdy, co a nad čím; licenční klíče jen zkrácené,
otisky počítačů zkrácené. Uchování: audit 3 roky, neúspěšná přihlášení 30 dní (maže se samo).
Stránky Cookies a Ochrana osobních údajů tuto cookie a audit popisují.

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
| `ADMIN_TOKEN` | A4 | přihlášení do správy `/sprava` tokenem i ruční vystavení licencí skriptem zavřené (503; bez tokenu i bez Access je zavřená celá správa) |
| `RESEND_API_KEY` | B2 | v režimu `resend` formulář hlásí chybu (nic se tiše nezahodí) |
| `STRIPE_WEBHOOK_SECRET` | B4, Stripe | webhook nepřijme nic (503) |
| `PADDLE_WEBHOOK_SECRET` | B4, Paddle | webhook nepřijme nic (503) |
| `PADDLE_API_KEY` | B4, Paddle | licence se nevydá, když Paddle nepošle e-mail zákazníka (chyba v logu) |

Lokálně (`npx wrangler@4 dev --local`) jdou do souboru `.dev.vars` (je v `.gitignore`), např.
`DEV_MODE=1`. Vývojový režim se zapíná jen výslovně, nikdy chybějícím klíčem.
