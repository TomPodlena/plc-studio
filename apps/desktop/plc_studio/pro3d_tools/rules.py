"""Pravidla kontrol 3D modelu bez FreeCADu (čistý Python, sdílí je ``fc_scan.py`` ve FreeCADu i ``run.py``).

Konvence modelu (závazné pro stavitele, viz ``KONVENCE``):

* ``Konstrukce_Typ`` (řetězec) = druh dílu: ``sroub`` (i spojka / konektor profilu), ``matice``, ``podlozka``,
  ``profil``, ``patka`` (stavitelná noha se závitem — smí být v díře profilu), ``kryt``, ``vypln``, ``zona`` (nebezpečná
  zóna), ``pomocny`` (pomocná / obálková geometrie — nekontroluje se), ``kabel``, ``hadice``, ``prislusenstvi``
  (záslepka, krytka, těsnění — nemusí mít šroub), ``rozhrani`` (přípojka k okolí stroje — nemusí se dotýkat rámu),
  ``zlab`` (kabelový žlab / lišta — nosný díl, musí být přišroubovaný k rámu), ``retez`` (obálka energetického řetězu —
  kabely a hadice jí procházejí), ``sroubeni`` (šroubení / rychlospojka hadice — drží vlastním závitem), ``dil`` (ostatní).
  Bez vlastnosti se druh odhadne podle jména / popisku (``typ_dilu``, rozhoduje začátek popisku).
* ``Konstrukce_Vedeni`` = ``zlab`` / ``retez`` (skill kabelaz-a-hadice, ``fc_trasa.py``: žlab ``Konstrukce_Typ =
  prislusenstvi``, obálka řetězu ``pomocny``) má přednost před ``Konstrukce_Typ`` → druh ``zlab`` / ``retez``.
* ``Konstrukce_Pohyb`` (řetězec JSON) = volitelná druhá poloha dílu nebo celku (víko, dveře, vyhazovač):
  ``{"nazev": "dveře otevřené", "posun": [x, y, z]}`` nebo
  ``{"nazev": "víko 110°", "otoc": {"osa": [0, 0, 1], "bod": [x, y, z], "uhel": 110}}``; vlastnost na App::Part platí
  pro celý obsah. Kolize se pak počítají i v té poloze (proti nepohyblivým dílům).
* ``Konstrukce_Zona`` (cokoli neprázdného), ``Konstrukce_Typ = zona``, popisek ``Zona_*`` / ``[zóna] …`` = nebezpečná
  zóna pro kontrolu otvorů (členství ve skupině „Zóny“ nestačí). Odstupové zóny a rezervy rozvaděče (vlastnost
  ``Zona_pro``, „mezera“, „rezerva“), obálky („Obálka …“) a místa obsluhy („Stanoviště …“) jsou pomocné, ne nebezpečí.
  Výjimka: ``Konstrukce_Zona`` = ``konektor`` / ``paprsek`` / ``snimani`` / ``hadice`` (``POMOCNE_ZONY``) = pomocná zóna
  volného prostoru (nasunutí zásuvky, paprsek / zóna snímání, nasunutí hadice) — kontrola ``zony`` hlídá, že do ní
  nezasahuje pevný díl (vyjma ``Konstrukce_ZonaVyjimka``), i v polohách ``Konstrukce_Pohyb``.
* **Pomocné zóny jsou ZÁVAZNÉ pro všechny moduly** (P1 válec, O1 pult, O2 maják, S1 snímač, generátory rozvaděče
  a modulů i ruční stavba): každý volný prostor, který musí zůstat volný pro funkci nebo montáž (nasunutí hadice /
  zásuvky, paprsek snímače, sejmutí víka, výřez dveří…), se modeluje jako těleso ``Konstrukce_Typ = pomocny``
  s ``Konstrukce_Zona`` = druh z ``POMOCNE_ZONY`` a ``Konstrukce_ZonaVyjimka`` = jména (FreeCAD Name) vlastních dílů
  zóny, které do ní smějí (šroubení, snímač, zásuvka; App::Link vyjme celý obsah). Kontrola ``zony`` (``fc_scan``)
  hlásí každý jiný pevný díl v zóně jako chybu, i v polohách ``Konstrukce_Pohyb``. Bez zóny se volný prostor
  nekontroluje — kontrolor K5 chybějící zónu u přípojky / konektoru / paprsku vrací. Nebezpečné zóny (zdvih, dráha
  nástroje) mají jiný druh (``zdvih``…) nebo popisek ``Zona_*`` a hodnotí je kontrola ``otvory``.
* ``Konstrukce_Zavit`` (řetězec) = **doložený závit** v dílu, jehož model díry nemá (model výrobce / STEP vložený jako
  App::Link — závity patek a čel válce, upevňovací závity přístroje): záznamy oddělené ``|`` (nebo novým řádkem),
  pole záznamu oddělená ``;`` — ``M6x1;hloubka 12;poloha x,y,z;osa dx,dy,dz;zdroj URL`` (volitelně ``material hlinik``).
  ``poloha`` = střed ústí závitu na povrchu dílu, ``osa`` = směr do materiálu, obojí v souřadnicích cíle odkazu (stejné
  jako model z ``dily/``; umístění App::Link se použije); ``zdroj`` (URL datového listu) je povinný — záznam bez zdroje
  se neuzná. Kontrola ``zasunuti`` uzná dřík šroubu souosý se záznamem (osa do 0,6 mm, jmenovitý Ø ± 0,3 mm) jako
  závit délky průniku dříku s hloubkou závitu; kontrola ``kolize`` pak průnik šroubu s tímto dílem povolí. Formát
  ``ZAVIT_FORMAT``, rozbor ``parse_zavit``, záběr ``zavit_zaber``.
* Zástupný díl = ``PLCdesk_ModelStatus = "placeholder"`` nebo ``Placeholder = True`` / ``Konstrukce_Zastupny = True``
  a barva RGB 255,140,0 (oranžová); kusovník ``PLCdesk_Id`` (= ``BomLine.id`` manifestu), ``PLCdesk_Instance``.
* Díl z generátorů ``pro3d_parts`` = ``Konstrukce_ModelStav = "dle dokumentace"`` a barva RGB 255,215,0 (žlutá, jednotně;
  vkládá se jako App::Link — barva se dědí, nepřebarvovat). Modely výrobců a vlastní konstrukce mají vlastní barvy.
"""

