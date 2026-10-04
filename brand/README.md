# PLCdesk — značka

Schváleno 2026-10-04. Varianta **A — popisové pole**, barevnost **azur**.

## Myšlenka

Symbol je rámeček výkresu s razítkem (popisovým polem) v pravém dolním rohu. Mluví
o dokumentaci, ne o programování — což odpovídá tomu, čím se produkt prodává.

## Soubory

| Soubor | Kde se používá |
|---|---|
| `plcdesk-symbol.svg` | základní symbol, barevně na světlém pozadí |
| `plcdesk-symbol-inverse.svg` | na tmavém pozadí (tmavý režim, tmavé plochy) |
| `plcdesk-symbol-mono.svg` | jednobarevně přes `currentColor` — tisk, razítko, DXF, jediná barva |
| `plcdesk-favicon.svg` | favicon; zjednodušená geometrie (silnější tah, bez linek v razítku), sám se přepíná podle `prefers-color-scheme` |
| `plcdesk-lockup.svg` | vodorovná značka symbol + logotyp pro web a tiskoviny |

`plcdesk-lockup.svg` má **živý text** (Barlow s náhradním stackem). Pro tisk a pro
předání třetí straně text převést na křivky. V aplikaci se logotyp nesází z tohoto
souboru — skládá se ze `symbol.svg` a HTML/Tk textu, aby byl ostrý v každé velikosti.

## Barvy

| Token | Světlý režim | Tmavý režim | Poznámka |
|---|---|---|---|
| ink / fg | `#111A2E` | `#DDE3F0` | inkoust, konstrukce symbolu |
| accent | `#2457C5` | `#6E9BFF` | razítko, aktivní prvky |
| accent-fg | `#FFFFFF` | `#0B1221` | text na akcentu |
| bg | `#F5F6F9` | `#0E1422` | |
| surface | `#FFFFFF` | `#161E31` | |
| muted | `#5A6881` | `#93A0BA` | |
| line | `#D6DCE6` | `#2A3550` | |
| chip | `#E7ECF6` | `#1F2A42` | |
| code-bg / code-fg | `#0B1221` / `#D4DEF2` | `#080D17` / `#C9D5EC` | |

Kontrast ověřen: akcent na bílé 6,5 : 1, bílá na akcentu 6,5 : 1, tmavý akcent na
tmavém pozadí 6,6 : 1 — vše nad AA i pro drobný text. **Tmavý režim musí použít
světlejší `#6E9BFF`**: `#2457C5` má na tmavém pozadí poměr 2,7 : 1 a propadá.

Stavové barvy (ok / warn / err) zůstávají oddělené od značky a nesou vlastní význam.

## Logotyp

„PLC" tučně (700), „desk" normálně (400), bez mezery, `letter-spacing: -0.01em`.
Písmo **Barlow**; náhradní stack `"IBM Plex Sans", system-ui, -apple-system,
"Segoe UI", sans-serif`. Technické popisky a kód zůstávají v IBM Plex Mono.

## Pravidla

- Mezi symbolem a logotypem je mezera rovná šířce razítka.
- Volné pole kolem značky odpovídá výšce razítka.
- Nejmenší velikost symbolu je 16 px; pod 24 px se používá favicon varianta
  (silnější tah, bez linek v razítku).
- Značka musí fungovat jednobarevně — razítko je pak plné v barvě inkoustu.
  Platí i pro razítko generovaných výkresů a pro DXF, kde není barva.
- Symbol se nerotuje, nedeformuje a nedostává stín ani přechod.
- Razítko zůstává v pravém dolním rohu rámečku, zarovnané na jeho vnitřní hranu.
