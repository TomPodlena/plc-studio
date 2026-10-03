# Web a licenční API — předání

Přidáno na větvi `web-a-licencni-api`: marketingový web a licenční API pro
prodej produktu. Nedotýká se `packages/core` ani stávajících aplikací.

```
apps/site/index.html   landing page (česky, hotová)
apps/site/ukazka.pdf   vzorový balík dokumentace, 11 stran
apps/site-api/         Cloudflare Worker — leady, stahování, licence, Stripe
docs/HANDOFF.md        tenhle soubor
```

Složka je `site-api`, ne `api`: CLAUDE.md drží `apps/api` pro plánované
produktové API (Node + Postgres, účty a projekty, bod 2 roadmapy). Tohle je
něco jiného — backend marketingového webu a licencí, běží na Cloudflare edge.
Až vznikne `apps/api`, bude dobré rozhodnout, kde bude bydlet Stripe; teď je
ve `site-api`, protože s ním přímo souvisí vydání licence.

Testy: `cd apps/site-api && npm test` → 23 scénářů, všechny procházejí.
Běží proti SQLite místo D1, takže nepotřebují Cloudflare účet.

## Co zbývá udělat

1. Nasadit `apps/site/` na Cloudflare Pages.
2. Vytvořit D1 `plcdesk`, pustit `apps/site-api/schema.sql`, doplnit `database_id`
   do `apps/site-api/wrangler.toml`.
3. Vytvořit R2 bucket `plcdesk-releases` (binárky tam, ne do Pages — R2 nemá
   poplatky za egress).
4. Nasadit Worker na `api.plcdesk.io`.
5. `node apps/site-api/tools/keygen.mjs` → soukromý klíč jako secret
   `LICENSE_PRIVATE_KEY`, veřejný do desktopové aplikace.
6. Turnstile: sitekey do `apps/site/index.html` místo
   `PLACEHOLDER_TURNSTILE_SITEKEY`, secret do Workeru.
7. Secrets k dodání: `RESEND_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_TOKEN`.

## Dvě věci k rozhodnutí

**Přejmenování.** Produkt jsme přejmenovali na **PLCdesk** — „PLC Studio" je
v oboru obsazené (Studio 5000, Sysmac Studio) a špatně se brání. Web i API
už mluví o PLCdesk, zbytek repozitáře ne. Přejmenování repa a balíčků je
samostatný úkol; dokud neproběhne, je v kódu obojí.

Jméno jsme ověřovali: `PLCbench` koliduje s akademickým článkem o útocích
LLM agentů na PLC, `PLCforge` je obsazené konkurentem plcforge.ai (AI nástroj
pro analýzu a generování PLC kódu, desktop-first, spuštění červen 2026),
`PLCplan` se ve vyhledávání tluče s „professional learning community plan".
`PLCdesk` je volné. Doména `plcdesk.com` drží spekulant (1 895–5 495 USD),
vzít `.io` nebo `.eu` a hned registrovat `plcdesk.cz` a `plcdesk.de`.

**Vzorové PDF.** `apps/site/ukazka.pdf` jsem vygeneroval samostatným
skriptem, protože jsem neměl přehled o `packages/core`. Core ale umí
dokumentaci sám (`src/docs.ts`, `src/drawing.ts`), takže správně má ukázka
vznikat z něj — ideálně ze vzorového projektu v `packages/core/src/samples.ts`.
PDF ber jako dočasnou výplň a podobu, které se držet: titulní strana, FDS,
sekvence, I/O list, svorkovnice, výřez schématu, alarmy, FAT protokol, návod,
kostra SCL. Patička „Vygenerováno v PLCdesk" na všech stranách kromě titulní.

## Rozhodnutí z marketingu, která drží podobu webu

Neměnit bez rozmyslu — plynou z toho, komu se produkt prodává.

- **Prodává se dokumentací, ne generováním kódu.** Hero mluví o FDS,
  výkresech a svorkovnici. Kód je až třetí blok a je formulovaný jako
  „kostra, ne hotový program". Důvod: konzervativní publikum, které kódu od
  neznámého nástroje nevěří, a plcforge.ai, který na kódu už sedí. Nemá smysl
  se s ním srovnávat na jeho hřišti.
- **Slovo „AI" se v heru nepoužívá.** Spouští obranu dřív, než člověk dočte
  podnadpis. Zmiňovat až u konkrétní funkce níž na stránce.
- **Sekce „Co PLCdesk nedělá".** Nikdy bezpečnostní funkce, negeneruje hotový
  stroj, nenahrazuje projektanta. U tohoto publika prodává přiznané omezení
  líp než superlativ.
- **„Vaše projekty neopouštějí váš počítač."** Silný argument u lidí pod NDA
  s automobilkou nebo německým OEM. Držet i v produkční verzi.

## Ceník a model

| Tarif | Cena | Obsah |
| --- | --- | --- |
| Free | 0 Kč trvale | Neomezený počet projektů do 64 I/O, všechny generátory, exporty s patičkou, bez DXF |
| Pro | 990 Kč/měs | Bez omezení velikosti, čisté exporty, DXF |
| Firma | 2 990 Kč/měs | Pro tým, vlastní knihovna šablon FB |

- Limit I/O je v konfiguraci Workeru (`FREE_IO_LIMIT`), ne v aplikaci — jde
  měnit bez nové verze.
- Patička v exportech je jediná část modelu, kterou nejde obejít rozdělením
  stroje na dva projekty. Zároveň je to distribuční kanál: dokument jde
  zákazníkovi, elektrikáři i na montáž.
- Narazí-li někdo na limit u reálné zakázky, odemkneme mu první projekt
  zdarma (`POST /api/unlock`). Nabízet až v momentě překročení limitu, ne při
  registraci — tam to spotřebují zvědavci.

## Licence

Offline: Worker podepíše JSON tvrzení klíčem Ed25519, aplikace ověří
zabudovaným veřejným klíčem. Online kontrola jen občas, tolerance 30 dní.

Neúspěšná platba licenci **nezamyká**, jen označí `past_due`; zamyká se až
zrušení předplatného, a platnost držíme měsíc za koncem období. Záměr:
výpadek platby nemá shodit člověka uprostřed zakázky. Nezpřísňovat — DRM
u nástroje za tisícovku jen otravuje poctivé a stejně se obejde.

## Pasti

- **Cloudflare neumí odesílat poštu.** Email Routing je jen příchozí
  přeposílání. Odchozí přes Resend, potřebuje ověřenou doménu
  `mail.plcdesk.io`. Newsletter držet na `news.plcdesk.io` zvlášť, ať výpadek
  doručitelnosti marketingu neshodí doručování licenčních klíčů.
- **DPH při prodeji do DE/PL si Stripe neřeší.** Zvážit Paddle jako merchant
  of record, rozhodnout před první platbou.
- **Podpis kódu pro Windows.** Nepodepsaná binárka vyvolá varování
  o neznámém vydavateli a tohle publikum ho neklikne. HW token nebo cloud
  HSM, 7–15 tisíc Kč ročně. Není to volitelné.
- **Portable ZIP před MSI.** Cílovka sedí na firemních noteboocích se
  zamčenými právy; MSI by musela schvalovat IT.

## Chybí na webu

- Stránky `/podminky` a `/soukromi` — omezení odpovědnosti nechat právníkovi.
- Tabulka ověřených verzí (TIA, Studio 5000, TwinCAT, CODESYS…) s datem
  poslední kontroly. U neověřených psát „beta" otevřeně.