from __future__ import annotations

import json
import math
import re
import struct
import unicodedata

ORANGE = (255, 140, 0)   # zástupný díl
YELLOW = (255, 215, 0)   # díl „dle dokumentace“ (generátory pro3d_parts)
STAV_DOKUMENTACE = "dle dokumentace"
COLOR_TOL = 6            # ± na složku (zaokrouhlení float barvy FreeCADu)

TYPES = ("sroub", "matice", "podlozka", "profil", "patka", "kryt", "vypln", "zona", "pomocny", "kabel", "hadice",
         "prislusenstvi", "rozhrani", "zlab", "retez", "sroubeni", "dil")
VEDENI = ("zlab", "retez")          # Konstrukce_Vedeni (skill kabelaz-a-hadice)
ZASUN_MAX = 30.0                    # mm — nejdelší průnik hadice × šroubení, který je ještě zasunutí (QS / KQ2 ~12–17 mm)
FASTENERS = frozenset({"sroub", "matice", "podlozka"})
# PLCdesk_Mount, u kterého díl drží vlastním upevněním (bez šroubu v modelu): přístroj nacvaknutý na lištu (din / rack),
# snímač polohy upnutý v T-drážce válce vlastním šroubem (drazka), přístroj zašroubovaný vlastním závitem / maticemi
# v držáku (zavit — snímač M12 / M18, snímač tlaku G1/4), světelný prvek / věž nasazená bajonetem výrobce (bajonet),
# přístroj držený upínkami výrobce (upinka — upínky HMI, příchytky panelu) — souvislost je nehlásí jako „bez spoje“
MOUNT_SELF = ("din", "rack", "drazka", "zavit", "bajonet", "upinka")

KONVENCE = __doc__


