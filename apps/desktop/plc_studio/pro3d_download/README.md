# pro3d_download — řízené ruční stahování modelů (PLCdesk PRO)

Převzato ze stagingu plcdesk_freecad (README, oddíly „Portály výrobců — podmínky“ a „Ruční stahování“, stav 2026-10-14;
`tools/register_manual.py`, `models_index.py`, `check_step.py` a test). V aplikaci: `listing.py` (seznam podle
`vendors.json`, STAHNOUT.md / .html, párování, knihovna modelů, registrace, náhrada zástupných dílů) — viz CLAUDE.md,
oddíl PLCdesk PRO. Cesty `tools/…` a `pilot/…` níže jsou cesty stagingu; v PLCdesk je nástroj
`apps/desktop/plc_studio/pro3d_download/register_manual.py` a FreeCAD slot `pro3d-dl`.

## Portály výrobců — podmínky (stav 2026-10-14, jen čtení veřejných stránek)

Automat = skriptované hledání / stahování. „Neuvedeno“ bereme jako **ne bez písemného souhlasu**. Kde portál běží
na CADENAS (PARTcommunity / eCATALOG), platí podmínky CADENAS včetně čl. 12.3 (vii) a fair use 50 / den.

| Portál | Ruční | Automat | Podmínky (zkráceně) | Zdroj a citace |
|---|---|---|---|---|
| **3Dfindit / PARTcommunity (CADENAS)** | ano, přihlášený B2B uživatel, 50 / den | **ne** | čl. 12.3 (vii) zákaz skriptů a automatických dotazů; (viii) systematický sběr jen s předchozím písemným souhlasem; čl. 2 zákaz trénování AI (pokuta 20 000 € + 500 € / soubor); čl. 8 (1) PLM ano, vlastní databáze ne | [terms-of-use-3d-cad-models](https://www.cadenas.de/terms-of-use-3d-cad-models), [PARTcommunity B2B](https://cadenas.de/en/legal/partcommunity-b2b/terms-of-use): „generate automated searches or queries, or remove, intercept or collect data from the Website or Services“; „fair use policy (50 download tickets per day)“ |
| **Siemens** (SiePortal / Industry Mall, CAx Download Manager) | ano, zdarma; Download Manager po registraci | **ne** | jen zákazníci Siemens pro interní účely, jiné užití s písemným svolením; nepředávat třetím; obecné podmínky zakazují text a data mining. CAx Download Manager = oficiální **ruční** hromadné stažení (seznam objednacích čísel → jeden archiv, čísla jednotlivě). Vlastní licence CAx dat nenalezena (neověřeno) | [siemens.com terms-of-use](https://www.siemens.com/de-de/terms-of-use/) §6.2 (zákaz „Text- oder Data-Mining“), [bilddb](https://www.automation.siemens.com/bilddb/index.aspx): „dürfen nur von Siemens-Kunden für interne Zwecke … verwendet werden … Jede andere Nutzung erfordert eine schriftliche Genehmigung“; [fórum](https://support.industry.siemens.com/forum/ww/en/post/1041621): „These item numbers must be entered separately.“ |
| **Rittal** | ano | **ne** | CAD přes rittal.partcommunity.com = CADENAS → podmínky CADENAS | [rittal.com CAD-Data](https://www.rittal.com/sg-en/Software/CAD-Data): „Download data directly via the „PARTcommunity“ Web platform“ |
| **Phoenix Contact** | ano | neuvedeno → ne | CAD jen pro distribuci / použití vlastních výrobků uživatele, úpravy a předání jen s písemným souhlasem, licence odvolatelná (4 týdny); obecné podmínky webu k automatu neověřeny | [Terms of Use for WORKS (10/2020)](https://assets.phoenixcontact.com/file/10479e5a-a2ef-49ec-b119-771ecb9d8d30/media/original) čl. 3.3.2: „CAD data … are for the purpose of distributing the USER's own products“; čl. 3.5 |
| **WAGO** | ano, jednorázové přihlášení | **ne** | CAD přes wago.partcommunity.com = CADENAS; „unlimited“ na webu WAGO nemusí rušit limit CADENAS (neověřeno) | [wago.com design-cad-data](https://www.wago.com/global/trends-topics-technologies/topics/digital-engineering/design-cad-data): „Unlimited parts downloads after one-time login.“ |
| **ifm electronic** | neověřeno (dřív bez registrace) | neověřeno → ne | podmínky ani dnešní cesta ke CAD na ifm.com nenalezeny; modely ifm jsou na 3Dfindit | [blog 2013 (zastaralé)](https://de.industryarena.com/ifm/blog/cad-daten-kostenlos-und-ohne-anmeldung-downloaden--1440.html) |
| **Werma** | neověřeno | neověřeno → ne | download centrum werma.com CAD nenabízí; modely Werma jsou na 3Dfindit (a přes distributory na TraceParts — vlastní podmínky) | [werma.com downloadcentre](https://www.werma.com/en/service/downloadcentre/) |
| **Festo** | ano | **ne** | katalog na CADENAS eCATALOG → podmínky CADENAS; vlastní podmínky Festo pro dokumentaci: jen interní užití (na CAD výslovně ne; festo.com vrací botům 403 — neověřeno) | [CADENAS: Festo eCATALOG](https://cadenas.de/it/news/festo-shines-with-golden-catalog-seal-by-cadenas-award-winning-digital-3d-cad-product-catalog), [podmínky dokumentace](https://www.festo.com/fox/net/supportportal/Downloads/654839/724655/Nutzungsbedingungen_396528_pt.pdf) |
| **SMC** | ano (část po registraci) | **ne** | knihovna „uses the CADENAS system“ → podmínky CADENAS | [smcworld cadlib help](https://www.smcworld.com/cadlib/en/help.jsp) |

Důsledek: **Siemens** stahovat ze SiePortal (CAx Download Manager — ruční hromadné stažení, nespotřebuje tickety
CADENAS, pokryje i díly, které 3Dfindit nemá: S7-1200 G2, servomotory 1FL6, SIMOGEAR v DT Configuratoru);
Festo, Rittal, WAGO, SMC, ifm, Werma ručně z 3Dfindit (stejné podmínky, přesná varianta z dřívějšího resolve);
SICK, Balluff, ROSS, Phoenix Contact z webu výrobce. Automatizace jen po písemné dohodě (`pilot/ZADOST_CADENAS.md`).
Oficiální veřejné API 3Dfindit / PARTcommunity pro vývojáře CADENAS nezveřejňuje (2026-10-14); doplněk 3Dfindit
pro FreeCAD (github.com/cadenasgmbh/3dfindit-freecad-integration) je archivovaný a neudržovaný.

## Ruční stahování — `pilot/STAHNOUT_RUCNE.md` a `tools/register_manual.py`

Model stahuje **člověk v prohlížeči**; nástroj nic nehledá ani nestahuje (síť nepoužívá vůbec).

```bat
rem 1) seznam ke stažení (z manifestů, dřívějších resolve / kandidátů a indexů na disku)
%PY% tools\register_manual.py todo --pilot-root pilot --pilots 11,17,26
rem    -> pilot\STAHNOUT_RUCNE.md: pořadí podle důležitosti, odkaz, varianta, přesný název souboru, stav, den

rem 2) stažené soubory uložit jako pilot\<n>\models\manual\<partId-safe>.stp, pak zaevidovat
%PY% tools\register_manual.py register pilot\11\PLCdesk_CAD_11.json pilot\11\models --by "Jméno"
rem    volby: --source siemens (výchozí zdroj místo doporučení), --dry-run, --force, --timeout 600, --slot plcdesk_register_manual
rem    -> models\index.json + models\manual\REGISTRACE.md; návratový kód 1 = některý soubor odmítnut
```

- **Seznam (`todo`)**: jeden řádek = jeden soubor; řádky kusovníku se stejným výrobcem a objednacím kódem v projektu
  sdílejí model (stahuje se jednou), kabely model nemají. Pořadí: rozvaděč → velké polní díly (osy, motory, válce,
  majáky, dvouruční pult, světelná závora) → velké přístroje rozvaděče (měniče, servoměniče, HMI, hlavní vypínač) →
  DIN lišta → malé polní díly. Zdroj: Siemens a výrobci mimo 3Dfindit = portál výrobce, ostatní 3Dfindit (odkaz
  a LINEID z dřívějšího `resolve_*.json` / `kandidati_ke_schvaleni.json`; u kódů bez odkazu hledá člověk). Sloupec
  „Den“ rozdělí 3Dfindit po 45 / den (fair use 50). Modely se mezi projekty nesdílejí — každý pilot stahuje sám.
- **Párování (`register`)**: `models/manual/*.stp|*.step` (velikost písmen nevadí) podle jména `partId-safe`
  (`MI.safe_name`); stejný soubor dostanou i ostatní řádky se stejným výrobcem + kódem (pokud nemají vlastní soubor).
  Přípona `@<zdroj>` (`TA1_vfd@3dfindit.stp`) přepíše doporučený zdroj. Nespárované soubory jsou v reportu.
- **Kontrola**: nejdřív bez FreeCADu (ZIP uložený jako .stp, chybí hlavička ISO-10303-21, schéma → `format` AP214 /
  AP242 / AP203), pak **jeden** běh FreeCADu pro všechny nové soubory přes skill **freecad-instance**
  (`run_fc.ps1 run --slot plcdesk_register_manual --timeout …`, `tools/check_step.py`): načtení, objem > 0, obálka.
  Po timeoutu nebo zbylém procesu `run_fc.ps1 cleanup --slot …` — zavře jen PID zapsané v tomto slotu.
  Nevyhovující soubor index nezmění. Nezměněný soubor (stejná cesta a SHA-256) se podruhé neměří.
- **Zápis**: `source` `manual-3dfindit` / `manual-<výrobce>`, `file` `manual/<…>.stp`, `downloaded` (datum),
  `registered`, `by`, `sha256`, `check`, `url`, `lineId` (3Dfindit), `replaced` (dřívější zástupný / skriptový
  model). Soubor zástupného modelu zůstává na disku. `placeholder.py`, `download.py` a `check.py` berou `manual-*`
  jako skutečný model výrobce (`models_index.is_vendor_model`).
- Testy `tests/test_register_manual.py` (bez sítě a bez FreeCADu — měření je mock, `run_fc` se jen kontroluje
  v příkazové řádce).
