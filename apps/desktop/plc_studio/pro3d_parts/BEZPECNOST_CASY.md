# Časy pro bezpečnostní vzdálenost S = K·T + C (ISO 13855)

Data `data/bezpecnost_casy.json` (121 položek, rešerše 2026-10-31) + výpočet `bezpecnost_casy.py` (čistý Python, bez sítě).
Každá hodnota má zdroj: URL, dokument, stranu nebo tabulku, datum čtení a doslovnou citaci. Co výrobce veřejně nedokládá,
má stav `chybí` a poznámku, co se zkoušelo. **Takové hodnoty nevymýšlet.** Člen zadaný číslem je vždy **ODHAD**.

## Použití (stavitel / koncept)

```powershell
python -m plc_studio.pro3d_parts.bezpecnost_casy --format md `
    --aopd "C4C d=14 h=900" --vystup "SM 1226 F-DQ" --logika "1214FC t=60ms" `
    --ventil MS6-SV-E --odvzdusneni "MS6-SV-E v=10 p=6 p0=0.5" --dobeh 0.13
```

- **Role** (každá jde zadat i víckrát): `--aopd` (světelná závora / skener), `--logika`, `--vstup`, `--vystup`, `--rele`,
  `--ventil` (reakce ventilu), `--odvzdusneni` (doba odvzdušnění objemu), `--pohon` (STO), `--brzda`, `--dobeh`
  (alias `--doběh`), `--osa` (`v=… a=… tr=…`, kinematika, vždy ODHAD).
- **Dotaz** = typ, řada nebo objednací číslo a k němu parametry `k=v`:
  - `d` rozlišení, `h` výška pole (bere se nejbližší vyšší řádek tabulky),
  - `v` objem v l, `p` tlak v bar (oba nahoru), `p0` cílový tlak (dolů),
  - `n`, `tS`, `deb`… = parametry vzorce výrobce,
  - `sloupec=` vybere jiný sloupec času (např. `t_ms_kodovani`, `t_ms_3x`),
  - `t=` ruční hodnota = ODHAD; jednotka `ms` / `s`, číslo bez jednotky pod 10 = sekundy.
- **Nic nesčítat dvakrát.** Doběh změřený od povelu ventilu už obsahuje jeho reakci i odvzdušnění. Doba vypnutí
  z F-DQ je zase částí doby F-CPU, pokud ji spočítal Excel Siemens.
- Když po parametrech zbude víc řádků tabulky, platí nejhorší čas. U ventilů má přednost sloupec poruchy `t_s_porucha`.
- **Přístup:**
  - `--pristup kolmo` (výchozí): d ≤ 40 → 2000·T + 8(d − 14), platí pravidla 100 / 500 mm; 40 < d ≤ 70 → 1600·T + 850;
    `--paprsku 1–4` → C = 1200 / 850,
  - `--pristup paralelne --H …` → 1600·T + (1200 − 0,4·H),
  - `--pristup dvourucni [--zakryti]` → C = 250 / 0.
- **Výstup:** JSON + tabulka pro KONCEPT.md (člen, položka, čas, odvození, citace). Výsledek s ODHADEM nese **ODHAD**
  a člen bez dat **CHYBÍ**; S se pak nespočítá a návratový kód je 1.
- `--hledat TEXT` vypíše položky, `--kontrola` ověří úplnost dat.

**Vzorce jsou z ISO 13855:2010.** Vydání 2024 mění zápis na S = K·T + DDS + Z (položka `iso13855.2024_zmeny`,
příklady `iso13855.priklad_2024`). Výstup na to vždy upozorní.

## Co je doloženo (doloženo / chybí)

| kategorie | doloženo / chybí | obsah |
|---|---|---|
| aopd | 10 / 2 | SICK deTec4 Core a Prime (tabulka d 14 / 30 × výška), miniTwin4, Pilz PSENopt II 4F / 4H / 4B, Leuze MLC 510 / 520, Keyence GL-R (53 modelů) |
| skener | 2 / 0 | SICK nanoScan3 (tR = n·30 + 10), microScan3 ((tS + tI)·n + tO) |
| logika | 2 / 3 | S7-1200 F: výchozí cyklus FOB 100 ms, F-monitoring 150 ms |
| vstup / výstup | 6 / 1 a 4 / 0 | SM 1226 F-DI 16, F-DQ 4, F-RLY 2 (S7-1200 F); ET 200SP F-DI 8 HF, F-DQ 4 PM HF (vzorce TWCDT) |
| relé | 5 / 2 | Pilz PNOZ s1 (max. 40 ms), PNOZ X2.8P (max. 30 / 20 ms), Siemens 3SK1111 / 3SK1121 (jen typ.) |
| ventil | 44 / 2 | Festo MS6-SV-E / -D / -C (spínací časy, odezva EN1/EN2 92 ms, tabulka odvzdušnění podle objemu a tlaku), VUVG (10 typů), SMC VP / VG342 (B10d, průtok), Parker P33, vzorec SMC pro dobu vyprázdnění |
| pohon | 8 / 5 | SINAMICS G120 (STO F-DI basic / extended, PROFIsafe, SS1), V90 (STO 5 ms), S210 (STO svorky / PROFIsafe, SS1) |
| brzda | 5 / 1 | 1FL6, 1FK2, 1FK7, Festo EMMT-AS (doba sepnutí podle velikosti) |
| iso13855 | 14 / 0 | K, C, 100 / 500 mm, vícepaprskové, rovnoběžně, dvouruční, CRO, změny 2024, řešené příklady KEYENCE a DGUV |

## Co klíčového chybí

- **Doba odezvy F-CPU S7-1200 F / G2 / S7-1500F jako číslo.** Siemens ji nechává spočítat v Excelu (RT_calculator,
  ID 49368678 / 109783831), ten se nestahoval. Člen za logiku proto zadej `t=` z výpočtu v Excelu (je to ODHAD,
  dokud se nepřiloží protokol). Moduly F-DI / F-DQ samotné doložené jsou.
- **Doběh pneumatického válce po odvzdušnění.** Vzorec od výrobce neexistuje, je potřeba ho změřit
  (Parker PDNWP-002). Doba odvzdušnění ještě neznamená, že se pohyb zastavil.
- **Festo CMMT-AS / CMMT-ST / CMMO-ST, doba odezvy STO** (festo.com vrací 403), **brzda EMME-AS**, **STO u V20** (v návodu
  nenalezeno), **SS1 u V90**.
- **SMC VP544-X538 / VG342, doba odezvy** (návod se nepodařilo stáhnout), **Leuze MLC 530**, **3SK1 maximum** (jen typ.)
  a **3SK2**.
- **Brzdná dráha osy:** vzorec výrobce chybí. `--osa` počítá z kinematiky (t = tr + v/a) a výsledek je vždy ODHAD.
  Skutečný doběh se ověří měřením.
- **ISO 13855:2024:** ve veřejných shrnutích není náhrada 8(d − 14) pro d ≤ 40 ani pravidla pro jeden paprsek.

## Výhrady ke zdrojům

- festo.com, pilz.com, leuze.com i datové listy Siemens vracely 403. Použily se originální PDF výrobců u distributorů
  (RS, motionworld, automatyka24…) a pole `dokument` / `url` to u každé položky uvádí.
- Některé zdroje jsou starší vydání: G120 01/2013, 1FK7 12/2006, ET 200SP F-DQ 07/2013.
- Řádky s polem `odvozeno` jsou dosazení do vzorce výrobce, ne hodnoty opsané ze zdroje.