def fold(s: str) -> str:
    """Malá písmena bez diakritiky (porovnávání jmen)."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


_NAME_RULES = (
    ("pomocny", re.compile(r"obalka|koridor|\[kontext\]|pomocn|envelope|^src_|zdroj model|^tmp"
                           r"|stanoviste|pristup udrzby|misto obsluhy|operator"        # místa obsluhy ≠ nebezpečí
                           r"|mezer|rezerv|odstup")),                                  # odstupy a rezervy rozvaděče
    ("zona", re.compile(r"^zona[_ ]|^\[zona\]|nebezpecn[aá] zona|\bhazard\b")),
    ("rozhrani", re.compile(r"rozhrani|\binterface\b|schnittstelle|z rozvodu haly")),
    ("sroubeni", re.compile(r"sroubeni|rychlospoj|push-?in|steckverschraub|verschraubung|\bfitting|\bqs[- ]?(g|m|\d)"
                            r"|\bkq2")),
    ("retez", re.compile(r"energeticky retez|kabelovy retez|vlecny retez|energiekette|energy chain|\be-?chain")),
    ("zlab", re.compile(r"\bzlab|kabelovy kanal|kabelkanal|cable (tray|duct)|kabelova lista")),
    ("podlozka", re.compile(r"podlozk|washer|\bdin ?125\b|\biso ?7089\b|\biso ?7090\b")),
    ("sroub", re.compile(r"\bsroub(?!eni)|screw|bolt|schraube|svornik|\biso ?(4762|4017|4014|7380|10642|7045)\b|\bdin ?(912|933|931|7984)\b"
                         r"|^sp_|\bkolik|\bpin\b|konektor|connector|verbinder")),
    ("matice", re.compile(r"\bmatic|\bnut\b|nutenstein|t-nut|\bdin ?934\b|\biso ?4032\b|\bdin ?985\b|\bmutter\b")),
    ("patka", re.compile(r"patka|\bfoot\b|stavitelna noha|nivelac|kolecko|kolo s brzdou|\bcaster\b")),
    ("prislusenstvi", re.compile(r"zaslepk|zatka|tesneni|krytka|\bcap\b|abdeckkappe|dichtung|pryzov"
                                 r"|\blista ts|\bts ?35\b|koncova zarazka|koncova deska")),
    ("profil", re.compile(r"profil|profile|\b(10|8|6|5)\d{4}l?\b|\bkk ?\d|nosnik|sloup|pricnik|traverza")),
    ("kryt", re.compile(r"kryt|\bguard\b|dvere|dveře|viko|víko|plech|stena|stěna|deska krytu")),
    ("vypln", re.compile(r"vypln|výplň|panel|polykarbon|plexi|\bmriz|\bsit\b")),
    ("kabel", re.compile(r"kabel|cable|svazek|vodic")),
    ("hadice", re.compile(r"hadic|hose|\bpun\b|tubing")),
)


_RX = dict(_NAME_RULES)


def typ_dilu(props: dict | None, label: str = "", name: str = "") -> str:
    """Druh dílu: vlastnost ``Konstrukce_Typ``, jinak odhad z popisku a jména (``dil`` = ostatní)."""
    p = props or {}
    v = fold(p.get("Konstrukce_Vedeni") or "").strip()
    if v in VEDENI:                           # vedení kabelů (žlab / obálka řetězu) má přednost před Konstrukce_Typ
        return v
    t = fold(p.get("Konstrukce_Typ") or "").strip()
    if t in TYPES:
        return t
    if pomocna_zona(p):                       # volný prostor konektoru / paprsku / hadice ≠ nebezpečí
        return "pomocny"
    if str(p.get("Konstrukce_Zona") or "").strip():
        return "zona"
    if str(p.get("Zona_pro") or "").strip():  # odstupová zóna přístroje v rozvaděči (skill rozvadec-3d) ≠ nebezpečí
        return "pomocny"
    lab = fold(label)
    if _RX["rozhrani"].search(lab):           # rozhraní k okolí stroje (přívod z haly…) má přednost
        return "rozhrani"
    head =" ".join(lab.split()[:2])          # „Šroub … do matice v drážce“ = šroub: rozhoduje začátek popisku
    for typ, rx in _NAME_RULES:
        if typ not in ("zona", "pomocny") and rx.search(head):
            if typ in ("kryt", "vypln") and _RX["profil"].search(lab):
                return "profil"           # „Víko — podélník — 104040L…“ = profil rámu víka
            return typ
    text = lab + " | " + fold(name)
    for typ, rx in _NAME_RULES:
        if rx.search(text):
            return typ
    return "dil"


# Pomocné zóny volného prostoru — ZÁVAZNÁ konvence pro všechny moduly (S1, P1, O1, O2, generátory rozvaděče / modulů,
# ruční stavba; viz KONVENCE výše a skilly stroj-stavitel / stroj-kontrolor / modul-*): ``Konstrukce_Zona`` = druh z POMOCNE_ZONY (a obvykle
# ``Konstrukce_Typ = pomocny``) — NEJSOU nebezpečné zóny (otvory je nehodnotí), ale nesmí do nich zasahovat pevné díly
# modelu (kontrola ``zony``, v obou polohách ``Konstrukce_Pohyb``). Výjimky = vlastní díly zóny (snímač, cíl, šroubení,
# zásuvka): ``Konstrukce_ZonaVyjimka`` = jména objektů (FreeCAD Name) hlavního dokumentu oddělená čárkou; patří sem
# i App::Link — vyjme se celý obsah odkazu. Kabely, hadice, obálky řetězu a ostatní pomocná tělesa se nekontrolují
# (vlastní hadice / kabel zónou prochází). Nebezpečné zóny (zdvih válce…) mají jiný druh (např. ``zdvih``) nebo ``Zona_*``.
POMOCNE_ZONY = ("konektor", "paprsek", "snimani", "hadice",
                "ovladani",         # P2/P3 (2026-11-03): ruka na ručním uzávěru, knoflíku regulátoru, odvodu kondenzátu
                "dvere", "spinac")  # O3 (2026-11-04): dráha dveří krytu, nájezd ovladače do blokovacího spínače
ZONY_PEVNE_SKIP = frozenset({"kabel", "hadice", "retez", "zona", "pomocny"})


def pomocna_zona(props: dict | None) -> str | None:
    """Druh pomocné zóny volného prostoru (``POMOCNE_ZONY``) nebo None."""
    v = fold((props or {}).get("Konstrukce_Zona") or "").strip()
    return v if v in POMOCNE_ZONY else None


def zona_vyjimky(props: dict | None) -> set[str]:
    return {x.strip() for x in str((props or {}).get("Konstrukce_ZonaVyjimka") or "").split(",") if x.strip()}


def je_zastupny(props: dict | None) -> bool:
    p = props or {}
    if str(p.get("PLCdesk_ModelStatus") or "").lower() == "placeholder":
        return True
    return any(str(p.get(k)).lower() in ("true", "1") for k in ("Placeholder", "Konstrukce_Zastupny") if k in p)


def pohyb(props: dict | None) -> dict | None:
    """Rozbor ``Konstrukce_Pohyb`` → {nazev, posun} / {nazev, otoc{osa, bod, uhel}}; vadný zápis → {"chyba": …}."""
    raw = str((props or {}).get("Konstrukce_Pohyb") or "").strip()
    if not raw:
        return None
    try:
        d = json.loads(raw)
    except ValueError as exc:
        return {"chyba": f"Konstrukce_Pohyb není JSON: {exc}"}
    if not isinstance(d, dict):
        return {"chyba": "Konstrukce_Pohyb musí být objekt JSON"}
    out = {"nazev": str(d.get("nazev") or d.get("name") or "druhá poloha")}
    if isinstance(d.get("posun"), (list, tuple)) and len(d["posun"]) == 3:
        out["posun"] = [float(x) for x in d["posun"]]
    elif isinstance(d.get("otoc"), dict):
        o = d["otoc"]
        try:
            out["otoc"] = {"osa": [float(x) for x in o["osa"]], "bod": [float(x) for x in o.get("bod", (0, 0, 0))],
                           "uhel": float(o["uhel"])}
        except (KeyError, TypeError, ValueError):
            return {"chyba": "Konstrukce_Pohyb.otoc potřebuje osa [3], bod [3], uhel"}
    else:
        return {"chyba": "Konstrukce_Pohyb potřebuje posun [x, y, z] nebo otoc {osa, bod, uhel}"}
    return out


# --- doložený závit v modelu bez děr (Konstrukce_Zavit) -------------------------------------------------------------

ZAVIT_FORMAT = "M6x1;hloubka 12;poloha x,y,z;osa dx,dy,dz;zdroj URL[;material hlinik] | další závit …"
ZAVIT_OSA_TOL = 0.6       # mm — odchylka osy dříku od osy závitu
ZAVIT_D_TOL = 0.3         # mm — jmenovitý průměr dříku × závitu
_RX_M = re.compile(r"^\s*m\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?\s*$", re.I)


def _vec3(t: str) -> list[float]:
    v = [float(x) for x in re.split(r"[\s,/]+", t.strip()) if x.strip()]
    if len(v) != 3:
        raise ValueError(f"čekám 3 čísla, je {t!r}")
    return v


def parse_zavit(text: str | None) -> tuple[list[dict], list[str]]:
    """``Konstrukce_Zavit`` → ([{d, P, hloubka, poloha, osa (jednotková), zdroj, material, text}], [chyby záznamů]).
    Záznam bez ``zdroj`` (URL) nebo s chybou se vynechá a jde do chyb (doložený závit se neodhaduje). Desetinná
    místa tečkou (čárka odděluje složky vektoru)."""
    out, err = [], []
    raw = str(text or "").strip()
    if not raw:
        return out, err
    for rec in [r for r in re.split(r"[|\n]", raw) if r.strip()]:
        f = [x.strip() for x in rec.split(";") if x.strip()]
        try:
            m = _RX_M.match(f[0]) if f else None
            if not m:
                raise ValueError("první pole musí být závit M<d>[x<P>]")
            z = {"d": float(m.group(1).replace(",", ".")), "P": float(m.group(2).replace(",", ".")) if m.group(2) else None,
                 "hloubka": None, "poloha": None, "osa": None, "zdroj": "", "material": "", "text": rec.strip()}
            for x in f[1:]:
                k, _s, v = x.partition(" ")
                k = fold(k)
                if k == "hloubka":
                    z["hloubka"] = float(v.strip().replace(",", "."))
                elif k == "poloha":
                    z["poloha"] = _vec3(v)
                elif k == "osa":
                    a = _vec3(v)
                    n = math.sqrt(sum(c * c for c in a))
                    if n < 1e-9:
                        raise ValueError("nulová osa")
                    z["osa"] = [c / n for c in a]
                elif k == "zdroj":
                    z["zdroj"] = v.strip()
                elif k == "material":
                    z["material"] = v.strip()
            miss = [k for k in ("hloubka", "poloha", "osa") if z[k] is None]
            if miss:
                raise ValueError("chybí " + ", ".join(miss))
            if z["hloubka"] <= 0:
                raise ValueError("hloubka musí být > 0")
            if not re.match(r"^https?://", z["zdroj"]):
                raise ValueError("chybí zdroj (URL datového listu) — doložený závit bez zdroje se neuzná")
            out.append(z)
        except (ValueError, IndexError) as exc:
            err.append(f"{rec.strip()[:80]}: {exc}")
    return out, err


def zavit_text(zavity: list[dict]) -> str:
    """Opak ``parse_zavit`` (pro generátory): seznam {d, P?, hloubka, poloha, osa, zdroj, material?} → řetězec."""
    def v(a):
        return ",".join(f"{round(float(c), 4):g}" for c in a)
    out = []
    for z in zavity:
        t = f"M{float(z['d']):g}" + (f"x{float(z['P']):g}" if z.get("P") else "")
        t += f";hloubka {float(z['hloubka']):g};poloha {v(z['poloha'])};osa {v(z['osa'])};zdroj {z['zdroj']}"
        if z.get("material"):
            t += f";material {z['material']}"
        out.append(t)
    return " | ".join(out)


def zavit_zaber(c, d, r: float, t0: float, t1: float, z: dict) -> float | None:
    """Délka dříku (osa bod ``c``, směr ``d`` jednotkový, poloměr ``r``, interval ⟨t0, t1⟩ podél osy) v doloženém
    závitu ``z`` (globální poloha / osa). None = jiná osa nebo průměr; 0 = souosý, ale mimo hloubku závitu."""
    if abs(2 * r - z["d"]) > ZAVIT_D_TOL:
        return None
    a = z["osa"]
    dot = sum(d[i] * a[i] for i in range(3))
    if abs(abs(dot) - 1.0) > 1e-3:
        return None
    w = [z["poloha"][i] - c[i] for i in range(3)]
    s = sum(w[i] * d[i] for i in range(3))
    off = math.sqrt(max(0.0, sum(w[i] * w[i] for i in range(3)) - s * s))
    if off > ZAVIT_OSA_TOL:
        return None
    sg = 1.0 if dot > 0 else -1.0
    lo, hi = sorted((s, s + sg * z["hloubka"]))
    return max(0.0, min(t1, hi) - max(t0, lo))


def povolena_kolize(typ_a: str, typ_b: str) -> str | None:
    """Druh povoleného průniku dvojice (bez ohledu na pořadí) nebo None (= průnik je chyba).

    ``sroub`` × díl / profil = šroub v díře / závitu / drážce; ``sroub`` × ``matice`` = závit; ``matice`` × ``profil`` =
    matice v drážce; ``sroub`` × ``podlozka`` = šroub v otvoru podložky. Zda průnik opravdu leží v díře / drážce,
    dověřuje ``fc_scan`` geometrií (souosá válcová plocha, podíl objemu).

    Vedení (skill kabelaz-a-hadice): ``kabel`` / ``hadice`` × ``zlab`` / ``retez`` = ``vedeni`` (kabel leží ve žlabu,
    prochází obálkou řetězu); ``hadice`` × ``sroubeni`` = ``zasunuti`` (konec hadice uvnitř rychlospojky — ``fc_scan``
    dověří čelo hadice v průniku a délku průniku ≤ ``ZASUN_MAX``); ``sroubeni`` × díl / profil / kryt / příslušenství /
    výplň = ``dira`` (závit šroubení v portu — souosá díra jako u šroubu). Obálka řetězu × cokoli jiného = chyba
    (do dráhy řetězu nesmí nic zasahovat)."""
    a, b = sorted((typ_a, typ_b))
    pair = {a, b}
    if len(pair) == 2 and pair & {"kabel", "hadice"} and pair & set(VEDENI):
        return "vedeni"
    if pair == {"hadice", "sroubeni"}:
        return "zasunuti"
    if "sroubeni" in pair and "sroub" not in pair:
        other = b if a == "sroubeni" else a
        return "dira" if other in ("dil", "profil", "kryt", "prislusenstvi", "vypln") else None
    if "sroub" in (a, b):
        other = b if a == "sroub" else a
        if other in ("sroub", "zona", "pomocny"):
            return None
        if other == "matice":
            return "zavit"
        if other == "podlozka":
            return "otvor"
        if other in ("kabel", "hadice"):
            return None
        return "dira"
    if "matice" in (a, b):
        other = b if a == "matice" else a
        if other == "profil":
            return "drazka"
    if "patka" in (a, b):
        other = b if a == "patka" else a
        if other in ("profil", "dil", "matice"):
            return "dira"               # závitový čep nohy v díře / jádru profilu
    return None


# --- kopie těles (V12) a zašroubování (V4 / M1) ----------------------------------------------------------------------

# Druhy, které kontrola kopií nehodnotí: pomocná geometrie, zóny, ohebné vedení (kabel / hadice mají každý jinou trasu,
# shoda tvaru je náhoda), obálka řetězu.
KOPIE_SKIP = frozenset({"pomocny", "zona", "kabel", "hadice", "retez"})
KOPIE_MAX_SKUPIN = 5      # do chyb (KONTROLY.md) nejvýš tolik skupin, zbytek souhrnně; plný výpis v data.skupiny

KOPIE_POKYN = ("opakovaný díl jako kopie tělesa — vlož jeden zdroj a ostatní kusy jako App::Link na něj; vlastnosti "
               "kusovníku (PLCdesk_Id, PLCdesk_Instance, Konstrukce_Typ …) dej přímo na odkaz (addProperty na App::Link, "
               "přežije uložení), umístění na Placement odkazu")

# Hloubka zašroubování podle materiálu tělesa se závitem — ČSN / pravidlo palce ze skillu spoje-sroubove kap. 6
# „Hloubka zašroubování“ (ocel cca 1 × d, litina 1,25–1,5 × d, hliníkové slitiny a mosaz 1,5–2 × d, termoplasty 2 × d
# a víc); bereme dolní mez pásma. Spodní mez 3 mm = ODHAD (méně než ~3 stoupání drobného závitu nenese).
ZASROUB_SRC = "skill spoje-sroubove kap. 6 Hloubka zašroubování (ocel 1·d, litina 1,25·d, Al / mosaz 1,5·d, plast 2·d)"
ZASROUB_K = {"ocel": 1.0, "litina": 1.25, "hlinik": 1.5, "plast": 2.0}
ZASROUB_MIN_MM = 3.0      # ODHAD — spodní mez pro drobné závity
ZASROUB_TOL = 0.2         # mm — zaokrouhlení modelu
FASTENER_NOT_THREAD = re.compile(r"\bcep\b|kolik|\bpin\b|konektor|connector|verbinder|\bspojk|upink|\bclip|klip|\bnyt"
                                 r"|rivet|zavlack")
_MAT = (("hlinik", re.compile(r"hlin|\balu|\bal\b|almg|alsi|en aw|aluminium|aluminum|mosaz|brass|messing")),  # i vložka v plastu
        ("litina", re.compile(r"litin|\bgg\b|gjl|gjs|cast iron|guss")),
        ("plast", re.compile(r"\bpa\b|pa ?6|polyamid|plast|\bpom\b|\bpe-?hd|\bpp\b|nylon|izolant|izolator|kunststoff")))


def material_zavitu(props: dict | None, label: str = "", typ: str = "") -> str:
    """Materiál tělesa se závitem: ``Konstrukce_Material``, jinak popisek; profil rámu = hliník (ALUTEC / item / Bosch),
    jinak ocel (na straně požadavku nejmírnější — pro hliník a plast je požadavek přísnější)."""
    p = props or {}
    for text in (fold(p.get("Konstrukce_Material") or ""), fold(label)):
        for mat, rx in _MAT:
            if text and rx.search(text):
                return mat
    return "hlinik" if typ == "profil" else "ocel"


def min_zasroubovani(d: float, mat: str = "ocel") -> float:
    """Nejmenší délka zašroubování (mm) pro šroub o jmenovitém průměru ``d`` do materiálu ``mat``."""
    return max(ZASROUB_K.get(mat, 1.0) * d, ZASROUB_MIN_MM)


def posud_sroub(d: float, zabery: list[dict]) -> dict:
    """Posouzení jednoho šroubu z naměřených záběrů dříku (``fc_scan``): každý záběr {dil, druh, delka, diry, skrz,
    material, matice_l}. ``druh``: ``kontext`` (díl jiné části — jen varování), ``obalka`` (konec dříku na
    zjednodušeném modelu bez děr — jen varování), ``zavit`` (souosá díra ≤ jmenovitý průměr = závit / jádro), ``matice``,
    ``bez_diry`` (dřík v plném materiálu — díra chybí, kolize to hlásí zvlášť), ``pruchozi`` (průchozí díra / podložka).

    Vrací {uroven: ok | varovani | chyba, kod, text, nosny (šroub něco drží — počítá se jako spoj), delka, pozad}."""
    nit = [z for z in zabery if z.get("druh") in ("zavit", "matice", "bez_diry") and z.get("delka", 0) > ZASROUB_TOL]
    pr = [z for z in zabery if z.get("druh") == "pruchozi" and z.get("delka", 0) > ZASROUB_TOL]
    ctx = [z for z in zabery if z.get("druh") == "kontext" and z.get("delka", 0) > ZASROUB_TOL]
    if not nit and ctx:
        z = max(ctx, key=lambda q: q["delka"])
        return {"uroven": "varovani", "kod": "sroub-kontext", "nosny": True, "delka": round(float(z["delka"]), 2),
                "pozad": min_zasroubovani(d), "dil": z.get("dil"), "druh": "kontext",
                "text": f"šroub M{d:g}: závit v dílu jiné části ({z.get('dil')}, kontext) {float(z['delka']):.1f} mm — "
                        "tady neověřitelné, ověř závit v té části (požadavek / zpětná vazba)"}
    ob = [z for z in zabery if z.get("druh") == "obalka"]
    if not nit and ob:
        return {"uroven": "varovani", "kod": "sroub-obalka", "nosny": True, "delka": 0.0, "pozad": min_zasroubovani(d),
                "dil": ob[0].get("dil"), "druh": "obalka",
                "text": f"šroub M{d:g} končí na zjednodušeném modelu {ob[0].get('dil')} (obálka / zástupný bez děr) — "
                        "závit předpokládán v dílu, ověř podle dokumentace výrobce"}
    if not nit and not pr:
        return {"uroven": "chyba", "kod": "sroub-nic", "nosny": False, "delka": 0.0, "pozad": min_zasroubovani(d),
                "text": f"šroub M{d:g} nic nespojuje — dřík nevede do žádného dílu ani matice (zasunutí 0 mm)"}
    if not nit:
        dily = ", ".join(sorted({str(z.get('dil')) for z in pr}))[:120]
        return {"uroven": "chyba", "kod": "sroub-bez-zavitu", "nosny": False, "delka": 0.0, "pozad": min_zasroubovani(d),
                "text": f"šroub M{d:g} bez závitu i matice — dřík jen v průchozích dírách ({dily}), nic ho nedrží "
                        f"(závitovou díru modeluj Ø jádra d − P, jinak matice)"}

    def need(z):
        if z["druh"] == "matice":
            return min(float(z.get("matice_l") or d), max(d, ZASROUB_MIN_MM))
        return min_zasroubovani(d, z.get("material") or "ocel")

    best = max(nit, key=lambda z: z["delka"] - need(z))
    req, L = need(best), float(best["delka"])
    base = {"nosny": True, "delka": round(L, 2), "pozad": round(req, 2), "dil": best.get("dil"), "druh": best["druh"]}
    if L >= req - ZASROUB_TOL:
        return dict(base, uroven="ok", kod="sroub-ok",
                    text=f"šroub M{d:g}: {best['druh']} v {best.get('dil')} {L:.1f} mm ≥ {req:.1f} mm")
    mat = best.get("material") or "ocel"
    if best["druh"] == "zavit" and best.get("skrz") and float(best.get("diry") or 0) < req - ZASROUB_TOL:
        return dict(base, uroven="varovani", kod="sroub-tenky",
                    text=f"šroub M{d:g}: závit v tenkém dílu {best.get('dil')} — celá tloušťka {L:.1f} mm < {req:.1f} mm "
                         f"({mat}) — ověř únosnost, jinak závitová vložka / nýtovací matice / matice ({ZASROUB_SRC})")
    return dict(base, uroven="chyba", kod="sroub-kratky",
                text=f"šroub M{d:g}: zašroubování do {best.get('dil')} jen {L:.1f} mm < {req:.1f} mm ({mat}, "
                     f"{ZASROUB_K.get(mat, 1.0):g}·d) — delší šroub / hlubší závit ({ZASROUB_SRC})")


# --- ISO 13857:2019 tab. 4 -------------------------------------------------------------------------------------------

ISO13857_SRC = ("ČSN EN ISO 13857:2019 tab. 4 (osoby ≥ 14 let) — přetisk Troax „Safety Guide — ISO 13857“ "
                "ref. 202005-1655-EN; převzato ze skillu ramy-a-kryty references/bezpecne-vzdalenosti.md kap. 2.4")
# (e_max včetně, štěrbina, čtverec, kruh) — Sr v mm; e > 120 mm tabulka neplatí (přístup celým tělem)
ISO13857_TAB4 = (
    (4.0, 2, 2, 2),
    (6.0, 10, 5, 5),
    (8.0, 20, 15, 5),
    (10.0, 80, 25, 20),
    (12.0, 100, 80, 80),
    (20.0, 120, 120, 120),
    (30.0, 850, 120, 120),       # štěrbina ≤ 65 mm dlouhá: 200 (palec jako zarážka)
    (40.0, 850, 200, 120),
    (120.0, 850, 850, 850),
)
SHAPES = ("sterbina", "ctverec", "kruh")


def iso13857_sr(e: float, tvar: str = "sterbina", delka: float | None = None) -> float | None:
    """Bezpečná vzdálenost Sr (mm) pro otvor šířky ``e`` (štěrbina / čtverec / kruh); None = e > 120 mm.
    Nepravidelný otvor se počítá jako štěrbina (na straně bezpečnosti)."""
    col = SHAPES.index(tvar) + 1 if tvar in SHAPES else 1
    for row in ISO13857_TAB4:
        if e <= row[0] + 1e-9:
            sr = float(row[col])
            if col == 1 and row[0] == 30.0 and delka is not None and delka <= 65.0:
                sr = 200.0
            return sr
    return None


def posud_otvor(e: float, sr_primka: float, sr_draha: float | None, voxel: float, tvar: str = "sterbina",
                delka: float | None = None) -> dict:
    """Vyhodnocení nalezené cesty k zóně: e (mm; změřené, nebo odhad z mřížky), Sr přímkou (dolní mez) a po dráze.
    Odhad z mřížky konzervativně: e + krok mřížky. Vrací {uroven: chyba|varovani|ok, sr_pozad, text}."""
    e_hor = e + voxel
    req = iso13857_sr(e_hor, tvar, delka)
    if req is None:
        return {"uroven": "chyba", "sr_pozad": None,
                "text": f"otvor e ≈ {e:.0f} mm (> 120 mm) — tab. 4 neplatí, přístup celým tělem / paží bez omezení"}
    if sr_primka >= req:
        return {"uroven": "ok", "sr_pozad": req, "text": f"e ≈ {e:.0f} mm → Sr ≥ {req:.0f} mm, změřeno ≥ {sr_primka:.0f} mm"}
    if sr_draha is not None and sr_draha >= req:
        return {"uroven": "varovani", "sr_pozad": req,
                "text": f"e ≈ {e:.0f} mm → Sr ≥ {req:.0f} mm: přímkou jen {sr_primka:.0f} mm, po dráze {sr_draha:.0f} mm "
                        "— ověřit měřením (ohyb ruky)"}
    return {"uroven": "chyba", "sr_pozad": req,
            "text": f"e ≈ {e:.0f} mm → Sr ≥ {req:.0f} mm, změřeno jen {sr_primka:.0f} mm"}


# --- barvy z GuiDocument.xml (bez FreeCADu) -------------------------------------------------------------------------

def color_from_packed(v: int) -> tuple[int, int, int]:
    """FreeCAD balí barvu jako RGBA uint32 (r << 24 | g << 16 | b << 8 | a)."""
    return ((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255)


def material_diffuse(blob: bytes) -> tuple[int, int, int] | None:
    """Difúzní barva prvního materiálu ze souboru PropertyMaterialList (FreeCAD 1.x: počet, ambient, diffuse…)."""
    if len(blob) < 12:
        return None
    n = struct.unpack("<I", blob[:4])[0]
    if n < 1:
        return None
    return color_from_packed(struct.unpack("<I", blob[8:12])[0])


def je_oranzova(rgb) -> bool:
    return rgb is not None and all(abs(int(a) - b) <= COLOR_TOL for a, b in zip(rgb, ORANGE))


def je_zluta(rgb) -> bool:
    return rgb is not None and all(abs(int(a) - b) <= COLOR_TOL for a, b in zip(rgb, YELLOW))


def je_dle_dokumentace(props: dict) -> bool:
    """Díl z generátorů normalizovaných dílů (``Konstrukce_ModelStav = "dle dokumentace"``)."""
    return fold(str((props or {}).get("Konstrukce_ModelStav") or "")).strip() == STAV_DOKUMENTACE


def fcstd_colors(path: str) -> dict:
    """{jméno objektu: (r, g, b)} z GuiDocument.xml souboru FCStd (ShapeAppearance / ShapeColor / ShapeMaterial
    odkazu s OverrideMaterial). Jen čte zip — FreeCAD netřeba."""
    import zipfile
    out: dict = {}
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        if "GuiDocument.xml" not in names:
            return out
        g = z.read("GuiDocument.xml").decode("utf-8", errors="replace")
        for m in re.finditer(r'<ViewProvider name="([^"]+)"', g):
            end = g.find("</ViewProvider>", m.end())
            seg = g[m.end():end if end > 0 else len(g)]
            rgb = None
            ov = re.search(r'name="OverrideMaterial".*?<Bool value="(\w+)"', seg, re.S)
            if ov and ov.group(1) == "true":
                sm = re.search(r'name="ShapeMaterial".*?diffuseColor="(\d+)"', seg, re.S)
                if sm:
                    rgb = color_from_packed(int(sm.group(1)))
            if rgb is None:
                f = re.search(r'name="ShapeAppearance".*?file="([^"]+)"', seg, re.S)
                if f and f.group(1) in names:
                    rgb = material_diffuse(z.read(f.group(1)))
            if rgb is None:
                sc = re.search(r'name="ShapeColor".*?value="(\d+)"', seg, re.S)
                if sc:
                    rgb = color_from_packed(int(sc.group(1)))
            if rgb is not None:
                out[m.group(1)] = rgb
    return out


def fcstd_overrides(path: str) -> dict:
    """{jméno odkazu: (r, g, b)} pro ViewProvidery s ``OverrideMaterial = true`` (odkaz přebarvuje cíl)."""
    import zipfile
    out: dict = {}
    with zipfile.ZipFile(path) as z:
        if "GuiDocument.xml" not in z.namelist():
            return out
        g = z.read("GuiDocument.xml").decode("utf-8", errors="replace")
    for m in re.finditer(r'<ViewProvider name="([^"]+)"', g):
        end = g.find("</ViewProvider>", m.end())
        seg = g[m.end():end if end > 0 else len(g)]
        ov = re.search(r'name="OverrideMaterial".*?<Bool value="(\w+)"', seg, re.S)
        if ov and ov.group(1) == "true":
            sm = re.search(r'name="ShapeMaterial".*?diffuseColor="(\d+)"', seg, re.S)
            out[m.group(1)] = color_from_packed(int(sm.group(1))) if sm else None
    return out


# --- kusovník 3D × manifest -------------------------------------------------------------------------------------------

def kusovnik(objs: list[dict], manifest: dict | None) -> dict:
    """Porovná díly modelu s ``PLCdesk_Id`` (seznam {id, inst, label, path, status, guid}) s řádky manifestu
    ``PLCdesk_CAD.json`` (parts[].id / qty / location / mount). Rozsah = umístění (location), která model obsahuje;
    řádky jiných umístění jsou mimo model (info)."""
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    if not manifest:
        res["varovani"].append({"kod": "manifest", "text": "manifest PLCdesk_CAD.json nenalezen — kusovník nelze porovnat"})
        res["data"]["dilu_s_id"] = len(objs)
        return res
    parts = {p.get("id"): p for p in manifest.get("parts") or [] if isinstance(p, dict)}
    guid = ((manifest.get("project") or {}).get("guid")) or ""
    by_id: dict = {}
    for o in objs:
        by_id.setdefault(o["id"], []).append(o)
    present = {parts[i].get("location") for i in by_id if i in parts}
    rows = []
    for pid, lst in sorted(by_id.items()):
        if pid not in parts and str(pid).startswith("asm:"):      # značka sestavy (projekt / rozvaděč / stanice)
            res["info"].append({"kod": "kusovnik-sestava", "text": f"{pid}: sestava ({lst[0]['label']})"})
            continue
        if pid not in parts:
            res["chyby"].append({"kod": "kusovnik-navic", "text": f"{pid}: v manifestu není ({len(lst)}×, např. {lst[0]['label']})",
                                 "objekty": [x["path"] for x in lst[:5]]})
            continue
        seen: dict = {}
        for x in lst:
            k = str(x.get("inst") or "")
            if k:
                seen.setdefault(k, []).append(x)
        for k, xs in seen.items():
            if len(xs) > 1:
                res["chyby"].append({"kod": "kusovnik-duplicita", "text": f"{pid}: instance {k} je v modelu {len(xs)}×",
                                     "objekty": [x["path"] for x in xs[:5]]})
        if guid and any(x.get("guid") and x["guid"] != guid for x in lst):
            res["varovani"].append({"kod": "kusovnik-guid", "text": f"{pid}: PLCdesk_ProjectGuid jiného projektu"})
    for pid, p in sorted(parts.items(), key=lambda kv: str(kv[0])):
        qty = p.get("qty")
        try:
            qty = int(round(float(qty))) if qty is not None else 1
        except (TypeError, ValueError):
            qty = 1
        n = len(by_id.get(pid, []))
        rows.append([pid, qty, n])
        if n == qty:
            continue
        if n == 0 and (p.get("location") not in present or p.get("mount") == "none"):
            res["info"].append({"kod": "kusovnik-mimo", "text": f"{pid}: mimo rozsah modelu ({p.get('location')}, {p.get('mount')})"})
            continue
        res["chyby"].append({"kod": "kusovnik-pocet", "text": f"{pid}: manifest {qty} ks, model {n} ks"})
    res["data"] = {"radku_manifestu": len(parts), "dilu_s_id": len(objs), "umisteni_v_modelu": sorted(x for x in present if x),
                   "radky": rows[:400]}
    return res


# --- souhrn KONTROLY.md -----------------------------------------------------------------------------------------------

CHECK_LABELS = {"kolize": "Kolize", "souvislost": "Souvislost", "zasunuti": "Zašroubování", "kopie": "Kopie těles (App::Link)",
                "otvory": "Otvory ISO 13857", "zony": "Pomocné zóny (volný prostor)", "kusovnik": "Kusovník × manifest", "stav": "Zástupné díly", "step": "STEP export / načtení", "snimky": "Snímky"}


def _pos(f: dict) -> str:
    p = f.get("poloha")
    return f" @ ({', '.join(f'{v:.0f}' for v in p)})" if isinstance(p, (list, tuple)) and len(p) == 3 else ""


def summarize(report: dict, max_lines: int = 40) -> str:
    """KONTROLY.md — nejvýš ``max_lines`` řádků: stav každé kontroly, chyby a varování s polohou."""
    checks = report.get("checks") or {}
    s = report.get("souhrn") or {}
    L = [f"# Kontroly 3D — {report.get('model_name') or ''}",
         f"Stav: **{s.get('stav')}** — chyby {s.get('chyby', 0)}, varování {s.get('varovani', 0)}; "
         f"model SHA-256 {str(report.get('sha256') or '')[:12]}, {report.get('created')}. Podrobnosti: kontroly.json.", "",
         "| kontrola | stav | chyby | varování | s |", "|---|---|---|---|---|"]
    for k, c in checks.items():
        st = "SELHALO" if c.get("selhalo") else ("OK" if not c.get("chyby") else "CHYBY")
        L.append(f"| {CHECK_LABELS.get(k, k)} | {st} | {len(c.get('chyby') or [])} | {len(c.get('varovani') or [])} | "
                 f"{c.get('secs', '')} |")
    room = max_lines - len(L) - 3
    items = [("✖", k, f) for k, c in checks.items() for f in (c.get("chyby") or [])]
    items += [("!", k, f) for k, c in checks.items() for f in (c.get("varovani") or [])]
    if items:
        L.append("")
        for mark, k, f in items[:max(0, room)]:
            L.append(f"- {mark} {k}: {' '.join(str(f.get('text', '')).split())[:200]}{_pos(f)}")
        if len(items) > room:
            L.append(f"- … a dalších {len(items) - room} (kontroly.json)")
    return "\n".join(L[:max_lines]) + "\n"


def bbox_center(bb) -> list[float]:
    return [round((bb[0] + bb[1]) / 2, 1), round((bb[2] + bb[3]) / 2, 1), round((bb[4] + bb[5]) / 2, 1)]


def dist(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))
